# Admin Account Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let existing active `admin` users sign in to the admin UI with email and password while retaining API Key access for automation.

**Architecture:** The default admin gate accepts either the existing Bearer API Key or an opaque, database-backed admin session Cookie; an explicit bad Bearer never falls back to the Cookie. A dedicated service creates and revokes sessions, reads the uncached user store on every Cookie-authenticated request, and derives a session-bound CSRF token. The React UI uses the Cookie by default and retains an in-memory API Key fallback.

**Tech Stack:** Go 1.26.6, `net/http`, SQLite (`modernc.org/sqlite`), PostgreSQL (`pgx/v5`), React 19, TypeScript 6, Vite 8.

**Spec:** `docs/superpowers/specs/2026-09-18-admin-login-design.md`

## Global Constraints

- Admin session lifetime is 8 hours absolute; logout revokes the server-side record.
- Admin Cookie is distinct from the public OAuth session, `Path=/admin`, `HttpOnly`, `SameSite=Strict`, and `Secure` when `session.secure` is true.
- The OSS API Key path and injected `OptionalDeps.Auth` path must remain compatible. Do not register local account-login routes under injected external auth.
- `api/` depends on input ports, not concrete services or adapters; services depend on output ports; migrations support SQLite and PostgreSQL.
- Do not hand-edit generated `docs/reference/{cli,http-api,env-vars,configuration}.md`; regenerate with `make docs-gen`.
- UI credentials and API Keys must not enter `localStorage` or `sessionStorage`.
- The host currently has no `go` binary; use the repository's Go 1.26 Docker image or an installed Go 1.26.6+ toolchain for Go tests.

---

## File Map

| Responsibility | Files |
| --- | --- |
| Persistence contract and migrations | `internal/ports/output/admin_session_store.go`, `internal/ports/output/datastore.go`, `migrations/{sqlite,postgres}/005_admin_sessions.{up,down}.sql` |
| Storage adapters and shared tests | `internal/adapters/{sqlite,postgres}/admin_session.go`, both `db.go` files, `testdata/admin_session_store.go`, adapter `admin_session_test.go` files |
| Login and authorization logic | `internal/ports/input/admin_login.go`, `internal/services/admin_login.go`, `internal/services/admin_login_test.go` |
| HTTP boundaries and wiring | `api/admin/admin_login.go`, `api/admin/middleware.go`, `api/admin/routes.go`, `api/admin/server.go`, `api/admin/admin_login_test.go`, `cmd/authserver/serve.go` |
| Browser UI and documentation | `web/admin/src/{api.ts,App.tsx,pages/Login.tsx}`, `web/admin/tests/admin-login.test.mjs`, `web/admin/dist/index.html`, `docs/guides/operate/admin-login.md`, generated HTTP reference |

---

### Task 1: Persist revocable admin sessions in both databases

**Files:** Create `internal/ports/output/admin_session_store.go`, `migrations/sqlite/005_admin_sessions.up.sql`, `migrations/sqlite/005_admin_sessions.down.sql`, `migrations/postgres/005_admin_sessions.up.sql`, `migrations/postgres/005_admin_sessions.down.sql`, `internal/adapters/sqlite/admin_session.go`, `internal/adapters/postgres/admin_session.go`, `testdata/admin_session_store.go`, `internal/adapters/sqlite/admin_session_test.go`, `internal/adapters/postgres/admin_session_test.go`. Modify `internal/ports/output/datastore.go`, both adapter `db.go` files.

**Interfaces:** Produces `output.AdminSessionRecord{TokenHash string, UserID string, ExpiresAt time.Time}` and `output.AdminSessionStore` with `Create(ctx, record) error`, `Get(ctx, tokenHash) (*record, error)` (`nil, nil` on miss), and `Delete(ctx, tokenHash) error` (idempotent). `output.DataStore.AdminSession()` exposes it. Tasks 2 and 3 consume this contract.

- [ ] **Step 1: Add a failing shared adapter test.** In `testdata/admin_session_store.go`, create `RunAdminSessionStoreTests(t, newStores func(*testing.T) (output.AdminSessionStore, output.UserStore, output.ClientStore))`. Seed user `u1` and client `c1` using the existing `SeedClientAndUser`; assert Create → Get returns `u1` and the exact expiration; Delete → Get returns `nil, nil`; a repeated Delete succeeds. Call it from SQLite's integration test and PostgreSQL's `integration_postgres` test.

```go
record := output.AdminSessionRecord{
    TokenHash: strings.Repeat("a", 64), UserID: "u1", ExpiresAt: time.Now().UTC().Add(time.Hour).Truncate(time.Microsecond),
}
if err := sessions.Create(ctx, record); err != nil { t.Fatal(err) }
got, err := sessions.Get(ctx, record.TokenHash)
if err != nil || got == nil || got.UserID != record.UserID || !got.ExpiresAt.Equal(record.ExpiresAt) {
    t.Fatalf("Get = %#v, %v", got, err)
}
```

- [ ] **Step 2: Run the targeted SQLite test and confirm it fails to compile** because `AdminSessionStore` is undefined. Run `go test ./internal/adapters/sqlite -tags=integration -run TestAdminSessionStore -count=1` (or the Docker equivalent).
- [ ] **Step 3: Add the port, migration, and adapters.** Use a 64-character SHA-256 hex digest as the primary key, a `users(id)` foreign key with `ON DELETE CASCADE`, and an expiration index. SQLite persists timestamps with existing `formatTime` / `scanTime`; PostgreSQL uses `TIMESTAMPTZ`. Register each new store in `Stores`, `NewStores`, and the `DataStore` accessor.

```go
type AdminSessionRecord struct { TokenHash, UserID string; ExpiresAt time.Time }
type AdminSessionStore interface {
    Create(context.Context, AdminSessionRecord) error
    Get(context.Context, string) (*AdminSessionRecord, error)
    Delete(context.Context, string) error
}
```

```sql
CREATE TABLE admin_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
);
CREATE INDEX idx_admin_sessions_expires_at ON admin_sessions(expires_at);
```

The PostgreSQL migration uses the same columns except `expires_at TIMESTAMPTZ NOT NULL`. Both down migrations drop the index and table in reverse order.
- [ ] **Step 4: Run SQLite and PostgreSQL integration tests.** `go test ./internal/adapters/sqlite -tags=integration -run TestAdminSessionStore -count=1`; `make test-integration-postgres` using the existing test container. Also test that a storage error propagates rather than becoming a missing-session result.
- [ ] **Step 5: Commit.** `git add internal/ports/output internal/adapters/sqlite internal/adapters/postgres migrations testdata && git commit -m "feat: persist revocable admin sessions"`.

### Task 2: Implement admin login and session validation service

**Files:** Create `internal/ports/input/admin_login.go`, `internal/services/admin_login.go`, `internal/services/admin_login_test.go`. Modify `cmd/authserver/serve.go` only for capturing the uncached user store before `storage.WithUserCache` (full wiring follows in Task 3).

**Interfaces:** Consumes `input.UserAuthPort`, uncached `output.UserStore`, and `output.AdminSessionStore`. Produces `services.NewAdminLoginService(auth input.UserAuthPort, users output.UserStore, sessions output.AdminSessionStore, csrfKey []byte) *AdminLoginService`, which implements `input.AdminLoginPort`:

```go
type AdminAccount struct {
    ID, Email, Name, CSRFToken string
    ExpiresAt time.Time
}
type AdminLoginPort interface {
    Login(ctx context.Context, email, password string) (cookieToken string, account *AdminAccount, err error)
    Current(ctx context.Context, cookieToken string) (*AdminAccount, error)
    Logout(ctx context.Context, cookieToken string) error
}
var ErrAdminLoginDenied = errors.New("admin login denied")
var ErrAdminSessionInvalid = errors.New("admin session invalid")
```

- [ ] **Step 1: Write failing service tests** for active local admin success, wrong password, ordinary user, disabled admin, expired session, revoked session, role/status change after login, and store failure. In the success test, assert that the returned Cookie token is nonempty, the stored key is `hex.EncodeToString(sha256.Sum256([]byte(token))[:])` (using a local hash variable in Go), and the Cookie token itself is absent from the store record.

```go
token, account, err := svc.Login(ctx, "admin@example.test", "correct-password")
if err != nil || token == "" || account.ID != "admin-1" { t.Fatalf("Login = %q, %#v, %v", token, account, err) }
current, err := svc.Current(ctx, token)
if err != nil || current.CSRFToken == "" || current.ID != account.ID { t.Fatalf("Current = %#v, %v", current, err) }
if err := svc.Logout(ctx, token); err != nil { t.Fatal(err) }
if _, err := svc.Current(ctx, token); !errors.Is(err, input.ErrAdminSessionInvalid) { t.Fatalf("Current after logout: %v", err) }
```

- [ ] **Step 2: Confirm the tests fail** with `go test ./internal/services -run TestAdminLogin -count=1`.
- [ ] **Step 3: Implement `AdminLoginService`.** Verify credentials through `UserAuthPort.Authenticate`, then check `IsActive` and `IsAdmin`; map all expected denials to `ErrAdminLoginDenied`. Generate 32 random bytes for the opaque token, store only its SHA-256 hex digest with an expiration exactly 8 hours ahead, and derive `CSRFToken` with HMAC-SHA256 using a boot-time admin-purpose key. `Current` reads the session then checks expiration and reads the *uncached* user store on every call; deny nil, disabled, deleted, or demoted users. `Logout` deletes the digest idempotently. Never put token, password, or CSRF material in logs.

```go
const AdminSessionLifetime = 8 * time.Hour
raw := make([]byte, 32)
if _, err := rand.Read(raw); err != nil { return "", nil, err }
token := base64.RawURLEncoding.EncodeToString(raw)
digest := sha256.Sum256([]byte(token))
hash := hex.EncodeToString(digest[:])
```

- [ ] **Step 4: Run service tests**, then `go test ./internal/services/... -tags=integration -count=1`. Check that authentication backend errors remain `500`-class errors rather than being converted to bad credentials.
- [ ] **Step 5: Commit.** `git add internal/ports/input/admin_login.go internal/services/admin_login.go internal/services/admin_login_test.go cmd/authserver/serve.go && git commit -m "feat: authenticate admin accounts and validate sessions"`.

### Task 3: Add dual-mode admin HTTP authentication, CSRF, and account routes

**Files:** Create `api/admin/admin_login.go`, `api/admin/admin_login_test.go`. Modify `api/admin/middleware.go`, `api/admin/routes.go`, `api/admin/server.go`, `cmd/authserver/serve.go`.

**Interfaces:** `api/admin` consumes `input.AdminLoginPort`; no concrete service imports. `OptionalDeps` gains `AdminLogin input.AdminLoginPort`, `AdminLoginLockout *shared.AuthLockout`, and `AdminCookieSecure bool`. Its existing `Auth AuthWrapper` retains priority. The login response has `{id,email,name,csrf_token,expires_at}`; the session token appears only in `Set-Cookie`.

- [ ] **Step 1: Add failing HTTP tests** for login Cookie flags, `/admin/auth/me`, logout, ordinary-user denial, API Key compatibility, bad-Bearer-no-Cookie-fallback, missing/wrong CSRF on `POST /admin/users`, injected AuthWrapper precedence, malformed JSON/content type, and cross-origin login. Start with the conflict case:

```go
req := httptest.NewRequest(http.MethodGet, "/admin/users", nil)
req.Header.Set("Authorization", "Bearer wrong")
req.AddCookie(&http.Cookie{Name: "authplane_admin_session", Value: validAdminToken})
rr := httptest.NewRecorder()
srv.Handler().ServeHTTP(rr, req)
if rr.Code != http.StatusUnauthorized { t.Fatalf("bad Bearer fell back to Cookie: %d", rr.Code) }
```

- [ ] **Step 2: Confirm the targeted test fails** with `go test ./api/admin -tags=integration -run TestAdminAccountLogin -count=1`.
- [ ] **Step 3: Implement the HTTP boundary.** Register local account routes only when `AdminLogin != nil && Auth == nil`. Require `application/json`, a small bounded body, and an exact same-origin `Origin` for login; use `AdminLoginLockout.LockedUntil`, `RecordFailure`, and `Reset` keyed by normalized email and direct peer IP. Emit generic login errors and success/failure/logout audit events without credentials. Set/clear `authplane_admin_session` Cookie with `Path=/admin`, `HttpOnly`, `SameSite=Strict`, `Secure=AdminCookieSecure`, and Max-Age from the 8-hour expiry.

```go
if auth := r.Header.Get("Authorization"); auth != "" {
    // Validate Bearer API Key only; never try a Cookie after this branch.
    apiKeyGate.Wrap(next).ServeHTTP(w, r)
    return
}
cookie, err := r.Cookie("authplane_admin_session")
if err != nil { writeAdminError(w, http.StatusUnauthorized, "authentication required"); return }
account, err := adminLogin.Current(r.Context(), cookie.Value)
if errors.Is(err, input.ErrAdminSessionInvalid) { writeAdminError(w, http.StatusUnauthorized, "authentication required"); return }
if err != nil { writeAdminError(w, http.StatusInternalServerError, "internal error"); return }
if r.Method != http.MethodGet && r.Method != http.MethodHead && r.Method != http.MethodOptions &&
    subtle.ConstantTimeCompare([]byte(r.Header.Get("X-Admin-CSRF")), []byte(account.CSRFToken)) != 1 {
    writeAdminError(w, http.StatusForbidden, "CSRF token required")
    return
}
next.ServeHTTP(w, r)
```

Use the real API Key middleware's `Wrap(next)` in the Bearer arm, not a direct comparison duplicated in the new gate. For login Origin comparison, derive the expected scheme from `AdminCookieSecure` (`https` when true, `http` otherwise) and compare the parsed Origin to `r.Host`; do not trust client-supplied forwarding headers. In `serve.go`, save `rawUsers := ds.User()` before `storage.WithUserCache`, derive `csrfKey := sha256.Sum256(append([]byte("authplane-admin-csrf:"), sessionSecret...))`, pass `rawUsers` and `ds.AdminSession()` to `NewAdminLoginService`, and construct `shared.NewAuthLockout(ctx, cfg.RateLimit, obs.Logger)` for the admin login handler. Preserve the existing `/admin/auth/verify` route for the API Key fallback and injected wrapper.
- [ ] **Step 4: Run `go test ./api/admin/... -tags=integration -count=1`, `go test ./cmd/authserver/... -count=1`, and `make check-imports`.** Fix regressions in existing auth seam tests without weakening their assertions. Confirm a DB error fails closed with `500` rather than granting access.
- [ ] **Step 5: Commit.** `git add api/admin cmd/authserver/serve.go && git commit -m "feat: protect admin API with account sessions and CSRF"`.

### Task 4: Switch the admin UI to account login, retaining an in-memory key fallback

**Files:** Modify `web/admin/src/api.ts`, `web/admin/src/App.tsx`, `web/admin/src/pages/Login.tsx`, `web/admin/dist/index.html`. Create `web/admin/tests/admin-login.test.mjs`.

**Interfaces:** The frontend consumes `POST /admin/auth/login`, `GET /admin/auth/me`, `POST /admin/auth/logout`, and the existing `POST /admin/auth/verify`. Password mode uses the browser Cookie and `X-Admin-CSRF`; API Key mode keeps its credential only in a module variable until refresh.

- [ ] **Step 1: Add failing frontend tests** with the existing `node:test` + TypeScript transpile pattern in `tests/users-ui.test.mjs`. Render `Login` and assert Email, Password, and the secondary API Key action are present. Add source/API-client assertions that `sessionStorage` and `localStorage` are absent and that unsafe Cookie-mode requests add `X-Admin-CSRF`.

```js
const Login = require(resolve(projectDir, "src/pages/Login.tsx")).default;
const html = renderToStaticMarkup(createElement(Login, { onLogin() {} }));
assert.match(html, /Email/);
assert.match(html, /Password/);
assert.match(html, /Use API Key/);
```

- [ ] **Step 2: Run `npm test` in `web/admin` and confirm the new test fails.**
- [ ] **Step 3: Implement UI state and API calls.** At app startup call `/admin/auth/me` and show a brief loading state until the result is known. Password submit calls `/admin/auth/login`, stores only the returned CSRF token in memory, then shows the dashboard. `apiFetch` sends same-origin Cookies and the CSRF header for unsafe methods; when an in-memory API Key exists, it sends Bearer instead. A `401` clears UI auth state. Logout calls `/admin/auth/logout` for Cookie mode, or clears the in-memory key in key mode. Account login is the default tab; the API Key tab uses `/admin/auth/verify` and never persists the key.

```ts
let apiKey: string | null = null;
let csrfToken: string | null = null;
const unsafe = !["GET", "HEAD", "OPTIONS"].includes((options.method ?? "GET").toUpperCase());
if (apiKey) headers.set("Authorization", `Bearer ${apiKey}`);
else if (unsafe && csrfToken) headers.set("X-Admin-CSRF", csrfToken);
```

- [ ] **Step 4: Run `npm test` and `npm run build` in `web/admin`.** Check that the embedded `dist/index.html` changed and that the old API Key-only login is not the default. Exercise account login, refresh, an admin write, and logout in a temporary local instance with a synthetic admin account.
- [ ] **Step 5: Commit.** `git add web/admin && git commit -m "feat: add admin account login UI"`.

### Task 5: Document bootstrap and run the full integration gate

**Files:** Create `docs/guides/operate/admin-login.md`; modify `docs/guides/operate/README.md`. Regenerate `docs/reference/http-api.md` through `make docs-gen` only.

**Interfaces:** The guide documents existing `authserver admin user create --role admin`, the default account-login page, API Key fallback, Cookie lifetime, and CLI/API recovery path. It must not imply that ordinary OAuth sessions grant admin access.

- [ ] **Step 1: Add a complete HTTP journey test** to `api/admin/admin_login_test.go`, using real SQLite test stores: create an admin via the admin service, log in through HTTP, use the returned Cookie and CSRF token on `POST /admin/users`, log out, then assert the same Cookie gets `401`. Run `go test ./api/admin -tags=integration -run TestAdminAccountJourney -count=1`; fix any boundary or wiring defects it reveals.

```go
if loginResp.StatusCode != http.StatusOK { t.Fatalf("login: %d", loginResp.StatusCode) }
if writeResp.StatusCode != http.StatusCreated { t.Fatalf("admin write: %d", writeResp.StatusCode) }
if afterLogout.StatusCode != http.StatusUnauthorized { t.Fatalf("logout did not revoke session: %d", afterLogout.StatusCode) }
```

- [ ] **Step 2: Complete the journey and write the operator guide.** Include an example that sources the admin password from a secret manager or environment variable rather than placing a literal password in shell history. Add the guide to the docs navigation. Run `make docs-gen` so new HTTP routes are reflected in the generated reference.

```markdown
1. Create an account with `authserver admin user create --role admin`.
2. Open `/admin/ui/` and sign in with the account email and password.
3. Keep `AUTHPLANE_ADMIN_API_KEY` for non-browser automation and emergency access.
```

- [ ] **Step 3: Run the release gate.** `make ci-local`, `make test-integration`, `make test-integration-postgres`, `make test-race`, `make docs-check`, `npm test`, `npm run build`, and an isolated browser smoke test. If a command cannot run in the host environment, run it in the Go 1.26 Docker environment and record the exact substitute. Do not push with a failing relevant gate.
- [ ] **Step 4: Commit and review.** `git add docs api/admin/admin_login_test.go web/admin/dist/index.html && git commit -m "docs: explain admin account bootstrap and recovery"`; inspect `git diff origin/main...HEAD`, verify the worktree is clean, and report the local branch and test results. Pushing or opening a PR requires a separate user request.
