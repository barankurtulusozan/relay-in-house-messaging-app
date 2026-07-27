package auth

import (
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestJWTManagerGenerateAndValidate(t *testing.T) {
	secret := []byte("super-secret-key-for-testing-12345")
	manager := NewJWTManager(secret)

	userID := uuid.New()
	email := "test@company.com"

	tokenStr, err := manager.GenerateToken(userID, email, 15*time.Minute)
	if err != nil {
		t.Fatalf("Failed to generate token: %v", err)
	}

	claims, err := manager.ValidateToken(tokenStr)
	if err != nil {
		t.Fatalf("Failed to validate valid token: %v", err)
	}

	if claims.UserID != userID {
		t.Errorf("Expected UserID %s, got %s", userID, claims.UserID)
	}
	if claims.Email != email {
		t.Errorf("Expected email %s, got %s", email, claims.Email)
	}
}

func TestJWTManagerInvalidSecret(t *testing.T) {
	manager1 := NewJWTManager([]byte("secret-one-1234567890"))
	manager2 := NewJWTManager([]byte("secret-two-1234567890"))

	userID := uuid.New()
	tokenStr, err := manager1.GenerateToken(userID, "user@test.com", 15*time.Minute)
	if err != nil {
		t.Fatalf("Failed to generate token: %v", err)
	}

	_, err = manager2.ValidateToken(tokenStr)
	if err == nil {
		t.Error("Expected error validating token with wrong secret, got nil")
	}
}
