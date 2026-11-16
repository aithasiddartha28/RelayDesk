import { useEffect, useState, type FormEvent } from 'react';
import {
  Hash,
  Lock,
  LogOut,
  MessageSquare,
  Plus,
  Shield,
  UserMinus,
  UserPlus,
  Users,
  VolumeX,
  X,
} from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { formatDateTime, getRoleLabel } from '../../lib/format';
import type { Group, GroupMember, User } from '../../types';
import { Avatar } from '../Avatar';

interface GroupsDirectoryScreenProps {
  currentUser: User;
  groups: Group[];
  users: User[];
  onRefreshGroups: () => void;
  onOpenGroupChat: (groupId: string) => void;
  openCreateModalSignal: number;
}

export function GroupsDirectoryScreen({
  currentUser,
  groups,
  users,
  onRefreshGroups,
  onOpenGroupChat,
  openCreateModalSignal,
}: GroupsDirectoryScreenProps) {
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('Engineering');
  const [isPrivate, setIsPrivate] = useState(false);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);

  const [managingGroup, setManagingGroup] = useState<Group | null>(null);
  const [groupMembers, setGroupMembers] = useState<GroupMember[]>([]);
  const [addMemberId, setAddMemberId] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (openCreateModalSignal > 0) {
      setShowCreate(true);
    }
  }, [openCreateModalSignal]);

  async function handleCreateGroup(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await apiFetch<{ id: string }>('/groups', {
        method: 'POST',
        body: JSON.stringify({
          name,
          description,
          category,
          isPrivate,
          memberIds: selectedUserIds,
        }),
      });
      setName('');
      setDescription('');
      setSelectedUserIds([]);
      setShowCreate(false);
      onRefreshGroups();
      onOpenGroupChat(res.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create group');
    } finally {
      setCreating(false);
    }
  }

  async function openManage(group: Group) {
    setManagingGroup(group);
    const detail = await apiFetch<{ members: GroupMember[] }>(`/groups/${group.id}`);
    setGroupMembers(detail.members);
    setAddMemberId('');
  }

  async function handleAddMember() {
    if (!managingGroup || !addMemberId) return;
    await apiFetch(`/groups/${managingGroup.id}/members`, {
      method: 'POST',
      body: JSON.stringify({ userId: addMemberId }),
    });
    const detail = await apiFetch<{ members: GroupMember[] }>(`/groups/${managingGroup.id}`);
    setGroupMembers(detail.members);
    setAddMemberId('');
    onRefreshGroups();
  }

  async function handleUpdateMember(userId: string, body: { isMuted?: boolean; memberRole?: 'group_admin' | 'member' }) {
    if (!managingGroup) return;
    await apiFetch(`/groups/${managingGroup.id}/members/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    const detail = await apiFetch<{ members: GroupMember[] }>(`/groups/${managingGroup.id}`);
    setGroupMembers(detail.members);
    onRefreshGroups();
  }

  async function handleRemoveMember(userId: string) {
    if (!managingGroup) return;
    await apiFetch(`/groups/${managingGroup.id}/members/${userId}`, { method: 'DELETE' });
    const detail = await apiFetch<{ members: GroupMember[] }>(`/groups/${managingGroup.id}`);
    setGroupMembers(detail.members);
    onRefreshGroups();
  }

  async function handleJoin(groupId: string) {
    setError(null);
    try {
      await apiFetch(`/groups/${groupId}/join`, { method: 'POST' });
      onRefreshGroups();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to join group');
    }
  }

  async function handleLeave(groupId: string) {
    await apiFetch(`/groups/${groupId}/leave`, { method: 'POST' });
    onRefreshGroups();
  }

  const memberIdSet = new Set(groupMembers.map((m) => m.id));
  const candidatesToAdd = users.filter((u) => !memberIdSet.has(u.id));

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Groups &amp; Membership Directory</h2>
          <p className="text-xs text-slate-500 mt-1">
            Create communication channels, join open groups, or administer members and Group Administrators.
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4" />
          Create New Group
        </button>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{error}</div>
      )}

      {/* Groups Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {groups.map((grp) => {
          const canManage = currentUser.role === 'admin' || grp.myGroupRole === 'group_admin';
          return (
            <div key={grp.id} className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between">
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    {grp.isPrivate ? (
                      <Lock className="w-4 h-4 text-slate-500 shrink-0" />
                    ) : (
                      <Hash className="w-4 h-4 text-blue-600 shrink-0" />
                    )}
                    <h3 className="text-sm font-semibold text-slate-900 truncate">{grp.name}</h3>
                  </div>
                  <span className="text-xs text-slate-500 whitespace-nowrap shrink-0">{grp.category}</span>
                </div>

                <p className="text-xs text-slate-600 mt-2 leading-relaxed">
                  {grp.description || 'No description provided.'}
                </p>

                <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span className="font-mono tabular-nums">{grp.memberCount} members</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">{grp.messageCount} messages</span>
                  <span aria-hidden="true">·</span>
                  <span>Created by {grp.creatorName}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">{formatDateTime(grp.createdAt)}</span>
                </div>
              </div>

              <div className="mt-5 pt-4 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {grp.isMember ? (
                    <>
                      <button
                        onClick={() => onOpenGroupChat(grp.id)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 whitespace-nowrap"
                      >
                        <MessageSquare className="w-3.5 h-3.5" />
                        Open Chat
                      </button>
                      <button
                        onClick={() => handleLeave(grp.id)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-100 whitespace-nowrap"
                      >
                        <LogOut className="w-3.5 h-3.5" />
                        Leave
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => handleJoin(grp.id)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 whitespace-nowrap"
                    >
                      <UserPlus className="w-3.5 h-3.5" />
                      Join Group
                    </button>
                  )}
                </div>

                {canManage && (
                  <button
                    onClick={() => openManage(grp)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                  >
                    <Users className="w-3.5 h-3.5" />
                    Manage Members
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Create Group Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-slate-900">Create Communication Group</h3>
              <button onClick={() => setShowCreate(false)} className="text-slate-400 hover:text-slate-700">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateGroup} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Group Name</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Release Readiness"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Category</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
                  >
                    <option>Engineering</option>
                    <option>Design</option>
                    <option>Operations</option>
                    <option>Announcements</option>
                    <option>General</option>
                  </select>
                </div>
                <div className="flex items-end pb-2">
                  <label className="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isPrivate}
                      onChange={(e) => setIsPrivate(e.target.checked)}
                      className="rounded border-slate-300"
                    />
                    Private invite-only channel
                  </label>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Description</label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Purpose and discussion scope..."
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">Add Initial Members</label>
                <div className="max-h-36 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
                  {users
                    .filter((u) => u.id !== currentUser.id)
                    .map((u) => {
                      const checked = selectedUserIds.includes(u.id);
                      return (
                        <label key={u.id} className="px-3 py-2 flex items-center justify-between text-xs cursor-pointer hover:bg-slate-50">
                          <span>
                            <span className="font-medium text-slate-900">{u.displayName}</span>{' '}
                            <span className="text-slate-500">({getRoleLabel(u.role)})</span>
                          </span>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setSelectedUserIds((prev) =>
                                checked ? prev.filter((id) => id !== u.id) : [...prev, u.id]
                              )
                            }
                          />
                        </label>
                      );
                    })}
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="px-4 py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="px-4 py-2 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  {creating ? 'Creating...' : 'Create Group'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Manage Members Modal */}
      {managingGroup && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-base font-semibold text-slate-900">Manage #{managingGroup.name}</h3>
                <p className="text-xs text-slate-500">Add members, assign Group Administrators, or mute participants.</p>
              </div>
              <button onClick={() => setManagingGroup(null)} className="text-slate-400 hover:text-slate-700">
                <X className="w-5 h-5" />
              </button>
            </div>

            {candidatesToAdd.length > 0 && (
              <div className="flex items-center gap-2 mb-4">
                <select
                  value={addMemberId}
                  onChange={(e) => setAddMemberId(e.target.value)}
                  className="flex-1 px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white"
                >
                  <option value="">Select user to add...</option>
                  {candidatesToAdd.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.displayName} ({u.email})
                    </option>
                  ))}
                </select>
                <button
                  onClick={handleAddMember}
                  disabled={!addMemberId}
                  className="px-3.5 py-2 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 disabled:opacity-40"
                >
                  Add Member
                </button>
              </div>
            )}

            <div className="max-h-72 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
              {groupMembers.map((m) => (
                <div key={m.id} className="px-3.5 py-2.5 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Avatar name={m.displayName} color={m.avatarColor} size="sm" />
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-slate-900 truncate">{m.displayName}</div>
                      <div className="text-[11px] text-slate-500">
                        {m.groupRole === 'group_admin' ? 'Group Admin' : 'Member'}
                        {m.isMutedInGroup ? ' · Muted' : ''}
                      </div>
                    </div>
                  </div>

                  {m.id !== currentUser.id && (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() =>
                          handleUpdateMember(m.id, {
                            memberRole: m.groupRole === 'group_admin' ? 'member' : 'group_admin',
                          })
                        }
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-200 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                      >
                        <Shield className="w-3 h-3" />
                        {m.groupRole === 'group_admin' ? 'Demote' : 'Make Group Admin'}
                      </button>
                      <button
                        onClick={() => handleUpdateMember(m.id, { isMuted: !m.isMutedInGroup })}
                        className={`p-1.5 rounded border text-xs ${
                          m.isMutedInGroup
                            ? 'border-amber-200 bg-amber-50 text-amber-700'
                            : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                        }`}
                        title={m.isMutedInGroup ? 'Unmute' : 'Mute'}
                      >
                        <VolumeX className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleRemoveMember(m.id)}
                        className="p-1.5 rounded border border-slate-200 text-slate-500 hover:text-red-600 hover:border-red-200"
                        title="Remove from group"
                      >
                        <UserMinus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
