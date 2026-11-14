# OAuth2 UserInfo verification — 2026-11-14

Branch: `codex/oauth2-userinfo`, based on `ad4ffa05a7001bcf8c48a531724685f25e156c9a`. Initial delivery was local only; the user subsequently authorized pushing the branch and deploying the existing test instance. Publication and deployment results are recorded separately after verification.

## Passed

- Focused HTTP tests: `go test -tags=integration ./api/public -run '^TestUserInfo_' -count=1 -v` — 33 test/subtest entries.
- Focused race check: `go test -race -tags=integration ./api/public -run '^TestUserInfo_' -count=1`.
- Integration: `go test -tags=integration ./internal/adapters/... ./internal/services/... ./api/... -count=1`.
- Default suite: `go test ./...`.
- Documentation generation: `make docs-gen`; generator tests: `go test ./tools/docsgen/...`.
- Import boundaries: `make check-imports`; unit tests: `make test-unit`.
- Native build: `make build`; Linux amd64 cross-build with `CGO_ENABLED=0`.
- Changed-code lint: `GOTOOLCHAIN=go1.26.6 /tmp/authplane-userinfo-tools/golangci-lint run --new-from-rev=ad4ffa05a7001bcf8c48a531724685f25e156c9a ./...` — zero issues. The full lint scan contains only the existing issues below.
- A local smoke test started the real executable with fresh signing keys, an isolated SQLite database, a disposable user/client, and loopback-only listeners. Browser login, consent, form-post client authentication, authorization-code + PKCE S256, both profile routes, missing/invalid/query tokens and grant revocation all passed. The process shut down cleanly.

## Release preparation

- Fixed the existing lint findings with a scoped translation-catalog false-positive annotation, an unshadowed test error variable, and explicit request contexts in tests. Full `make ci-local` now passes with the pinned native lint tool under Go 1.26.6. The earlier five reported issues were output-limited; removing that limit exposed four additional occurrences of the same test-context issue, also corrected.
- The deployment executable uses Go 1.27.4. Scanning this toolchain exposed five reachable advisories in the existing `golang.org/x/net` v0.58.0 dependency. Updated only that module to the reported fixed version v0.60.0; `go.mod`'s minimum Go version and other dependencies remain unchanged.
- Go 1.27.4 plus the patched module: `govulncheck ./...` reports zero reachable vulnerabilities; three required-module findings remain on uncalled code paths.
- Repeated the adapter/service/API integration suite using Go 1.27.4 after the dependency update; it passed.

## Earlier check failures and remaining limits

- The earlier full-lint failures and reachable build-toolchain/dependency findings described above have been addressed for this release. The repository's CI run under Go 1.26.6 still reports standard-library advisories as warnings under its existing policy; that toolchain is not used for the deployment executable.
- The cached repository lint binary was not executable on this host. The pinned v2.11.4 tool was built for this host outside the repository, and analysis was run with Go 1.26.6 to match its supported toolchain.
- Live PostgreSQL integration tests were not run because local Docker is unavailable. The PostgreSQL adapter compiles; the real endpoint and provenance lookup were exercised with SQLite, matching the current deployment's storage backend.
- OneID end-to-end testing remains pending deployment and OneID configuration. PKCE S256 remains mandatory. Filling UserInfo alone cannot make a client that omits PKCE compatible.
- Generated Markdown uses intentional trailing two-space hard breaks. These are retained in generated references.

Local smoke inputs, keys, database and logs are inside the OAuth workspace's ignored `.run/userinfo-20261114/` directory, not source files for submission.

## Publication and deployment

- Published source commit `c54c15c7711aa7eaed9761fbb67ee9a22bb2b7ed` to `origin/codex/oauth2-userinfo` in `jacobluo/authserver`.
- Deployed `authplane/authserver:fork-userinfo-20261114` to the existing `oauth.mvp100.cn` test instance. The image uses the existing runtime image with the newly built Go 1.27.4 executable; its revision label identifies the source commit.
- Executable SHA-256: `152b97746335850b13776774e75f22993dcb9075227be5b220a7d83f7cfb1839`.
- Backed up the SQLite database, signing keys, Compose file and environment before deployment. The database backup passed `PRAGMA integrity_check`. Verified the user/client/resource records, key files, application configuration and credentials were unchanged by the image switch.
- Public HTTPS verification passed using the dedicated existing OneID OAuth2 client: browser login and consent, authorization-code + PKCE S256, form-post credentials, both UserInfo paths returning the expected four profile fields, refresh, and rejection of both access tokens after refresh-family revocation. Missing/invalid tokens returned 401; query-string tokens returned 400.
- The smoke test parsed the registered OneID callback without following it. This verifies the deployed AuthPlane endpoints, not a full login initiated by OneID. OneID must still be configured to send PKCE S256.
- The server retains the previous image and a protected backup with a rollback script. Deployment and online-smoke manifests are saved under the OAuth workspace's ignored `.run/userinfo-20261114/` directory.
