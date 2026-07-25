package config

import (
	"os"

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
	}
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
