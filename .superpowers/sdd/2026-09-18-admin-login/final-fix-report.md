# Final fix report: preserve administrator email lookup spelling

## Scope and result

Fixed the final whole-branch review finding in `api/admin/admin_login.go`.
The HTTP handler now trims the submitted email for the authentication lookup
without case-folding it. It derives a separate lowercased `lockoutKey` for
`LockedUntil`, `RecordFailure`, and `Reset`.

This preserves the existing case-insensitive lockout bucket while respecting
the case-sensitive user-store lookup contract. It does not merge or otherwise
case-fold case-distinct stored identities.

## Changed files

- `api/admin/admin_login.go`
  - Passes the trimmed submitted spelling to `AdminLoginPort.Login`.
  - Uses a separately lowercased value only for lockout operations.
- `api/admin/admin_login_test.go`
  - Adds `TestAdminAccountLogin_ExistingMixedCaseEmail`, a real HTTP journey
    that creates `Operator@Example.test` through `AdminService` and logs in
    with that exact spelling.
  - Updates the pre-existing cookie test to cover whitespace trimming without
    asserting that a different-cased email may authenticate as another stored
    identity.

No generated documentation, frontend bundle, or unrelated files changed.

## TDD evidence

The new regression test was written before the production change. It catches
the production mistake of lowercasing the email argument passed to the login
service; its expected identity values are literal HTTP response values.

### RED

Command:

```sh
docker run --rm -v "$PWD":/src -w /src -v authserver-gomodcache:/go/pkg/mod -v authserver-gocache:/root/.cache/go golang:1.26-alpine go test -tags=integration ./api/admin -run '^TestAdminAccountLogin_ExistingMixedCaseEmail$' -count=1 -v
```

Output:

```text
=== RUN   TestAdminAccountLogin_ExistingMixedCaseEmail
    admin_login_test.go:198: exact stored mixed-case email login: 401 {"detail":"login denied","status":401,"title":"Unauthorized","type":"about:blank"}
--- FAIL: TestAdminAccountLogin_ExistingMixedCaseEmail (0.39s)
FAIL
FAIL    github.com/authplane/authserver/api/admin  0.390s
FAIL
```

### GREEN: focused HTTP journeys

Command:

```sh
docker run --rm -v "$PWD":/src -w /src -v authserver-gomodcache:/go/pkg/mod -v authserver-gocache:/root/.cache/go golang:1.26-alpine go test -tags=integration ./api/admin -run '^(TestAdminAccountLogin_ExistingMixedCaseEmail|TestAdminAccountJourney|TestAdminAccountLogin_CookieAndMeAndLogout)$' -count=1 -v
```

Output:

```text
=== RUN   TestAdminAccountJourney
--- PASS: TestAdminAccountJourney (0.56s)
=== RUN   TestAdminAccountLogin_ExistingMixedCaseEmail
--- PASS: TestAdminAccountLogin_ExistingMixedCaseEmail (0.38s)
=== RUN   TestAdminAccountLogin_CookieAndMeAndLogout
=== RUN   TestAdminAccountLogin_CookieAndMeAndLogout/http
=== RUN   TestAdminAccountLogin_CookieAndMeAndLogout/https
--- PASS: TestAdminAccountLogin_CookieAndMeAndLogout (0.74s)
PASS
ok      github.com/authplane/authserver/api/admin  1.679s
```

### GREEN: account-login service coverage

Command:

```sh
docker run --rm -v "$PWD":/src -w /src -v authserver-gomodcache:/go/pkg/mod -v authserver-gocache:/root/.cache/go golang:1.26-alpine go test -tags=integration ./internal/services -run '^TestAdminLogin_' -count=1 -v
```

Output:

```text
PASS
ok      github.com/authplane/authserver/internal/services  3.207s
```

### GREEN: complete admin integration package

Command:

```sh
docker run --rm -v "$PWD":/src -w /src -v authserver-gomodcache:/go/pkg/mod -v authserver-gocache:/root/.cache/go golang:1.26-alpine go test -tags=integration ./api/admin -count=1
```

Output:

```text
ok      github.com/authplane/authserver/api/admin  6.752s
```

### Diff validation

Command:

```sh
git diff --check
```

Output: exit 0; no whitespace errors.

## Self-review

- The lookup argument is no longer lowercased, so a legacy mixed-case record
  can authenticate only with its own stored spelling (apart from surrounding
  whitespace trimming).
- All three lockout interactions use `lockoutKey`, retaining case-insensitive
  lockout behavior and the existing case-variant lockout test intent.
- The regression is HTTP-level and uses real SQLite-backed stores and real
  login services; it would fail if the handler again case-folded its lookup.
- The changed cookie test no longer encodes the prohibited cross-identity
  case-folding behavior, but still verifies whitespace normalization.

## Concerns

None for this scoped change. Case-distinct persisted identities remain
distinct for authentication; they continue to share a normalized lockout key,
as required by the existing lockout policy.
