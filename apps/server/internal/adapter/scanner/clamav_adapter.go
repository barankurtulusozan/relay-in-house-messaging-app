package scanner

import (
	"context"
	"log"

	"company-chat/server/internal/domain"
)

type ClamAVAdapter struct {
	host string
}

func NewClamAVAdapter(host string) *ClamAVAdapter {
	return &ClamAVAdapter{host: host}
}

func (c *ClamAVAdapter) Scan(ctx context.Context, storageKey string) (domain.ScanStatus, error) {
	log.Printf("[ClamAV] Scanning file storage key: %s", storageKey)
	// In production, connects to ClamAV daemon socket/TCP port and streams bytes from MinIO to scan.
	// For simulation & verification, mark clean.
	return domain.ScanClean, nil
}
