//go:build integration_postgres

package postgres_test

import (
	"context"
	"io/fs"
	"sort"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/authplane/authserver/internal/adapters/postgres"
	"github.com/authplane/authserver/internal/observability"
	migrations "github.com/authplane/authserver/migrations/postgres"
)

// TestMigrations_UpDownUpRoundTrip applies every migration, rolls them back
// in reverse version order, and recreates the complete schema. It runs
// sequentially against the disposable integration database.
func TestMigrations_UpDownUpRoundTrip(t *testing.T) {
	ctx := context.Background()
	obs := observability.NewNoop()

	// Pass 1: up.
	db, err := postgres.Open(ctx, pgContainerDSN, postgres.PoolConfig{MaxConns: 5}, obs)
	if err != nil {
		t.Fatalf("open postgres: %v", err)
	}
	if err := db.Migrate(ctx); err != nil {
		db.Close()
		t.Fatalf("first up migration: %v", err)
	}
	tablesAfterFirstUp := listPGTables(t, ctx, db.Pool)
	if len(tablesAfterFirstUp) == 0 {
		db.Close()
		t.Fatal("first up: no tables present")
	}
	for _, expected := range expectedPGTables {
		if !containsString(tablesAfterFirstUp, expected) {
			t.Errorf("first up: missing expected table %q (got %v)", expected, tablesAfterFirstUp)
		}
	}

	// Pass 2: undo later migrations before dropping their parent tables.
	downFiles, err := fs.Glob(migrations.Migrations, "*.down.sql")
	if err != nil {
		t.Fatalf("list down scripts: %v", err)
	}
	for i := len(downFiles) - 1; i >= 0; i-- {
		downSQL, readErr := migrations.Migrations.ReadFile(downFiles[i])
		if readErr != nil {
			t.Fatalf("read %s: %v", downFiles[i], readErr)
		}
		if _, execErr := db.Pool.Exec(ctx, string(downSQL)); execErr != nil {
			db.Close()
			t.Fatalf("apply %s: %v", downFiles[i], execErr)
		}
	}
	tablesAfterDown := listPGTables(t, ctx, db.Pool)
	for _, table := range expectedPGTables {
		if containsString(tablesAfterDown, table) {
			t.Errorf("after down: table %q still exists", table)
		}
	}

	// Pass 3: recreate all versions, including their tracking records.
	if err := db.Migrate(ctx); err != nil {
		db.Close()
		t.Fatalf("second up migration: %v", err)
	}
	tablesAfterSecondUp := listPGTables(t, ctx, db.Pool)
	if !slicesEqualPG(tablesAfterFirstUp, tablesAfterSecondUp) {
		t.Errorf("schema changed between up→down→up:\nfirst up:  %v\nsecond up: %v",
			tablesAfterFirstUp, tablesAfterSecondUp)
	}

	db.Close()
}

// expectedPGTables names the tables required after all migrations.
var expectedPGTables = []string{
	"admin_sessions",
	"clients",
	"users",
	"auth_sessions",
	"token_families",
	"refresh_tokens",
	"audit_events",
	"access_token_jtis",
	"revoked_jtis",
	"signing_keys",
	"machine_tokens",
	"dpop_jtis",
	"dpop_nonces",
	"runtime_settings",
	"trusted_idps",
	"assertion_jtis",
	"xaa_policies",
	"subject_mappings",
	"broker_providers",
	"resources",
	"consent_grants",
	"broker_grants",
	"issuances",
	"connect_pending_states",
}

func listPGTables(t *testing.T, ctx context.Context, pool *pgxpool.Pool) []string {
	t.Helper()
	rows, err := pool.Query(ctx,
		`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename != 'schema_migrations'`)
	if err != nil {
		t.Fatalf("query pg_tables: %v", err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			t.Fatalf("scan: %v", err)
		}
		out = append(out, name)
	}
	sort.Strings(out)
	return out
}

func containsString(haystack []string, needle string) bool {
	for _, s := range haystack {
		if s == needle {
			return true
		}
	}
	return false
}

func slicesEqualPG(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	ac := append([]string(nil), a...)
	bc := append([]string(nil), b...)
	sort.Strings(ac)
	sort.Strings(bc)
	return strings.Join(ac, ",") == strings.Join(bc, ",")
}
