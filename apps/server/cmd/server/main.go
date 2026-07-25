package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"company-chat/server/internal/adapter/postgres"
	"company-chat/server/internal/adapter/push"
	redisAdapter "company-chat/server/internal/adapter/redis"
	"company-chat/server/internal/adapter/scanner"
	storageAdapter "company-chat/server/internal/adapter/storage"
	"company-chat/server/internal/auth"
	"company-chat/server/internal/config"
	"company-chat/server/internal/service"
	transportHTTP "company-chat/server/internal/transport/http"
	"company-chat/server/internal/transport/ws"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

func main() {
	cfg := config.Load()
	log.Printf("Starting Company Chat Server on port %s (env: %s)", cfg.Port, cfg.AppEnv)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// 1. Postgres Connection Pool
	dbpool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Printf("Warning: Failed to connect to Postgres (%v). Server will start in standby.", err)
	} else {
		defer dbpool.Close()
		log.Println("Connected to PostgreSQL database pool.")
	}

	// 2. Redis Client
	rOpts, err := redis.ParseURL(cfg.RedisURL)
	if err != nil {
		rOpts = &redis.Options{Addr: "localhost:6379"}
	}
	rClient := redis.NewClient(rOpts)
	_ = rClient.Ping(ctx)
	log.Println("Connected to Redis cache/pubsub.")

	// 3. MinIO Storage Adapter
	storageClient, err := storageAdapter.NewMinIOAdapter(cfg.MinIOEndpoint, cfg.MinIORootUser, cfg.MinIORootPassword, cfg.MinIOBucket)
	if err != nil {
		log.Printf("Warning: MinIO connection error: %v", err)
	}

	// 4. Instantiating Hexagonal Adapters
	pgRepo := postgres.NewRepository(dbpool)
	redisAdapt := redisAdapter.NewAdapter(rClient)
	clamavScanner := scanner.NewClamAVAdapter("clamav:3310")
	pushAdapter := push.NewPushAdapter("/secrets/fcm.json", "/secrets/apns.p8")

	// 5. Instantiating Services
	jwtManager := auth.NewJWTManager(cfg.JWTSigningSecret)
	chatService := service.NewChatService(pgRepo, pgRepo, pgRepo, pgRepo, pgRepo, redisAdapt, redisAdapt, pushAdapter)
	attService := service.NewAttachmentService(pgRepo, pgRepo, storageClient, clamavScanner)

	// 6. Instantiating WebSocket Hub
	hub := ws.NewHub(chatService, redisAdapt, redisAdapt)

	// 7. Instantiating HTTP Server Router
	srv := transportHTTP.NewServer(jwtManager, pgRepo, chatService, attService, pgRepo, hub)

	httpServer := &http.Server{
		Addr:    ":" + cfg.Port,
		Handler: srv.Router(),
	}

	go func() {
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("HTTP server error: %v", err)
		}
	}()

	log.Printf("Company Chat Server successfully running at http://localhost:%s", cfg.Port)

	// Graceful Shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("Shutting down server gracefully...")

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()

	if err := httpServer.Shutdown(shutdownCtx); err != nil {
		log.Fatalf("Server forced to shutdown: %v", err)
	}

	log.Println("Server exited cleanly.")
}
