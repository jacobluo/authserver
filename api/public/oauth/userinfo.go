package oauth

import (
	"errors"
	"net/http"
	"strings"

	"github.com/authplane/authserver/api/shared"
	"github.com/authplane/authserver/internal/observability"
	"github.com/authplane/authserver/internal/ports/input"
)

type userInfoHandler struct {
	userinfo input.UserInfoPort
	obs      *observability.Provider
}

func (h *userInfoHandler) handleUserInfo(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Pragma", "no-cache")
	if r.URL.Query().Has("access_token") {
		shared.WriteOAuthError(w, http.StatusBadRequest, "invalid_request", "send the access token only in the Authorization header")
		return
	}
	raw := shared.ExtractBearerToken(r)
	if len(r.Header.Values("Authorization")) != 1 || raw == "" || len(raw) > 32768 || strings.ContainsAny(raw, " \t\r\n,") {
		w.Header().Set("WWW-Authenticate", `Bearer realm="userinfo"`)
		shared.WriteOAuthError(w, http.StatusUnauthorized, "invalid_token", "a Bearer access token is required")
		return
	}
	profile, err := h.userinfo.UserInfo(r.Context(), raw)
	switch {
	case errors.Is(err, input.ErrUserInfoInvalidToken):
		w.Header().Set("WWW-Authenticate", `Bearer realm="userinfo", error="invalid_token"`)
		shared.WriteOAuthError(w, http.StatusUnauthorized, "invalid_token", "invalid or inactive login token")
	case errors.Is(err, input.ErrUserInfoInsufficientScope):
		w.Header().Set("WWW-Authenticate", `Bearer realm="userinfo", error="insufficient_scope", scope="`+input.UserInfoScope+`"`)
		shared.WriteOAuthError(w, http.StatusForbidden, "insufficient_scope", "the oneid:login scope is required")
	case err != nil || profile == nil:
		h.obs.Logger.ErrorContext(r.Context(), "userinfo unavailable")
		shared.WriteOAuthError(w, http.StatusServiceUnavailable, "temporarily_unavailable", "user information is temporarily unavailable")
	default:
		shared.WriteJSON(w, http.StatusOK, userInfoResponse{Subject: profile.Subject, Name: profile.Name, Email: profile.Email, PreferredUsername: profile.PreferredUsername})
	}
}
