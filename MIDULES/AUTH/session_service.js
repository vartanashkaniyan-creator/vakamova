/**
 * VAKAMOVA SESSION SERVICE - مدیریت حرفه‌ای نشست کاربر
 * اصول: معماری حرفه‌ای، قرارداد رابط، ارتباط رویدادمحور، پیکربندی متمرکز
 * وابستگی‌ها: event_bus.js, state_manager.js, token_manager.js, auth_utils.js
 */

class SessionService {
    constructor(dependencies = {}) {
        // دریافت وابستگی‌ها با قرارداد رابط ثابت
        this._eventBus = dependencies.eventBus || window.eventBus;
        this._stateManager = dependencies.stateManager || null;
        this._tokenManager = dependencies.tokenManager || null;
        this._authUtils = dependencies.authUtils || null;
        
        // اعتبارسنجی وابستگی‌های ضروری
        this._validateDependencies();
        
        // پیکربندی متمرکز
        this._config = Object.freeze({
            sessionTimeout: 24 * 60 * 60 * 1000, // 24 ساعت
            refreshThreshold: 15 * 60 * 1000, // 15 دقیقه قبل از انقضا
            maxConcurrentSessions: 3,
            storageKey: 'vakamova_session',
            ...dependencies.config
        });
        
        // وضعیت داخلی
        this._currentSession = null;
        this._sessionTimer = null;
        this._isInitialized = false;
        
        // رجیستر کردن هندلرهای رویداد
        this._registerEventHandlers();
        
        // لود نشست موجود
        this._loadExistingSession();
        
        console.log('[SessionService] ✅ Initialized');
    }
    
    // ==================== CORE SESSION METHODS ====================
    
    async createSession(userData, tokenData, options = {}) {
        this._validateSessionCreation(userData, tokenData);
        
        const sessionId = this._generateSessionId();
        const now = Date.now();
        
        const session = {
            id: sessionId,
            userId: userData.id,
            userEmail: userData.email,
            userName: userData.name,
            createdAt: now,
            lastActivity: now,
            expiresAt: now + this._config.sessionTimeout,
            token: tokenData.accessToken,
            refreshToken: tokenData.refreshToken,
            deviceInfo: this._getDeviceInfo(),
            ipAddress: options.ipAddress || 'unknown',
            userAgent: navigator.userAgent,
            permissions: userData.permissions || [],
            metadata: options.metadata || {}
        };
        
        // بررسی محدودیت نشست همزمان
        await this._enforceSessionLimit(userData.id);
        
        // ذخیره در State Manager
        if (this._stateManager) {
            this._stateManager.set(`sessions.${sessionId}`, session);
            this._stateManager.set('auth.currentSessionId', sessionId);
        }
        
        // ذخیره در localStorage (فقط برای بازیابی)
        this._persistToStorage(session);
        
        // تنظیم تایمر انقضا
        this._setupSessionTimer(session);
        
        this._currentSession = session;
        
        // انتشار رویداد
        this._eventBus.emit('session:created', {
            sessionId,
            userId: userData.id,
            timestamp: now
        });
        
        // شروع مانیتورینگ فعالیت
        this._startActivityMonitoring();
        
        return session;
    }
    
    async getCurrentSession() {
        if (!this._currentSession && this._stateManager) {
            const sessionId = this._stateManager.get('auth.currentSessionId');
            if (sessionId) {
                this._currentSession = this._stateManager.get(`sessions.${sessionId}`);
            }
        }
        return this._currentSession ? { ...this._currentSession } : null;
    }
    
    async updateSessionActivity() {
        const session = await this.getCurrentSession();
        if (!session) return false;
        
        const now = Date.now();
        session.lastActivity = now;
        
        // خودکار تمدید اگر نزدیک انقضا
        if (now > session.expiresAt - this._config.refreshThreshold) {
            await this.refreshSession(session.id);
            return true;
        }
        
        // آپدیت در State
        if (this._stateManager) {
            this._stateManager.set(`sessions.${session.id}.lastActivity`, now);
        }
        
        // آپدیت در storage
        this._persistToStorage(session);
        
        this._eventBus.emit('session:activity_updated', {
            sessionId: session.id,
            lastActivity: now
        });
        
        return true;
    }
    
    async refreshSession(sessionId = null) {
        const session = sessionId 
            ? await this.getSessionById(sessionId)
            : await this.getCurrentSession();
        
        if (!session) {
            throw new Error('Session not found for refresh');
        }
        
        // استفاده از Token Manager برای رفرش
        if (this._tokenManager && session.refreshToken) {
            const newTokens = await this._tokenManager.refreshTokens(session.refreshToken);
            
            session.token = newTokens.accessToken;
            session.refreshToken = newTokens.refreshToken || session.refreshToken;
            session.expiresAt = Date.now() + this._config.sessionTimeout;
            
            // آپدیت session
            if (this._stateManager) {
                this._stateManager.set(`sessions.${session.id}`, session);
            }
            
            this._persistToStorage(session);
            
            // ریست تایمر
            this._setupSessionTimer(session);
            
            this._eventBus.emit('session:refreshed', {
                sessionId: session.id,
                newExpiresAt: session.expiresAt
            });
            
            return session;
        }
        
        throw new Error('Token manager not available or refresh token missing');
    }
    
    async terminateSession(sessionId = null, reason = 'user_logout') {
        const targetSessionId = sessionId || (this._currentSession?.id);
        
        if (!targetSessionId) return false;
        
        const session = await this.getSessionById(targetSessionId);
        
        // پاک کردن از State
        if (this._stateManager) {
            this._stateManager.delete(`sessions.${targetSessionId}`);
            
            // اگر سشن جاری بود، پاک کردن رفرنس
            if (this._currentSession?.id === targetSessionId) {
                this._stateManager.delete('auth.currentSessionId');
                this._currentSession = null;
            }
        }
        
        // پاک کردن از storage
        this._clearStorage();
        
        // لغو تایمرها
        this._clearTimers();
        
        // انتشار رویداد
        this._eventBus.emit('session:terminated', {
            sessionId: targetSessionId,
            userId: session?.userId,
            reason,
            timestamp: Date.now()
        });
        
        return true;
    }
    
    async terminateAllUserSessions(userId) {
        if (!this._stateManager) return 0;
        
        const allSessions = this._stateManager.get('sessions') || {};
        let terminatedCount = 0;
        
        for (const [sessionId, session] of Object.entries(allSessions)) {
            if (session.userId === userId) {
                await this.terminateSession(sessionId, 'admin_revoke');
                terminatedCount++;
            }
        }
        
        return terminatedCount;
    }
    
    // ==================== SESSION QUERY METHODS ====================
    
    async getSessionById(sessionId) {
        if (!this._stateManager) return null;
        
        const session = this._stateManager.get(`sessions.${sessionId}`);
        return session ? { ...session } : null;
    }
    
    async getUserSessions(userId) {
        if (!this._stateManager) return [];
        
        const allSessions = this._stateManager.get('sessions') || {};
        const userSessions = [];
        
        for (const [sessionId, session] of Object.entries(allSessions)) {
            if (session.userId === userId) {
                userSessions.push({ ...session, id: sessionId });
            }
        }
        
        return userSessions.sort((a, b) => b.lastActivity - a.lastActivity);
    }
    
    async getActiveSessions() {
        if (!this._stateManager) return [];
        
        const allSessions = this._stateManager.get('sessions') || {};
        const now = Date.now();
        const activeSessions = [];
        
        for (const [sessionId, session] of Object.entries(allSessions)) {
            if (session.expiresAt > now) {
                activeSessions.push({ ...session, id: sessionId });
            }
        }
        
        return activeSessions;
    }
    
    async validateSession(sessionId) {
        const session = await this.getSessionById(sessionId);
        if (!session) return { valid: false, reason: 'session_not_found' };
        
        const now = Date.now();
        
        if (now > session.expiresAt) {
            return { valid: false, reason: 'session_expired', expiresAt: session.expiresAt };
        }
        
        // بررسی فعالیت اخیر (اختیاری)
        const inactivityThreshold = 2 * 60 * 60 * 1000; // 2 ساعت
        if (now - session.lastActivity > inactivityThreshold) {
            return { valid: false, reason: 'session_inactive', lastActivity: session.lastActivity };
        }
        
        // اعتبارسنجی توکن با Token Manager
        if (this._tokenManager) {
            const tokenValid = await this._tokenManager.validateToken(session.token);
            if (!tokenValid) {
                return { valid: false, reason: 'invalid_token' };
            }
        }
        
        return { 
            valid: true, 
            session: { ...session },
            timeRemaining: session.expiresAt - now
        };
    }
    
    // ==================== SECURITY METHODS ====================
    
    async rotateSessionTokens(sessionId) {
        const session = await this.getSessionById(sessionId);
        if (!session) throw new Error('Session not found');
        
        // ایجاد توکن‌های جدید
        if (this._tokenManager) {
            const newTokens = await this._tokenManager.generateTokens({
                userId: session.userId,
                email: session.userEmail
            });
            
            session.token = newTokens.accessToken;
            session.refreshToken = newTokens.refreshToken;
            session.expiresAt = Date.now() + this._config.sessionTimeout;
            
            // آپدیت
            if (this._stateManager) {
                this._stateManager.set(`sessions.${sessionId}`, session);
            }
            
            this._persistToStorage(session);
            
            this._eventBus.emit('session:tokens_rotated', {
                sessionId,
                timestamp: Date.now()
            });
            
            return session;
        }
        
        throw new Error('Token manager not available');
    }
    
    async addSessionMetadata(sessionId, key, value) {
        const session = await this.getSessionById(sessionId);
        if (!session) throw new Error('Session not found');
        
        if (!session.metadata) {
            session.metadata = {};
        }
        
        session.metadata[key] = value;
        
        if (this._stateManager) {
            this._stateManager.set(`sessions.${sessionId}.metadata.${key}`, value);
        }
        
        this._persistToStorage(session);
        
        return true;
    }
    
    // ==================== EVENT HANDLERS ====================
    
    _registerEventHandlers() {
        // هندلر برای رفرش خودکار
        this._eventBus.on('token:refreshed', (data) => {
            if (this._currentSession && data.sessionId === this._currentSession.id) {
                this._currentSession.token = data.newAccessToken;
                this._persistToStorage(this._currentSession);
            }
        });
        
        // هندلر برای logout از دستگاه‌های دیگر
        this._eventBus.on('auth:force_logout', (data) => {
            if (this._currentSession && data.userId === this._currentSession.userId) {
                this.terminateSession(this._currentSession.id, 'force_logout_other_device');
            }
        });
        
        // هندلر برای تغییر پیکربندی
        this._eventBus.on('config:updated', (newConfig) => {
            if (newConfig.sessionTimeout) {
                this._config.sessionTimeout = newConfig.sessionTimeout;
            }
        });
    }
    
    // ==================== PRIVATE METHODS ====================
    
    _validateDependencies() {
        const required = ['_eventBus'];
        required.forEach(dep => {
            if (!this[dep]) {
                throw new Error(`Missing required dependency: ${dep.replace('_', '')}`);
            }
        });
    }
    
    _validateSessionCreation(userData, tokenData) {
        if (!userData || !userData.id || !userData.email) {
            throw new Error('Invalid user data for session creation');
        }
        
        if (!tokenData || !tokenData.accessToken) {
            throw new Error('Invalid token data for session creation');
        }
        
        if (this._authUtils) {
            const emailValid = this._authUtils.validateEmail(userData.email);
            if (!emailValid) {
                throw new Error('Invalid email format');
            }
        }
    }
    
    _generateSessionId() {
        const timestamp = Date.now().toString(36);
        const random = Math.random().toString(36).substr(2, 9);
        return `sess_${timestamp}_${random}`;
    }
    
    async _enforceSessionLimit(userId) {
        if (!this._stateManager) return;
        
        const userSessions = await this.getUserSessions(userId);
        
        if (userSessions.length >= this._config.maxConcurrentSessions) {
            // ترمیم قدیمی‌ترین سشن
            const oldestSession = userSessions[userSessions.length - 1];
            await this.terminateSession(oldestSession.id, 'session_limit_exceeded');
        }
    }
    
    _getDeviceInfo() {
        try {
            return {
                platform: navigator.platform,
                language: navigator.language,
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                screenResolution: `${window.screen.width}x${window.screen.height}`,
                deviceType: this._detectDeviceType()
            };
        } catch (error) {
            return { error: 'device_info_unavailable' };
        }
    }
    
    _detectDeviceType() {
        const userAgent = navigator.userAgent.toLowerCase();
        if (/mobile|android|iphone|ipad|ipod/.test(userAgent)) {
            return 'mobile';
        } else if (/tablet|ipad/.test(userAgent)) {
            return 'tablet';
        } else {
            return 'desktop';
        }
    }
    
    _persistToStorage(session) {
        try {
            const storageData = {
                sessionId: session.id,
                userId: session.userId,
                token: session.token,
                refreshToken: session.refreshToken,
                expiresAt: session.expiresAt,
                lastActivity: session.lastActivity,
                _version: '1.0',
                _timestamp: Date.now()
            };
            
            localStorage.setItem(this._config.storageKey, JSON.stringify(storageData));
        } catch (error) {
            console.warn('[SessionService] Failed to persist session to storage:', error);
        }
    }
    
    _loadExistingSession() {
        try {
            const stored = localStorage.getItem(this._config.storageKey);
            if (!stored) return;
            
            const data = JSON.parse(stored);
            
            // اعتبارسنجی داده‌های ذخیره شده
            if (!data.sessionId || !data.expiresAt || data.expiresAt < Date.now()) {
                this._clearStorage();
                return;
            }
            
            // اگر State Manager داریم، سشن رو لود کنیم
            if (this._stateManager) {
                this._stateManager.set('auth.currentSessionId', data.sessionId);
            }
            
            console.log('[SessionService] Loaded existing session from storage');
        } catch (error) {
            console.warn('[SessionService] Failed to load session from storage:', error);
            this._clearStorage();
        }
    }
    
    _clearStorage() {
        try {
            localStorage.removeItem(this._config.storageKey);
        } catch (error) {
            console.warn('[SessionService] Failed to clear storage:', error);
        }
    }
    
    _setupSessionTimer(session) {
        this._clearTimers();
        
        const timeUntilExpiry = session.expiresAt - Date.now();
        
        if (timeUntilExpiry > 0) {
            this._sessionTimer = setTimeout(() => {
                this._handleSessionExpiry(session.id);
            }, timeUntilExpiry);
        }
    }
    
    _clearTimers() {
        if (this._sessionTimer) {
            clearTimeout(this._sessionTimer);
            this._sessionTimer = null;
        }
    }
    
    async _handleSessionExpiry(sessionId) {
        console.log(`[SessionService] Session ${sessionId} expired`);
        
        await this.terminateSession(sessionId, 'session_expired');
        
        this._eventBus.emit('session:auto_expired', {
            sessionId,
            timestamp: Date.now()
        });
    }
    
    _startActivityMonitoring() {
        // رصد فعالیت کاربر (کلیک، اسکرول، تایپ)
        const activityEvents = ['click', 'mousemove', 'keydown', 'scroll', 'touchstart'];
        
        const updateActivity = () => {
            this.updateSessionActivity().catch(console.error);
        };
        
        // Debounce برای جلوگیری از فراخوانی مکرر
        let activityTimeout;
        const debouncedUpdate = () => {
            clearTimeout(activityTimeout);
            activityTimeout = setTimeout(updateActivity, 1000);
        };
        
        activityEvents.forEach(event => {
            window.addEventListener(event, debouncedUpdate, { passive: true });
        });
        
        // ذخیره رفرنس برای cleanup
        this._activityListeners = activityEvents;
    }
    
    // ==================== LIFECYCLE METHODS ====================
    
    async initialize() {
        if (this._isInitialized) return;
        
        // لود و اعتبارسنجی سشن موجود
        const currentSession = await this.getCurrentSession();
        if (currentSession) {
            const validation = await this.validateSession(currentSession.id);
            if (!validation.valid) {
                await this.terminateSession(currentSession.id, 'invalid_on_init');
            } else {
                this._currentSession = currentSession;
                this._setupSessionTimer(currentSession);
                this._startActivityMonitoring();
            }
        }
        
        this._isInitialized = true;
        console.log('[SessionService] 🚀 Fully initialized');
        
        this._eventBus.emit('session:service_ready');
    }
    
    async cleanup() {
        this._clearTimers();
        
        // حذف event listeners فعالیت
        if (this._activityListeners) {
            this._activityListeners.forEach(event => {
                window.removeEventListener(event, this._debouncedUpdate);
            });
        }
        
        this._isInitialized = false;
        console.log('[SessionService] 🧹 Cleaned up');
    }
    
    // ==================== UTILITY METHODS ====================
    
    getSessionStats() {
        if (!this._stateManager) return null;
        
        const allSessions = this._stateManager.get('sessions') || {};
        const now = Date.now();
        
        const stats = {
            totalSessions: Object.keys(allSessions).length,
            activeSessions: 0,
            expiredSessions: 0,
            usersWithSessions: new Set(),
            averageSessionDuration: 0
        };
        
        let totalDuration = 0;
        
        Object.values(allSessions).forEach(session => {
            stats.usersWithSessions.add(session.userId);
            
            if (session.expiresAt > now) {
                stats.activeSessions++;
            } else {
                stats.expiredSessions++;
            }
            
            totalDuration += (session.expiresAt - session.createdAt);
        });
        
        stats.usersWithSessions = stats.usersWithSessions.size;
        
        if (stats.totalSessions > 0) {
            stats.averageSessionDuration = totalDuration / stats.totalSessions;
        }
        
        return stats;
    }
    
    exportSessionData() {
        if (!this._stateManager) return null;
        
        const allSessions = this._stateManager.get('sessions') || {};
        return {
            exportDate: new Date().toISOString(),
            totalSessions: Object.keys(allSessions).length,
            sessions: Object.entries(allSessions).map(([id, session]) => ({
                id,
                ...session,
                token: '[REDACTED]',
                refreshToken: '[REDACTED]'
            }))
        };
    }
}

// Singleton export pattern
let sessionServiceInstance = null;

function createSessionService(dependencies = {}) {
    if (!sessionServiceInstance) {
        sessionServiceInstance = new SessionService(dependencies);
    }
    return sessionServiceInstance;
}

export { SessionService, createSessionService };
