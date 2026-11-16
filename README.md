# RelayDesk — Real-Time Chat and Group Communication Application

RelayDesk is a full-stack real-time one-to-one and group messaging platform built with **React 19**, **TypeScript**, **Express**, **WebSockets (`ws`)**, and **SQLite (`node:sqlite`)**, packaged for **Docker** and **Kubernetes**.

---

## 1. Objectives

- Deliver real-time one-to-one (DM) and group messaging over persistent WebSockets on a unified HTTP/WS server.
- Enforce strict Role-Based Access Control (**Admin**, **Group Administrator**, **Registered User**).
- Persist full message history, timestamps, reply threads, and delivery status receipts (`sent`, `delivered`, `read`).
- Provide real-time notifications, contact/block management, automated keyword moderation, and user mute/suspension controls.
- Restrict platform-wide audit & activity reports strictly to **Admin** users, recording exact timestamps when users join, sign in, connect via WebSockets, text, or create/join groups.

---

## 2. Technology Stack

| Layer | Technology |
| --- | --- |
| Frontend | React 19, TypeScript, Tailwind CSS v4, Lucide Icons |
| Backend API | Node.js 22, Express 4 |
| Real-Time Engine | `ws` WebSocket Server (`/ws`) |
| Database | SQLite (`node:sqlite` WAL mode) |
| Containerization | Multi-stage `Dockerfile`, `docker-compose.yml` |
| Orchestration | Kubernetes (`Deployment`, `Service`, `ConfigMap`, `PersistentVolumeClaim`) |

---

## 3. Application Screens (10 Total)

1. **Sign In & Registration (`AuthScreen`)** — Scrypt password auth, new account registration (`USER_REGISTERED` logged), and role demo quick-switchers.
2. **Direct Messages (`DirectChatScreen`)** — Real-time 1-to-1 WebSocket messaging, typing indicators, delivery ticks (`Sent` / `Delivered` / `Read`), reply/quote, flag, and thread search.
3. **Group Channels (`GroupChatScreen`)** — Real-time group WebSocket rooms, pinned announcements, member roster drawer, and Group Admin inline mute/remove controls.
4. **Contacts Directory (`ContactsScreen`)** — Add/remove contacts, block/unblock users, live presence filters, and 1-click DM launch.
5. **Groups & Membership (`GroupsDirectoryScreen`)** — Create groups, join/leave channels, manage members, and assign Group Administrators.
6. **Notifications Center (`NotificationsScreen`)** — Real-time WebSocket inbox for DMs, group invites, and moderation alerts.
7. **Moderation & Controls (`ModerationScreen`)** — Flagged message review queue, keyword filter rules (`flag`/`block`), platform user status/role controls (Admin), and personal blocked contacts.
8. **Admin-Only Mandatory Reports (`AdminReportsScreen`)** — Strictly gated to `role === 'admin'` (`403 Forbidden` on backend for non-admins), featuring CSV export and 4 dedicated reports:
   - **User Activity Report**: Joined timestamp, last login, last texted timestamp, message counts, and chronological live audit log (`USER_REGISTERED`, `USER_LOGIN`, `USER_JOINED_WS`, `USER_LEFT_WS`, `USER_TEXTED_DM`, `USER_TEXTED_GROUP`, `GROUP_CREATED`, `GROUP_JOINED`).
   - **Message Activity Report**: Daily DM vs Group volume chart, delivery status breakdown, and filterable message ledger.
   - **Group Participation Report**: Active senders vs total members, participation rate %, and top contributors.
   - **Group Creation Report**: Complete group creation ledger with creator, role, member counts, and timestamps.
9. **Account & Profile (`ProfileSettingsScreen`)** — Display name, bio, live presence mode (`available`, `busy`, `away`), read receipt toggle, and password change.
10. **Architecture & Ops Guide (`DeploymentDocsScreen`)** — In-app reference for system architecture, Docker, and Kubernetes execution.

---

## 4. Initial Workspace Setup & Role Provisioning

RelayDesk starts with a clean, unseeded SQLite database so all reports reflect genuine workspace activity:

1. Open the app and register the **first user account** — it is automatically initialized as **Platform Admin**.
2. Create additional users either via the **Create Account** tab on the login screen (`Registered User` by default) or directly from **Moderation & Controls** as the Admin (where you can assign `Registered User`, `Group Administrator`, or `Admin`).
3. Create groups, join channels, and send 1-to-1 or group messages over WebSockets — all 4 **Admin Reports** dynamically compute counts, participation rates, and join/text timestamps from live database records.

---

## 5. Local Execution Instructions

```bash
# 1. Install dependencies
npm install

# 2. Start development server (Express + WebSockets + Vite on port 3000)
npm run dev

# 3. Typecheck and build for production
npm run lint
npm run build

# 4. Run production build directly
NODE_ENV=production npm start
```

Open `http://localhost:3000`. Health check endpoint: `GET /api/health`.

---

## 6. Docker Execution Instructions

```bash
# Build production image
docker build -t relaydesk:latest .

# Run container with persistent volume for SQLite database
docker run -d \
  --name relaydesk \
  -p 3000:3000 \
  -v relaydesk_data:/app/data \
  relaydesk:latest

# Or use Docker Compose
docker compose up --build -d
```

---

## 7. Kubernetes Deployment Instructions

```bash
# 1. Build image (if using local cluster such as Minikube / Kind, load image into cluster)
docker build -t relaydesk:latest .

# 2. Apply Kubernetes manifests
kubectl apply -f k8s/pvc.yaml
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml

# 3. Verify pods and service
kubectl get pods,svc,pvc -l app=relaydesk

# 4. Access service locally via port-forward (or NodePort 30080)
kubectl port-forward svc/relaydesk-service 3000:3000
```

---

## 8. GitHub & Version Control Workflow

```bash
git init
git add .
git commit -m "feat: implement RelayDesk real-time chat, RBAC, admin reports, Docker & K8s manifests"
git branch -M main
git remote add origin <your-github-repo-url>
git push -u origin main
```
