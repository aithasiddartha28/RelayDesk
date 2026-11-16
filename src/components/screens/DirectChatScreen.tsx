import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  Check,
  CheckCheck,
  Flag,
  MessageSquare,
  Reply,
  Search,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { formatRelativeTime, formatTime, getRoleLabel } from '../../lib/format';
import type { ChatMessage, User } from '../../types';
import { Avatar } from '../Avatar';

interface DirectChatScreenProps {
  currentUser: User;
  users: User[];
  onlineUserIds: Set<string>;
  selectedPeerId: string | null;
  onSelectPeer: (peerId: string) => void;
  incomingMessages: ChatMessage[];
  typingByPeer: Record<string, string | null>;
  sendWsEvent: (payload: Record<string, unknown>) => boolean;
}

export function DirectChatScreen({
  currentUser,
  users,
  onlineUserIds,
  selectedPeerId,
  onSelectPeer,
  incomingMessages,
  typingByPeer,
  sendWsEvent,
}: DirectChatScreenProps) {
  const [searchPeer, setSearchPeer] = useState('');
  const [threadSearch, setThreadSearch] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const peers = useMemo(() => {
    return users
      .filter((u) => u.id !== currentUser.id)
      .filter(
        (u) =>
          u.displayName.toLowerCase().includes(searchPeer.toLowerCase()) ||
          u.username.toLowerCase().includes(searchPeer.toLowerCase())
      );
  }, [users, currentUser.id, searchPeer]);

  const activePeer = useMemo(
    () => users.find((u) => u.id === selectedPeerId) || peers[0] || null,
    [users, selectedPeerId, peers]
  );

  useEffect(() => {
    if (!selectedPeerId && peers[0]) {
      onSelectPeer(peers[0].id);
    }
  }, [selectedPeerId, peers, onSelectPeer]);

  // Fetch DM history when active peer changes
  useEffect(() => {
    if (!activePeer) return;
    let cancelled = false;
    setLoading(true);
    setErrorBanner(null);

    apiFetch<{ messages: ChatMessage[] }>(`/messages/dm/${activePeer.id}`)
      .then((res) => {
        if (!cancelled) {
          setMessages(res.messages);
          sendWsEvent({ type: 'message:read', conversationType: 'dm', targetId: activePeer.id });
        }
      })
      .catch((err) => {
        if (!cancelled) setErrorBanner(err instanceof Error ? err.message : 'Failed to load messages');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activePeer?.id, sendWsEvent]);

  // Merge live WebSocket messages & status updates into thread
  useEffect(() => {
    if (!activePeer || incomingMessages.length === 0) return;
    const relevant = incomingMessages.filter(
      (m) =>
        m.conversationType === 'dm' &&
        ((m.senderId === currentUser.id && m.recipientId === activePeer.id) ||
          (m.senderId === activePeer.id && m.recipientId === currentUser.id))
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

    if (relevant.some((m) => m.senderId === activePeer.id)) {
      sendWsEvent({ type: 'message:read', conversationType: 'dm', targetId: activePeer.id });
    }
  }, [incomingMessages, activePeer?.id, currentUser.id, sendWsEvent]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, activePeer?.id]);

  function handleDraftChange(val: string) {
    setDraft(val);
    if (!activePeer) return;
    sendWsEvent({ type: 'typing:start', conversationType: 'dm', targetId: activePeer.id });
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      sendWsEvent({ type: 'typing:stop', conversationType: 'dm', targetId: activePeer.id });
    }, 1500);
  }

  function handleSend(e: FormEvent) {
    e.preventDefault();
    if (!activePeer || !draft.trim()) return;
    const sent = sendWsEvent({
      type: 'message:send',
      conversationType: 'dm',
      targetId: activePeer.id,
      content: draft.trim(),
      replyToId: replyTo?.id || null,
      clientTempId: `tmp_${Date.now()}`,
    });
    if (sent) {
      sendWsEvent({ type: 'typing:stop', conversationType: 'dm', targetId: activePeer.id });
      setDraft('');
      setReplyTo(null);
      setErrorBanner(null);
    } else {
      setErrorBanner('WebSocket disconnected. Reconnecting...');
    }
  }

  async function handleFlag(msgId: string) {
    try {
      await apiFetch(`/messages/${msgId}/flag`, {
        method: 'POST',
        body: JSON.stringify({ reason: 'Flagged by user in Direct Messages' }),
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
        prev.map((m) => (m.id === msgId ? { ...m, isDeleted: true, content: 'This message was removed.' } : m))
      );
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Unable to delete message');
    }
  }

  const displayedMessages = useMemo(() => {
    if (!threadSearch.trim()) return messages;
    const q = threadSearch.toLowerCase();
    return messages.filter((m) => m.content.toLowerCase().includes(q));
  }, [messages, threadSearch]);

  const peerIsOnline = activePeer ? onlineUserIds.has(activePeer.id) : false;
  const peerTyping = activePeer ? typingByPeer[activePeer.id] : null;

  return (
    <div className="h-full flex bg-white border border-slate-200 rounded-xl overflow-hidden">
      {/* Left Peer Roster */}
      <div className="w-72 shrink-0 border-r border-slate-200 flex flex-col bg-slate-50/40">
        <div className="p-3 border-b border-slate-200">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchPeer}
              onChange={(e) => setSearchPeer(e.target.value)}
              placeholder="Search people..."
              className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
          {peers.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500">No matching users found.</div>
          ) : (
            peers.map((peer) => {
              const isSelected = activePeer?.id === peer.id;
              const isOnline = onlineUserIds.has(peer.id);
              return (
                <button
                  key={peer.id}
                  onClick={() => onSelectPeer(peer.id)}
                  className={`w-full p-3.5 flex items-center gap-3 text-left transition-colors ${
                    isSelected ? 'bg-blue-50/80' : 'hover:bg-white'
                  }`}
                >
                  <Avatar
                    name={peer.displayName}
                    color={peer.avatarColor}
                    isOnline={isOnline}
                    presenceMode={peer.presenceMode}
                    showPresence={true}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-slate-900 truncate">{peer.displayName}</span>
                      <span className="text-[11px] font-mono tabular-nums text-slate-400 shrink-0">
                        {isOnline ? 'Online' : formatRelativeTime(peer.lastActiveAt)}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 truncate mt-0.5">
                      @{peer.username} · {getRoleLabel(peer.role)}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Right Chat Conversation */}
      <div className="flex-1 flex flex-col min-w-0">
        {!activePeer ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
            <MessageSquare className="w-8 h-8 text-slate-300 mb-3" />
            <h2 className="text-sm font-semibold text-slate-900">Select a conversation</h2>
            <p className="text-xs text-slate-500 mt-1">Choose a workspace colleague to begin 1-to-1 messaging.</p>
          </div>
        ) : (
          <>
            {/* Conversation Header */}
            <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between gap-4 bg-white">
              <div className="flex items-center gap-3 min-w-0">
                <Avatar
                  name={activePeer.displayName}
                  color={activePeer.avatarColor}
                  isOnline={peerIsOnline}
                  presenceMode={activePeer.presenceMode}
                  showPresence={true}
                />
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-900 truncate">{activePeer.displayName}</div>
                  <div className="text-xs text-slate-500 flex items-center gap-1.5 truncate">
                    <span>{peerIsOnline ? `Online (${activePeer.presenceMode})` : `Last active ${formatRelativeTime(activePeer.lastActiveAt)}`}</span>
                    <span aria-hidden="true">·</span>
                    <span>{getRoleLabel(activePeer.role)}</span>
                  </div>
                </div>
              </div>

              <div className="relative w-48 hidden sm:block">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={threadSearch}
                  onChange={(e) => setThreadSearch(e.target.value)}
                  placeholder="Filter thread..."
                  className="w-full pl-8 pr-2.5 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
                />
              </div>
            </div>

            {errorBanner && (
              <div className="px-5 py-2 bg-red-50 border-b border-red-200 text-xs text-red-700 flex items-center justify-between">
                <span>{errorBanner}</span>
                <button onClick={() => setErrorBanner(null)} className="text-red-500 hover:text-red-800">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Message History */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4 bg-slate-50/40">
              {loading ? (
                <div className="space-y-3">
                  <div className="h-12 w-2/3 bg-slate-200/70 rounded-lg animate-pulse" />
                  <div className="h-12 w-1/2 ml-auto bg-slate-200/70 rounded-lg animate-pulse" />
                </div>
              ) : displayedMessages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center py-12">
                  <p className="text-sm font-medium text-slate-700">No messages yet with {activePeer.displayName}</p>
                  <p className="text-xs text-slate-500 mt-1">Send a direct message below over live WebSockets.</p>
                </div>
              ) : (
                displayedMessages.map((msg) => {
                  const isMine = msg.senderId === currentUser.id;
                  return (
                    <div key={msg.id} className={`flex flex-col ${isMine ? 'items-end' : 'items-start'} group`}>
                      <div className="flex items-center gap-2 mb-1 text-[11px] text-slate-500">
                        <span className="font-medium text-slate-700">{isMine ? 'You' : msg.senderName}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">{formatTime(msg.createdAt)}</span>
                        {msg.isFlagged && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="text-amber-700 font-medium">Flagged</span>
                          </>
                        )}
                      </div>

                      <div className="flex items-end gap-2 max-w-[78%]">
                        {!isMine && !msg.isDeleted && (
                          <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 order-2">
                            <button
                              onClick={() => setReplyTo(msg)}
                              title="Reply"
                              className="p-1 rounded hover:bg-slate-200 text-slate-500"
                            >
                              <Reply className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleFlag(msg.id)}
                              title="Flag for moderation"
                              className="p-1 rounded hover:bg-amber-100 text-slate-500 hover:text-amber-700"
                            >
                              <Flag className="w-3.5 h-3.5" />
                            </button>
                            {currentUser.role === 'admin' && (
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

                        {isMine && !msg.isDeleted && (
                          <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                            <button
                              onClick={() => setReplyTo(msg)}
                              title="Reply"
                              className="p-1 rounded hover:bg-slate-200 text-slate-500"
                            >
                              <Reply className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDelete(msg.id)}
                              title="Delete message"
                              className="p-1 rounded hover:bg-red-100 text-slate-500 hover:text-red-700"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}

                        <div
                          className={`px-4 py-2.5 rounded-xl text-sm leading-relaxed ${
                            msg.isDeleted
                              ? 'bg-slate-100 text-slate-400 italic border border-slate-200'
                              : isMine
                              ? 'bg-slate-900 text-white'
                              : 'bg-white text-slate-900 border border-slate-200'
                          }`}
                        >
                          {msg.replyPreview && !msg.isDeleted && (
                            <div
                              className={`mb-2 px-2.5 py-1.5 rounded text-xs ${
                                isMine ? 'bg-white/10 text-slate-200' : 'bg-slate-100 text-slate-600'
                              }`}
                            >
                              <div className="font-semibold">{msg.replyPreview.senderName}</div>
                              <div className="truncate">{msg.replyPreview.content}</div>
                            </div>
                          )}
                          <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                        </div>
                      </div>

                      {isMine && !msg.isDeleted && (
                        <div className="mt-1 flex items-center gap-1 text-[11px] font-mono tabular-nums text-slate-400">
                          {msg.deliveryStatus === 'sent' && (
                            <>
                              <Check className="w-3 h-3" />
                              <span>Sent</span>
                            </>
                          )}
                          {msg.deliveryStatus === 'delivered' && (
                            <>
                              <CheckCheck className="w-3.5 h-3.5 text-slate-500" />
                              <span>Delivered</span>
                            </>
                          )}
                          {msg.deliveryStatus === 'read' && (
                            <>
                              <CheckCheck className="w-3.5 h-3.5 text-blue-600" />
                              <span className="text-blue-600">Read</span>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
              <div ref={bottomRef} />
            </div>

            {/* Typing indicator */}
            {peerTyping && (
              <div className="px-5 py-1.5 bg-white border-t border-slate-100 text-xs text-slate-500">
                {peerTyping} is typing...
              </div>
            )}

            {/* Reply bar */}
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

            {/* Composer */}
            <form onSubmit={handleSend} className="p-3 bg-white border-t border-slate-200 flex items-center gap-2">
              <input
                type="text"
                value={draft}
                disabled={currentUser.status === 'muted'}
                onChange={(e) => handleDraftChange(e.target.value)}
                placeholder={
                  currentUser.status === 'muted'
                    ? 'Your account is muted by an administrator'
                    : `Message ${activePeer.displayName}...`
                }
                className="flex-1 px-3.5 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600 disabled:bg-slate-50"
              />
              <button
                type="submit"
                disabled={!draft.trim() || currentUser.status === 'muted'}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-40 transition-colors whitespace-nowrap shrink-0"
              >
                <Send className="w-4 h-4" />
                Send
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
