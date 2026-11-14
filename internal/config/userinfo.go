package config

import (
	"errors"
	"strings"
	"unicode"

	"golang.org/x/text/cases"
)

func (c UserInfoConfig) validate() []error {
	seen := make(map[string]bool, len(c.PreferredUsernames))
	for subject, username := range c.PreferredUsernames {
		if subject == "" || username == "" || len(subject) > 256 || len(username) > 256 ||
			strings.TrimSpace(subject) != subject || strings.TrimSpace(username) != username ||
			strings.ContainsFunc(subject, unicode.IsControl) || strings.ContainsFunc(username, unicode.IsControl) {
			return []error{errors.New("userinfo.preferred_usernames requires nonempty subjects and login names of at most 256 bytes, without surrounding whitespace or control characters")}
		}
		key := cases.Fold().String(username)
		if seen[key] {
			return []error{errors.New("userinfo.preferred_usernames cannot assign the same login name to multiple subjects")}
		}
		seen[key] = true
	}
	return nil
}

func (c OAuthConfig) validateLoginClients() []error {
	seen := make(map[string]bool, len(c.ConfidentialLoginClientsWithoutPKCE))
	for _, id := range c.ConfidentialLoginClientsWithoutPKCE {
		if id == "" || len(id) > 256 || strings.TrimSpace(id) != id || strings.ContainsFunc(id, unicode.IsControl) || seen[id] {
			return []error{errors.New("oauth.confidential_login_clients_without_pkce requires distinct nonempty client IDs without surrounding whitespace or control characters")}
		}
		seen[id] = true
	}
	return nil
}
