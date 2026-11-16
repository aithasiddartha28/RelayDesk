import { useCallback, useEffect, useRef, useState } from 'react';
import { getStoredToken } from '../lib/api';
import type { ChatMessage, DeliveryStatus, NotificationItem, PresenceMode } from '../types';

export interface TypingState {
  userId: string;
  displayName: string;
  conversationType: 'dm' | 'group';
  targetId: string;
  isTyping: boolean;
}

interface UseWebSocketOptions {
  userId: string | null;
  onNewMessage?: (msg: ChatMessage) => void;
  onMessageStatus?: (messageId: string, status: DeliveryStatus) => void;
  onMessageDeleted?: (messageId: string) => void;
  onMessagePinned?: (messageId: string, isPinned: boolean) => void;
  onNotification?: (ntf: NotificationItem) => void;
  onGroupsUpdated?: () => void;
  onPresenceChanged?: (userId: string, isOnline: boolean, presenceMode: PresenceMode) => void;
  onTypingUpdate?: (typing: TypingState) => void;
  onError?: (errorMessage: string) => void;
}

export function useWebSocket(options: UseWebSocketOptions) {
  const { userId } = options;
  const [connected, setConnected] = useState(false);
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());
  const wsRef = useRef<WebSocket | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    if (!userId) {
      setConnected(false);
      setOnlineUserIds(new Set());
      return;
    }

    let closedIntentionally = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let pingTimer: ReturnType<typeof setInterval> | null = null;
    let attempt = 0;

    function connect() {
      const token = getStoredToken();
      if (!token || closedIntentionally) return;

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        attempt = 0;
        setConnected(true);
        pingTimer = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, 20000);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data as string) as Record<string, unknown>;
          const type = data.type as string;

          if (type === 'ws:ready' && Array.isArray(data.onlineUserIds)) {
            setOnlineUserIds(new Set(data.onlineUserIds as string[]));
          } else if (type === 'presence:changed') {
            const uid = data.userId as string;
            const isOnline = Boolean(data.isOnline);
            const mode = (data.presenceMode as PresenceMode) || 'available';
            setOnlineUserIds((prev) => {
              const next = new Set(prev);
              if (isOnline) next.add(uid);
              else next.delete(uid);
              return next;
            });
            optionsRef.current.onPresenceChanged?.(uid, isOnline, mode);
          } else if (type === 'message:new' && data.message) {
            optionsRef.current.onNewMessage?.(data.message as ChatMessage);
          } else if (type === 'message:status') {
            optionsRef.current.onMessageStatus?.(
              data.messageId as string,
              data.deliveryStatus as DeliveryStatus
            );
          } else if (type === 'message:deleted') {
            optionsRef.current.onMessageDeleted?.(data.messageId as string);
          } else if (type === 'message:pinned') {
            optionsRef.current.onMessagePinned?.(data.messageId as string, Boolean(data.isPinned));
          } else if (type === 'notification:new' && data.notification) {
            optionsRef.current.onNotification?.(data.notification as NotificationItem);
          } else if (type === 'groups:updated') {
            optionsRef.current.onGroupsUpdated?.();
          } else if (type === 'typing:update') {
            optionsRef.current.onTypingUpdate?.({
              userId: data.userId as string,
              displayName: data.displayName as string,
              conversationType: data.conversationType as 'dm' | 'group',
              targetId: data.targetId as string,
              isTyping: Boolean(data.isTyping),
            });
          } else if (type === 'error' && typeof data.message === 'string') {
            optionsRef.current.onError?.(data.message);
          }
        } catch (err) {
          console.error('WS parse error:', err);
        }
      };

      ws.onclose = () => {
        setConnected(false);
        if (pingTimer) clearInterval(pingTimer);
        if (!closedIntentionally) {
          const delay = Math.min(1000 * Math.pow(1.6, attempt), 10000);
          attempt += 1;
          reconnectTimer = setTimeout(connect, delay);
        }
      };
    }

    connect();

    return () => {
      closedIntentionally = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (pingTimer) clearInterval(pingTimer);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [userId]);

  const sendEvent = useCallback((payload: Record<string, unknown>): boolean => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload));
      return true;
    }
    return false;
  }, []);

  return {
    connected,
    onlineUserIds,
    sendEvent,
  };
}
