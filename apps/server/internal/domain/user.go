package domain

import (
	"time"

	"github.com/google/uuid"
)

type UserStatus string

const (
	StatusOnline  UserStatus = "online"
	StatusAway    UserStatus = "away"
	StatusOffline UserStatus = "offline"
)

type User struct {
	ID          uuid.UUID  `json:"id"`
	OIDCSubject string     `json:"oidc_subject"`
	Email       string     `json:"email"`
	DisplayName string     `json:"display_name"`
	AvatarURL   *string    `json:"avatar_url,omitempty"`
	Status      UserStatus `json:"status"`
	CreatedAt   time.Time  `json:"created_at"`
	LastSeenAt  *time.Time `json:"last_seen_at,omitempty"`
}
