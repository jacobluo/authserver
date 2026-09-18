package testdata

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/authplane/authserver/internal/ports/output"
)

// RunAdminSessionStoreTests runs the shared admin session store contract tests.
func RunAdminSessionStoreTests(t *testing.T, newStores func(*testing.T) (output.AdminSessionStore, output.UserStore, output.ClientStore)) {
	t.Helper()

	t.Run("CreateGetDelete", func(t *testing.T) {
		sessions, users, clients := newStores(t)
		SeedClientAndUser(t, clients, users, "c1", "u1")

		ctx := context.Background()
		record := output.AdminSessionRecord{
			TokenHash: strings.Repeat("a", 64),
			UserID:    "u1",
			ExpiresAt: time.Now().UTC().Add(time.Hour).Truncate(time.Microsecond),
		}
		if err := sessions.Create(ctx, record); err != nil {
			t.Fatal(err)
		}

		got, err := sessions.Get(ctx, record.TokenHash)
		if err != nil || got == nil || got.UserID != record.UserID || !got.ExpiresAt.Equal(record.ExpiresAt) {
			t.Fatalf("Get = %#v, %v", got, err)
		}

		if err := sessions.Delete(ctx, record.TokenHash); err != nil {
			t.Fatal(err)
		}
		got, err = sessions.Get(ctx, record.TokenHash)
		if err != nil || got != nil {
			t.Fatalf("Get after Delete = %#v, %v; want nil, nil", got, err)
		}
		if err := sessions.Delete(ctx, record.TokenHash); err != nil {
			t.Fatal(err)
		}
	})
}
