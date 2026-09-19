package admin

import (
	"context"
	"crypto/subtle"
	"errors"
	"net/http"
	"strings"

	"github.com/authplane/authserver/internal/ports/input"
)

// AuthWrapper wraps an HTTP handler with an auth gate. *apiKeyMiddleware
// satisfies it; an alternative strategy can be injected via OptionalDeps.Auth.
type AuthWrapper interface {
	Wrap(http.Handler) http.Handler
}

// apiKeyMiddleware validates the API key on every request.
type apiKeyMiddleware struct {
	key []byte
}

func newAPIKeyMiddleware(key string) *apiKeyMiddleware {
	return &apiKeyMiddleware{key: []byte(key)}
}

// Wrap returns a handler that requires a valid API key.
func (m *apiKeyMiddleware) Wrap(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Reject all requests when no API key is configured.
		if len(m.key) == 0 {
			w.Header().Set("WWW-Authenticate", `Bearer realm="admin"`)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"error":"unauthorized","error_description":"admin API key not configured"}`))
			return
		}

		token := extractBearerToken(r)
		if token == "" {
			w.Header().Set("WWW-Authenticate", `Bearer realm="admin"`)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"error":"unauthorized","error_description":"missing API key"}`))
			return
		}

		if subtle.ConstantTimeCompare(m.key, []byte(token)) != 1 {
			w.Header().Set("WWW-Authenticate", `Bearer realm="admin"`)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"error":"unauthorized","error_description":"invalid API key"}`))
			return
		}

		next.ServeHTTP(w, r)
	})
}

func extractBearerToken(r *http.Request) string {
	auth := r.Header.Get("Authorization")
	if !strings.HasPrefix(auth, "Bearer ") {
		return ""
	}
	return auth[7:]
}

type adminAccountContextKey struct{}

// accountMiddleware preserves the API-key gate's validation semantics and
// adds session authentication only when no Authorization header is present.
type accountMiddleware struct {
	apiKey AuthWrapper
	login  input.AdminLoginPort
}

func (m *accountMiddleware) Wrap(next http.Handler) http.Handler {
	keyHandler := m.apiKey.Wrap(next)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if len(r.Header.Values("Authorization")) > 0 {
			keyHandler.ServeHTTP(w, r)
			return
		}
		cookie, err := r.Cookie(adminSessionCookie)
		if err != nil || cookie.Value == "" {
			writeAdminError(w, http.StatusUnauthorized, "authentication required")
			return
		}
		account, err := m.login.Current(r.Context(), cookie.Value)
		if errors.Is(err, input.ErrAdminSessionInvalid) {
			writeAdminError(w, http.StatusUnauthorized, "authentication required")
			return
		}
		if err != nil || account == nil {
			writeAdminError(w, http.StatusInternalServerError, "internal error")
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead && r.Method != http.MethodOptions &&
			(account.CSRFToken == "" || subtle.ConstantTimeCompare([]byte(r.Header.Get("X-Admin-CSRF")), []byte(account.CSRFToken)) != 1) {
			writeAdminError(w, http.StatusForbidden, "CSRF token required")
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), adminAccountContextKey{}, account)))
	})
}
