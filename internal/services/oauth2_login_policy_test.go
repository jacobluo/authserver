package services

import (
	"testing"

	"github.com/authplane/authserver/internal/domain/client"
)

func TestAllowsAuthorizationWithoutPKCE(t *testing.T) {
	for _, tc := range []struct {
		mode string
		want bool
	}{
		{"basic", true}, {"post", true}, {"DCR", true}, {"CIMD", true},
		{"nil", false}, {"public", false}, {"none", false}, {"unknown method", false},
		{"suspended", false}, {"not code", false},
	} {
		t.Run(tc.mode, func(t *testing.T) {
			c := &client.Client{ID: "any-client", SecretHash: "present", Status: client.StatusActive, RegistrationSource: client.SourceAdmin, GrantTypes: []string{"authorization_code"}, TokenEndpointAuthMethod: "client_secret_basic"}
			switch tc.mode {
			case "post":
				c.TokenEndpointAuthMethod = "client_secret_post"
			case "DCR":
				c.RegistrationSource = client.SourceDCR
			case "CIMD":
				c.RegistrationSource = client.SourceCIMD
			case "nil":
				c = nil
			case "public":
				c.SecretHash = ""
			case "none":
				c.TokenEndpointAuthMethod = "none"
			case "unknown method":
				c.TokenEndpointAuthMethod = "unsupported"
			case "suspended":
				c.Status = client.StatusSuspended
			case "not code":
				c.GrantTypes = []string{"client_credentials"}
			}
			if got := allowsAuthorizationWithoutPKCE(c); got != tc.want {
				t.Fatalf("allowed=%v, want %v", got, tc.want)
			}
		})
	}
}
