package services

import (
	"net/url"
	"slices"
	"strings"

	"github.com/authplane/authserver/internal/domain/client"
	"github.com/authplane/authserver/internal/ports/input"
)

// allowsOAuth2Login is a narrow compatibility exception for explicitly
// approved confidential login clients. It cannot authorize an MCP resource,
// dynamically registered client, public client, or a different redirect URI.
func allowsOAuth2Login(c *client.Client, ids []string, redirectURI, scope, resource string) bool {
	if c == nil || !slices.Contains(ids, c.ID) || !c.IsActive() || c.IsPublic() || c.RegistrationSource != client.SourceAdmin ||
		(c.TokenEndpointAuthMethod != "client_secret_post" && c.TokenEndpointAuthMethod != "client_secret_basic") ||
		!slices.Contains(c.GrantTypes, "authorization_code") || !slices.Contains(c.RedirectURIs, redirectURI) || resource != "" {
		return false
	}
	scopes := strings.Fields(scope)
	if len(scopes) != 1 || scopes[0] != input.UserInfoScope {
		return false
	}
	u, err := url.Parse(redirectURI)
	return err == nil && u.Scheme == "https" && u.Hostname() != "" && u.User == nil && u.Fragment == ""
}

// WithOAuth2LoginClients installs the boot-time allowlist before requests run.
func (s *AuthorizeService) WithOAuth2LoginClients(ids []string) {
	s.oauth2LoginClients = slices.Clone(ids)
}

// WithOAuth2LoginClients must use the same allowlist as AuthorizeService.
func (s *TokenService) WithOAuth2LoginClients(ids []string) { s.oauth2LoginClients = slices.Clone(ids) }
