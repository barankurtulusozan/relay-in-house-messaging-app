package ws

import (
	"encoding/json"

	"github.com/google/uuid"
)

// Client -> Server Frame Types
type InboundFrameType string

const (
	FrameAuth        InboundFrameType = "auth"
	FrameMessageSend InboundFrameType = "message.send"
	FrameTypingStart InboundFrameType = "typing.start"
	FrameTypingStop  InboundFrameType = "typing.stop"
	FrameReadAck     InboundFrameType = "read.ack"
	FrameSyncReq     InboundFrameType = "sync.request"
)

type InboundFrame struct {
	Type           InboundFrameType `json:"type"`
	Token          string           `json:"token,omitempty"`
	ID             *uuid.UUID       `json:"id,omitempty"`
	ConversationID *uuid.UUID       `json:"conversation_id,omitempty"`
	MessageID      *uuid.UUID       `json:"message_id,omitempty"`
	Body           *string          `json:"body,omitempty"`
	ReplyToID      *uuid.UUID       `json:"reply_to_id,omitempty"`
	SinceSeq       *int64           `json:"since_seq,omitempty"`
}

// Server -> Client Frame Types
type OutboundFrameType string

const (
	FrameAuthOK      OutboundFrameType = "auth.ok"
	FrameMessageNew  OutboundFrameType = "message.new"
	FrameMessageACK  OutboundFrameType = "message.ack"
	FramePresence    OutboundFrameType = "presence.update"
	FrameTyping      OutboundFrameType = "typing.update"
	FrameRead        OutboundFrameType = "read.update"
	FrameSyncBatch   OutboundFrameType = "sync.batch"
	FrameError       OutboundFrameType = "error"
)

type OutboundFrame struct {
	Type           OutboundFrameType `json:"type"`
	UserID         *uuid.UUID        `json:"user_id,omitempty"`
	ClientID       *uuid.UUID        `json:"client_id,omitempty"`
	ServerSeq      *int64            `json:"server_seq,omitempty"`
	ConversationID *uuid.UUID        `json:"conversation_id,omitempty"`
	Message        interface{}       `json:"message,omitempty"`
	Messages       interface{}       `json:"messages,omitempty"`
	HasMore        *bool             `json:"has_more,omitempty"`
	Status         string            `json:"status,omitempty"`
	Typing         *bool             `json:"typing,omitempty"`
	Error          string            `json:"error,omitempty"`
}

func EncodeFrame(frame OutboundFrame) ([]byte, error) {
	return json.Marshal(frame)
}

func DecodeInboundFrame(data []byte) (*InboundFrame, error) {
	var frame InboundFrame
	err := json.Unmarshal(data, &frame)
	return &frame, err
}
