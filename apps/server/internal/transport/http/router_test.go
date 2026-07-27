package http

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"company-chat/server/internal/auth"
	"company-chat/server/internal/config"

	"github.com/go-chi/chi/v5"
)

func TestRateLimitMiddleware(t *testing.T) {
	r := chi.NewRouter()
	r.With(RateLimitMiddleware(2, 1*time.Minute)).Get("/test", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})

	// First request - 200 OK
	req1 := httptest.NewRequest("GET", "/test", nil)
	req1.RemoteAddr = "192.168.1.100:12345"
	rec1 := httptest.NewRecorder()
	r.ServeHTTP(rec1, req1)
	if rec1.Code != http.StatusOK {
		t.Errorf("Expected 200 OK on first request, got %d", rec1.Code)
	}

	// Second request - 200 OK
	req2 := httptest.NewRequest("GET", "/test", nil)
	req2.RemoteAddr = "192.168.1.100:12345"
	rec2 := httptest.NewRecorder()
	r.ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusOK {
		t.Errorf("Expected 200 OK on second request, got %d", rec2.Code)
	}

	// Third request - 429 Too Many Requests
	req3 := httptest.NewRequest("GET", "/test", nil)
	req3.RemoteAddr = "192.168.1.100:12345"
	rec3 := httptest.NewRecorder()
	r.ServeHTTP(rec3, req3)
	if rec3.Code != http.StatusTooManyRequests {
		t.Errorf("Expected 429 Too Many Requests on third request, got %d", rec3.Code)
	}
}

func TestDevLoginBlockedInProduction(t *testing.T) {
	cfg := &config.Config{
		AppEnv:            "production",
		Port:              "8080",
		JWTSigningSecret:  []byte("production-secret-key-1234567890"),
		AllowedCORSOrigins: []string{"https://app.company.com"},
	}

	jwtManager := auth.NewJWTManager(cfg.JWTSigningSecret)
	server := NewServer(cfg, jwtManager, nil, nil, nil, nil, nil)

	body := strings.NewReader(`{"oidc_subject":"sub-123","email":"dev@company.com"}`)
	req := httptest.NewRequest("POST", "/api/auth/login", body)
	rec := httptest.NewRecorder()

	server.Router().ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Errorf("Expected 403 Forbidden for dev login in production, got %d", rec.Code)
	}
}
