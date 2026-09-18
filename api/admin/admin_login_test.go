//go:build integration

package admin_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	apiadmin "github.com/authplane/authserver/api/admin"
	"github.com/authplane/authserver/api/shared"
	"github.com/authplane/authserver/internal/config"
	"github.com/authplane/authserver/internal/crypto"
	"github.com/authplane/authserver/internal/domain/audit"
	"github.com/authplane/authserver/internal/domain/user"
	"github.com/authplane/authserver/internal/observability"
	"github.com/authplane/authserver/internal/ports/input"
	"github.com/authplane/authserver/internal/services"
	"github.com/authplane/authserver/testdata"
)

type loginAudit struct{ events []audit.Event }

func (a *loginAudit) Record(_ context.Context, e audit.Event) { a.events = append(a.events, e) }

type loginFixture struct {
	h     http.Handler
	login input.AdminLoginPort
	audit *loginAudit
}

func newLoginFixture(t *testing.T, secure bool, modify func(*apiadmin.OptionalDeps)) loginFixture {
	t.Helper()
	stores := testdata.SetupTestStores(t)
	obs := observability.NewNoop()
	hash, err := crypto.HashBcrypt("correct-password")
	if err != nil {
		t.Fatal(err)
	}
	for _, u := range []*user.User{
		{ID: "admin-1", Email: "admin@example.test", Name: "Admin", Role: user.RoleAdmin, Status: user.StatusActive, Provider: user.ProviderLocal, PasswordHash: hash},
		{ID: "user-1", Email: "user@example.test", Name: "User", Role: user.RoleUser, Status: user.StatusActive, Provider: user.ProviderLocal, PasswordHash: hash},
	} {
		if err := stores.User.Create(context.Background(), u); err != nil {
			t.Fatal(err)
		}
	}
	login := services.NewAdminLoginService(services.NewUserAuthService(stores.User, obs, nil), stores.User, stores.AdminSession, []byte("test-csrf-key"))
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	a := &loginAudit{}
	opts := apiadmin.OptionalDeps{AdminLogin: login, AdminCookieSecure: secure,
		AdminLoginLockout: shared.NewAuthLockout(ctx, config.RateLimitConfig{Enabled: true, AuthFailMax: 2, AuthFailWindow: time.Minute, AuthLockout: time.Minute}, obs.Logger),
		System:            &apiadmin.SystemDeps{Audit: a},
	}
	if modify != nil {
		modify(&opts)
	}
	admin := services.NewAdminService(stores.Client, stores.User, stores.Token, stores.Audit, obs, nil)
	srv := mustNewServer(t, config.AdminConfig{APIKey: "test-key"}, admin, obs, opts)
	return loginFixture{srv.Handler(), login, a}
}

func loginRequest(h http.Handler, method, path, body, contentType, origin, auth, csrf string, cookie *http.Cookie) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, "http://admin.example.test"+path, strings.NewReader(body))
	r.RemoteAddr = "192.0.2.1:4567"
	if contentType != "" {
		r.Header.Set("Content-Type", contentType)
	}
	if origin != "" {
		r.Header.Set("Origin", origin)
	}
	if auth != "" {
		r.Header.Set("Authorization", auth)
	}
	if csrf != "" {
		r.Header.Set("X-Admin-CSRF", csrf)
	}
	if cookie != nil {
		r.AddCookie(cookie)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func (f loginFixture) session(t *testing.T) (*http.Cookie, *input.AdminAccount) {
	t.Helper()
	token, a, err := f.login.Login(context.Background(), "admin@example.test", "correct-password")
	if err != nil {
		t.Fatal(err)
	}
	return &http.Cookie{Name: "authplane_admin_session", Value: token}, a
}

func TestAdminAccountLogin_ExplicitAuthorizationNeverFallsBack(t *testing.T) {
	f := newLoginFixture(t, false, nil)
	cookie, _ := f.session(t)
	for _, auth := range []string{"Bearer wrong", "Basic wrong", "Bearer "} {
		w := loginRequest(f.h, "GET", "/admin/users", "", "", "", auth, "", cookie)
		if w.Code != 401 {
			t.Fatalf("bad Authorization fell back to Cookie: %d", w.Code)
		}
	}
	if w := loginRequest(f.h, "GET", "/admin/users", "", "", "", "", "", cookie); w.Code != 200 {
		t.Fatalf("valid cookie rejected: %d %s", w.Code, w.Body)
	}
}

func TestAdminAccountLogin_CookieAndMeAndLogout(t *testing.T) {
	for _, secure := range []bool{false, true} {
		t.Run(map[bool]string{false: "http", true: "https"}[secure], func(t *testing.T) {
			f := newLoginFixture(t, secure, nil)
			origin := "http://admin.example.test"
			if secure {
				origin = "https://admin.example.test"
			}
			w := loginRequest(f.h, "POST", "/admin/auth/login", `{"email":" ADMIN@example.test ","password":"correct-password"}`, "application/json", origin, "", "", nil)
			if w.Code != 200 {
				t.Fatalf("login: %d %s", w.Code, w.Body)
			}
			cookies := w.Result().Cookies()
			if len(cookies) != 1 {
				t.Fatalf("cookies: %v", cookies)
			}
			c := cookies[0]
			if c.Name != "authplane_admin_session" || c.Value == "" || c.Path != "/admin" || !c.HttpOnly || c.Secure != secure || c.SameSite != http.SameSiteStrictMode || c.MaxAge < 28790 || c.MaxAge > 28800 {
				t.Fatalf("cookie policy: %#v", c)
			}
			var data struct {
				ID      string    `json:"id"`
				Email   string    `json:"email"`
				Name    string    `json:"name"`
				CSRF    string    `json:"csrf_token"`
				Expires time.Time `json:"expires_at"`
			}
			if err := json.Unmarshal(w.Body.Bytes(), &data); err != nil {
				t.Fatal(err)
			}
			if data.ID != "admin-1" || data.Email != "admin@example.test" || data.Name != "Admin" || data.CSRF == "" || time.Until(data.Expires) < 7*time.Hour+59*time.Minute || strings.Contains(w.Body.String(), c.Value) {
				t.Fatalf("response: %s", w.Body)
			}
			me := loginRequest(f.h, "GET", "/admin/auth/me", "", "", "", "", "", c)
			if me.Code != 200 || !strings.Contains(me.Body.String(), data.CSRF) {
				t.Fatalf("me: %d %s", me.Code, me.Body)
			}
			for _, csrf := range []string{"", "wrong"} {
				if w := loginRequest(f.h, "POST", "/admin/auth/logout", "", "", "", "", csrf, c); w.Code != 403 {
					t.Fatalf("logout CSRF: %d", w.Code)
				}
			}
			logout := loginRequest(f.h, "POST", "/admin/auth/logout", "", "", "", "", data.CSRF, c)
			if logout.Code != 204 {
				t.Fatalf("logout: %d %s", logout.Code, logout.Body)
			}
			clear := logout.Result().Cookies()
			if len(clear) != 1 || clear[0].MaxAge != -1 || clear[0].Path != "/admin" || !clear[0].HttpOnly || clear[0].SameSite != http.SameSiteStrictMode || clear[0].Secure != secure {
				t.Fatalf("clear cookie: %#v", clear)
			}
			if me := loginRequest(f.h, "GET", "/admin/auth/me", "", "", "", "", "", c); me.Code != 401 {
				t.Fatalf("revoked cookie: %d", me.Code)
			}
			encoded, _ := json.Marshal(f.audit.events)
			if !strings.Contains(string(encoded), "admin.account.login.success") || !strings.Contains(string(encoded), "admin.account.logout") || strings.Contains(string(encoded), c.Value) || strings.Contains(string(encoded), data.CSRF) || strings.Contains(string(encoded), "correct-password") {
				t.Fatalf("audit: %s", encoded)
			}
		})
	}
}

func TestAdminAccountLogin_CSRFAndAPIKey(t *testing.T) {
	f := newLoginFixture(t, false, nil)
	c, a := f.session(t)
	for _, csrf := range []string{"", "wrong"} {
		if w := loginRequest(f.h, "POST", "/admin/users", `{}`, "application/json", "", "", csrf, c); w.Code != 403 {
			t.Fatalf("CSRF: %d", w.Code)
		}
	}
	for _, tc := range []struct{ auth, csrf, email string }{{"", a.CSRFToken, "cookie@example.test"}, {"Bearer test-key", "", "key@example.test"}} {
		w := loginRequest(f.h, "POST", "/admin/users", `{"email":"`+tc.email+`","password":"strong-password","name":"New"}`, "application/json", "", tc.auth, tc.csrf, c)
		if w.Code != 201 {
			t.Fatalf("authorized create: %d %s", w.Code, w.Body)
		}
	}
	if w := loginRequest(f.h, "POST", "/admin/auth/verify", "", "", "", "Bearer test-key", "", nil); w.Code != 200 {
		t.Fatalf("key verification: %d", w.Code)
	}
}

func TestAdminAccountLogin_InvalidRequests(t *testing.T) {
	f := newLoginFixture(t, false, nil)
	for _, tc := range []struct {
		name, body, ct, origin string
		status                 int
	}{
		{"missing origin", `{}`, "application/json", "", 403},
		{"cross origin", `{}`, "application/json", "http://evil.test", 403},
		{"wrong scheme", `{}`, "application/json", "https://admin.example.test", 403},
		{"origin path", `{}`, "application/json", "http://admin.example.test/path", 403},
		{"form", `email=x`, "application/x-www-form-urlencoded", "http://admin.example.test", 415},
		{"no content type", `{}`, "", "http://admin.example.test", 415},
		{"malformed", `{`, "application/json", "http://admin.example.test", 400},
		{"trailing JSON", `{} {}`, "application/json", "http://admin.example.test", 400},
		{"null", `null`, "application/json", "http://admin.example.test", 400},
		{"oversized", `{"email":"` + strings.Repeat("x", 17000) + `"}`, "application/json", "http://admin.example.test", 400},
	} {
		t.Run(tc.name, func(t *testing.T) {
			w := loginRequest(f.h, "POST", "/admin/auth/login", tc.body, tc.ct, tc.origin, "", "", nil)
			if w.Code != tc.status {
				t.Fatalf("status: %d want %d", w.Code, tc.status)
			}
		})
	}
}

func TestAdminAccountLogin_DenialAndLockout(t *testing.T) {
	f := newLoginFixture(t, false, nil)
	var denial string
	for _, email := range []string{"user@example.test", "missing@example.test", "admin@example.test"} {
		w := loginRequest(f.h, "POST", "/admin/auth/login", `{"email":"`+email+`","password":"wrong-password"}`, "application/json", "http://admin.example.test", "", "", nil)
		if w.Code != 401 || len(w.Result().Cookies()) != 0 {
			t.Fatalf("denial: %d", w.Code)
		}
		if denial != "" && denial != w.Body.String() {
			t.Fatal("denial leaks account state")
		}
		denial = w.Body.String()
	}
	w := loginRequest(f.h, "POST", "/admin/auth/login", `{"email":"user@example.test","password":"correct-password"}`, "application/json", "http://admin.example.test", "", "", nil)
	if w.Code != 401 || w.Body.String() != denial {
		t.Fatalf("ordinary user: %d %s", w.Code, w.Body)
	}
	// Both failed attempts normalize to the same identity; correct credentials cannot bypass its lockout.
	loginRequest(f.h, "POST", "/admin/auth/login", `{"email":" ADMIN@example.test ","password":"wrong-password"}`, "application/json", "http://admin.example.test", "", "", nil)
	w = loginRequest(f.h, "POST", "/admin/auth/login", `{"email":"admin@example.test","password":"correct-password"}`, "application/json", "http://admin.example.test", "", "", nil)
	if w.Code != 401 || w.Body.String() != denial {
		t.Fatalf("locked account: %d %s", w.Code, w.Body)
	}
	encoded, _ := json.Marshal(f.audit.events)
	if !strings.Contains(string(encoded), "admin.account.login.failure") || strings.Contains(string(encoded), "wrong-password") {
		t.Fatalf("audit: %s", encoded)
	}
}

type brokenAdminLogin struct{ input.AdminLoginPort }

func (brokenAdminLogin) Current(context.Context, string) (*input.AdminAccount, error) {
	return nil, errors.New("database down")
}
func (brokenAdminLogin) Login(context.Context, string, string) (string, *input.AdminAccount, error) {
	return "", nil, errors.New("database down")
}

func TestAdminAccountLogin_StorageFailsClosed(t *testing.T) {
	f := newLoginFixture(t, false, func(o *apiadmin.OptionalDeps) { o.AdminLogin = brokenAdminLogin{} })
	w := loginRequest(f.h, "GET", "/admin/users", "", "", "", "", "", &http.Cookie{Name: "authplane_admin_session", Value: "opaque"})
	if w.Code != 500 || strings.Contains(w.Body.String(), "database down") {
		t.Fatalf("storage failure: %d %s", w.Code, w.Body)
	}
	w = loginRequest(f.h, "POST", "/admin/auth/login", `{"email":"admin@example.test","password":"correct-password"}`, "application/json", "http://admin.example.test", "", "", nil)
	if w.Code != 500 || len(w.Result().Cookies()) != 0 {
		t.Fatalf("login storage failure: %d", w.Code)
	}
}

func TestAdminAccountLogin_InjectedAuthWins(t *testing.T) {
	called := false
	f := newLoginFixture(t, false, func(o *apiadmin.OptionalDeps) { o.Auth = stubAuth{called: &called} })
	for _, path := range []string{"/admin/auth/login", "/admin/auth/me", "/admin/auth/logout"} {
		method := "POST"
		if strings.HasSuffix(path, "/me") {
			method = "GET"
		}
		w := loginRequest(f.h, method, path, `{}`, "application/json", "http://admin.example.test", "", "", nil)
		if w.Code != 404 {
			t.Fatalf("local route registered under injected auth: %s %d", path, w.Code)
		}
	}
	if w := loginRequest(f.h, "GET", "/admin/users", "", "", "", "Bearer test-key", "", nil); w.Code != 418 {
		t.Fatalf("injected auth lost priority: %d", w.Code)
	}
}
