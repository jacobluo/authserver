# OAuth2 UserInfo Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let WorkBuddy retrieve the current authenticated user's profile through OAuth2.

**Architecture:** Add a UserInfo input port and service using existing JWT verification and raw stores, inject it through the public OAuth routes, and document the canonical path and alias. Keep the current issuer-audience token flow and `oneid:login` scope.

**Tech Stack:** Go, net/http, existing go-jose JWT verification, SQLite integration tests.

**Spec:** `docs/superpowers/specs/2026-11-14-oauth2-userinfo-design.md`

## Global Constraints

- Preserve existing OAuth issuance, PKCE enforcement and admin customizations.
- No new dependencies, schema migrations, fabricated verification flags or phone data.
- Do not hand-edit generated reference documentation.

## Review Focus

- A token for another audience must not disclose a user profile.
- Machine, delegated and DPoP tokens must not become bearer login credentials.
- User/client disablement and revocation must take effect immediately.
- Dependency failures must return no profile or sensitive error detail.
- The HTTP endpoint must be wired in the real executable, not only tests.

## Task 1: Implement and verify the endpoint

**Files:** input/userinfo.go, services/userinfo.go, api/public/oauth/userinfo.go and dto.go/routes.go, api/public/server.go, cmd/authserver/serve.go, api/public/userinfo_test.go.

- [x] Add failing HTTP integration tests with real JWT signatures and stores, including the review-focus cases.
- [x] Run the tests and observe the missing endpoint/service failure.
- [x] Add the port, validation service, HTTP handler and production wiring.
- [x] Run the focused tests, existing integration suite and relevant build/lint/import/unit checks.

## Task 2: Document and validate locally

**Files:** tools/docsgen/cmd/http.go, generated references/OpenAPI, docs/guides/integrate/oauth2-userinfo.md, deployment record in the OAuth workspace.

- [x] Document authentication, scope, audience, claims and OneID field mapping; regenerate references.
- [x] Build the native and Linux amd64 executables.
- [x] Verify the real native executable using an isolated local SQLite database, including login, consent, authorization-code + PKCE, profile and revocation.
- [x] Complete the initially requested local delivery.
- [x] Push the tested feature branch and deploy the existing test instance, following the user's subsequent authorization.

## Review and verification record

The independent reviewer identified missing positive login-grant provenance, scope-error ordering, and trust requirements for email association. Regression tests reproduced all three authentication cases (untracked signed token, revoked family without blacklist, revoked token without login scope), then passed after adding a single-query JTI-to-family lookup and checking the active matching grant before scope. Both SQLite and PostgreSQL implement the lookup; no migrations or new dependency packages were added. JWKS/issuer dependency failures and alias documentation were also covered. Release preparation patches the existing x/net module to v0.60.0 and uses Go 1.27.4 to remove reachable advisory findings.

See [verification record](2026-11-14-oauth2-userinfo-verification.md) for commands, outcomes and existing check failures.
