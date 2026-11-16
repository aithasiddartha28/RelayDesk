import { useEffect, useMemo, useState } from 'react';
import { Ban, Check, MessageSquare, Search, Trash2, UserPlus } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { formatRelativeTime, getRoleLabel } from '../../lib/format';
import type { Contact, User } from '../../types';
import { Avatar } from '../Avatar';

interface ContactsScreenProps {
  currentUser: User;
  users: User[];
  onlineUserIds: Set<string>;
  onStartDm: (peerId: string) => void;
}

export function ContactsScreen({ currentUser, users, onlineUserIds, onStartDm }: ContactsScreenProps) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [filter, setFilter] = useState<'all' | 'online' | 'blocked'>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const loadContacts = async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ contacts: Contact[] }>('/contacts');
      setContacts(res.contacts);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadContacts();
  }, []);

  const contactIds = useMemo(() => new Set(contacts.map((c) => c.id)), [contacts]);
  const nonContactUsers = useMemo(
    () =>
      users.filter(
        (u) =>
          u.id !== currentUser.id &&
          !contactIds.has(u.id) &&
          (u.displayName.toLowerCase().includes(search.toLowerCase()) ||
            u.email.toLowerCase().includes(search.toLowerCase()))
      ),
    [users, currentUser.id, contactIds, search]
  );

  const filteredContacts = useMemo(() => {
    return contacts
      .filter((c) => {
        if (filter === 'online') return onlineUserIds.has(c.id) && !c.isBlocked;
        if (filter === 'blocked') return c.isBlocked;
        return true;
      })
      .filter(
        (c) =>
          c.displayName.toLowerCase().includes(search.toLowerCase()) ||
          c.email.toLowerCase().includes(search.toLowerCase()) ||
          c.username.toLowerCase().includes(search.toLowerCase())
      );
  }, [contacts, filter, search, onlineUserIds]);

  async function addContact(userId: string) {
    await apiFetch('/contacts', {
      method: 'POST',
      body: JSON.stringify({ contactId: userId }),
    });
    setStatusMsg('Contact added to your directory.');
    loadContacts();
  }

  async function toggleBlock(contactId: string, currentlyBlocked: boolean) {
    await apiFetch(`/contacts/${contactId}/block`, {
      method: 'PATCH',
      body: JSON.stringify({ isBlocked: !currentlyBlocked }),
    });
    setStatusMsg(!currentlyBlocked ? 'User blocked from direct messaging.' : 'User unblocked.');
    loadContacts();
  }

  async function removeContact(contactId: string) {
    await apiFetch(`/contacts/${contactId}`, { method: 'DELETE' });
    setStatusMsg('Contact removed.');
    loadContacts();
  }

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Contacts &amp; Workspace Directory</h2>
          <p className="text-xs text-slate-500 mt-1">
            Manage personal contacts, block unwanted direct messages, or start a WebSocket chat.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search contacts..."
              className="pl-9 pr-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
            />
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {(['all', 'online', 'blocked'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setFilter(tab)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md capitalize transition-colors ${
                  filter === tab ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>
      </div>

      {statusMsg && (
        <div className="px-4 py-2.5 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-800 flex items-center justify-between">
          <span>{statusMsg}</span>
          <button onClick={() => setStatusMsg(null)} className="underline">
            Dismiss
          </button>
        </div>
      )}

      {/* Saved Contacts Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">
            Saved Contacts <span className="text-slate-400 font-mono tabular-nums">({filteredContacts.length})</span>
          </h3>
        </div>

        {loading ? (
          <div className="p-6 text-xs text-slate-500">Loading contacts...</div>
        ) : filteredContacts.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">
            No contacts match the current filter. Add colleagues from the workspace directory below.
          </div>
        ) : (
          <div className="divide-y divide-slate-200">
            {filteredContacts.map((c) => {
              const isOnline = onlineUserIds.has(c.id);
              return (
                <div key={c.id} className="px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-slate-50">
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar
                      name={c.displayName}
                      color={c.avatarColor}
                      isOnline={isOnline}
                      presenceMode={c.presenceMode}
                      showPresence={true}
                    />
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900 truncate">
                        {c.displayName} {c.nickname ? `(${c.nickname})` : ''}
                      </div>
                      <div className="text-xs text-slate-500 flex flex-wrap items-center gap-1.5 mt-0.5">
                        <span className="font-mono">@{c.username}</span>
                        <span aria-hidden="true">·</span>
                        <span>{getRoleLabel(c.role)}</span>
                        <span aria-hidden="true">·</span>
                        <span>{isOnline ? 'Online now' : `Last active ${formatRelativeTime(c.lastActiveAt)}`}</span>
                        {c.isBlocked && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="text-red-600 font-medium">Blocked</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => onStartDm(c.id)}
                      disabled={c.isBlocked}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 disabled:opacity-40 whitespace-nowrap"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                      Message
                    </button>
                    <button
                      onClick={() => toggleBlock(c.id, c.isBlocked)}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium whitespace-nowrap ${
                        c.isBlocked
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                          : 'border-slate-200 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      {c.isBlocked ? <Check className="w-3.5 h-3.5" /> : <Ban className="w-3.5 h-3.5" />}
                      {c.isBlocked ? 'Unblock' : 'Block'}
                    </button>
                    <button
                      onClick={() => removeContact(c.id)}
                      title="Remove contact"
                      className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:text-red-600 hover:border-red-200"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add from Workspace Directory */}
      {nonContactUsers.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200">
            <h3 className="text-sm font-semibold text-slate-900">
              Add from Workspace Directory{' '}
              <span className="text-slate-400 font-mono tabular-nums">({nonContactUsers.length})</span>
            </h3>
          </div>
          <div className="divide-y divide-slate-200">
            {nonContactUsers.map((u) => {
              const isOnline = onlineUserIds.has(u.id);
              return (
                <div key={u.id} className="px-5 py-3.5 flex items-center justify-between gap-4 hover:bg-slate-50">
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar
                      name={u.displayName}
                      color={u.avatarColor}
                      isOnline={isOnline}
                      presenceMode={u.presenceMode}
                      showPresence={true}
                    />
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900 truncate">{u.displayName}</div>
                      <div className="text-xs text-slate-500 truncate">
                        {u.email} · {getRoleLabel(u.role)}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => onStartDm(u.id)}
                      className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap"
                    >
                      Chat
                    </button>
                    <button
                      onClick={() => addContact(u.id)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 whitespace-nowrap"
                    >
                      <UserPlus className="w-3.5 h-3.5" />
                      Add Contact
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
