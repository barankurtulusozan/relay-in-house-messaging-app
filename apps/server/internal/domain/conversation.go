package domain

import (
	"time"

	"github.com/google/uuid"
)

type ConversationType string

const (
	ConversationDirect ConversationType = "direct"
	ConversationGroup  ConversationType = "group"
)

type MemberRole string

const (
	RoleOwner  MemberRole = "owner"
	RoleAdmin  MemberRole = "admin"
	RoleMember MemberRole = "member"
)

type Conversation struct {
	ID        uuid.UUID        `json:"id"`
	Type      ConversationType `json:"type"`
	Name      *string          `json:"name,omitempty"`
	CreatedBy uuid.UUID        `json:"created_by"`
	CreatedAt time.Time        `json:"created_at"`
}

type ConversationMember struct {
	ConversationID    uuid.UUID  `json:"conversation_id"`
	UserID            uuid.UUID  `json:"user_id"`
	Role              MemberRole `json:"role"`
	JoinedAt          time.Time  `json:"joined_at"`
	LastReadMessageID *uuid.UUID `json:"last_read_message_id,omitempty"`
	User              *User      `json:"user,omitempty"`
}
