
/**
 * VAKAMOVA AUTH UTILITIES - سیستم ابزارهای احراز هویت
 * اصول: تزریق وابستگی، قرارداد رابط، رویدادمحور، پیکربندی متمرکز
 * وابستگی داخلی: فقط utils.js (از طریق dependency injection)
 */

class AuthUtilities {
    constructor(dependencies = {}) {
        // تزریق وابستگی‌ها
        this._deps = this._validateDependencies(dependencies);
        
        // پیکربندی متمرکز
        this._config = Object.freeze({
            password: {
                minLength: 8,
                requireUppercase: true,
                requireLowercase: true,
                requireNumbers: true,
                requireSpecialChars: true,
                specialChars: '!@#$%^&*()_+-=[]{}|;:,.<>?'
            },
            token: {
                expiryDays: 7,
                refreshThreshold: 24 * 60 * 60 * 1000, // 24 ساعت
                algorithm: 'SHA-256'
            },
            validation: {
                emailRegex: /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,
                usernameRegex: /^[a-zA-Z0-9_]{3,30}$/
            },
            security: {
                hashIterations: 10000,
                keyLength: 64,
                saltLength: 16
            }
        });
        
        // کش برای عملکرد بهتر
        this._cache = new Map();
        this._metrics = {
            hashOperations: 0,
            validationChecks: 0,
            tokenGenerations: 0,
            cacheHits: 0
        };
        
        Object.seal(this._config);
        Object.seal(this._metrics);
    }
    
    // ==================== VALIDATION METHODS ====================
    
    validateEmail(email) {
        this._metrics.validationChecks++;
        
        if (!email || typeof email !== 'string') {
            return {
                valid: false,
                error: 'ایمیل باید یک رشته معتبر باشد',
                code: 'EMAIL_INVALID_TYPE'
            };
        }
        
        const trimmedEmail = email.trim().toLowerCase();
        
        if (!this._config.validation.emailRegex.test(trimmedEmail)) {
            return {
                valid: false,
                error: 'فرمت ایمیل نامعتبر است',
                code: 'EMAIL_INVALID_FORMAT'
            };
        }
        
        // بررسی DNS MX record (در صورت موجود بودن ابزار)
        if (this._deps.utils?.networkUtils?.checkDNS) {
            const dnsValid = this._deps.utils.networkUtils.checkDNS(trimmedEmail);
            if (!dnsValid) {
                return {
                    valid: false,
                    error: 'دامنه ایمیل وجود ندارد',
                    code: 'EMAIL_DOMAIN_INVALID'
                };
            }
        }
        
        return {
            valid: true,
            normalized: trimmedEmail,
            domain: trimmedEmail.split('@')[1]
        };
    }
    
    validatePassword(password, options = {}) {
        this._metrics.validationChecks++;
        
        const config = { ...this._config.password, ...options };
        
        if (!password || typeof password !== 'string') {
            return {
                valid: false,
                errors: ['رمز عبور باید یک رشته معتبر باشد'],
                score: 0,
                code: 'PASSWORD_INVALID_TYPE'
            };
        }
        
        const errors = [];
        let score = 0;
        
        // طول رمز عبور
        if (password.length < config.minLength) {
            errors.push(`رمز عبور باید حداقل ${config.minLength} کاراکتر باشد`);
        } else {
            score += 20;
        }
        
        // حروف بزرگ
        if (config.requireUppercase && !/[A-Z]/.test(password)) {
            errors.push('رمز عبور باید حداقل یک حرف بزرگ داشته باشد');
        } else if (config.requireUppercase) {
            score += 20;
        }
        
        // حروف کوچک
        if (config.requireLowercase && !/[a-z]/.test(password)) {
            errors.push('رمز عبور باید حداقل یک حرف کوچک داشته باشد');
        } else if (config.requireLowercase) {
            score += 20;
        }
        
        // اعداد
        if (config.requireNumbers && !/\d/.test(password)) {
            errors.push('رمز عبور باید حداقل یک عدد داشته باشد');
        } else if (config.requireNumbers) {
            score += 20;
        }
        
        // کاراکترهای خاص
        if (config.requireSpecialChars) {
            const specialRegex = new RegExp(`[${this._escapeRegex(config.specialChars)}]`);
            if (!specialRegex.test(password)) {
                errors.push(`رمز عبور باید حداقل یک کاراکتر خاص داشته باشد: ${config.specialChars}`);
            } else {
                score += 20;
            }
        }
        
        // بررسی تکراری‌ها
        if (this._hasRepeatingChars(password)) {
            errors.push('رمز عبور شامل کاراکترهای تکراری متوالی است');
            score -= 10;
        }
        
        // بررسی دنباله‌های رایج
        if (this._isCommonSequence(password)) {
            errors.push('رمز عبور شامل دنباله‌های رایج است');
            score -= 10;
        }
        
        // نمره نهایی
        const finalScore = Math.max(0, Math.min(100, score));
        const strength = this._getPasswordStrength(finalScore);
        
        return {
            valid: errors.length === 0,
            errors: errors.length > 0 ? errors : null,
            score: finalScore,
            strength,
            length: password.length,
            meetsRequirements: errors.length === 0
        };
    }
    
    validateUsername(username) {
        this._metrics.validationChecks++;
        
        if (!username || typeof username !== 'string') {
            return {
                valid: false,
                error: 'نام کاربری باید یک رشته معتبر باشد',
                code: 'USERNAME_INVALID_TYPE'
            };
        }
        
        const trimmedUsername = username.trim();
        
        if (!this._config.validation.usernameRegex.test(trimmedUsername)) {
            return {
                valid: false,
                error: 'نام کاربری باید ۳ تا ۳۰ کاراکتر و فقط شامل حروف، اعداد و زیرخط باشد',
                code: 'USERNAME_INVALID_FORMAT'
            };
        }
        
        // بررسی نام‌های رزرو شده
        const reservedNames = ['admin', 'administrator', 'root', 'system', 'support', 'info'];
        if (reservedNames.includes(trimmedUsername.toLowerCase())) {
            return {
                valid: false,
                error: 'این نام کاربری رزرو شده است',
                code: 'USERNAME_RESERVED'
            };
        }
        
        return {
            valid: true,
            normalized: trimmedUsername,
            available: true
        };
    }
    
    // ==================== PASSWORD HASHING ====================
    
    async hashPassword(password, salt = null) {
        this._metrics.hashOperations++;
        
        if (!password || typeof password !== 'string') {
            throw new Error('رمز عبور باید یک رشته معتبر باشد');
        }
        
        // تولید salt اگر ارائه نشده
        const finalSalt = salt || await this._generateSalt();
        
        // کش کردن بر اساس password + salt
        const cacheKey = `hash_${password}_${finalSalt}`;
        if (this._cache.has(cacheKey)) {
            this._metrics.cacheHits++;
            return this._cache.get(cacheKey);
        }
        
        try {
            // استفاده از Web Crypto API برای امنیت بیشتر
            const encoder = new TextEncoder();
            const passwordBuffer = encoder.encode(password);
            const saltBuffer = encoder.encode(finalSalt);
            
            // ترکیب password و salt
            const combinedBuffer = new Uint8Array(passwordBuffer.length + saltBuffer.length);
            combinedBuffer.set(passwordBuffer);
            combinedBuffer.set(saltBuffer, passwordBuffer.length);
            
            // تولید hash با PBKDF2
            const keyMaterial = await crypto.subtle.importKey(
                'raw',
                combinedBuffer,
                'PBKDF2',
                false,
                ['deriveBits']
            );
            
            const hashBuffer = await crypto.subtle.deriveBits(
                {
                    name: 'PBKDF2',
                    salt: encoder.encode('VAKAMOVA_SALT'),
                    iterations: this._config.security.hashIterations,
                    hash: 'SHA-256'
                },
                keyMaterial,
                this._config.security.keyLength * 8
            );
            
            // تبدیل به hex
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
            
            const result = {
                hash: hashHex,
                salt: finalSalt,
                algorithm: 'PBKDF2-SHA-256',
                iterations: this._config.security.hashIterations,
                timestamp: Date.now()
            };
            
            // ذخیره در کش (TTL: 5 دقیقه)
            this._cache.set(cacheKey, result);
            setTimeout(() => this._cache.delete(cacheKey), 5 * 60 * 1000);
            
            return result;
            
        } catch (error) {
            throw new Error(`خطا در هش کردن رمز عبور: ${error.message}`);
        }
    }
    
    async verifyPassword(password, hashData) {
        if (!password || !hashData || !hashData.hash || !hashData.salt) {
            return false;
        }
        
        const cacheKey = `verify_${password}_${hashData.salt}_${hashData.hash}`;
        if (this._cache.has(cacheKey)) {
            this._metrics.cacheHits++;
            return this._cache.get(cacheKey);
        }
        
        try {
            const newHash = await this.hashPassword(password, hashData.salt);
            const isValid = newHash.hash === hashData.hash;
            
            this._cache.set(cacheKey, isValid);
            setTimeout(() => this._cache.delete(cacheKey), 2 * 60 * 1000);
            
            return isValid;
            
        } catch (error) {
            console.error('خطا در تأیید رمز عبور:', error);
            return false;
        }
    }
    
    // ==================== TOKEN UTILITIES ====================
    
    generateTokenPayload(userData, options = {}) {
        this._metrics.tokenGenerations++;
        
        const now = Date.now();
        const expiryDays = options.expiryDays || this._config.token.expiryDays;
        
        const payload = {
            userId: userData.id,
            email: userData.email,
            username: userData.username,
            role: userData.role || 'user',
            iat: Math.floor(now / 1000), // زمان صدور
            exp: Math.floor((now + (expiryDays * 24 * 60 * 60 * 1000)) / 1000), // زمان انقضا
            jti: this._generateUUID(), // شناسه یکتا
            iss: 'vakamova.auth', // صادرکننده
            aud: 'vakamova.app' // مخاطب
        };
        
        // اضافه کردن claims اختیاری
        if (options.claims) {
            Object.assign(payload, options.claims);
        }
        
        // اضافه کردن metadata
        payload.meta = {
            deviceId: options.deviceId || 'unknown',
            ipAddress: options.ipAddress || 'unknown',
            userAgent: options.userAgent || 'unknown',
            generationTime: now
        };
        
        return payload;
    }
    
    shouldRefreshToken(tokenData) {
        if (!tokenData || !tokenData.expiry) {
            return true;
        }
        
        const now = Date.now();
        const expiryTime = new Date(tokenData.expiry).getTime();
        const timeUntilExpiry = expiryTime - now;
        
        // اگر کمتر از 24 ساعت به انقضا مانده، نیاز به رفرش دارد
        return timeUntilExpiry < this._config.token.refreshThreshold;
    }
    
    calculateTokenExpiry(days = null) {
        const expiryDays = days || this._config.token.expiryDays;
        const now = new Date();
        const expiry = new Date(now.getTime() + (expiryDays * 24 * 60 * 60 * 1000));
        
        return {
            timestamp: expiry.getTime(),
            isoString: expiry.toISOString(),
            daysUntilExpiry: expiryDays,
            readable: expiry.toLocaleDateString('fa-IR')
        };
    }
    
    // ==================== SECURITY UTILITIES ====================
    
    generateSecureRandom(length = 32) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+-=[]{}|;:,.<>?';
        const randomValues = new Uint8Array(length);
        
        if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
            crypto.getRandomValues(randomValues);
        } else {
            // Fallback برای محیط‌هایی که crypto وجود ندارد
            for (let i = 0; i < length; i++) {
                randomValues[i] = Math.floor(Math.random() * 256);
            }
        }
        
        let result = '';
        for (let i = 0; i < length; i++) {
            result += chars[randomValues[i] % chars.length];
        }
        
        return result;
    }
    
    sanitizeInput(input, options = {}) {
        if (input === null || input === undefined) {
            return '';
        }
        
        let result = String(input);
        
        // حذف تگ‌های HTML
        if (options.stripTags !== false) {
            result = result.replace(/<[^>]*>/g, '');
        }
        
        // حذف کاراکترهای کنترل
        result = result.replace(/[\x00-\x1F\x7F]/g, '');
        
        // Trim spaces
        result = result.trim();
        
        // محدودیت طول
        if (options.maxLength && result.length > options.maxLength) {
            result = result.substring(0, options.maxLength);
        }
        
        // Escape خاص برای SQL (در صورت نیاز)
        if (options.escapeSQL) {
            result = result.replace(/['"\\]/g, '\\$&');
        }
        
        return result;
    }
    
    // ==================== METRICS & DIAGNOSTICS ====================
    
    getMetrics() {
        return { ...this._metrics };
    }
    
    resetMetrics() {
        this._metrics.hashOperations = 0;
        this._metrics.validationChecks = 0;
        this._metrics.tokenGenerations = 0;
        this._metrics.cacheHits = 0;
        return this;
    }
    
    clearCache() {
        const clearedCount = this._cache.size;
        this._cache.clear();
        return clearedCount;
    }
    
    getConfig() {
        return { ...this._config };
    }
    
    updateConfig(newConfig) {
        // فقط بخش‌هایی که قابل تغییر هستند
        const mutableConfig = {
            password: { ...this._config.password, ...(newConfig.password || {}) },
            token: { ...this._config.token, ...(newConfig.token || {}) }
        };
        
        Object.assign(this._config, mutableConfig);
        return this._config;
    }
    
    // ==================== PRIVATE METHODS ====================
    
    _validateDependencies(deps) {
        const validated = { ...deps };
        
        // بررسی وجود utils.js
        if (!validated.utils) {
            console.warn('[AuthUtils] utils.js not provided, using fallbacks');
            validated.utils = this._createFallbackUtils();
        }
        
        return validated;
    }
    
    _createFallbackUtils() {
        return {
            stringUtils: {
                escapeRegex: (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
                generateUUID: () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
                    const r = Math.random() * 16 | 0;
                    const v = c === 'x' ? r : (r & 0x3 | 0x8);
                    return v.toString(16);
                })
            },
            validationUtils: {
                isEmail: (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
                isStrongPassword: (pass) => pass.length >= 8
            }
        };
    }
    
    async _generateSalt() {
        const randomValues = new Uint8Array(this._config.security.saltLength);
        
        if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
            crypto.getRandomValues(randomValues);
        }
        
        return Array.from(randomValues)
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
    }
    
    _escapeRegex(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    
    _hasRepeatingChars(str) {
        return /(.)\1{2,}/.test(str); // 3 کاراکتر تکراری متوالی
    }
    
    _isCommonSequence(str) {
        const commonSequences = [
            '123456', 'password', 'qwerty', 'admin', 'welcome',
            'abcdef', '654321', '111111', '000000'
        ];
        
        const lowerStr = str.toLowerCase();
        return commonSequences.some(seq => lowerStr.includes(seq));
    }
    
    _getPasswordStrength(score) {
        if (score >= 80) return 'خیلی قوی';
        if (score >= 60) return 'قوی';
        if (score >= 40) return 'متوسط';
        if (score >= 20) return 'ضعیف';
        return 'خیلی ضعیف';
    }
    
    _generateUUID() {
        if (this._deps.utils?.stringUtils?.generateUUID) {
            return this._deps.utils.stringUtils.generateUUID();
        }
        
        // Fallback UUID generator
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }
    
    // ==================== EXPORT ====================
    
    static create(config = {}) {
        return new AuthUtilities(config);
    }
}

// Singleton export با پیکربندی پیش‌فرض
const authUtils = new AuthUtilities();
Object.freeze(authUtils);

// Named exports برای استفاده ماژولار
export { AuthUtilities, authUtils };
