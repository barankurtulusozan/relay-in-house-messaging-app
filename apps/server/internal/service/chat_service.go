package service

import (
	"context"
	"errors"
	"time"

	"company-chat/server/internal/domain"

	"github.com/google/uuid"
)

type ChatService struct {
	userRepo         domain.UserRepository
	convRepo         domain.ConversationRepository
	msgRepo          domain.MessageRepository
	receiptRepo      domain.ReadReceiptRepository
	deviceRepo       domain.DeviceRepository
	eventPub         domain.EventPublisher
	presence         domain.PresenceStore
	pushNotifier     domain.PushNotifier
}

func NewChatService(
	userRepo domain.UserRepository,
	convRepo domain.ConversationRepository,
	msgRepo domain.MessageRepository,
	receiptRepo domain.ReadReceiptRepository,
	deviceRepo domain.DeviceRepository,
	eventPub domain.EventPublisher,
	presence domain.PresenceStore,
	pushNotifier domain.PushNotifier,
) *ChatService {
	return &ChatService{
		userRepo:     userRepo,
		convRepo:     convRepo,
		msgRepo:      msgRepo,
		receiptRepo:  receiptRepo,
		deviceRepo:   deviceRepo,
		eventPub:     eventPub,
		presence:     presence,
		pushNotifier: pushNotifier,
	}
}

func (s *ChatService) CreateConversation(ctx context.Context, creatorID uuid.UUID, convType domain.ConversationType, name *string, memberIDs []uuid.UUID) (*domain.Conversation, error) {
	// Ensure creator is in member list
	hasCreator := false
	for _, id := range memberIDs {
		if id == creatorID {
			hasCreator = true
			break
		}
	}
	if !hasCreator {
		memberIDs = append(memberIDs, creatorID)
	}

	conv := &domain.Conversation{
		Type:      convType,
		Name:      name,
		CreatedBy: creatorID,
	}

	return s.convRepo.Create(ctx, conv, memberIDs)
}

func (s *ChatService) GetUserConversations(ctx context.Context, userID uuid.UUID) ([]*domain.Conversation, error) {
	return s.convRepo.GetUserConversations(ctx, userID)
}

func (s *ChatService) GetConversationMembers(ctx context.Context, conversationID, userID uuid.UUID) ([]*domain.ConversationMember, error) {
	isMember, err := s.convRepo.IsMember(ctx, conversationID, userID)
	if err != nil || !isMember {
		return nil, errors.New("unauthorized: user is not a conversation member")
	}
	return s.convRepo.GetMembers(ctx, conversationID)
}

func (s *ChatService) SendMessage(ctx context.Context, senderID uuid.UUID, msgID uuid.UUID, conversationID uuid.UUID, body *string, replyToID *uuid.UUID) (*domain.Message, error) {
	// 1. Check membership
	isMember, err := s.convRepo.IsMember(ctx, conversationID, senderID)
	if err != nil || !isMember {
		return nil, errors.New("unauthorized: user is not a member of this conversation")
	}

	// 2. Build message entity
	if msgID == uuid.Nil {
		msgID = uuid.New()
	}

	msg := &domain.Message{
		ID:             msgID,
		ConversationID: conversationID,
		SenderID:       senderID,
		Body:           body,
		ReplyToID:      replyToID,
		CreatedAt:      time.Now(),
	}

	// 3. Save idempotently to Postgres
	savedMsg, err := s.msgRepo.InsertMessage(ctx, msg)
	if err != nil {
		return nil, err
	}

	// Fetch sender details
	sender, _ := s.userRepo.GetByID(ctx, senderID)
	savedMsg.Sender = sender

	// 4. Publish domain event to Redis for WS delivery
	event := &domain.DomainEvent{
		Type:           domain.EventMessageNew,
		ConversationID: &conversationID,
		UserID:         senderID,
		Payload:        savedMsg,
		Timestamp:      time.Now(),
	}

	// Get all members to notify
	members, err := s.convRepo.GetMembers(ctx, conversationID)
	if err == nil {
		for _, member := range members {
			_ = s.eventPub.PublishUserEvent(ctx, member.UserID, event)

			// Push notification for offline recipients
			if member.UserID != senderID {
				status, _ := s.presence.GetStatus(ctx, member.UserID)
				if status == domain.StatusOffline {
					devices, _ := s.deviceRepo.GetUserDevices(ctx, member.UserID)
					for _, d := range devices {
						title := "New Message"
						if sender != nil {
							title = sender.DisplayName
						}
						bodyText := ""
						if body != nil {
							bodyText = *body
						}
						_ = s.pushNotifier.SendPush(ctx, d, domain.PushNotification{
							Title: title,
							Body:  bodyText,
							Data: map[string]string{
								"conversation_id": conversationID.String(),
								"message_id":      savedMsg.ID.String(),
							},
						})
					}
				}
			}
		}
	}

	return savedMsg, nil
}

func (s *ChatService) GetMessagesBefore(ctx context.Context, userID, conversationID uuid.UUID, beforeSeq int64, limit int) ([]*domain.Message, bool, error) {
	isMember, err := s.convRepo.IsMember(ctx, conversationID, userID)
	if err != nil || !isMember {
		return nil, false, errors.New("unauthorized: user is not a conversation member")
	}
	return s.msgRepo.GetMessagesBefore(ctx, conversationID, beforeSeq, limit)
}

func (s *ChatService) SyncMessages(ctx context.Context, userID, conversationID uuid.UUID, sinceSeq int64, limit int) ([]*domain.Message, bool, error) {
	isMember, err := s.convRepo.IsMember(ctx, conversationID, userID)
	if err != nil || !isMember {
		return nil, false, errors.New("unauthorized: user is not a conversation member")
	}
	return s.msgRepo.GetMessagesSince(ctx, conversationID, sinceSeq, limit)
}

func (s *ChatService) MarkRead(ctx context.Context, userID, conversationID, messageID uuid.UUID) error {
	isMember, err := s.convRepo.IsMember(ctx, conversationID, userID)
	if err != nil || !isMember {
		return errors.New("unauthorized: user is not a conversation member")
	}

	if err := s.receiptRepo.UpsertReceipt(ctx, conversationID, userID, messageID); err != nil {
		return err
	}

	// Broadcast read update
	evt := &domain.DomainEvent{
		Type:           domain.EventReadUpdate,
		ConversationID: &conversationID,
		UserID:         userID,
		Payload: map[string]string{
			"conversation_id": conversationID.String(),
			"user_id":         userID.String(),
			"message_id":      messageID.String(),
		},
		Timestamp: time.Now(),
	}

	members, _ := s.convRepo.GetMembers(ctx, conversationID)
	for _, m := range members {
		_ = s.eventPub.PublishUserEvent(ctx, m.UserID, evt)
	}

	return nil
}

func (s *ChatService) Search(ctx context.Context, userID uuid.UUID, conversationID *uuid.UUID, query string, limit int) ([]*domain.Message, error) {
	if conversationID != nil {
		isMember, err := s.convRepo.IsMember(ctx, *conversationID, userID)
		if err != nil || !isMember {
			return nil, errors.New("unauthorized")
		}
	}
	return s.msgRepo.SearchMessages(ctx, conversationID, query, limit)
}
