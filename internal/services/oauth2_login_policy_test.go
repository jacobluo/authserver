package services

import (
	"testing"

	"github.com/authplane/authserver/internal/domain/client"
)

func TestAllowsOAuth2Login(t *testing.T) {
	for _, mode := range []string{"allowed", "not listed", "public", "DCR", "no auth", "suspended", "different callback", "http callback", "other scope", "extra scope", "MCP resource", "not code"} {
		t.Run(mode, func(t *testing.T) {
			c := &client.Client{ID: "oneid-client", SecretHash: "present", Status: client.StatusActive, RegistrationSource: client.SourceAdmin, GrantTypes: []string{"authorization_code"}, RedirectURIs: []string{"https://idp.example.com/callback"}, TokenEndpointAuthMethod: "client_secret_post"}
			ids := []string{c.ID}
			redirect := "https://idp.example.com/callback"
			scope := "oneid:login"
			resource := ""
			switch mode {
			case "not listed":
				ids = []string{"other"}
			case "public":
				c.SecretHash = ""
			case "DCR":
				c.RegistrationSource = client.SourceDCR
			case "no auth":
				c.TokenEndpointAuthMethod = "none"
			case "suspended":
				c.Status = client.StatusSuspended
			case "different callback":
				redirect += "?other=1"
			case "http callback":
				redirect = "http://idp.example.com/callback"
				c.RedirectURIs = []string{redirect}
			case "other scope":
				scope = "mcp:tools"
			case "extra scope":
				scope = "oneid:login mcp:tools"
			case "MCP resource":
				resource = "https://mcp.example.com"
			case "not code":
				c.GrantTypes = []string{"client_credentials"}
			}
			if got := allowsOAuth2Login(c, ids, redirect, scope, resource); got != (mode == "allowed") {
				t.Fatalf("allowed=%v for %s", got, mode)
			}
		})
	}
}
