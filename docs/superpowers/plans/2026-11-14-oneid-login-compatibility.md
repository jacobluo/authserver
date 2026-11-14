# OneID login compatibility implementation and verification

**Spec:** `docs/superpowers/specs/2026-11-14-oneid-login-compatibility.md`

## Evidence and authorization

The real OneID browser requests at 11:13 +08:00 omitted both PKCE fields. A matching request without PKCE returned an authorization error with no code; the same request with S256 reached AuthPlane's login page. The user explicitly approved a no-PKCE exception for this confidential OneID client only. The username-to-subject association was confirmed against the existing administrator-maintained bridge mapping and an active local AuthPlane account.

## Implementation

- Configurable, startup-copied preferred-username mapping keyed by stable local subject; unmapped accounts omit the login-name claim when the mapping is configured.
- Explicit confidential-client allowlist shared by authorization and code exchange. Require active admin-created secret-authenticated client, authorization-code grant, exact HTTPS callback, only `oneid:login`, and no resource.
- Preserve S256 verification whenever a challenge exists; refuse partial or duplicated PKCE/resource parameters and malformed queries. Keep authorization codes single-use and authenticate the client secret before minting.
- Refuse credentials supplied only in URL query parameters. Authenticate a legacy replay before allowing it to revoke its grant.
- Reject Unicode case-fold username collisions. Use synthetic identities in source tests; real mapping and credentials remain deployment configuration.

## Review and regression tests

Independent review identified duplicate-query challenge downgrade, URL-query credential acceptance and Unicode username collisions. Each was reproduced by a failing test and corrected. Tests also cover empty/unmapped username maps, copied configuration, PKCE default behavior, the complete allowlisted OAuth2 code/refresh/revoke flow, client/scope/resource admission boundaries, wrong/missing secrets, challenge downgrade and credential-gated replay.

The native executable smoke test uses an isolated database and restarts with the actual YAML configuration model, proving that an explicit username mapping and a secret-authenticated code flow without PKCE work through the executable's wiring. Full CI, Go 1.27.4 integration/race checks, regenerated reference documentation and reachable-vulnerability scanning run before publication. Deployment uses a backed-up versioned image and configuration, followed by public no-PKCE verification. The mapped user's actual OneID sign-in still needs that user's login/password and matching OneID field configuration.
