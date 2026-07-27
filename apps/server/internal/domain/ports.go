package domain

import (
	"context"
	"time"

	"github.com/google/uuid"
)

type EventType string

const (
	EventMessageNew     EventType = "message.new"
	EventPresenceUpdate EventType = "presence.update"
	EventTypingUpdate   EventType = "typing.update"
	EventReadUpdate     EventType = "read.update"
)

type DomainEvent struct {
	Type           EventType   `json:"type"`
	ConversationID *uuid.UUID  `json:"conversation_id,omitempty"`
	UserID         uuid.UUID   `json:"user_id"`
	Payload        interface{} `json:"payload"`
	Timestamp      time.Time   `json:"timestamp"`
}

type PushNotification struct {
	Title string            `json:"title"`
	Body  string            `json:"body"`
	Data  map[string]string `json:"data"`
}

// Repositories (Secondary Ports)
type UserRepository interface {
	UpsertOIDCUser(ctx context.Context, oidcSub, email, name string, avatarURL *string) (*User, error)
	GetUserByID(ctx context.Context, id uuid.UUID) (*User, error)
	UpdateStatus(ctx context.Context, id uuid.UUID, status UserStatus) error
	SearchUsers(ctx context.Context, query string, limit int) ([]*User, error)
}

type ConversationRepository interface {
	CreateConversation(ctx context.Context, conv *Conversation, memberIDs []uuid.UUID) (*Conversation, error)
	FindDirectConversation(ctx context.Context, userA, userB uuid.UUID) (*Conversation, error)
	UpdateConversationName(ctx context.Context, id uuid.UUID, name string) error
	GetConversationByID(ctx context.Context, id uuid.UUID) (*Conversation, error)
	GetUserConversations(ctx context.Context, userID uuid.UUID) ([]*Conversation, error)
	IsMember(ctx context.Context, conversationID, userID uuid.UUID) (bool, error)
	GetMembers(ctx context.Context, conversationID uuid.UUID) ([]*ConversationMember, error)
	AddMember(ctx context.Context, conversationID, userID uuid.UUID, role MemberRole) error
	RemoveMember(ctx context.Context, conversationID, userID uuid.UUID) error
}

type MessageRepository interface {
	InsertMessage(ctx context.Context, msg *Message) (*Message, error)
	GetMessageByID(ctx context.Context, id uuid.UUID) (*Message, error)
	GetMessagesSince(ctx context.Context, conversationID uuid.UUID, sinceSeq int64, limit int) ([]*Message, bool, error)
	GetMessagesBefore(ctx context.Context, conversationID uuid.UUID, beforeSeq int64, limit int) ([]*Message, bool, error)
	SearchMessages(ctx context.Context, conversationID *uuid.UUID, query string, limit int) ([]*Message, error)
}

type AttachmentRepository interface {
	CreateAttachment(ctx context.Context, att *Attachment) (*Attachment, error)
	GetAttachmentByID(ctx context.Context, id uuid.UUID) (*Attachment, error)
	UpdateScanStatus(ctx context.Context, id uuid.UUID, status ScanStatus) error
}

type DeviceRepository interface {
	RegisterDevice(ctx context.Context, device *Device) (*Device, error)
	GetUserDevices(ctx context.Context, userID uuid.UUID) ([]*Device, error)
	DeleteDevice(ctx context.Context, id uuid.UUID, userID uuid.UUID) error
}

type ReadReceiptRepository interface {
	UpsertReceipt(ctx context.Context, conversationID, userID, messageID uuid.UUID) error
}

// Infrastructure Ports (Secondary Ports)
type EventPublisher interface {
	PublishUserEvent(ctx context.Context, userID uuid.UUID, event *DomainEvent) error
	PublishConversationEvent(ctx context.Context, conversationID uuid.UUID, event *DomainEvent) error
	SubscribeUserEvents(ctx context.Context, userID uuid.UUID) (<-chan *DomainEvent, func(), error)
}

type PresenceStore interface {
	SetOnline(ctx context.Context, userID uuid.UUID) error
	SetOffline(ctx context.Context, userID uuid.UUID) error
	GetStatus(ctx context.Context, userID uuid.UUID) (UserStatus, error)
	SetTyping(ctx context.Context, conversationID, userID uuid.UUID, isTyping bool) error
}

type PushNotifier interface {
	SendPush(ctx context.Context, device *Device, notification PushNotification) error
}

type FileScanner interface {
	Scan(ctx context.Context, storageKey string) (ScanStatus, error)
}

type ObjectStorage interface {
	GeneratePresignedPutURL(ctx context.Context, storageKey, mimeType string, expiresSec int) (string, error)
	GeneratePresignedGetURL(ctx context.Context, storageKey string, expiresSec int) (string, error)
}
