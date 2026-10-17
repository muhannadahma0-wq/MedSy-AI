import React, { createContext, useContext, useState, useEffect } from 'react';
import socketService from '../services/socketService';

const SocketContext = createContext();

export const useSocket = () => {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error('useSocket must be used within a SocketProvider');
  }
  return context;
};

export const SocketProvider = ({ children }) => {
  // Initialize from any notifications already held by the singleton service
  const [notifications, setNotifications] = useState(() => socketService.getNotifications());
  const [connected, setConnected] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  // Sandbox port fix: track token availability as STATE (not a one-shot mount
  // check). The provider mounts before login, so the original one-shot check
  // meant the notification listener was never registered after an SPA login
  // (only the socket connected) — and the socket stayed connected after logout
  // (original logout did a full page unload; the hash-router port doesn't).
  const hasToken = () => {
    const t = localStorage.getItem("token");
    return !!(t && t !== "null" && t !== "undefined" && t.trim() !== "");
  };
  const [authReady, setAuthReady] = useState(hasToken);

  useEffect(() => {
    const onAuthChanged = () => setAuthReady(hasToken());
    window.addEventListener("medsync-auth-changed", onAuthChanged);
    return () => window.removeEventListener("medsync-auth-changed", onAuthChanged);
  }, []);

  useEffect(() => {
    if (!authReady) {
      console.warn("SocketProvider: no valid token found, skipping connection.");
      return;
    }

    // Connect to WebSocket server (token is read inside socketService.connect)
    socketService.connect();

    // Listen for connection status changes
    const checkConnection = () => {
      setConnected(socketService.isConnected());
    };

    // Set up notification listener
    const unsubscribe = socketService.onNotification((notification) => {
      // Sandbox port fix: guard against the same notification being delivered
      // twice (e.g. a lingering socket from a previous session still in the
      // user room) — duplicates crashed the toast list with duplicate keys.
      setNotifications(prev =>
        prev.some(n => n.id === notification.id) ? prev : [notification, ...prev]
      );
      setUnreadCount(prev => prev + 1);
      
      // Show browser notification if permission granted
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(notification.title, {
          body: notification.message,
          icon: '/favicon.ico',
          badge: '/favicon.ico',
          tag: notification.id,
        });
      }
    });

    // Check connection status periodically
    const interval = setInterval(checkConnection, 1000);

    return () => {
      clearInterval(interval);
      unsubscribe();
      socketService.disconnect();
    };
  }, [authReady]); // re-runs when the auth session appears/disappears

  // Request notification permission on mount
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().then(permission => {
        console.log('Notification permission:', permission);
      });
    }
  }, []);

  const markAllAsRead = () => {
    setUnreadCount(0);
  };

  const clearAllNotifications = () => {
    socketService.clearNotifications();
    setNotifications([]);
    setUnreadCount(0);
  };

  const removeNotification = (notificationId) => {
    socketService.removeNotification(notificationId);
    setNotifications(prev => prev.filter(n => n.id !== notificationId));
    if (unreadCount > 0) {
      setUnreadCount(prev => Math.max(0, prev - 1));
    }
  };

  const value = {
    notifications,
    connected,
    unreadCount,
    markAllAsRead,
    clearAllNotifications,
    removeNotification,
    socketService
  };

  return (
    <SocketContext.Provider value={value}>
      {children}
    </SocketContext.Provider>
  );
};