# OAuth2 user information for OneID / WorkBuddy

AuthPlane provides `GET /oauth/userinfo` (alias `GET /userinfo`) for OAuth2 login consumers. This endpoint retrieves the current account profile; it does not turn AuthPlane into an OpenID Connect provider or issue ID tokens.

## Authentication

Send the access token in `Authorization: Bearer <access_token>`. Query-string, form-body and DPoP token transport are not supported. Require HTTPS outside localhost.

The token must be signed by this AuthPlane instance, unexpired and unrevoked, have scope `oneid:login`, and have the issuer URL as its **sole audience**. Omit `resource` in authorization, code-exchange and refresh requests to get this audience. Tokens addressed to MCP resources or jump-wb are rejected. The JTI must be tracked against an active direct OAuth grant matching its user and client. Both the grant and the token must carry the login scope. This grant check rejects exchange tokens even when they omit delegation claims, and preserves revocation if a family blacklist update failed. Machine/delegated tokens and DPoP-bound tokens are rejected. User and client state is read from uncached stores on each call.

## Response

```json
{
  "sub": "stable-authplane-user-id",
  "name": "Example User",
  "email": "user@example.com",
  "preferred_username": "user@example.com"
}
```

`sub` is the immutable local user ID. By default, `preferred_username` uses the email login name. An administrator can configure `userinfo.preferred_usernames` to map stable subjects to OneID login names. When the map is configured, unmapped accounts omit `preferred_username`, including when the configured map is empty. Mappings are copied at startup and must use unique login names under Unicode case folding. Optional fields without values are omitted. No phone number or email-verification claim is invented, and no password hash, role, provider subject or token is returned.

```yaml
userinfo:
  preferred_usernames:
    stable-local-user-subject: ExampleMember
```

Responses include `Cache-Control: no-store`. Invalid/missing Bearer tokens return 401 with a Bearer challenge; missing login scope returns 403. Dependency failures return 503 without a profile. This endpoint checks the existing JTI revocation store, including family revocations triggered by refresh-token logout; it does not change the behavior of `/oauth/revoke`.

## OneID settings for the existing deployment

| Setting | Value |
| --- | --- |
| Token endpoint authentication | Form Post (`client_secret_post`) |
| Authorization endpoint | `https://oauth.mvp100.cn/oauth/authorize` |
| Token endpoint | `https://oauth.mvp100.cn/oauth/token` |
| User information endpoint | `https://oauth.mvp100.cn/oauth/userinfo` |
| UserInfo token transport | Authorization request header |
| Scope | `oneid:login` |
| Authorization flow | Authorization code; S256 remains the default |

Keep the previously registered callback URI unchanged. The dedicated client credentials are stored outside the repository. Actual OneID requests may omit PKCE. To support such a source, explicitly allow its confidential client ID using the YAML-only `oauth.confidential_login_clients_without_pkce` configuration. This exception requires an active admin-created client with a secret and Basic/Form Post authentication, an exact registered HTTPS redirect, no resource, and exactly `oneid:login`. Public/DCR clients and MCP grants still require PKCE. If any challenge is supplied, S256 verification remains mandatory; partial or ambiguous PKCE requests are rejected. Client credentials must come from Basic authentication or the POST body, never the URL query.

```yaml
oauth:
  confidential_login_clients_without_pkce:
    - approved-confidential-client-id
```

Prefer a preprovisioned stable `sub` mapping for OneID account association. Automatic email matching is appropriate only when the identity source verifies email ownership and controls subsequent email changes. AuthPlane's federated-login path does not check `email_verified`, so an arbitrary upstream email is not proof of ownership. A one-time manual comparison does not establish continuing trust after future email changes. The separate jump-wb bridge's `preferred_username` mapping is not automatically reused. See [OneID association rules](https://identity.tencent.com/docs/guides/IDPconfig/standard/mapping/).

For an explicitly configured login-name mapping, select OAuth2 `user.preferred_username` to OneID `user.username` and keep unmatched users rejected. Maintain each subject-to-name entry explicitly rather than assigning a fixed login name to every authenticated user.
