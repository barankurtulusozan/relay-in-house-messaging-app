package service_test

import (
	"context"
	"testing"
	"time"

	"company-chat/server/internal/domain"
	"company-chat/server/internal/service"

	"github.com/google/uuid"
)

// Mock Repositories
type mockUserRepo struct {
	users map[uuid.UUID]*domain.User
}

func (m *mockUserRepo) UpsertOIDCUser(ctx context.Context, oidcSub, email, name string, avatarURL *string) (*domain.User, error) {
	u := &domain.User{ID: uuid.New(), OIDCSubject: oidcSub, Email: email, DisplayName: name}
	return u, nil
}
func (m *mockUserRepo) GetUserByID(ctx context.Context, id uuid.UUID) (*domain.User, error) {
	if u, ok := m.users[id]; ok {
		return u, nil
	}
	return &domain.User{ID: id, DisplayName: "Mock User"}, nil
}
func (m *mockUserRepo) UpdateStatus(ctx context.Context, id uuid.UUID, status domain.UserStatus) error {
	return nil
}
func (m *mockUserRepo) SearchUsers(ctx context.Context, query string, limit int) ([]*domain.User, error) {
	return []*domain.User{}, nil
}

type mockConvRepo struct {
	members map[uuid.UUID][]*domain.ConversationMember
}

func (m *mockConvRepo) CreateConversation(ctx context.Context, conv *domain.Conversation, memberIDs []uuid.UUID) (*domain.Conversation, error) {
	conv.ID = uuid.New()
	conv.CreatedAt = time.Now()
	var mems []*domain.ConversationMember
	for _, id := range memberIDs {
		role := domain.RoleMember
		if id == conv.CreatedBy {
			role = domain.RoleOwner
		}
		mems = append(mems, &domain.ConversationMember{
			ConversationID: conv.ID,
			UserID:         id,
			Role:           role,
		})
	}
	m.members[conv.ID] = mems
	return conv, nil
}
func (m *mockConvRepo) FindDirectConversation(ctx context.Context, userA, userB uuid.UUID) (*domain.Conversation, error) {
	return nil, nil
}
func (m *mockConvRepo) UpdateConversationName(ctx context.Context, id uuid.UUID, name string) error {
	return nil
}
func (m *mockConvRepo) GetConversationByID(ctx context.Context, id uuid.UUID) (*domain.Conversation, error) {
	return &domain.Conversation{ID: id, Type: domain.ConversationGroup}, nil
}
func (m *mockConvRepo) GetUserConversations(ctx context.Context, userID uuid.UUID) ([]*domain.Conversation, error) {
	return []*domain.Conversation{}, nil
}
func (m *mockConvRepo) IsMember(ctx context.Context, conversationID, userID uuid.UUID) (bool, error) {
	if mems, ok := m.members[conversationID]; ok {
		for _, mem := range mems {
			if mem.UserID == userID {
				return true, nil
			}
		}
	}
	return true, nil
}
func (m *mockConvRepo) GetMembers(ctx context.Context, conversationID uuid.UUID) ([]*domain.ConversationMember, error) {
	if mems, ok := m.members[conversationID]; ok {
		return mems, nil
	}
	return []*domain.ConversationMember{}, nil
}
func (m *mockConvRepo) AddMember(ctx context.Context, conversationID, userID uuid.UUID, role domain.MemberRole) error {
	return nil
}
func (m *mockConvRepo) RemoveMember(ctx context.Context, conversationID, userID uuid.UUID) error {
	return nil
}

type mockMsgRepo struct{}

func (m *mockMsgRepo) InsertMessage(ctx context.Context, msg *domain.Message) (*domain.Message, error) {
	msg.ServerSeq = 1
	return msg, nil
}
func (m *mockMsgRepo) GetMessageByID(ctx context.Context, id uuid.UUID) (*domain.Message, error) {
	return nil, nil
}
func (m *mockMsgRepo) GetMessagesSince(ctx context.Context, conversationID uuid.UUID, sinceSeq int64, limit int) ([]*domain.Message, bool, error) {
	return []*domain.Message{}, false, nil
}
func (m *mockMsgRepo) GetMessagesBefore(ctx context.Context, conversationID uuid.UUID, beforeSeq int64, limit int) ([]*domain.Message, bool, error) {
	return []*domain.Message{}, false, nil
}
func (m *mockMsgRepo) SearchMessages(ctx context.Context, conversationID *uuid.UUID, query string, limit int) ([]*domain.Message, error) {
	return []*domain.Message{}, nil
}

type mockReceiptRepo struct{}

func (m *mockReceiptRepo) UpsertReceipt(ctx context.Context, conversationID, userID, messageID uuid.UUID) error {
	return nil
}

type mockDeviceRepo struct{}

func (m *mockDeviceRepo) RegisterDevice(ctx context.Context, device *domain.Device) (*domain.Device, error) {
	return device, nil
}
func (m *mockDeviceRepo) GetUserDevices(ctx context.Context, userID uuid.UUID) ([]*domain.Device, error) {
	return []*domain.Device{}, nil
}
func (m *mockDeviceRepo) DeleteDevice(ctx context.Context, id uuid.UUID, userID uuid.UUID) error {
	return nil
}

type mockEventPub struct{}

func (m *mockEventPub) PublishUserEvent(ctx context.Context, userID uuid.UUID, event *domain.DomainEvent) error {
	return nil
}
func (m *mockEventPub) PublishConversationEvent(ctx context.Context, conversationID uuid.UUID, event *domain.DomainEvent) error {
	return nil
}
func (m *mockEventPub) SubscribeUserEvents(ctx context.Context, userID uuid.UUID) (<-chan *domain.DomainEvent, func(), error) {
	ch := make(chan *domain.DomainEvent)
	return ch, func() {}, nil
}

type mockPresence struct{}

func (m *mockPresence) SetOnline(ctx context.Context, userID uuid.UUID) error { return nil }
func (m *mockPresence) SetOffline(ctx context.Context, userID uuid.UUID) error {
	return nil
}
func (m *mockPresence) GetStatus(ctx context.Context, userID uuid.UUID) (domain.UserStatus, error) {
	return domain.StatusOnline, nil
}
func (m *mockPresence) SetTyping(ctx context.Context, conversationID, userID uuid.UUID, isTyping bool) error {
	return nil
}

type mockPushNotifier struct{}

func (m *mockPushNotifier) SendPush(ctx context.Context, device *domain.Device, notification domain.PushNotification) error {
	return nil
}

func TestChatService_CreateConversationAndSendMessage(t *testing.T) {
	userRepo := &mockUserRepo{users: make(map[uuid.UUID]*domain.User)}
	convRepo := &mockConvRepo{members: make(map[uuid.UUID][]*domain.ConversationMember)}
	msgRepo := &mockMsgRepo{}
	receiptRepo := &mockReceiptRepo{}
	deviceRepo := &mockDeviceRepo{}
	eventPub := &mockEventPub{}
	presence := &mockPresence{}
	pushNotifier := &mockPushNotifier{}

	svc := service.NewChatService(userRepo, convRepo, msgRepo, receiptRepo, deviceRepo, eventPub, presence, pushNotifier)

	creatorID := uuid.New()
	memberID := uuid.New()

	convName := "Engineering Team"
	conv, err := svc.CreateConversation(context.Background(), creatorID, domain.ConversationGroup, &convName, []uuid.UUID{memberID})
	if err != nil {
		t.Fatalf("CreateConversation failed: %v", err)
	}

	if conv.ID == uuid.Nil {
		t.Fatalf("expected valid conversation ID, got nil")
	}

	body := "Hello team!"
	msg, err := svc.SendMessage(context.Background(), creatorID, uuid.Nil, conv.ID, &body, nil)
	if err != nil {
		t.Fatalf("SendMessage failed: %v", err)
	}

	if msg.ID == uuid.Nil {
		t.Fatalf("expected valid message ID, got nil")
	}
	if *msg.Body != "Hello team!" {
		t.Errorf("expected body 'Hello team!', got '%s'", *msg.Body)
	}
}
