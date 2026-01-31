/**
 * VAKAMOVA AUTH UTILITIES - سیستم ابزارهای احراز هویت پیشرفته
 * اصول: تزریق وابستگی، قرارداد رابط، رویدادمحور، پیکربندی متمرکز
 * وابستگی داخلی: event_bus.js (برای رویدادهای امنیتی)
 */

class AuthUtils {
    constructor(eventSystem, config = {}) {
        // ==================== تزریق وابستگی ====================
        this._eventSystem = eventSystem || {
            emit: () => console.warn('[AuthUtils] Event system not available')
        };
        
        // ==================== پیکربندی متمرکز ====================
        this._config = Object.freeze({
            // تنظیمات hash
            hash: {
                algorithm: config.hashAlgorithm || 'SHA-256',
                iterations: config.hashIterations || 100000,
                keyLength: config.hashKeyLength || 256,
                saltLength: config.saltLength || 32
            },
            
            // تنظیمات توکن
            token: {
                expiryDays: config.tokenExpiryDays || 7,
                refreshThreshold: config.refreshThreshold || 0.3, // 30% مانده به انقضا
                secretKey: config.secretKey || this._generateFallbackKey()
            },
            
            // تنظیمات امنیتی
            security: {
                minPasswordLength: config.minPasswordLength || 8,
                requireSpecialChar: config.requireSpecialChar ?? true,
                requireNumbers: config.requireNumbers ?? true,
                requireUppercase: config.requireUppercase ?? true,
                maxFailedAttempts: config.maxFailedAttempts || 5,
                lockoutMinutes: config.lockoutMinutes || 15
            },
            
            // تنظیمات اعتبارسنجی
            validation: {
                emailRegex: /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,
                usernameRegex: /^[a-zA-Z0-9_]{3,20}$/,
                phoneRegex: /^[\+]?[0-9\s\-\(\)]{10,15}$/
            },
            
            // تنظیمات پیش‌فرض
            defaults: {
                tokenType: 'bearer',
                authScheme: 'VakamovaAuth',
                version: '1.0.0'
            },
            
            ...config
        });
        
        // ==================== وضعیت داخلی ====================
        this._cache = new Map();
        this._metrics = {
            hashesGenerated: 0,
            tokensCreated: 0,
            validationsPassed: 0,
            validationsFailed: 0,
            securityEvents: 0
        };
        
        this._initialized = false;
        this._init();
        
        Object.seal(this._metrics);
        Object.seal(this);
    }
    
    // ==================== متدهای اصلی (قرارداد رابط) ====================
    
    async hashPassword(password, salt = null) {
        this._validateInput(password, 'password');
        this._trackSecurityEvent('password_hash_attempt');
        
        try {
            const useSalt = salt || await this._generateSalt();
            const hash = await this._performHash(password, useSalt);
            
            this._metrics.hashesGenerated++;
            this._eventSystem.emit('auth:password:hashed', {
                timestamp: Date.now(),
                hashed: true
            });
            
            return {
                hash,
                salt: useSalt,
                algorithm: this._config.hash.algorithm,
                iterations: this._config.hash.iterations,
                version: this._config.defaults.version
            };
            
        } catch (error) {
            this._trackSecurityEvent('password_hash_failed', { error: error.message });
            throw new Error(`Password hashing failed: ${error.message}`);
        }
    }
    
    async verifyPassword(password, hashData) {
        this._validateInput(password, 'password');
        this._validateHashData(hashData);
        
        try {
            const computedHash = await this._performHash(password, hashData.salt);
            const isValid = computedHash === hashData.hash;
            
            if (isValid) {
                this._metrics.validationsPassed++;
                this._eventSystem.emit('auth:password:verified', { valid: true });
            } else {
                this._metrics.validationsFailed++;
                this._trackSecurityEvent('password_verification_failed');
            }
            
            return {
                valid: isValid,
                timestamp: Date.now(),
                rehashRecommended: this._shouldRehash(hashData)
            };
            
        } catch (error) {
            this._trackSecurityEvent('password_verify_error', { error: error.message });
            throw new Error(`Password verification failed: ${error.message}`);
        }
    }
    
    createToken(payload = {}, options = {}) {
        this._validateTokenPayload(payload);
        
        const tokenId = this._generateTokenId();
        const expiryDays = options.expiryDays || this._config.token.expiryDays;
        
        const tokenData = {
            jti: tokenId, // JWT ID
            sub: payload.userId || 'anonymous',
            aud: options.audience || 'vakamova-app',
            iss: options.issuer || 'vakamova-auth',
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + (expiryDays * 24 * 60 * 60),
            typ: this._config.defaults.tokenType,
            ver: this._config.defaults.version,
            ...payload,
            _meta: {
                created: new Date().toISOString(),
                source: options.source || 'direct',
                device: options.deviceInfo || {}
            }
        };
        
        // در نسخه واقعی، اینجا توکن JWT واقعی ساخته می‌شود
        const token = this._encodeToken(tokenData);
        
        this._metrics.tokensCreated++;
        this._eventSystem.emit('auth:token:created', {
            tokenId,
            userId: payload.userId,
            expiry: tokenData.exp
        });
        
        return {
            token,
            tokenId,
            expiresAt: tokenData.exp * 1000,
            expiresIn: expiryDays * 24 * 60 * 60,
            tokenType: this._config.defaults.tokenType,
            authScheme: this._config.defaults.authScheme
        };
    }
    
    validateToken(token, options = {}) {
        if (!token || typeof token !== 'string') {
            return {
                valid: false,
                reason: 'invalid_token_format',
                code: 'AUTH_001'
            };
        }
        
        try {
            const tokenData = this._decodeToken(token);
            const now = Math.floor(Date.now() / 1000);
            
            // بررسی انقضا
            if (tokenData.exp < now) {
                return {
                    valid: false,
                    reason: 'token_expired',
                    expiredAt: tokenData.exp * 1000,
                    code: 'AUTH_002'
                };
            }
            
            // بررسی صدور
            if (tokenData.iat > now) {
                return {
                    valid: false,
                    reason: 'token_not_yet_valid',
                    validFrom: tokenData.iat * 1000,
                    code: 'AUTH_003'
                };
            }
            
            // بررسی audience
            if (options.audience && tokenData.aud !== options.audience) {
                return {
                    valid: false,
                    reason: 'invalid_audience',
                    expected: options.audience,
                    actual: tokenData.aud,
                    code: 'AUTH_004'
                };
            }
            
            // بررسی issuer
            if (options.issuer && tokenData.iss !== options.issuer) {
                return {
                    valid: false,
                    reason: 'invalid_issuer',
                    expected: options.issuer,
                    actual: tokenData.iss,
                    code: 'AUTH_005'
                };
            }
            
            // بررسی نیاز به رفرش
            const timeToExpiry = tokenData.exp - now;
            const totalLifetime = tokenData.exp - tokenData.iat;
            const refreshThreshold = options.refreshThreshold || this._config.token.refreshThreshold;
            
            const shouldRefresh = timeToExpiry / totalLifetime < refreshThreshold;
            
            this._metrics.validationsPassed++;
            this._eventSystem.emit('auth:token:validated', {
                tokenId: tokenData.jti,
                userId: tokenData.sub,
                shouldRefresh
            });
            
            return {
                valid: true,
                tokenId: tokenData.jti,
                userId: tokenData.sub,
                expiresAt: tokenData.exp * 1000,
                issuedAt: tokenData.iat * 1000,
                audience: tokenData.aud,
                issuer: tokenData.iss,
                shouldRefresh,
                metadata: tokenData._meta
            };
            
        } catch (error) {
            this._metrics.validationsFailed++;
            this._trackSecurityEvent('token_validation_error', { error: error.message });
            
            return {
                valid: false,
                reason: 'token_decoding_failed',
                error: error.message,
                code: 'AUTH_006'
            };
        }
    }
    
    validateEmail(email) {
        if (!email || typeof email !== 'string') {
            return {
                valid: false,
                reason: 'invalid_type',
                code: 'VAL_001'
            };
        }
        
        const normalizedEmail = email.trim().toLowerCase();
        const isValid = this._config.validation.emailRegex.test(normalizedEmail);
        
        const result = {
            valid: isValid,
            normalized: normalizedEmail,
            domain: isValid ? normalizedEmail.split('@')[1] : null,
            timestamp: Date.now()
        };
        
        this._eventSystem.emit('auth:email:validated', result);
        return result;
    }
    
    validatePassword(password, options = {}) {
        const requirements = {
            ...this._config.security,
            ...options
        };
        
        const issues = [];
        
        // بررسی طول
        if (password.length < requirements.minPasswordLength) {
            issues.push({
                code: 'PASS_001',
                message: `Password must be at least ${requirements.minPasswordLength} characters`,
                minLength: requirements.minPasswordLength,
                actualLength: password.length
            });
        }
        
        // بررسی حروف خاص
        if (requirements.requireSpecialChar && !/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
            issues.push({
                code: 'PASS_002',
                message: 'Password must contain at least one special character'
            });
        }
        
        // بررسی اعداد
        if (requirements.requireNumbers && !/\d/.test(password)) {
            issues.push({
                code: 'PASS_003',
                message: 'Password must contain at least one number'
            });
        }
        
        // بررسی حروف بزرگ
        if (requirements.requireUppercase && !/[A-Z]/.test(password)) {
            issues.push({
                code: 'PASS_004',
                message: 'Password must contain at least one uppercase letter'
            });
        }
        
        // بررسی تکراری نبودن
        if (options.preventReuse && this._isPasswordReused(password)) {
            issues.push({
                code: 'PASS_005',
                message: 'Password has been used recently'
            });
        }
        
        const result = {
            valid: issues.length === 0,
            issues,
            strength: this._calculatePasswordStrength(password),
            timestamp: Date.now()
        };
        
        this._eventSystem.emit('auth:password:validated', result);
        return result;
    }
    
    generateUsername(baseName, options = {}) {
        const sanitized = baseName
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '_')
            .replace(/_+/g, '_')
            .replace(/^_|_$/g, '');
        
        const suffix = options.addNumbers ? `_${Math.floor(Math.random() * 1000)}` : '';
        const prefix = options.prefix ? `${options.prefix}_` : '';
        
        const username = `${prefix}${sanitized}${suffix}`.substring(0, options.maxLength || 20);
        
        this._eventSystem.emit('auth:username:generated', { username });
        return username;
    }
    
    calculatePasswordStrength(password) {
        return this._calculatePasswordStrength(password);
    }
    
    needsRehash(hashData) {
        return this._shouldRehash(hashData);
    }
    
    getMetrics() {
        return { ...this._metrics };
    }
    
    resetMetrics() {
        this._metrics.hashesGenerated = 0;
        this._metrics.tokensCreated = 0;
        this._metrics.validationsPassed = 0;
        this._metrics.validationsFailed = 0;
        this._metrics.securityEvents = 0;
        return this;
    }
    
    // ==================== متدهای کمکی داخلی ====================
    
    async _performHash(password, salt) {
        // در محیط مرورگر از SubtleCrypto API استفاده می‌کنیم
        const encoder = new TextEncoder();
        const passwordBuffer = encoder.encode(password);
        const saltBuffer = encoder.encode(salt);
        
        // ترکیب password و salt
        const combinedBuffer = new Uint8Array(passwordBuffer.length + saltBuffer.length);
        combinedBuffer.set(passwordBuffer);
        combinedBuffer.set(saltBuffer, passwordBuffer.length);
        
        // استفاده از PBKDF2 برای hash
        const keyMaterial = await crypto.subtle.importKey(
            'raw',
            combinedBuffer,
            'PBKDF2',
            false,
            ['deriveBits']
        );
        
        const derivedBits = await crypto.subtle.deriveBits(
            {
                name: 'PBKDF2',
                salt: encoder.encode('vakamova-static-salt'),
                iterations: this._config.hash.iterations,
                hash: this._config.hash.algorithm
            },
            keyMaterial,
            this._config.hash.keyLength
        );
        
        // تبدیل به hex string
        const hashArray = Array.from(new Uint8Array(derivedBits));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }
    
    async _generateSalt() {
        const randomValues = new Uint8Array(this._config.hash.saltLength);
        crypto.getRandomValues(randomValues);
        
        return Array.from(randomValues)
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
    }
    
    _generateTokenId() {
        const timestamp = Date.now().toString(36);
        const random = Math.random().toString(36).substring(2, 10);
        return `tok_${timestamp}_${random}`;
    }
    
    _encodeToken(data) {
        // در نسخه واقعی، اینجا JWT واقعی تولید می‌شود
        const jsonString = JSON.stringify(data);
        const base64 = btoa(unescape(encodeURIComponent(jsonString)));
        return `vak_${base64}`;
    }
    
    _decodeToken(token) {
        if (!token.startsWith('vak_')) {
            throw new Error('Invalid token format');
        }
        
        const base64 = token.substring(4);
        const jsonString = decodeURIComponent(escape(atob(base64)));
        return JSON.parse(jsonString);
    }
    
    _calculatePasswordStrength(password) {
        let score = 0;
        
        // طول
        if (password.length >= 12) score += 2;
        else if (password.length >= 8) score += 1;
        
        // تنوع کاراکتر
        if (/[a-z]/.test(password)) score += 1;
        if (/[A-Z]/.test(password)) score += 1;
        if (/\d/.test(password)) score += 1;
        if (/[^a-zA-Z0-9]/.test(password)) score += 1;
        
        // آنتروپی
        const uniqueChars = new Set(password).size;
        score += Math.min(3, Math.floor(uniqueChars / 3));
        
        // نمره نهایی (0-10)
        const normalizedScore = Math.min(10, score);
        
        return {
            score: normalizedScore,
            level: normalizedScore >= 8 ? 'strong' : 
                   normalizedScore >= 5 ? 'medium' : 'weak',
            suggestions: this._getPasswordSuggestions(password, normalizedScore)
        };
    }
    
    _getPasswordSuggestions(password, score) {
        const suggestions = [];
        
        if (password.length < 12) {
            suggestions.push('Use at least 12 characters');
        }
        
        if (!/[A-Z]/.test(password)) {
            suggestions.push('Add uppercase letters');
        }
        
        if (!/\d/.test(password)) {
            suggestions.push('Add numbers');
        }
        
        if (!/[^a-zA-Z0-9]/.test(password)) {
            suggestions.push('Add special characters');
        }
        
        if (new Set(password).size < password.length * 0.6) {
            suggestions.push('Avoid repeated characters');
        }
        
        return suggestions;
    }
    
    _shouldRehash(hashData) {
        // بررسی نیاز به rehash بر اساس نسخه یا الگوریتم قدیمی
        if (!hashData.version || hashData.version !== this._config.defaults.version) {
            return true;
        }
        
        if (hashData.iterations < this._config.hash.iterations) {
            return true;
        }
        
        if (hashData.algorithm !== this._config.hash.algorithm) {
            return true;
        }
        
        return false;
    }
    
    _isPasswordReused(password) {
        // بررسی کش برای جلوگیری از استفاده مجدد
        const hash = this._simpleHash(password);
        return this._cache.has(`reused_${hash}`);
    }
    
    _simpleHash(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash |= 0;
        }
        return hash.toString(36);
    }
    
    _generateFallbackKey() {
        // کلید fallback برای مواقعی که کلید اصلی تنظیم نشده
        const timestamp = Date.now().toString(36);
        const random = Math.random().toString(36).substring(2);
        return `fallback_key_${timestamp}_${random}`;
    }
    
    _validateInput(value, type) {
        if (!value || (typeof value !== 'string' && typeof value !== 'number')) {
            throw new Error(`Invalid ${type}: must be a non-empty string or number`);
        }
        
        if (typeof value === 'string' && value.trim().length === 0) {
            throw new Error(`${type} cannot be empty or whitespace`);
        }
    }
    
    _validateHashData(hashData) {
        if (!hashData || typeof hashData !== 'object') {
            throw new Error('Hash data must be an object');
        }
        
        if (!hashData.hash || !hashData.salt) {
            throw new Error('Hash data must contain hash and salt');
        }
        
        if (typeof hashData.hash !== 'string' || typeof hashData.salt !== 'string') {
            throw new Error('Hash and salt must be strings');
        }
    }
    
    _validateTokenPayload(payload) {
        if (!payload || typeof payload !== 'object') {
            throw new Error('Token payload must be an object');
        }
        
        if (payload.password || payload.creditCard) {
            throw new Error('Sensitive data should not be included in token payload');
        }
    }
    
    _trackSecurityEvent(eventType, data = {}) {
        this._metrics.securityEvents++;
        
        this._eventSystem.emit('auth:security:event', {
            type: eventType,
            timestamp: Date.now(),
            ...data
        });
    }
    
    _init() {
        // تنظیمات اولیه و event listeners
        this._eventSystem.on('auth:utils:cleanup', () => {
            this._cache.clear();
            this.resetMetrics();
        });
        
        this._initialized = true;
        this._eventSystem.emit('auth:utils:initialized', {
            version: this._config.defaults.version,
            timestamp: Date.now()
        });
    }
    
    // ==================== متدهای ثابت (بدون نیاز به instance) ====================
    
    static sanitizeInput(input) {
        if (typeof input !== 'string') return input;
        
        return input
            .replace(/[<>]/g, '') // حذف تگ‌های HTML
            .replace(/javascript:/gi, '') // حذف اسکریپت
            .trim()
            .substring(0, 1000); // محدودیت طول
    }
    
    static generateRandomCode(length = 6, options = {}) {
        const chars = options.numbersOnly ? '0123456789' : 
                     'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        
        let result = '';
        const randomValues = new Uint8Array(length);
        crypto.getRandomValues(randomValues);
        
        for (let i = 0; i < length; i++) {
            result += chars[randomValues[i] % chars.length];
        }
        
        return result;
    }
    
    static maskSensitiveData(data, visibleChars = 4) {
        if (!data || typeof data !== 'string') return data;
        
        if (data.length <= visibleChars * 2) {
            return '*'.repeat(data.length);
        }
        
        const firstPart = data.substring(0, visibleChars);
        const lastPart = data.substring(data.length - visibleChars);
        const middle = '*'.repeat(data.length - (visibleChars * 2));
        
        return `${firstPart}${middle}${lastPart}`;
    }
}

// ==================== Singleton Export ====================

let authUtilsInstance = null;

function createAuthUtils(eventSystem, config) {
    if (!authUtilsInstance) {
        authUtilsInstance = new AuthUtils(eventSystem, config);
        Object.freeze(authUtilsInstance);
    }
    return authUtilsInstance;
}

function getAuthUtils() {
    if (!authUtilsInstance) {
        console.warn('[AuthUtils] Instance not initialized. Call createAuthUtils() first.');
    }
    return authUtilsInstance;
}

// ==================== Export ====================

export { AuthUtils, createAuthUtils, getAuthUtils };

// ==================== Auto-init در صورت نیاز ====================
if (typeof window !== 'undefined' && window.eventBus) {
    // اگر eventBus در دسترس است، auto-init انجام بده
    createAuthUtils(window.eventBus);
    console.log('[AuthUtils] Auto-initialized with global eventBus');
  }
