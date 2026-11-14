//go:build integration

package public_test

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/go-jose/go-jose/v4"

	apipublic "github.com/authplane/authserver/api/public"
	"github.com/authplane/authserver/internal/crypto"
	"github.com/authplane/authserver/internal/domain/client"
	"github.com/authplane/authserver/internal/domain/token"
	"github.com/authplane/authserver/internal/domain/user"
	"github.com/authplane/authserver/internal/ports/output"
	"github.com/authplane/authserver/internal/services"
	"github.com/authplane/authserver/testdata"
)

const userInfoIssuer = "https://auth.example.com"

type userInfoKeys struct{ kp *crypto.KeyPair }

func (k userInfoKeys) BuildJWKS(context.Context) (*jose.JSONWebKeySet, error) {
	keys := crypto.BuildJWKS(k.kp)
	return &keys, nil
}

type userInfoEnv struct {
	ts     *httptest.Server
	stores *testdata.TestHelper
	kp     *crypto.KeyPair
	claims crypto.AccessTokenClaims
}

func newUserInfoEnv(t *testing.T, alter func(*userInfoDeps)) *userInfoEnv {
	t.Helper()
	stores := testdata.SetupTestStores(t)
	testdata.SeedClientAndUser(t, stores.Client, stores.User, "login-client", "login-user")
	c, err := stores.Client.GetByID(context.Background(), "login-client")
	if err != nil {
		t.Fatal(err)
	}
	c.GrantTypes = []string{"authorization_code", "refresh_token"}
	if err := stores.Client.Update(context.Background(), c); err != nil {
		t.Fatal(err)
	}
	u, err := stores.User.GetByID(context.Background(), "login-user")
	if err != nil {
		t.Fatal(err)
	}
	u.Name = "Test User"
	u.Email = "login@example.com"
	if err := stores.User.Update(context.Background(), u); err != nil {
		t.Fatal(err)
	}
	if err := stores.Token.CreateFamily(t.Context(), &token.Family{ID: "userinfo-family", ClientID: c.ID, UserID: u.ID, Scope: "oneid:login", Status: token.FamilyActive, CreatedAt: time.Now()}); err != nil {
		t.Fatal(err)
	}
	if err := stores.Revocation.TrackJTI(t.Context(), "userinfo-jti", "userinfo-family", time.Now().Add(5*time.Minute)); err != nil {
		t.Fatal(err)
	}
	kp, err := crypto.GenerateKeyPair("ES256", "userinfo-key")
	if err != nil {
		t.Fatal(err)
	}
	deps := userInfoDeps{keys: userInfoKeys{kp}, revocation: stores.Revocation, families: stores.Token, machines: stores.MachineToken, clients: stores.Client, users: stores.User, issuer: staticIssuerForTest(userInfoIssuer)}
	if alter != nil {
		alter(&deps)
	}
	svc := services.NewUserInfoService(deps.keys, deps.revocation, deps.families, deps.machines, deps.clients, deps.users, deps.issuer)
	svc.WithPreferredUsernames(deps.preferredUsernames)
	srv := apipublic.NewServer(context.Background(), testServerCfg(), apipublic.Deps{
		CORSConfigProvider: testCORS(), URLs: testURLBuilder(), SessionSecretProvider: testSessionSecret(), SessionConfigProvider: testSessionConfig(), UserInfo: svc,
	}, testObs())
	ts := httptest.NewServer(srv.Handler())
	t.Cleanup(ts.Close)
	now := time.Now().Unix()
	return &userInfoEnv{ts: ts, stores: &testdata.TestHelper{Stores: stores}, kp: kp, claims: crypto.AccessTokenClaims{
		Issuer: userInfoIssuer, Subject: "login-user", Audience: []string{userInfoIssuer}, ClientID: "login-client", Scope: "oneid:login", JTI: "userinfo-jti", IssuedAt: now, Expiry: now + 300,
	}}
}

type userInfoDeps struct {
	preferredUsernames map[string]string
	keys               services.JWKSBuildProvider
	revocation         output.RevocationStore
	families           output.TokenStore
	machines           output.MachineTokenStore
	clients            output.ClientStore
	users              output.UserStore
	issuer             output.IssuerProvider
}

func (e *userInfoEnv) signed(t *testing.T) string {
	t.Helper()
	raw, err := crypto.SignAccessToken(e.kp, e.claims)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func (e *userInfoEnv) request(t *testing.T, path, header string, status int) map[string]any {
	t.Helper()
	req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, e.ts.URL+path, nil)
	if err != nil {
		t.Fatal(err)
	}
	if header != "" {
		req.Header.Set("Authorization", header)
	}
	resp, err := e.ts.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != status {
		t.Fatalf("status=%d want=%d body=%s", resp.StatusCode, status, body)
	}
	if resp.Header.Get("Cache-Control") != "no-store" {
		t.Errorf("missing no-store: %v", resp.Header)
	}
	if (status == 401 || status == 403) && !strings.HasPrefix(resp.Header.Get("WWW-Authenticate"), "Bearer") {
		t.Error("missing Bearer challenge")
	}
	var result map[string]any
	if err := json.Unmarshal(body, &result); err != nil {
		t.Fatalf("JSON: %v body=%s", err, body)
	}
	if status != 200 && (strings.Contains(string(body), "login@example.com") || strings.Contains(string(body), "Test User")) {
		t.Error("error disclosed user profile")
	}
	return result
}

func TestUserInfo_ProfileAndAlias(t *testing.T) {
	e := newUserInfoEnv(t, nil)
	for _, path := range []string{"/oauth/userinfo", "/userinfo"} {
		got := e.request(t, path, "Bearer "+e.signed(t), 200)
		if got["sub"] != "login-user" || got["name"] != "Test User" || got["email"] != "login@example.com" || got["preferred_username"] != "login@example.com" || len(got) != 4 {
			t.Fatalf("unexpected profile: %v", got)
		}
	}
}

func TestUserInfo_ExplicitUsernameMapping(t *testing.T) {
	names := map[string]string{"login-user": "ExampleMember"}
	e := newUserInfoEnv(t, func(d *userInfoDeps) { d.preferredUsernames = names })
	// Configuration must be copied at startup, not held by reference.
	names["login-user"] = "SomeoneElse"
	got := e.request(t, "/oauth/userinfo", "Bearer "+e.signed(t), 200)
	if got["preferred_username"] != "ExampleMember" || got["sub"] != "login-user" || got["email"] != "login@example.com" {
		t.Fatalf("incorrect mapped profile: %v", got)
	}
}

func TestUserInfo_UnmappedUserDoesNotInheritUsername(t *testing.T) {
	for _, names := range []map[string]string{{}, {"another-user": "ExampleMember"}} {
		e := newUserInfoEnv(t, func(d *userInfoDeps) { d.preferredUsernames = names })
		got := e.request(t, "/oauth/userinfo", "Bearer "+e.signed(t), 200)
		if _, ok := got["preferred_username"]; ok {
			t.Fatalf("unmapped account received a login name: %v", got)
		}
		if got["sub"] != "login-user" || got["email"] != "login@example.com" {
			t.Fatalf("unmapped profile changed identity: %v", got)
		}
	}
}

func TestOAuth2AuthorizeRejectsAmbiguousParameters(t *testing.T) {
	e := newOAuthTestServer(t)
	c, _ := e.createClient(t, false)
	c.RegistrationSource = client.SourceAdmin
	if err := e.stores.Stores.Client.Update(t.Context(), c); err != nil {
		t.Fatal(err)
	}
	e.authzSvc.WithOAuth2LoginClients([]string{c.ID})
	q := url.Values{"client_id": {c.ID}, "redirect_uri": {c.RedirectURIs[0]}, "response_type": {"code"}, "scope": {"oneid:login"}, "state": {"ambiguous"}}
	hc := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	for _, suffix := range []string{"&code_challenge=&code_challenge=present&code_challenge_method=&code_challenge_method=S256", "&resource=&resource=https%3A%2F%2Fmcp.example.com", "&code_challenge=%GG"} {
		req, err := http.NewRequestWithContext(t.Context(), http.MethodGet, e.ts.URL+"/oauth/authorize?"+q.Encode()+suffix, nil)
		if err != nil {
			t.Fatal(err)
		}
		resp, err := hc.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != 400 {
			t.Errorf("ambiguous or malformed authorization accepted: status=%d", resp.StatusCode)
		}
	}
}

func TestUserInfo_InvalidClaims(t *testing.T) {
	for _, tc := range []struct {
		name   string
		change func(*crypto.AccessTokenClaims)
		status int
	}{
		{"issuer", func(c *crypto.AccessTokenClaims) { c.Issuer = "https://other.example.com" }, 401},
		{"MCP audience", func(c *crypto.AccessTokenClaims) { c.Audience = []string{"https://mcp.example.com"} }, 401},
		{"multiple audiences", func(c *crypto.AccessTokenClaims) { c.Audience = append(c.Audience, "https://mcp.example.com") }, 401},
		{"expired within skew", func(c *crypto.AccessTokenClaims) { c.Expiry = time.Now().Unix() - 1 }, 401},
		{"not yet valid", func(c *crypto.AccessTokenClaims) { c.NotBefore = time.Now().Unix() + 60 }, 401},
		{"future issued", func(c *crypto.AccessTokenClaims) { c.IssuedAt = time.Now().Unix() + 60 }, 401},
		{"wrong scope", func(c *crypto.AccessTokenClaims) { c.Scope = "mcp:tools" }, 403},
		{"scope substring", func(c *crypto.AccessTokenClaims) { c.Scope = "oneid:login:other" }, 403},
		{"DPoP bound", func(c *crypto.AccessTokenClaims) { c.Cnf = map[string]any{"jkt": "bound-key"} }, 401},
		{"delegated", func(c *crypto.AccessTokenClaims) { c.Act = map[string]any{"sub": "actor"} }, 401},
		{"unknown user", func(c *crypto.AccessTokenClaims) { c.Subject = "missing-user" }, 401},
		{"unknown client", func(c *crypto.AccessTokenClaims) { c.ClientID = "missing-client" }, 401},
	} {
		t.Run(tc.name, func(t *testing.T) {
			e := newUserInfoEnv(t, nil)
			tc.change(&e.claims)
			e.request(t, "/oauth/userinfo", "Bearer "+e.signed(t), tc.status)
		})
	}
}

func TestUserInfo_RejectsInvalidTransport(t *testing.T) {
	e := newUserInfoEnv(t, nil)
	for _, header := range []string{"", "Basic abc", "DPoP abc", "Bearer ", "Bearer malformed.jwt.token", "Bearer a b"} {
		e.request(t, "/oauth/userinfo", header, 401)
	}
	e.request(t, "/oauth/userinfo?access_token="+e.signed(t), "", 400)
	other, err := crypto.GenerateKeyPair("ES256", "userinfo-key")
	if err != nil {
		t.Fatal(err)
	}
	forged, err := crypto.SignAccessToken(other, e.claims)
	if err != nil {
		t.Fatal(err)
	}
	e.request(t, "/oauth/userinfo", "Bearer "+forged, 401)
}

func TestUserInfo_RejectsRevokedOrInactiveIdentities(t *testing.T) {
	for _, mode := range []string{"revoked", "revoked without scope", "revoked family without blacklist", "untracked token", "disabled user", "suspended client", "non-login client", "machine token"} {
		t.Run(mode, func(t *testing.T) {
			e := newUserInfoEnv(t, nil)
			ctx := context.Background()
			switch mode {
			case "revoked", "revoked without scope":
				if mode == "revoked without scope" {
					e.claims.Scope = "mcp:tools"
				}
				if err := e.stores.Stores.Revocation.RevokeJTI(ctx, e.claims.JTI); err != nil {
					t.Fatal(err)
				}
			case "revoked family without blacklist":
				if _, err := e.stores.Stores.Token.RevokeFamily(ctx, "userinfo-family"); err != nil {
					t.Fatal(err)
				}
			case "untracked token":
				e.claims.JTI = "signed-but-untracked"
			case "disabled user":
				u, err := e.stores.Stores.User.GetByID(ctx, e.claims.Subject)
				if err != nil {
					t.Fatal(err)
				}
				u.Status = user.StatusDisabled
				if err := e.stores.Stores.User.Update(ctx, u); err != nil {
					t.Fatal(err)
				}
			case "suspended client", "non-login client":
				c, err := e.stores.Stores.Client.GetByID(ctx, e.claims.ClientID)
				if err != nil {
					t.Fatal(err)
				}
				if mode == "suspended client" {
					c.Status = client.StatusSuspended
				} else {
					c.GrantTypes = []string{"client_credentials"}
				}
				if err := e.stores.Stores.Client.Update(ctx, c); err != nil {
					t.Fatal(err)
				}
			case "machine token":
				if err := e.stores.Stores.MachineToken.Save(ctx, token.MachineToken{JTI: e.claims.JTI, ClientID: e.claims.ClientID, IssuedAt: time.Now(), ExpiresAt: time.Unix(e.claims.Expiry, 0)}); err != nil {
					t.Fatal(err)
				}
			}
			e.request(t, "/oauth/userinfo", "Bearer "+e.signed(t), 401)
		})
	}
}

type failingUserInfoRevocation struct{ output.RevocationStore }

func (f failingUserInfoRevocation) IsRevoked(context.Context, string) (bool, error) {
	return false, errors.New("database unavailable")
}

type failingUserInfoMachines struct{ output.MachineTokenStore }

func (f failingUserInfoMachines) GetByJTI(context.Context, string) (*token.MachineToken, error) {
	return nil, errors.New("database unavailable")
}

type failingUserInfoUsers struct{ output.UserStore }

func (f failingUserInfoUsers) GetByID(context.Context, string) (*user.User, error) {
	return nil, errors.New("database unavailable")
}

type failingUserInfoClients struct{ output.ClientStore }

func (f failingUserInfoClients) GetByID(context.Context, string) (*client.Client, error) {
	return nil, errors.New("database unavailable")
}

type failingUserInfoFamilies struct{ output.TokenStore }

func (f failingUserInfoFamilies) GetFamilyByAccessTokenJTI(context.Context, string) (*token.Family, error) {
	return nil, errors.New("database unavailable")
}

type failingUserInfoKeys struct{}

func (failingUserInfoKeys) BuildJWKS(context.Context) (*jose.JSONWebKeySet, error) {
	return nil, errors.New("keys unavailable")
}

type failingUserInfoIssuer struct{}

func (failingUserInfoIssuer) Issuer(context.Context) (string, error) {
	return "", errors.New("issuer unavailable")
}

func TestUserInfo_FailsClosedOnStorageErrors(t *testing.T) {
	for _, mode := range []string{"revocation", "families", "machines", "users", "clients", "keys", "issuer"} {
		t.Run(mode, func(t *testing.T) {
			e := newUserInfoEnv(t, func(d *userInfoDeps) {
				switch mode {
				case "revocation":
					d.revocation = failingUserInfoRevocation{d.revocation}
				case "machines":
					d.machines = failingUserInfoMachines{d.machines}
				case "users":
					d.users = failingUserInfoUsers{d.users}
				case "clients":
					d.clients = failingUserInfoClients{d.clients}
				case "families":
					d.families = failingUserInfoFamilies{d.families}
				case "keys":
					d.keys = failingUserInfoKeys{}
				case "issuer":
					d.issuer = failingUserInfoIssuer{}
				}
			})
			e.request(t, "/oauth/userinfo", "Bearer "+e.signed(t), 503)
		})
	}
}

// Exercise the same form-post credentials and issuer audience used by OneID,
// including browser login, consent, code exchange, refresh and revocation.
func TestUserInfo_AuthorizationCodeFlow(t *testing.T) {
	t.Run("PKCE", func(t *testing.T) { testUserInfoCodeFlow(t, false) })
	t.Run("allowlisted OAuth2", func(t *testing.T) { testUserInfoCodeFlow(t, true) })
}

func testUserInfoCodeFlow(t *testing.T, withoutPKCE bool) {
	e := newOAuthTestServer(t)
	c, secret := e.createClient(t, false)
	c.TokenEndpointAuthMethod = "client_secret_post"
	c.GrantTypes = []string{"authorization_code", "refresh_token"}
	if withoutPKCE {
		c.RegistrationSource = client.SourceAdmin
		e.authzSvc.WithOAuth2LoginClients([]string{c.ID})
		e.tokenSvc.WithOAuth2LoginClients([]string{c.ID})
	}
	if err := e.stores.Stores.Client.Update(t.Context(), c); err != nil {
		t.Fatal(err)
	}
	verifier := crypto.GenerateVerifier()
	hc := &http.Client{Jar: &testCookieJar{cookies: e.loginAndGetCookie(t)}, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	query := url.Values{"client_id": {c.ID}, "redirect_uri": {c.RedirectURIs[0]}, "response_type": {"code"}, "scope": {"oneid:login"}, "state": {"userinfo-state"}, "code_challenge": {crypto.ComputeS256Challenge(verifier)}, "code_challenge_method": {"S256"}}
	if withoutPKCE {
		query.Del("code_challenge")
		query.Del("code_challenge_method")
	}
	resp, err := hc.Get(e.ts.URL + "/oauth/authorize?" + query.Encode())
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 303 {
		t.Fatalf("authorize status=%d", resp.StatusCode)
	}
	consentURL := resp.Header.Get("Location")
	parsed, err := url.Parse(consentURL)
	if err != nil {
		t.Fatal(err)
	}
	if parsed.Path != "/consent" {
		t.Fatalf("unexpected consent URL: %s", parsed.Path)
	}
	resp, err = hc.Get(e.ts.URL + consentURL)
	if err != nil {
		t.Fatal(err)
	}
	body, err := io.ReadAll(resp.Body)
	resp.Body.Close()
	if err != nil {
		t.Fatal(err)
	}
	csrf := extractCSRFToken(string(body))
	if csrf == "" {
		t.Fatal("missing consent CSRF")
	}
	resp, err = hc.PostForm(e.ts.URL+"/consent", url.Values{"session_id": {parsed.Query().Get("session_id")}, "csrf_token": {csrf}, "action": {"allow"}, "scopes": {"oneid:login"}})
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 303 {
		t.Fatalf("consent status=%d", resp.StatusCode)
	}
	callback, err := url.Parse(resp.Header.Get("Location"))
	if err != nil {
		t.Fatal(err)
	}
	code := callback.Query().Get("code")
	if code == "" || callback.Query().Get("state") != "userinfo-state" {
		t.Fatal("missing code or state")
	}
	exchange := func(form url.Values) map[string]any {
		t.Helper()
		form.Set("client_id", c.ID)
		form.Set("client_secret", secret)
		resp, err := hc.PostForm(e.ts.URL+"/oauth/token", form)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != 200 {
			t.Fatalf("token exchange status=%d", resp.StatusCode)
		}
		var result map[string]any
		if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
			t.Fatal(err)
		}
		return result
	}
	form := url.Values{"grant_type": {"authorization_code"}, "code": {code}, "redirect_uri": {c.RedirectURIs[0]}}
	if !withoutPKCE {
		form.Set("code_verifier", verifier)
	}
	tokens := exchange(form)
	access, ok := tokens["access_token"].(string)
	if !ok {
		t.Fatal("missing access token")
	}
	refresh, ok := tokens["refresh_token"].(string)
	if !ok {
		t.Fatal("missing refresh token")
	}
	profile := func(raw string, want int) {
		t.Helper()
		req, err := http.NewRequestWithContext(t.Context(), http.MethodGet, e.ts.URL+"/oauth/userinfo", nil)
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Authorization", "Bearer "+raw)
		resp, err := hc.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != want {
			t.Fatalf("profile status=%d want=%d", resp.StatusCode, want)
		}
		if want == 200 {
			var got map[string]any
			if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
				t.Fatal(err)
			}
			if got["email"] != "oauth-test@example.com" || got["sub"] == "" {
				t.Fatalf("unexpected profile: %v", got)
			}
		}
	}
	profile(access, 200)
	rotated := exchange(url.Values{"grant_type": {"refresh_token"}, "refresh_token": {refresh}})
	newAccess, ok := rotated["access_token"].(string)
	if !ok {
		t.Fatal("missing rotated access token")
	}
	newRefresh, ok := rotated["refresh_token"].(string)
	if !ok {
		t.Fatal("missing rotated refresh token")
	}
	profile(newAccess, 200)
	resp, err = hc.PostForm(e.ts.URL+"/oauth/revoke", url.Values{"token": {newRefresh}, "token_type_hint": {"refresh_token"}, "client_id": {c.ID}, "client_secret": {secret}})
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("revoke status=%d", resp.StatusCode)
	}
	profile(access, 401)
	profile(newAccess, 401)
}
