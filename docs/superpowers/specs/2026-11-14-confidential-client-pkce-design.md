# General confidential-client OAuth2 compatibility

The user requests removing the per-client PKCE exception in favor of a general rule for OAuth2 integrations. The implementation choice is to permit omission of PKCE for active confidential authorization-code clients using Basic or Form Post authentication, regardless of client ID, registration source, scope or resource. Public clients continue to require S256 PKCE.

## Approach

Replace the OneID allowlist with a shared predicate on registered client credentials and authentication method. A universal PKCE disablement would leave public clients without proof for redeeming a code; retaining an allowlist would not satisfy the requested general policy. Existing redirect, grant, consent, scope/resource, user, expiry, one-time-code and client-secret checks remain in force. Supplied PKCE parameters must always be verified, and partial/malformed/duplicate requests remain rejected.

Remove the now-obsolete `oauth.confidential_login_clients_without_pkce` startup configuration and service wiring. Preserve the separate UserInfo username map. Treat this as OAuth2 compatibility, without claiming strict OAuth2.1 compliance for requests omitting PKCE.

## Verification and release

Exercise admin and DCR confidential clients with Basic and Form Post without an allowlist, including resource-bound grants. Verify missing/wrong secrets, public clients, mismatched redirects/resources, partial PKCE, omitted verifiers for challenged codes, and replay handling. Run repository CI, then push the existing fork branch and deploy with a protected backup and rollback. Keep the integration repository local.

## Review decisions

Registered Basic/Form Post clients retain the existing support for either secret transport. This change does not introduce exact transport matching. Challenged-code replay retains the existing verifier-and-client-ID proof; secret-gated replay applies to unchallenged codes. Unchallenged redemption and replay also check the callback against current client registration. Duplicate authorization-code parameters are rejected before consuming a code.
