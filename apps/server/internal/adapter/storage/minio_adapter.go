package storage

import (
	"context"
	"net/url"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

type MinIOAdapter struct {
	client     *minio.Client
	bucketName string
}

func NewMinIOAdapter(endpoint, accessKey, secretKey, bucketName string) (*MinIOAdapter, error) {
	client, err := minio.New(endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(accessKey, secretKey, ""),
		Secure: false,
	})
	if err != nil {
		return nil, err
	}

	return &MinIOAdapter{
		client:     client,
		bucketName: bucketName,
	}, nil
}

func (m *MinIOAdapter) GeneratePresignedPutURL(ctx context.Context, storageKey, mimeType string, expiresSec int) (string, error) {
	expiry := time.Duration(expiresSec) * time.Second
	u, err := m.client.PresignedPutObject(ctx, m.bucketName, storageKey, expiry)
	if err != nil {
		return "", err
	}
	return u.String(), nil
}

func (m *MinIOAdapter) GeneratePresignedGetURL(ctx context.Context, storageKey string, expiresSec int) (string, error) {
	expiry := time.Duration(expiresSec) * time.Second
	reqParams := make(url.Values)
	u, err := m.client.PresignedGetObject(ctx, m.bucketName, storageKey, expiry, reqParams)
	if err != nil {
		return "", err
	}
	return u.String(), nil
}
