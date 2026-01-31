
/**
 * VAKAMOVA AUTH ANALYTICS - سیستم تحلیل‌گرایانه پیشرفته احراز هویت
 * اصول: تزریق وابستگی، قرارداد رابط، رویداد محور، پیکربندی متمرکز
 * وابستگی‌های داخلی: event_bus.js, session_service.js
 */

class VakamovaAuthAnalytics {
    constructor(dependencies = {}) {
        // ==================== تزریق وابستگی‌ها ====================
        this._services = {
            events: dependencies.eventBus || window.eventBus,
            session: dependencies.sessionService || window.sessionService
        };
        
        // اعتبارسنجی وابستگی‌های ضروری
        this._validateDependencies();
        
        // ==================== پیکربندی متمرکز ====================
        this._config = Object.freeze({
            // تنظیمات جمع‌آوری
            enabled: true,
            autoTrack: true,
            anonymizeData: false,
            
            // تنظیمات batch
            batchSize: 10,
            flushInterval: 30000, // 30 ثانیه
            maxQueueSize: 100,
            
            // تنظیمات ذخیره‌سازی
            storageKey: 'vakamova_auth_analytics',
            maxStorageAge: 604800000, // 7 روز
            enableLocalStorage: true,
            
            // تنظیمات امنیتی
            maskIP: true,
            excludeSensitiveFields: true,
            
            // تنظیمات تشخیص ناهنجاری
            anomalyDetection: {
                failedLoginThreshold: 5,
                timeWindow: 300000, // 5 دقیقه
                suspiciousLocationChange: true,
                deviceFingerprinting: true
            },
            
            // endpointهای ارسال (قابل تنظیم)
            endpoints: {
                track: '/api/analytics/auth/track',
                batch: '/api/analytics/auth/batch',
                anomaly: '/api/analytics/auth/anomaly'
            },
            
            // callbackهای سفارشی
            onBeforeSend: null,
            onAfterSend: null,
            onAnomalyDetected: null,
            
            ...dependencies.config
        });
        
        // ==================== وضعیت داخلی ====================
        this._queue = [];
        this._processing = false;
        this._flushTimer = null;
        this._metrics = {
            eventsTracked: 0,
            batchesSent: 0,
            anomaliesDetected: 0,
            storageUsage: 0,
            lastFlush: null
        };
        
        // ==================== fingerprint دستگاه ====================
        this._deviceFingerprint = this._generateDeviceFingerprint();
        this._sessionFingerprint = this._generateSessionFingerprint();
        
        // ==================== تشخیص ناهنجاری ====================
        this._anomalyState = {
            failedLogins: [],
            suspiciousActivities: [],
            lastKnownLocation: null,
            deviceHistory: new Set()
        };
        
        // ==================== راه‌اندازی ====================
        this._initialize();
        this._setupEventListeners();
        this._loadPendingEvents();
        this._startFlushTimer();
        
        Object.seal(this._metrics);
        Object.seal(this);
        
        console.log('[AuthAnalytics] ✅ سیستم تحلیل‌گرایانه راه‌اندازی شد');
    }
    
    // ==================== قرارداد رابط اصلی ====================
    
    async track(eventType, properties = {}, options = {}) {
        if (!this._config.enabled) {
            return { success: false, reason: 'DISABLED' };
        }
        
        try {
            // ساخت payload رویداد
            const event = await this._buildEvent(eventType, properties, options);
            
            // تشخیص ناهنجاری
            const anomalyCheck = await this._checkForAnomalies(event);
            if (anomalyCheck.isAnomaly) {
                await this._handleAnomaly(event, anomalyCheck);
            }
            
            // پردازش داخلی
            this._processEventInternally(event);
            
            // اضافه به صف
            const queueResult = await this._addToQueue(event);
            
            // ارسال real-time اگر critical باشد
            if (options.priority === 'critical' || eventType === 'security_alert') {
                await this._sendImmediately(event);
            }
            
            // انتشار رویداد داخلی
            this._services.events.emit('analytics:auth:tracked', {
                eventType,
                eventId: event.id,
                timestamp: event.timestamp
            });
            
            this._metrics.eventsTracked++;
            
            return {
                success: true,
                eventId: event.id,
                queued: queueResult.queued,
                anomaly: anomalyCheck.isAnomaly,
                nextFlush: this._getNextFlushTime()
            };
            
        } catch (error) {
            console.error('[AuthAnalytics] خطا در ثبت رویداد:', error);
            
            // fallback: ذخیره در localStorage
            if (this._config.enableLocalStorage) {
                this._storeEventFallback({ eventType, properties, error: error.message });
            }
            
            return {
                success: false,
                error: error.message,
                storedLocally: this._config.enableLocalStorage
            };
        }
    }
    
    async trackLogin(success, metadata = {}) {
        const properties = {
            success,
            method: metadata.method || 'password',
            provider: metadata.provider || 'local',
            twoFactorEnabled: metadata.twoFactorEnabled || false,
            loginDuration: metadata.duration || 0,
            ...metadata
        };
        
        const eventType = success ? 'login_success' : 'login_failed';
        
        // ثبت در state تشخیص ناهنجاری
        if (!success) {
            this._anomalyState.failedLogins.push({
                timestamp: Date.now(),
                reason: metadata.reason,
                ip: metadata.ip
            });
            
            // پاکسازی لاگ‌های قدیمی
            this._cleanupOldFailedLogins();
        }
        
        return this.track(eventType, properties, {
            priority: 'high',
            immediate: success // ورود موفق بلافاصله ارسال شود
        });
    }
    
    async trackLogout(reason = 'user_initiated', metadata = {}) {
        // دریافت اطلاعات session قبل از logout
        let sessionInfo = {};
        try {
            if (this._services.session.getSessionInfo) {
                sessionInfo = await this._services.session.getSessionInfo();
            }
        } catch (error) {
            console.warn('[AuthAnalytics] خطا در دریافت اطلاعات session:', error);
        }
        
        const properties = {
            reason,
            sessionDuration: sessionInfo.duration || 0,
            activitiesPerformed: sessionInfo.activityCount || 0,
            lastActivity: sessionInfo.lastActivity || null,
            ...metadata
        };
        
        return this.track('logout', properties, { priority: 'medium' });
    }
    
    async trackRegistration(metadata = {}) {
        const properties = {
            method: metadata.method || 'email',
            source: metadata.source || 'direct',
            referralCode: metadata.referralCode || null,
            userData: this._anonymizeUserData(metadata.userData || {}),
            ...metadata
        };
        
        // حذف فیلدهای حساس
        if (this._config.excludeSensitiveFields) {
            delete properties.userData.password;
            delete properties.userData.creditCard;
            delete properties.userData.ssn;
        }
        
        return this.track('registration', properties, {
            priority: 'high',
            immediate: true // ثبت‌نام همیشه مهم است
        });
    }
    
    async trackPasswordChange(metadata = {}) {
        return this.track('password_change', {
            triggeredBy: metadata.triggeredBy || 'user',
            twoFactorVerified: metadata.twoFactorVerified || false,
            ...metadata
        }, { priority: 'medium' });
    }
    
    // ==================== مدیریت سیستم ====================
    
    async flush(force = false) {
        if (this._processing && !force) {
            console.log('[AuthAnalytics] پردازش در حال انجام است');
            return { success: false, reason: 'PROCESSING' };
        }
        
        if (this._queue.length === 0) {
            return { success: true, message: 'صف خالی است' };
        }
        
        this._processing = true;
        
        try {
            // جدا کردن batch
            const batchSize = Math.min(this._config.batchSize, this._queue.length);
            const batch = this._queue.splice(0, batchSize);
            
            // ارسال batch
            const result = await this._sendBatch(batch);
            
            // به‌روزرسانی متریک‌ها
            this._metrics.batchesSent++;
            this._metrics.lastFlush = Date.now();
            
            // پاکسازی ذخیره‌سازی
            this._cleanupStorage(batch);
            
            // انتشار رویداد
            this._services.events.emit('analytics:auth:flushed', {
                batchSize: batch.length,
                success: result.success,
                timestamp: Date.now()
            });
            
            return {
                success: true,
                batchSize: batch.length,
                sent: result.sent || 0,
                failed: result.failed || 0,
                nextBatch: this._queue.length
            };
            
        } catch (error) {
            console.error('[AuthAnalytics] خطا در ارسال batch:', error);
            
            // بازگرداندن events به صف
            this._queue.unshift(...batch);
            
            return {
                success: false,
                error: error.message,
                requeued: batch.length
            };
            
        } finally {
            this._processing = false;
            
            // restart تایمر
            this._startFlushTimer();
        }
    }
    
    getMetrics() {
        return {
            ...this._metrics,
            queueSize: this._queue.length,
            isProcessing: this._processing,
            deviceFingerprint: this._deviceFingerprint,
            anomalyState: {
                recentFailedLogins: this._anomalyState.failedLogins.length,
                suspiciousActivities: this._anomalyState.suspiciousActivities.length
            }
        };
    }
    
    clearQueue() {
        const clearedCount = this._queue.length;
        this._queue = [];
        
        // پاکسازی localStorage
        if (this._config.enableLocalStorage) {
            localStorage.removeItem(this._config.storageKey);
        }
        
        this._services.events.emit('analytics:auth:queue_cleared', {
            count: clearedCount,
            timestamp: Date.now()
        });
        
        return { success: true, cleared: clearedCount };
    }
    
    updateConfig(newConfig) {
        const oldConfig = { ...this._config };
        
        // به‌روزرسانی config (فقط فیلدهای مجاز)
        Object.keys(newConfig).forEach(key => {
            if (key !== 'config' && this._config.hasOwnProperty(key)) {
                this._config[key] = newConfig[key];
            }
        });
        
        // restart تایمر اگر interval تغییر کرده
        if (newConfig.flushInterval !== oldConfig.flushInterval) {
            this._stopFlushTimer();
            this._startFlushTimer();
        }
        
        this._services.events.emit('analytics:auth:config_updated', {
            oldConfig,
            newConfig: this._config
        });
        
        return { success: true, updatedFields: Object.keys(newConfig) };
    }
    
    enable() {
        this._config.enabled = true;
        this._startFlushTimer();
        return { success: true, enabled: true };
    }
    
    disable() {
        this._config.enabled = false;
        this._stopFlushTimer();
        
        // flush صف قبل از غیرفعال کردن
        if (this._queue.length > 0) {
            this.flush(true);
        }
        
        return { success: true, enabled: false };
    }
    
    // ==================== Private Methods ====================
    
    _validateDependencies() {
        if (!this._services.events) {
            throw new Error('EventBus برای AuthAnalytics ضروری است');
        }
        
        if (!this._services.session) {
            console.warn('[AuthAnalytics] SessionService موجود نیست، برخی قابلیت‌ها محدود خواهند شد');
        }
    }
    
    _initialize() {
        // ثبت در eventBus برای رویدادهای سیستمی
        this._services.events.on('auth:*', (data, event) => {
            if (this._config.autoTrack) {
                this._handleAuthEvent(event.name, data);
            }
        });
        
        // گوش دادن به رویدادهای شبکه
        window.addEventListener('online', () => {
            if (this._queue.length > 0) {
                this.flush();
            }
        });
        
        window.addEventListener('offline', () => {
            console.log('[AuthAnalytics] دستگاه آفلاین شد، events ذخیره می‌شوند');
        });
        
        // ثبت service در scope جهانی (برای دیباگ)
        window.__vakamovaAuthAnalytics = this;
    }
    
    _setupEventListeners() {
        // رویدادهای auth از eventBus
        const authEvents = [
            'auth:login',
            'auth:logout', 
            'auth:register',
            'auth:password_change',
            'auth:two_factor',
            'auth:session_expired',
            'auth:security_alert'
        ];
        
        authEvents.forEach(eventName => {
            this._services.events.on(eventName, (data) => {
                this._handleAuthEvent(eventName, data);
            });
        });
    }
    
    async _handleAuthEvent(eventName, data) {
        const eventMap = {
            'auth:login': () => this.trackLogin(data.success, data),
            'auth:logout': () => this.trackLogout(data.reason, data),
            'auth:register': () => this.trackRegistration(data),
            'auth:password_change': () => this.trackPasswordChange(data),
            'auth:security_alert': () => this.track('security_alert', data, { priority: 'critical' })
        };
        
        const handler = eventMap[eventName];
        if (handler) {
            try {
                await handler();
            } catch (error) {
                console.error(`[AuthAnalytics] خطا در پردازش رویداد ${eventName}:`, error);
            }
        }
    }
    
    async _buildEvent(eventType, properties, options) {
        // اطلاعات پایه
        const baseEvent = {
            id: this._generateEventId(),
            type: eventType,
            timestamp: Date.now(),
            timestampISO: new Date().toISOString(),
            version: '1.0.0',
            
            // اطلاعات جلسه
            sessionId: await this._getSessionId(),
            deviceFingerprint: this._deviceFingerprint,
            sessionFingerprint: this._sessionFingerprint,
            
            // اطلاعات محیطی
            userAgent: navigator.userAgent,
            language: navigator.language,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            screenResolution: `${window.screen.width}x${window.screen.height}`,
            viewport: `${window.innerWidth}x${window.innerHeight}`,
            
            // اطلاعات شبکه
            online: navigator.onLine,
            connectionType: navigator.connection ? navigator.connection.effectiveType : 'unknown',
            
            // اطلاعات جغرافیایی (در صورت دسترسی)
            location: await this._getLocationInfo(),
            
            // properties اصلی
            properties: this._sanitizeProperties(properties),
            
            // metadata
            _metadata: {
                source: 'auth_analytics',
                priority: options.priority || 'normal',
                retryCount: 0
            }
        };
        
        // اجرای callback قبل از ارسال
        if (typeof this._config.onBeforeSend === 'function') {
            const modified = await this._config.onBeforeSend(baseEvent);
            if (modified) {
                Object.assign(baseEvent, modified);
            }
        }
        
        return baseEvent;
    }
    
    _generateEventId() {
        return `auth_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    
    async _getSessionId() {
        try {
            if (this._services.session && this._services.session.getSessionId) {
                return await this._services.session.getSessionId();
            }
        } catch (error) {
            // ignore
        }
        
        // fallback: ایجاد session ID موقت
        const storageKey = 'vakamova_analytics_session';
        let sessionId = localStorage.getItem(storageKey);
        
        if (!sessionId) {
            sessionId = `sess_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            localStorage.setItem(storageKey, sessionId);
        }
        
        return sessionId;
    }
    
    _generateDeviceFingerprint() {
        try {
            const components = [
                navigator.userAgent,
                navigator.language,
                navigator.hardwareConcurrency || 'unknown',
                navigator.deviceMemory || 'unknown',
                screen.colorDepth,
                new Date().getTimezoneOffset()
            ];
            
            const fingerprint = components.join('|');
            return this._hashString(fingerprint);
        } catch (error) {
            return 'unknown_device';
        }
    }
    
    _generateSessionFingerprint() {
        return `sessfp_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    }
    
    async _getLocationInfo() {
        if (!this._config.maskIP) {
            try {
                // تلاش برای دریافت IP واقعی (در صورت دسترسی)
                const response = await fetch('https://api.ipify.org?format=json');
                const data = await response.json();
                return { ip: data.ip, masked: false };
            } catch (error) {
                // ignore
            }
        }
        
        // بازگشت IP ماسک شده
        return {
            ip: this._maskIP('192.168.0.0'), // مثال
            masked: true,
            country: 'unknown',
            region: 'unknown'
        };
    }
    
    _maskIP(ip) {
        if (!ip || !this._config.maskIP) return ip;
        
        const parts = ip.split('.');
        if (parts.length === 4) {
            return `${parts[0]}.${parts[1]}.xxx.xxx`;
        }
        
        return ip;
    }
    
    _sanitizeProperties(properties) {
        const sanitized = { ...properties };
        
        // حذف فیلدهای حساس
        if (this._config.excludeSensitiveFields) {
            const sensitiveFields = [
                'password', 'token', 'secret', 'key', 'creditCard',
                'ssn', 'passport', 'cvv', 'pin'
            ];
            
            sensitiveFields.forEach(field => {
                if (sanitized[field] !== undefined) {
                    sanitized[field] = '[REDACTED]';
                }
            });
        }
        
        // anonymize داده کاربر
        if (this._config.anonymizeData) {
            if (sanitized.userData) {
                sanitized.userData = this._anonymizeUserData(sanitized.userData);
            }
        }
        
        return sanitized;
    }
    
    _anonymizeUserData(userData) {
        const anonymized = { ...userData };
        
        // جایگزینی ایمیل
        if (anonymized.email) {
            const [local, domain] = anonymized.email.split('@');
            anonymized.email = `${local.charAt(0)}***@${domain}`;
        }
        
        // جایگزینی نام
        if (anonymized.name) {
            anonymized.name = anonymized.name.charAt(0) + '***';
        }
        
        // جایگزینی تلفن
        if (anonymized.phone) {
            anonymized.phone = anonymized.phone.replace(/\d(?=\d{4})/g, '*');
        }
        
        return anonymized;
    }
    
    _hashString(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return Math.abs(hash).toString(36);
    }
    
    async _checkForAnomalies(event) {
        const anomalies = [];
        
        // ۱. بررسی loginهای ناموفق پشت سر هم
        if (event.type === 'login_failed') {
            const recentFailures = this._anomalyState.failedLogins.filter(
                failure => Date.now() - failure.timestamp < this._config.anomalyDetection.timeWindow
            );
            
            if (recentFailures.length >= this._config.anomalyDetection.failedLoginThreshold) {
                anomalies.push({
                    type: 'RAPID_FAILED_LOGINS',
                    count: recentFailures.length,
                    threshold: this._config.anomalyDetection.failedLoginThreshold
                });
            }
        }
        
        // ۲. بررسی تغییر موقعیت مشکوک
        if (this._config.anomalyDetection.suspiciousLocationChange && event.properties.ip) {
            if (this._anomalyState.lastKnownLocation && 
                this._anomalyState.lastKnownLocation !== event.properties.ip) {
                
                // در اینجا می‌توانید منطق پیچیده‌تری برای تشخیص فاصله جغرافیایی اضافه کنید
                anomalies.push({
                    type: 'LOCATION_CHANGE',
                    previous: this._anomalyState.lastKnownLocation,
                    current: event.properties.ip
                });
            }
            this._anomalyState.lastKnownLocation = event.properties.ip;
        }
        
        // ۳. بررسی fingerprint دستگاه
        if (this._config.anomalyDetection.deviceFingerprinting) {
            if (!this._anomalyState.deviceHistory.has(this._deviceFingerprint)) {
                anomalies.push({
                    type: 'NEW_DEVICE',
                    fingerprint: this._deviceFingerprint
                });
                this._anomalyState.deviceHistory.add(this._deviceFingerprint);
            }
        }
        
        return {
            isAnomaly: anomalies.length > 0,
            anomalies,
            timestamp: Date.now()
        };
    }
    
    async _handleAnomaly(event, anomalyCheck) {
        this._metrics.anomaliesDetected++;
        
        // ذخیره anomaly
        this._anomalyState.suspiciousActivities.push({
            eventId: event.id,
            anomalies: anomalyCheck.anomalies,
            timestamp: Date.now()
        });
        
        // انتشار رویداد
        this._services.events.emit('analytics:auth:anomaly_detected', {
            event,
            anomalyCheck,
            timestamp: Date.now()
        });
        
        // فراخوانی callback
        if (typeof this._config.onAnomalyDetected === 'function') {
            await this._config.onAnomalyDetected(event, anomalyCheck);
        }
        
        // ارسال به سرور
        try {
            await fetch(this._config.endpoints.anomaly, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    event,
                    anomalyCheck,
                    deviceFingerprint: this._deviceFingerprint
                })
            });
        } catch (error) {
            console.warn('[AuthAnalytics] خطا در ارسال anomaly:', error);
        }
    }
    
    _cleanupOldFailedLogins() {
        const cutoff = Date.now() - this._config.anomalyDetection.timeWindow;
        this._anomalyState.failedLogins = this._anomalyState.failedLogins.filter(
            failure => failure.timestamp > cutoff
        );
    }
    
    _processEventInternally(event) {
        // پردازش داخلی event
        // می‌توانید aggregation، محاسبات real-time و غیره را اینجا انجام دهید
        
        // مثال: شمارش رویدادها بر اساس نوع
        const eventType = event.type;
        // ... پردازش‌های دیگر
    }
    
    async _addToQueue(event) {
        // بررسی اندازه صف
        if (this._queue.length >= this._config.maxQueueSize) {
            // حذف قدیمی‌ترین event
            this._queue.shift();
        }
        
        // اضافه کردن event جدید
        this._queue.push(event);
        
        // ذخیره در localStorage
        if (this._config.enableLocalStorage) {
            this._saveToStorage();
        }
        
        // بررسی برای flush خودکار
        if (this._queue.length >= this._config.batchSize) {
            this.flush();
        }
        
        return {
            queued: true,
            position: this._queue.length,
            queueSize: this._queue.length
        };
    }
    
    async _sendImmediately(event) {
        try {
            const response = await fetch(this._config.endpoints.track, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(event)
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            return { success: true, eventId: event.id };
        } catch (error) {
            // fallback: اضافه به صف
            console.warn('[AuthAnalytics] ارسال immediate ناموفق، اضافه به صف:', error);
            return this._addToQueue(event);
        }
    }
    
    async _sendBatch(batch) {
        if (batch.length === 0) return { success: true, sent: 0 };
        
        try {
            // اجرای callback قبل از ارسال
            let modifiedBatch = batch;
            if (typeof this._config.onBeforeSend === 'function') {
                const result = await this._config.onBeforeSend(batch);
                if (result) {
                    modifiedBatch = result;
                }
            }
            
            const response = await fetch(this._config.endpoints.batch, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    batch: modifiedBatch,
                    deviceFingerprint: this._deviceFingerprint,
                    sessionId: await this._getSessionId(),
                    timestamp: Date.now()
                })
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const result = await response.json();
            
            // اجرای callback بعد از ارسال
            if (typeof this._config.onAfterSend === 'function') {
                await this._config.onAfterSend(batch, result);
            }
            
            return {
                success: true,
                sent: batch.length,
                response: result
            };
            
        } catch (error) {
            console.error('[AuthAnalytics] خطا در ارسال batch:', error);
            
            // بازگرداندن به صف
            this._queue.unshift(...batch);
            
            return {
                success: false,
                error: error.message,
                requeued: batch.length
            };
        }
    }
    
    _startFlushTimer() {
        if (!this._config.enabled || this._flushTimer) return;
        
        this._flushTimer = setInterval(() => {
            if (this._queue.length > 0) {
                this.flush();
            }
        }, this._config.flushInterval);
    }
    
    _stopFlushTimer() {
        if (this._flushTimer) {
            clearInterval(this._flushTimer);
            this._flushTimer = null;
        }
    }
    
    _getNextFlushTime() {
        if (!this._flushTimer) return null;
        
        const lastFlush = this._metrics.lastFlush || Date.now();
        return lastFlush + this._config.flushInterval;
    }
    
    _saveToStorage() {
        if (!this._config.enableLocalStorage) return;
        
        try {
            const storageData = {
                queue: this._queue,
                timestamp: Date.now(),
                version: '1.0'
            };
            
            localStorage.setItem(
                this._config.storageKey,
                JSON.stringify(storageData)
            );
            
            // محاسبه usage
            const dataSize = JSON.stringify(storageData).length;
            this._metrics.storageUsage = dataSize;
        } catch (error) {
            console.warn('[AuthAnalytics] خطا در ذخیره‌سازی localStorage:', error);
        }
    }
    
    _loadPendingEvents() {
        if (!this._config.enableLocalStorage) return;
        
        try {
            const storedData = localStorage.getItem(this._config.storageKey);
            if (!storedData) return;
            
            const { queue, timestamp, version } = JSON.parse(storedData);
            
            // بررسی قدیمی نبودن داده‌ها
            const age = Date.now() - timestamp;
            if (age > this._config.maxStorageAge) {
                localStorage.removeItem(this._config.storageKey);
                return;
            }
            
            // اضافه کردن events قدیمی به صف
            if (Array.isArray(queue) && queue.length > 0) {
                console.log(`[AuthAnalytics] بارگذاری ${queue.length} event ذخیره شده`);
                this._queue.unshift(...queue);
                
                // flush فوری
                setTimeout(() => this.flush(), 1000);
            }
        } catch (error) {
            console.warn('[AuthAnalytics] خطا در بارگذاری events ذخیره شده:', error);
            localStorage.removeItem(this._config.storageKey);
        }
    }
    
    _cleanupStorage(sentBatch) {
        if (!this._config.enableLocalStorage || !sentBatch.length) return;
        
        try {
            const storedData = localStorage.getItem(this._config.storageKey);
            if (!storedData) return;
            
            const { queue, timestamp, version } = JSON.parse(storedData);
            
            // حذف events ارسال شده
            const sentIds = new Set(sentBatch.map(event => event.id));
            const remainingQueue = queue.filter(event => !sentIds.has(event.id));
            
            if (remainingQueue.length === 0) {
                localStorage.removeItem(this._config.storageKey);
            } else {
                localStorage.setItem(
                    this._config.storageKey,
                    JSON.stringify({
                        queue: remainingQueue,
                        timestamp,
                        version
                    })
                );
            }
        } catch (error) {
            console.warn('[AuthAnalytics] خطا در پاکسازی storage:', error);
        }
    }
    
    _storeEventFallback(eventData) {
        if (!this._config.enableLocalStorage) return;
        
        try {
            const fallbackKey = `${this._config.storageKey}_fallback`;
            const existing = localStorage.getItem(fallbackKey);
            const fallbackEvents = existing ? JSON.parse(existing) : [];
            
            fallbackEvents.push({
                ...eventData,
                storedAt: Date.now()
            });
            
            // محدود کردن تعداد
            if (fallbackEvents.length > 50) {
                fallbackEvents.splice(0, fallbackEvents.length - 50);
            }
            
            localStorage.setItem(fallbackKey, JSON.stringify(fallbackEvents));
        } catch (error) {
            console.warn('[AuthAnalytics] خطا در ذخیره fallback:', error);
        }
    }
}

// ==================== Export Pattern ====================

let authAnalyticsInstance = null;

function createAuthAnalytics(dependencies = {}) {
    if (!authAnalyticsInstance) {
        authAnalyticsInstance = new VakamovaAuthAnalytics(dependencies);
    }
    return authAnalyticsInstance;
}

function getAuthAnalytics() {
    if (!authAnalyticsInstance) {
        throw new Error('AuthAnalytics هنوز راه‌اندازی نشده است');
    }
    return authAnalyticsInstance;
}

// قرارداد رابط استاندارد
const AuthAnalyticsInterface = {
    create: createAuthAnalytics,
    get: getAuthAnalytics,
    reset: () => { authAnalyticsInstance = null; },
    
    // متدهای utility سریع
    quickTrack: (eventType, properties) => {
        const instance = getAuthAnalytics();
        return instance.track(eventType, properties);
    },
    
    quickLoginTrack: (success, metadata) => {
        const instance = getAuthAnalytics();
        return instance.trackLogin(success, metadata);
    }
};

// Export برای محیط‌های مختلف
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        VakamovaAuthAnalytics,
        AuthAnalyticsInterface
    };
}

if (typeof window !== 'undefined') {
    window.VakamovaAuthAnalytics = VakamovaAuthAnalytics;
    window.AuthAnalytics = AuthAnalyticsInterface;
}

console.log('[AuthAnalytics] ✅ ماژول تحلیل‌گرایانه احراز هویت بارگذاری شد');
