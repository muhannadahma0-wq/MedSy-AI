import { io } from 'socket.io-client';

class SocketService {
  constructor() {
    this.socket = null;
    this.connected = false;
    this.notifications = [];
    this.listeners = new Set();
  }

  connect() {
    if (this.socket) {
      // Reuse the existing socket (socket.io reconnects on its own). Creating
      // a second one would orphan the first — it can still (re)connect and
      // join the user room, delivering every notification twice.
      if (this.connected) {
        console.log('Socket already connected');
      }
      return this.socket;
    }

    // Sandbox gateway port: the socket.io mini-service runs on port 3003 and is
    // reached through the Caddy gateway via the XTransformPort query parameter.
    const token = (typeof localStorage !== 'undefined' && localStorage.getItem('token')) || '';

    const socketUrl =
      typeof process !== 'undefined' && process.env.NEXT_PUBLIC_SOCKET_URL
        ? process.env.NEXT_PUBLIC_SOCKET_URL.trim()
        : "";

    const socketOptions = {
      transports: ['websocket', 'polling'],
      autoConnect: true,
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5,
      timeout: 20000,
      auth: { token },
    };

    // In Render, connect directly to the dedicated public Socket.IO service.
    // The XTransformPort URL remains only as a local sandbox-preview fallback.
    this.socket = socketUrl
      ? io(socketUrl, {
          ...socketOptions,
          path: process.env.NEXT_PUBLIC_SOCKET_PATH || '/',
        })
      : io('/?XTransformPort=3003', socketOptions);

    this.socket.on('connect', () => {
      console.log('Connected to WebSocket server:', this.socket.id);
      this.connected = true;
      
      // Join user-specific room if user is logged in
      const user = JSON.parse(localStorage.getItem('user') || 'null');
      if (user && user.id) {
        this.joinUserRoom(user.id);
      }
    });

    this.socket.on('disconnect', () => {
      console.log('Disconnected from WebSocket server');
      this.connected = false;
    });

    this.socket.on('notification', (data) => {
      console.log('Received notification:', data);
      this.notifications.unshift(data); // Add to beginning of array
      
      // Keep only last 50 notifications
      if (this.notifications.length > 50) {
        this.notifications = this.notifications.slice(0, 50);
      }
      
      // Notify all listeners
      this.listeners.forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error('Error in notification listener:', error);
        }
      });
    });

    this.socket.on('connect_error', (error) => {
      console.error('WebSocket connection error:', error);
    });

    return this.socket;
  }

  joinUserRoom(userId) {
    if (this.socket && this.connected) {
      this.socket.emit('join-user', userId);
      console.log(`Joined user room: user-${userId}`);
    }
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.connected = false;
      this.listeners.clear();
      console.log('Socket disconnected');
    }
  }

  // Add a listener for new notifications
  onNotification(callback) {
    this.listeners.add(callback);
    
    // Return unsubscribe function
    return () => {
      this.listeners.delete(callback);
    };
  }

  // Get all stored notifications
  getNotifications() {
    return this.notifications;
  }

  // Clear all notifications
  clearNotifications() {
    this.notifications = [];
  }

  // Remove specific notification
  removeNotification(notificationId) {
    this.notifications = this.notifications.filter(n => n.id !== notificationId);
  }

  // Check if connected
  isConnected() {
    return this.connected;
  }
}

// Create a singleton instance
const socketService = new SocketService();

export default socketService;