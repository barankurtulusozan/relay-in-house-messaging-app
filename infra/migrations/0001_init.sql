-- Migration: 0001_init.sql
-- Description: Initial schema for Company Chat App

-- Users (synced from OIDC provider on first login)
CREATE TABLE IF NOT EXISTS users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    oidc_subject    TEXT UNIQUE NOT NULL,      -- 'sub' claim from identity provider
    email           TEXT UNIQUE NOT NULL,
    display_name    TEXT NOT NULL,
    avatar_url      TEXT,
    status          TEXT NOT NULL DEFAULT 'offline', -- 'online' | 'away' | 'offline'
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at    TIMESTAMPTZ
);

-- Devices (for push notifications, multi-device support)
CREATE TABLE IF NOT EXISTS devices (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform        TEXT NOT NULL,             -- 'ios' | 'android' | 'web'
    push_token      TEXT,
    last_active_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Conversations (1:1 or group)
CREATE TABLE IF NOT EXISTS conversations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type            TEXT NOT NULL,             -- 'direct' | 'group'
    name            TEXT,                       -- null for 'direct'
    created_by      UUID NOT NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Membership (who is in which conversation)
CREATE TABLE IF NOT EXISTS conversation_members (
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role            TEXT NOT NULL DEFAULT 'member', -- 'owner' | 'admin' | 'member'
    joined_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_read_message_id UUID,                 -- cursor for unread count / read receipts
    PRIMARY KEY (conversation_id, user_id)
);

-- Messages (append-only; edits/deletes are new rows referencing original)
CREATE TABLE IF NOT EXISTS messages (
    id              UUID PRIMARY KEY,          -- CLIENT-GENERATED (idempotency key for offline retry)
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id       UUID NOT NULL REFERENCES users(id),
    body            TEXT,                       -- nullable if message is attachment-only
    reply_to_id     UUID REFERENCES messages(id),
    edited_from_id  UUID REFERENCES messages(id), -- points to original if this is an edit
    deleted         BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    server_seq      BIGSERIAL,                  -- monotonic ordering cursor, used for sync
    search_vector   TSVECTOR                    -- full-text search
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_seq ON messages(conversation_id, server_seq);
CREATE INDEX IF NOT EXISTS idx_messages_search ON messages USING GIN(search_vector);

-- Trigger to keep search_vector updated
CREATE OR REPLACE FUNCTION messages_search_trigger() RETURNS trigger AS $$
BEGIN
  NEW.search_vector := to_tsvector('english', coalesce(NEW.body, ''));
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS messages_search_update ON messages;
CREATE TRIGGER messages_search_update
BEFORE INSERT OR UPDATE ON messages
FOR EACH ROW EXECUTE FUNCTION messages_search_trigger();

-- Attachments (metadata only; bytes live in MinIO)
CREATE TABLE IF NOT EXISTS attachments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id      UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    file_name       TEXT NOT NULL,
    mime_type       TEXT NOT NULL,
    size_bytes      BIGINT NOT NULL,
    storage_key     TEXT NOT NULL,              -- MinIO object key
    scan_status     TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'clean' | 'infected' | 'error'
    uploaded_by     UUID NOT NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Read receipts
CREATE TABLE IF NOT EXISTS read_receipts (
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message_id      UUID NOT NULL REFERENCES messages(id),
    read_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (conversation_id, user_id)
);
