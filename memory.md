# Security Remediation & System Memory Log

This document tracks security enhancements, architectural decisions, code changes, and review notes across all iterations.

---

## Initial Security Audit Baseline (2026-07-27)

Identified 6 core security vulnerabilities during comprehensive code review:
- **VULN-001**: Unauthenticated dev login endpoint accessible in all environments.
- **VULN-002**: Cross-Site WebSocket Hijacking (CSWSH) due to `InsecureSkipVerify: true`.
- **VULN-003**: Permissive CORS (`AllowedOrigins: ["*"]` with `AllowCredentials: true`).
- **VULN-004**: Broken Object Level Authorization (BOLA) in group member removal and renaming.
- **VULN-005**: Lack of API rate limiting on search & auth endpoints.
- **VULN-006**: Missing JWT secret validation on startup.

---

## Iteration 1 — Configuration & Environment Hardening (COMPLETED)
- **Changes**:
  - Added `AllowedCORSOrigins`, `AllowedWSOrigins`, and `IsProduction()` helper to `apps/server/internal/config/config.go`.
  - Configured `ALLOWED_CORS_ORIGINS` and `ALLOWED_WS_ORIGINS` environment variables with secure fallback defaults.
  - Added secret length validation warning in `apps/server/internal/auth/jwt.go`.
- **Rationale**: Provides strict domain boundary rules needed to enforce CORS and WebSocket origin verification.

---

## Iteration 2 — API Gateway Security & Protection (COMPLETED)
- **Changes**:
  - **VULN-001 (Dev Auth Guard)**: Updated `handleLogin` in `router.go` to reject dev logins with `HTTP 403 Forbidden` if `cfg.IsProduction()` is true.
  - **VULN-002 (CSWSH Fix)**: Removed `InsecureSkipVerify: true` from `websocket.Accept`. Configured strict `OriginPatterns` using `AllowedWSOrigins`.
  - **VULN-003 (CORS Fix)**: Replaced wildcard origin `*` with explicit origins from `cfg.AllowedCORSOrigins`.
  - **VULN-005 (Rate Limiting)**: Added `RateLimitMiddleware` (thread-safe sliding window token bucket) in `middleware.go`. Applied `10 reqs/min` on `/api/auth/login` and `30 reqs/min` on `/api/users/search`.
- **Rationale**: Prevents unauthenticated admin token generation, guards against cross-site WebSocket hijacking, eliminates credential leakage via CORS, and mitigates API denial-of-service / scraping attacks.

---

## Iteration 3 — Role-Based Access Control (RBAC) & BOLA Mitigation (COMPLETED)
- **Changes**:
  - Implemented `AddGroupMember` and `RemoveGroupMember` in `apps/server/internal/service/chat_service.go` with strict role checks.
  - Updated `UpdateConversationName` to require `RoleOwner` or `RoleAdmin`.
  - Updated `handleAddMember` and `handleRemoveMember` in `router.go` to enforce actor membership and authorization:
    - Only `owner` or `admin` can add or remove members.
    - Admins cannot remove group owners.
    - Members can leave groups, but owners must transfer ownership before leaving multi-member groups.
- **Rationale**: Resolves BOLA/IDOR vulnerability VULN-004 where regular members could remove owners or change group titles.

---

## Verification & Health Status (2026-07-27)
- **Go Backend Server**: `/usr/local/go/bin/go build ./cmd/server` -> **0 build errors**.
- **Mobile TypeScript Client**: `pnpm exec tsc --noEmit` -> **0 type errors**.
- **Shared Client SDK**: `pnpm --filter @company-chat/shared build` -> **Build success**.
