package shared

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestWriteErrorPageDefaultsToChineseAndEscapesMessage(t *testing.T) {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/oauth/authorize", nil)
	WriteErrorPage(rec, req, http.StatusBadRequest, "Invalid Client", `The client_id is not recognized. <script>alert(1)</script>`)
	if rec.Code != http.StatusBadRequest || !strings.HasPrefix(rec.Header().Get("Content-Type"), "text/html") {
		t.Fatalf("status/content type changed: %d %q", rec.Code, rec.Header().Get("Content-Type"))
	}
	page := rec.Body.String()
	if !strings.Contains(page, `<html lang="zh-CN">`) || !strings.Contains(page, "无效的客户端") {
		t.Fatalf("error page did not default to Chinese: %s", page)
	}
	if strings.Contains(page, "<script>") || !strings.Contains(page, "&lt;script&gt;") {
		t.Fatalf("error message was not HTML-escaped: %s", page)
	}
}

func TestWriteErrorPageEnglishChoicePersistsWithoutChangingOAuthJSON(t *testing.T) {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/oauth/authorize?client_id=abc&lang=en", nil)
	WriteErrorPage(rec, req, http.StatusBadRequest, "Invalid Client", "The client_id is not recognized.")
	if !strings.Contains(rec.Body.String(), `<html lang="en">`) || !strings.Contains(rec.Body.String(), "Invalid Client") {
		t.Fatalf("English choice not reflected in page: %s", rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "client_id=abc") || !strings.Contains(rec.Body.String(), "lang=zh-CN") {
		t.Fatalf("language switch lost request context: %s", rec.Body.String())
	}
	var preference *http.Cookie
	for _, cookie := range rec.Result().Cookies() {
		if cookie.Name == "authplane_lang" {
			preference = cookie
		}
	}
	if preference == nil || preference.Value != "en" || !preference.HttpOnly || preference.SameSite != http.SameSiteLaxMode {
		t.Fatalf("English preference cookie missing or weak: %#v", preference)
	}

	// The preference is read on a later page, but protocol JSON stays English.
	later := httptest.NewRequest(http.MethodGet, "/oauth/authorize", nil)
	later.AddCookie(preference)
	laterRec := httptest.NewRecorder()
	WriteErrorPage(laterRec, later, http.StatusBadRequest, "Invalid Client", "The client_id is not recognized.")
	if !strings.Contains(laterRec.Body.String(), `<html lang="en">`) {
		t.Fatal("English preference was not preserved across pages")
	}
	jsonRec := httptest.NewRecorder()
	WriteOAuthError(jsonRec, http.StatusBadRequest, "invalid_request", "Invalid request")
	if !strings.Contains(jsonRec.Body.String(), `"error":"invalid_request"`) {
		t.Fatal("OAuth protocol error changed")
	}
}

func TestWriteOAuthError_OmitsConsentURL(t *testing.T) {
	rec := httptest.NewRecorder()
	WriteOAuthError(rec, 400, "invalid_grant", "bad grant")

	var raw map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &raw); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if _, has := raw["consent_url"]; has {
		t.Error("consent_url should be absent when using WriteOAuthError")
	}
	if raw["error"] != "invalid_grant" {
		t.Errorf("error = %v, want invalid_grant", raw["error"])
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/problem+json" {
		t.Errorf("Content-Type = %q, want application/problem+json", ct)
	}
}

func TestWriteOAuthErrorWithConsent(t *testing.T) {
	rec := httptest.NewRecorder()
	WriteOAuthErrorWithConsent(rec, 400,
		"consent_required",
		"Authorize access to google-calendar",
		"https://as.example.com/connect/google-calendar")

	if rec.Code != 400 {
		t.Errorf("status = %d, want 400", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/problem+json" {
		t.Errorf("Content-Type = %q, want application/problem+json", ct)
	}

	var resp OAuthErrorResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.Error != "consent_required" {
		t.Errorf("Error = %q, want consent_required", resp.Error)
	}
	if resp.ErrorDescription != "Authorize access to google-calendar" {
		t.Errorf("ErrorDescription = %q", resp.ErrorDescription)
	}
	if resp.ConsentURL != "https://as.example.com/connect/google-calendar" {
		t.Errorf("ConsentURL = %q", resp.ConsentURL)
	}
	if resp.Type != "https://docs.authplane.ai/errors/consent_required" {
		t.Errorf("Type = %q", resp.Type)
	}
	if resp.Status != 400 {
		t.Errorf("Status = %d, want 400", resp.Status)
	}
}

//  — round-trip the new cause field. Ensures the wire-format change
// is observable by SDKs that decode OAuthErrorResponse directly, and
// confirms the field is omitted when the caller did not supply it.

func TestWriteOAuthErrorWithConsentAndCause_RoundTripsCauseField(t *testing.T) {
	rec := httptest.NewRecorder()
	WriteOAuthErrorWithConsentAndCause(rec, 400,
		"consent_required",
		"Authorize access to test-mcp",
		"https://as.example.com/authorize?resource=test-mcp",
		"scope_insufficient",
	)

	var resp OAuthErrorResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.Cause != "scope_insufficient" {
		t.Errorf("Cause = %q, want scope_insufficient", resp.Cause)
	}
	if resp.ConsentURL != "https://as.example.com/authorize?resource=test-mcp" {
		t.Errorf("ConsentURL = %q", resp.ConsentURL)
	}
	if resp.Error != "consent_required" {
		t.Errorf("Error = %q, want consent_required", resp.Error)
	}
}

func TestWriteOAuthErrorWithConsentAndCause_OmitCauseWhenEmpty(t *testing.T) {
	rec := httptest.NewRecorder()
	WriteOAuthErrorWithConsentAndCause(rec, 400,
		"consent_required",
		"Authorize access to thing",
		"https://as.example.com/connect/thing",
		"", // empty cause
	)
	// Decode into a map so we can distinguish "missing" from "present and
	// empty". omitempty strips empty strings from the wire response.
	var raw map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &raw); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if _, has := raw["cause"]; has {
		t.Errorf("cause should be omitted when empty, got %v", raw["cause"])
	}
}

func TestWriteOAuthErrorWithConsent_LegacyHelperOmitsCause(t *testing.T) {
	// The legacy WriteOAuthErrorWithConsent is a thin wrapper around
	// WriteOAuthErrorWithConsentAndCause(..., ""). Existing call sites
	// outside the consent path must continue to emit responses WITHOUT
	// the cause field on the wire.
	rec := httptest.NewRecorder()
	WriteOAuthErrorWithConsent(rec, 400,
		"consent_required",
		"Authorize access to thing",
		"https://as.example.com/connect/thing")

	var raw map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &raw); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if _, has := raw["cause"]; has {
		t.Errorf("legacy WriteOAuthErrorWithConsent should not emit cause, got %v", raw["cause"])
	}
	if raw["consent_url"] != "https://as.example.com/connect/thing" {
		t.Errorf("consent_url = %v", raw["consent_url"])
	}
}
