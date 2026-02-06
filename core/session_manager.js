/**
 * core/session-manager.js
 * User session management with authentication state handling
 * 
 * Principles Applied:
 * - SRP: Single responsibility - manages user sessions only
 * - OCP: Extensible through event system without modifying core
 * - ISP: Small, focused interfaces for different session operations
 * - DIP: Depends on abstractions (EventBus, Storage) not implementations
 * - DRY: Reusable session operations and validation
 * - KISS: Simple session lifecycle management
 * - Testable: Mockable dependencies and pure validation functions
 */

// ============================================
// INTERFACES (Abstractions)
// ============================================

/**
 * @interface SessionStorage
 * Contract for session persistence
 */
class SessionStorage {
  /**
   * Save session data
   * @param {SessionData} sessionData
   * @returns {Promise<void>}
   */
  async save(sessionData) {
    throw new Error('save() must be implemented');
  }

  /**
   * Load session data
   * @returns {Promise<SessionData|null>}
   */
  async load() {
    throw new Error('load() must be implemented');
  }

  /**
   * Clear session data
   * @returns {Promise<void>}
   */
  async clear() {
    throw new Error('clear() must be implemented');
  }

  /**
   * Check if session exists
   * @returns {Promise<boolean>}
   */
  async exists() {
    throw new Error('exists() must be implemented');
  }
}

/**
 * @interface TokenProvider
 * Contract for token generation and validation
 */
class TokenProvider {
  /**
   * Generate new access token
   * @param {Object} payload - Token payload
   * @returns {Promise<string>}
   */
  async generateAccessToken(payload) {
    throw new Error('generateAccessToken() must be implemented');
  }

  /**
   * Generate new refresh token
   * @param {Object} payload - Token payload
   * @returns {Promise<string>}
   */
  async generateRefreshToken(payload) {
    throw new Error('generateRefreshToken() must be implemented');
  }

  /**
   * Validate token
   * @param {string} token
   * @returns {Promise<Object>} Decoded token payload
   */
  async validateToken(token) {
    throw new Error('validateToken() must be implemented');
  }

  /**
   * Refresh access token using refresh token
   * @param {string} refreshToken
   * @returns {Promise<{accessToken: string, refreshToken: string}>}
   */
  async refreshTokens(refreshToken) {
    throw new Error('refreshTokens() must be implemented');
  }
}

// ============================================
// TYPES
// ============================================

/**
 * @typedef {Object} SessionData
 * @property {string} userId - Unique user identifier
 * @property {string} accessToken - Current access token
 * @property {string} refreshToken - Current refresh token
 * @property {number} expiresAt - Token expiration timestamp
 * @property {Object} userData - Additional user information
 * @property {string} deviceId - Device identifier
 * @property {number} createdAt - Session creation timestamp
 * @property {number} lastActivityAt - Last activity timestamp
 */

/**
 * @typedef {Object} SessionConfig
 * @property {number} accessTokenTTL - Access token TTL in milliseconds
 * @property {number} refreshTokenTTL - Refresh token TTL in milliseconds
 * @property {number} sessionTimeout - Session timeout in milliseconds
 * @property {boolean} multiDeviceSupport - Allow multiple device sessions
 * @property {string[]} allowedOrigins - Allowed origins for session
 */

/**
 * @typedef {Object} LoginCredentials
 * @property {string} email
 * @property {string} password
 * @property {string} [deviceId] - Optional device identifier
 */

/**
 * @typedef {Object} SessionEvent
 * @property {string} type - Event type
 * @property {SessionData} [session] - Session data
 * @property {string} [userId] - User ID
 * @property {Error} [error] - Error if any
 */

// ============================================
// CORE SESSION MANAGER
// ============================================

/**
 * Core Session Manager Implementation
 */
class SessionManager {
  /**
   * @constructor
   * @param {Object} dependencies - Injected dependencies (DIP)
   * @param {EventBus} dependencies.eventBus - Event bus for communication
   * @param {SessionStorage} dependencies.storage - Session storage
   * @param {TokenProvider} dependencies.tokenProvider - Token provider
   * @param {SessionConfig} [config] - Session configuration
   */
  constructor(dependencies, config = {}) {
    /** @private @type {EventBus} */
    this.eventBus = dependencies.eventBus;

    /** @private @type {SessionStorage} */
    this.storage = dependencies.storage;

    /** @private @type {TokenProvider} */
    this.tokenProvider = dependencies.tokenProvider;

    /** @private @type {SessionConfig} */
    this.config = {
      accessTokenTTL: config.accessTokenTTL || 15 * 60 * 1000, // 15 minutes
      refreshTokenTTL: config.refreshTokenTTL || 7 * 24 * 60 * 60 * 1000, // 7 days
      sessionTimeout: config.sessionTimeout || 30 * 60 * 1000, // 30 minutes
      multiDeviceSupport: config.multiDeviceSupport || false,
      allowedOrigins: config.allowedOrigins || ['*'],
      ...config
    };

    /** @private @type {SessionData|null} */
    this.currentSession = null;

    /** @private */
    this.activityTimer = null;

    /** @private */
    this.tokenRefreshTimer = null;

    /** @private */
    this.isInitialized = false;

    // Bind methods to maintain context
    this.handleUserActivity = this.handleUserActivity.bind(this);
    this.refreshAccessToken = this.refreshAccessToken.bind(this);
  }

  // ============================================
  // PUBLIC API
  // ============================================

  /**
   * Initialize session manager
   * @returns {Promise<boolean>} True if session was restored
   */
  async initialize() {
    if (this.isInitialized) {
      return false;
    }

    try {
      // Try to restore existing session
      const restored = await this.restoreSession();
      
      if (restored) {
        await this.startSessionMonitoring();
        await this.emitSessionEvent('SESSION_RESTORED', this.currentSession);
      }

      this.isInitialized = true;
      return restored;
    } catch (error) {
      console.error('Failed to initialize session manager:', error);
      await this.emitSessionEvent('SESSION_INIT_FAILED', null, error);
      return false;
    }
  }

  /**
   * Login user and create new session
   * @param {LoginCredentials} credentials
   * @returns {Promise<SessionData>}
   */
  async login(credentials) {
    try {
      // Validate credentials
      this.validateCredentials(credentials);

      // In real implementation, validate with backend
      // For now, generate mock tokens
      const tokenPayload = {
        userId: `user_${Date.now()}`,
        email: credentials.email,
        deviceId: credentials.deviceId || this.generateDeviceId()
      };

      // Generate tokens
      const [accessToken, refreshToken] = await Promise.all([
        this.tokenProvider.generateAccessToken(tokenPayload),
        this.tokenProvider.generateRefreshToken(tokenPayload)
      ]);

      // Create session data
      const now = Date.now();
      const sessionData = {
        userId: tokenPayload.userId,
        accessToken,
        refreshToken,
        expiresAt: now + this.config.accessTokenTTL,
        userData: {
          email: credentials.email,
          name: credentials.email.split('@')[0] // Mock name
        },
        deviceId: tokenPayload.deviceId,
        createdAt: now,
        lastActivityAt: now
      };

      // Save session
      await this.storage.save(sessionData);
      this.currentSession = sessionData;

      // Start monitoring
      await this.startSessionMonitoring();

      // Emit events
      await this.emitSessionEvent('SESSION_CREATED', sessionData);
      await this.emitSessionEvent('USER_LOGGED_IN', sessionData);

      return sessionData;
    } catch (error) {
      await this.emitSessionEvent('LOGIN_FAILED', null, error);
      throw error;
    }
  }

  /**
   * Logout user and clear session
   * @returns {Promise<void>}
   */
  async logout() {
    if (!this.currentSession) {
      return;
    }

    try {
      const sessionData = this.currentSession;

      // Clear session
      await this.storage.clear();
      this.currentSession = null;

      // Stop monitoring
      this.stopSessionMonitoring();

      // Emit events
      await this.emitSessionEvent('SESSION_DESTROYED', sessionData);
      await this.emitSessionEvent('USER_LOGGED_OUT', sessionData);
    } catch (error) {
      await this.emitSessionEvent('LOGOUT_FAILED', null, error);
      throw error;
    }
  }

  /**
   * Get current session
   * @returns {SessionData|null}
   */
  getCurrentSession() {
    return this.currentSession ? { ...this.currentSession } : null;
  }

  /**
   * Check if user is authenticated
   * @returns {boolean}
   */
  isAuthenticated() {
    return !!this.currentSession && !this.isSessionExpired();
  }

  /**
   * Get access token
   * @returns {string|null}
   */
  getAccessToken() {
    return this.currentSession?.accessToken || null;
  }

  /**
   * Refresh access token
   * @returns {Promise<SessionData>}
   */
  async refreshAccessToken() {
    if (!this.currentSession?.refreshToken) {
      throw new Error('No refresh token available');
    }

    try {
      const newTokens = await this.tokenProvider.refreshTokens(
        this.currentSession.refreshToken
      );

      const updatedSession = {
        ...this.currentSession,
        accessToken: newTokens.accessToken,
        refreshToken: newTokens.refreshToken || this.currentSession.refreshToken,
        expiresAt: Date.now() + this.config.accessTokenTTL,
        lastActivityAt: Date.now()
      };

      await this.storage.save(updatedSession);
      this.currentSession = updatedSession;

      await this.emitSessionEvent('TOKEN_REFRESHED', updatedSession);

      return updatedSession;
    } catch (error) {
      await this.emitSessionEvent('TOKEN_REFRESH_FAILED', null, error);
      
      // If refresh failed, logout user
      if (error.message.includes('invalid') || error.message.includes('expired')) {
        await this.logout();
      }
      
      throw error;
    }
  }

  /**
   * Handle user activity to prevent session timeout
   */
  handleUserActivity() {
    if (!this.currentSession) {
      return;
    }

    this.currentSession.lastActivityAt = Date.now();
    
    // Reset session timeout timer
    if (this.activityTimer) {
      clearTimeout(this.activityTimer);
    }
    
    this.activityTimer = setTimeout(() => {
      this.handleSessionTimeout();
    }, this.config.sessionTimeout);
  }

  // ============================================
  // PRIVATE METHODS
  // ============================================

  /** @private */
  async restoreSession() {
    try {
      const sessionData = await this.storage.load();
      
      if (!sessionData) {
        return false;
      }

      // Validate session
      if (this.isSessionExpired(sessionData)) {
        await this.storage.clear();
        return false;
      }

      this.currentSession = sessionData;
      return true;
    } catch (error) {
      console.error('Failed to restore session:', error);
      return false;
    }
  }

  /** @private */
  async startSessionMonitoring() {
    // Start session timeout monitoring
    this.handleUserActivity();

    // Start token refresh monitoring
    if (this.tokenRefreshTimer) {
      clearInterval(this.tokenRefreshTimer);
    }

    this.tokenRefreshTimer = setInterval(async () => {
      if (this.currentSession && this.isTokenExpiringSoon()) {
        try {
          await this.refreshAccessToken();
        } catch (error) {
          console.warn('Auto token refresh failed:', error);
        }
      }
    }, 60000); // Check every minute
  }

  /** @private */
  stopSessionMonitoring() {
    if (this.activityTimer) {
      clearTimeout(this.activityTimer);
      this.activityTimer = null;
    }

    if (this.tokenRefreshTimer) {
      clearInterval(this.tokenRefreshTimer);
      this.tokenRefreshTimer = null;
    }
  }

  /** @private */
  isSessionExpired(session = this.currentSession) {
    if (!session) {
      return true;
    }

    const now = Date.now();
    
    // Check token expiration
    if (now >= session.expiresAt) {
      return true;
    }

    // Check session timeout
    if (now - session.lastActivityAt >= this.config.sessionTimeout) {
      return true;
    }

    return false;
  }

  /** @private */
  isTokenExpiringSoon(session = this.currentSession) {
    if (!session) {
      return false;
    }

    const now = Date.now();
    const expiresAt = session.expiresAt;
    const refreshThreshold = this.config.accessTokenTTL * 0.2; // Refresh when 20% of TTL remains

    return (expiresAt - now) <= refreshThreshold;
  }

  /** @private */
  async handleSessionTimeout() {
    if (!this.currentSession) {
      return;
    }

    await this.emitSessionEvent('SESSION_TIMEOUT_WARNING', this.currentSession);
    
    // Give user chance to continue session
    setTimeout(async () => {
      if (this.isSessionExpired()) {
        await this.logout();
        await this.emitSessionEvent('SESSION_EXPIRED', this.currentSession);
      }
    }, 30000); // 30 second grace period
  }

  /** @private */
  validateCredentials(credentials) {
    if (!credentials.email || !credentials.email.includes('@')) {
      throw new Error('Invalid email address');
    }

    if (!credentials.password || credentials.password.length < 6) {
      throw new Error('Password must be at least 6 characters');
    }
  }

  /** @private */
  generateDeviceId() {
    return `device_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /** @private */
  async emitSessionEvent(type, session = null, error = null) {
    const event = {
      type,
      session,
      userId: session?.userId,
      error,
      timestamp: Date.now()
    };

    await this.eventBus.publish(`session.${type.toLowerCase()}`, event);
  }
}

// ============================================
// STORAGE IMPLEMENTATIONS (ISP: Small implementations)
// ============================================

/**
 * Local Storage implementation for web
 */
class LocalSessionStorage extends SessionStorage {
  constructor(storageKey = 'vakamova_session') {
    super();
    this.storageKey = storageKey;
  }

  async save(sessionData) {
    localStorage.setItem(this.storageKey, JSON.stringify(sessionData));
  }

  async load() {
    const data = localStorage.getItem(this.storageKey);
    return data ? JSON.parse(data) : null;
  }

  async clear() {
    localStorage.removeItem(this.storageKey);
  }

  async exists() {
    return localStorage.getItem(this.storageKey) !== null;
  }
}

/**
 * Secure Storage implementation for mobile (mock)
 */
class SecureSessionStorage extends SessionStorage {
  constructor() {
    super();
    this.storage = new Map();
  }

  async save(sessionData) {
    this.storage.set('session', sessionData);
  }

  async load() {
    return this.storage.get('session') || null;
  }

  async clear() {
    this.storage.delete('session');
  }

  async exists() {
    return this.storage.has('session');
  }
}

// ============================================
// TOKEN PROVIDER IMPLEMENTATIONS
// ============================================

/**
 * Mock Token Provider for development
 */
class MockTokenProvider extends TokenProvider {
  constructor() {
    super();
    this.tokenSecrets = new Map();
  }

  async generateAccessToken(payload) {
    const token = `mock_access_${Date.now()}_${Math.random().toString(36).substr(2)}`;
    this.tokenSecrets.set(token, { ...payload, type: 'access' });
    return token;
  }

  async generateRefreshToken(payload) {
    const token = `mock_refresh_${Date.now()}_${Math.random().toString(36).substr(2)}`;
    this.tokenSecrets.set(token, { ...payload, type: 'refresh' });
    return token;
  }

  async validateToken(token) {
    const payload = this.tokenSecrets.get(token);
    if (!payload) {
      throw new Error('Invalid token');
    }
    return payload;
  }

  async refreshTokens(refreshToken) {
    const payload = await this.validateToken(refreshToken);
    if (payload.type !== 'refresh') {
      throw new Error('Not a refresh token');
    }

    const [newAccessToken, newRefreshToken] = await Promise.all([
      this.generateAccessToken(payload),
      this.generateRefreshToken(payload)
    ]);

    this.tokenSecrets.delete(refreshToken);

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken
    };
  }
}

// ============================================
// SESSION LISTENER (Example of OCP extension)
// ============================================

/**
 * Session Event Listener for analytics
 */
class SessionAnalyticsListener {
  constructor(analyticsService) {
    this.analyticsService = analyticsService;
  }

  async handleEvent(eventType, eventData) {
    switch (eventType) {
      case 'session.user_logged_in':
        await this.analyticsService.track('login', {
          userId: eventData.session.userId,
          method: 'email'
        });
        break;

      case 'session.user_logged_out':
        await this.analyticsService.track('logout', {
          userId: eventData.session?.userId
        });
        break;

      case 'session.session_expired':
        await this.analyticsService.track('session_expired', {
          userId: eventData.session?.userId
        });
        break;
    }
  }
}

// ============================================
// FACTORY FUNCTIONS (DIP)
// ============================================

/**
 * Create session manager for web environment
 * @param {EventBus} eventBus
 * @param {SessionConfig} config
 * @returns {SessionManager}
 */
export function createWebSessionManager(eventBus, config = {}) {
  const dependencies = {
    eventBus,
    storage: new LocalSessionStorage(),
    tokenProvider: new MockTokenProvider()
  };

  return new SessionManager(dependencies, config);
}

/**
 * Create session manager for mobile environment
 * @param {EventBus} eventBus
 * @param {SessionConfig} config
 * @returns {SessionManager}
 */
export function createMobileSessionManager(eventBus, config = {}) {
  const dependencies = {
    eventBus,
    storage: new SecureSessionStorage(),
    tokenProvider: new MockTokenProvider()
  };

  return new SessionManager(dependencies, config);
}

// ============================================
// DEFAULT CONFIGURATIONS
// ============================================

/**
 * Default session configuration
 */
export const DEFAULT_SESSION_CONFIG = {
  accessTokenTTL: 15 * 60 * 1000, // 15 minutes
  refreshTokenTTL: 7 * 24 * 60 * 60 * 1000, // 7 days
  sessionTimeout: 30 * 60 * 1000, // 30 minutes
  multiDeviceSupport: false,
  allowedOrigins: ['*'],
  autoRefresh: true,
  secureCookies: process.env.NODE_ENV === 'production'
};

// ============================================
// EXPORTS
// ============================================

export {
  SessionManager,
  SessionStorage,
  TokenProvider,
  LocalSessionStorage,
  SecureSessionStorage,
  MockTokenProvider,
  SessionAnalyticsListener
};
