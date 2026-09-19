package sqlite_test

import (
	"context"
	"strings"
	"testing"

	"github.com/authplane/authserver/internal/ports/output"
	"github.com/authplane/authserver/testdata"
)

func TestAdminSessionStore(t *testing.T) {
	testdata.RunAdminSessionStoreTests(t, func(t *testing.T) (output.AdminSessionStore, output.UserStore, output.ClientStore) {
		stores := testdata.SetupTestStores(t)
		return stores.AdminSession, stores.User, stores.Client
	})
}

func TestAdminSessionStoreGetPropagatesStorageError(t *testing.T) {
	db := testdata.SetupTestDB(t)
	if _, err := db.DB.ExecContext(context.Background(), `DROP TABLE admin_sessions`); err != nil {
		t.Fatalf("drop admin_sessions: %v", err)
	}

	got, err := db.AdminSession().Get(context.Background(), strings.Repeat("a", 64))
	if err == nil || got != nil {
		t.Fatalf("Get after storage failure = %#v, %v; want nil, non-nil error", got, err)
	}
}
