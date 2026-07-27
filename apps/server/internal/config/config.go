package config

import (
	"os"
	"strings"

	"github.com/google/uuid"
)

type Config struct {
	AppEnv            string
	Port              string
	DatabaseURL       string
	RedisURL          string
	RedisPassword     string
	MinIOEndpoint     string
	MinIORootUser     string
	MinIORootPassword string
	MinIOBucket       string
	OIDCIssuerURL     string
	OIDCClientID      string
	OIDCClientSecret  string
	JWTSigningSecret  []byte
	AllowedCORSOrigins []string
	AllowedWSOrigins   []string
}

func (c *Config) IsProduction() bool {
	return c.AppEnv == "production" || c.AppEnv == "prod"
}

func Load() *Config {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	appEnv := os.Getenv("APP_ENV")
	if appEnv == "" {
		appEnv = "development"
	}

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://chatapp:changeme@localhost:5432/chatapp?sslmode=disable"
	}

	redisURL := os.Getenv("REDIS_URL")
	if redisURL == "" {
		redisURL = "redis://:changeme@localhost:6379/0"
	}

	jwtSecret := os.Getenv("JWT_SIGNING_SECRET")
	if jwtSecret == "" {
		jwtSecret = "dev-secret-key-change-in-production-1234567890"
	}

	corsOriginsStr := os.Getenv("ALLOWED_CORS_ORIGINS")
	var corsOrigins []string
	if corsOriginsStr != "" {
		corsOrigins = splitAndTrim(corsOriginsStr)
	} else if appEnv == "development" {
		corsOrigins = []string{"http://localhost:3000", "http://localhost:8081", "http://127.0.0.1:3000"}
	} else {
		corsOrigins = []string{}
	}

	wsOriginsStr := os.Getenv("ALLOWED_WS_ORIGINS")
	var wsOrigins []string
	if wsOriginsStr != "" {
		wsOrigins = splitAndTrim(wsOriginsStr)
	} else if appEnv == "development" {
		wsOrigins = []string{"localhost:*", "127.0.0.1:*", "192.168.*:*"}
	} else {
		wsOrigins = []string{}
	}

	return &Config{
		AppEnv:            appEnv,
		Port:              port,
		DatabaseURL:       dbURL,
		RedisURL:          redisURL,
		RedisPassword:     os.Getenv("REDIS_PASSWORD"),
		MinIOEndpoint:     getEnvOrDefault("MINIO_ENDPOINT", "localhost:9000"),
		MinIORootUser:     getEnvOrDefault("MINIO_ROOT_USER", "changeme"),
		MinIORootPassword: getEnvOrDefault("MINIO_ROOT_PASSWORD", "changeme"),
		MinIOBucket:       getEnvOrDefault("MINIO_BUCKET", "chat-attachments"),
		OIDCIssuerURL:     os.Getenv("OIDC_ISSUER_URL"),
		OIDCClientID:      os.Getenv("OIDC_CLIENT_ID"),
		OIDCClientSecret:  os.Getenv("OIDC_CLIENT_SECRET"),
		JWTSigningSecret:  []byte(jwtSecret),
		AllowedCORSOrigins: corsOrigins,
		AllowedWSOrigins:   wsOrigins,
	}
}

func splitAndTrim(s string) []string {
	var result []string
	for _, item := range strings.Split(s, ",") {
		if trimmed := strings.TrimSpace(item); trimmed != "" {
			result = append(result, trimmed)
		}
	}
	return result
}

func getEnvOrDefault(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// Key type for context.WithValue
type contextKey string

const UserIDContextKey contextKey = "user_id"

func GetUserIDFromContext(ctx interface{ Value(interface{}) interface{} }) (uuid.UUID, bool) {
	val := ctx.Value(UserIDContextKey)
	if val == nil {
		return uuid.Nil, false
	}
	id, ok := val.(uuid.UUID)
	return id, ok
}
