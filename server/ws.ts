import crypto from 'node:crypto';
import type { Server as HttpServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { getUserByToken } from './auth.ts';
import { createNotification, db, logActivity } from './db.ts';
import type { DeliveryStatus, PresenceMode, SafeUser } from './types.ts';

interface AuthedSocket extends WebSocket {
  userId?: string;
  user?: SafeUser;
  isAlive?: boolean;
}

const clientsByUser = new Map<string, Set<AuthedSocket>>();

export function getOnlineUserIds(): Set<string> {
  const online = new Set<string>();
  for (const [uid, sockets] of clientsByUser.entries()) {
    if (sockets.size > 0) {
      online.add(uid);
    }
  }
  return online;
}

export function broadcastToUser(userId: string, payload: unknown): void {
  const sockets = clientsByUser.get(userId);
  if (!sockets) return;
  const raw = JSON.stringify(payload);
  for (const ws of sockets) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(raw);
    }
  }
}

export function broadcastToGroup(groupId: string, payload: unknown): void {
  const members = db
    .prepare('SELECT user_id FROM group_members WHERE group_id = ?')
    .all(groupId) as Array<{ user_id: string }>;
  for (const m of members) {
    broadcastToUser(m.user_id, payload);
  }
}

export function broadcastToAll(payload: unknown): void {
  const raw = JSON.stringify(payload);
  for (const sockets of clientsByUser.values()) {
    for (const ws of sockets) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(raw);
      }
    }
  }
}

function sendError(ws: WebSocket, message: string): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'error', message }));
  }
}

function getFreshUserStatus(userId: string): { status: string; display_name: string; avatar_color: string; role: string } | undefined {
  return db
    .prepare('SELECT status, display_name, avatar_color, role FROM users WHERE id = ?')
    .get(userId) as { status: string; display_name: string; avatar_color: string; role: string } | undefined;
}

export function setupWebSockets(server: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const reqUrl = request.url || '/';
    if (!reqUrl.startsWith('/ws')) {
      return;
    }

    const parsed = new URL(reqUrl, `http://${request.headers.host || 'localhost'}`);
    const token = parsed.searchParams.get('token') || undefined;
    const user = getUserByToken(token);

    if (!user || user.status === 'suspended') {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      const authed = ws as AuthedSocket;
      authed.userId = user.id;
      authed.user = user;
      authed.isAlive = true;
      wss.emit('connection', authed, request);
    });
  });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      const authed = ws as AuthedSocket;
      if (authed.isAlive === false) {
        authed.terminate();
        continue;
      }
      authed.isAlive = false;
      authed.ping();
    }
  }, 25000);

  wss.on('close', () => clearInterval(heartbeat));

  wss.on('connection', (ws: AuthedSocket) => {
    const userId = ws.userId!;
    const nowIso = new Date().toISOString();

    let userSockets = clientsByUser.get(userId);
    const wasOffline = !userSockets || userSockets.size === 0;
    if (!userSockets) {
      userSockets = new Set();
      clientsByUser.set(userId, userSockets);
    }
    userSockets.add(ws);

    db.prepare('UPDATE users SET last_active_at = ? WHERE id = ?').run(nowIso, userId);

    if (wasOffline) {
      logActivity(userId, 'USER_JOINED_WS', 'session', userId, { displayName: ws.user?.displayName }, nowIso);
      // Upgrade any pending 'sent' DMs to 'delivered' now that this user connected
      const undelivered = db
        .prepare(`SELECT id, sender_id FROM messages WHERE conversation_type = 'dm' AND recipient_id = ? AND delivery_status = 'sent' AND is_deleted = 0`)
        .all(userId) as Array<{ id: string; sender_id: string }>;

      if (undelivered.length > 0) {
        db.prepare(`UPDATE messages SET delivery_status = 'delivered' WHERE conversation_type = 'dm' AND recipient_id = ? AND delivery_status = 'sent'`).run(userId);
        for (const msg of undelivered) {
          broadcastToUser(msg.sender_id, {
            type: 'message:status',
            messageId: msg.id,
            deliveryStatus: 'delivered',
          });
        }
      }
    }

    // Send initial online roster to connected client
    ws.send(
      JSON.stringify({
        type: 'ws:ready',
        onlineUserIds: Array.from(getOnlineUserIds()),
      })
    );

    // Notify everyone else about updated presence
    broadcastToAll({
      type: 'presence:changed',
      userId,
      isOnline: true,
      presenceMode: ws.user?.presenceMode || 'available',
    });

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', (rawData) => {
      try {
        const msg = JSON.parse(rawData.toString()) as Record<string, unknown>;
        const eventType = typeof msg.type === 'string' ? msg.type : '';

        if (eventType === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
          return;
        }

        if (eventType === 'presence:update') {
          const mode = msg.presenceMode;
          if (mode === 'available' || mode === 'busy' || mode === 'away') {
            db.prepare('UPDATE users SET presence_mode = ?, last_active_at = ? WHERE id = ?').run(
              mode,
              new Date().toISOString(),
              userId
            );
            broadcastToAll({
              type: 'presence:changed',
              userId,
              isOnline: true,
              presenceMode: mode as PresenceMode,
            });
          }
          return;
        }

        if (eventType === 'typing:start' || eventType === 'typing:stop') {
          const conversationType = msg.conversationType === 'group' ? 'group' : 'dm';
          const targetId = typeof msg.targetId === 'string' ? msg.targetId : '';
          if (!targetId) return;

          const payload = {
            type: 'typing:update',
            conversationType,
            targetId,
            userId,
            displayName: ws.user?.displayName || 'User',
            isTyping: eventType === 'typing:start',
          };

          if (conversationType === 'dm') {
            broadcastToUser(targetId, payload);
          } else {
            broadcastToGroup(targetId, payload);
          }
          return;
        }

        if (eventType === 'message:read') {
          const conversationType = msg.conversationType === 'group' ? 'group' : 'dm';
          const targetId = typeof msg.targetId === 'string' ? msg.targetId : '';
          if (!targetId) return;

          const readPreference = db
            .prepare('SELECT read_receipts_enabled FROM users WHERE id = ?')
            .get(userId) as { read_receipts_enabled: number } | undefined;

          if (conversationType === 'dm') {
            const unread = db
              .prepare(
                `SELECT id, sender_id FROM messages
                 WHERE conversation_type = 'dm' AND sender_id = ? AND recipient_id = ? AND delivery_status != 'read' AND is_deleted = 0`
              )
              .all(targetId, userId) as Array<{ id: string; sender_id: string }>;

            if (unread.length > 0 && readPreference?.read_receipts_enabled !== 0) {
              db.prepare(
                `UPDATE messages SET delivery_status = 'read'
                 WHERE conversation_type = 'dm' AND sender_id = ? AND recipient_id = ? AND delivery_status != 'read'`
              ).run(targetId, userId);

              for (const row of unread) {
                broadcastToUser(row.sender_id, {
                  type: 'message:status',
                  messageId: row.id,
                  deliveryStatus: 'read',
                });
              }
            }
          } else {
            db.prepare('UPDATE group_members SET last_read_at = ? WHERE group_id = ? AND user_id = ?').run(
              new Date().toISOString(),
              targetId,
              userId
            );
            if (readPreference?.read_receipts_enabled !== 0) {
              const unreadGroup = db
                .prepare(
                  `SELECT id, sender_id FROM messages
                   WHERE conversation_type = 'group' AND group_id = ? AND sender_id != ? AND delivery_status != 'read' AND is_deleted = 0`
                )
                .all(targetId, userId) as Array<{ id: string; sender_id: string }>;
              if (unreadGroup.length > 0) {
                db.prepare(
                  `UPDATE messages SET delivery_status = 'read'
                   WHERE conversation_type = 'group' AND group_id = ? AND sender_id != ? AND delivery_status != 'read'`
                ).run(targetId, userId);
                for (const row of unreadGroup) {
                  broadcastToUser(row.sender_id, {
                    type: 'message:status',
                    messageId: row.id,
                    deliveryStatus: 'read',
                  });
                }
              }
            }
          }
          return;
        }

        if (eventType === 'message:send') {
          const freshUser = getFreshUserStatus(userId);
          if (!freshUser || freshUser.status === 'suspended') {
            sendError(ws, 'Your account is suspended.');
            return;
          }
          if (freshUser.status === 'muted') {
            sendError(ws, 'Your account is muted by an administrator and cannot send messages.');
            return;
          }

          const conversationType = msg.conversationType === 'group' ? 'group' : 'dm';
          const targetId = typeof msg.targetId === 'string' ? msg.targetId : '';
          const rawContent = typeof msg.content === 'string' ? msg.content.trim() : '';
          const replyToId = typeof msg.replyToId === 'string' && msg.replyToId ? msg.replyToId : null;
          const clientTempId = typeof msg.clientTempId === 'string' ? msg.clientTempId : undefined;

          if (!targetId || !rawContent) {
            sendError(ws, 'Message target and content are required.');
            return;
          }
          if (rawContent.length > 4000) {
            sendError(ws, 'Message exceeds maximum length of 4000 characters.');
            return;
          }

          // Moderation keyword policy check
          const keywords = db.prepare('SELECT keyword, action FROM moderation_keywords').all() as Array<{
            keyword: string;
            action: 'flag' | 'block';
          }>;
          const lower = rawContent.toLowerCase();
          let isFlagged = 0;
          let flagReason: string | null = null;
          for (const kw of keywords) {
            if (lower.includes(kw.keyword.toLowerCase())) {
              if (kw.action === 'block') {
                sendError(ws, `Message blocked by moderation policy (restricted term: "${kw.keyword}").`);
                return;
              }
              isFlagged = 1;
              flagReason = `Auto-flagged by keyword policy ("${kw.keyword}")`;
            }
          }

          const now = new Date().toISOString();
          const msgId = `msg_${crypto.randomUUID()}`;
          const onlineIds = getOnlineUserIds();

          if (conversationType === 'dm') {
            // Check recipient exists
            const recipient = db.prepare('SELECT id, display_name FROM users WHERE id = ?').get(targetId) as
              | { id: string; display_name: string }
              | undefined;
            if (!recipient) {
              sendError(ws, 'Recipient user not found.');
              return;
            }
            // Check block status in either direction
            const blocked = db
              .prepare(
                `SELECT 1 FROM contacts WHERE ((user_id = ? AND contact_id = ?) OR (user_id = ? AND contact_id = ?)) AND is_blocked = 1`
              )
              .get(targetId, userId, userId, targetId);
            if (blocked) {
              sendError(ws, 'Messaging unavailable: contact is blocked.');
              return;
            }

            const deliveryStatus: DeliveryStatus = onlineIds.has(targetId) ? 'delivered' : 'sent';
            db.prepare(
              `INSERT INTO messages (id, conversation_type, sender_id, recipient_id, group_id, content, reply_to_id, delivery_status, is_pinned, is_deleted, is_flagged, flag_reason, created_at)
               VALUES (?, 'dm', ?, ?, NULL, ?, ?, ?, 0, 0, ?, ?, ?)`
            ).run(msgId, userId, targetId, rawContent, replyToId, deliveryStatus, isFlagged, flagReason, now);

            db.prepare('UPDATE users SET last_message_at = ?, last_active_at = ? WHERE id = ?').run(now, now, userId);

            logActivity(
              userId,
              'USER_TEXTED_DM',
              'user',
              targetId,
              { messageId: msgId, recipientName: recipient.display_name, length: rawContent.length },
              now
            );

            if (isFlagged) {
              logActivity(userId, 'MESSAGE_FLAGGED', 'message', msgId, { reason: flagReason }, now);
              const admins = db.prepare(`SELECT id FROM users WHERE role = 'admin'`).all() as Array<{ id: string }>;
              for (const adm of admins) {
                const ntf = createNotification(
                  adm.id,
                  'moderation',
                  'Message Flagged by Policy',
                  `${freshUser.display_name} sent a flagged DM (${flagReason}).`,
                  'moderation',
                  msgId,
                  now
                );
                broadcastToUser(adm.id, { type: 'notification:new', notification: ntf });
              }
            }

            const replyRow = replyToId
              ? (db
                  .prepare(
                    `SELECT m.id, m.content, u.display_name as sender_name
                     FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.id = ?`
                  )
                  .get(replyToId) as { id: string; content: string; sender_name: string } | undefined)
              : undefined;

            const messagePayload = {
              id: msgId,
              conversationType: 'dm',
              senderId: userId,
              senderName: freshUser.display_name,
              senderAvatarColor: freshUser.avatar_color,
              senderRole: freshUser.role,
              recipientId: targetId,
              groupId: null,
              content: rawContent,
              replyToId,
              replyPreview: replyRow
                ? { id: replyRow.id, content: replyRow.content, senderName: replyRow.sender_name }
                : null,
              deliveryStatus,
              isPinned: false,
              isDeleted: false,
              isFlagged: Boolean(isFlagged),
              flagReason,
              createdAt: now,
              clientTempId,
            };

            broadcastToUser(userId, { type: 'message:new', message: messagePayload });
            if (targetId !== userId) {
              broadcastToUser(targetId, { type: 'message:new', message: messagePayload });
              const ntf = createNotification(
                targetId,
                'dm',
                `Direct message from ${freshUser.display_name}`,
                rawContent.slice(0, 100),
                'dm',
                userId,
                now
              );
              broadcastToUser(targetId, { type: 'notification:new', notification: ntf });
            }
          } else {
            // Group messaging
            const membership = db
              .prepare(
                `SELECT gm.is_muted, g.name as group_name, g.is_archived
                 FROM group_members gm
                 JOIN groups g ON g.id = gm.group_id
                 WHERE gm.group_id = ? AND gm.user_id = ?`
              )
              .get(targetId, userId) as { is_muted: number; group_name: string; is_archived: number } | undefined;

            if (!membership) {
              sendError(ws, 'You must join this group before sending messages.');
              return;
            }
            if (membership.is_archived) {
              sendError(ws, 'This group is archived and read-only.');
              return;
            }
            if (membership.is_muted) {
              sendError(ws, 'You are muted in this group by a Group Administrator.');
              return;
            }

            const members = db
              .prepare('SELECT user_id FROM group_members WHERE group_id = ?')
              .all(targetId) as Array<{ user_id: string }>;
            const anyOtherOnline = members.some((m) => m.user_id !== userId && onlineIds.has(m.user_id));
            const deliveryStatus: DeliveryStatus = anyOtherOnline ? 'delivered' : 'sent';

            db.prepare(
              `INSERT INTO messages (id, conversation_type, sender_id, recipient_id, group_id, content, reply_to_id, delivery_status, is_pinned, is_deleted, is_flagged, flag_reason, created_at)
               VALUES (?, 'group', ?, NULL, ?, ?, ?, ?, 0, 0, ?, ?, ?)`
            ).run(msgId, userId, targetId, rawContent, replyToId, deliveryStatus, isFlagged, flagReason, now);

            db.prepare('UPDATE users SET last_message_at = ?, last_active_at = ? WHERE id = ?').run(now, now, userId);

            logActivity(
              userId,
              'USER_TEXTED_GROUP',
              'group',
              targetId,
              { messageId: msgId, groupName: membership.group_name, length: rawContent.length },
              now
            );

            if (isFlagged) {
              logActivity(userId, 'MESSAGE_FLAGGED', 'message', msgId, { reason: flagReason, groupId: targetId }, now);
              const moderators = db
                .prepare(`SELECT id FROM users WHERE role IN ('admin', 'group_admin')`)
                .all() as Array<{ id: string }>;
              for (const mod of moderators) {
                const ntf = createNotification(
                  mod.id,
                  'moderation',
                  `Flagged message in ${membership.group_name}`,
                  `${freshUser.display_name}: ${rawContent.slice(0, 80)}`,
                  'moderation',
                  msgId,
                  now
                );
                broadcastToUser(mod.id, { type: 'notification:new', notification: ntf });
              }
            }

            const replyRow = replyToId
              ? (db
                  .prepare(
                    `SELECT m.id, m.content, u.display_name as sender_name
                     FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.id = ?`
                  )
                  .get(replyToId) as { id: string; content: string; sender_name: string } | undefined)
              : undefined;

            const messagePayload = {
              id: msgId,
              conversationType: 'group',
              senderId: userId,
              senderName: freshUser.display_name,
              senderAvatarColor: freshUser.avatar_color,
              senderRole: freshUser.role,
              recipientId: null,
              groupId: targetId,
              content: rawContent,
              replyToId,
              replyPreview: replyRow
                ? { id: replyRow.id, content: replyRow.content, senderName: replyRow.sender_name }
                : null,
              deliveryStatus,
              isPinned: false,
              isDeleted: false,
              isFlagged: Boolean(isFlagged),
              flagReason,
              createdAt: now,
              clientTempId,
            };

            broadcastToGroup(targetId, { type: 'message:new', message: messagePayload });

            // Notify group members who were mentioned or all members on new activity
            for (const m of members) {
              if (m.user_id !== userId) {
                const ntf = createNotification(
                  m.user_id,
                  'group',
                  `#${membership.group_name} · ${freshUser.display_name}`,
                  rawContent.slice(0, 100),
                  'groups',
                  targetId,
                  now
                );
                broadcastToUser(m.user_id, { type: 'notification:new', notification: ntf });
              }
            }
          }
        }
      } catch (err) {
        console.error('WebSocket message error:', err);
        sendError(ws, 'Invalid message payload.');
      }
    });

    ws.on('close', () => {
      const sockets = clientsByUser.get(userId);
      if (sockets) {
        sockets.delete(ws);
        if (sockets.size === 0) {
          clientsByUser.delete(userId);
          const leftAt = new Date().toISOString();
          db.prepare('UPDATE users SET last_active_at = ? WHERE id = ?').run(leftAt, userId);
          logActivity(userId, 'USER_LEFT_WS', 'session', userId, { displayName: ws.user?.displayName }, leftAt);
          broadcastToAll({
            type: 'presence:changed',
            userId,
            isOnline: false,
            presenceMode: ws.user?.presenceMode || 'available',
          });
        }
      }
    });
  });

  return wss;
}
