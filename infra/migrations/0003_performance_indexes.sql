-- Migration: 0003_performance_indexes.sql
-- Description: Targeted indexes for push devices, attachments, and message creation timestamps

-- 1. Index on devices table by user_id for fast push token lookups
CREATE INDEX IF NOT EXISTS idx_devices_user_id 
ON devices(user_id);

-- 2. Index on attachments table by message_id for fast attachment queries
CREATE INDEX IF NOT EXISTS idx_attachments_message_id 
ON attachments(message_id);

-- 3. Index on messages created_at for fast time-based scans
CREATE INDEX IF NOT EXISTS idx_messages_created_at 
ON messages(created_at DESC);
