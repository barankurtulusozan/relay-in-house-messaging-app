package ws

import (
	"context"
	"log"
	"time"

	"company-chat/server/internal/auth"

	"github.com/google/uuid"
	"nhooyr.io/websocket"
)

type Client struct {
	hub        *Hub
	conn       *websocket.Conn
	UserID     uuid.UUID
	sendChan   chan []byte
	jwtManager *auth.JWTManager
}

func NewClient(hub *Hub, conn *websocket.Conn, jwtManager *auth.JWTManager) *Client {
	return &Client{
		hub:        hub,
		conn:       conn,
		sendChan:   make(chan []byte, 256),
		jwtManager: jwtManager,
	}
}

func (c *Client) ReadLoop(ctx context.Context) {
	defer func() {
		if c.UserID != uuid.Nil {
			c.hub.Unregister(c)
		}
		c.conn.Close(websocket.StatusNormalClosure, "")
	}()

	// Auth timeout: First frame must be "auth" within 5s
	authCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	_, data, err := c.conn.Read(authCtx)
	if err != nil {
		log.Println("[WS] Auth timeout or read error:", err)
		return
	}

	inFrame, err := DecodeInboundFrame(data)
	if err != nil || inFrame.Type != FrameAuth {
		log.Println("[WS] Expected first-frame auth")
		return
	}

	claims, err := c.jwtManager.ValidateToken(inFrame.Token)
	if err != nil {
		log.Println("[WS] Invalid auth token:", err)
		return
	}

	c.UserID = claims.UserID
	c.hub.Register(c)

	// Send auth.ok frame
	authOK, _ := EncodeFrame(OutboundFrame{
		Type:   FrameAuthOK,
		UserID: &c.UserID,
	})
	c.sendChan <- authOK

	// Start write loop goroutine
	go c.WriteLoop(ctx)

	// Continuous read loop for incoming frames
	for {
		_, msgBytes, err := c.conn.Read(ctx)
		if err != nil {
			break
		}

		frame, err := DecodeInboundFrame(msgBytes)
		if err != nil {
			continue
		}

		c.handleInboundFrame(ctx, frame)
	}
}

func (c *Client) handleInboundFrame(ctx context.Context, frame *InboundFrame) {
	switch frame.Type {
	case FrameMessageSend:
		if frame.ConversationID == nil || (frame.Body == nil && frame.ID == nil) {
			return
		}
		msgID := uuid.New()
		if frame.ID != nil {
			msgID = *frame.ID
		}

		savedMsg, err := c.hub.chatService.SendMessage(ctx, c.UserID, msgID, *frame.ConversationID, frame.Body, frame.ReplyToID)
		if err != nil {
			errBytes, _ := EncodeFrame(OutboundFrame{Type: FrameError, Error: err.Error()})
			c.sendChan <- errBytes
			return
		}

		// Send message.ack back to originating client
		ackBytes, _ := EncodeFrame(OutboundFrame{
			Type:           FrameMessageACK,
			ClientID:       &msgID,
			ServerSeq:      &savedMsg.ServerSeq,
			ConversationID: frame.ConversationID,
		})
		c.sendChan <- ackBytes

	case FrameTypingStart, FrameTypingStop:
		if frame.ConversationID != nil {
			isTyping := frame.Type == FrameTypingStart
			_ = c.hub.presence.SetTyping(ctx, *frame.ConversationID, c.UserID, isTyping)
		}

	case FrameReadAck:
		if frame.ConversationID != nil && frame.MessageID != nil {
			_ = c.hub.chatService.MarkRead(ctx, c.UserID, *frame.ConversationID, *frame.MessageID)
		}

	case FrameSyncReq:
		if frame.ConversationID != nil && frame.SinceSeq != nil {
			messages, hasMore, err := c.hub.chatService.SyncMessages(ctx, c.UserID, *frame.ConversationID, *frame.SinceSeq, 50)
			if err == nil {
				syncBytes, _ := EncodeFrame(OutboundFrame{
					Type:           FrameSyncBatch,
					ConversationID: frame.ConversationID,
					Messages:       messages,
					HasMore:        &hasMore,
				})
				c.sendChan <- syncBytes
			}
		}
	}
}

func (c *Client) WriteLoop(ctx context.Context) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case msg, ok := <-c.sendChan:
			if !ok {
				return
			}
			err := c.conn.Write(ctx, websocket.MessageText, msg)
			if err != nil {
				return
			}
		case <-ticker.C:
			// Ping connection
			err := c.conn.Ping(ctx)
			if err != nil {
				return
			}
		case <-ctx.Done():
			return
		}
	}
}
