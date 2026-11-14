package services

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/authplane/authserver/internal/crypto"
	"github.com/authplane/authserver/internal/domain"
	"github.com/authplane/authserver/internal/ports/input"
	"github.com/authplane/authserver/internal/ports/output"
)

var _ input.UserInfoPort = (*UserInfoService)(nil)

// UserInfoService serves user profiles only to direct login tokens addressed
// to this authorization server. Callers must supply uncached identity stores
// so suspension, disablement and profile updates take effect on the next call.
type UserInfoService struct {
	keys       JWKSBuildProvider
	revocation output.RevocationStore
	families   output.TokenStore
	machines   output.MachineTokenStore
	clients    output.ClientStore
	users      output.UserStore
	issuer     output.IssuerProvider
}

func NewUserInfoService(keys JWKSBuildProvider, revocation output.RevocationStore, families output.TokenStore, machines output.MachineTokenStore, clients output.ClientStore, users output.UserStore, issuer output.IssuerProvider) *UserInfoService {
	if keys == nil || revocation == nil || families == nil || machines == nil || clients == nil || users == nil || issuer == nil {
		panic("services.NewUserInfoService: all dependencies are required")
	}
	return &UserInfoService{keys: keys, revocation: revocation, families: families, machines: machines, clients: clients, users: users, issuer: issuer}
}

func (s *UserInfoService) UserInfo(ctx context.Context, accessToken string) (*input.UserInfo, error) {
	issuer, err := s.issuer.Issuer(ctx)
	if err != nil || issuer == "" {
		return nil, fmt.Errorf("resolve userinfo issuer")
	}
	keys, err := s.keys.BuildJWKS(ctx)
	if err != nil || keys == nil {
		return nil, fmt.Errorf("resolve userinfo signing keys")
	}
	claims, err := crypto.VerifyAccessTokenWithIssuer(accessToken, keys, issuer)
	if err != nil {
		return nil, input.ErrUserInfoInvalidToken
	}
	now := time.Now().Unix()
	if claims.Subject == "" || claims.ClientID == "" || claims.JTI == "" || len(claims.Audience) != 1 || claims.Audience[0] != issuer ||
		claims.Expiry <= now || claims.IssuedAt > now+30 || claims.IssuedAt >= claims.Expiry || len(claims.Cnf) != 0 || len(claims.Act) != 0 {
		return nil, input.ErrUserInfoInvalidToken
	}
	// A signature and an absent machine row are not evidence of a direct
	// login: token exchange may also mint an unbound impersonation token.
	family, err := s.families.GetFamilyByAccessTokenJTI(ctx, claims.JTI)
	if errors.Is(err, domain.ErrInvalidGrant) {
		return nil, input.ErrUserInfoInvalidToken
	}
	if err != nil {
		return nil, fmt.Errorf("lookup userinfo login grant: %w", err)
	}
	if family == nil || !family.IsActive() || family.ClientID != claims.ClientID || family.UserID != claims.Subject || family.Resource != "" {
		return nil, input.ErrUserInfoInvalidToken
	}
	// Machine and exchange grants can name real users. A subject lookup alone
	// would let these tokens become login credentials, so reject their records.
	mt, err := s.machines.GetByJTI(ctx, claims.JTI)
	if err != nil {
		return nil, fmt.Errorf("lookup userinfo token kind: %w", err)
	}
	if mt != nil {
		return nil, input.ErrUserInfoInvalidToken
	}
	revoked, err := s.revocation.IsRevoked(ctx, claims.JTI)
	if err != nil {
		return nil, fmt.Errorf("check userinfo token revocation: %w", err)
	}
	if revoked {
		return nil, input.ErrUserInfoInvalidToken
	}
	c, err := s.clients.GetByID(ctx, claims.ClientID)
	if errors.Is(err, domain.ErrClientNotFound) || errors.Is(err, domain.ErrInvalidClient) {
		return nil, input.ErrUserInfoInvalidToken
	}
	if err != nil {
		return nil, fmt.Errorf("lookup userinfo client: %w", err)
	}
	if c == nil || !c.IsActive() || !slices.Contains(c.GrantTypes, "authorization_code") {
		return nil, input.ErrUserInfoInvalidToken
	}
	u, err := s.users.GetByID(ctx, claims.Subject)
	if errors.Is(err, domain.ErrUserNotFound) {
		return nil, input.ErrUserInfoInvalidToken
	}
	if err != nil {
		return nil, fmt.Errorf("lookup userinfo user: %w", err)
	}
	if u == nil || !u.IsActive() {
		return nil, input.ErrUserInfoInvalidToken
	}
	if !slices.Contains(strings.Fields(claims.Scope), input.UserInfoScope) || !slices.Contains(strings.Fields(family.Scope), input.UserInfoScope) {
		return nil, input.ErrUserInfoInsufficientScope
	}
	return &input.UserInfo{Subject: u.ID, Name: u.Name, Email: u.Email, PreferredUsername: u.Email}, nil
}
