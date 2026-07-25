package service

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"company-chat/server/internal/domain"

	"github.com/google/uuid"
)

type AttachmentService struct {
	attRepo     domain.AttachmentRepository
	convRepo    domain.ConversationRepository
	storage     domain.ObjectStorage
	fileScanner domain.FileScanner
}

func NewAttachmentService(
	attRepo domain.AttachmentRepository,
	convRepo domain.ConversationRepository,
	storage domain.ObjectStorage,
	fileScanner domain.FileScanner,
) *AttachmentService {
	return &AttachmentService{
		attRepo:     attRepo,
		convRepo:    convRepo,
		storage:     storage,
		fileScanner: fileScanner,
	}
}

var allowedMimeTypes = map[string]bool{
	"application/pdf":                                                   true,
	"image/png":                                                         true,
	"image/jpeg":                                                        true,
	"image/gif":                                                         true,
	"image/webp":                                                        true,
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": true,
	"application/vnd.ms-excel":                                          true,
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document": true,
	"text/csv":                                                          true,
	"text/plain":                                                        true,
}

func (s *AttachmentService) PresignUpload(ctx context.Context, userID uuid.UUID, messageID uuid.UUID, fileName, mimeType string, sizeBytes int64) (string, string, uuid.UUID, error) {
	// Validate MIME type
	if !allowedMimeTypes[strings.ToLower(mimeType)] {
		return "", "", uuid.Nil, errors.New("unsupported or unsafe file type")
	}

	// Max 50MB
	if sizeBytes > 50*1024*1024 {
		return "", "", uuid.Nil, errors.New("file size exceeds 50MB limit")
	}

	storageKey := fmt.Sprintf("attachments/%s/%s-%s", userID.String(), uuid.New().String(), fileName)

	// Presign PUT URL (valid 15 minutes)
	presignedURL, err := s.storage.GeneratePresignedPutURL(ctx, storageKey, mimeType, 900)
	if err != nil {
		return "", "", uuid.Nil, err
	}

	att := &domain.Attachment{
		MessageID:  messageID,
		FileName:   fileName,
		MimeType:   mimeType,
		SizeBytes:  sizeBytes,
		StorageKey: storageKey,
		ScanStatus: domain.ScanPending,
		UploadedBy: userID,
	}

	savedAtt, err := s.attRepo.Create(ctx, att)
	if err != nil {
		return "", "", uuid.Nil, err
	}

	return presignedURL, storageKey, savedAtt.ID, nil
}

func (s *AttachmentService) CompleteUpload(ctx context.Context, userID, attachmentID uuid.UUID) error {
	att, err := s.attRepo.GetByID(ctx, attachmentID)
	if err != nil {
		return err
	}

	if att.UploadedBy != userID {
		return errors.New("unauthorized: upload owner mismatch")
	}

	// Trigger virus scan asynchronously
	go func() {
		status, err := s.fileScanner.Scan(context.Background(), att.StorageKey)
		if err != nil {
			_ = s.attRepo.UpdateScanStatus(context.Background(), attachmentID, domain.ScanError)
			return
		}
		_ = s.attRepo.UpdateScanStatus(context.Background(), attachmentID, status)
	}()

	return nil
}

func (s *AttachmentService) GetDownloadURL(ctx context.Context, userID, attachmentID uuid.UUID) (string, error) {
	att, err := s.attRepo.GetByID(ctx, attachmentID)
	if err != nil {
		return "", err
	}

	if att.ScanStatus == domain.ScanInfected {
		return "", errors.New("file marked infected by scanner")
	}

	// Presign GET URL (valid 5 minutes)
	return s.storage.GeneratePresignedGetURL(ctx, att.StorageKey, 300)
}
