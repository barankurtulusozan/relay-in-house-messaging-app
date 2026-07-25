package push

import (
	"context"
	"log"

	"company-chat/server/internal/domain"
)

type MultiProviderPushAdapter struct {
	fcmConfigPath string
	apnsKeyPath   string
}

func NewPushAdapter(fcmConfigPath, apnsKeyPath string) *MultiProviderPushAdapter {
	return &MultiProviderPushAdapter{
		fcmConfigPath: fcmConfigPath,
		apnsKeyPath:   apnsKeyPath,
	}
}

func (p *MultiProviderPushAdapter) SendPush(ctx context.Context, device *domain.Device, notification domain.PushNotification) error {
	if device.PushToken == nil || *device.PushToken == "" {
		return nil
	}

	log.Printf("[Push] Sending %s notification to platform=%s token=%s: %s", notification.Title, device.Platform, *device.PushToken, notification.Body)
	// Platform-specific APNs vs FCM routing based on device.Platform
	return nil
}
