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
	for _, mode := range []string{"allowed", "not listed", "missing secret", "wrong secret", "PKCE cannot be downgraded", "partial PKCE", "MCP resource", "other scope", "DCR"} {
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
			if mode != "not listed" {
				s.tokenSvc.WithOAuth2LoginClients([]string{c.ID})
			}
			if mode == "missing secret" {
				secret = ""
			}
			if mode == "wrong secret" {
				secret = "wrong-secret"
			}
			_, err = s.tokenSvc.ExchangeCode(t.Context(), input.ExchangeCodeRequest{Code: code, ClientID: c.ID, ClientSecret: secret, RedirectURI: sess.RedirectURI})
			if mode == "allowed" {
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
	s.tokenSvc.WithOAuth2LoginClients([]string{c.ID})
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
