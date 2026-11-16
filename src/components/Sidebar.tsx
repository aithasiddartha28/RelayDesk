import {
  BarChart3,
  Bell,
  BookOpen,
  Contact,
  FolderKanban,
  Hash,
  LogOut,
  MessageSquare,
  ShieldAlert,
  UserCog,
} from 'lucide-react';
import type { ScreenId, User } from '../types';
import { getRoleLabel } from '../lib/format';
import { Avatar } from './Avatar';

interface SidebarProps {
  user: User;
  activeScreen: ScreenId;
  onNavigate: (screen: ScreenId) => void;
  unreadNotifications: number;
  flaggedCount: number;
  onLogout: () => void;
}

export function Sidebar({
  user,
  activeScreen,
  onNavigate,
  unreadNotifications,
  flaggedCount,
  onLogout,
}: SidebarProps) {
  const navItems: Array<{
    id: ScreenId;
    label: string;
    icon: typeof MessageSquare;
    badge?: number;
    visible: boolean;
  }> = [
    { id: 'dm', label: 'Direct Messages', icon: MessageSquare, visible: true },
    { id: 'groups', label: 'Group Channels', icon: Hash, visible: true },
    { id: 'contacts', label: 'Contacts', icon: Contact, visible: true },
    { id: 'directory', label: 'Groups & Members', icon: FolderKanban, visible: true },
    {
      id: 'notifications',
      label: 'Notifications',
      icon: Bell,
      badge: unreadNotifications > 0 ? unreadNotifications : undefined,
      visible: true,
    },
    {
      id: 'moderation',
      label: user.role === 'user' ? 'Privacy & Blocks' : 'Moderation & Controls',
      icon: ShieldAlert,
      badge: user.role !== 'user' && flaggedCount > 0 ? flaggedCount : undefined,
      visible: true,
    },
    {
      id: 'admin-reports',
      label: 'Admin Reports',
      icon: BarChart3,
      visible: user.role === 'admin',
    },
    { id: 'profile', label: 'Account & Profile', icon: UserCog, visible: true },
    { id: 'docs', label: 'Architecture & Ops', icon: BookOpen, visible: true },
  ];

  return (
    <aside className="w-64 shrink-0 bg-white border-r border-slate-200 flex flex-col justify-between h-full">
      <div className="p-4 flex flex-col gap-6 overflow-y-auto">
        <div className="flex items-center justify-between px-2 pt-1">
          <span className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0">
            RelayDesk
          </span>
        </div>

        <nav className="flex flex-col gap-1" aria-label="Workspace Navigation">
          {navItems
            .filter((item) => item.visible)
            .map((item) => {
              const Icon = item.icon;
              const isActive = activeScreen === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => onNavigate(item.id)}
                  className={`flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-left ${
                    isActive
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  <span className="flex items-center gap-2.5 min-w-0">
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </span>
                  {item.badge !== undefined && (
                    <span
                      className={`ml-2 text-xs font-mono tabular-nums px-1.5 py-0.5 rounded ${
                        isActive ? 'bg-white/20 text-white' : 'bg-blue-50 text-blue-700'
                      }`}
                    >
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
        </nav>
      </div>

      <div className="p-4 border-t border-slate-200 bg-slate-50/70">
        <div className="flex items-center gap-3 mb-3">
          <Avatar
            name={user.displayName}
            color={user.avatarColor}
            isOnline={true}
            presenceMode={user.presenceMode}
            showPresence={true}
          />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-slate-900 truncate">{user.displayName}</div>
            <div className="text-xs text-slate-500 truncate">{getRoleLabel(user.role)}</div>
          </div>
        </div>
        <button
          onClick={onLogout}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 transition-colors whitespace-nowrap"
        >
          <LogOut className="w-3.5 h-3.5" />
          Sign Out
        </button>
      </div>
    </aside>
  );
}
