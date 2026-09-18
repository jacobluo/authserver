# Admin account login and recovery

The Admin UI at `/admin/ui/` opens with email and password login. Only an existing, active **local** user with role `admin` can sign in. Bootstrap the first account with the CLI; the login page does not offer registration. Ordinary OAuth login sessions and federated accounts do not grant admin access.

## Bootstrap an administrator

Run the CLI in the deployed server's environment, with the same database configuration and access to that database. The CLI opens the configured store directly; it does not log in through the Admin UI. See the [configuration reference](../../reference/configuration.md) and the exact [user-create flags](../../reference/cli.md#cli-admin-user-create).

Have your secret manager inject `ADMIN_BOOTSTRAP_PASSWORD` into the shell environment, then run:

```bash
set +x
: "${ADMIN_BOOTSTRAP_PASSWORD:?Inject the admin password from your secret manager}"
authserver admin user create \
  --email operator@example.com \
  --password "$ADMIN_BOOTSTRAP_PASSWORD" \
  --name "Operations" \
  --role admin
unset ADMIN_BOOTSTRAP_PASSWORD
```

This avoids a literal password in shell history. The expanded flag can still appear in process arguments, so run it on a trusted host and keep shell tracing off. Use a lowercase email address and save the password in your team's secret manager.

Open `/admin/ui/` on the admin host and sign in with that email and password. You can now create users and manage resources through the UI. Keep `AUTHPLANE_ADMIN_API_KEY` in a secret store for non-browser automation and emergency access.

## Cookie and CSRF behavior

Successful [login](../../reference/http-api.md) sets `authplane_admin_session`: an HttpOnly Cookie, scoped to `/admin`, with `SameSite=Strict`. It expires eight hours after login; activity does not extend that deadline. The session is stored server-side, and current role and status are checked on requests. Disabling or demoting the account prevents further account access.

The login response and `GET /admin/auth/me` return the account identity, `csrf_token`, and `expires_at`. For Cookie-authenticated writes, send the token in `X-Admin-CSRF`; the UI handles this automatically. `POST /admin/auth/logout` requires both the Cookie and this header, revokes the stored session, and clears the Cookie. Replaying the old Cookie is rejected. If logout fails, retry it; closing the page does not revoke the session.

Account login requires `Content-Type: application/json` and an `Origin` matching the admin host and configured scheme. `GET /admin/auth/me` and logout require an account Cookie; an API key alone cannot access those account endpoints. Business routes accept either account authentication or `Authorization: Bearer <AUTHPLANE_ADMIN_API_KEY>`. API-key requests do not require CSRF. An explicitly supplied Authorization header takes priority; an invalid or empty header never falls back to the Cookie.

## API Key fallback and recovery

Choose **Use API Key** on the login page for emergency UI access. The UI keeps the key in memory; reloading requires entering it again. Account login uses the HttpOnly Cookie and does not store credentials in browser storage.

If an account password is lost or the account is unavailable, use the CLI bootstrap command with a new email to create a replacement local admin. Alternatively, use the retained API key with `POST /admin/users` and the fields documented in the [HTTP reference](../../reference/http-api.md). Sign in with the replacement account before retiring the old account. The [CLI](../../reference/cli.md#cli-admin-user-update) has no password-reset flag; do not invent one. OAuth token force-logout is not the admin account logout endpoint.

If the API key is also lost, an operator with access to the deployment configuration can rotate `AUTHPLANE_ADMIN_API_KEY` and restart the server, or bootstrap a replacement account through the CLI's database access. There is no public account-recovery or registration endpoint.

## Secure deployment

Keep the admin listener (default `:9001`) behind a VPN, an internal load balancer with source restrictions, or an mTLS gateway. Use HTTPS and set [`AUTHPLANE_SESSION_SECURE=true`](../../reference/env-vars.md), which also sets Secure on the admin Cookie. Plain HTTP development needs this setting off; a Secure Cookie will not work over ordinary HTTP.

When TLS terminates at a proxy, preserve the browser-facing Host and use the HTTPS secure setting so the login Origin check matches. Client-supplied forwarding headers do not determine the accepted origin. Keep the UI and admin API on the same origin and restrict direct access to the backend listener.

See the [Admin UI tour](admin-ui-tour.md), [Admin CLI guide](admin-cli.md), and [incident runbook](incident-runbook.md) for ongoing operations.
