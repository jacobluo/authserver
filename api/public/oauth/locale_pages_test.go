package oauth

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/authplane/authserver/api/shared"
)

// These assertions exercise the rendered browser UI. Removing a translation
// or accidentally rendering the English default must make them fail.
func TestPublicPagesDefaultToSimplifiedChinese(t *testing.T) {
	cases := []struct {
		name   string
		render func(*bytes.Buffer) error
		want   string
	}{
		{"login", func(b *bytes.Buffer) error { return loginTmpl.Execute(b, loginPageData{ShowLocalLogin: true}) }, "欢迎回来"},
		{"consent", func(b *bytes.Buffer) error {
			return consentTmpl.Execute(b, consentPageData{ClientName: "Example", ResourceDisplayName: "MCP"})
		}, "请求访问"},
		{"OIDC error", func(b *bytes.Buffer) error {
			return oidcErrorTmpl.Execute(b, oidcErrorData{Error: "Authentication failed. Please try again."})
		}, "身份验证失败"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var body bytes.Buffer
			if err := tc.render(&body); err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(body.String(), `<html lang="zh-CN">`) || !strings.Contains(body.String(), tc.want) {
				t.Fatalf("page is not Chinese by default: %s", body.String())
			}
		})
	}
}

func TestLoginPostLanguageSwitchKeepsReturnDestination(t *testing.T) {
	form := url.Values{"redirect": {"/consent?session_id=abc"}, "lang": {"en"}}
	r := httptest.NewRequest(http.MethodPost, "/login", strings.NewReader(form.Encode()))
	r.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	if err := r.ParseForm(); err != nil {
		t.Fatal(err)
	}
	locale := shared.PageLocaleForRequest(httptest.NewRecorder(), r)
	switchURL, err := url.Parse(locale.SwitchURL())
	if err != nil {
		t.Fatal(err)
	}
	if got := switchURL.Query().Get("redirect"); got != "/consent?session_id=abc" {
		t.Fatalf("switch lost post-login destination: %q", got)
	}
}

func TestOIDCErrorEnglishBackLinkKeepsLanguage(t *testing.T) {
	h := newTestHandler(t, nil, nil)
	r := httptest.NewRequest(http.MethodGet, "/oidc/callback?lang=en&error=access_denied", nil)
	data := h.oidcError(r, "Authentication failed. Please try again.")
	if !strings.Contains(data.LoginURL, "lang=en") {
		t.Fatalf("English back-to-login link lost language: %q", data.LoginURL)
	}
}

func TestEnglishSelectionRendersAllPublicTemplates(t *testing.T) {
	locale := shared.PageLocaleForRequest(nil, httptest.NewRequest(http.MethodGet, "/login?lang=en", nil))
	cases := []struct {
		name   string
		render func(*bytes.Buffer) error
		want   string
	}{
		{"login", func(b *bytes.Buffer) error {
			return loginTmpl.Execute(b, loginPageData{Locale: locale, ShowLocalLogin: true})
		}, "Welcome back"},
		{"consent", func(b *bytes.Buffer) error {
			return consentTmpl.Execute(b, consentPageData{Locale: locale, ClientName: "Example", ResourceDisplayName: "MCP"})
		}, "wants permission to access"},
		{"OIDC error", func(b *bytes.Buffer) error {
			return oidcErrorTmpl.Execute(b, oidcErrorData{Locale: locale, Error: "Authentication failed. Please try again."})
		}, "Authentication failed"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var body bytes.Buffer
			if err := tc.render(&body); err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(body.String(), `<html lang="en">`) || !strings.Contains(body.String(), tc.want) {
				t.Fatalf("English page was not rendered: %s", body.String())
			}
		})
	}
}
