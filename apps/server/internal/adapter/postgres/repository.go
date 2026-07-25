package postgres

import (
	"context"
	"errors"
	"time"

	"company-chat/server/internal/domain"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Repository struct {
	pool *pgxpool.Pool
}

func NewRepository(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

// User Repository Implementation
func (r *Repository) UpsertOIDCUser(ctx context.Context, oidcSub, email, name string, avatarURL *string) (*domain.User, error) {
	query := `
		INSERT INTO users (oidc_subject, email, display_name, avatar_url, last_seen_at)
		VALUES ($1, $2, $3, $4, now())
		ON CONFLICT (oidc_subject) DO UPDATE SET
			email = EXCLUDED.email,
			display_name = EXCLUDED.display_name,
			avatar_url = COALESCE(EXCLUDED.avatar_url, users.avatar_url),
			last_seen_at = now()
		RETURNING id, oidc_subject, email, display_name, avatar_url, status, created_at, last_seen_at
	`
	row := r.pool.QueryRow(ctx, query, oidcSub, email, name, avatarURL)

	var u domain.User
	var statusStr string
	err := row.Scan(&u.ID, &u.OIDCSubject, &u.Email, &u.DisplayName, &u.AvatarURL, &statusStr, &u.CreatedAt, &u.LastSeenAt)
	if err != nil {
		return nil, err
	}
	u.Status = domain.UserStatus(statusStr)
	return &u, nil
}

func (r *Repository) GetByID(ctx context.Context, id uuid.UUID) (*domain.User, error) {
	query := `SELECT id, oidc_subject, email, display_name, avatar_url, status, created_at, last_seen_at FROM users WHERE id = $1`
	row := r.pool.QueryRow(ctx, query, id)

	var u domain.User
	var statusStr string
	err := row.Scan(&u.ID, &u.OIDCSubject, &u.Email, &u.DisplayName, &u.AvatarURL, &statusStr, &u.CreatedAt, &u.LastSeenAt)
	if err != nil {
		return nil, err
	}
	u.Status = domain.UserStatus(statusStr)
	return &u, nil
}

func (r *Repository) UpdateStatus(ctx context.Context, id uuid.UUID, status domain.UserStatus) error {
	query := `UPDATE users SET status = $1, last_seen_at = now() WHERE id = $2`
	_, err := r.pool.Exec(ctx, query, string(status), id)
	return err
}

// Conversation Repository Implementation
func (r *Repository) Create(ctx context.Context, conv *domain.Conversation, memberIDs []uuid.UUID) (*domain.Conversation, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	convQuery := `
		INSERT INTO conversations (type, name, created_by)
		VALUES ($1, $2, $3)
		RETURNING id, type, name, created_by, created_at
	`
	var c domain.Conversation
	var typeStr string
	err = tx.QueryRow(ctx, convQuery, string(conv.Type), conv.Name, conv.CreatedBy).Scan(
		&c.ID, &typeStr, &c.Name, &c.CreatedBy, &c.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	c.Type = domain.ConversationType(typeStr)

	memberQuery := `
		INSERT INTO conversation_members (conversation_id, user_id, role)
		VALUES ($1, $2, $3)
	`
	for _, memberID := range memberIDs {
		role := string(domain.RoleMember)
		if memberID == conv.CreatedBy {
			role = string(domain.RoleOwner)
		}
		if _, err := tx.Exec(ctx, memberQuery, c.ID, memberID, role); err != nil {
			return nil, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	return &c, nil
}

func (r *Repository) GetConversationByID(ctx context.Context, id uuid.UUID) (*domain.Conversation, error) {
	query := `SELECT id, type, name, created_by, created_at FROM conversations WHERE id = $1`
	row := r.pool.QueryRow(ctx, query, id)

	var c domain.Conversation
	var typeStr string
	err := row.Scan(&c.ID, &typeStr, &c.Name, &c.CreatedBy, &c.CreatedAt)
	if err != nil {
		return nil, err
	}
	c.Type = domain.ConversationType(typeStr)
	return &c, nil
}

func (r *Repository) GetUserConversations(ctx context.Context, userID uuid.UUID) ([]*domain.Conversation, error) {
	query := `
		SELECT c.id, c.type, c.name, c.created_by, c.created_at
		FROM conversations c
		JOIN conversation_members cm ON c.id = cm.conversation_id
		WHERE cm.user_id = $1
		ORDER BY c.created_at DESC
	`
	rows, err := r.pool.Query(ctx, query, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var conversations []*domain.Conversation
	for rows.Next() {
		var c domain.Conversation
		var typeStr string
		if err := rows.Scan(&c.ID, &typeStr, &c.Name, &c.CreatedBy, &c.CreatedAt); err != nil {
			return nil, err
		}
		c.Type = domain.ConversationType(typeStr)
		conversations = append(conversations, &c)
	}
	return conversations, nil
}

func (r *Repository) IsMember(ctx context.Context, conversationID, userID uuid.UUID) (bool, error) {
	query := `SELECT EXISTS(SELECT 1 FROM conversation_members WHERE conversation_id = $1 AND user_id = $2)`
	var exists bool
	err := r.pool.QueryRow(ctx, query, conversationID, userID).Scan(&exists)
	return exists, err
}

func (r *Repository) GetMembers(ctx context.Context, conversationID uuid.UUID) ([]*domain.ConversationMember, error) {
	query := `
		SELECT cm.conversation_id, cm.user_id, cm.role, cm.joined_at, cm.last_read_message_id,
		       u.id, u.oidc_subject, u.email, u.display_name, u.avatar_url, u.status, u.created_at, u.last_seen_at
		FROM conversation_members cm
		JOIN users u ON cm.user_id = u.id
		WHERE cm.conversation_id = $1
	`
	rows, err := r.pool.Query(ctx, query, conversationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var members []*domain.ConversationMember
	for rows.Next() {
		var cm domain.ConversationMember
		var roleStr string
		var u domain.User
		var statusStr string

		err := rows.Scan(
			&cm.ConversationID, &cm.UserID, &roleStr, &cm.JoinedAt, &cm.LastReadMessageID,
			&u.ID, &u.OIDCSubject, &u.Email, &u.DisplayName, &u.AvatarURL, &statusStr, &u.CreatedAt, &u.LastSeenAt,
		)
		if err != nil {
			return nil, err
		}
		cm.Role = domain.MemberRole(roleStr)
		u.Status = domain.UserStatus(statusStr)
		cm.User = &u
		members = append(members, &cm)
	}
	return members, nil
}

func (r *Repository) AddMember(ctx context.Context, conversationID, userID uuid.UUID, role domain.MemberRole) error {
	query := `
		INSERT INTO conversation_members (conversation_id, user_id, role)
		VALUES ($1, $2, $3)
		ON CONFLICT (conversation_id, user_id) DO NOTHING
	`
	_, err := r.pool.Exec(ctx, query, conversationID, userID, string(role))
	return err
}

func (r *Repository) RemoveMember(ctx context.Context, conversationID, userID uuid.UUID) error {
	query := `DELETE FROM conversation_members WHERE conversation_id = $1 AND user_id = $2`
	_, err := r.pool.Exec(ctx, query, conversationID, userID)
	return err
}

// Message Repository Implementation
func (r *Repository) InsertMessage(ctx context.Context, msg *domain.Message) (*domain.Message, error) {
	query := `
		INSERT INTO messages (id, conversation_id, sender_id, body, reply_to_id, edited_from_id)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (id) DO UPDATE SET id = EXCLUDED.id
		RETURNING id, conversation_id, sender_id, body, reply_to_id, edited_from_id, deleted, created_at, server_seq
	`
	row := r.pool.QueryRow(ctx, query, msg.ID, msg.ConversationID, msg.SenderID, msg.Body, msg.ReplyToID, msg.EditedFromID)

	var m domain.Message
	err := row.Scan(
		&m.ID, &m.ConversationID, &m.SenderID, &m.Body, &m.ReplyToID, &m.EditedFromID, &m.Deleted, &m.CreatedAt, &m.ServerSeq,
	)
	if err != nil {
		return nil, err
	}
	return &m, nil
}

func (r *Repository) GetMessageByID(ctx context.Context, id uuid.UUID) (*domain.Message, error) {
	query := `
		SELECT id, conversation_id, sender_id, body, reply_to_id, edited_from_id, deleted, created_at, server_seq
		FROM messages WHERE id = $1
	`
	row := r.pool.QueryRow(ctx, query, id)

	var m domain.Message
	err := row.Scan(
		&m.ID, &m.ConversationID, &m.SenderID, &m.Body, &m.ReplyToID, &m.EditedFromID, &m.Deleted, &m.CreatedAt, &m.ServerSeq,
	)
	if err != nil {
		return nil, err
	}
	return &m, nil
}

func (r *Repository) GetMessagesSince(ctx context.Context, conversationID uuid.UUID, sinceSeq int64, limit int) ([]*domain.Message, bool, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	query := `
		SELECT m.id, m.conversation_id, m.sender_id, m.body, m.reply_to_id, m.edited_from_id, m.deleted, m.created_at, m.server_seq,
		       u.id, u.oidc_subject, u.email, u.display_name, u.avatar_url, u.status, u.created_at, u.last_seen_at
		FROM messages m
		JOIN users u ON m.sender_id = u.id
		WHERE m.conversation_id = $1 AND m.server_seq > $2
		ORDER BY m.server_seq ASC
		LIMIT $3
	`
	rows, err := r.pool.Query(ctx, query, conversationID, sinceSeq, limit+1)
	if err != nil {
		return nil, false, err
	}
	defer rows.Close()

	var messages []*domain.Message
	for rows.Next() {
		var m domain.Message
		var u domain.User
		var statusStr string
		err := rows.Scan(
			&m.ID, &m.ConversationID, &m.SenderID, &m.Body, &m.ReplyToID, &m.EditedFromID, &m.Deleted, &m.CreatedAt, &m.ServerSeq,
			&u.ID, &u.OIDCSubject, &u.Email, &u.DisplayName, &u.AvatarURL, &statusStr, &u.CreatedAt, &u.LastSeenAt,
		)
		if err != nil {
			return nil, false, err
		}
		u.Status = domain.UserStatus(statusStr)
		m.Sender = &u
		messages = append(messages, &m)
	}

	hasMore := len(messages) > limit
	if hasMore {
		messages = messages[:limit]
	}

	return messages, hasMore, nil
}

func (r *Repository) GetMessagesBefore(ctx context.Context, conversationID uuid.UUID, beforeSeq int64, limit int) ([]*domain.Message, bool, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}

	var query string
	var rows pgx.Rows
	var err error

	if beforeSeq <= 0 {
		query = `
			SELECT m.id, m.conversation_id, m.sender_id, m.body, m.reply_to_id, m.edited_from_id, m.deleted, m.created_at, m.server_seq,
			       u.id, u.oidc_subject, u.email, u.display_name, u.avatar_url, u.status, u.created_at, u.last_seen_at
			FROM messages m
			JOIN users u ON m.sender_id = u.id
			WHERE m.conversation_id = $1
			ORDER BY m.server_seq DESC
			LIMIT $2
		`
		rows, err = r.pool.Query(ctx, query, conversationID, limit+1)
	} else {
		query = `
			SELECT m.id, m.conversation_id, m.sender_id, m.body, m.reply_to_id, m.edited_from_id, m.deleted, m.created_at, m.server_seq,
			       u.id, u.oidc_subject, u.email, u.display_name, u.avatar_url, u.status, u.created_at, u.last_seen_at
			FROM messages m
			JOIN users u ON m.sender_id = u.id
			WHERE m.conversation_id = $1 AND m.server_seq < $2
			ORDER BY m.server_seq DESC
			LIMIT $3
		`
		rows, err = r.pool.Query(ctx, query, conversationID, beforeSeq, limit+1)
	}

	if err != nil {
		return nil, false, err
	}
	defer rows.Close()

	var messages []*domain.Message
	for rows.Next() {
		var m domain.Message
		var u domain.User
		var statusStr string
		err := rows.Scan(
			&m.ID, &m.ConversationID, &m.SenderID, &m.Body, &m.ReplyToID, &m.EditedFromID, &m.Deleted, &m.CreatedAt, &m.ServerSeq,
			&u.ID, &u.OIDCSubject, &u.Email, &u.DisplayName, &u.AvatarURL, &statusStr, &u.CreatedAt, &u.LastSeenAt,
		)
		if err != nil {
			return nil, false, err
		}
		u.Status = domain.UserStatus(statusStr)
		m.Sender = &u
		messages = append(messages, &m)
	}

	hasMore := len(messages) > limit
	if hasMore {
		messages = messages[:limit]
	}

	return messages, hasMore, nil
}

func (r *Repository) SearchMessages(ctx context.Context, conversationID *uuid.UUID, query string, limit int) ([]*domain.Message, error) {
	if limit <= 0 || limit > 50 {
		limit = 20
	}

	var sqlQuery string
	var rows pgx.Rows
	var err error

	if conversationID != nil {
		sqlQuery = `
			SELECT m.id, m.conversation_id, m.sender_id, m.body, m.reply_to_id, m.edited_from_id, m.deleted, m.created_at, m.server_seq,
			       u.id, u.oidc_subject, u.email, u.display_name, u.avatar_url, u.status, u.created_at, u.last_seen_at
			FROM messages m
			JOIN users u ON m.sender_id = u.id
			WHERE m.conversation_id = $1 AND m.search_vector @@ plainto_tsquery('english', $2)
			ORDER BY ts_rank(m.search_vector, plainto_tsquery('english', $2)) DESC
			LIMIT $3
		`
		rows, err = r.pool.Query(ctx, sqlQuery, *conversationID, query, limit)
	} else {
		sqlQuery = `
			SELECT m.id, m.conversation_id, m.sender_id, m.body, m.reply_to_id, m.edited_from_id, m.deleted, m.created_at, m.server_seq,
			       u.id, u.oidc_subject, u.email, u.display_name, u.avatar_url, u.status, u.created_at, u.last_seen_at
			FROM messages m
			JOIN users u ON m.sender_id = u.id
			WHERE m.search_vector @@ plainto_tsquery('english', $1)
			ORDER BY ts_rank(m.search_vector, plainto_tsquery('english', $1)) DESC
			LIMIT $2
		`
		rows, err = r.pool.Query(ctx, sqlQuery, query, limit)
	}

	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var messages []*domain.Message
	for rows.Next() {
		var m domain.Message
		var u domain.User
		var statusStr string
		err := rows.Scan(
			&m.ID, &m.ConversationID, &m.SenderID, &m.Body, &m.ReplyToID, &m.EditedFromID, &m.Deleted, &m.CreatedAt, &m.ServerSeq,
			&u.ID, &u.OIDCSubject, &u.Email, &u.DisplayName, &u.AvatarURL, &statusStr, &u.CreatedAt, &u.LastSeenAt,
		)
		if err != nil {
			return nil, err
		}
		u.Status = domain.UserStatus(statusStr)
		m.Sender = &u
		messages = append(messages, &m)
	}
	return messages, nil
}

// Attachment Repository Implementation
func (r *Repository) CreateAttachment(ctx context.Context, att *domain.Attachment) (*domain.Attachment, error) {
	query := `
		INSERT INTO attachments (message_id, file_name, mime_type, size_bytes, storage_key, scan_status, uploaded_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id, message_id, file_name, mime_type, size_bytes, storage_key, scan_status, uploaded_by, created_at
	`
	row := r.pool.QueryRow(ctx, query, att.MessageID, att.FileName, att.MimeType, att.SizeBytes, att.StorageKey, string(att.ScanStatus), att.UploadedBy)

	var a domain.Attachment
	var statusStr string
	err := row.Scan(&a.ID, &a.MessageID, &a.FileName, &a.MimeType, &a.SizeBytes, &a.StorageKey, &statusStr, &a.UploadedBy, &a.CreatedAt)
	if err != nil {
		return nil, err
	}
	a.ScanStatus = domain.ScanStatus(statusStr)
	return &a, nil
}

func (r *Repository) GetAttachmentByID(ctx context.Context, id uuid.UUID) (*domain.Attachment, error) {
	query := `SELECT id, message_id, file_name, mime_type, size_bytes, storage_key, scan_status, uploaded_by, created_at FROM attachments WHERE id = $1`
	row := r.pool.QueryRow(ctx, query, id)

	var a domain.Attachment
	var statusStr string
	err := row.Scan(&a.ID, &a.MessageID, &a.FileName, &a.MimeType, &a.SizeBytes, &a.StorageKey, &statusStr, &a.UploadedBy, &a.CreatedAt)
	if err != nil {
		return nil, err
	}
	a.ScanStatus = domain.ScanStatus(statusStr)
	return &a, nil
}

func (r *Repository) UpdateScanStatus(ctx context.Context, id uuid.UUID, status domain.ScanStatus) error {
	query := `UPDATE attachments SET scan_status = $1 WHERE id = $2`
	_, err := r.pool.Exec(ctx, query, string(status), id)
	return err
}

// Device Repository Implementation
func (r *Repository) RegisterDevice(ctx context.Context, device *domain.Device) (*domain.Device, error) {
	query := `
		INSERT INTO devices (user_id, platform, push_token, last_active_at)
		VALUES ($1, $2, $3, now())
		RETURNING id, user_id, platform, push_token, last_active_at, created_at
	`
	row := r.pool.QueryRow(ctx, query, device.UserID, string(device.Platform), device.PushToken)

	var d domain.Device
	var pStr string
	err := row.Scan(&d.ID, &d.UserID, &pStr, &d.PushToken, &d.LastActiveAt, &d.CreatedAt)
	if err != nil {
		return nil, err
	}
	d.Platform = domain.Platform(pStr)
	return &d, nil
}

func (r *Repository) GetUserDevices(ctx context.Context, userID uuid.UUID) ([]*domain.Device, error) {
	query := `SELECT id, user_id, platform, push_token, last_active_at, created_at FROM devices WHERE user_id = $1`
	rows, err := r.pool.Query(ctx, query, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var devices []*domain.Device
	for rows.Next() {
		var d domain.Device
		var pStr string
		if err := rows.Scan(&d.ID, &d.UserID, &pStr, &d.PushToken, &d.LastActiveAt, &d.CreatedAt); err != nil {
			return nil, err
		}
		d.Platform = domain.Platform(pStr)
		devices = append(devices, &d)
	}
	return devices, nil
}

func (r *Repository) DeleteDevice(ctx context.Context, id uuid.UUID, userID uuid.UUID) error {
	query := `DELETE FROM devices WHERE id = $1 AND user_id = $2`
	_, err := r.pool.Exec(ctx, query, id, userID)
	return err
}

// Read Receipt Repository Implementation
func (r *Repository) UpsertReceipt(ctx context.Context, conversationID, userID, messageID uuid.UUID) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	receiptQuery := `
		INSERT INTO read_receipts (conversation_id, user_id, message_id, read_at)
		VALUES ($1, $2, $3, now())
		ON CONFLICT (conversation_id, user_id) DO UPDATE SET
			message_id = EXCLUDED.message_id,
			read_at = now()
	`
	if _, err := tx.Exec(ctx, receiptQuery, conversationID, userID, messageID); err != nil {
		return err
	}

	memberCursorQuery := `
		UPDATE conversation_members
		SET last_read_message_id = $3
		WHERE conversation_id = $1 AND user_id = $2
	`
	if _, err := tx.Exec(ctx, memberCursorQuery, conversationID, userID, messageID); err != nil {
		return err
	}

	return tx.Commit(ctx)
}
