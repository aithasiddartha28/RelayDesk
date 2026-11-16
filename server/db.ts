import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { DbUser, SafeUser } from './types.ts';

const DATA_DIR = process.env.DATA_DIR || path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export const DB_PATH = path.join(DATA_DIR, 'relaydesk.db');
export const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, keyHex] = stored.split(':');
  if (!salt || !keyHex) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const keyBuf = Buffer.from(keyHex, 'hex');
  if (derived.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(derived, keyBuf);
}

export function toSafeUser(row: DbUser, onlineIds?: Set<string>): SafeUser {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    presenceMode: row.presence_mode,
    bio: row.bio,
    avatarColor: row.avatar_color,
    readReceiptsEnabled: Boolean(row.read_receipts_enabled),
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
    lastActiveAt: row.last_active_at,
    lastMessageAt: row.last_message_at,
    isOnline: onlineIds ? onlineIds.has(row.id) : false,
  };
}

export function initDatabase(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'group_admin', 'user')),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'muted', 'suspended')),
      presence_mode TEXT NOT NULL DEFAULT 'available' CHECK (presence_mode IN ('available', 'busy', 'away')),
      bio TEXT NOT NULL DEFAULT '',
      avatar_color TEXT NOT NULL DEFAULT '#2563EB',
      read_receipts_enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      last_login_at TEXT,
      last_active_at TEXT,
      last_message_at TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS contacts (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      contact_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      nickname TEXT NOT NULL DEFAULT '',
      is_blocked INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, contact_id)
    );

    CREATE TABLE IF NOT EXISTS groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'General',
      is_private INTEGER NOT NULL DEFAULT 0,
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      is_archived INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS group_members (
      group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      member_role TEXT NOT NULL DEFAULT 'member' CHECK (member_role IN ('group_admin', 'member')),
      is_muted INTEGER NOT NULL DEFAULT 0,
      joined_at TEXT NOT NULL,
      last_read_at TEXT,
      PRIMARY KEY (group_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_type TEXT NOT NULL CHECK (conversation_type IN ('dm', 'group')),
      sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      recipient_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      group_id TEXT REFERENCES groups(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      reply_to_id TEXT,
      delivery_status TEXT NOT NULL DEFAULT 'sent' CHECK (delivery_status IN ('sent', 'delivered', 'read')),
      is_pinned INTEGER NOT NULL DEFAULT 0,
      is_deleted INTEGER NOT NULL DEFAULT 0,
      is_flagged INTEGER NOT NULL DEFAULT 0,
      flag_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_messages_dm ON messages(conversation_type, sender_id, recipient_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_messages_group ON messages(conversation_type, group_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_activity_user ON activity_logs(user_id, created_at);
  `.replace(
    'CREATE INDEX IF NOT EXISTS idx_activity_user ON activity_logs(user_id, created_at);',
    ''
  ));

  db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      link_screen TEXT,
      link_target_id TEXT,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS activity_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_activity_user ON activity_logs(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_activity_event ON activity_logs(event_type, created_at);

    CREATE TABLE IF NOT EXISTS moderation_keywords (
      id TEXT PRIMARY KEY,
      keyword TEXT UNIQUE NOT NULL,
      action TEXT NOT NULL DEFAULT 'flag' CHECK (action IN ('flag', 'block')),
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL
    );
  `);
}

export function logActivity(
  userId: string,
  eventType: string,
  targetType: string | null = null,
  targetId: string | null = null,
  metadata: Record<string, unknown> = {},
  createdAt?: string
): string {
  const id = `act_${crypto.randomUUID()}`;
  const ts = createdAt || new Date().toISOString();
  db.prepare(
    `INSERT INTO activity_logs (id, user_id, event_type, target_type, target_id, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, userId, eventType, targetType, targetId, JSON.stringify(metadata), ts);
  return id;
}

export function createNotification(
  userId: string,
  type: string,
  title: string,
  body: string,
  linkScreen: string | null = null,
  linkTargetId: string | null = null,
  createdAt?: string
): {
  id: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  linkScreen: string | null;
  linkTargetId: string | null;
  isRead: boolean;
  createdAt: string;
} {
  const id = `ntf_${crypto.randomUUID()}`;
  const ts = createdAt || new Date().toISOString();
  db.prepare(
    `INSERT INTO notifications (id, user_id, type, title, body, link_screen, link_target_id, is_read, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`
  ).run(id, userId, type, title, body, linkScreen, linkTargetId, ts);
  return {
    id,
    userId,
    type,
    title,
    body,
    linkScreen,
    linkTargetId,
    isRead: false,
    createdAt: ts,
  };
}


