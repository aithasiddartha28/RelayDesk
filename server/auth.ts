import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { db, toSafeUser } from './db.ts';
import type { DbUser, SafeUser } from './types.ts';

export interface AuthenticatedRequest extends Request {
  user?: SafeUser;
  token?: string;
}

export function createSession(userId: string): string {
  const token = crypto.randomBytes(32).toString('hex');
  const now = new Date();
  const expires = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  db.prepare(
    `INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`
  ).run(token, userId, now.toISOString(), expires.toISOString());
  return token;
}

export function getUserByToken(token: string | undefined): SafeUser | null {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT u.*, s.expires_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = ?`
    )
    .get(token) as (DbUser & { expires_at: string }) | undefined;

  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  return toSafeUser(row);
}

export function extractToken(req: Request): string | undefined {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  if (typeof req.query.token === 'string') {
    return req.query.token;
  }
  return undefined;
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const token = extractToken(req);
  const user = getUserByToken(token);
  if (!user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  if (user.status === 'suspended') {
    res.status(403).json({ error: 'Account is suspended by administrator' });
    return;
  }
  req.user = user;
  req.token = token;
  next();
}

export function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  if (req.user.role !== 'admin') {
    res.status(403).json({ error: 'Forbidden: Administrator role required to access reports and platform controls' });
    return;
  }
  next();
}

export function requireModerator(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  if (req.user.role !== 'admin' && req.user.role !== 'group_admin') {
    res.status(403).json({ error: 'Forbidden: Admin or Group Administrator privileges required' });
    return;
  }
  next();
}
