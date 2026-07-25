package redis

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"company-chat/server/internal/domain"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

type Adapter struct {
	client *redis.Client
}

func NewAdapter(client *redis.Client) *Adapter {
	return &Adapter{client: client}
}

// EventPublisher Implementation
func (a *Adapter) PublishUserEvent(ctx context.Context, userID uuid.UUID, event *domain.DomainEvent) error {
	channel := fmt.Sprintf("user:%s:events", userID.String())
	data, err := json.Marshal(event)
	if err != nil {
		return err
	}
	return a.client.Publish(ctx, channel, data).Err()
}

func (a *Adapter) PublishConversationEvent(ctx context.Context, conversationID uuid.UUID, event *domain.DomainEvent) error {
	channel := fmt.Sprintf("conv:%s:events", conversationID.String())
	data, err := json.Marshal(event)
	if err != nil {
		return err
	}
	return a.client.Publish(ctx, channel, data).Err()
}

func (a *Adapter) SubscribeUserEvents(ctx context.Context, userID uuid.UUID) (<-chan *domain.DomainEvent, func(), error) {
	channel := fmt.Sprintf("user:%s:events", userID.String())
	pubsub := a.client.Subscribe(ctx, channel)

	outChan := make(chan *domain.DomainEvent, 100)
	go func() {
		ch := pubsub.Channel()
		for msg := range ch {
			var evt domain.DomainEvent
			if err := json.Unmarshal([]byte(msg.Payload), &evt); err == nil {
				outChan <- &evt
			}
		}
		close(outChan)
	}()

	cancel := func() {
		pubsub.Close()
	}

	return outChan, cancel, nil
}

// PresenceStore Implementation
func (a *Adapter) SetOnline(ctx context.Context, userID uuid.UUID) error {
	key := fmt.Sprintf("presence:user:%s", userID.String())
	return a.client.Set(ctx, key, string(domain.StatusOnline), 60*time.Second).Err()
}

func (a *Adapter) SetOffline(ctx context.Context, userID uuid.UUID) error {
	key := fmt.Sprintf("presence:user:%s", userID.String())
	return a.client.Del(ctx, key).Err()
}

func (a *Adapter) GetStatus(ctx context.Context, userID uuid.UUID) (domain.UserStatus, error) {
	key := fmt.Sprintf("presence:user:%s", userID.String())
	val, err := a.client.Get(ctx, key).Result()
	if err == redis.Nil {
		return domain.StatusOffline, nil
	} else if err != nil {
		return domain.StatusOffline, err
	}
	return domain.UserStatus(val), nil
}

func (a *Adapter) SetTyping(ctx context.Context, conversationID, userID uuid.UUID, isTyping bool) error {
	key := fmt.Sprintf("typing:conv:%s:user:%s", conversationID.String(), userID.String())
	if isTyping {
		return a.client.Set(ctx, key, "1", 5*time.Second).Err()
	}
	return a.client.Del(ctx, key).Err()
}
