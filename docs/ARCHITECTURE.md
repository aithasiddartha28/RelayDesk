# System Architecture — RelayDesk

## 1. High-Level Architecture

```
+-----------------------+       HTTP/REST (/api/*)       +-------------------------+
|   React 19 Frontend   | <----------------------------> |   Express 4 Server      |
|   (Vite + Tailwind)   |                                |   (server.ts / port 3000)|
|                       |       WebSocket (/ws)          |                         |
|   useWebSocket Hook   | <============================> |   ws WebSocketServer    |
+-----------------------+                                +------------+------------+
                                                                      |
                                                                      v
                                                         +-------------------------+
                                                         | SQLite (node:sqlite WAL)|
                                                         | data/relaydesk.db       |
                                                         +-------------------------+
```

## 2. Database Schema (`server/db.ts`)

- `users`: Identity, scrypt password hash, RBAC `role` (`admin`, `group_admin`, `user`), `status` (`active`, `muted`, `suspended`), `presence_mode`, `created_at`, `last_login_at`, `last_active_at`, `last_message_at`.
- `sessions`: Bearer session tokens with 7-day expiry.
- `contacts`: User contact relationships and directional `is_blocked` flag.
- `groups` & `group_members`: Group metadata, `created_by`, `created_at`, per-group `member_role` (`group_admin` / `member`), and `is_muted`.
- `messages`: 1-to-1 DM and Group messages with `reply_to_id`, `delivery_status` (`sent` -> `delivered` -> `read`), `is_pinned`, `is_flagged`, and `is_deleted`.
- `notifications`: Persistent real-time alerts pushed over WebSockets.
- `activity_logs`: Append-only audit stream powering the Admin-Only User Activity Report (`USER_REGISTERED`, `USER_LOGIN`, `USER_JOINED_WS`, `USER_LEFT_WS`, `USER_TEXTED_DM`, `USER_TEXTED_GROUP`, `GROUP_CREATED`, `GROUP_JOINED`, `GROUP_LEFT`, `MESSAGE_FLAGGED`, `USER_MODERATED`).
- `moderation_keywords`: Automated content filtering rules (`flag` or `block`).

## 3. WebSocket Event Protocol (`server/ws.ts`)

- **Client -> Server**: `ping`, `presence:update`, `typing:start`, `typing:stop`, `message:send`, `message:read`
- **Server -> Client**: `ws:ready`, `pong`, `presence:changed`, `typing:update`, `message:new`, `message:status`, `message:deleted`, `message:pinned`, `notification:new`, `groups:updated`, `error`

## 4. Security & Role Enforcement (`server/auth.ts`)

- All `/api/admin/reports/*` endpoints enforce `requireAuth` + `requireAdmin`, returning `403 Forbidden` for `group_admin` and `user` roles.
- Passwords are salted and hashed with `crypto.scryptSync` and verified via `crypto.timingSafeEqual`.
