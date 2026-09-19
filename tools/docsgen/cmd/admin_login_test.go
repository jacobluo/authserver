package cmd

import (
	"reflect"
	"strings"
	"testing"
)

// Catch API-key-only projections of Cookie routes and missing session DTOs.
func TestAdminLoginDocumentation(t *testing.T) {
	root, err := repoRoot()
	if err != nil {
		t.Fatal(err)
	}
	m, err := buildHTTPModel(root)
	if err != nil {
		t.Fatal(err)
	}
	dtos := map[string]httpDTO{}
	for _, d := range m.DTOs {
		dtos[d.Name] = d
	}
	if len(dtos["adminAccountResponse"].Fields) != 5 {
		t.Error("missing account response fields")
	}
	for _, tc := range []struct {
		method, path, mode, text string
		security                 []map[string][]string
	}{
		{"POST", "/admin/auth/login", "none", "none", nil},
		{"GET", "/admin/auth/me", "admin-session", "authplane_admin_session", []map[string][]string{{"AdminSessionCookie": {}}}},
		{"POST", "/admin/auth/logout", "admin-session", "X-Admin-CSRF", []map[string][]string{{"AdminSessionCookie": {}, "AdminCSRF": {}}}},
		{"GET", "/admin/users", "admin-dual", "authplane_admin_session", []map[string][]string{{"AdminAPIKey": {}}, {"AdminSessionCookie": {}}}},
		{"POST", "/admin/users", "admin-dual", "X-Admin-CSRF", []map[string][]string{{"AdminAPIKey": {}}, {"AdminSessionCookie": {}, "AdminCSRF": {}}}},
	} {
		t.Run(tc.method+tc.path, func(t *testing.T) {
			for _, r := range m.Routes {
				if r.Method != tc.method || r.Path != tc.path {
					continue
				}
				if r.AuthMode != tc.mode {
					t.Errorf("auth mode = %s, want %s", r.AuthMode, tc.mode)
				}
				doc := renderHTTPDoc(&httpModel{Routes: []httpRoute{r}, FSet: m.FSet}, root)
				_, authLine, found := strings.Cut(doc, "**Auth** — ")
				authLine, _, _ = strings.Cut(authLine, "\n")
				if !found || !strings.Contains(authLine, tc.text) {
					t.Errorf("Markdown missing auth requirement %s", tc.text)
				}
				op, _ := buildOperation(r, dtos, map[string]bool{})
				if !reflect.DeepEqual(op.Security, tc.security) {
					t.Errorf("security = %#v, want %#v", op.Security, tc.security)
				}
				if tc.path == "/admin/auth/logout" {
					if _, ok := op.Responses["204"]; !ok {
						t.Error("missing logout 204")
					}
				}
				if tc.path == "/admin/auth/me" || tc.path == "/admin/auth/login" {
					if op.Responses["200"].Content["application/json"].Schema == nil {
						t.Error("missing account response schema")
					}
				}
				return
			}
			t.Fatal("route missing")
		})
	}
	schemes := serverSecuritySchemes("admin")
	if s := schemes["AdminSessionCookie"]; s.Type != "apiKey" || s.In != "cookie" || s.Name != "authplane_admin_session" {
		t.Errorf("cookie scheme = %#v", s)
	}
	if s := schemes["AdminCSRF"]; s.Type != "apiKey" || s.In != "header" || s.Name != "X-Admin-CSRF" {
		t.Errorf("CSRF scheme = %#v", s)
	}
}
