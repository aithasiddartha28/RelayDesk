import { useCallback, useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { AdminReportsScreen } from './components/screens/AdminReportsScreen';
import { AuthScreen } from './components/screens/AuthScreen';
import { ContactsScreen } from './components/screens/ContactsScreen';
import { DeploymentDocsScreen } from './components/screens/DeploymentDocsScreen';
import { DirectChatScreen } from './components/screens/DirectChatScreen';
import { GroupChatScreen } from './components/screens/GroupChatScreen';
import { GroupsDirectoryScreen } from './components/screens/GroupsDirectoryScreen';
import { ModerationScreen } from './components/screens/ModerationScreen';
import { NotificationsScreen } from './components/screens/NotificationsScreen';
import { ProfileSettingsScreen } from './components/screens/ProfileSettingsScreen';
import { useWebSocket, type TypingState } from './hooks/useWebSocket';
import { apiFetch, getStoredToken, setStoredToken } from './lib/api';
import type { ChatMessage, Group, NotificationItem, ScreenId, User } from './types';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [activeScreen, setActiveScreen] = useState<ScreenId>('dm');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [users, setUsers] = useState<User[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [flaggedCount, setFlaggedCount] = useState(0);

  const [selectedPeerId, setSelectedPeerId] = useState<string | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [createGroupSignal, setCreateGroupSignal] = useState(0);

  const [incomingMessages, setIncomingMessages] = useState<ChatMessage[]>([]);
  const [typingByPeer, setTypingByPeer] = useState<Record<string, string | null>>({});
  const [typingByGroup, setTypingByGroup] = useState<Record<string, string | null>>({});
  const [toastError, setToastError] = useState<string | null>(null);

  const loadWorkspaceData = useCallback(async (activeUser: User) => {
    try {
      const [usersRes, groupsRes, ntfRes] = await Promise.all([
        apiFetch<{ users: User[] }>('/users'),
        apiFetch<{ groups: Group[] }>('/groups'),
        apiFetch<{ notifications: NotificationItem[] }>('/notifications'),
      ]);
      setUsers(usersRes.users);
      setGroups(groupsRes.groups);
      setNotifications(ntfRes.notifications);

      if (activeUser.role === 'admin' || activeUser.role === 'group_admin') {
        const modRes = await apiFetch<{ flagged: unknown[] }>('/moderation/flagged');
        setFlaggedCount(modRes.flagged.length);
      } else {
        setFlaggedCount(0);
      }
    } catch (err) {
      console.error('Failed to load workspace:', err);
    }
  }, []);

  useEffect(() => {
    const token = getStoredToken();
    if (!token) {
      setAuthChecking(false);
      return;
    }
    apiFetch<{ user: User }>('/auth/me')
      .then((res) => {
        setUser(res.user);
        loadWorkspaceData(res.user);
      })
      .catch(() => {
        setStoredToken(null);
      })
      .finally(() => setAuthChecking(false));
  }, [loadWorkspaceData]);

  const handleNewMessage = useCallback((msg: ChatMessage) => {
    setIncomingMessages((prev) => {
      const exists = prev.some((m) => m.id === msg.id);
      if (exists) return prev;
      return [...prev.slice(-150), msg];
    });
    if (msg.isFlagged) {
      setFlaggedCount((c) => c + 1);
    }
  }, []);

  const handleMessageStatus = useCallback((messageId: string, status: ChatMessage['deliveryStatus']) => {
    setIncomingMessages((prev) =>
      prev.map((m) => (m.id === messageId ? { ...m, deliveryStatus: status } : m))
    );
  }, []);

  const handleMessageDeleted = useCallback((messageId: string) => {
    setIncomingMessages((prev) =>
      prev.map((m) =>
        m.id === messageId ? { ...m, isDeleted: true, content: 'This message was removed.' } : m
      )
    );
  }, []);

  const handleMessagePinned = useCallback((messageId: string, isPinned: boolean) => {
    setIncomingMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, isPinned } : m)));
  }, []);

  const handleNotification = useCallback((ntf: NotificationItem) => {
    setNotifications((prev) => [ntf, ...prev.filter((p) => p.id !== ntf.id)]);
  }, []);

  const handleGroupsUpdated = useCallback(() => {
    if (user) {
      apiFetch<{ groups: Group[] }>('/groups')
        .then((res) => setGroups(res.groups))
        .catch(() => {});
    }
  }, [user]);

  const handlePresenceChanged = useCallback(
    (uid: string, isOnline: boolean, presenceMode: User['presenceMode']) => {
      setUsers((prev) =>
        prev.map((u) => (u.id === uid ? { ...u, isOnline, presenceMode } : u))
      );
    },
    []
  );

  const handleTypingUpdate = useCallback(
    (typing: TypingState) => {
      if (typing.userId === user?.id) return;
      if (typing.conversationType === 'dm') {
        setTypingByPeer((prev) => ({
          ...prev,
          [typing.userId]: typing.isTyping ? typing.displayName : null,
        }));
      } else {
        setTypingByGroup((prev) => ({
          ...prev,
          [typing.targetId]: typing.isTyping ? typing.displayName : null,
        }));
      }
    },
    [user?.id]
  );

  const { connected, onlineUserIds, sendEvent } = useWebSocket({
    userId: user?.id || null,
    onNewMessage: handleNewMessage,
    onMessageStatus: handleMessageStatus,
    onMessageDeleted: handleMessageDeleted,
    onMessagePinned: handleMessagePinned,
    onNotification: handleNotification,
    onGroupsUpdated: handleGroupsUpdated,
    onPresenceChanged: handlePresenceChanged,
    onTypingUpdate: handleTypingUpdate,
    onError: (msg) => setToastError(msg),
  });

  const unreadNotifications = useMemo(
    () => notifications.filter((n) => !n.isRead).length,
    [notifications]
  );

  async function handleLogout() {
    try {
      await apiFetch('/auth/logout', { method: 'POST' });
    } catch {
      // Ignore network error on logout
    }
    setStoredToken(null);
    setUser(null);
    setIncomingMessages([]);
    setNotifications([]);
    setActiveScreen('dm');
  }

  function handleAuthenticated(authedUser: User) {
    setUser(authedUser);
    setActiveScreen(authedUser.role === 'admin' ? 'admin-reports' : 'dm');
    loadWorkspaceData(authedUser);
  }

  function handleNavigate(screen: ScreenId) {
    if (screen === 'admin-reports' && user?.role !== 'admin') {
      setToastError('Admin Reports are restricted to Administrator accounts.');
      return;
    }
    setActiveScreen(screen);
    setMobileMenuOpen(false);
  }

  if (authChecking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 text-sm text-slate-600">
        Loading RelayDesk workspace...
      </div>
    );
  }

  if (!user) {
    return <AuthScreen onAuthenticated={handleAuthenticated} />;
  }

  return (
    <div className="h-screen w-screen overflow-hidden flex bg-slate-50 text-slate-900">
      {/* Desktop Sidebar */}
      <div className="hidden lg:block h-full">
        <Sidebar
          user={user}
          activeScreen={activeScreen}
          onNavigate={handleNavigate}
          unreadNotifications={unreadNotifications}
          flaggedCount={flaggedCount}
          onLogout={handleLogout}
        />
      </div>

      {/* Mobile Drawer Sidebar */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="fixed inset-0 bg-slate-900/40" onClick={() => setMobileMenuOpen(false)} />
          <div className="relative z-10 h-full">
            <Sidebar
              user={user}
              activeScreen={activeScreen}
              onNavigate={handleNavigate}
              unreadNotifications={unreadNotifications}
              flaggedCount={flaggedCount}
              onLogout={handleLogout}
            />
          </div>
        </div>
      )}

      {/* Main Content Shell */}
      <div className="flex-1 flex flex-col min-w-0 h-full">
        <TopBar
          user={user}
          activeScreen={activeScreen}
          wsConnected={connected}
          onToggleMobileMenu={() => setMobileMenuOpen((v) => !v)}
          onCreateGroupClick={() => {
            setActiveScreen('directory');
            setCreateGroupSignal((s) => s + 1);
          }}
        />

        {toastError && (
          <div className="mx-4 lg:mx-6 mt-3 px-4 py-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-center justify-between">
            <span>{toastError}</span>
            <button onClick={() => setToastError(null)} className="text-red-500 hover:text-red-800">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          {activeScreen === 'dm' && (
            <DirectChatScreen
              currentUser={user}
              users={users}
              onlineUserIds={onlineUserIds}
              selectedPeerId={selectedPeerId}
              onSelectPeer={setSelectedPeerId}
              incomingMessages={incomingMessages}
              typingByPeer={typingByPeer}
              sendWsEvent={sendEvent}
            />
          )}

          {activeScreen === 'groups' && (
            <GroupChatScreen
              currentUser={user}
              groups={groups}
              onlineUserIds={onlineUserIds}
              selectedGroupId={selectedGroupId}
              onSelectGroup={setSelectedGroupId}
              onRefreshGroups={() => loadWorkspaceData(user)}
              incomingMessages={incomingMessages}
              typingByGroup={typingByGroup}
              sendWsEvent={sendEvent}
            />
          )}

          {activeScreen === 'contacts' && (
            <ContactsScreen
              currentUser={user}
              users={users}
              onlineUserIds={onlineUserIds}
              onStartDm={(peerId) => {
                setSelectedPeerId(peerId);
                setActiveScreen('dm');
              }}
            />
          )}

          {activeScreen === 'directory' && (
            <GroupsDirectoryScreen
              currentUser={user}
              groups={groups}
              users={users}
              onRefreshGroups={() => loadWorkspaceData(user)}
              onOpenGroupChat={(groupId) => {
                setSelectedGroupId(groupId);
                setActiveScreen('groups');
              }}
              openCreateModalSignal={createGroupSignal}
            />
          )}

          {activeScreen === 'notifications' && (
            <NotificationsScreen
              notifications={notifications}
              onRefresh={() => loadWorkspaceData(user)}
              onNavigateTarget={(screen, targetId) => {
                if (screen === 'dm' && targetId) setSelectedPeerId(targetId);
                if (screen === 'groups' && targetId) setSelectedGroupId(targetId);
                setActiveScreen(screen);
              }}
            />
          )}

          {activeScreen === 'moderation' && (
            <ModerationScreen
              currentUser={user}
              users={users}
              onRefreshUsers={() => loadWorkspaceData(user)}
              onRefreshModerationCount={() => loadWorkspaceData(user)}
            />
          )}

          {activeScreen === 'admin-reports' && <AdminReportsScreen currentUser={user} />}

          {activeScreen === 'profile' && (
            <ProfileSettingsScreen
              currentUser={user}
              onUserUpdated={setUser}
              sendWsEvent={sendEvent}
            />
          )}

          {activeScreen === 'docs' && <DeploymentDocsScreen />}
        </main>
      </div>
    </div>
  );
}
