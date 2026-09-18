//go:build integration_postgres

package postgres_test

import (
	"testing"

	"github.com/authplane/authserver/internal/ports/output"
	"github.com/authplane/authserver/testdata"
)

func TestAdminSessionStore(t *testing.T) {
	testdata.RunAdminSessionStoreTests(t, func(t *testing.T) (output.AdminSessionStore, output.UserStore, output.ClientStore) {
		stores := testdata.SetupTestPGStores(t, pgContainerDSN)
		return stores.AdminSession, stores.User, stores.Client
	})
}
