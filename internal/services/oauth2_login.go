package services

import (
	"slices"

	"github.com/authplane/authserver/internal/domain/client"
)

// allowsAuthorizationWithoutPKCE permits OAuth2 authorization-code clients
// that authenticate using a registered secret. Public clients still require
// PKCE. Token exchange must authenticate the client before using this policy.
func allowsAuthorizationWithoutPKCE(c *client.Client) bool {
	return c != nil && c.IsActive() && !c.IsPublic() &&
		(c.TokenEndpointAuthMethod == "client_secret_post" || c.TokenEndpointAuthMethod == "client_secret_basic") &&
		slices.Contains(c.GrantTypes, "authorization_code")
}
