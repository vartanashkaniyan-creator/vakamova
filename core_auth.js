
// ==================== CORE_AUTH.JS ====================
// Vakamova - Authentication Core Module
// Version: 1.0.0 | Professional Enterprise Edition
// Principles: DI, Contract, Event-Driven, Centralized Config

const AUTH_CONTRACT = {
    name: 'auth-module',
    version: '1.0.0',
    contractVersion: '1.0',
    dependencies: ['config', 'eventBus', 'security', 'logger', 'errorHandler'],
    methods: {
        init: 'function',
        signup: 'function',
        login: 'function',
        logout: 'function',
        getCurrentUser: 'function',
        isAuthenticated: 'function',
        refreshToken: 'function',
        updateProfile: 'function',
        validateToken: 'function',
        clearSession: 'function'
    },
    events: {
        AUTH_INIT: 'auth:init',
        AUTH_READY: 'auth:ready',
        USER_SIGNUP: 'auth:signup',
        USER_LOGIN: 'auth:login',
        USER_LOGOUT: 'auth:logout',
        TOKEN_REFRESHED: 'auth:token:refreshed',
        TOKEN_EXPIRED: 'auth:token:expired',
        PROFILE_UPDATED: 'auth:profile:updated',
        SESSION_CLEARED: 'auth:session:cleared',
        AUTH_ERROR: 'auth:error'
    },
    storageKeys: {
        TOKEN: 'vk_auth_token',
        REFRESH_TOKEN: 'vk_refresh_token',
        USER_DATA: 'vk_user_data',
        SESSION_ID: 'vk_session_id',
        LAST_ACTIVITY: 'vk_last_activity'
    }
};

class AuthModule {
    constructor(dependencies = {}) {
        // ============ DEPENDENCY INJECTION ============
        this._validateDependencies(dependencies);
        
        this.config = dependencies.config;
        this.eventBus = dependencies.eventBus;
        this.security = dependencies.security || this._createFallbackSecurity();
        this.logger = dependencies.logger || console;
        this.errorHandler = dependencies.errorHandler;
        this.database = dependencies.database;
        this.api = dependencies.api;
        
        // ============ MODULE STATE ============
        this._state = {
            isInitialized: false,
            currentUser: null,
            token: null,
            refreshToken: null,
            sessionId: null,
            lastActivity: null,
            tokenExpiry: null,
            refreshTimeout: null,
            pendingRequests: new Map()
        };
        
        // ============ EVENT BINDING ============
        this.EVENTS = AUTH_CONTRACT.events;
        this._bindEventListeners();
        
        // ============ METHOD BINDING ============
        this._bindMethods();
        
        // ============ SECURITY CONFIG ============
        this._securityConfig = {
            tokenExpiry: 3600, // 1 hour in seconds
            refreshThreshold: 300, // 5 minutes before expiry
            maxLoginAttempts: 5,
            lockoutDuration: 900, // 15 minutes
            passwordMinLength: 8,
            requireSpecialChars: true,
            requireNumbers: true,
            tokenEncryption: true
        };
        
        this.logger.info('[AuthModule] Initialized with contract:', AUTH_CONTRACT.name);
    }
    
    // ==================== CONTRACT METHODS ====================
    
    async init(options = {}) {
        try {
            if (this._state.isInitialized) {
                this.logger.warn('[AuthModule] Already initialized');
                return this._state;
            }
            
            this.eventBus.emit(this.EVENTS.AUTH_INIT, { timestamp: Date.now() });
            
            // Load saved session
            await this._loadPersistedSession();
            
            // Setup auto-refresh if token exists
            if (this._state.token) {
                this._setupTokenRefresh();
            }
            
            // Setup activity tracking
            this._setupActivityTracking();
            
            // Setup session timeout
            this._setupSessionTimeout();
            
            this._state.isInitialized = true;
            
            this.eventBus.emit(this.EVENTS.AUTH_READY, {
                hasUser: !!this._state.currentUser,
                hasToken: !!this._state.token,
                sessionId: this._state.sessionId
            });
            
            this.logger.info('[AuthModule] Initialization complete');
            return this._state;
            
        } catch (error) {
            this._handleError('init', error);
            throw error;
        }
    }
    
    async signup(userData) {
        const validationResult = this._validateSignupData(userData);
        if (!validationResult.valid) {
            throw new Error(`Signup validation failed: ${validationResult.errors.join(', ')}`);
        }
        
        try {
            // Hash password
            const hashedPassword = await this.security.hashPassword(userData.password);
            
            // Create user object
            const user = {
                id: this._generateUserId(),
                email: userData.email.toLowerCase().trim(),
                password: hashedPassword,
                username: userData.username || this._generateUsername(userData.email),
                firstName: userData.firstName || '',
                lastName: userData.lastName || '',
                avatar: userData.avatar || this._generateAvatar(userData.email),
                language: userData.language || this.config.defaultLanguage || 'en',
                level: 'beginner',
                streak: 0,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                settings: {
                    theme: 'auto',
                    notifications: true,
                    soundEnabled: true,
                    autoPlayAudio: true,
                    dailyGoal: 30
                },
                metadata: {
                    signupSource: userData.source || 'web',
                    ipAddress: userData.ip || '',
                    userAgent: navigator.userAgent
                }
            };
            
            // Save to database if available
            if (this.database) {
                await this.database.add('users', user);
            }
            
            // Send to server if API available
            if (this.api) {
                const response = await this.api.post('/auth/signup', {
                    ...user,
                    password: undefined // Don't send hashed password
                });
                
                if (response.token) {
                    await this._handleLoginResponse(response);
                }
            }
            
            this.eventBus.emit(this.EVENTS.USER_SIGNUP, {
                userId: user.id,
                email: user.email,
                timestamp: Date.now()
            });
            
            return {
                success: true,
                user: this._sanitizeUserData(user),
                message: 'Account created successfully'
            };
            
        } catch (error) {
            this._handleError('signup', error);
            throw error;
        }
    }
    
    async login(credentials) {
        this._validateLoginAttempt();
        
        try {
            let authResult;
            
            // Try local database first (offline mode)
            if (this.database && credentials.email) {
                const user = await this.database.get('users', credentials.email, { index: 'email' });
                if (user) {
                    const validPassword = await this.security.comparePassword(
                        credentials.password, 
                        user.password
                    );
                    
                    if (validPassword) {
                        authResult = {
                            user: this._sanitizeUserData(user),
                            token: await this.security.generateToken({
                                userId: user.id,
                                email: user.email
                            }),
                            refreshToken: await this.security.generateRefreshToken(user.id)
                        };
                    }
                }
            }
            
            // If no local auth or failed, try API
            if (!authResult && this.api) {
                authResult = await this.api.post('/auth/login', {
                    email: credentials.email,
                    password: credentials.password,
                    deviceInfo: this._getDeviceInfo()
                });
            }
            
            if (!authResult) {
                this._recordFailedAttempt();
                throw new Error('Invalid credentials');
            }
            
            // Process login
            await this._handleLoginResponse(authResult);
            
            this._resetLoginAttempts();
            
            this.eventBus.emit(this.EVENTS.USER_LOGIN, {
                userId: this._state.currentUser.id,
                email: this._state.currentUser.email,
                timestamp: Date.now(),
                source: this.api ? 'online' : 'offline'
            });
            
            return {
                success: true,
                user: this._state.currentUser,
                token: this._state.token,
                sessionId: this._state.sessionId
            };
            
        } catch (error) {
            this._handleError('login', error);
            throw error;
        }
    }
    
    async logout(options = {}) {
        const { clearLocal = true, notifyServer = true, reason = 'user_action' } = options;
        
        try {
            const oldUser = this._state.currentUser;
            const oldSessionId = this._state.sessionId;
            
            // Notify server if requested
            if (notifyServer && this.api && this._state.token) {
                try {
                    await this.api.post('/auth/logout', {
                        sessionId: this._state.sessionId,
                        reason
                    });
                } catch (error) {
                    this.logger.warn('[AuthModule] Server logout failed:', error);
                }
            }
            
            // Clear tokens and user data
            this._clearTokens();
            
            if (clearLocal) {
                this._clearLocalStorage();
            }
            
            // Clear timeouts
            this._clearTimeouts();
            
            // Reset state
            this._state.currentUser = null;
            this._state.token = null;
            this._state.refreshToken = null;
            this._state.sessionId = null;
            
            this.eventBus.emit(this.EVENTS.USER_LOGOUT, {
                userId: oldUser?.id,
                sessionId: oldSessionId,
                reason,
                timestamp: Date.now()
            });
            
            return { success: true, message: 'Logged out successfully' };
            
        } catch (error) {
            this._handleError('logout', error);
            throw error;
        }
    }
    
    getCurrentUser() {
        return this._state.currentUser ? { ...this._state.currentUser } : null;
    }
    
    isAuthenticated() {
        return !!this._state.currentUser && 
               !!this._state.token && 
               this._isTokenValid(this._state.token);
    }
    
    async refreshToken(force = false) {
        if (!this._state.refreshToken && !force) {
            throw new Error('No refresh token available');
        }
        
        try {
            let newTokens;
            
            if (this.api && this._state.refreshToken) {
                newTokens = await this.api.post('/auth/refresh', {
                    refreshToken: this._state.refreshToken,
                    sessionId: this._state.sessionId
                });
            } else if (force && this._state.currentUser) {
                // Generate new tokens locally
                newTokens = {
                    token: await this.security.generateToken({
                        userId: this._state.currentUser.id,
                        email: this._state.currentUser.email
                    }),
                    refreshToken: await this.security.generateRefreshToken(this._state.currentUser.id)
                };
            } else {
                throw new Error('Cannot refresh token');
            }
            
            // Update tokens
            this._state.token = newTokens.token;
            this._state.refreshToken = newTokens.refreshToken;
            
            // Save to storage
            this._saveTokens();
            
            // Reset refresh timer
            this._setupTokenRefresh();
            
            this.eventBus.emit(this.EVENTS.TOKEN_REFRESHED, {
                userId: this._state.currentUser?.id,
                timestamp: Date.now()
            });
            
            return newTokens.token;
            
        } catch (error) {
            this.eventBus.emit(this.EVENTS.TOKEN_EXPIRED);
            this._handleError('refreshToken', error);
            throw error;
        }
    }
    
    async updateProfile(updates) {
        if (!this._state.currentUser) {
            throw new Error('No authenticated user');
        }
        
        try {
            const userId = this._state.currentUser.id;
            const updatedUser = {
                ...this._state.currentUser,
                ...updates,
                updatedAt: new Date().toISOString()
            };
            
            // Update local database
            if (this.database) {
                await this.database.update('users', userId, updatedUser);
            }
            
            // Update server if online
            if (this.api) {
                await this.api.patch(`/users/${userId}`, updates);
            }
            
            // Update local state
            this._state.currentUser = updatedUser;
            this._saveUserData();
            
            this.eventBus.emit(this.EVENTS.PROFILE_UPDATED, {
                userId,
                updates: Object.keys(updates),
                timestamp: Date.now()
            });
            
            return this._sanitizeUserData(updatedUser);
            
        } catch (error) {
            this._handleError('updateProfile', error);
            throw error;
        }
    }
    
    async validateToken(token) {
        return this._isTokenValid(token);
    }
    
    async clearSession(options = {}) {
        await this.logout({
            clearLocal: true,
            notifyServer: false,
            reason: options.reason || 'session_clear'
        });
        
        this.eventBus.emit(this.EVENTS.SESSION_CLEARED, {
            reason: options.reason,
            timestamp: Date.now()
        });
        
        return { success: true };
    }
    
    // ==================== PRIVATE METHODS ====================
    
    _validateDependencies(deps) {
        const required = ['config', 'eventBus'];
        const missing = required.filter(key => !deps[key]);
        
        if (missing.length > 0) {
            throw new Error(`Missing required dependencies: ${missing.join(', ')}`);
        }
    }
    
    _bindEventListeners() {
        // Listen for token expiry events
        this.eventBus.on(this.EVENTS.TOKEN_EXPIRED, () => {
            this.logger.warn('[AuthModule] Token expired, attempting refresh...');
            this.refreshToken().catch(() => {
                this.logger.error('[AuthModule] Token refresh failed, logging out...');
                this.logout({ reason: 'token_expiry' });
            });
        });
        
        // Listen for network status changes
        if (window.addEventListener) {
            window.addEventListener('online', () => {
                this._handleNetworkChange(true);
            });
            
            window.addEventListener('offline', () => {
                this._handleNetworkChange(false);
            });
        }
    }
    
    _bindMethods() {
        const methods = [
            'init', 'signup', 'login', 'logout', 'getCurrentUser',
            'isAuthenticated', 'refreshToken', 'updateProfile',
            'validateToken', 'clearSession'
        ];
        
        methods.forEach(method => {
            this[method] = this[method].bind(this);
        });
    }
    
    _createFallbackSecurity() {
        return {
            hashPassword: async (password) => {
                const encoder = new TextEncoder();
                const data = encoder.encode(password + this.config.appSecret);
                const hash = await crypto.subtle.digest('SHA-256', data);
                return Array.from(new Uint8Array(hash))
                    .map(b => b.toString(16).padStart(2, '0'))
                    .join('');
            },
            
            comparePassword: async (password, hash) => {
                const newHash = await this.hashPassword(password);
                return newHash === hash;
            },
            
            generateToken: async (payload) => {
                const header = { alg: 'HS256', typ: 'JWT' };
                const encodedHeader = btoa(JSON.stringify(header));
                const encodedPayload = btoa(JSON.stringify({
                    ...payload,
                    iat: Math.floor(Date.now() / 1000),
                    exp: Math.floor(Date.now() / 1000) + this._securityConfig.tokenExpiry
                }));
                return `${encodedHeader}.${encodedPayload}.signature`;
            },
            
            generateRefreshToken: async (userId) => {
                const randomBytes = new Uint8Array(32);
                crypto.getRandomValues(randomBytes);
                return Array.from(randomBytes)
                    .map(b => b.toString(16).padStart(2, '0'))
                    .join('');
            },
            
            validateToken: async (token) => {
                try {
                    const parts = token.split('.');
                    if (parts.length !== 3) return false;
                    
                    const payload = JSON.parse(atob(parts[1]));
                    const now = Math.floor(Date.now() / 1000);
                    
                    return payload.exp > now;
                } catch {
                    return false;
                }
            }
        };
    }
    
    async _loadPersistedSession() {
        try {
            const token = localStorage.getItem(AUTH_CONTRACT.storageKeys.TOKEN);
            const userData = localStorage.getItem(AUTH_CONTRACT.storageKeys.USER_DATA);
            const refreshToken = localStorage.getItem(AUTH_CONTRACT.storageKeys.REFRESH_TOKEN);
            const sessionId = localStorage.getItem(AUTH_CONTRACT.storageKeys.SESSION_ID);
            
            if (token && userData) {
                const isValid = await this._isTokenValid(token);
                
                if (isValid) {
                    this._state.token = token;
                    this._state.refreshToken = refreshToken;
                    this._state.sessionId = sessionId || this._generateSessionId();
                    this._state.currentUser = JSON.parse(userData);
                    
                    this.logger.info('[AuthModule] Loaded persisted session');
                } else {
                    this._clearLocalStorage();
                    this.logger.warn('[AuthModule] Expired session cleared');
                }
            }
        } catch (error) {
            this.logger.error('[AuthModule] Failed to load session:', error);
            this._clearLocalStorage();
        }
    }
    
    async _handleLoginResponse(response) {
        this._state.token = response.token;
        this._state.refreshToken = response.refreshToken;
        this._state.currentUser = response.user;
        this._state.sessionId = this._generateSessionId();
        this._state.lastActivity = Date.now();
        
        await this._saveTokens();
        this._saveUserData();
        
        this._setupTokenRefresh();
    }
    
    _setupTokenRefresh() {
        if (this._state.refreshTimeout) {
            clearTimeout(this._state.refreshTimeout);
        }
        
        if (!this._state.token) return;
        
        // Calculate time until token expiry (minus threshold)
        const checkInterval = Math.max(
            60000, // 1 minute minimum
            (this._securityConfig.tokenExpiry - this._securityConfig.refreshThreshold) * 1000
        );
        
        this._state.refreshTimeout = setTimeout(() => {
            this.refreshToken().catch(() => {
                this.eventBus.emit(this.EVENTS.TOKEN_EXPIRED);
            });
        }, checkInterval);
    }
    
    _setupActivityTracking() {
        const activityEvents = ['mousedown', 'keydown', 'touchstart', 'scroll'];
        
        activityEvents.forEach(event => {
            document.addEventListener(event, () => {
                this._state.lastActivity = Date.now();
                localStorage.setItem(
                    AUTH_CONTRACT.storageKeys.LAST_ACTIVITY,
                    this._state.lastActivity.toString()
                );
            }, { passive: true });
        });
    }
    
    _setupSessionTimeout() {
        // Optional: Implement session timeout based on inactivity
        // This would require additional configuration
    }
    
    _saveTokens() {
        if (this._state.token) {
            localStorage.setItem(AUTH_CONTRACT.storageKeys.TOKEN, this._state.token);
        }
        
        if (this._state.refreshToken) {
            localStorage.setItem(AUTH_CONTRACT.storageKeys.REFRESH_TOKEN, this._state.refreshToken);
        }
        
        if (this._state.sessionId) {
            localStorage.setItem(AUTH_CONTRACT.storageKeys.SESSION_ID, this._state.sessionId);
        }
    }
    
    _saveUserData() {
        if (this._state.currentUser) {
            localStorage.setItem(
                AUTH_CONTRACT.storageKeys.USER_DATA,
                JSON.stringify(this._state.currentUser)
            );
        }
    }
    
    _clearTokens() {
        this._state.token = null;
        this._state.refreshToken = null;
        this._state.tokenExpiry = null;
    }
    
    _clearLocalStorage() {
        Object.values(AUTH_CONTRACT.storageKeys).forEach(key => {
            localStorage.removeItem(key);
        });
    }
    
    _clearTimeouts() {
        if (this._state.refreshTimeout) {
            clearTimeout(this._state.refreshTimeout);
            this._state.refreshTimeout = null;
        }
    }
    
    _validateSignupData(userData) {
        const errors = [];
        
        if (!userData.email || !this._isValidEmail(userData.email)) {
            errors.push('Invalid email address');
        }
        
        if (!userData.password || userData.password.length < this._securityConfig.passwordMinLength) {
            errors.push(`Password must be at least ${this._securityConfig.passwordMinLength} characters`);
        }
        
        if (this._securityConfig.requireSpecialChars && 
            !/[!@#$%^&*(),.?":{}|<>]/.test(userData.password)) {
            errors.push('Password must contain special characters');
        }
        
        if (this._securityConfig.requireNumbers && !/\d/.test(userData.password)) {
            errors.push('Password must contain numbers');
        }
        
        return {
            valid: errors.length === 0,
            errors
        };
    }
    
    _validateLoginAttempt() {
        const attempts = parseInt(localStorage.getItem('vk_login_attempts') || '0');
        const lastAttempt = parseInt(localStorage.getItem('vk_last_attempt') || '0');
        const now = Date.now();
        
        if (attempts >= this._securityConfig.maxLoginAttempts) {
            const timeSinceLockout = now - lastAttempt;
            if (timeSinceLockout < this._securityConfig.lockoutDuration * 1000) {
                const remaining = Math.ceil(
                    (this._securityConfig.lockoutDuration * 1000 - timeSinceLockout) / 1000 / 60
                );
                throw new Error(`Account locked. Try again in ${remaining} minutes.`);
            } else {
                // Reset after lockout duration
                localStorage.removeItem('vk_login_attempts');
                localStorage.removeItem('vk_last_attempt');
            }
        }
    }
    
    _recordFailedAttempt() {
        const attempts = parseInt(localStorage.getItem('vk_login_attempts') || '0') + 1;
        localStorage.setItem('vk_login_attempts', attempts.toString());
        localStorage.setItem('vk_last_attempt', Date.now().toString());
    }
    
    _resetLoginAttempts() {
        localStorage.removeItem('vk_login_attempts');
        localStorage.removeItem('vk_last_attempt');
    }
    
    async _isTokenValid(token) {
        if (!token) return false;
        
        try {
            if (this.security.validateToken) {
                return await this.security.validateToken(token);
            }
            
            const parts = token.split('.');
            if (parts.length !== 3) return false;
            
            const payload = JSON.parse(atob(parts[1]));
            const now = Math.floor(Date.now() / 1000);
            
            return payload.exp > now;
        } catch {
            return false;
        }
    }
    
    _handleError(context, error) {
        const errorData = {
            context,
            error: error.message,
            timestamp: Date.now(),
            userId: this._state.currentUser?.id,
            sessionId: this._state.sessionId
        };
        
        this.logger.error(`[AuthModule] Error in ${context}:`, error);
        
        if (this.errorHandler) {
            this.errorHandler.handle(errorData);
        }
        
        this.eventBus.emit(this.EVENTS.AUTH_ERROR, errorData);
    }
    
    _handleNetworkChange(isOnline) {
        this.logger.info(`[AuthModule] Network ${isOnline ? 'online' : 'offline'}`);
        
        if (isOnline && this._state.currentUser && this.api) {
            // Sync any pending changes when coming online
            this._syncPendingChanges();
        }
    }
    
    async _syncPendingChanges() {
        // Implement pending changes sync logic here
        // This would track local changes and sync when online
    }
    
    // ==================== UTILITY METHODS ====================
    
    _generateUserId() {
        return `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    
    _generateSessionId() {
        const bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        return Array.from(bytes)
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
    }
    
    _generateUsername(email) {
        return email.split('@')[0].replace(/[^a-zA-Z0-9]/g, '_');
    }
    
    _generateAvatar(email) {
        const colors = ['#FF6B6B', '#4ECDC4', '#FFD166', '#06D6A0', '#118AB2'];
        const color = colors[email.length % colors.length];
        const initial = email.charAt(0).toUpperCase();
        
        return `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="50" fill="${color}"/>
            <text x="50" y="65" font-size="40" text-anchor="middle" fill="white">${initial}</text>
        </svg>`;
    }
    
    _sanitizeUserData(user) {
        if (!user) return null;
        
        const { password, ...sanitized } = user;
        return sanitized;
    }
    
    _isValidEmail(email) {
        const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return re.test(email);
    }
    
    _getDeviceInfo() {
        return {
            userAgent: navigator.userAgent,
            platform: navigator.platform,
            language: navigator.language,
            screen: `${screen.width}x${screen.height}`,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            online: navigator.onLine
        };
    }
}

// ==================== EXPORT ====================
export { AuthModule as default, AUTH_CONTRACT };
