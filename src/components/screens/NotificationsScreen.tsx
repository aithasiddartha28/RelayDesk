import { useState } from 'react';
import { Bell, CheckCheck, ExternalLink } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import type { NotificationItem, ScreenId } from '../../types';

interface NotificationsScreenProps {
  notifications: NotificationItem[];
  onRefresh: () => void;
  onNavigateTarget: (screen: ScreenId, targetId?: string | null) => void;
}

export function NotificationsScreen({
  notifications,
  onRefresh,
  onNavigateTarget,
}: NotificationsScreenProps) {
  const [filter, setFilter] = useState<'all' | 'unread'>('all');

  const filtered = filter === 'unread' ? notifications.filter((n) => !n.isRead) : notifications;

  async function markRead(id: string) {
    await apiFetch(`/notifications/${id}/read`, { method: 'PATCH' });
    onRefresh();
  }

  async function markAllRead() {
    await apiFetch('/notifications/read-all', { method: 'POST' });
    onRefresh();
  }

  function handleOpenNotification(ntf: NotificationItem) {
    if (!ntf.isRead) {
      markRead(ntf.id);
    }
    if (ntf.linkScreen === 'dm' || ntf.linkScreen === 'groups' || ntf.linkScreen === 'moderation' || ntf.linkScreen === 'admin-reports') {
      onNavigateTarget(ntf.linkScreen, ntf.linkTargetId);
    }
  }

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Notifications &amp; Alerts</h2>
          <p className="text-xs text-slate-500 mt-1">
            Real-time alerts for direct messages, group invitations, and moderation actions.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              onClick={() => setFilter('all')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md ${
                filter === 'all' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
              }`}
            >
              All ({notifications.length})
            </button>
            <button
              onClick={() => setFilter('unread')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md ${
                filter === 'unread' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
              }`}
            >
              Unread ({notifications.filter((n) => !n.isRead).length})
            </button>
          </div>

          <button
            onClick={markAllRead}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
          >
            <CheckCheck className="w-3.5 h-3.5" />
            Mark All Read
          </button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-12 text-center">
            <Bell className="w-7 h-7 text-slate-300 mx-auto mb-2" />
            <p className="text-sm font-medium text-slate-700">No notifications to display</p>
            <p className="text-xs text-slate-500 mt-1">Incoming WebSocket alerts will appear here immediately.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-200">
            {filtered.map((n) => (
              <div
                key={n.id}
                className={`p-4 flex items-start justify-between gap-4 transition-colors ${
                  n.isRead ? 'bg-white' : 'bg-blue-50/40'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <span className="font-semibold text-slate-900 text-sm">{n.title}</span>
                    {!n.isRead && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="text-blue-700 font-medium">Unread</span>
                      </>
                    )}
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">{formatDateTime(n.createdAt)}</span>
                  </div>
                  <p className="text-xs text-slate-600 mt-1">{n.body}</p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {n.linkScreen && (
                    <button
                      onClick={() => handleOpenNotification(n)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                    >
                      Open
                      <ExternalLink className="w-3 h-3" />
                    </button>
                  )}
                  {!n.isRead && (
                    <button
                      onClick={() => markRead(n.id)}
                      className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-blue-700 hover:bg-blue-50 whitespace-nowrap"
                    >
                      Mark Read
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
