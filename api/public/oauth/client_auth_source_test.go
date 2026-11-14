package oauth

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestClientAuthIgnoresQueryCredentials(t *testing.T) {
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/oauth/token?client_id=query-client&client_secret=query-secret", strings.NewReader("grant_type=authorization_code&code=test-code"))
	r.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	id, secret := ExtractClientAuth(r)
	if id != "" || secret != "" {
		t.Fatal("URL query credentials were accepted")
	}
}
