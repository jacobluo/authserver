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
