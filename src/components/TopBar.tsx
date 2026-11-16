import { Menu, Plus, Wifi, WifiOff } from 'lucide-react';
import type { ScreenId, User } from '../types';

interface TopBarProps {
  user: User;
  activeScreen: ScreenId;
  wsConnected: boolean;
  onToggleMobileMenu: () => void;
  onCreateGroupClick: () => void;
}

const SCREEN_TITLES: Record<ScreenId, { section: string; title: string }> = {
  dm: { section: 'Messaging', title: 'Direct Messages' },
  groups: { section: 'Messaging', title: 'Group Channels' },
  contacts: { section: 'Workspace', title: 'Contacts Directory' },
  directory: { section: 'Workspace', title: 'Groups & Membership' },
  notifications: { section: 'Inbox', title: 'Notifications Center' },
  moderation: { section: 'Governance', title: 'Moderation & Controls' },
  'admin-reports': { section: 'Admin Console', title: 'Mandatory Activity Reports' },
  profile: { section: 'Preferences', title: 'Account & Profile' },
  docs: { section: 'Documentation', title: 'Architecture, Docker & Kubernetes' },
};

export function TopBar({
  user,
  activeScreen,
  wsConnected,
  onToggleMobileMenu,
  onCreateGroupClick,
}: TopBarProps) {
  const meta = SCREEN_TITLES[activeScreen];

  return (
    <header className="h-14 shrink-0 bg-white border-b border-slate-200 px-4 lg:px-6 flex items-center justify-between gap-8">
      <div className="flex items-center gap-3 min-w-0">
        <button
          onClick={onToggleMobileMenu}
          className="lg:hidden p-2 -ml-2 rounded-lg text-slate-600 hover:bg-slate-100"
          aria-label="Toggle navigation menu"
        >
          <Menu className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-2 text-sm min-w-0">
          <span className="text-slate-400 whitespace-nowrap shrink-0 hidden sm:inline">{meta.section}</span>
          <span className="text-slate-300 hidden sm:inline" aria-hidden="true">/</span>
          <h1 className="font-semibold text-slate-900 truncate">{meta.title}</h1>
        </div>
      </div>

      <div className="flex items-center gap-4 shrink-0">
        <div
          className="flex items-center gap-1.5 text-xs font-mono tabular-nums text-slate-600 whitespace-nowrap shrink-0"
          title={wsConnected ? 'WebSocket connected' : 'Reconnecting WebSocket...'}
        >
          {wsConnected ? (
            <>
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <Wifi className="w-3.5 h-3.5 text-emerald-600" />
              <span className="hidden sm:inline">Live WS</span>
            </>
          ) : (
            <>
              <span className="w-2 h-2 rounded-full bg-amber-500" />
              <WifiOff className="w-3.5 h-3.5 text-amber-600" />
              <span className="hidden sm:inline">Reconnecting</span>
            </>
          )}
        </div>

        <button
          onClick={onCreateGroupClick}
          disabled={user.status === 'muted'}
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
          New Group
        </button>
      </div>
    </header>
  );
}
