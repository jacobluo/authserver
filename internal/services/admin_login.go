package services

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"github.com/authplane/authserver/internal/domain"
	"github.com/authplane/authserver/internal/domain/user"
	"github.com/authplane/authserver/internal/ports/input"
	"github.com/authplane/authserver/internal/ports/output"
)

// AdminSessionLifetime is an absolute limit: using a session never extends it.
const AdminSessionLifetime = 8 * time.Hour

var _ input.AdminLoginPort = (*AdminLoginService)(nil)

// AdminLoginService issues and validates revocable, opaque admin sessions.
// users must be the uncached user store so disablement and role changes take
// effect on the first subsequent cookie-authenticated request.
type AdminLoginService struct {
	auth     input.UserAuthPort
	users    output.UserStore
	sessions output.AdminSessionStore
	csrfKey  []byte
}

// NewAdminLoginService constructs the admin account authentication service.
// csrfKey is a boot-time, admin-purpose key used only to derive CSRF tokens.
func NewAdminLoginService(auth input.UserAuthPort, users output.UserStore, sessions output.AdminSessionStore, csrfKey []byte) *AdminLoginService {
	return &AdminLoginService{auth: auth, users: users, sessions: sessions, csrfKey: csrfKey}
}

// Login authenticates a local active administrator and creates an eight-hour
// revocable session. Expected credential, status, and role denials are uniform.
func (s *AdminLoginService) Login(ctx context.Context, email, password string) (string, *input.AdminAccount, error) {
	u, err := s.auth.Authenticate(ctx, email, password)
	if err != nil {
		if errors.Is(err, domain.ErrInvalidCredentials) {
			return "", nil, input.ErrAdminLoginDenied
		}
		return "", nil, fmt.Errorf("authenticate admin: %w", err)
	}
	if u == nil || !u.IsLocal() || !u.IsActive() || !u.IsAdmin() {
		return "", nil, input.ErrAdminLoginDenied
	}

	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", nil, fmt.Errorf("generate admin session token: %w", err)
	}
	token := base64.RawURLEncoding.EncodeToString(raw)
	hash := adminSessionHash(token)
	expiresAt := time.Now().UTC().Add(AdminSessionLifetime)
	if err := s.sessions.Create(ctx, output.AdminSessionRecord{TokenHash: hash, UserID: u.ID, ExpiresAt: expiresAt}); err != nil {
		return "", nil, fmt.Errorf("create admin session: %w", err)
	}

	return token, s.account(u, token, expiresAt), nil
}

// Current validates a session and re-reads the uncached user record before
// returning it, so revocation, deletion, disablement, and demotion are prompt.
func (s *AdminLoginService) Current(ctx context.Context, cookieToken string) (*input.AdminAccount, error) {
	record, err := s.sessions.Get(ctx, adminSessionHash(cookieToken))
	if err != nil {
		return nil, fmt.Errorf("get admin session: %w", err)
	}
	if record == nil || !record.ExpiresAt.After(time.Now().UTC()) {
		return nil, input.ErrAdminSessionInvalid
	}

	u, err := s.users.GetByID(ctx, record.UserID)
	if err != nil {
		if errors.Is(err, domain.ErrUserNotFound) {
			return nil, input.ErrAdminSessionInvalid
		}
		return nil, fmt.Errorf("get admin session user: %w", err)
	}
	if u == nil || !u.IsLocal() || !u.IsActive() || !u.IsAdmin() {
		return nil, input.ErrAdminSessionInvalid
	}
	return s.account(u, cookieToken, record.ExpiresAt), nil
}

// Logout revokes an admin session. The underlying store's delete contract is
// idempotent, so logout is safe for already-expired or already-revoked tokens.
func (s *AdminLoginService) Logout(ctx context.Context, cookieToken string) error {
	if err := s.sessions.Delete(ctx, adminSessionHash(cookieToken)); err != nil {
		return fmt.Errorf("delete admin session: %w", err)
	}
	return nil
}

func (s *AdminLoginService) account(u *user.User, token string, expiresAt time.Time) *input.AdminAccount {
	return &input.AdminAccount{ID: u.ID, Email: u.Email, Name: u.Name, CSRFToken: s.csrfToken(token), ExpiresAt: expiresAt}
}

func (s *AdminLoginService) csrfToken(token string) string {
	mac := hmac.New(sha256.New, s.csrfKey)
	_, _ = mac.Write([]byte(token))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func adminSessionHash(token string) string {
	digest := sha256.Sum256([]byte(token))
	return hex.EncodeToString(digest[:])
}
