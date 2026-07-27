package http

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"company-chat/server/internal/auth"
	"company-chat/server/internal/config"
	"company-chat/server/internal/domain"
	"company-chat/server/internal/service"
	"company-chat/server/internal/transport/ws"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/google/uuid"
	"nhooyr.io/websocket"
)

type Server struct {
	cfg               *config.Config
	router            *chi.Mux
	jwtManager        *auth.JWTManager
	userRepo          domain.UserRepository
	chatService       *service.ChatService
	attachmentService *service.AttachmentService
	deviceRepo        domain.DeviceRepository
	hub               *ws.Hub
}

func NewServer(
	cfg *config.Config,
	jwtManager *auth.JWTManager,
	userRepo domain.UserRepository,
	chatService *service.ChatService,
	attachmentService *service.AttachmentService,
	deviceRepo domain.DeviceRepository,
	hub *ws.Hub,
) *Server {
	s := &Server{
		cfg:               cfg,
		router:            chi.NewRouter(),
		jwtManager:        jwtManager,
		userRepo:          userRepo,
		chatService:       chatService,
		attachmentService: attachmentService,
		deviceRepo:        deviceRepo,
		hub:               hub,
	}

	s.setupRoutes()
	return s
}

func (s *Server) Router() *chi.Mux {
	return s.router
}

func (s *Server) setupRoutes() {
	r := s.router

	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)

	corsOrigins := s.cfg.AllowedCORSOrigins
	if len(corsOrigins) == 0 {
		corsOrigins = []string{"http://localhost:3000", "http://localhost:8081"}
	}

	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   corsOrigins,
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type"},
		AllowCredentials: true,
	}))

	// Health Check Endpoint
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		jsonResponse(w, map[string]string{"status": "ok"})
	})

	// WebSocket Endpoint (Protected with WS Origin Patterns)
	r.Get("/ws", s.handleWebSocket)

	// Dev Auth Endpoint (Rate Limited & Production Guarded)
	r.With(RateLimitMiddleware(10, time.Minute)).Post("/api/auth/login", s.handleLogin)

	// Protected REST API Group
	r.Group(func(r chi.Router) {
		r.Use(AuthMiddleware(s.jwtManager))

		r.Get("/api/me", s.handleGetMe)

		// Users (Rate Limited)
		r.With(RateLimitMiddleware(30, time.Minute)).Get("/api/users/search", s.handleSearchUsers)

		// Conversations
		r.Get("/api/conversations", s.handleGetConversations)
		r.Post("/api/conversations", s.handleCreateConversation)
		r.Put("/api/conversations/{id}/name", s.handleUpdateConversationName)
		r.Get("/api/conversations/{id}/messages", s.handleGetMessages)
		r.Get("/api/conversations/{id}/members", s.handleGetMembers)
		r.Post("/api/conversations/{id}/members", s.handleAddMember)
		r.Delete("/api/conversations/{id}/members/{userId}", s.handleRemoveMember)

		// Attachments
		r.Post("/api/attachments/presign", s.handlePresignAttachment)
		r.Post("/api/attachments/{id}/complete", s.handleCompleteAttachment)
		r.Get("/api/attachments/{id}/download", s.handleDownloadAttachment)

		// Devices
		r.Post("/api/devices", s.handleRegisterDevice)
		r.Delete("/api/devices/{id}", s.handleDeleteDevice)

		// Search
		r.Get("/api/search", s.handleSearch)
	})
}

func (s *Server) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	opts := &websocket.AcceptOptions{}
	if len(s.cfg.AllowedWSOrigins) > 0 {
		opts.OriginPatterns = s.cfg.AllowedWSOrigins
	} else if s.cfg.IsProduction() {
		opts.OriginPatterns = []string{"*.company.com"}
	} else {
		// In dev, accept localhost & LAN patterns safely
		opts.OriginPatterns = []string{"localhost:*", "127.0.0.1:*", "192.168.*:*", "10.*:*"}
	}

	conn, err := websocket.Accept(w, r, opts)
	if err != nil {
		return
	}

	client := ws.NewClient(s.hub, conn, s.jwtManager)
	go client.ReadLoop(r.Context())
}

type LoginRequest struct {
	OIDCSubject string  `json:"oidc_subject"`
	Email       string  `json:"email"`
	DisplayName string  `json:"display_name"`
	AvatarURL   *string `json:"avatar_url"`
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	if s.cfg.IsProduction() {
		http.Error(w, `{"error":"development authentication disabled in production"}`, http.StatusForbidden)
		return
	}

	var req LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid request"}`, http.StatusBadRequest)
		return
	}

	if req.OIDCSubject == "" || req.Email == "" {
		http.Error(w, `{"error":"oidc_subject and email are required"}`, http.StatusBadRequest)
		return
	}

	user, err := s.userRepo.UpsertOIDCUser(r.Context(), req.OIDCSubject, req.Email, req.DisplayName, req.AvatarURL)
	if err != nil {
		http.Error(w, `{"error":"failed to upsert user"}`, http.StatusInternalServerError)
		return
	}

	token, err := s.jwtManager.GenerateToken(user.ID, user.Email, 24*365*time.Hour)
	if err != nil {
		http.Error(w, `{"error":"failed to generate token"}`, http.StatusInternalServerError)
		return
	}

	jsonResponse(w, map[string]interface{}{
		"token": token,
		"user":  user,
	})
}

func (s *Server) handleGetMe(w http.ResponseWriter, r *http.Request) {
	userID, _ := config.GetUserIDFromContext(r.Context())
	user, err := s.userRepo.GetUserByID(r.Context(), userID)
	if err != nil {
		http.Error(w, `{"error":"user not found"}`, http.StatusNotFound)
		return
	}
	jsonResponse(w, user)
}

func (s *Server) handleSearchUsers(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	users, err := s.userRepo.SearchUsers(r.Context(), q, 20)
	if err != nil {
		http.Error(w, `{"error":"failed to search users"}`, http.StatusInternalServerError)
		return
	}
	jsonResponse(w, users)
}

func (s *Server) handleGetConversations(w http.ResponseWriter, r *http.Request) {
	userID, _ := config.GetUserIDFromContext(r.Context())
	convs, err := s.chatService.GetUserConversations(r.Context(), userID)
	if err != nil {
		http.Error(w, `{"error":"failed to fetch conversations"}`, http.StatusInternalServerError)
		return
	}
	jsonResponse(w, convs)
}

type CreateConversationRequest struct {
	Type      domain.ConversationType `json:"type"`
	Name      *string                 `json:"name"`
	MemberIDs []uuid.UUID             `json:"member_ids"`
}

func (s *Server) handleCreateConversation(w http.ResponseWriter, r *http.Request) {
	userID, _ := config.GetUserIDFromContext(r.Context())

	var req CreateConversationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid request"}`, http.StatusBadRequest)
		return
	}

	conv, err := s.chatService.CreateConversation(r.Context(), userID, req.Type, req.Name, req.MemberIDs)
	if err != nil {
		http.Error(w, `{"error":"failed to create conversation"}`, http.StatusInternalServerError)
		return
	}
	jsonResponse(w, conv)
}

type UpdateConversationNameRequest struct {
	Name string `json:"name"`
}

func (s *Server) handleUpdateConversationName(w http.ResponseWriter, r *http.Request) {
	userID, _ := config.GetUserIDFromContext(r.Context())
	convID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, `{"error":"invalid conversation id"}`, http.StatusBadRequest)
		return
	}

	var req UpdateConversationNameRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Name == "" {
		http.Error(w, `{"error":"invalid request name"}`, http.StatusBadRequest)
		return
	}

	if err := s.chatService.UpdateConversationName(r.Context(), convID, userID, req.Name); err != nil {
		http.Error(w, `{"error":"failed to update conversation name"}`, http.StatusInternalServerError)
		return
	}

	jsonResponse(w, map[string]string{"status": "ok"})
}

func (s *Server) handleGetMessages(w http.ResponseWriter, r *http.Request) {
	userID, _ := config.GetUserIDFromContext(r.Context())
	convID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, `{"error":"invalid conversation id"}`, http.StatusBadRequest)
		return
	}

	beforeSeq, _ := strconv.ParseInt(r.URL.Query().Get("before_seq"), 10, 64)
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))

	messages, hasMore, err := s.chatService.GetMessagesBefore(r.Context(), userID, convID, beforeSeq, limit)
	if err != nil {
		http.Error(w, `{"error":"`+err.Error()+`"}`, http.StatusForbidden)
		return
	}

	jsonResponse(w, map[string]interface{}{
		"messages": messages,
		"has_more": hasMore,
	})
}

func (s *Server) handleGetMembers(w http.ResponseWriter, r *http.Request) {
	userID, _ := config.GetUserIDFromContext(r.Context())
	convID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, `{"error":"invalid conversation id"}`, http.StatusBadRequest)
		return
	}

	members, err := s.chatService.GetConversationMembers(r.Context(), convID, userID)
	if err != nil {
		http.Error(w, `{"error":"`+err.Error()+`"}`, http.StatusForbidden)
		return
	}
	jsonResponse(w, members)
}

type AddMemberRequest struct {
	UserID uuid.UUID         `json:"user_id"`
	Role   domain.MemberRole `json:"role"`
}

func (s *Server) handleAddMember(w http.ResponseWriter, r *http.Request) {
	actorID, _ := config.GetUserIDFromContext(r.Context())
	convID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, `{"error":"invalid conversation id"}`, http.StatusBadRequest)
		return
	}

	var req AddMemberRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.UserID == uuid.Nil {
		http.Error(w, `{"error":"invalid request parameters"}`, http.StatusBadRequest)
		return
	}

	if err := s.chatService.AddGroupMember(r.Context(), convID, actorID, req.UserID, req.Role); err != nil {
		http.Error(w, `{"error":"`+err.Error()+`"}`, http.StatusForbidden)
		return
	}

	jsonResponse(w, map[string]string{"status": "ok"})
}

func (s *Server) handleRemoveMember(w http.ResponseWriter, r *http.Request) {
	actorID, _ := config.GetUserIDFromContext(r.Context())
	convID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, `{"error":"invalid conversation id"}`, http.StatusBadRequest)
		return
	}

	targetUserID, err := uuid.Parse(chi.URLParam(r, "userId"))
	if err != nil {
		http.Error(w, `{"error":"invalid target user id"}`, http.StatusBadRequest)
		return
	}

	if err := s.chatService.RemoveGroupMember(r.Context(), convID, actorID, targetUserID); err != nil {
		http.Error(w, `{"error":"`+err.Error()+`"}`, http.StatusForbidden)
		return
	}

	jsonResponse(w, map[string]string{"status": "ok"})
}

type PresignRequest struct {
	MessageID uuid.UUID `json:"message_id"`
	FileName  string    `json:"file_name"`
	MimeType  string    `json:"mime_type"`
	SizeBytes int64     `json:"size_bytes"`
}

func (s *Server) handlePresignAttachment(w http.ResponseWriter, r *http.Request) {
	userID, _ := config.GetUserIDFromContext(r.Context())

	var req PresignRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid request"}`, http.StatusBadRequest)
		return
	}

	presignedURL, key, attID, err := s.attachmentService.PresignUpload(r.Context(), userID, req.MessageID, req.FileName, req.MimeType, req.SizeBytes)
	if err != nil {
		http.Error(w, `{"error":"`+err.Error()+`"}`, http.StatusBadRequest)
		return
	}

	jsonResponse(w, map[string]interface{}{
		"upload_url":    presignedURL,
		"storage_key":   key,
		"attachment_id": attID,
	})
}

func (s *Server) handleCompleteAttachment(w http.ResponseWriter, r *http.Request) {
	userID, _ := config.GetUserIDFromContext(r.Context())
	attID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, `{"error":"invalid attachment id"}`, http.StatusBadRequest)
		return
	}

	if err := s.attachmentService.CompleteUpload(r.Context(), userID, attID); err != nil {
		http.Error(w, `{"error":"`+err.Error()+`"}`, http.StatusBadRequest)
		return
	}

	jsonResponse(w, map[string]string{"status": "ok"})
}

func (s *Server) handleDownloadAttachment(w http.ResponseWriter, r *http.Request) {
	userID, _ := config.GetUserIDFromContext(r.Context())
	attID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, `{"error":"invalid attachment id"}`, http.StatusBadRequest)
		return
	}

	downloadURL, err := s.attachmentService.GetDownloadURL(r.Context(), userID, attID)
	if err != nil {
		http.Error(w, `{"error":"`+err.Error()+`"}`, http.StatusBadRequest)
		return
	}

	http.Redirect(w, r, downloadURL, http.StatusFound)
}

type RegisterDeviceRequest struct {
	Platform  domain.Platform `json:"platform"`
	PushToken *string         `json:"push_token"`
}

func (s *Server) handleRegisterDevice(w http.ResponseWriter, r *http.Request) {
	userID, _ := config.GetUserIDFromContext(r.Context())

	var req RegisterDeviceRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid request"}`, http.StatusBadRequest)
		return
	}

	device, err := s.deviceRepo.RegisterDevice(r.Context(), &domain.Device{
		UserID:    userID,
		Platform:  req.Platform,
		PushToken: req.PushToken,
	})
	if err != nil {
		http.Error(w, `{"error":"failed to register device"}`, http.StatusInternalServerError)
		return
	}

	jsonResponse(w, device)
}

func (s *Server) handleDeleteDevice(w http.ResponseWriter, r *http.Request) {
	userID, _ := config.GetUserIDFromContext(r.Context())
	devID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, `{"error":"invalid device id"}`, http.StatusBadRequest)
		return
	}

	if err := s.deviceRepo.DeleteDevice(r.Context(), devID, userID); err != nil {
		http.Error(w, `{"error":"failed to delete device"}`, http.StatusInternalServerError)
		return
	}
	jsonResponse(w, map[string]string{"status": "ok"})
}

func (s *Server) handleSearch(w http.ResponseWriter, r *http.Request) {
	userID, _ := config.GetUserIDFromContext(r.Context())
	q := r.URL.Query().Get("q")
	if q == "" {
		http.Error(w, `{"error":"query param q is required"}`, http.StatusBadRequest)
		return
	}

	var convID *uuid.UUID
	if cidStr := r.URL.Query().Get("conversation_id"); cidStr != "" {
		if id, err := uuid.Parse(cidStr); err == nil {
			convID = &id
		}
	}

	messages, err := s.chatService.Search(r.Context(), userID, convID, q, 20)
	if err != nil {
		http.Error(w, `{"error":"`+err.Error()+`"}`, http.StatusInternalServerError)
		return
	}
	jsonResponse(w, messages)
}

func jsonResponse(w http.ResponseWriter, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(data)
}
