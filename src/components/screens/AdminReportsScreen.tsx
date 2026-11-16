import { useEffect, useMemo, useState } from 'react';
import { Download, RefreshCw, Search, ShieldAlert } from 'lucide-react';
import { apiFetch, downloadCsv } from '../../lib/api';
import { formatFullTimestamp, formatRelativeTime, getRoleLabel } from '../../lib/format';
import type {
  AdminOverview,
  AdminReportTab,
  GroupCreationReport,
  GroupParticipationReport,
  MessageActivityReport,
  User,
  UserActivityReport,
} from '../../types';

interface AdminReportsScreenProps {
  currentUser: User;
}

const EVENT_LABELS: Record<string, string> = {
  USER_REGISTERED: 'Account Joined',
  USER_LOGIN: 'Signed In',
  USER_JOINED_WS: 'Connected Live WS',
  USER_LEFT_WS: 'Disconnected WS',
  USER_TEXTED_DM: 'Texted (1-to-1 DM)',
  USER_TEXTED_GROUP: 'Texted (Group)',
  GROUP_CREATED: 'Created Group',
  GROUP_JOINED: 'Joined Group',
  GROUP_LEFT: 'Left Group',
  MESSAGE_FLAGGED: 'Flagged Message',
  USER_MODERATED: 'Moderation Action',
};

export function AdminReportsScreen({ currentUser }: AdminReportsScreenProps) {
  const [activeTab, setActiveTab] = useState<AdminReportTab>('user-activity');
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [msgReport, setMsgReport] = useState<MessageActivityReport | null>(null);
  const [participationReport, setParticipationReport] = useState<GroupParticipationReport | null>(null);
  const [userReport, setUserReport] = useState<UserActivityReport | null>(null);
  const [groupCreationReport, setGroupCreationReport] = useState<GroupCreationReport | null>(null);
  const [msgTypeFilter, setMsgTypeFilter] = useState<'all' | 'dm' | 'group'>('all');
  const [userSearch, setUserSearch] = useState('');
  const [eventFilter, setEventFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  if (currentUser.role !== 'admin') {
    return (
      <div className="bg-white border border-red-200 rounded-xl p-10 text-center max-w-lg mx-auto my-12">
        <ShieldAlert className="w-8 h-8 text-red-600 mx-auto mb-3" />
        <h2 className="text-base font-semibold text-slate-900">Administrator Access Required</h2>
        <p className="text-xs text-slate-600 mt-1">
          Mandatory platform reports (User Activity, Message Activity, Group Participation, and Group Creation)
          are strictly restricted to Admin accounts.
        </p>
      </div>
    );
  }

  const loadReports = async () => {
    setLoading(true);
    setError(null);
    try {
      const [ov, msg, part, usr, grp] = await Promise.all([
        apiFetch<AdminOverview>('/admin/reports/overview'),
        apiFetch<MessageActivityReport>(`/admin/reports/message-activity?type=${msgTypeFilter}`),
        apiFetch<GroupParticipationReport>('/admin/reports/group-participation'),
        apiFetch<UserActivityReport>('/admin/reports/user-activity'),
        apiFetch<GroupCreationReport>('/admin/reports/group-creation'),
      ]);
      setOverview(ov);
      setMsgReport(msg);
      setParticipationReport(part);
      setUserReport(usr);
      setGroupCreationReport(grp);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load admin reports');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReports();
  }, [msgTypeFilter]);

  const filteredTimeline = useMemo(() => {
    if (!userReport) return [];
    return userReport.timeline.filter((item) => {
      const matchesEvent = eventFilter === 'all' || item.eventType === eventFilter;
      const q = userSearch.toLowerCase();
      const matchesQuery =
        !q ||
        item.displayName.toLowerCase().includes(q) ||
        item.email.toLowerCase().includes(q) ||
        item.username.toLowerCase().includes(q);
      return matchesEvent && matchesQuery;
    });
  }, [userReport, eventFilter, userSearch]);

  const filteredUsers = useMemo(() => {
    if (!userReport) return [];
    const q = userSearch.toLowerCase();
    if (!q) return userReport.users;
    return userReport.users.filter(
      (u) =>
        u.display_name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.username.toLowerCase().includes(q)
    );
  }, [userReport, userSearch]);

  function handleExportCsv() {
    if (activeTab === 'message-activity' && msgReport) {
      downloadCsv(
        'message-activity-report.csv',
        ['ID', 'Type', 'Sender', 'Target', 'Status', 'Flagged', 'Timestamp', 'Content'],
        msgReport.messages.map((m) => [
          m.id,
          m.conversation_type,
          m.sender_name,
          m.group_name ? `#${m.group_name}` : m.recipient_name,
          m.delivery_status,
          Boolean(m.is_flagged),
          m.created_at,
          m.content,
        ])
      );
    } else if (activeTab === 'group-participation' && participationReport) {
      downloadCsv(
        'group-participation-report.csv',
        ['Group', 'Category', 'Creator', 'Members', 'Active Senders', 'Participation %', 'Total Messages', 'Last Activity'],
        participationReport.groups.map((g) => [
          g.name,
          g.category,
          g.creator_name,
          g.member_count,
          g.active_senders,
          g.participationRate,
          g.total_messages,
          g.last_activity_at,
        ])
      );
    } else if (activeTab === 'user-activity' && userReport) {
      downloadCsv(
        'user-activity-report.csv',
        ['Name', 'Email', 'Role', 'Status', 'Joined At', 'Last Login', 'Last Texted', 'DMs Sent', 'Group Msgs', 'Groups Joined'],
        userReport.users.map((u) => [
          u.display_name,
          u.email,
          u.role,
          u.status,
          u.joined_at,
          u.last_login_at,
          u.last_message_at,
          u.dm_sent,
          u.group_msg_sent,
          u.groups_joined,
        ])
      );
    } else if (activeTab === 'group-creation' && groupCreationReport) {
      downloadCsv(
        'group-creation-report.csv',
        ['Group Name', 'Category', 'Privacy', 'Creator', 'Creator Role', 'Members', 'Messages', 'Created At'],
        groupCreationReport.groups.map((g) => [
          g.name,
          g.category,
          g.isPrivate ? 'Private' : 'Public',
          g.creator_name,
          g.creator_role,
          g.member_count,
          g.message_count,
          g.created_at,
        ])
      );
    }
  }

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Admin-Only Mandatory Reporting Suite</h2>
          <p className="text-xs text-slate-500 mt-1">
            Auditable real-time telemetry across user joins, messaging timestamps, group participation, and group creation.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={loadReports}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            onClick={handleExportCsv}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </button>
        </div>
      </div>

      {/* 4-Column Overview Strip */}
      {overview && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="text-xs text-slate-500">Registered Users</div>
            <div className="mt-1 text-2xl font-bold font-mono tabular-nums text-slate-900">
              {overview.totalUsers}
            </div>
            <div className="mt-1 text-xs text-emerald-700 font-mono tabular-nums">
              {overview.onlineUsers} connected live
            </div>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="text-xs text-slate-500">Total Messages</div>
            <div className="mt-1 text-2xl font-bold font-mono tabular-nums text-slate-900">
              {overview.totalMessages}
            </div>
            <div className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
              {overview.dmCount} DM · {overview.groupMsgCount} Group
            </div>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="text-xs text-slate-500">Active Groups</div>
            <div className="mt-1 text-2xl font-bold font-mono tabular-nums text-slate-900">
              {overview.totalGroups}
            </div>
            <div className="mt-1 text-xs text-slate-500">Across all categories</div>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="text-xs text-slate-500">Flagged Queue</div>
            <div className="mt-1 text-2xl font-bold font-mono tabular-nums text-slate-900">
              {overview.flaggedMessages}
            </div>
            <div className="mt-1 text-xs text-amber-700">Pending moderation review</div>
          </div>
        </div>
      )}

      {/* Report Navigation Tabs */}
      <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-200/70 rounded-xl w-fit">
        {(
          [
            { id: 'user-activity', label: '01. User Activity Report' },
            { id: 'message-activity', label: '02. Message Activity Report' },
            { id: 'group-participation', label: '03. Group Participation Report' },
            { id: 'group-creation', label: '04. Group Creation Report' },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3.5 py-2 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
              activeTab === tab.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error && <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">{error}</div>}

      {/* REPORT 1: USER ACTIVITY REPORT (Join, Login, Texted, Live Audit Log) */}
      {activeTab === 'user-activity' && userReport && (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  User Lifecycle &amp; Messaging Summary
                </h3>
                <p className="text-xs text-slate-500">
                  Exact timestamps for when each user joined, last signed in, and last sent a message.
                </p>
              </div>
              <div className="relative w-64">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  placeholder="Filter by user or email..."
                  className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
                />
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">User</th>
                    <th className="px-4 py-2.5 font-medium">Role</th>
                    <th className="px-4 py-2.5 font-medium">Joined At</th>
                    <th className="px-4 py-2.5 font-medium">Last Login</th>
                    <th className="px-4 py-2.5 font-medium">Last Texted</th>
                    <th className="px-4 py-2.5 font-medium text-right">DMs</th>
                    <th className="px-4 py-2.5 font-medium text-right">Group Msgs</th>
                    <th className="px-4 py-2.5 font-medium text-right">Groups</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {filteredUsers.map((u) => (
                    <tr key={u.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-900">{u.display_name}</div>
                        <div className="text-slate-500 font-mono">{u.email}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-slate-800">{getRoleLabel(u.role)}</div>
                        <div className={u.isOnline ? 'text-emerald-700 font-medium' : 'text-slate-400'}>
                          {u.isOnline ? 'Online now' : `Active ${formatRelativeTime(u.last_active_at)}`}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono tabular-nums text-slate-700 whitespace-nowrap">
                        {formatFullTimestamp(u.joined_at)}
                      </td>
                      <td className="px-4 py-3 font-mono tabular-nums text-slate-700 whitespace-nowrap">
                        {formatFullTimestamp(u.last_login_at)}
                      </td>
                      <td className="px-4 py-3 font-mono tabular-nums text-slate-700 whitespace-nowrap">
                        {formatFullTimestamp(u.last_message_at)}
                      </td>
                      <td className="px-4 py-3 font-mono tabular-nums text-right text-slate-900">{u.dm_sent}</td>
                      <td className="px-4 py-3 font-mono tabular-nums text-right text-slate-900">{u.group_msg_sent}</td>
                      <td className="px-4 py-3 font-mono tabular-nums text-right text-slate-900">{u.groups_joined}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Chronological Audit Timeline */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Chronological User Activity Audit Stream
                </h3>
                <p className="text-xs text-slate-500">
                  Every recorded join, login, WebSocket connection, message dispatch, and group event.
                </p>
              </div>
              <select
                value={eventFilter}
                onChange={(e) => setEventFilter(e.target.value)}
                className="px-3 py-1.5 text-xs border border-slate-200 rounded-lg bg-white"
              >
                <option value="all">All Event Types</option>
                {Object.entries(EVENT_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="overflow-x-auto max-h-96 overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 sticky top-0">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Timestamp</th>
                    <th className="px-4 py-2.5 font-medium">User</th>
                    <th className="px-4 py-2.5 font-medium">Event</th>
                    <th className="px-4 py-2.5 font-medium">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {filteredTimeline.map((evt) => (
                    <tr key={evt.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 font-mono tabular-nums text-slate-600 whitespace-nowrap">
                        {formatFullTimestamp(evt.createdAt)}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="font-semibold text-slate-900">{evt.displayName}</span>
                        <span className="text-slate-400 mx-1">·</span>
                        <span className="font-mono text-slate-500">@{evt.username}</span>
                      </td>
                      <td className="px-4 py-2.5 font-medium text-blue-700 whitespace-nowrap">
                        {EVENT_LABELS[evt.eventType] || evt.eventType}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-slate-600 truncate max-w-md">
                        {Object.entries(evt.metadata || {})
                          .map(([k, v]) => `${k}: ${String(v)}`)
                          .join(' · ') || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* REPORT 2: MESSAGE ACTIVITY REPORT */}
      {activeTab === 'message-activity' && msgReport && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Daily Message Volume Chart */}
            <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-5">
              <h3 className="text-sm font-semibold text-slate-900">Daily Message Volume (1-to-1 vs Group)</h3>
              <p className="text-xs text-slate-500 mt-0.5">Distribution of persisted WebSocket messages by date</p>
              <div className="mt-5 h-44 flex items-end gap-3 border-b border-slate-200 pb-2">
                {msgReport.dailySeries.length === 0 ? (
                  <div className="w-full h-full flex items-center justify-center text-xs text-slate-400">
                    No messages sent yet. Activity bars will appear here as users message.
                  </div>
                ) : (
                  msgReport.dailySeries.map((day) => {
                    const maxVal = Math.max(...msgReport.dailySeries.map((d) => d.total), 1);
                    const dmHeight = Math.round((day.dm_count / maxVal) * 120);
                    const grpHeight = Math.round((day.group_count / maxVal) * 120);
                    return (
                      <div key={day.day} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                        <div className="text-[11px] font-mono tabular-nums text-slate-600">{day.total}</div>
                        <div className="w-full max-w-[36px] flex flex-col justify-end rounded-t overflow-hidden">
                          {grpHeight > 0 && (
                            <div
                              style={{ height: `${grpHeight}px` }}
                              className="bg-blue-600 w-full"
                              title={`Group: ${day.group_count}`}
                            />
                          )}
                          {dmHeight > 0 && (
                            <div
                              style={{ height: `${dmHeight}px` }}
                              className="bg-slate-800 w-full"
                              title={`DM: ${day.dm_count}`}
                            />
                          )}
                        </div>
                        <div className="text-[10px] font-mono text-slate-400 truncate w-full text-center">
                          {day.day.slice(5)}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
              <div className="mt-3 flex items-center gap-5 text-xs text-slate-600">
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-sm bg-blue-600 inline-block" /> Group Messages
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-sm bg-slate-800 inline-block" /> 1-to-1 Direct Messages
                </span>
              </div>
            </div>

            {/* Delivery Status Breakdown */}
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <h3 className="text-sm font-semibold text-slate-900">Delivery Status Breakdown</h3>
              <p className="text-xs text-slate-500 mt-0.5">Real-time receipt states</p>
              <div className="mt-5 space-y-4">
                {(['read', 'delivered', 'sent'] as const).map((st) => {
                  const found = msgReport.deliveryBreakdown.find((d) => d.delivery_status === st);
                  const count = found?.count || 0;
                  const total = msgReport.deliveryBreakdown.reduce((acc, cur) => acc + cur.count, 0) || 1;
                  const pct = Math.round((count / total) * 100);
                  return (
                    <div key={st}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="capitalize font-medium text-slate-700">{st}</span>
                        <span className="font-mono tabular-nums text-slate-600">
                          {count} ({pct}%)
                        </span>
                      </div>
                      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${
                            st === 'read' ? 'bg-blue-600' : st === 'delivered' ? 'bg-emerald-600' : 'bg-slate-400'
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Message Ledger */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">Message Activity Log</h3>
              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                {(['all', 'dm', 'group'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setMsgTypeFilter(t)}
                    className={`px-3 py-1 text-xs font-medium rounded-md uppercase ${
                      msgTypeFilter === t ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
            <div className="overflow-x-auto max-h-96 overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 sticky top-0">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Timestamp</th>
                    <th className="px-4 py-2.5 font-medium">Type</th>
                    <th className="px-4 py-2.5 font-medium">Sender</th>
                    <th className="px-4 py-2.5 font-medium">Destination</th>
                    <th className="px-4 py-2.5 font-medium">Delivery</th>
                    <th className="px-4 py-2.5 font-medium">Message Preview</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {msgReport.messages.map((m) => (
                    <tr key={m.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 font-mono tabular-nums text-slate-600 whitespace-nowrap">
                        {formatFullTimestamp(m.created_at)}
                      </td>
                      <td className="px-4 py-2.5 font-medium text-slate-800 uppercase">{m.conversation_type}</td>
                      <td className="px-4 py-2.5 font-semibold text-slate-900">{m.sender_name}</td>
                      <td className="px-4 py-2.5 text-slate-600">
                        {m.group_name ? `#${m.group_name}` : m.recipient_name}
                      </td>
                      <td className="px-4 py-2.5 capitalize font-mono text-slate-700">{m.delivery_status}</td>
                      <td className="px-4 py-2.5 text-slate-700 max-w-xs truncate">{m.content}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* REPORT 3: GROUP PARTICIPATION REPORT */}
      {activeTab === 'group-participation' && participationReport && (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200">
              <h3 className="text-sm font-semibold text-slate-900">Group Participation Metrics</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Group Channel</th>
                    <th className="px-4 py-2.5 font-medium">Category</th>
                    <th className="px-4 py-2.5 font-medium text-right">Members</th>
                    <th className="px-4 py-2.5 font-medium text-right">Active Senders</th>
                    <th className="px-4 py-2.5 font-medium">Participation Rate</th>
                    <th className="px-4 py-2.5 font-medium text-right">Total Messages</th>
                    <th className="px-4 py-2.5 font-medium">Last Activity</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {participationReport.groups.map((g) => (
                    <tr key={g.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-semibold text-slate-900">#{g.name}</td>
                      <td className="px-4 py-3 text-slate-600">{g.category}</td>
                      <td className="px-4 py-3 font-mono tabular-nums text-right">{g.member_count}</td>
                      <td className="px-4 py-3 font-mono tabular-nums text-right">{g.active_senders}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-24 h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div className="h-full bg-blue-600" style={{ width: `${g.participationRate}%` }} />
                          </div>
                          <span className="font-mono tabular-nums text-slate-700">{g.participationRate}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono tabular-nums text-right font-semibold">{g.total_messages}</td>
                      <td className="px-4 py-3 font-mono tabular-nums text-slate-600 whitespace-nowrap">
                        {formatFullTimestamp(g.last_activity_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200">
              <h3 className="text-sm font-semibold text-slate-900">Top Group Contributors</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Member</th>
                    <th className="px-4 py-2.5 font-medium">Role</th>
                    <th className="px-4 py-2.5 font-medium">Group Channel</th>
                    <th className="px-4 py-2.5 font-medium text-right">Messages Sent</th>
                    <th className="px-4 py-2.5 font-medium">Last Texted</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {participationReport.topContributors.map((c, idx) => (
                    <tr key={`${c.group_id}-${c.user_id}-${idx}`} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 font-semibold text-slate-900">{c.display_name}</td>
                      <td className="px-4 py-2.5 text-slate-600">{getRoleLabel(c.role)}</td>
                      <td className="px-4 py-2.5 text-slate-800">#{c.group_name}</td>
                      <td className="px-4 py-2.5 font-mono tabular-nums text-right font-semibold">{c.messages_sent}</td>
                      <td className="px-4 py-2.5 font-mono tabular-nums text-slate-600 whitespace-nowrap">
                        {formatFullTimestamp(c.last_texted_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* REPORT 4: GROUP CREATION REPORT */}
      {activeTab === 'group-creation' && groupCreationReport && (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200">
              <h3 className="text-sm font-semibold text-slate-900">Group Creation Ledger</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Group Name</th>
                    <th className="px-4 py-2.5 font-medium">Category</th>
                    <th className="px-4 py-2.5 font-medium">Visibility</th>
                    <th className="px-4 py-2.5 font-medium">Created By</th>
                    <th className="px-4 py-2.5 font-medium text-right">Members</th>
                    <th className="px-4 py-2.5 font-medium text-right">Messages</th>
                    <th className="px-4 py-2.5 font-medium">Created Timestamp</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {groupCreationReport.groups.map((g) => (
                    <tr key={g.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-900">#{g.name}</div>
                        <div className="text-slate-500 truncate max-w-xs">{g.description}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-700">{g.category}</td>
                      <td className="px-4 py-3 text-slate-700">{g.isPrivate ? 'Private' : 'Public'}</td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">{g.creator_name}</div>
                        <div className="text-slate-500">{getRoleLabel(g.creator_role)}</div>
                      </td>
                      <td className="px-4 py-3 font-mono tabular-nums text-right">{g.member_count}</td>
                      <td className="px-4 py-3 font-mono tabular-nums text-right">{g.message_count}</td>
                      <td className="px-4 py-3 font-mono tabular-nums text-slate-600 whitespace-nowrap">
                        {formatFullTimestamp(g.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200">
              <h3 className="text-sm font-semibold text-slate-900">Groups Created by Administrator / User</h3>
            </div>
            <div className="divide-y divide-slate-200">
              {groupCreationReport.byCreator.map((c) => (
                <div key={c.creator_id} className="px-5 py-3 flex items-center justify-between text-xs">
                  <div>
                    <span className="font-semibold text-slate-900">{c.creator_name}</span>
                    <span className="text-slate-400 mx-1.5">·</span>
                    <span className="text-slate-500">{getRoleLabel(c.creator_role)}</span>
                  </div>
                  <div className="flex items-center gap-4 font-mono tabular-nums">
                    <span className="text-slate-600">Last created {formatFullTimestamp(c.last_created_at)}</span>
                    <span className="font-semibold text-slate-900">{c.groups_created} groups</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
