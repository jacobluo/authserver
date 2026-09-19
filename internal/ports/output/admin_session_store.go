package output

import (
	"context"
	"time"
)

// AdminSessionRecord is a revocable server-side admin login session.
type AdminSessionRecord struct {
	TokenHash string
	UserID    string
	ExpiresAt time.Time
}

// AdminSessionStore persists revocable admin login sessions.
type AdminSessionStore interface {
	Create(context.Context, AdminSessionRecord) error
	Get(context.Context, string) (*AdminSessionRecord, error)
	Delete(context.Context, string) error
}
