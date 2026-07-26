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

## Infrastructure & Service Configuration

| Container Name | Service | Status | Port Mapping |
| :--- | :--- | :--- | :--- |
| `infra-server-1` | Go Backend Server | Up (healthy) | `8080:8080` |
| `infra-postgres-1` | PostgreSQL 16 | Up | `5432:5432` |
| `infra-redis-1` | Redis 7 | Up | `6379:6379` |
| `infra-minio-1` | MinIO S3 Storage | Up | `9000:9000, 9001:9001` |
| `infra-clamav-1` | ClamAV File Scanner | Up | internal |
| `infra-caddy-1` | Caddy Reverse Proxy | Up | `80:80, 443:443` |

## Command Cheat Sheet

- **Run Go Backend (Docker)**: `cd infra && docker compose up -d --build server`
- **Run Go Backend (Local Go)**: `export $(cat .env | xargs) && cd apps/server && go run ./cmd/server`
- **Run Mobile App**: `pnpm dev:mobile`
- **Run Web App**: `pnpm dev:web`
- **View Backend Logs**: `cd infra && docker compose logs -f server`
- **Stop Infrastructure**: `cd infra && docker compose down`


