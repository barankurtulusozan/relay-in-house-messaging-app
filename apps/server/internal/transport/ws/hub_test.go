package ws_test

import (
	"context"
	"testing"
	"time"

	"company-chat/server/internal/domain"
	"company-chat/server/internal/transport/ws"

	"github.com/google/uuid"
)

type mockEventPub struct {
	subCount map[uuid.UUID]int
}

func (m *mockEventPub) PublishUserEvent(ctx context.Context, userID uuid.UUID, event *domain.DomainEvent) error {
	return nil
}
func (m *mockEventPub) PublishConversationEvent(ctx context.Context, conversationID uuid.UUID, event *domain.DomainEvent) error {
	return nil
}
func (m *mockEventPub) SubscribeUserEvents(ctx context.Context, userID uuid.UUID) (<-chan *domain.DomainEvent, func(), error) {
	if m.subCount == nil {
		m.subCount = make(map[uuid.UUID]int)
	}
	m.subCount[userID]++
	ch := make(chan *domain.DomainEvent, 10)

	cancel := func() {
		m.subCount[userID]--
	}
	return ch, cancel, nil
}

type mockPresenceStore struct {
	online map[uuid.UUID]bool
}

func (m *mockPresenceStore) SetOnline(ctx context.Context, userID uuid.UUID) error {
	if m.online == nil {
		m.online = make(map[uuid.UUID]bool)
	}
	m.online[userID] = true
	return nil
}
func (m *mockPresenceStore) SetOffline(ctx context.Context, userID uuid.UUID) error {
	if m.online == nil {
		m.online = make(map[uuid.UUID]bool)
	}
	m.online[userID] = false
	return nil
}
func (m *mockPresenceStore) GetStatus(ctx context.Context, userID uuid.UUID) (domain.UserStatus, error) {
	if m.online[userID] {
		return domain.StatusOnline, nil
	}
	return domain.StatusOffline, nil
}
func (m *mockPresenceStore) SetTyping(ctx context.Context, conversationID, userID uuid.UUID, isTyping bool) error {
	return nil
}

func TestHub_SingleSubscriptionPerUser(t *testing.T) {
	eventPub := &mockEventPub{subCount: make(map[uuid.UUID]int)}
	presence := &mockPresenceStore{online: make(map[uuid.UUID]bool)}

	hub := ws.NewHub(nil, eventPub, presence)
	userID := uuid.New()

	client1 := &ws.Client{UserID: userID}
	client2 := &ws.Client{UserID: userID}

	hub.Register(client1)
	time.Sleep(10 * time.Millisecond)

	if eventPub.subCount[userID] != 1 {
		t.Errorf("expected 1 sub for userID, got %d", eventPub.subCount[userID])
	}

	// Second client connects for same user
	hub.Register(client2)
	time.Sleep(10 * time.Millisecond)

	// Subscription count should STILL be 1!
	if eventPub.subCount[userID] != 1 {
		t.Errorf("expected subscription count to remain 1, got %d", eventPub.subCount[userID])
	}

	// First client disconnects
	hub.Unregister(client1)
	time.Sleep(10 * time.Millisecond)

	// User still has client2 connected, so sub count stays 1
	if eventPub.subCount[userID] != 1 {
		t.Errorf("expected subscription count to remain 1 while client2 is active, got %d", eventPub.subCount[userID])
	}

	// Second client disconnects
	hub.Unregister(client2)
	time.Sleep(10 * time.Millisecond)

	// Sub count should be 0 after all devices disconnect
	if eventPub.subCount[userID] != 0 {
		t.Errorf("expected sub count 0 after all clients disconnected, got %d", eventPub.subCount[userID])
	}
}
