export type UserRole = 'admin' | 'group_admin' | 'user';
export type UserStatus = 'active' | 'muted' | 'suspended';
export type PresenceMode = 'available' | 'busy' | 'away';
export type DeliveryStatus = 'sent' | 'delivered' | 'read';

export type ScreenId =
  | 'dm'
  | 'groups'
  | 'contacts'
  | 'directory'
  | 'notifications'
  | 'moderation'
  | 'admin-reports'
  | 'profile'
  | 'docs';

export type AdminReportTab =
  | 'message-activity'
  | 'group-participation'
  | 'user-activity'
  | 'group-creation';

export interface User {
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

export interface Contact extends User {
  nickname: string;
  isBlocked: boolean;
  addedAt: string;
}

export interface Group {
  id: string;
  name: string;
  description: string;
  category: string;
  isPrivate: boolean;
  createdBy: string;
  creatorName: string;
  createdAt: string;
  isArchived: boolean;
  memberCount: number;
  messageCount: number;
  lastMessageAt: string | null;
  isMember: boolean;
  myGroupRole: 'group_admin' | 'member' | null;
  amMuted: boolean;
}

export interface GroupMember extends User {
  groupRole: 'group_admin' | 'member';
  isMutedInGroup: boolean;
  joinedAt: string;
}

export interface ChatMessage {
  id: string;
  conversationType: 'dm' | 'group';
  senderId: string;
  senderName: string;
  senderAvatarColor: string;
  senderRole: UserRole;
  recipientId: string | null;
  groupId: string | null;
  content: string;
  replyToId: string | null;
  replyPreview: {
    id: string;
    content: string;
    senderName: string;
  } | null;
  deliveryStatus: DeliveryStatus;
  isPinned: boolean;
  isDeleted: boolean;
  isFlagged: boolean;
  flagReason: string | null;
  createdAt: string;
  clientTempId?: string;
}

export interface NotificationItem {
  id: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  linkScreen: string | null;
  linkTargetId: string | null;
  isRead: boolean;
  createdAt: string;
}

export interface FlaggedMessageItem {
  id: string;
  conversationType: 'dm' | 'group';
  senderId: string;
  senderName: string;
  senderEmail: string;
  senderRole: UserRole;
  groupName: string | null;
  recipientName: string | null;
  content: string;
  flagReason: string | null;
  createdAt: string;
}

export interface ModerationKeyword {
  id: string;
  keyword: string;
  action: 'flag' | 'block';
  created_by: string;
  created_at: string;
}

export interface AdminOverview {
  totalUsers: number;
  onlineUsers: number;
  totalGroups: number;
  totalMessages: number;
  dmCount: number;
  groupMsgCount: number;
  flaggedMessages: number;
}

export interface MessageActivityReport {
  deliveryBreakdown: Array<{ delivery_status: string; count: number }>;
  dailySeries: Array<{ day: string; dm_count: number; group_count: number; total: number }>;
  messages: Array<{
    id: string;
    conversation_type: 'dm' | 'group';
    content: string;
    delivery_status: DeliveryStatus;
    is_flagged: number;
    created_at: string;
    sender_name: string;
    sender_email: string;
    recipient_name: string | null;
    group_name: string | null;
  }>;
}

export interface GroupParticipationReport {
  groups: Array<{
    id: string;
    name: string;
    category: string;
    isPrivate: boolean;
    created_at: string;
    creator_name: string;
    member_count: number;
    total_messages: number;
    active_senders: number;
    participationRate: number;
    last_activity_at: string | null;
  }>;
  topContributors: Array<{
    group_id: string;
    group_name: string;
    user_id: string;
    display_name: string;
    role: UserRole;
    messages_sent: number;
    last_texted_at: string;
  }>;
}

export interface UserActivityReport {
  users: Array<{
    id: string;
    username: string;
    email: string;
    display_name: string;
    role: UserRole;
    status: UserStatus;
    presence_mode: PresenceMode;
    joined_at: string;
    last_login_at: string | null;
    last_active_at: string | null;
    last_message_at: string | null;
    dm_sent: number;
    group_msg_sent: number;
    groups_joined: number;
    isOnline: boolean;
    totalMessages: number;
  }>;
  timeline: Array<{
    id: string;
    userId: string;
    displayName: string;
    username: string;
    email: string;
    role: UserRole;
    eventType: string;
    targetType: string | null;
    targetId: string | null;
    metadata: Record<string, unknown>;
    createdAt: string;
  }>;
}

export interface GroupCreationReport {
  groups: Array<{
    id: string;
    name: string;
    description: string;
    category: string;
    isPrivate: boolean;
    isArchived: boolean;
    created_at: string;
    creator_id: string;
    creator_name: string;
    creator_email: string;
    creator_role: UserRole;
    member_count: number;
    message_count: number;
  }>;
  byCreator: Array<{
    creator_id: string;
    creator_name: string;
    creator_role: UserRole;
    groups_created: number;
    last_created_at: string;
  }>;
}
