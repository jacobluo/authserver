package input

import (
	"context"
	"errors"
)

// UserInfoScope permits retrieving a user's login profile. It reuses the
// existing OneID login scope; it does not imply an OpenID Connect ID token.
const UserInfoScope = "oneid:login"

var (
	ErrUserInfoInvalidToken      = errors.New("invalid user information access token")
	ErrUserInfoInsufficientScope = errors.New("user information scope required")
)

// UserInfoPort retrieves the current profile of an authenticated resource owner.
type UserInfoPort interface {
	UserInfo(ctx context.Context, accessToken string) (*UserInfo, error)
}

// UserInfo contains only the account attributes approved for login consumers.
type UserInfo struct {
	Subject           string
	Name              string
	Email             string
	PreferredUsername string
}
