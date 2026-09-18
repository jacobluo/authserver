package admin

import (
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/authplane/authserver/api/shared"
	"github.com/authplane/authserver/internal/domain/audit"
	"github.com/authplane/authserver/internal/ports/input"
)

const adminSessionCookie = "authplane_admin_session"

type adminLoginHandler struct {
	login   input.AdminLoginPort
	lockout *shared.AuthLockout
	secure  bool
	audit   AuditRecorder
}

type adminAccountResponse struct {
	ID        string    `json:"id"`
	Email     string    `json:"email"`
	Name      string    `json:"name"`
	CSRFToken string    `json:"csrf_token"`
	ExpiresAt time.Time `json:"expires_at"`
}

func writeAdminAccount(w http.ResponseWriter, a *input.AdminAccount) {
	w.Header().Set("Cache-Control", "no-store")
	shared.WriteJSON(w, http.StatusOK, adminAccountResponse{a.ID, a.Email, a.Name, a.CSRFToken, a.ExpiresAt})
}

func adminPeerIP(r *http.Request) string {
	ip, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return ip
}

func (h *adminLoginHandler) record(r *http.Request, action audit.Action, actor string) {
	if h.audit != nil {
		h.audit.Record(r.Context(), audit.NewEvent(action, actor, "", adminPeerIP(r), ""))
	}
}

func (h *adminLoginHandler) handleLogin(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	action, actor := audit.Action("admin.account.login.failure"), ""
	defer func() { h.record(r, action, actor) }()

	// Only the configured transport policy and direct Host establish this
	// origin. Forwarding headers supplied by a client are never authoritative.
	scheme := "http"
	if h.secure {
		scheme = "https"
	}
	origin := r.Header.Get("Origin")
	u, err := url.Parse(origin)
	if err != nil || u.Scheme != scheme || u.Host != r.Host || origin != scheme+"://"+r.Host {
		writeAdminError(w, http.StatusForbidden, "invalid origin")
		return
	}
	contentType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || contentType != "application/json" {
		writeAdminError(w, http.StatusUnsupportedMediaType, "application/json required")
		return
	}
	var body *struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 16*1024)
	decoder := json.NewDecoder(r.Body)
	if err := decoder.Decode(&body); err != nil || body == nil {
		writeAdminError(w, http.StatusBadRequest, "invalid request")
		return
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		writeAdminError(w, http.StatusBadRequest, "invalid request")
		return
	}
	email := strings.ToLower(strings.TrimSpace(body.Email))
	ip := adminPeerIP(r)
	if h.lockout != nil {
		if _, locked := h.lockout.LockedUntil(email, ip); locked {
			writeAdminError(w, http.StatusUnauthorized, "login denied")
			return
		}
	}
	token, account, err := h.login.Login(r.Context(), email, body.Password)
	if errors.Is(err, input.ErrAdminLoginDenied) {
		if h.lockout != nil {
			h.lockout.RecordFailure(email, ip)
		}
		writeAdminError(w, http.StatusUnauthorized, "login denied")
		return
	}
	if err != nil || account == nil || token == "" {
		writeAdminError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if h.lockout != nil {
		h.lockout.Reset(email, ip)
	}
	maxAge := int(time.Until(account.ExpiresAt).Seconds())
	if maxAge <= 0 {
		writeAdminError(w, http.StatusInternalServerError, "internal error")
		return
	}
	h.setCookie(w, token, account.ExpiresAt, maxAge)
	action, actor = "admin.account.login.success", account.ID
	writeAdminAccount(w, account)
}

func (h *adminLoginHandler) handleMe(w http.ResponseWriter, r *http.Request) {
	a, _ := r.Context().Value(adminAccountContextKey{}).(*input.AdminAccount)
	if a == nil {
		writeAdminError(w, http.StatusUnauthorized, "account session required")
		return
	}
	writeAdminAccount(w, a)
}

func (h *adminLoginHandler) handleLogout(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	a, _ := r.Context().Value(adminAccountContextKey{}).(*input.AdminAccount)
	cookie, err := r.Cookie(adminSessionCookie)
	if a == nil || err != nil {
		writeAdminError(w, http.StatusUnauthorized, "account session required")
		return
	}
	if err := h.login.Logout(r.Context(), cookie.Value); err != nil {
		writeAdminError(w, http.StatusInternalServerError, "internal error")
		return
	}
	h.setCookie(w, "", time.Unix(1, 0), -1)
	h.record(r, "admin.account.logout", a.ID)
	w.WriteHeader(http.StatusNoContent)
}

func (h *adminLoginHandler) setCookie(w http.ResponseWriter, token string, expires time.Time, maxAge int) {
	http.SetCookie(w, &http.Cookie{Name: adminSessionCookie, Value: token, Path: "/admin", HttpOnly: true, Secure: h.secure, SameSite: http.SameSiteStrictMode, Expires: expires, MaxAge: maxAge})
}
