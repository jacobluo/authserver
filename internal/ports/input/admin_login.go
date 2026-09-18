package input

import (
	"context"
	"errors"
	"time"
)

var (
	// ErrAdminLoginDenied deliberately does not reveal whether credentials,
	// account status, or role prevented an admin login.
	ErrAdminLoginDenied = errors.New("admin login denied")

	// ErrAdminSessionInvalid identifies a missing, expired, or unauthorized
	// admin session without disclosing which condition applied.
	ErrAdminSessionInvalid = errors.New("admin session invalid")
)

// AdminAccount is the authenticated admin identity exposed to the admin HTTP
// adapter. CSRFToken is derived per session and is never persisted.
type AdminAccount struct {
	ID        string
	Email     string
	Name      string
	CSRFToken string
	ExpiresAt time.Time
}

// AdminLoginPort manages opaque, revocable browser sessions for local admin
// accounts.
type AdminLoginPort interface {
	Login(ctx context.Context, email, password string) (cookieToken string, account *AdminAccount, err error)
	Current(ctx context.Context, cookieToken string) (*AdminAccount, error)
	Logout(ctx context.Context, cookieToken string) error
}
