# Confidential-client PKCE Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** General OAuth2 compatibility for confidential clients without individual PKCE exceptions.

**Architecture:** One predicate shared by authorization, token exchange and replay handling determines whether registered client credentials permit omitting PKCE. Supplied PKCE remains enforced.

**Tech Stack:** Existing Go services, SQLite integration tests, generated Markdown docs, Docker deployment.

**Spec:** docs/superpowers/specs/2026-11-14-confidential-client-pkce-design.md

## Global Constraints

Public clients require S256 PKCE. Confidential clients must authenticate using their registered secret. Preserve all other grant checks and the UserInfo username map. Do not push the separate integration repository.

## Review Focus

- Registration source cannot accidentally retain the former allowlist restriction.
- Missing PKCE must not bypass secret verification or active-client checks.
- Supplied challenges must never be downgraded.
- Resource-bound grants must preserve audience and requested-resource checks.
- Replaying a spent unchallenged code without the client secret cannot revoke its family.

## Task 1: General policy and regression coverage

- [x] Add failing authorization/token/HTTP tests for confidential clients without allowlisting, Basic/Form Post, DCR/admin and resource grants; retain negative public/credential/PKCE/resource cases.
- [x] Run focused integration tests and observe expected failures.
- [x] Replace `allowsOAuth2Login` with `allowsAuthorizationWithoutPKCE(*client.Client) bool`; remove allowlist config and wiring; preserve supplied-PKCE and replay guards.
- [x] Update integration guidance and regenerate reference docs with `make docs-gen`.
- [x] Run focused tests, repository CI and review the resulting diff.

## Task 2: Release

- [ ] Commit/push AuthPlane branch, build Linux binary using Go1.27.4.
- [ ] Back up deployment and remove obsolete allowlist from runtime YAML while retaining usernames.
- [ ] Deploy a versioned image with automatic rollback and check identity/key/credential preservation.
- [ ] Run online confidential no-PKCE smoke and public rejection probe; update local deployment image record.

## Verified implementation

Focused tests demonstrated the old allowlist restriction before the change and passed afterward. Independent review found callback-removal redemption and duplicate-verifier ambiguity; both were reproduced by failing tests and fixed. Final `make ci-local`, SQLite adapter/service/API integration tests, focused race tests and docs generation/link checks passed. A separate Go1.27.4 reachable-vulnerability scan found zero reachable vulnerabilities; CI's older Go1.26.6 scan reported standard-library advisories. No dependencies or database schemas changed.

Basic/Form Post transport selection and challenged-code replay retain their baseline behavior. The client-secret replay guarantee applies to unchallenged codes. The removed allowlist must also be removed from deployment YAML; the username map is retained.
