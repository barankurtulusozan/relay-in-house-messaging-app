-- Migration: 0002_user_search_and_group_roles.sql
-- Enables fast user discovery and role-based conversation indexing

-- 1. Enable pg_trgm extension for fast trigram search if available
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 2. Trigram Index on users for ultra-fast ILIKE searches
CREATE INDEX IF NOT EXISTS idx_users_search_trgm 
ON users USING gin (display_name gin_trgm_ops, email gin_trgm_ops);

-- 3. Composite Index for User Conversation Lookup & Role Authorization Checks
CREATE INDEX IF NOT EXISTS idx_conversation_members_user_conv 
ON conversation_members(user_id, conversation_id);

CREATE INDEX IF NOT EXISTS idx_conversation_members_conv_role 
ON conversation_members(conversation_id, role);
