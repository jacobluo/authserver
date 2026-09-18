//go:build integration

package services_test

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"testing"
	"time"

	"github.com/authplane/authserver/internal/crypto"
	"github.com/authplane/authserver/internal/domain"
	"github.com/authplane/authserver/internal/domain/user"
	"github.com/authplane/authserver/internal/ports/input"
	"github.com/authplane/authserver/internal/ports/output"
	"github.com/authplane/authserver/internal/services"
	"github.com/authplane/authserver/testdata"
)

func newAdminLoginService(t *testing.T) (*services.AdminLoginService, *testdata.TestHelper) {
	t.Helper()
	stores := testdata.SetupTestStores(t)
	auth := services.NewUserAuthService(stores.User, testObs(), nil)
	return services.NewAdminLoginService(auth, stores.User, stores.AdminSession, []byte("test-admin-csrf-key")), &testdata.TestHelper{Stores: stores}
}

func createAdmin(t *testing.T, h *testdata.TestHelper, email, password string) *user.User {
	t.Helper()
	hash, err := crypto.HashBcrypt(password)
	if err != nil {
		t.Fatalf("hash password: %v", err)
	}
	u := &user.User{ID: "admin-1", Email: email, Name: "Admin", PasswordHash: hash, Role: user.RoleAdmin, Status: user.StatusActive, Provider: user.ProviderLocal}
	if err := h.Stores.User.Create(context.Background(), u); err != nil {
		t.Fatalf("create admin: %v", err)
	}
	return u
}

func TestAdminLogin_ActiveLocalAdminCreatesHashOnlySession(t *testing.T) {
	svc, h := newAdminLoginService(t)
	ctx := context.Background()
	createAdmin(t, h, "admin@example.test", "correct-password")

	token, account, err := svc.Login(ctx, "admin@example.test", "correct-password")
	if err != nil || token == "" || account.ID != "admin-1" {
		t.Fatalf("Login = %q, %#v, %v", token, account, err)
	}
	digest := sha256.Sum256([]byte(token))
	hash := hex.EncodeToString(digest[:])
	record, err := h.Stores.AdminSession.Get(ctx, hash)
	if err != nil || record == nil || record.TokenHash != hash || record.UserID != account.ID {
		t.Fatalf("stored session = %#v, %v", record, err)
	}
	if record.TokenHash == token {
		t.Fatal("stored session contains the cookie token")
	}
	if got := record.ExpiresAt.Sub(time.Now().UTC()); got < 7*time.Hour+59*time.Minute || got > 8*time.Hour+time.Minute {
		t.Fatalf("session lifetime = %v, want 8 hours", got)
	}

	current, err := svc.Current(ctx, token)
	if err != nil || current.CSRFToken == "" || current.ID != account.ID {
		t.Fatalf("Current = %#v, %v", current, err)
	}
	if err := svc.Logout(ctx, token); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Current(ctx, token); !errors.Is(err, input.ErrAdminSessionInvalid) {
		t.Fatalf("Current after logout: %v", err)
	}
}

func TestAdminLogin_DeniesWrongPassword(t *testing.T) {
	svc, h := newAdminLoginService(t)
	createAdmin(t, h, "admin@example.test", "correct-password")

	if _, _, err := svc.Login(context.Background(), "admin@example.test", "wrong-password"); !errors.Is(err, input.ErrAdminLoginDenied) {
		t.Fatalf("Login error = %v, want ErrAdminLoginDenied", err)
	}
}

func TestAdminLogin_DeniesOrdinaryUser(t *testing.T) {
	svc, h := newAdminLoginService(t)
	hash, err := crypto.HashBcrypt("correct-password")
	if err != nil {
		t.Fatal(err)
	}
	if err := h.Stores.User.Create(context.Background(), &user.User{ID: "user-1", Email: "user@example.test", PasswordHash: hash, Role: user.RoleUser, Status: user.StatusActive, Provider: user.ProviderLocal}); err != nil {
		t.Fatal(err)
	}

	if _, _, err := svc.Login(context.Background(), "user@example.test", "correct-password"); !errors.Is(err, input.ErrAdminLoginDenied) {
		t.Fatalf("Login error = %v, want ErrAdminLoginDenied", err)
	}
}

func TestAdminLogin_DeniesDisabledAdmin(t *testing.T) {
	svc, h := newAdminLoginService(t)
	u := createAdmin(t, h, "admin@example.test", "correct-password")
	if err := u.Disable(); err != nil {
		t.Fatal(err)
	}
	if err := h.Stores.User.Update(context.Background(), u); err != nil {
		t.Fatal(err)
	}

	if _, _, err := svc.Login(context.Background(), "admin@example.test", "correct-password"); !errors.Is(err, input.ErrAdminLoginDenied) {
		t.Fatalf("Login error = %v, want ErrAdminLoginDenied", err)
	}
}

func TestAdminLogin_CurrentDeniesExpiredSession(t *testing.T) {
	svc, h := newAdminLoginService(t)
	createAdmin(t, h, "admin@example.test", "correct-password")
	if err := h.Stores.AdminSession.Create(context.Background(), output.AdminSessionRecord{TokenHash: adminTokenHash("expired"), UserID: "admin-1", ExpiresAt: time.Now().UTC().Add(-time.Second)}); err != nil {
		t.Fatal(err)
	}

	if _, err := svc.Current(context.Background(), "expired"); !errors.Is(err, input.ErrAdminSessionInvalid) {
		t.Fatalf("Current error = %v, want ErrAdminSessionInvalid", err)
	}
}

func TestAdminLogin_CurrentDeniesRevokedSession(t *testing.T) {
	svc, h := newAdminLoginService(t)
	createAdmin(t, h, "admin@example.test", "correct-password")
	token, _, err := svc.Login(context.Background(), "admin@example.test", "correct-password")
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.Logout(context.Background(), token); err != nil {
		t.Fatal(err)
	}

	if _, err := svc.Current(context.Background(), token); !errors.Is(err, input.ErrAdminSessionInvalid) {
		t.Fatalf("Current error = %v, want ErrAdminSessionInvalid", err)
	}
}

func TestAdminLogin_CurrentDeniesAdminDemotedAfterLogin(t *testing.T) {
	svc, h := newAdminLoginService(t)
	u := createAdmin(t, h, "admin@example.test", "correct-password")
	token, _, err := svc.Login(context.Background(), "admin@example.test", "correct-password")
	if err != nil {
		t.Fatal(err)
	}
	u.Role = user.RoleUser
	if err := h.Stores.User.Update(context.Background(), u); err != nil {
		t.Fatal(err)
	}

	if _, err := svc.Current(context.Background(), token); !errors.Is(err, input.ErrAdminSessionInvalid) {
		t.Fatalf("Current error = %v, want ErrAdminSessionInvalid", err)
	}
}

func TestAdminLogin_CurrentDeniesAdminDisabledAfterLogin(t *testing.T) {
	svc, h := newAdminLoginService(t)
	u := createAdmin(t, h, "admin@example.test", "correct-password")
	token, _, err := svc.Login(context.Background(), "admin@example.test", "correct-password")
	if err != nil {
		t.Fatal(err)
	}
	if err := u.Disable(); err != nil {
		t.Fatal(err)
	}
	if err := h.Stores.User.Update(context.Background(), u); err != nil {
		t.Fatal(err)
	}

	if _, err := svc.Current(context.Background(), token); !errors.Is(err, input.ErrAdminSessionInvalid) {
		t.Fatalf("Current error = %v, want ErrAdminSessionInvalid", err)
	}
}

func TestAdminLogin_PreservesAuthenticationBackendFailure(t *testing.T) {
	stores := testdata.SetupTestStores(t)
	backendErr := errors.New("database unavailable")
	svc := services.NewAdminLoginService(failingAdminAuth{err: backendErr}, stores.User, stores.AdminSession, []byte("test-admin-csrf-key"))

	if _, _, err := svc.Login(context.Background(), "admin@example.test", "correct-password"); !errors.Is(err, backendErr) || errors.Is(err, input.ErrAdminLoginDenied) {
		t.Fatalf("Login error = %v, want preserved backend failure", err)
	}
}

func TestAdminLogin_PreservesCurrentUserStoreFailure(t *testing.T) {
	stores := testdata.SetupTestStores(t)
	auth := services.NewUserAuthService(stores.User, testObs(), nil)
	backendErr := errors.New("database unavailable")
	svc := services.NewAdminLoginService(auth, failingAdminUserStore{UserStore: stores.User, err: backendErr}, stores.AdminSession, []byte("test-admin-csrf-key"))
	h := &testdata.TestHelper{Stores: stores}
	createAdmin(t, h, "admin@example.test", "correct-password")
	token, _, err := svc.Login(context.Background(), "admin@example.test", "correct-password")
	if err != nil {
		t.Fatal(err)
	}

	if _, err := svc.Current(context.Background(), token); !errors.Is(err, backendErr) || errors.Is(err, input.ErrAdminSessionInvalid) {
		t.Fatalf("Current error = %v, want preserved backend failure", err)
	}
}

func adminTokenHash(token string) string {
	digest := sha256.Sum256([]byte(token))
	return hex.EncodeToString(digest[:])
}

type failingAdminAuth struct{ err error }

func (a failingAdminAuth) Authenticate(context.Context, string, string) (*user.User, error) {
	return nil, a.err
}
func (a failingAdminAuth) GetByID(context.Context, string) (*user.User, error) {
	return nil, domain.ErrUserNotFound
}

type failingAdminUserStore struct {
	output.UserStore
	err error
}

func (s failingAdminUserStore) GetByID(context.Context, string) (*user.User, error) {
	return nil, s.err
}
