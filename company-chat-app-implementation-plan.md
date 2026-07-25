# Company Chat App — Implementation Plan

**Target scale:** 1–150 employees
**Deployment:** Self-hosted VPS (2 machines: primary + replica/backup)
**Encryption:** Transport (TLS 1.3) + at-rest (encrypted volumes/objects) — server can index/search/moderate
**Stack:** Go backend, PostgreSQL, Redis, MinIO, Next.js (web), React Native (mobile)

This document is written to be handed directly to a code-generation agent (e.g. Antigravity). Each section is scoped so it can be implemented and verified independently. Follow the phase order — later phases depend on schemas/contracts defined in earlier ones.

---

## 1. System Overview

A company-internal chat application supporting 1:1 and group messaging, file attachments (upload/download only, no in-app preview), presence, typing indicators, read receipts, and offline-first mobile/web clients, backed by SSO authentication.

### 1.1 Components

| Component | Technology | Responsibility |
|---|---|---|
| `web` | Next.js 14+ (App Router), TypeScript | Web client |
| `mobile` | React Native (Expo bare or CLI), TypeScript | iOS/Android client |
| `shared` | TypeScript package | Shared types, API client, offline sync state machine |
| `server` | Go 1.22+ | REST API + WebSocket gateway, single binary |
| `db` | PostgreSQL 16 | Source of truth for all persistent data |
| `cache` | Redis 7 | Presence, pub/sub, ephemeral typing state, token blacklist |
| `storage` | MinIO | S3-compatible object storage for attachments |
| `proxy` | Caddy 2 | TLS termination, reverse proxy, auto Let's Encrypt |
| `push` | FCM (Android) / APNs (iOS) | Background push notifications |

### 1.2 Repository Layout (monorepo)

```
company-chat/
├── apps/
│   ├── web/                 # Next.js app
│   ├── mobile/               # React Native app
│   └── server/               # Go backend
├── packages/
│   └── shared/                # TS types, API client, sync engine (consumed by web + mobile)
├── infra/
│   ├── docker-compose.yml
│   ├── docker-compose.prod.yml
│   ├── Caddyfile
│   ├── migrations/            # SQL migration files (golang-migrate format)
│   └── backup/                # backup scripts (restic/borg)
├── .env.example
└── README.md
```

---

## 2. Database Schema (PostgreSQL)

Use `golang-migrate` or `goose` for versioned migrations. Place files in `infra/migrations/0001_init.sql`, etc.

```sql
-- Users (synced from OIDC provider on first login)
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    oidc_subject    TEXT UNIQUE NOT NULL,      -- 'sub' claim from identity provider
    email           TEXT UNIQUE NOT NULL,
    display_name    TEXT NOT NULL,
    avatar_url      TEXT,
    status          TEXT NOT NULL DEFAULT 'offline', -- 'online' | 'away' | 'offline' (mirrored from Redis on read, this column is a fallback)
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at    TIMESTAMPTZ
);

-- Devices (for push notifications, multi-device support)
CREATE TABLE devices (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform        TEXT NOT NULL,             -- 'ios' | 'android' | 'web'
    push_token      TEXT,
    last_active_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Conversations (1:1 or group)
CREATE TABLE conversations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type            TEXT NOT NULL,             -- 'direct' | 'group'
    name            TEXT,                       -- null for 'direct'
    created_by      UUID NOT NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Membership (who is in which conversation)
CREATE TABLE conversation_members (
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role            TEXT NOT NULL DEFAULT 'member', -- 'owner' | 'admin' | 'member'
    joined_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_read_message_id UUID,                 -- cursor for unread count / read receipts
    PRIMARY KEY (conversation_id, user_id)
);

-- Messages (append-only; edits/deletes are new rows referencing original)
CREATE TABLE messages (
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

CREATE INDEX idx_messages_conversation_seq ON messages(conversation_id, server_seq);
CREATE INDEX idx_messages_search ON messages USING GIN(search_vector);

-- Trigger to keep search_vector updated
CREATE FUNCTION messages_search_trigger() RETURNS trigger AS $$
BEGIN
  NEW.search_vector := to_tsvector('english', coalesce(NEW.body, ''));
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER messages_search_update
BEFORE INSERT OR UPDATE ON messages
FOR EACH ROW EXECUTE FUNCTION messages_search_trigger();

-- Attachments (metadata only; bytes live in MinIO)
CREATE TABLE attachments (
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

-- Read receipts (per-user, per-conversation cursor is enough; per-message optional if you want granular receipts)
CREATE TABLE read_receipts (
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message_id      UUID NOT NULL REFERENCES messages(id),
    read_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (conversation_id, user_id)
);
```

**Design notes for the implementing agent:**
- `messages.id` is generated **client-side** (UUIDv4 or ULID) before send. Server does `INSERT ... ON CONFLICT (id) DO NOTHING` — this makes retries from the offline outbox idempotent by construction.
- `server_seq` (BIGSERIAL) is the authoritative ordering + sync cursor. Clients store `last_synced_seq` per conversation locally and request `WHERE conversation_id = $1 AND server_seq > $2` on reconnect.
- Never `DELETE` or destructively `UPDATE` message rows from user actions — write edit/delete as new state, keep history queryable for compliance.

---

## 3. Backend (Go) — Architecture, Structure & Responsibilities

The backend follows **Hexagonal / Clean Architecture** principles to satisfy SOLID (Single Responsibility, Open/Closed, Dependency Inversion). 

### 3.1 SOLID Dependency Direction & Package Layout

Inner domain logic and application use-cases **must not depend on** frameworks, HTTP routers, database drivers (`pgx`), or specific third-party SDKs (`go-redis`, `minio-go`, `fcm`). All infrastructure and transport components are adapters implementing inner domain ports.

```
apps/server/
├── cmd/server/main.go          # Wire dependencies, initialize adapters & start transport servers
├── internal/
│   ├── domain/                 # Core Domain Entities, Rules & Interfaces (Zero external dependencies)
│   │   ├── message.go          # Message aggregate & business invariants
│   │   ├── conversation.go     # Conversation aggregate & membership rules
│   │   ├── user.go             # User identity entity
│   │   └── ports.go            # Primary & Secondary Interfaces (DIP & OCP enforcement)
│   │
│   ├── service/                # Application Use Cases & Workflows
│   │   ├── chat_service.go     # Message creation, validation, transaction management
│   │   ├── sync_service.go     # Catch-up sync logic
│   │   └── attachment_service.go # Presigned URL workflow & scan orchestration
│   │
│   ├── adapter/                # Infrastructure Adapters (Implements domain/ports.go)
│   │   ├── postgres/           # sqlc-generated queries & Repository implementations
│   │   ├── redis/              # Presence store & Pub/Sub event bus implementation
│   │   ├── storage/            # MinIO presigned URL generator & object storage adapter
│   │   ├── scanner/            # FileScanner implementation (ClamAV socket / mock scanner)
│   │   └── push/               # PushNotifier implementation (FCM, APNs provider adapters)
│   │
│   ├── transport/              # Delivery / Inbound Adapters (Invokes service layer)
│   │   ├── http/               # Chi router, REST handlers, Auth middleware
│   │   └── ws/                 # WebSocket connection hub, ping/pong, frame router
│   │
│   ├── auth/                   # OIDC token verification & JWT manager
│   └── config/                 # Env configuration loading
├── go.mod
└── Dockerfile
```

### 3.2 Key Domain Ports (Interfaces)

To guarantee **Open/Closed (OCP)** and **Dependency Inversion (DIP)**, the domain defines strict interfaces:

```go
// internal/domain/ports.go

// Repository Ports (Implemented by adapter/postgres)
type MessageRepository interface {
    InsertMessage(ctx context.Context, msg *Message) (*Message, error)
    GetMessagesSince(ctx context.Context, conversationID uuid.UUID, sinceSeq int64, limit int) ([]*Message, error)
}

type ConversationRepository interface {
    IsMember(ctx context.Context, conversationID, userID uuid.UUID) (bool, error)
}

// Event Publisher Port (Implemented by adapter/redis - Decouples chat.Service from ws.Hub)
type EventPublisher interface {
    PublishUserEvent(ctx context.Context, userID uuid.UUID, event *DomainEvent) error
    SubscribeUserEvents(ctx context.Context, userID uuid.UUID) (<-chan *DomainEvent, error)
}

// Push Notification Port (Implemented by adapter/push - Multi-provider OCP)
type PushNotifier interface {
    SendPush(ctx context.Context, targetDevice Device, notification PushNotification) error
}

// Virus Scanner Port (Implemented by adapter/scanner - Decouples ClamAV socket calls)
type FileScanner interface {
    Scan(ctx context.Context, storageKey string) (ScanStatus, error)
}
```

### 3.3 Recommended Libraries & Dependencies

- **HTTP router:** `chi` (lightweight, stdlib-compatible)
- **WebSocket:** `nhooyr.io/websocket` (modern, context-aware, simpler API than gorilla)
- **Postgres driver:** `pgx/v5` + `sqlc` for typed query generation from raw SQL (keeps SQL visible and reviewable, avoids ORM magic)
- **Redis:** `go-redis/v9`
- **OIDC:** `coreos/go-oidc` + `golang-jwt/jwt/v5`
- **MinIO:** official `minio-go` SDK
- **Config:** `envconfig` or plain `os.Getenv` with a typed struct

### 3.1 WebSocket Protocol

Single WS endpoint: `wss://<host>/ws` (auth via short-lived token passed as query param or first-frame auth message — **prefer first-frame auth message**, query params can leak into logs).

**Client → Server frame types:**
```json
{ "type": "auth", "token": "<jwt>" }
{ "type": "message.send", "id": "<client-uuid>", "conversation_id": "...", "body": "...", "reply_to_id": null, "attachment_ids": [] }
{ "type": "typing.start", "conversation_id": "..." }
{ "type": "typing.stop", "conversation_id": "..." }
{ "type": "read.ack", "conversation_id": "...", "message_id": "..." }
{ "type": "sync.request", "conversation_id": "...", "since_seq": 1234 }
```

**Server → Client frame types:**
```json
{ "type": "auth.ok", "user_id": "..." }
{ "type": "message.new", "message": { ... full message object ... } }
{ "type": "message.ack", "client_id": "<client-uuid>", "server_seq": 1234 }
{ "type": "presence.update", "user_id": "...", "status": "online" }
{ "type": "typing.update", "conversation_id": "...", "user_id": "...", "typing": true }
{ "type": "read.update", "conversation_id": "...", "user_id": "...", "message_id": "..." }
{ "type": "sync.batch", "conversation_id": "...", "messages": [...], "has_more": false }
```

**Connection lifecycle rules for the agent to implement:**
1. On connect, client sends `auth` frame within 5s or connection is closed.
2. On successful auth, server registers the connection in an in-memory hub (`map[userID][]*Connection`) — supports multiple devices per user.
3. Server subscribes to a Redis pub/sub channel per user (`user:<id>:events`) so that if you later scale to 2 server instances, cross-instance delivery works without further changes (publish on send, every instance subscribes to channels for its locally-connected users).
4. Heartbeat: server sends `ping` every 30s; client must respond within 10s or is disconnected. RN and browsers both handle this differently — implement using the WS protocol-level ping/pong frames, not custom JSON frames.
5. On `message.send`: validate sender is a conversation member → insert with `ON CONFLICT DO NOTHING` → fetch canonical row (in case of conflict, i.e. retry) → broadcast `message.new` to all connected members' hub entries + publish to Redis for other instances → send `message.ack` to the originating connection.

### 3.2 REST Endpoints (for non-realtime operations)

```
POST   /api/auth/callback          # OIDC callback, issues JWT + refresh token
POST   /api/auth/refresh
POST   /api/auth/logout

GET    /api/conversations
POST   /api/conversations           # create group/direct conversation
GET    /api/conversations/:id/messages?before_seq=&limit=   # paginated history load
GET    /api/conversations/:id/members
POST   /api/conversations/:id/members
DELETE /api/conversations/:id/members/:userId

POST   /api/attachments/presign     # returns presigned PUT URL + storage_key
POST   /api/attachments/:id/complete # client confirms upload done, triggers scan
GET    /api/attachments/:id/download # returns presigned GET URL (redirect)

POST   /api/devices                  # register push token
DELETE /api/devices/:id

GET    /api/search?q=&conversation_id=  # full-text search via tsvector
```

Realtime events (new message, typing, presence) go over WebSocket. Everything else (history pagination, search, admin actions, attachment lifecycle) goes over REST — don't try to cram pagination/search into the WS protocol.

---

## 4. Attachment Flow (no in-app preview, by design)

1. Client calls `POST /api/attachments/presign` with `{ file_name, mime_type, size_bytes }`.
2. Server validates size/type against an allowlist (`pdf`, `png`, `jpg`, `xlsx`, `xls`, `docx`, `csv`, etc. — reject executables), returns a MinIO presigned PUT URL + a `storage_key` + a new `attachments.id` (row inserted with `scan_status = 'pending'`).
3. Client uploads bytes **directly to MinIO** using the presigned URL (bypasses the Go server entirely for the byte stream).
4. Client calls `POST /api/attachments/:id/complete` → server enqueues a scan job (ClamAV sidecar, simplest: a small Go worker that pulls the object, runs `clamscan` via socket, updates `scan_status`).
5. Message referencing this attachment is only marked visible/deliverable to other users once `scan_status = 'clean'` (or immediately with a "scanning..." placeholder state — implementer's choice, but must not silently deliver unscanned files).
6. On the receiving client: attachment renders as a file chip (icon by mime type, filename, size). Tapping:
   - **Web:** browser navigates to `/api/attachments/:id/download`, which 302-redirects to a short-lived presigned MinIO URL — browser handles the native download/open behavior.
   - **Mobile:** app downloads to a local temp file via the same endpoint, then invokes the OS share sheet (`react-native-share` or `expo-sharing`) so the OS's registered app for that mime type opens it. The app never renders the file itself.

---

## 5. Offline-First Client Logic (shared package)

Implement in `packages/shared/src/sync/` so both web and mobile consume identical logic.

### 5.1 Local Storage Abstraction (Liskov Substitution Principle)

To satisfy **LSP**, the shared sync state machine operates against a unified `ILocalStorageDriver` interface:

```typescript
// packages/shared/src/storage/IDriver.ts
export interface ILocalStorageDriver {
  getPendingOutbox(): Promise<OutboxItem[]>;
  saveMessage(msg: LocalMessage): Promise<void>;
  updateMessageStatus(id: string, status: MessageStatus): Promise<void>;
  getSyncCursor(conversationId: string): Promise<number>;
  setSyncCursor(conversationId: string, seq: number): Promise<void>;
}
```

- **Mobile Implementation:** `SQLiteStorageDriver` (using `expo-sqlite` / `op-sqlite`)
- **Web Implementation:** `IndexedDBStorageDriver` (using `Dexie.js`)
- Shared Schema: `local_messages`, `outbox`, `conversations_cache`, `sync_cursors (conversation_id, last_synced_seq)`

Both implementations must satisfy the exact same unit test suite in `packages/shared`.

### 5.2 Outbox Pattern (send flow)
```
1. User hits send.
2. Generate UUID client-side for the message.
3. Insert into local_messages with status='sending', AND into outbox table.
4. Render immediately in UI (optimistic, status='sending').
5. If WS connected: send message.send frame immediately.
   If not connected: leave in outbox, a background "flush" runs on reconnect.
6. On message.ack from server: update local_messages status='sent', remove from outbox.
7. On failure/timeout: retry with exponential backoff (base 1s, factor 2, max 30s, jitter ±20%),
   cap total retry window to e.g. 24h, then mark status='failed' and surface a manual retry button.
```

### 5.3 Sync Flow (reconnect / cold start)
```
1. On WS auth.ok, for each conversation the user is in (or just the currently open one + recent list):
   send { type: "sync.request", conversation_id, since_seq: <local cursor> }
2. Server replies with sync.batch (paginated if large gap).
3. Client upserts into local_messages, advances sync_cursors.
4. Flush any pending outbox items after sync completes.
```

### 5.4 Network State Handling
- Mobile: use `@react-native-community/netinfo` to detect reconnect and trigger outbox flush + sync immediately (don't rely solely on WS reconnect timing).
- Web: use `navigator.onLine` + `online` event listener as a supplementary signal alongside WS `onopen`.

---

## 6. Authentication

- OIDC against existing company identity provider (Azure AD / Okta / Google Workspace — configure via env vars, don't hardcode a provider).
- Flow: Authorization Code + PKCE (works for both web and mobile via `expo-auth-session` or `react-native-app-auth`).
- On first login, server upserts a `users` row keyed by `oidc_subject`.
- Server issues its own short-lived JWT (15 min access token) + opaque refresh token (stored hashed in Postgres or Redis, 30-day expiry, rotated on use).
- WebSocket auth uses the same JWT via the first-frame `auth` message.

---

## 7. Infrastructure — Docker Compose (self-hosted VPS)

`infra/docker-compose.yml`:

```yaml
version: "3.9"

services:
  caddy:
    image: caddy:2-alpine
    ports:
      - "443:443"
      - "80:80"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
    depends_on:
      - server
    restart: unless-stopped

  server:
    build: ../apps/server
    env_file: ../.env
    depends_on:
      - postgres
      - redis
      - minio
    restart: unless-stopped

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: chatapp
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - pg_data:/var/lib/postgresql/data   # mount this on a LUKS-encrypted volume at the host level
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    command: redis-server --requirepass ${REDIS_PASSWORD}
    volumes:
      - redis_data:/data
    restart: unless-stopped

  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: ${MINIO_ROOT_USER}
      MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD}
    volumes:
      - minio_data:/data                    # also mount on encrypted volume
    restart: unless-stopped

  clamav:
    image: clamav/clamav:stable
    restart: unless-stopped
    volumes:
      - clamav_data:/var/lib/clamav

volumes:
  caddy_data:
  pg_data:
  redis_data:
  minio_data:
  clamav_data:
```

`infra/Caddyfile`:
```
chat.yourcompany.com {
    reverse_proxy /api/* server:8080
    reverse_proxy /ws server:8080
    reverse_proxy /* web:3000
}

minio.yourcompany.com {
    reverse_proxy minio:9000
}
```

`.env.example`:
```
# Postgres
POSTGRES_USER=chatapp
POSTGRES_PASSWORD=changeme
DATABASE_URL=postgres://chatapp:changeme@postgres:5432/chatapp?sslmode=disable

# Redis
REDIS_PASSWORD=changeme
REDIS_URL=redis://:changeme@redis:6379/0

# MinIO
MINIO_ROOT_USER=changeme
MINIO_ROOT_PASSWORD=changeme
MINIO_ENDPOINT=minio:9000
MINIO_BUCKET=chat-attachments

# Auth (OIDC)
OIDC_ISSUER_URL=https://login.microsoftonline.com/<tenant>/v2.0
OIDC_CLIENT_ID=changeme
OIDC_CLIENT_SECRET=changeme
JWT_SIGNING_SECRET=changeme-generate-a-long-random-string

# Push
FCM_SERVICE_ACCOUNT_JSON=/secrets/fcm.json
APNS_KEY_PATH=/secrets/apns.p8
APNS_KEY_ID=changeme
APNS_TEAM_ID=changeme

# App
APP_ENV=production
PORT=8080
```

**At-rest encryption note for the agent/ops setup:** Docker volumes above (`pg_data`, `minio_data`, `redis_data`) should be bind-mounted to a host directory that lives on a LUKS-encrypted partition — this is an OS/VPS setup step, not something Docker Compose configures itself. Document this as a manual provisioning step in the README.

---

## 8. Backup Strategy (secondary VPS)

- **Postgres:** set up streaming replication (`primary_conninfo` on secondary) for hot standby, **plus** nightly `pg_dump -Fc` logical backups piped through `gpg --encrypt` to the secondary box, retained 14 days.
- **MinIO:** `mc mirror` or `restic` (with its built-in encryption) nightly sync of the attachments bucket to the secondary VPS.
- **Test restores quarterly** — an untested backup is not a backup.

---

## 9. Phased Implementation Order (for the agent to follow sequentially)

**Phase 0 — Infra bootstrap**
- [ ] Scaffold monorepo structure above
- [ ] `docker-compose.yml`, `.env.example`, Caddyfile
- [ ] Postgres migrations (Section 2 schema)
- [ ] Verify: `docker compose up`, Postgres reachable, migrations apply cleanly

**Phase 1 — Auth**
- [ ] OIDC integration, JWT issuance/refresh, REST middleware
- [ ] `users`/`devices` upsert on login
- [ ] Verify: login via provider round-trips to a valid JWT

**Phase 2 — Core messaging (REST + WS)**
- [ ] Conversations CRUD (REST)
- [ ] WebSocket hub, auth frame, `message.send`/`message.new`/`message.ack`
- [ ] Message persistence with client-generated UUID + idempotent insert
- [ ] Verify: two connected clients, message sent by A appears for B in <1s

**Phase 3 — Web client**
- [ ] Next.js app: login, conversation list, message thread, send box
- [ ] WS client wrapper (shared package)
- [ ] Verify: full send/receive loop works in browser against live server

**Phase 4 — Offline + mobile**
- [ ] Shared sync engine (outbox, cursors) in `packages/shared`
- [ ] React Native app wired to shared package
- [ ] SQLite local store, reconnect sync, push notification registration
- [ ] Verify: send message in airplane mode → message appears once reconnected, no duplicates

**Phase 5 — Attachments**
- [ ] Presign/complete endpoints, MinIO wiring, ClamAV scan worker
- [ ] File chip UI (web + mobile), OS handoff on tap
- [ ] Verify: upload PDF, download on second device, opens in external app

**Phase 6 — Presence, typing, read receipts, search**
- [ ] Redis presence + typing pub/sub
- [ ] Read receipt tracking + unread counts
- [ ] Full-text search endpoint
- [ ] Verify: typing indicator latency, read receipt propagation, search returns relevant results

**Phase 7 — Hardening**
- [ ] Rate limiting on REST + WS message send (per-user)
- [ ] Backup scripts + restore test (Section 8)
- [ ] Load test: simulate 150 concurrent WS connections, confirm stable memory/CPU
- [ ] Security pass: confirm TLS everywhere, encrypted volumes mounted correctly, secrets not in git

---

## 10. Explicit Non-Goals (keep the agent from over-building)

- No in-app document/image viewer or renderer — attachments are always handed off to the OS.
- No end-to-end encryption — server-side search/moderation is a requirement, not a gap.
- No Kafka/NATS message bus — single-instance Redis pub/sub is sufficient at this scale; only introduce a bus if scaling well past 150 concurrent users across multiple server instances.
- No Kubernetes — Docker Compose + systemd is the deployment target.
- No custom crypto — rely on TLS, disk/volume encryption, and MinIO's built-in SSE.

---

## 11. Architectural Decision Records (ADRs) & SOLID Enforcement

The implementing agent (e.g. Antigravity) **must strictly adhere** to the following decision records and SOLID rules during code generation.

### ADR-001: Hexagonal Dependency Inversion (DIP)
* **Status:** Accepted
* **Context:** Concrete database drivers (`pgx`), transport routers (`chi`), and WebSocket hubs must not leak into core message handling or conversation domain logic.
* **Decision:** `internal/domain` defines zero-dependency interfaces (`MessageRepository`, `ConversationRepository`, `EventPublisher`, `PushNotifier`, `FileScanner`). All DB, HTTP, Redis, and Push SDK code must live inside `internal/adapter/` or `internal/transport/` as implementation details.
* **Consequences:** Domain logic is 100% unit-testable in isolation using mock structs.

### ADR-002: Multi-Provider Push & Scanner Abstraction (OCP)
* **Status:** Accepted
* **Context:** Adding future push providers (e.g. Web Push / VAPID) or replacing ClamAV with cloud file scanning must not mutate core use cases.
* **Decision:** `PushNotifier` and `FileScanner` domain ports isolate all provider-specific API calls. `PushNotifier` routes notifications based on device platform parameters without conditional branching inside `chat_service`.
* **Consequences:** Highly extensible provider architecture with zero code churn in the core domain.

### ADR-003: Unified Client Storage Contract (LSP)
* **Status:** Accepted
* **Context:** Web (`web`) uses IndexedDB via Dexie while Mobile (`mobile`) uses SQLite via expo-sqlite.
* **Decision:** Both storage backends must implement the `ILocalStorageDriver` interface defined in `packages/shared/src/storage/IDriver.ts` and pass the exact same integration test suite.
* **Consequences:** Guarantee seamless outbox and sync behavior across Web and Mobile platforms without duplicating sync engine logic.
