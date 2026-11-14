//go:build integration

package services_test

import (
	"errors"
	"testing"

	"github.com/authplane/authserver/internal/crypto"
	"github.com/authplane/authserver/internal/domain"
	"github.com/authplane/authserver/internal/domain/client"
	"github.com/authplane/authserver/internal/ports/input"
)

func TestOAuth2LoginTokenGuards(t *testing.T) {
	for _, mode := range []string{"allowed", "missing secret", "wrong secret", "PKCE cannot be downgraded", "partial PKCE", "MCP resource", "other scope", "DCR"} {
		t.Run(mode, func(t *testing.T) {
			s := newTokenTestSetup(t)
			c, sess, _, _ := s.createSessionWithCode(t, false)
			c.RegistrationSource = client.SourceAdmin
			secret := "oneid-test-secret"
			hash, err := crypto.HashBcrypt(secret)
			if err != nil {
				t.Fatal(err)
			}
			c.SecretHash = hash
			if mode == "DCR" {
				c.RegistrationSource = client.SourceDCR
			}
			if err := s.h.Stores.Client.Update(t.Context(), c); err != nil {
				t.Fatal(err)
			}
			code := crypto.GenerateAuthCode()
			sess.ID = crypto.GenerateRandomString(16)
			sess.CodeHash = crypto.HashSHA256(code)
			if mode != "PKCE cannot be downgraded" {
				sess.CodeChallenge = ""
				sess.CodeChallengeMethod = ""
			}
			sess.Resource = ""
			sess.Scope = "oneid:login"
			if mode == "partial PKCE" {
				sess.CodeChallengeMethod = "S256"
			}
			if mode == "MCP resource" {
				sess.Resource = "https://mcp.example.com"
			}
			if mode == "other scope" {
				sess.Scope = "mcp:tools"
			}
			if err := s.h.Stores.Session.Create(t.Context(), sess); err != nil {
				t.Fatal(err)
			}
			if mode == "missing secret" {
				secret = ""
			}
			if mode == "wrong secret" {
				secret = "wrong-secret"
			}
			_, err = s.tokenSvc.ExchangeCode(t.Context(), input.ExchangeCodeRequest{Code: code, ClientID: c.ID, ClientSecret: secret, RedirectURI: sess.RedirectURI})
			if mode == "allowed" || mode == "MCP resource" || mode == "other scope" || mode == "DCR" {
				if err != nil {
					t.Fatal(err)
				}
				return
			}
			want := domain.ErrInvalidPKCE
			if mode == "missing secret" || mode == "wrong secret" {
				want = domain.ErrInvalidClient
			}
			if !errors.Is(err, want) {
				t.Fatalf("error=%v want=%v", err, want)
			}
		})
	}
}

func TestOAuth2LoginReplayRequiresClientSecret(t *testing.T) {
	s := newTokenTestSetup(t)
	c, sess, _, _ := s.createSessionWithCode(t, false)
	c.RegistrationSource = client.SourceAdmin
	secret := "oneid-replay-secret"
	hash, err := crypto.HashBcrypt(secret)
	if err != nil {
		t.Fatal(err)
	}
	c.SecretHash = hash
	if err := s.h.Stores.Client.Update(t.Context(), c); err != nil {
		t.Fatal(err)
	}
	code := crypto.GenerateAuthCode()
	sess.ID = crypto.GenerateRandomString(16)
	sess.CodeHash = crypto.HashSHA256(code)
	sess.CodeChallenge = ""
	sess.CodeChallengeMethod = ""
	sess.Resource = ""
	sess.Scope = "oneid:login"
	if err := s.h.Stores.Session.Create(t.Context(), sess); err != nil {
		t.Fatal(err)
	}
	req := input.ExchangeCodeRequest{Code: code, ClientID: c.ID, ClientSecret: secret, RedirectURI: sess.RedirectURI}
	if _, err := s.tokenSvc.ExchangeCode(t.Context(), req); err != nil {
		t.Fatal(err)
	}
	req.ClientSecret = "wrong-secret"
	if _, err := s.tokenSvc.ExchangeCode(t.Context(), req); !errors.Is(err, domain.ErrCodeConsumed) {
		t.Fatalf("replay error=%v", err)
	}
	family, err := s.h.Stores.Token.GetFamilyByAuthSessionID(t.Context(), sess.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !family.IsActive() {
		t.Fatal("unauthenticated replay revoked the grant")
	}
	req.ClientSecret = secret
	if _, err := s.tokenSvc.ExchangeCode(t.Context(), req); !errors.Is(err, domain.ErrCodeConsumed) {
		t.Fatalf("authenticated replay error=%v", err)
	}
	family, err = s.h.Stores.Token.GetFamilyByAuthSessionID(t.Context(), sess.ID)
	if err != nil {
		t.Fatal(err)
	}
	if family.IsActive() {
		t.Fatal("authenticated code reuse did not revoke the grant")
	}
}

// No allowlist or OneID scope is installed: authentication of the registered
// confidential client is the proof needed for an unchallenged code.
func TestConfidentialClientWithoutPKCE(t *testing.T) {
	for _, mode := range []string{"basic", "form post", "admin", "public", "missing secret", "wrong secret", "different client", "different redirect", "removed callback", "different resource", "partial PKCE", "challenged code"} {
		t.Run(mode, func(t *testing.T) {
			s := newTokenTestSetup(t)
			c, sess, _, _ := s.createSessionWithCode(t, mode == "public")
			secret := ""
			if mode != "public" {
				secret = "confidential-client-test-secret"
				hash, err := crypto.HashBcrypt(secret)
				if err != nil {
					t.Fatal(err)
				}
				c.SecretHash = hash
			}
			if mode == "form post" {
				c.TokenEndpointAuthMethod = "client_secret_post"
			}
			if mode == "admin" {
				c.RegistrationSource = client.SourceAdmin
			}
			if mode == "removed callback" {
				c.RedirectURIs = []string{"https://app.example.com/new-callback"}
			}
			if err := s.h.Stores.Client.Update(t.Context(), c); err != nil {
				t.Fatal(err)
			}
			code := crypto.GenerateAuthCode()
			sess.ID = crypto.GenerateRandomString(16)
			sess.CodeHash = crypto.HashSHA256(code)
			if mode != "challenged code" {
				sess.CodeChallenge, sess.CodeChallengeMethod = "", ""
			}
			if mode == "partial PKCE" {
				sess.CodeChallengeMethod = "S256"
			}
			if err := s.h.Stores.Session.Create(t.Context(), sess); err != nil {
				t.Fatal(err)
			}
			req := input.ExchangeCodeRequest{Code: code, ClientID: c.ID, ClientSecret: secret, RedirectURI: sess.RedirectURI, Resource: "https://mcp.example.com"}
			var want error
			switch mode {
			case "public", "partial PKCE", "challenged code", "removed callback":
				want = domain.ErrInvalidPKCE
			case "missing secret":
				req.ClientSecret = ""
				want = domain.ErrInvalidClient
			case "wrong secret":
				req.ClientSecret = "wrong-secret"
				want = domain.ErrInvalidClient
			case "different client":
				req.ClientID = "other-client"
				want = domain.ErrInvalidClient
			case "different redirect":
				req.RedirectURI += "?other=1"
				want = domain.ErrInvalidGrant
			case "different resource":
				req.Resource = "https://other.example.com"
				want = domain.ErrInvalidTarget
			}
			response, err := s.tokenSvc.ExchangeCode(t.Context(), req)
			if want != nil {
				if !errors.Is(err, want) {
					t.Fatalf("exchange error=%v, want %v", err, want)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			jwks, err := s.jwksSvc.BuildJWKS(t.Context())
			if err != nil {
				t.Fatal(err)
			}
			claims, err := crypto.VerifyAccessToken(response.AccessToken, jwks)
			if err != nil {
				t.Fatal(err)
			}
			if len(claims.Audience) != 1 || claims.Audience[0] != "https://mcp.example.com" || claims.Scope != "tools/query" || claims.Subject != "user-42" || claims.ClientID != c.ID {
				t.Fatal("confidential OAuth2 exchange changed the authorized identity, resource or scope")
			}
		})
	}
}
