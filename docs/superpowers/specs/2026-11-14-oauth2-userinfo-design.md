# OAuth2 user information endpoint

Add a bearer-protected user information endpoint so the existing WorkBuddy OneID OAuth2 source can retrieve the signed-in account after exchanging an authorization code. The existing client uses `client_secret_post`, PKCE S256, and scope `oneid:login`.

## Approach and scope

Implement the endpoint in AuthPlane's existing HTTP/port/service layers. An external bridge would introduce another service and key-validation path; implementing a full OIDC provider would exceed this request. Keep the existing OAuth issuance behavior and administrator customizations.

`GET /oauth/userinfo` is canonical; `GET /userinfo` is an alias. Accept only `Authorization: Bearer <access_token>`. Require the token's issuer and sole audience to equal the authorization-server issuer: clients obtain this audience by omitting the OAuth `resource` parameter. Require the JTI to resolve to an active direct OAuth token family with a matching user and client and no resource binding. Require the existing `oneid:login` scope on both grant and token, an active issuing client with the authorization-code grant, and an active subject user. Authenticate and check revocation before reporting insufficient scope. Reject machine, delegated, DPoP-bound, expired, invalid, or revoked tokens. Storage/key failures fail closed. Read current users and clients from uncached stores.

Return `sub` (stable user ID), `name`, `email`, and `preferred_username` (the account email/login name); omit unavailable optional fields. Do not invent email verification or phone claims. Prefer preprovisioned stable-subject account association; email association requires an identity source that verifies and continually controls email ownership. The existing jump-wb username mapping is separate and is not reused implicitly.

Responses are JSON and `Cache-Control: no-store`; invalid tokens return 401 with a Bearer challenge, insufficient scope returns 403, and infrastructure failures return 503 without token or user details. This addition does not claim OIDC provider support or add `openid`, `profile`, `email`, or `phone` scopes.

## Validation and delivery

Use real signed JWTs and SQLite integration tests for transport, claims, audience, scope, revocation, machine-token exclusion, account/client state and infrastructure failures. Exercise a complete authorization-code + PKCE flow. Regenerate HTTP/OpenAPI documentation from source, then run integration, build, lint, import-boundary and unit checks. The user initially requested local-only delivery, then explicitly authorized pushing the feature branch and deploying the existing test instance. Back up the database/configuration and retain the rollback image before deployment. Use Go 1.27.4 and the x/net v0.60.0 security patch for the deployment build. Report the remaining OneID-side PKCE compatibility requirement.
