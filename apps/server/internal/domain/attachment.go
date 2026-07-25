package domain

import (
	"time"

	"github.com/google/uuid"
)

type ScanStatus string

const (
	ScanPending  ScanStatus = "pending"
	ScanClean    ScanStatus = "clean"
	ScanInfected ScanStatus = "infected"
	ScanError    ScanStatus = "error"
)

type Attachment struct {
	ID         uuid.UUID  `json:"id"`
	MessageID  uuid.UUID  `json:"message_id"`
	FileName   string     `json:"file_name"`
	MimeType   string     `json:"mime_type"`
	SizeBytes  int64      `json:"size_bytes"`
	StorageKey string     `json:"storage_key"`
	ScanStatus ScanStatus `json:"scan_status"`
	UploadedBy uuid.UUID  `json:"uploaded_by"`
	CreatedAt  time.Time  `json:"created_at"`
}
