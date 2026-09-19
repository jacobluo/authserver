//go:build integration

package sqlite_test

import (
	"context"
	"database/sql"
	"io/fs"
	"sort"
	"strings"
	"testing"

	"github.com/authplane/authserver/internal/adapters/sqlite"
	"github.com/authplane/authserver/internal/observability"
	migrations "github.com/authplane/authserver/migrations/sqlite"
)

// TestMigrations_UpDownUpRoundTrip applies every migration, rolls them back
// in reverse version order, and recreates the complete schema.
func TestMigrations_UpDownUpRoundTrip(t *testing.T) {
	ctx := context.Background()
	obs := observability.NewNoop()

	db, err := sqlite.Open(":memory:", obs)
	if err != nil {
		t.Fatalf("open in-memory sqlite: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	// Pass 1: up.
	if err := db.Migrate(ctx); err != nil {
		t.Fatalf("first up migration: %v", err)
	}
	tablesAfterFirstUp := listSQLiteTables(t, db.DB)
	if len(tablesAfterFirstUp) == 0 {
		t.Fatal("first up: no tables present — embedded migration FS empty?")
	}
	for _, expected := range expectedSQLiteTables {
		if !contains(tablesAfterFirstUp, expected) {
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
		if _, execErr := db.DB.ExecContext(ctx, string(downSQL)); execErr != nil {
			t.Fatalf("apply %s: %v", downFiles[i], execErr)
		}
	}
	tablesAfterDown := listSQLiteTables(t, db.DB)
	for _, table := range expectedSQLiteTables {
		if contains(tablesAfterDown, table) {
			t.Errorf("after down: table %q still exists (down script didn't drop it)", table)
		}
	}

	// Pass 3: up again. Schema must match the first up byte-for-byte
	// at the table-name level. (We do not diff column definitions —
	// the embedded SQL is the source of truth for that.)
	if err := db.Migrate(ctx); err != nil {
		t.Fatalf("second up migration: %v", err)
	}
	tablesAfterSecondUp := listSQLiteTables(t, db.DB)
	if !slicesEqual(tablesAfterFirstUp, tablesAfterSecondUp) {
		t.Errorf("schema changed between up→down→up:\nfirst up:  %v\nsecond up: %v",
			tablesAfterFirstUp, tablesAfterSecondUp)
	}
}

// expectedSQLiteTables names the tables required after all migrations.
var expectedSQLiteTables = []string{
	"admin_sessions",
	"clients",
	"users",
	"auth_sessions",
	"token_families",
	"refresh_tokens",
	"audit_events",
	"access_token_jtis",
	"revoked_jtis",
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

// listSQLiteTables returns user-defined tables (excluding
// sqlite_sequence and schema_migrations control tables).
func listSQLiteTables(t *testing.T, db *sql.DB) []string {
	t.Helper()
	rows, err := db.QueryContext(context.Background(),
		`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != 'schema_migrations'`)
	if err != nil {
		t.Fatalf("query sqlite_master: %v", err)
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

func contains(haystack []string, needle string) bool {
	for _, s := range haystack {
		if s == needle {
			return true
		}
	}
	return false
}

func slicesEqual(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	ac := append([]string(nil), a...)
	bc := append([]string(nil), b...)
	sort.Strings(ac)
	sort.Strings(bc)
	return strings.Join(ac, ",") == strings.Join(bc, ",")
}
