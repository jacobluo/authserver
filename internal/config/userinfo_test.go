package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadUserInfoPreferredUsernames(t *testing.T) {
	p := filepath.Join(t.TempDir(), "config.yaml")
	if err := os.WriteFile(p, []byte("userinfo:\n  preferred_usernames:\n    local-user-id: ExampleMember\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	cfg, err := Load(p)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.UserInfo.PreferredUsernames["local-user-id"] != "ExampleMember" {
		t.Fatal("username mapping was not loaded")
	}
}

func TestValidateUserInfoPreferredUsernames(t *testing.T) {
	for _, names := range []map[string]string{
		{"": "ExampleMember"}, {" user-id": "ExampleMember"}, {"user-id": ""}, {"user-id": " ExampleMember"}, {"user-id": "Example\nMember"},
		{"user-1": "ExampleMember", "user-2": "examplemember"}, {strings.Repeat("x", 257): "ExampleMember"}, {"user-id": strings.Repeat("x", 257)},
		{"user-1": "Σ", "user-2": "ς"}, {"user-1": "S", "user-2": "ſ"},
	} {
		cfg := DefaultConfig()
		cfg.UserInfo.PreferredUsernames = names
		if err := cfg.Validate(); err == nil || !strings.Contains(err.Error(), "userinfo.preferred_usernames") {
			t.Fatalf("invalid mapping accepted: %v err=%v", names, err)
		}
	}
}

func TestValidateConfidentialLoginClients(t *testing.T) {
	for _, ids := range [][]string{{""}, {" client"}, {"client\n"}, {"client", "client"}, {strings.Repeat("x", 257)}} {
		cfg := DefaultConfig()
		cfg.OAuth.ConfidentialLoginClientsWithoutPKCE = ids
		if err := cfg.Validate(); err == nil || !strings.Contains(err.Error(), "oauth.confidential_login_clients_without_pkce") {
			t.Fatalf("invalid allowlist accepted: %v err=%v", ids, err)
		}
	}
	cfg := DefaultConfig()
	cfg.OAuth.ConfidentialLoginClientsWithoutPKCE = []string{"approved-client"}
	if err := cfg.Validate(); err != nil {
		t.Fatal(err)
	}
}
