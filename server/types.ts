export type UserRole = 'admin' | 'group_admin' | 'user';
export type UserStatus = 'active' | 'muted' | 'suspended';
export type PresenceMode = 'available' | 'busy' | 'away';
export type DeliveryStatus = 'sent' | 'delivered' | 'read';
export type ConversationType = 'dm' | 'group';

export interface DbUser {
  id: string;
  username: string;
  email: string;
  display_name: string;
  password_hash: string;
  role: UserRole;
  status: UserStatus;
  presence_mode: PresenceMode;
  bio: string;
  avatar_color: string;
  read_receipts_enabled: number;
  created_at: string;
  last_login_at: string | null;
  last_active_at: string | null;
  last_message_at: string | null;
}

export interface SafeUser {
  id: string;
  username: string;
  email: string;
  displayName: string;
  role: UserRole;
  status: UserStatus;
  presenceMode: PresenceMode;
  bio: string;
  avatarColor: string;
  readReceiptsEnabled: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  lastActiveAt: string | null;
  lastMessageAt: string | null;
  isOnline?: boolean;
}

export interface DbMessage {
  id: string;
  conversation_type: ConversationType;
  sender_id: string;
  recipient_id: string | null;
  group_id: string | null;
  content: string;
  reply_to_id: string | null;
  delivery_status: DeliveryStatus;
  is_pinned: number;
  is_deleted: number;
  is_flagged: number;
  flag_reason: string | null;
  created_at: string;
  updated_at: string | null;
}
