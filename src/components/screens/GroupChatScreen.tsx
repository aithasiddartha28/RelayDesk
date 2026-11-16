import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  CheckCheck,
  Flag,
  Hash,
  Lock,
  Pin,
  Reply,
  Send,
  Shield,
  Trash2,
  UserMinus,
  Users,
  VolumeX,
  X,
} from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { formatTime, getRoleLabel } from '../../lib/format';
import type { ChatMessage, Group, GroupMember, User } from '../../types';
import { Avatar } from '../Avatar';

interface GroupChatScreenProps {
  currentUser: User;
  groups: Group[];
  onlineUserIds: Set<string>;
  selectedGroupId: string | null;
  onSelectGroup: (groupId: string) => void;
  onRefreshGroups: () => void;
  incomingMessages: ChatMessage[];
  typingByGroup: Record<string, string | null>;
  sendWsEvent: (payload: Record<string, unknown>) => boolean;
}

export function GroupChatScreen({
  currentUser,
  groups,
  onlineUserIds,
  selectedGroupId,
  onSelectGroup,
  onRefreshGroups,
  incomingMessages,
  typingByGroup,
  sendWsEvent,
}: GroupChatScreenProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [showRoster, setShowRoster] = useState(true);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeGroup = useMemo(
    () => groups.find((g) => g.id === selectedGroupId) || groups.find((g) => g.isMember) || groups[0] || null,
    [groups, selectedGroupId]
  );

  useEffect(() => {
    if (!selectedGroupId && activeGroup) {
      onSelectGroup(activeGroup.id);
    }
  }, [selectedGroupId, activeGroup, onSelectGroup]);

  const loadGroupData = async (groupId: string, isMember: boolean) => {
    setLoading(true);
    setErrorBanner(null);
    try {
      const detail = await apiFetch<{ members: GroupMember[] }>(`/groups/${groupId}`);
      setMembers(detail.members);

      if (isMember || currentUser.role === 'admin') {
        const msgRes = await apiFetch<{ messages: ChatMessage[] }>(`/messages/group/${groupId}`);
        setMessages(msgRes.messages);
        sendWsEvent({ type: 'message:read', conversationType: 'group', targetId: groupId });
      } else {
        setMessages([]);
      }
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Unable to load group channel');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!activeGroup) return;
    loadGroupData(activeGroup.id, activeGroup.isMember);
  }, [activeGroup?.id, activeGroup?.isMember]);

  useEffect(() => {
    if (!activeGroup || incomingMessages.length === 0) return;
    const relevant = incomingMessages.filter(
      (m) => m.conversationType === 'group' && m.groupId === activeGroup.id
    );
    if (relevant.length === 0) return;

    setMessages((prev) => {
      const map = new Map(prev.map((m) => [m.id, m]));
      for (const item of relevant) {
        map.set(item.id, item);
      }
      return Array.from(map.values()).sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
    });
    sendWsEvent({ type: 'message:read', conversationType: 'group', targetId: activeGroup.id });
  }, [incomingMessages, activeGroup?.id, sendWsEvent]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, activeGroup?.id]);

  const canModerateGroup =
    currentUser.role === 'admin' ||
    activeGroup?.myGroupRole === 'group_admin' ||
    currentUser.role === 'group_admin';

  function handleDraftChange(val: string) {
    setDraft(val);
    if (!activeGroup) return;
    sendWsEvent({ type: 'typing:start', conversationType: 'group', targetId: activeGroup.id });
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      sendWsEvent({ type: 'typing:stop', conversationType: 'group', targetId: activeGroup.id });
    }, 1500);
  }

  function handleSend(e: FormEvent) {
    e.preventDefault();
    if (!activeGroup || !draft.trim()) return;
    const ok = sendWsEvent({
      type: 'message:send',
      conversationType: 'group',
      targetId: activeGroup.id,
      content: draft.trim(),
      replyToId: replyTo?.id || null,
      clientTempId: `tmp_${Date.now()}`,
    });
    if (ok) {
      sendWsEvent({ type: 'typing:stop', conversationType: 'group', targetId: activeGroup.id });
      setDraft('');
      setReplyTo(null);
      setErrorBanner(null);
    } else {
      setErrorBanner('WebSocket disconnected. Reconnecting...');
    }
  }

  async function handleJoinGroup(groupId: string) {
    try {
      await apiFetch(`/groups/${groupId}/join`, { method: 'POST' });
      onRefreshGroups();
      loadGroupData(groupId, true);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Unable to join group');
    }
  }

  async function handlePin(msgId: string) {
    try {
      const res = await apiFetch<{ isPinned: boolean }>(`/messages/${msgId}/pin`, { method: 'PATCH' });
      setMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, isPinned: res.isPinned } : m)));
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Unable to pin message');
    }
  }

  async function handleFlag(msgId: string) {
    try {
      await apiFetch(`/messages/${msgId}/flag`, {
        method: 'POST',
        body: JSON.stringify({ reason: `Flagged in #${activeGroup?.name || 'group'}` }),
      });
      setMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, isFlagged: true } : m)));
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Unable to flag message');
    }
  }

  async function handleDelete(msgId: string) {
    try {
      await apiFetch(`/messages/${msgId}`, { method: 'DELETE' });
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId ? { ...m, isDeleted: true, content: 'This message was removed by moderation.' } : m
        )
      );
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Unable to delete message');
    }
  }

  async function handleToggleMuteMember(memberId: string, currentlyMuted: boolean) {
    if (!activeGroup) return;
    try {
      await apiFetch(`/groups/${activeGroup.id}/members/${memberId}`, {
        method: 'PATCH',
        body: JSON.stringify({ isMuted: !currentlyMuted }),
      });
      loadGroupData(activeGroup.id, activeGroup.isMember);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Failed to update mute status');
    }
  }

  async function handleRemoveMember(memberId: string) {
    if (!activeGroup) return;
    try {
      await apiFetch(`/groups/${activeGroup.id}/members/${memberId}`, { method: 'DELETE' });
      onRefreshGroups();
      loadGroupData(activeGroup.id, activeGroup.isMember);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Failed to remove member');
    }
  }

  const pinnedMessages = useMemo(() => messages.filter((m) => m.isPinned && !m.isDeleted), [messages]);
  const groupTyping = activeGroup ? typingByGroup[activeGroup.id] : null;

  return (
    <div className="h-full flex bg-white border border-slate-200 rounded-xl overflow-hidden">
      {/* Left Channel List */}
      <div className="w-64 shrink-0 border-r border-slate-200 flex flex-col bg-slate-50/40">
        <div className="px-4 py-3 border-b border-slate-200">
          <div className="text-xs font-semibold text-slate-500">Group Channels</div>
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
          {groups.map((grp) => {
            const isSelected = activeGroup?.id === grp.id;
            return (
              <button
                key={grp.id}
                onClick={() => onSelectGroup(grp.id)}
                className={`w-full px-4 py-3 text-left transition-colors ${
                  isSelected ? 'bg-blue-50/80' : 'hover:bg-white'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-900 truncate">
                    {grp.isPrivate ? (
                      <Lock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    ) : (
                      <Hash className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    )}
                    <span className="truncate">{grp.name}</span>
                  </span>
                  <span className="text-[11px] font-mono tabular-nums text-slate-400 shrink-0">
                    {grp.memberCount}
                  </span>
                </div>
                <div className="text-xs text-slate-500 mt-0.5 truncate">
                  {grp.category} · {grp.isMember ? 'Joined' : 'Not joined'}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Center Group Thread */}
      <div className="flex-1 flex flex-col min-w-0">
        {!activeGroup ? (
          <div className="flex-1 flex items-center justify-center p-8 text-sm text-slate-500">
            No groups available. Create a group using the New Group button.
          </div>
        ) : (
          <>
            {/* Channel Header */}
            <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between gap-4 bg-white">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-slate-900 truncate">#{activeGroup.name}</h2>
                  <span className="text-xs text-slate-400">·</span>
                  <span className="text-xs text-slate-500 whitespace-nowrap">{activeGroup.category}</span>
                </div>
                <p className="text-xs text-slate-500 truncate mt-0.5">{activeGroup.description || 'Group channel'}</p>
              </div>

              <button
                onClick={() => setShowRoster((v) => !v)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
              >
                <Users className="w-3.5 h-3.5" />
                Members ({members.length})
              </button>
            </div>

            {pinnedMessages.length > 0 && (
              <div className="px-5 py-2 bg-amber-50/70 border-b border-amber-200/80 text-xs text-amber-900 flex items-center gap-2">
                <Pin className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                <span className="font-semibold shrink-0">Pinned:</span>
                <span className="truncate">{pinnedMessages[pinnedMessages.length - 1].content}</span>
              </div>
            )}

            {errorBanner && (
              <div className="px-5 py-2 bg-red-50 border-b border-red-200 text-xs text-red-700 flex items-center justify-between">
                <span>{errorBanner}</span>
                <button onClick={() => setErrorBanner(null)} className="text-red-500 hover:text-red-800">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {!activeGroup.isMember && currentUser.role !== 'admin' ? (
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-slate-50/40">
                <Hash className="w-8 h-8 text-slate-300 mb-3" />
                <h3 className="text-sm font-semibold text-slate-900">Join #{activeGroup.name}</h3>
                <p className="text-xs text-slate-500 mt-1 max-w-md">
                  You are not a member of this channel yet. Join to read conversation history and send real-time
                  messages.
                </p>
                {!activeGroup.isPrivate ? (
                  <button
                    onClick={() => handleJoinGroup(activeGroup.id)}
                    className="mt-4 px-4 py-2 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-700"
                  >
                    Join Group Channel
                  </button>
                ) : (
                  <p className="mt-3 text-xs font-medium text-amber-700">
                    Private group — contact an Admin or Group Administrator to be added.
                  </p>
                )}
              </div>
            ) : (
              <>
                <div className="flex-1 overflow-y-auto p-5 space-y-4 bg-slate-50/40">
                  {loading ? (
                    <div className="space-y-3">
                      <div className="h-14 w-3/4 bg-slate-200/70 rounded-lg animate-pulse" />
                      <div className="h-14 w-2/3 bg-slate-200/70 rounded-lg animate-pulse" />
                    </div>
                  ) : messages.length === 0 ? (
                    <div className="text-center py-12 text-xs text-slate-500">
                      No messages in #{activeGroup.name} yet. Start the discussion below.
                    </div>
                  ) : (
                    messages.map((msg) => {
                      const isMine = msg.senderId === currentUser.id;
                      const canDelete = isMine || canModerateGroup;
                      return (
                        <div key={msg.id} className="flex items-start gap-3 group">
                          <Avatar name={msg.senderName} color={msg.senderAvatarColor} size="sm" />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 text-xs">
                              <span className="font-semibold text-slate-900">{msg.senderName}</span>
                              <span aria-hidden="true" className="text-slate-300">·</span>
                              <span className="text-slate-500">{getRoleLabel(msg.senderRole)}</span>
                              <span aria-hidden="true" className="text-slate-300">·</span>
                              <span className="font-mono tabular-nums text-slate-400">
                                {formatTime(msg.createdAt)}
                              </span>
                              {isMine && !msg.isDeleted && (
                                <CheckCheck
                                  className={`w-3.5 h-3.5 ${
                                    msg.deliveryStatus === 'read' ? 'text-blue-600' : 'text-slate-400'
                                  }`}
                                />
                              )}
                              {msg.isPinned && (
                                <span className="text-amber-700 font-medium">Pinned</span>
                              )}
                              {msg.isFlagged && (
                                <span className="text-red-600 font-medium">Flagged</span>
                              )}
                            </div>

                            {msg.replyPreview && !msg.isDeleted && (
                              <div className="mt-1 px-2.5 py-1 bg-slate-100 rounded text-xs text-slate-600 max-w-xl">
                                <span className="font-semibold">{msg.replyPreview.senderName}: </span>
                                <span className="truncate">{msg.replyPreview.content}</span>
                              </div>
                            )}

                            <div
                              className={`mt-1 text-sm leading-relaxed ${
                                msg.isDeleted ? 'text-slate-400 italic' : 'text-slate-800'
                              }`}
                            >
                              {msg.content}
                            </div>
                          </div>

                          {!msg.isDeleted && (
                            <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 shrink-0">
                              <button
                                onClick={() => setReplyTo(msg)}
                                title="Reply"
                                className="p-1 rounded hover:bg-slate-200 text-slate-500"
                              >
                                <Reply className="w-3.5 h-3.5" />
                              </button>
                              {canModerateGroup && (
                                <button
                                  onClick={() => handlePin(msg.id)}
                                  title={msg.isPinned ? 'Unpin' : 'Pin message'}
                                  className="p-1 rounded hover:bg-amber-100 text-slate-500 hover:text-amber-700"
                                >
                                  <Pin className="w-3.5 h-3.5" />
                                </button>
                              )}
                              <button
                                onClick={() => handleFlag(msg.id)}
                                title="Flag for moderation"
                                className="p-1 rounded hover:bg-amber-100 text-slate-500 hover:text-amber-700"
                              >
                                <Flag className="w-3.5 h-3.5" />
                              </button>
                              {canDelete && (
                                <button
                                  onClick={() => handleDelete(msg.id)}
                                  title="Delete message"
                                  className="p-1 rounded hover:bg-red-100 text-slate-500 hover:text-red-700"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                  <div ref={bottomRef} />
                </div>

                {groupTyping && (
                  <div className="px-5 py-1.5 bg-white border-t border-slate-100 text-xs text-slate-500">
                    {groupTyping} is typing...
                  </div>
                )}

                {replyTo && (
                  <div className="px-5 py-2 bg-slate-100 border-t border-slate-200 flex items-center justify-between gap-3 text-xs">
                    <div className="min-w-0">
                      <span className="font-semibold text-slate-700">Replying to {replyTo.senderName}: </span>
                      <span className="text-slate-600 truncate">{replyTo.content}</span>
                    </div>
                    <button onClick={() => setReplyTo(null)} className="text-slate-500 hover:text-slate-900">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}

                {activeGroup.isMember ? (
                  <form onSubmit={handleSend} className="p-3 bg-white border-t border-slate-200 flex items-center gap-2">
                    <input
                      type="text"
                      value={draft}
                      disabled={activeGroup.amMuted || currentUser.status === 'muted'}
                      onChange={(e) => handleDraftChange(e.target.value)}
                      placeholder={
                        activeGroup.amMuted
                          ? 'You are muted in this group'
                          : `Message #${activeGroup.name}...`
                      }
                      className="flex-1 px-3.5 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600 disabled:bg-slate-50"
                    />
                    <button
                      type="submit"
                      disabled={!draft.trim() || activeGroup.amMuted || currentUser.status === 'muted'}
                      className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-40 transition-colors whitespace-nowrap shrink-0"
                    >
                      <Send className="w-4 h-4" />
                      Send
                    </button>
                  </form>
                ) : (
                  <div className="p-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-600">
                    <span>Viewing channel as Platform Admin (not a member).</span>
                    <button
                      onClick={() => handleJoinGroup(activeGroup.id)}
                      className="px-3 py-1.5 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700"
                    >
                      Join Channel to Post
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* Right Member Roster Drawer */}
      {showRoster && activeGroup && (
        <div className="w-64 shrink-0 border-l border-slate-200 bg-white flex flex-col">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-700">Members ({members.length})</span>
            <button onClick={() => setShowRoster(false)} className="text-slate-400 hover:text-slate-700">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
            {members.map((m) => {
              const isOnline = onlineUserIds.has(m.id);
              return (
                <div key={m.id} className="p-3 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Avatar
                      name={m.displayName}
                      color={m.avatarColor}
                      size="sm"
                      isOnline={isOnline}
                      presenceMode={m.presenceMode}
                      showPresence={true}
                    />
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-slate-900 truncate flex items-center gap-1">
                        {m.displayName}
                        {m.groupRole === 'group_admin' && (
                          <span title="Group Administrator">
                            <Shield className="w-3 h-3 text-blue-600 shrink-0" />
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500 truncate">
                        {m.isMutedInGroup ? 'Muted in group' : isOnline ? 'Online' : 'Offline'}
                      </div>
                    </div>
                  </div>

                  {canModerateGroup && m.id !== currentUser.id && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => handleToggleMuteMember(m.id, m.isMutedInGroup)}
                        title={m.isMutedInGroup ? 'Unmute in group' : 'Mute in group'}
                        className={`p-1 rounded ${
                          m.isMutedInGroup ? 'bg-amber-100 text-amber-700' : 'hover:bg-slate-100 text-slate-500'
                        }`}
                      >
                        <VolumeX className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleRemoveMember(m.id)}
                        title="Remove from group"
                        className="p-1 rounded hover:bg-red-100 text-slate-500 hover:text-red-700"
                      >
                        <UserMinus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
