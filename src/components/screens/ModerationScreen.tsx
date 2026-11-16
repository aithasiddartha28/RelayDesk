import { useEffect, useState, type FormEvent } from 'react';
import { Check, Plus, ShieldAlert, Trash2, UserCheck, VolumeX } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { formatDateTime, getRoleLabel } from '../../lib/format';
import type { Contact, FlaggedMessageItem, ModerationKeyword, User, UserRole, UserStatus } from '../../types';

interface ModerationScreenProps {
  currentUser: User;
  users: User[];
  onRefreshUsers: () => void;
  onRefreshModerationCount: () => void;
}

export function ModerationScreen({
  currentUser,
  users,
  onRefreshUsers,
  onRefreshModerationCount,
}: ModerationScreenProps) {
  const isModerator = currentUser.role === 'admin' || currentUser.role === 'group_admin';
  const isAdmin = currentUser.role === 'admin';

  const [flagged, setFlagged] = useState<FlaggedMessageItem[]>([]);
  const [keywords, setKeywords] = useState<ModerationKeyword[]>([]);
  const [blockedContacts, setBlockedContacts] = useState<Contact[]>([]);
  const [newKeyword, setNewKeyword] = useState('');
  const [newAction, setNewAction] = useState<'flag' | 'block'>('flag');
  const [newUserDisplayName, setNewUserDisplayName] = useState('');
  const [newUserUsername, setNewUserUsername] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserRole, setNewUserRole] = useState<UserRole>('user');
  const [feedback, setFeedback] = useState<string | null>(null);

  const loadAll = async () => {
    const contactRes = await apiFetch<{ contacts: Contact[] }>('/contacts');
    setBlockedContacts(contactRes.contacts.filter((c) => c.isBlocked));

    if (isModerator) {
      const [flagRes, kwRes] = await Promise.all([
        apiFetch<{ flagged: FlaggedMessageItem[] }>('/moderation/flagged'),
        apiFetch<{ keywords: ModerationKeyword[] }>('/moderation/keywords'),
      ]);
      setFlagged(flagRes.flagged);
      setKeywords(kwRes.keywords);
    }
  };

  useEffect(() => {
    loadAll();
  }, [currentUser.role]);

  async function resolveFlag(id: string, action: 'dismiss' | 'delete') {
    await apiFetch(`/moderation/flagged/${id}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ action }),
    });
    setFeedback(action === 'delete' ? 'Flagged message deleted.' : 'Flag dismissed.');
    loadAll();
    onRefreshModerationCount();
  }

  async function handleAddKeyword(e: FormEvent) {
    e.preventDefault();
    if (!newKeyword.trim()) return;
    await apiFetch('/moderation/keywords', {
      method: 'POST',
      body: JSON.stringify({ keyword: newKeyword, action: newAction }),
    });
    setNewKeyword('');
    setFeedback('Moderation keyword rule added.');
    loadAll();
  }

  async function handleDeleteKeyword(id: string) {
    await apiFetch(`/moderation/keywords/${id}`, { method: 'DELETE' });
    loadAll();
  }

  async function handleUserControl(userId: string, payload: { status?: UserStatus; role?: UserRole }) {
    try {
      await apiFetch(`/moderation/users/${userId}/status`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      setFeedback('User control updated.');
      onRefreshUsers();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Unable to update user');
    }
  }

  async function handleCreateUser(e: FormEvent) {
    e.preventDefault();
    try {
      await apiFetch('/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          displayName: newUserDisplayName,
          username: newUserUsername,
          email: newUserEmail,
          password: newUserPassword,
          role: newUserRole,
        }),
      });
      setNewUserDisplayName('');
      setNewUserUsername('');
      setNewUserEmail('');
      setNewUserPassword('');
      setNewUserRole('user');
      setFeedback('New user account created and logged in User Activity Report.');
      onRefreshUsers();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Unable to create user');
    }
  }

  async function handleUnblock(contactId: string) {
    await apiFetch(`/contacts/${contactId}/block`, {
      method: 'PATCH',
      body: JSON.stringify({ isBlocked: false }),
    });
    setFeedback('Contact unblocked.');
    loadAll();
  }

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <h2 className="text-base font-semibold text-slate-900">
          {isModerator ? 'Moderation & User Controls' : 'Privacy & Blocked Users'}
        </h2>
        <p className="text-xs text-slate-500 mt-1">
          {isModerator
            ? 'Review flagged messages, enforce keyword content filters, and manage account mute/suspension controls.'
            : 'Manage your blocked contacts and direct messaging privacy.'}
        </p>
      </div>

      {feedback && (
        <div className="px-4 py-2.5 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-800 flex items-center justify-between">
          <span>{feedback}</span>
          <button onClick={() => setFeedback(null)} className="underline">
            Dismiss
          </button>
        </div>
      )}

      {isModerator && (
        <>
          {/* Flagged Messages Queue */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">
                Flagged Message Queue{' '}
                <span className="font-mono tabular-nums text-slate-400">({flagged.length})</span>
              </h3>
            </div>
            {flagged.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">
                <ShieldAlert className="w-6 h-6 text-slate-300 mx-auto mb-2" />
                No flagged messages pending review.
              </div>
            ) : (
              <div className="divide-y divide-slate-200">
                {flagged.map((item) => (
                  <div key={item.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="text-xs text-slate-500 flex flex-wrap items-center gap-1.5">
                        <span className="font-semibold text-slate-900">{item.senderName}</span>
                        <span aria-hidden="true">·</span>
                        <span>
                          {item.conversationType === 'group'
                            ? `Group #${item.groupName}`
                            : `DM to ${item.recipientName}`}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">{formatDateTime(item.createdAt)}</span>
                      </div>
                      <p className="mt-1.5 text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                        {item.content}
                      </p>
                      <div className="mt-1 text-xs text-amber-700 font-medium">
                        Reason: {item.flagReason || 'Policy review'}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => resolveFlag(item.id, 'dismiss')}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        <Check className="w-3.5 h-3.5" />
                        Dismiss
                      </button>
                      <button
                        onClick={() => resolveFlag(item.id, 'delete')}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-medium hover:bg-red-700"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Delete Message
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Keyword Policy Rules */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Automated Content Filter Keywords</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Messages containing flagged keywords enter the moderation queue; blocked keywords are rejected at WebSocket dispatch.
              </p>
            </div>
            <form onSubmit={handleAddKeyword} className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={newKeyword}
                onChange={(e) => setNewKeyword(e.target.value)}
                placeholder="Enter restricted keyword..."
                className="flex-1 min-w-[200px] px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
              />
              <select
                value={newAction}
                onChange={(e) => setNewAction(e.target.value as 'flag' | 'block')}
                className="px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white"
              >
                <option value="flag">Flag for review</option>
                <option value="block">Block immediately</option>
              </select>
              <button
                type="submit"
                className="inline-flex items-center gap-1 px-3.5 py-2 rounded-lg bg-slate-900 text-white text-xs font-medium hover:bg-slate-800"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Rule
              </button>
            </form>
            <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
              {keywords.map((kw) => (
                <div key={kw.id} className="px-4 py-2.5 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-3">
                    <span className="font-mono font-semibold text-slate-900">{kw.keyword}</span>
                    <span className="text-slate-400">·</span>
                    <span className={kw.action === 'block' ? 'text-red-700 font-medium' : 'text-amber-700 font-medium'}>
                      {kw.action === 'block' ? 'Block transmission' : 'Flag for review'}
                    </span>
                  </div>
                  <button
                    onClick={() => handleDeleteKeyword(kw.id)}
                    className="text-slate-400 hover:text-red-600"
                    title="Remove rule"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Platform-wide User Controls (Admin Only) */}
      {isAdmin && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200">
            <h3 className="text-sm font-semibold text-slate-900">Platform User Governance &amp; Account Provisioning</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Create new accounts with specific roles or manage existing user permissions and status.
            </p>
          </div>
          <form onSubmit={handleCreateUser} className="p-4 bg-slate-50/70 border-b border-slate-200 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5">
            <input
              type="text"
              required
              value={newUserDisplayName}
              onChange={(e) => setNewUserDisplayName(e.target.value)}
              placeholder="Full name"
              className="px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
            />
            <input
              type="text"
              required
              value={newUserUsername}
              onChange={(e) => setNewUserUsername(e.target.value)}
              placeholder="Username"
              className="px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
            />
            <input
              type="email"
              required
              value={newUserEmail}
              onChange={(e) => setNewUserEmail(e.target.value)}
              placeholder="Email address"
              className="px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
            />
            <input
              type="password"
              required
              minLength={6}
              value={newUserPassword}
              onChange={(e) => setNewUserPassword(e.target.value)}
              placeholder="Password (6+ chars)"
              className="px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
            />
            <select
              value={newUserRole}
              onChange={(e) => setNewUserRole(e.target.value as UserRole)}
              className="px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg"
            >
              <option value="user">Registered User</option>
              <option value="group_admin">Group Administrator</option>
              <option value="admin">Admin</option>
            </select>
            <button
              type="submit"
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              Create User
            </button>
          </form>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 font-medium">User</th>
                  <th className="px-4 py-2.5 font-medium">Role</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium text-right">Controls</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900">{u.displayName}</div>
                      <div className="text-slate-500 font-mono">{u.email}</div>
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={u.role}
                        disabled={u.id === currentUser.id}
                        onChange={(e) => handleUserControl(u.id, { role: e.target.value as UserRole })}
                        className="px-2.5 py-1 border border-slate-200 rounded bg-white text-xs disabled:opacity-50"
                      >
                        <option value="user">Registered User</option>
                        <option value="group_admin">Group Administrator</option>
                        <option value="admin">Admin</option>
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`font-medium ${
                          u.status === 'active'
                            ? 'text-emerald-700'
                            : u.status === 'muted'
                            ? 'text-amber-700'
                            : 'text-red-700'
                        }`}
                      >
                        {u.status === 'active' ? 'Active' : u.status === 'muted' ? 'Muted' : 'Suspended'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {u.id === currentUser.id ? (
                        <span className="text-slate-400">Current session</span>
                      ) : (
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            onClick={() =>
                              handleUserControl(u.id, { status: u.status === 'muted' ? 'active' : 'muted' })
                            }
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-200 hover:bg-slate-100"
                          >
                            <VolumeX className="w-3 h-3" />
                            {u.status === 'muted' ? 'Unmute' : 'Mute'}
                          </button>
                          <button
                            onClick={() =>
                              handleUserControl(u.id, { status: u.status === 'suspended' ? 'active' : 'suspended' })
                            }
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded border ${
                              u.status === 'suspended'
                                ? 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'
                                : 'border-red-200 text-red-700 hover:bg-red-50'
                            }`}
                          >
                            <UserCheck className="w-3 h-3" />
                            {u.status === 'suspended' ? 'Reactivate' : 'Suspend'}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Personal Blocked Contacts */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200">
          <h3 className="text-sm font-semibold text-slate-900">
            Your Blocked Contacts{' '}
            <span className="font-mono tabular-nums text-slate-400">({blockedContacts.length})</span>
          </h3>
        </div>
        {blockedContacts.length === 0 ? (
          <div className="p-6 text-xs text-slate-500">You have not blocked any contacts.</div>
        ) : (
          <div className="divide-y divide-slate-200">
            {blockedContacts.map((c) => (
              <div key={c.id} className="px-5 py-3 flex items-center justify-between text-xs">
                <div>
                  <span className="font-semibold text-slate-900">{c.displayName}</span>
                  <span className="text-slate-400 mx-1.5">·</span>
                  <span className="text-slate-500">{getRoleLabel(c.role)}</span>
                </div>
                <button
                  onClick={() => handleUnblock(c.id)}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 font-medium text-slate-700 hover:bg-slate-50"
                >
                  Unblock
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
