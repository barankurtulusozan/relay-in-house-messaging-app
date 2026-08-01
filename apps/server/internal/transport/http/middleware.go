package http

import (
	"context"
	"net/http"
	"strings"
	"sync"
	"time"

	"company-chat/server/internal/auth"
	"company-chat/server/internal/config"
)

func AuthMiddleware(jwtManager *auth.JWTManager) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authHeader := r.Header.Get("Authorization")
			if authHeader == "" {
				http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
				return
			}

			parts := strings.Split(authHeader, " ")
			if len(parts) != 2 || parts[0] != "Bearer" {
				http.Error(w, `{"error":"invalid token format"}`, http.StatusUnauthorized)
				return
			}

			claims, err := jwtManager.ValidateToken(parts[1])
			if err != nil {
				http.Error(w, `{"error":"invalid or expired token"}`, http.StatusUnauthorized)
				return
			}

			ctx := context.WithValue(r.Context(), config.UserIDContextKey, claims.UserID)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

type ipRateLimiter struct {
	mu       sync.Mutex
	requests map[string][]time.Time
}

func (l *ipRateLimiter) startCleanup(window time.Duration) {
	ticker := time.NewTicker(window * 2)
	go func() {
		for range ticker.C {
			now := time.Now()
			cutoff := now.Add(-window)

			l.mu.Lock()
			for ip, timestamps := range l.requests {
				var valid []time.Time
				for _, t := range timestamps {
					if t.After(cutoff) {
						valid = append(valid, t)
					}
				}
				if len(valid) == 0 {
					delete(l.requests, ip)
				} else {
					l.requests[ip] = valid
				}
			}
			l.mu.Unlock()
		}
	}()
}

func RateLimitMiddleware(maxReqs int, window time.Duration) func(http.Handler) http.Handler {
	limiter := &ipRateLimiter{
		requests: make(map[string][]time.Time),
	}
	limiter.startCleanup(window)

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ip := r.RemoteAddr
			if forward := r.Header.Get("X-Forwarded-For"); forward != "" {
				ip = strings.Split(forward, ",")[0]
			}
			ip = strings.TrimSpace(ip)

			now := time.Now()
			cutoff := now.Add(-window)

			limiter.mu.Lock()
			timestamps := limiter.requests[ip]
			var valid []time.Time
			for _, t := range timestamps {
				if t.After(cutoff) {
					valid = append(valid, t)
				}
			}

			if len(valid) >= maxReqs {
				limiter.requests[ip] = valid
				limiter.mu.Unlock()
				w.Header().Set("Retry-After", "60")
				http.Error(w, `{"error":"rate limit exceeded"}`, http.StatusTooManyRequests)
				return
			}

			valid = append(valid, now)
			limiter.requests[ip] = valid
			limiter.mu.Unlock()

			next.ServeHTTP(w, r)
		})
	}
}
