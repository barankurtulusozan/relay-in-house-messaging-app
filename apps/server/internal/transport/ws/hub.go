package ws

import (
	"context"
	"log"
	"sync"

	"company-chat/server/internal/domain"
	"company-chat/server/internal/service"

	"github.com/google/uuid"
)

type Hub struct {
	mu          sync.RWMutex
	clients     map[uuid.UUID][]*Client
	chatService *service.ChatService
	eventPub    domain.EventPublisher
	presence    domain.PresenceStore
}

func NewHub(chatService *service.ChatService, eventPub domain.EventPublisher, presence domain.PresenceStore) *Hub {
	return &Hub{
		clients:     make(map[uuid.UUID][]*Client),
		chatService: chatService,
		eventPub:    eventPub,
		presence:    presence,
	}
}

func (h *Hub) Register(client *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()

	h.clients[client.UserID] = append(h.clients[client.UserID], client)
	log.Printf("[Hub] Registered user %s (active devices: %d)", client.UserID, len(h.clients[client.UserID]))

	_ = h.presence.SetOnline(context.Background(), client.UserID)

	// Subscribe to Redis pub/sub events for this user
	go h.subscribeUserEvents(client.UserID)
}

func (h *Hub) Unregister(client *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()

	deviceClients := h.clients[client.UserID]
	for i, c := range deviceClients {
		if c == client {
			h.clients[client.UserID] = append(deviceClients[:i], deviceClients[i+1:]...)
			break
		}
	}

	if len(h.clients[client.UserID]) == 0 {
		delete(h.clients, client.UserID)
		_ = h.presence.SetOffline(context.Background(), client.UserID)
		log.Printf("[Hub] User %s went offline", client.UserID)
	}
}

func (h *Hub) subscribeUserEvents(userID uuid.UUID) {
	ch, cancel, err := h.eventPub.SubscribeUserEvents(context.Background(), userID)
	if err != nil {
		return
	}
	defer cancel()

	for evt := range ch {
		h.broadcastToUser(userID, evt)
	}
}

func (h *Hub) broadcastToUser(userID uuid.UUID, event *domain.DomainEvent) {
	h.mu.RLock()
	clients := h.clients[userID]
	h.mu.RUnlock()

	if len(clients) == 0 {
		return
	}

	var frame OutboundFrame
	switch event.Type {
	case domain.EventMessageNew:
		frame = OutboundFrame{
			Type:           FrameMessageNew,
			ConversationID: event.ConversationID,
			Message:        event.Payload,
		}
	case domain.EventReadUpdate:
		frame = OutboundFrame{
			Type:           FrameRead,
			ConversationID: event.ConversationID,
			Message:        event.Payload,
		}
	default:
		return
	}

	bytes, err := EncodeFrame(frame)
	if err != nil {
		return
	}

	for _, client := range clients {
		select {
		case client.sendChan <- bytes:
		default:
			// Client buffer full
		}
	}
}
