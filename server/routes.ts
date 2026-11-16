import crypto from 'node:crypto';
import express from 'express';
import {
  createSession,
  requireAdmin,
  requireAuth,
  requireModerator,
  type AuthenticatedRequest,
} from './auth.ts';
import {
  createNotification,
  db,
  hashPassword,
  logActivity,
  toSafeUser,
  verifyPassword,
} from './db.ts';
import type { DbUser, UserRole, UserStatus } from './types.ts';
import { broadcastToAll, broadcastToGroup, broadcastToUser, getOnlineUserIds } from './ws.ts';

const AVATAR_COLORS = ['#2563EB', '#0F766E', '#7C3AED', '#B45309', '#1E293B', '#BE123C'];

export function createApiRouter() {
  const router = express.Router();
  router.use(express.json({ limit: '1mb' }));

  // Health probe for Docker & Kubernetes
  router.get('/health', (_req, res) => {
    try {
      db.prepare('SELECT 1').get();
      res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        onlineUsers: getOnlineUserIds().size,
      });
    } catch {
      res.status(500).json({ status: 'error' });
    }
  });

  // ---------------- AUTHENTICATION & PROFILE ----------------
  router.get('/auth/bootstrap-status', (_req, res) => {
    const count = (db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }).c;
    res.json({ hasUsers: count > 0, userCount: count });
  });

  router.post('/auth/register', (req, res) => {
    const { username, email, displayName, password } = req.body as Record<string, string>;
    if (!username?.trim() || !email?.trim() || !displayName?.trim() || !password) {
      res.status(400).json({ error: 'All fields (username, email, displayName, password) are required.' });
      return;
    }
    if (password.length < 6) {
      res.status(400).json({ error: 'Password must be at least 6 characters.' });
      return;
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanUsername = username.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
    if (!cleanUsername) {
      res.status(400).json({ error: 'Username must contain alphanumeric characters.' });
      return;
    }

    const existing = db
      .prepare('SELECT id FROM users WHERE email = ? OR username = ?')
      .get(cleanEmail, cleanUsername);
    if (existing) {
      res.status(409).json({ error: 'An account with this email or username already exists.' });
      return;
    }

    const existingCount = (db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }).c;
    const assignedRole: UserRole = existingCount === 0 ? 'admin' : 'user';

    const userId = `usr_${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const color = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];

    db.prepare(
      `INSERT INTO users (id, username, email, display_name, password_hash, role, status, presence_mode, bio, avatar_color, read_receipts_enabled, created_at, last_login_at, last_active_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', 'available', ?, ?, 1, ?, ?, ?)`
    ).run(
      userId,
      cleanUsername,
      cleanEmail,
      displayName.trim(),
      hashPassword(password),
      assignedRole,
      assignedRole === 'admin' ? 'Platform Administrator' : 'RelayDesk Member',
      color,
      now,
      now,
      now
    );

    logActivity(
      userId,
      'USER_REGISTERED',
      'user',
      userId,
      { email: cleanEmail, displayName: displayName.trim(), role: assignedRole },
      now
    );
    logActivity(userId, 'USER_LOGIN', 'session', userId, { method: 'registration' }, now);

    const token = createSession(userId);
    const created = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as unknown as DbUser;

    // Notify admins of new user registration
    const admins = db.prepare(`SELECT id FROM users WHERE role = 'admin'`).all() as Array<{ id: string }>;
    for (const adm of admins) {
      const ntf = createNotification(
        adm.id,
        'system',
        'New User Joined RelayDesk',
        `${displayName.trim()} (@${cleanUsername}) registered.`,
        'admin-reports',
        'user-activity',
        now
      );
      broadcastToUser(adm.id, { type: 'notification:new', notification: ntf });
    }

    res.status(201).json({
      token,
      user: toSafeUser(created, getOnlineUserIds()),
    });
  });

  router.post('/auth/login', (req, res) => {
    const { identifier, password } = req.body as Record<string, string>;
    if (!identifier?.trim() || !password) {
      res.status(400).json({ error: 'Email/username and password are required.' });
      return;
    }
    const clean = identifier.trim().toLowerCase();
    const row = db
      .prepare('SELECT * FROM users WHERE lower(email) = ? OR lower(username) = ?')
      .get(clean, clean) as DbUser | undefined;

    if (!row || !verifyPassword(password, row.password_hash)) {
      res.status(401).json({ error: 'Invalid credentials.' });
      return;
    }
    if (row.status === 'suspended') {
      res.status(403).json({ error: 'Account is suspended. Contact an administrator.' });
      return;
    }

    const now = new Date().toISOString();
    db.prepare('UPDATE users SET last_login_at = ?, last_active_at = ? WHERE id = ?').run(now, now, row.id);
    logActivity(row.id, 'USER_LOGIN', 'session', row.id, { method: 'password' }, now);

    const token = createSession(row.id);
    const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(row.id) as unknown as DbUser;
    res.json({
      token,
      user: toSafeUser(updated, getOnlineUserIds()),
    });
  });

  router.post('/auth/logout', requireAuth, (req: AuthenticatedRequest, res) => {
    if (req.token) {
      db.prepare('DELETE FROM sessions WHERE token = ?').run(req.token);
    }
    res.json({ ok: true });
  });

  router.get('/auth/me', requireAuth, (req: AuthenticatedRequest, res) => {
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user!.id) as unknown as DbUser;
    res.json({ user: toSafeUser(row, getOnlineUserIds()) });
  });

  router.patch('/auth/profile', requireAuth, (req: AuthenticatedRequest, res) => {
    const { displayName, bio, presenceMode, readReceiptsEnabled, currentPassword, newPassword } = req.body as {
      displayName?: string;
      bio?: string;
      presenceMode?: string;
      readReceiptsEnabled?: boolean;
      currentPassword?: string;
      newPassword?: string;
    };

    const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user!.id) as unknown as DbUser;

    if (newPassword) {
      if (!currentPassword || !verifyPassword(currentPassword, existing.password_hash)) {
        res.status(400).json({ error: 'Current password is incorrect.' });
        return;
      }
      if (newPassword.length < 6) {
        res.status(400).json({ error: 'New password must be at least 6 characters.' });
        return;
      }
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), existing.id);
    }

    const nextName = displayName?.trim() ? displayName.trim() : existing.display_name;
    const nextBio = typeof bio === 'string' ? bio.trim().slice(0, 240) : existing.bio;
    const nextMode =
      presenceMode === 'available' || presenceMode === 'busy' || presenceMode === 'away'
        ? presenceMode
        : existing.presence_mode;
    const nextRead = typeof readReceiptsEnabled === 'boolean' ? (readReceiptsEnabled ? 1 : 0) : existing.read_receipts_enabled;

    db.prepare(
      `UPDATE users SET display_name = ?, bio = ?, presence_mode = ?, read_receipts_enabled = ?, last_active_at = ? WHERE id = ?`
    ).run(nextName, nextBio, nextMode, nextRead, new Date().toISOString(), existing.id);

    const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(existing.id) as unknown as DbUser;
    const safe = toSafeUser(updated, getOnlineUserIds());
    broadcastToAll({
      type: 'presence:changed',
      userId: safe.id,
      isOnline: Boolean(safe.isOnline),
      presenceMode: safe.presenceMode,
    });
    res.json({ user: safe });
  });

  // ---------------- USERS & CONTACTS ----------------
  router.get('/users', requireAuth, (_req: AuthenticatedRequest, res) => {
    const rows = db.prepare('SELECT * FROM users ORDER BY display_name ASC').all() as unknown as DbUser[];
    const online = getOnlineUserIds();
    res.json({ users: rows.map((r) => toSafeUser(r, online)) });
  });

  router.get('/contacts', requireAuth, (req: AuthenticatedRequest, res) => {
    const rows = db
      .prepare(
        `SELECT c.contact_id, c.nickname, c.is_blocked, c.created_at as added_at, u.*
         FROM contacts c
         JOIN users u ON u.id = c.contact_id
         WHERE c.user_id = ?
         ORDER BY u.display_name ASC`
      )
      .all(req.user!.id) as unknown as Array<DbUser & { contact_id: string; nickname: string; is_blocked: number; added_at: string }>;

    const online = getOnlineUserIds();
    res.json({
      contacts: rows.map((r) => ({
        ...toSafeUser(r, online),
        nickname: r.nickname,
        isBlocked: Boolean(r.is_blocked),
        addedAt: r.added_at,
      })),
    });
  });

  router.post('/contacts', requireAuth, (req: AuthenticatedRequest, res) => {
    const { contactId, nickname } = req.body as { contactId?: string; nickname?: string };
    if (!contactId || contactId === req.user!.id) {
      res.status(400).json({ error: 'Valid contactId is required.' });
      return;
    }
    const target = db.prepare('SELECT id FROM users WHERE id = ?').get(contactId);
    if (!target) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }
    db.prepare(
      `INSERT INTO contacts (user_id, contact_id, nickname, is_blocked, created_at)
       VALUES (?, ?, ?, 0, ?)
       ON CONFLICT(user_id, contact_id) DO UPDATE SET nickname = excluded.nickname`
    ).run(req.user!.id, contactId, nickname?.trim() || '', new Date().toISOString());
    res.status(201).json({ ok: true });
  });

  router.patch('/contacts/:contactId/block', requireAuth, (req: AuthenticatedRequest, res) => {
    const { contactId } = req.params;
    const { isBlocked } = req.body as { isBlocked: boolean };
    const existing = db
      .prepare('SELECT 1 FROM contacts WHERE user_id = ? AND contact_id = ?')
      .get(req.user!.id, contactId);
    if (existing) {
      db.prepare('UPDATE contacts SET is_blocked = ? WHERE user_id = ? AND contact_id = ?').run(
        isBlocked ? 1 : 0,
        req.user!.id,
        contactId
      );
    } else {
      db.prepare(
        `INSERT INTO contacts (user_id, contact_id, nickname, is_blocked, created_at) VALUES (?, ?, '', ?, ?)`
      ).run(req.user!.id, contactId, isBlocked ? 1 : 0, new Date().toISOString());
    }
    res.json({ ok: true, isBlocked: Boolean(isBlocked) });
  });

  router.delete('/contacts/:contactId', requireAuth, (req: AuthenticatedRequest, res) => {
    db.prepare('DELETE FROM contacts WHERE user_id = ? AND contact_id = ?').run(req.user!.id, req.params.contactId);
    res.json({ ok: true });
  });

  // ---------------- MESSAGES ----------------
  router.get('/messages/dm/:peerId', requireAuth, (req: AuthenticatedRequest, res) => {
    const userId = req.user!.id;
    const peerId = req.params.peerId;
    const rows = db
      .prepare(
        `SELECT m.*, u.display_name as sender_name, u.avatar_color as sender_avatar_color, u.role as sender_role,
                rm.content as reply_content, ru.display_name as reply_sender_name
         FROM messages m
         JOIN users u ON u.id = m.sender_id
         LEFT JOIN messages rm ON rm.id = m.reply_to_id
         LEFT JOIN users ru ON ru.id = rm.sender_id
         WHERE m.conversation_type = 'dm'
           AND ((m.sender_id = ? AND m.recipient_id = ?) OR (m.sender_id = ? AND m.recipient_id = ?))
         ORDER BY m.created_at ASC
         LIMIT 250`
      )
      .all(userId, peerId, peerId, userId) as Array<Record<string, unknown>>;

    res.json({
      messages: rows.map((r) => ({
        id: r.id,
        conversationType: r.conversation_type,
        senderId: r.sender_id,
        senderName: r.sender_name,
        senderAvatarColor: r.sender_avatar_color,
        senderRole: r.sender_role,
        recipientId: r.recipient_id,
        groupId: r.group_id,
        content: r.is_deleted ? 'This message was removed.' : r.content,
        replyToId: r.reply_to_id,
        replyPreview: r.reply_to_id
          ? { id: r.reply_to_id, content: r.reply_content, senderName: r.reply_sender_name }
          : null,
        deliveryStatus: r.delivery_status,
        isPinned: Boolean(r.is_pinned),
        isDeleted: Boolean(r.is_deleted),
        isFlagged: Boolean(r.is_flagged),
        flagReason: r.flag_reason,
        createdAt: r.created_at,
      })),
    });
  });

  router.get('/messages/group/:groupId', requireAuth, (req: AuthenticatedRequest, res) => {
    const userId = req.user!.id;
    const groupId = req.params.groupId;

    const isMember = db
      .prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?')
      .get(groupId, userId);

    if (!isMember && req.user!.role !== 'admin') {
      res.status(403).json({ error: 'Join this group to view its message history.' });
      return;
    }

    const rows = db
      .prepare(
        `SELECT m.*, u.display_name as sender_name, u.avatar_color as sender_avatar_color, u.role as sender_role,
                rm.content as reply_content, ru.display_name as reply_sender_name
         FROM messages m
         JOIN users u ON u.id = m.sender_id
         LEFT JOIN messages rm ON rm.id = m.reply_to_id
         LEFT JOIN users ru ON ru.id = rm.sender_id
         WHERE m.conversation_type = 'group' AND m.group_id = ?
         ORDER BY m.created_at ASC
         LIMIT 300`
      )
      .all(groupId) as Array<Record<string, unknown>>;

    res.json({
      messages: rows.map((r) => ({
        id: r.id,
        conversationType: r.conversation_type,
        senderId: r.sender_id,
        senderName: r.sender_name,
        senderAvatarColor: r.sender_avatar_color,
        senderRole: r.sender_role,
        recipientId: r.recipient_id,
        groupId: r.group_id,
        content: r.is_deleted ? 'This message was removed by moderation.' : r.content,
        replyToId: r.reply_to_id,
        replyPreview: r.reply_to_id
          ? { id: r.reply_to_id, content: r.reply_content, senderName: r.reply_sender_name }
          : null,
        deliveryStatus: r.delivery_status,
        isPinned: Boolean(r.is_pinned),
        isDeleted: Boolean(r.is_deleted),
        isFlagged: Boolean(r.is_flagged),
        flagReason: r.flag_reason,
        createdAt: r.created_at,
      })),
    });
  });

  router.post('/messages/:id/flag', requireAuth, (req: AuthenticatedRequest, res) => {
    const { reason } = req.body as { reason?: string };
    const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id) as
      | { id: string; group_id: string | null; sender_id: string; content: string }
      | undefined;
    if (!msg) {
      res.status(404).json({ error: 'Message not found.' });
      return;
    }

    const cleanReason = reason?.trim() || 'Flagged by user for moderation review';
    db.prepare('UPDATE messages SET is_flagged = 1, flag_reason = ? WHERE id = ?').run(cleanReason, msg.id);
    logActivity(req.user!.id, 'MESSAGE_FLAGGED', 'message', msg.id, { reason: cleanReason });

    const mods = db
      .prepare(`SELECT id FROM users WHERE role IN ('admin', 'group_admin')`)
      .all() as Array<{ id: string }>;
    for (const m of mods) {
      const ntf = createNotification(
        m.id,
        'moderation',
        'Message Flagged for Review',
        `${req.user!.displayName} flagged a message: "${msg.content.slice(0, 70)}"`,
        'moderation',
        msg.id
      );
      broadcastToUser(m.id, { type: 'notification:new', notification: ntf });
    }

    res.json({ ok: true });
  });

  router.patch('/messages/:id/pin', requireAuth, (req: AuthenticatedRequest, res) => {
    const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id) as
      | { id: string; conversation_type: string; group_id: string | null; is_pinned: number }
      | undefined;
    if (!msg) {
      res.status(404).json({ error: 'Message not found.' });
      return;
    }

    if (msg.conversation_type === 'group' && msg.group_id && req.user!.role !== 'admin') {
      const member = db
        .prepare('SELECT member_role FROM group_members WHERE group_id = ? AND user_id = ?')
        .get(msg.group_id, req.user!.id) as { member_role: string } | undefined;
      if (!member || (member.member_role !== 'group_admin' && req.user!.role !== 'group_admin')) {
        res.status(403).json({ error: 'Only Group Administrators or Admins can pin group messages.' });
        return;
      }
    }

    const nextPinned = msg.is_pinned ? 0 : 1;
    db.prepare('UPDATE messages SET is_pinned = ? WHERE id = ?').run(nextPinned, msg.id);
    if (msg.group_id) {
      broadcastToGroup(msg.group_id, { type: 'message:pinned', messageId: msg.id, isPinned: Boolean(nextPinned) });
    }
    res.json({ ok: true, isPinned: Boolean(nextPinned) });
  });

  router.delete('/messages/:id', requireAuth, (req: AuthenticatedRequest, res) => {
    const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id) as
      | { id: string; sender_id: string; recipient_id: string | null; group_id: string | null; conversation_type: string }
      | undefined;
    if (!msg) {
      res.status(404).json({ error: 'Message not found.' });
      return;
    }

    let allowed = msg.sender_id === req.user!.id || req.user!.role === 'admin';
    if (!allowed && msg.conversation_type === 'group' && msg.group_id) {
      const gm = db
        .prepare('SELECT member_role FROM group_members WHERE group_id = ? AND user_id = ?')
        .get(msg.group_id, req.user!.id) as { member_role: string } | undefined;
      if (gm?.member_role === 'group_admin') allowed = true;
    }
    if (!allowed) {
      res.status(403).json({ error: 'Insufficient permissions to delete this message.' });
      return;
    }

    db.prepare('UPDATE messages SET is_deleted = 1, is_flagged = 0 WHERE id = ?').run(msg.id);
    const payload = { type: 'message:deleted', messageId: msg.id };
    if (msg.conversation_type === 'group' && msg.group_id) {
      broadcastToGroup(msg.group_id, payload);
    } else {
      broadcastToUser(msg.sender_id, payload);
      if (msg.recipient_id) broadcastToUser(msg.recipient_id, payload);
    }
    res.json({ ok: true });
  });

  // ---------------- GROUPS & MEMBERSHIP ----------------
  router.get('/groups', requireAuth, (req: AuthenticatedRequest, res) => {
    const userId = req.user!.id;
    const rows = db
      .prepare(
        `SELECT g.*,
                u.display_name as creator_name,
                (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id = g.id) as member_count,
                (SELECT COUNT(*) FROM messages m WHERE m.group_id = g.id AND m.is_deleted = 0) as message_count,
                (SELECT MAX(m.created_at) FROM messages m WHERE m.group_id = g.id) as last_message_at,
                (SELECT gm2.member_role FROM group_members gm2 WHERE gm2.group_id = g.id AND gm2.user_id = ?) as my_role,
                (SELECT gm3.is_muted FROM group_members gm3 WHERE gm3.group_id = g.id AND gm3.user_id = ?) as am_muted
         FROM groups g
         JOIN users u ON u.id = g.created_by
         ORDER BY g.created_at DESC`
      )
      .all(userId, userId) as Array<Record<string, unknown>>;

    res.json({
      groups: rows.map((g) => ({
        id: g.id,
        name: g.name,
        description: g.description,
        category: g.category,
        isPrivate: Boolean(g.is_private),
        createdBy: g.created_by,
        creatorName: g.creator_name,
        createdAt: g.created_at,
        isArchived: Boolean(g.is_archived),
        memberCount: g.member_count,
        messageCount: g.message_count,
        lastMessageAt: g.last_message_at,
        isMember: Boolean(g.my_role),
        myGroupRole: g.my_role || null,
        amMuted: Boolean(g.am_muted),
      })),
    });
  });

  router.get('/groups/:groupId', requireAuth, (req: AuthenticatedRequest, res) => {
    const group = db
      .prepare(
        `SELECT g.*, u.display_name as creator_name
         FROM groups g JOIN users u ON u.id = g.created_by WHERE g.id = ?`
      )
      .get(req.params.groupId) as Record<string, unknown> | undefined;

    if (!group) {
      res.status(404).json({ error: 'Group not found.' });
      return;
    }

    const members = db
      .prepare(
        `SELECT gm.member_role, gm.is_muted, gm.joined_at, u.*
         FROM group_members gm
         JOIN users u ON u.id = gm.user_id
         WHERE gm.group_id = ?
         ORDER BY gm.member_role ASC, u.display_name ASC`
      )
      .all(req.params.groupId) as unknown as Array<DbUser & { member_role: string; is_muted: number; joined_at: string }>;

    const online = getOnlineUserIds();
    res.json({
      group: {
        id: group.id,
        name: group.name,
        description: group.description,
        category: group.category,
        isPrivate: Boolean(group.is_private),
        createdBy: group.created_by,
        creatorName: group.creator_name,
        createdAt: group.created_at,
        isArchived: Boolean(group.is_archived),
      },
      members: members.map((m) => ({
        ...toSafeUser(m, online),
        groupRole: m.member_role,
        isMutedInGroup: Boolean(m.is_muted),
        joinedAt: m.joined_at,
      })),
    });
  });

  router.post('/groups', requireAuth, (req: AuthenticatedRequest, res) => {
    const { name, description, category, isPrivate, memberIds } = req.body as {
      name?: string;
      description?: string;
      category?: string;
      isPrivate?: boolean;
      memberIds?: string[];
    };

    if (!name?.trim() || name.trim().length < 2) {
      res.status(400).json({ error: 'Group name must be at least 2 characters.' });
      return;
    }

    const groupId = `grp_${crypto.randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO groups (id, name, description, category, is_private, created_by, created_at, is_archived)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0)`
    ).run(
      groupId,
      name.trim(),
      (description || '').trim(),
      (category || 'General').trim(),
      isPrivate ? 1 : 0,
      req.user!.id,
      now
    );

    // Creator becomes group_admin in this group
    db.prepare(
      `INSERT INTO group_members (group_id, user_id, member_role, is_muted, joined_at, last_read_at)
       VALUES (?, ?, 'group_admin', 0, ?, ?)`
    ).run(groupId, req.user!.id, now, now);

    logActivity(
      req.user!.id,
      'GROUP_CREATED',
      'group',
      groupId,
      { groupName: name.trim(), category: (category || 'General').trim(), isPrivate: Boolean(isPrivate) },
      now
    );
    logActivity(req.user!.id, 'GROUP_JOINED', 'group', groupId, { memberRole: 'group_admin' }, now);

    const uniqueMembers = Array.isArray(memberIds)
      ? Array.from(new Set(memberIds.filter((id) => id && id !== req.user!.id)))
      : [];

    for (const uid of uniqueMembers) {
      const exists = db.prepare('SELECT id FROM users WHERE id = ?').get(uid);
      if (exists) {
        db.prepare(
          `INSERT OR IGNORE INTO group_members (group_id, user_id, member_role, is_muted, joined_at, last_read_at)
           VALUES (?, ?, 'member', 0, ?, ?)`
        ).run(groupId, uid, now, now);
        logActivity(uid, 'GROUP_JOINED', 'group', groupId, { addedBy: req.user!.id }, now);
        const ntf = createNotification(
          uid,
          'group_invite',
          `Added to #${name.trim()}`,
          `${req.user!.displayName} added you to the group "${name.trim()}".`,
          'groups',
          groupId,
          now
        );
        broadcastToUser(uid, { type: 'notification:new', notification: ntf });
      }
    }

    broadcastToAll({ type: 'groups:updated' });
    res.status(201).json({ id: groupId });
  });

  router.post('/groups/:groupId/join', requireAuth, (req: AuthenticatedRequest, res) => {
    const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(req.params.groupId) as
      | { id: string; name: string; is_private: number }
      | undefined;
    if (!group) {
      res.status(404).json({ error: 'Group not found.' });
      return;
    }
    if (group.is_private && req.user!.role === 'user') {
      res.status(403).json({ error: 'Private group requires an administrator invite.' });
      return;
    }
    const now = new Date().toISOString();
    const mRole = req.user!.role === 'admin' ? 'group_admin' : 'member';
    db.prepare(
      `INSERT OR IGNORE INTO group_members (group_id, user_id, member_role, is_muted, joined_at, last_read_at)
       VALUES (?, ?, ?, 0, ?, ?)`
    ).run(group.id, req.user!.id, mRole, now, now);
    logActivity(req.user!.id, 'GROUP_JOINED', 'group', group.id, { groupName: group.name }, now);
    broadcastToGroup(group.id, { type: 'groups:updated' });
    res.json({ ok: true });
  });

  router.post('/groups/:groupId/leave', requireAuth, (req: AuthenticatedRequest, res) => {
    db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').run(req.params.groupId, req.user!.id);
    logActivity(req.user!.id, 'GROUP_LEFT', 'group', req.params.groupId, {});
    broadcastToGroup(req.params.groupId, { type: 'groups:updated' });
    res.json({ ok: true });
  });

  function canManageGroup(userId: string, userRole: UserRole, groupId: string): boolean {
    if (userRole === 'admin') return true;
    const gm = db
      .prepare('SELECT member_role FROM group_members WHERE group_id = ? AND user_id = ?')
      .get(groupId, userId) as { member_role: string } | undefined;
    return gm?.member_role === 'group_admin';
  }

  router.post('/groups/:groupId/members', requireAuth, (req: AuthenticatedRequest, res) => {
    const { userId } = req.body as { userId?: string };
    if (!userId) {
      res.status(400).json({ error: 'userId is required.' });
      return;
    }
    if (!canManageGroup(req.user!.id, req.user!.role, req.params.groupId)) {
      res.status(403).json({ error: 'Group Administrator or Admin privileges required.' });
      return;
    }
    const now = new Date().toISOString();
    db.prepare(
      `INSERT OR IGNORE INTO group_members (group_id, user_id, member_role, is_muted, joined_at, last_read_at)
       VALUES (?, ?, 'member', 0, ?, ?)`
    ).run(req.params.groupId, userId, now, now);
    logActivity(userId, 'GROUP_JOINED', 'group', req.params.groupId, { addedBy: req.user!.id }, now);
    broadcastToAll({ type: 'groups:updated' });
    res.status(201).json({ ok: true });
  });

  router.patch('/groups/:groupId/members/:userId', requireAuth, (req: AuthenticatedRequest, res) => {
    if (!canManageGroup(req.user!.id, req.user!.role, req.params.groupId)) {
      res.status(403).json({ error: 'Group Administrator or Admin privileges required.' });
      return;
    }
    const { isMuted, memberRole } = req.body as { isMuted?: boolean; memberRole?: 'group_admin' | 'member' };
    if (typeof isMuted === 'boolean') {
      db.prepare('UPDATE group_members SET is_muted = ? WHERE group_id = ? AND user_id = ?').run(
        isMuted ? 1 : 0,
        req.params.groupId,
        req.params.userId
      );
      logActivity(req.params.userId, 'USER_MODERATED', 'group', req.params.groupId, {
        action: isMuted ? 'muted_in_group' : 'unmuted_in_group',
        by: req.user!.id,
      });
    }
    if (memberRole === 'group_admin' || memberRole === 'member') {
      db.prepare('UPDATE group_members SET member_role = ? WHERE group_id = ? AND user_id = ?').run(
        memberRole,
        req.params.groupId,
        req.params.userId
      );
    }
    broadcastToGroup(req.params.groupId, { type: 'groups:updated' });
    res.json({ ok: true });
  });

  router.delete('/groups/:groupId/members/:userId', requireAuth, (req: AuthenticatedRequest, res) => {
    if (!canManageGroup(req.user!.id, req.user!.role, req.params.groupId)) {
      res.status(403).json({ error: 'Group Administrator or Admin privileges required.' });
      return;
    }
    db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').run(
      req.params.groupId,
      req.params.userId
    );
    logActivity(req.params.userId, 'GROUP_LEFT', 'group', req.params.groupId, { removedBy: req.user!.id });
    broadcastToAll({ type: 'groups:updated' });
    res.json({ ok: true });
  });

  // ---------------- NOTIFICATIONS ----------------
  router.get('/notifications', requireAuth, (req: AuthenticatedRequest, res) => {
    const rows = db
      .prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 80')
      .all(req.user!.id) as Array<Record<string, unknown>>;

    res.json({
      notifications: rows.map((n) => ({
        id: n.id,
        userId: n.user_id,
        type: n.type,
        title: n.title,
        body: n.body,
        linkScreen: n.link_screen,
        linkTargetId: n.link_target_id,
        isRead: Boolean(n.is_read),
        createdAt: n.created_at,
      })),
    });
  });

  router.patch('/notifications/:id/read', requireAuth, (req: AuthenticatedRequest, res) => {
    db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(req.params.id, req.user!.id);
    res.json({ ok: true });
  });

  router.post('/notifications/read-all', requireAuth, (req: AuthenticatedRequest, res) => {
    db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.user!.id);
    res.json({ ok: true });
  });

  // ---------------- MODERATION & USER CONTROLS ----------------
  router.get('/moderation/flagged', requireAuth, requireModerator, (_req, res) => {
    const rows = db
      .prepare(
        `SELECT m.*, u.display_name as sender_name, u.email as sender_email, u.role as sender_role,
                g.name as group_name, r.display_name as recipient_name
         FROM messages m
         JOIN users u ON u.id = m.sender_id
         LEFT JOIN groups g ON g.id = m.group_id
         LEFT JOIN users r ON r.id = m.recipient_id
         WHERE m.is_flagged = 1 AND m.is_deleted = 0
         ORDER BY m.created_at DESC`
      )
      .all() as Array<Record<string, unknown>>;

    res.json({
      flagged: rows.map((r) => ({
        id: r.id,
        conversationType: r.conversation_type,
        senderId: r.sender_id,
        senderName: r.sender_name,
        senderEmail: r.sender_email,
        senderRole: r.sender_role,
        groupName: r.group_name,
        recipientName: r.recipient_name,
        content: r.content,
        flagReason: r.flag_reason,
        createdAt: r.created_at,
      })),
    });
  });

  router.post('/moderation/flagged/:id/resolve', requireAuth, requireModerator, (req: AuthenticatedRequest, res) => {
    const { action } = req.body as { action: 'dismiss' | 'delete' };
    if (action === 'delete') {
      db.prepare('UPDATE messages SET is_deleted = 1, is_flagged = 0 WHERE id = ?').run(req.params.id);
      logActivity(req.user!.id, 'USER_MODERATED', 'message', req.params.id, { action: 'deleted_flagged_message' });
      broadcastToAll({ type: 'message:deleted', messageId: req.params.id });
    } else {
      db.prepare('UPDATE messages SET is_flagged = 0, flag_reason = NULL WHERE id = ?').run(req.params.id);
    }
    res.json({ ok: true });
  });

  router.get('/moderation/keywords', requireAuth, requireModerator, (_req, res) => {
    const rows = db.prepare('SELECT * FROM moderation_keywords ORDER BY created_at DESC').all();
    res.json({ keywords: rows });
  });

  router.post('/moderation/keywords', requireAuth, requireModerator, (req: AuthenticatedRequest, res) => {
    const { keyword, action } = req.body as { keyword?: string; action?: 'flag' | 'block' };
    const clean = keyword?.trim().toLowerCase();
    if (!clean || clean.length < 2) {
      res.status(400).json({ error: 'Keyword must be at least 2 characters.' });
      return;
    }
    const id = `kw_${crypto.randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT OR REPLACE INTO moderation_keywords (id, keyword, action, created_by, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(id, clean, action === 'block' ? 'block' : 'flag', req.user!.id, new Date().toISOString());
    res.status(201).json({ id });
  });

  router.delete('/moderation/keywords/:id', requireAuth, requireModerator, (req, res) => {
    db.prepare('DELETE FROM moderation_keywords WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  router.patch('/moderation/users/:userId/status', requireAuth, requireAdmin, (req: AuthenticatedRequest, res) => {
    const { status, role } = req.body as { status?: UserStatus; role?: UserRole };
    const targetId = req.params.userId;

    if (targetId === req.user!.id && (status === 'suspended' || (role && role !== 'admin'))) {
      res.status(400).json({ error: 'Administrators cannot suspend or demote their own active session.' });
      return;
    }

    if (status === 'active' || status === 'muted' || status === 'suspended') {
      db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, targetId);
      logActivity(targetId, 'USER_MODERATED', 'user', targetId, { status, by: req.user!.id });
    }
    if (role === 'admin' || role === 'group_admin' || role === 'user') {
      db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, targetId);
      logActivity(targetId, 'USER_MODERATED', 'user', targetId, { role, by: req.user!.id });
    }
    res.json({ ok: true });
  });

  // Admin-only direct user provisioning
  router.post('/admin/users', requireAuth, requireAdmin, (req: AuthenticatedRequest, res) => {
    const { username, email, displayName, password, role } = req.body as {
      username?: string;
      email?: string;
      displayName?: string;
      password?: string;
      role?: UserRole;
    };
    if (!username?.trim() || !email?.trim() || !displayName?.trim() || !password) {
      res.status(400).json({ error: 'All fields (username, email, displayName, password) are required.' });
      return;
    }
    if (password.length < 6) {
      res.status(400).json({ error: 'Password must be at least 6 characters.' });
      return;
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanUsername = username.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
    if (!cleanUsername) {
      res.status(400).json({ error: 'Username must contain alphanumeric characters.' });
      return;
    }

    const existing = db
      .prepare('SELECT id FROM users WHERE email = ? OR username = ?')
      .get(cleanEmail, cleanUsername);
    if (existing) {
      res.status(409).json({ error: 'An account with this email or username already exists.' });
      return;
    }

    const assignedRole: UserRole =
      role === 'admin' || role === 'group_admin' || role === 'user' ? role : 'user';
    const userId = `usr_${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const color = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];

    db.prepare(
      `INSERT INTO users (id, username, email, display_name, password_hash, role, status, presence_mode, bio, avatar_color, read_receipts_enabled, created_at, last_login_at, last_active_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', 'available', '', ?, 1, ?, NULL, ?)`
    ).run(userId, cleanUsername, cleanEmail, displayName.trim(), hashPassword(password), assignedRole, color, now, now);

    logActivity(
      userId,
      'USER_REGISTERED',
      'user',
      userId,
      { email: cleanEmail, displayName: displayName.trim(), role: assignedRole, createdByAdmin: req.user!.id },
      now
    );

    const created = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as unknown as DbUser;
    res.status(201).json({ user: toSafeUser(created, getOnlineUserIds()) });
  });

  // ---------------- ADMIN-ONLY MANDATORY REPORTS ----------------
  // Strictly gated by requireAdmin (403 Forbidden for Registered Users and Group Administrators)

  // 1. Overview KPIs
  router.get('/admin/reports/overview', requireAuth, requireAdmin, (_req, res) => {
    const totalUsers = (db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }).c;
    const totalGroups = (db.prepare('SELECT COUNT(*) as c FROM groups').get() as { c: number }).c;
    const totalMessages = (db.prepare('SELECT COUNT(*) as c FROM messages WHERE is_deleted = 0').get() as { c: number }).c;
    const flaggedMessages = (
      db.prepare('SELECT COUNT(*) as c FROM messages WHERE is_flagged = 1 AND is_deleted = 0').get() as { c: number }
    ).c;
    const dmCount = (
      db.prepare(`SELECT COUNT(*) as c FROM messages WHERE conversation_type = 'dm' AND is_deleted = 0`).get() as {
        c: number;
      }
    ).c;
    const groupMsgCount = (
      db.prepare(`SELECT COUNT(*) as c FROM messages WHERE conversation_type = 'group' AND is_deleted = 0`).get() as {
        c: number;
      }
    ).c;

    res.json({
      totalUsers,
      onlineUsers: getOnlineUserIds().size,
      totalGroups,
      totalMessages,
      dmCount,
      groupMsgCount,
      flaggedMessages,
    });
  });

  // 2. Message Activity Report
  router.get('/admin/reports/message-activity', requireAuth, requireAdmin, (req, res) => {
    const typeFilter = req.query.type === 'dm' || req.query.type === 'group' ? req.query.type : 'all';

    const statusRows = db
      .prepare(
        `SELECT delivery_status, COUNT(*) as count
         FROM messages WHERE is_deleted = 0
         GROUP BY delivery_status`
      )
      .all() as Array<{ delivery_status: string; count: number }>;

    const dailyRows = db
      .prepare(
        `SELECT substr(created_at, 1, 10) as day,
                SUM(CASE WHEN conversation_type = 'dm' THEN 1 ELSE 0 END) as dm_count,
                SUM(CASE WHEN conversation_type = 'group' THEN 1 ELSE 0 END) as group_count,
                COUNT(*) as total
         FROM messages
         WHERE is_deleted = 0
         GROUP BY substr(created_at, 1, 10)
         ORDER BY day ASC
         LIMIT 14`
      )
      .all() as Array<{ day: string; dm_count: number; group_count: number; total: number }>;

    const whereClause = typeFilter === 'all' ? 'WHERE m.is_deleted = 0' : `WHERE m.is_deleted = 0 AND m.conversation_type = '${typeFilter}'`;
    const recentMessages = db
      .prepare(
        `SELECT m.id, m.conversation_type, m.content, m.delivery_status, m.is_flagged, m.created_at,
                s.display_name as sender_name, s.email as sender_email,
                r.display_name as recipient_name,
                g.name as group_name
         FROM messages m
         JOIN users s ON s.id = m.sender_id
         LEFT JOIN users r ON r.id = m.recipient_id
         LEFT JOIN groups g ON g.id = m.group_id
         ${whereClause}
         ORDER BY m.created_at DESC
         LIMIT 100`
      )
      .all();

    res.json({
      deliveryBreakdown: statusRows,
      dailySeries: dailyRows,
      messages: recentMessages,
    });
  });

  // 3. Group Participation Report
  router.get('/admin/reports/group-participation', requireAuth, requireAdmin, (_req, res) => {
    const groups = db
      .prepare(
        `SELECT g.id, g.name, g.category, g.is_private, g.created_at,
                u.display_name as creator_name,
                (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id = g.id) as member_count,
                (SELECT COUNT(*) FROM messages m WHERE m.group_id = g.id AND m.is_deleted = 0) as total_messages,
                (SELECT COUNT(DISTINCT m.sender_id) FROM messages m WHERE m.group_id = g.id AND m.is_deleted = 0) as active_senders,
                (SELECT MAX(m.created_at) FROM messages m WHERE m.group_id = g.id AND m.is_deleted = 0) as last_activity_at
         FROM groups g
         JOIN users u ON u.id = g.created_by
         ORDER BY total_messages DESC`
      )
      .all() as Array<{
      id: string;
      name: string;
      category: string;
      is_private: number;
      created_at: string;
      creator_name: string;
      member_count: number;
      total_messages: number;
      active_senders: number;
      last_activity_at: string | null;
    }>;

    const topContributors = db
      .prepare(
        `SELECT g.id as group_id, g.name as group_name, u.id as user_id, u.display_name, u.role,
                COUNT(m.id) as messages_sent, MAX(m.created_at) as last_texted_at
         FROM messages m
         JOIN groups g ON g.id = m.group_id
         JOIN users u ON u.id = m.sender_id
         WHERE m.conversation_type = 'group' AND m.is_deleted = 0
         GROUP BY g.id, u.id
         ORDER BY messages_sent DESC
         LIMIT 40`
      )
      .all();

    res.json({
      groups: groups.map((g) => ({
        ...g,
        isPrivate: Boolean(g.is_private),
        participationRate: g.member_count > 0 ? Math.round((g.active_senders / g.member_count) * 100) : 0,
      })),
      topContributors,
    });
  });

  // 4. User Activity Report (When user joined, logged in, texted, group actions + live audit stream)
  router.get('/admin/reports/user-activity', requireAuth, requireAdmin, (_req, res) => {
    const online = getOnlineUserIds();
    const userSummary = db
      .prepare(
        `SELECT u.id, u.username, u.email, u.display_name, u.role, u.status, u.presence_mode,
                u.created_at as joined_at, u.last_login_at, u.last_active_at, u.last_message_at,
                (SELECT COUNT(*) FROM messages m WHERE m.sender_id = u.id AND m.conversation_type = 'dm' AND m.is_deleted = 0) as dm_sent,
                (SELECT COUNT(*) FROM messages m WHERE m.sender_id = u.id AND m.conversation_type = 'group' AND m.is_deleted = 0) as group_msg_sent,
                (SELECT COUNT(*) FROM group_members gm WHERE gm.user_id = u.id) as groups_joined
         FROM users u
         ORDER BY u.created_at DESC`
      )
      .all() as Array<Record<string, unknown>>;

    const timeline = db
      .prepare(
        `SELECT a.id, a.user_id, a.event_type, a.target_type, a.target_id, a.metadata, a.created_at,
                u.display_name, u.username, u.email, u.role
         FROM activity_logs a
         JOIN users u ON u.id = a.user_id
         ORDER BY a.created_at DESC
         LIMIT 150`
      )
      .all() as Array<Record<string, unknown>>;

    res.json({
      users: userSummary.map((u) => ({
        ...u,
        isOnline: online.has(String(u.id)),
        totalMessages: Number(u.dm_sent || 0) + Number(u.group_msg_sent || 0),
      })),
      timeline: timeline.map((t) => ({
        id: t.id,
        userId: t.user_id,
        displayName: t.display_name,
        username: t.username,
        email: t.email,
        role: t.role,
        eventType: t.event_type,
        targetType: t.target_type,
        targetId: t.target_id,
        metadata: typeof t.metadata === 'string' ? JSON.parse(t.metadata) : t.metadata,
        createdAt: t.created_at,
      })),
    });
  });

  // 5. Group Creation Report
  router.get('/admin/reports/group-creation', requireAuth, requireAdmin, (_req, res) => {
    const createdGroups = db
      .prepare(
        `SELECT g.id, g.name, g.description, g.category, g.is_private, g.is_archived, g.created_at,
                u.id as creator_id, u.display_name as creator_name, u.email as creator_email, u.role as creator_role,
                (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id = g.id) as member_count,
                (SELECT COUNT(*) FROM messages m WHERE m.group_id = g.id AND m.is_deleted = 0) as message_count
         FROM groups g
         JOIN users u ON u.id = g.created_by
         ORDER BY g.created_at DESC`
      )
      .all() as Array<Record<string, unknown>>;

    const byCreator = db
      .prepare(
        `SELECT u.id as creator_id, u.display_name as creator_name, u.role as creator_role,
                COUNT(g.id) as groups_created, MAX(g.created_at) as last_created_at
         FROM groups g
         JOIN users u ON u.id = g.created_by
         GROUP BY u.id
         ORDER BY groups_created DESC`
      )
      .all();

    res.json({
      groups: createdGroups.map((g) => ({
        ...g,
        isPrivate: Boolean(g.is_private),
        isArchived: Boolean(g.is_archived),
      })),
      byCreator,
    });
  });

  return router;
}
