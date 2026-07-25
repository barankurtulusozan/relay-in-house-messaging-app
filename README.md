# Company Chat Application

A high-performance, self-hosted, company-internal messaging platform supporting 1:1 and group chat, offline-first client synchronization, attachments, presence, and OIDC Single Sign-On.

## Tech Stack

- **Backend:** Go 1.22+ (Hexagonal/Clean Architecture, Chi, nhooyr.io/websocket, pgx/v5, sqlc)
- **Database:** PostgreSQL 16
- **Cache & Pub/Sub:** Redis 7
- **Object Storage:** MinIO (S3 compatible)
- **Reverse Proxy / TLS:** Caddy 2
- **Web Client:** Next.js 14+ (App Router, TypeScript)
- **Mobile Client:** React Native (Expo CLI, TypeScript)
- **Shared Engine:** TypeScript Package (`packages/shared` - outbox state machine & sync engine)

## Monorepo Layout

```
company-chat/
├── apps/
│   ├── web/                 # Next.js web application
│   ├── mobile/              # React Native mobile application
│   └── server/              # Go backend service
├── packages/
│   └── shared/              # Shared TS types, API client, sync engine
├── infra/
│   ├── docker-compose.yml   # Production & local Docker composition
│   ├── Caddyfile            # Caddy reverse proxy rules
│   └── migrations/          # SQL database migrations
└── README.md
```

## Quick Start (Local Infrastructure)

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

2. Start database, cache, storage, and proxy via Docker Compose:
   ```bash
   cd infra && docker compose up -d
   ```

## Provisioning Note (LUKS Volume Encryption)
For production deployments on host VPS instances, ensure Docker volumes (`pg_data`, `minio_data`, `redis_data`) are mounted on host directories backed by LUKS-encrypted partitions for at-rest data compliance.
