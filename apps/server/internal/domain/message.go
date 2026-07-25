package domain

import (
	"time"

	"github.com/google/uuid"
)

type Message struct {
	ID             uuid.UUID     `json:"id"`
	ConversationID uuid.UUID     `json:"conversation_id"`
	SenderID       uuid.UUID     `json:"sender_id"`
	Body           *string       `json:"body,omitempty"`
	ReplyToID      *uuid.UUID    `json:"reply_to_id,omitempty"`
	EditedFromID   *uuid.UUID    `json:"edited_from_id,omitempty"`
	Deleted        bool          `json:"deleted"`
	CreatedAt      time.Time     `json:"created_at"`
	ServerSeq      int64         `json:"server_seq"`
	Attachments    []*Attachment `json:"attachments,omitempty"`
	Sender         *User         `json:"sender,omitempty"`
}
