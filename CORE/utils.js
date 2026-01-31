
// ==================== CORE_utils.js ====================
// Vakamova - Professional Utilities Module
// اصول ۴ گانه: ۱. تزریق وابستگی ۲. قرارداد رابط ۳. رویدادمحور ۴. پیکربندی متمرکز

// ==================== CONTRACT/INTERFACE ====================
/**
 * @typedef {Object} UtilsContract
 * @property {string} name - نام ماژول
 * @property {string} version - نسخه
 * @property {function} init - تابع مقداردهی اولیه
 * @property {function} cleanup - تابع پاکسازی
 * @property {Object} methods - متدهای موجود
 */

// ==================== MAIN CLASS ====================
class CoreUtils {
    // ==================== CONSTRUCTOR (Dependency Injection) ====================
    constructor(dependencies = {}) {
        // وابستگی‌های تزریق شده
        this.deps = {
            config: dependencies.config || this._createDefaultConfig(),
            eventBus: dependencies.eventBus || this._createDefaultEventBus(),
            logger: dependencies.logger || console,
            crypto: dependencies.crypto || window.crypto || window.msCrypto,
            performance: dependencies.performance || window.performance,
            ...dependencies
        };

        // وضعیت داخلی
        this.state = {
            initialized: false,
            cache: new Map(),
            timers: new Map(),
            listeners: new Map()
        };

        // متدهای عمومی
        this.methods = {
            // رشته‌ها
            string: ['escapeHtml', 'truncate', 'slugify', 'camelCase', 'kebabCase'],
            
            // آرایه‌ها
            array: ['unique', 'chunk', 'groupBy', 'sortBy', 'filterBy'],
            
            // شیءها
            object: ['deepClone', 'merge', 'pick', 'omit', 'flatten'],
            
            // تاریخ و زمان
            datetime: ['formatDate', 'relativeTime', 'duration', 'isToday'],
            
            // اعتبارسنجی
            validation: ['isEmail', 'isPhone', 'isUrl', 'isStrongPassword'],
            
            // امنیت
            security: ['hash', 'encrypt', 'decrypt', 'generateToken'],
            
            // عملکرد
            performance: ['debounce', 'throttle', 'memoize', 'retry']
        };

        // بایندر خودکار متدها
        this._bindMethods();
    }

    // ==================== INITIALIZATION ====================
    async init(options = {}) {
        if (this.state.initialized) {
            this.deps.logger.warn('[Utils] Already initialized');
            return this;
        }

        try {
            // ثبت در Event Bus
            if (this.deps.eventBus && this.deps.eventBus.emit) {
                this.deps.eventBus.emit('utils:initializing', { timestamp: Date.now() });
            }

            // راه‌اندازی کش
            this._setupCache(options.cacheConfig);

            // راه‌اندازی performance monitoring
            this._setupPerformanceMonitoring();

            // راه‌اندازی security
            await this._setupSecurity();

            this.state.initialized = true;
            
            if (this.deps.eventBus && this.deps.eventBus.emit) {
                this.deps.eventBus.emit('utils:initialized', { 
                    timestamp: Date.now(),
                    methods: Object.keys(this.methods).flatMap(k => this.methods[k])
                });
            }

            this.deps.logger.info('[Utils] Initialized successfully');
            return this;

        } catch (error) {
            this.deps.logger.error('[Utils] Initialization failed:', error);
            throw error;
        }
    }

    // ==================== STRING UTILITIES ====================
    
    /**
     * جلوگیری از XSS - Escape HTML
     * @param {string} text - متن ورودی
     * @returns {string} متن ایمن
     */
    escapeHtml(text) {
        if (typeof text !== 'string') return '';
        
        const escapeMap = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#x27;',
            '/': '&#x2F;',
            '`': '&#x60;',
            '=': '&#x3D;'
        };
        
        return text.replace(/[&<>"'`=\/]/g, char => escapeMap[char] || char);
    }

    /**
     * کوتاه کردن متن با حفظ کلمات
     * @param {string} text - متن اصلی
     * @param {number} maxLength - حداکثر طول
     * @param {string} suffix - پسوند (مثلاً ...)
     * @returns {string} متن کوتاه شده
     */
    truncate(text, maxLength = 100, suffix = '...') {
        if (!text || text.length <= maxLength) return text || '';
        
        // حفظ کلمات کامل
        const truncated = text.substr(0, maxLength);
        const lastSpace = truncated.lastIndexOf(' ');
        
        if (lastSpace > maxLength * 0.7) {
            return truncated.substr(0, lastSpace) + suffix;
        }
        
        return truncated + suffix;
    }

    /**
     * تولید slug از متن
     * @param {string} text - متن ورودی
     * @returns {string} slug
     */
    slugify(text) {
        return text
            .toString()
            .toLowerCase()
            .normalize('NFKD') // تجزیه کاراکترهای خاص
            .replace(/[\u0300-\u036f]/g, '') // حذف اعراب
            .replace(/[^\w\s-]/g, '') // حذف کاراکترهای غیرمجاز
            .replace(/\s+/g, '-') // جایگزینی فاصله با -
            .replace(/--+/g, '-') // حذف -- تکراری
            .replace(/^-+/, '') // حذف - از ابتدا
            .replace(/-+$/, ''); // حذف - از انتها
    }

    // ==================== ARRAY UTILITIES ====================
    
    /**
     * حذف موارد تکراری از آرایه
     * @param {Array} array - آرایه ورودی
     * @param {string} key - کلید برای اشیاء (اختیاری)
     * @returns {Array} آرایه بدون تکراری
     */
    unique(array, key = null) {
        if (!Array.isArray(array)) return [];
        
        if (key) {
            const seen = new Set();
            return array.filter(item => {
                const value = item[key];
                if (seen.has(value)) return false;
                seen.add(value);
                return true;
            });
        }
        
        return [...new Set(array)];
    }

    /**
     * تقسیم آرایه به بخش‌های کوچک‌تر
     * @param {Array} array - آرایه ورودی
     * @param {number} size - اندازه هر بخش
     * @returns {Array[]} آرایه‌ای از بخش‌ها
     */
    chunk(array, size = 10) {
        if (!Array.isArray(array) || size <= 0) return [];
        
        const chunks = [];
        for (let i = 0; i < array.length; i += size) {
            chunks.push(array.slice(i, i + size));
        }
        return chunks;
    }

    /**
     * گروه‌بندی آرایه بر اساس کلید
     * @param {Array} array - آرایه ورودی
     * @param {string|Function} key - کلید یا تابع گروه‌بندی
     * @returns {Object} شیء گروه‌بندی شده
     */
    groupBy(array, key) {
        if (!Array.isArray(array)) return {};
        
        return array.reduce((groups, item) => {
            const groupKey = typeof key === 'function' 
                ? key(item) 
                : item[key];
            
            if (!groups[groupKey]) {
                groups[groupKey] = [];
            }
            
            groups[groupKey].push(item);
            return groups;
        }, {});
    }

    // ==================== OBJECT UTILITIES ====================
    
    /**
     * کپی عمیق شیء
     * @param {*} obj - شیء ورودی
     * @returns {*} کپی عمیق
     */
    deepClone(obj) {
        if (obj === null || typeof obj !== 'object') return obj;
        
        // مدیریت تاریخ
        if (obj instanceof Date) return new Date(obj.getTime());
        
        // مدیریت آرایه
        if (Array.isArray(obj)) return obj.map(item => this.deepClone(item));
        
        // مدیریت شیء ساده
        const clone = {};
        for (const key in obj) {
            if (obj.hasOwnProperty(key)) {
                clone[key] = this.deepClone(obj[key]);
            }
        }
        
        return clone;
    }

    /**
     * ادغام عمیق اشیاء
     * @param {Object} target - شیء هدف
     * @param {...Object} sources - اشیاء منبع
     * @returns {Object} شیء ادغام شده
     */
    merge(target, ...sources) {
        if (!target || typeof target !== 'object') return target;
        
        for (const source of sources) {
            if (!source || typeof source !== 'object') continue;
            
            for (const key in source) {
                if (source.hasOwnProperty(key)) {
                    if (source[key] && typeof source[key] === 'object' && 
                        target[key] && typeof target[key] === 'object') {
                        // ادغام عمیق
                        target[key] = this.merge(target[key], source[key]);
                    } else {
                        // مقداردهی ساده
                        target[key] = this.deepClone(source[key]);
                    }
                }
            }
        }
        
        return target;
    }

    // ==================== DATE/TIME UTILITIES ====================
    
    /**
     * فرمت‌دهی تاریخ
     * @param {Date|string|number} date - تاریخ
     * @param {string} format - فرمت (persian|relative|iso|custom)
     * @returns {string} تاریخ فرمت شده
     */
    formatDate(date, format = 'persian') {
        const d = new Date(date);
        if (isNaN(d.getTime())) return 'تاریخ نامعتبر';
        
        switch (format) {
            case 'persian':
                return this._toPersianDate(d);
                
            case 'relative':
                return this.relativeTime(d);
                
            case 'iso':
                return d.toISOString();
                
            case 'custom':
                return `${d.getFullYear()}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getDate().toString().padStart(2, '0')}`;
                
            default:
                return d.toLocaleDateString('fa-IR');
        }
    }

    /**
     * زمان نسبی (مثلاً "۲ دقیقه پیش")
     * @param {Date|string|number} date - تاریخ
     * @returns {string} زمان نسبی
     */
    relativeTime(date) {
        const now = new Date();
        const d = new Date(date);
        const diffMs = now - d;
        const diffSec = Math.floor(diffMs / 1000);
        const diffMin = Math.floor(diffSec / 60);
        const diffHour = Math.floor(diffMin / 60);
        const diffDay = Math.floor(diffHour / 24);
        
        if (diffSec < 10) return 'همین حالا';
        if (diffSec < 60) return `${diffSec} ثانیه پیش`;
        if (diffMin < 60) return `${diffMin} دقیقه پیش`;
        if (diffHour < 24) return `${diffHour} ساعت پیش`;
        if (diffDay === 1) return 'دیروز';
        if (diffDay < 7) return `${diffDay} روز پیش`;
        
        return this.formatDate(d, 'custom');
    }

    // ==================== VALIDATION UTILITIES ====================
    
    /**
     * اعتبارسنجی ایمیل
     * @param {string} email - آدرس ایمیل
     * @returns {boolean} معتبر بودن
     */
    isEmail(email) {
        if (!email || typeof email !== 'string') return false;
        
        const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
        return emailRegex.test(email.trim());
    }

    /**
     * اعتبارسنجی شماره موبایل ایرانی
     * @param {string} phone - شماره موبایل
     * @returns {boolean} معتبر بودن
     */
    isPhone(phone) {
        if (!phone || typeof phone !== 'string') return false;
        
        const cleaned = phone.replace(/[^\d]/g, '');
        const phoneRegex = /^09[0-9]{9}$/;
        return phoneRegex.test(cleaned);
    }

    /**
     * اعتبارسنجی رمز عبور قوی
     * @param {string} password - رمز عبور
     * @param {Object} options - تنظیمات
     * @returns {Object} نتیجه اعتبارسنجی
     */
    isStrongPassword(password, options = {}) {
        const defaults = {
            minLength: 8,
            requireUppercase: true,
            requireLowercase: true,
            requireNumbers: true,
            requireSpecialChars: true
        };
        
        const config = { ...defaults, ...options };
        
        if (!password || password.length < config.minLength) {
            return { valid: false, reason: 'طول رمز عبور کافی نیست' };
        }
        
        const checks = {
            hasUppercase: /[A-Z]/.test(password),
            hasLowercase: /[a-z]/.test(password),
            hasNumbers: /\d/.test(password),
            hasSpecialChars: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)
        };
        
        const failedChecks = [];
        if (config.requireUppercase && !checks.hasUppercase) failedChecks.push('حروف بزرگ');
        if (config.requireLowercase && !checks.hasLowercase) failedChecks.push('حروف کوچک');
        if (config.requireNumbers && !checks.hasNumbers) failedChecks.push('اعداد');
        if (config.requireSpecialChars && !checks.hasSpecialChars) failedChecks.push('کاراکترهای ویژه');
        
        return {
            valid: failedChecks.length === 0,
            checks,
            failedChecks,
            score: this._calculatePasswordStrength(password)
        };
    }

    // ==================== SECURITY UTILITIES ====================
    
    /**
     * هش کردن متن
     * @param {string} text - متن ورودی
     * @param {string} algorithm - الگوریتم (SHA-256|SHA-512)
     * @returns {Promise<string>} هش
     */
    async hash(text, algorithm = 'SHA-256') {
        if (!this.deps.crypto || !this.deps.crypto.subtle) {
            return this._fallbackHash(text);
        }
        
        try {
            const encoder = new TextEncoder();
            const data = encoder.encode(text);
            const hashBuffer = await this.deps.crypto.subtle.digest(algorithm, data);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        } catch (error) {
            this.deps.logger.error('[Utils] Hash error:', error);
            return this._fallbackHash(text);
        }
    }

    /**
     * تولید توکن تصادفی
     * @param {number} length - طول توکن
     * @returns {string} توکن
     */
    generateToken(length = 32) {
        if (!this.deps.crypto || !this.deps.crypto.getRandomValues) {
            return this._fallbackToken(length);
        }
        
        const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        const values = new Uint8Array(length);
        this.deps.crypto.getRandomValues(values);
        
        let token = '';
        for (let i = 0; i < length; i++) {
            token += charset[values[i] % charset.length];
        }
        
        return token;
    }

    // ==================== PERFORMANCE UTILITIES ====================
    
    /**
     * تابع debounce
     * @param {Function} func - تابع اصلی
     * @param {number} wait - زمان انتظار (میلی‌ثانیه)
     * @returns {Function} تابع debounced
     */
    debounce(func, wait = 300) {
        let timeout;
        
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func.apply(this, args);
            };
            
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    /**
     * تابع throttle
     * @param {Function} func - تابع اصلی
     * @param {number} limit - محدودیت زمان (میلی‌ثانیه)
     * @returns {Function} تابع throttled
     */
    throttle(func, limit = 300) {
        let inThrottle;
        
        return function(...args) {
            if (!inThrottle) {
                func.apply(this, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    }

    /**
     * تابع memoize (کش کردن نتایج)
     * @param {Function} func - تابع اصلی
     * @param {Function} resolver - تابع کلیدساز (اختیاری)
     * @returns {Function} تابع memoized
     */
    memoize(func, resolver = null) {
        const cache = new Map();
        
        return function(...args) {
            const key = resolver ? resolver.apply(this, args) : JSON.stringify(args);
            
            if (cache.has(key)) {
                return cache.get(key);
            }
            
            const result = func.apply(this, args);
            cache.set(key, result);
            return result;
        };
    }

    // ==================== PRIVATE METHODS ====================
    
    _bindMethods() {
        // بایندر خودکار متدها
        const methods = [
            ...this.methods.string,
            ...this.methods.array,
            ...this.methods.object,
            ...this.methods.datetime,
            ...this.methods.validation,
            ...this.methods.security,
            ...this.methods.performance
        ];
        
        methods.forEach(methodName => {
            if (typeof this[methodName] === 'function') {
                this[methodName] = this[methodName].bind(this);
            }
        });
    }

    _createDefaultConfig() {
        return {
            app: {
                name: 'Vakamova',
                version: '1.0.0'
            },
            utils: {
                cacheEnabled: true,
                cacheTTL: 300000, // 5 دقیقه
                securityEnabled: true
            }
        };
    }

    _createDefaultEventBus() {
        return {
            events: new Map(),
            emit(event, data) {
                console.log(`[EventBus] ${event}:`, data);
            },
            on(event, handler) {
                console.log(`[EventBus] Listening to: ${event}`);
            }
        };
    }

    _setupCache(config = {}) {
        const cacheConfig = {
            enabled: config.enabled ?? true,
            ttl: config.ttl ?? 300000,
            maxSize: config.maxSize ?? 100
        };
        
        if (cacheConfig.enabled) {
            // تنظیم cleanup خودکار برای کش
            setInterval(() => {
                this._cleanupExpiredCache();
            }, 60000); // هر دقیقه
        }
    }

    _setupPerformanceMonitoring() {
        // شروع performance monitoring
        this.state.performance = {
            marks: new Map(),
            measures: new Map(),
            startTime: Date.now()
        };
    }

    async _setupSecurity() {
        // بررسی قابلیت‌های امنیتی مرورگر
        this.state.security = {
            cryptoAvailable: !!this.deps.crypto?.subtle,
            webCryptoAvailable: !!window.crypto?.subtle,
            strongRandomAvailable: !!this.deps.crypto?.getRandomValues
        };
        
        if (!this.state.security.cryptoAvailable) {
            this.deps.logger.warn('[Utils] Web Crypto API not available, using fallback methods');
        }
    }

    _cleanupExpiredCache() {
        const now = Date.now();
        for (const [key, entry] of this.state.cache.entries()) {
            if (entry.expiry && entry.expiry < now) {
                this.state.cache.delete(key);
            }
        }
    }

    _toPersianDate(date) {
        const gregorianDate = new Date(date);
        const persianDate = new Intl.DateTimeFormat('fa-IR', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        }).format(gregorianDate);
        
        return persianDate;
    }

    _calculatePasswordStrength(password) {
        let score = 0;
        
        // طول
        if (password.length >= 8) score += 1;
        if (password.length >= 12) score += 1;
        if (password.length >= 16) score += 1;
        
        // تنوع کاراکتر
        if (/[a-z]/.test(password)) score += 1;
        if (/[A-Z]/.test(password)) score += 1;
        if (/\d/.test(password)) score += 1;
        if (/[^a-zA-Z0-9]/.test(password)) score += 1;
        
        return Math.min(score, 10);
    }

    _fallbackHash(text) {
        // Fallback ساده برای زمانی که Web Crypto API در دسترس نیست
        let hash = 0;
        for (let i = 0; i < text.length; i++) {
            const char = text.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return Math.abs(hash).toString(16);
    }

    _fallbackToken(length) {
        // Fallback برای تولید توکن
        const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let token = '';
        for (let i = 0; i < length; i++) {
            token += charset.charAt(Math.floor(Math.random() * charset.length));
        }
        return token;
    }

    // ==================== CLEANUP ====================
    cleanup() {
        // پاکسازی تایمرها
        for (const timerId of this.state.timers.values()) {
            clearTimeout(timerId);
        }
        
        // پاکسازی listeners
        for (const [event, listeners] of this.state.listeners.entries()) {
            if (this.deps.eventBus && this.deps.eventBus.off) {
                listeners.forEach(listener => {
                    this.deps.eventBus.off(event, listener);
                });
            }
        }
        
        // پاکسازی کش
        this.state.cache.clear();
        
        this.state.initialized = false;
        this.deps.logger.info('[Utils] Cleaned up');
        
        if (this.deps.eventBus && this.deps.eventBus.emit) {
            this.deps.eventBus.emit('utils:cleaned', { timestamp: Date.now() });
        }
    }

    // ==================== GETTERS ====================
    get isInitialized() {
        return this.state.initialized;
    }

    get cacheStats() {
        return {
            size: this.state.cache.size,
            keys: Array.from(this.state.cache.keys())
        };
    }

    get contract() {
        return {
            name: 'CoreUtils',
            version: '1.0.0',
            init: this.init.bind(this),
            cleanup: this.cleanup.bind(this),
            methods: this.methods
        };
    }
}

// ==================== SINGLETON EXPORT ====================
let utilsInstance = null;

function createUtils(dependencies = {}) {
    if (!utilsInstance) {
        utilsInstance = new CoreUtils(dependencies);
    }
    return utilsInstance;
}

// ==================== EXPORT ====================
export { CoreUtils, createUtils };

// برای محیط‌های غیر ماژولی
if (typeof window !== 'undefined') {
    window.Vakamova = window.Vakamova || {};
    window.Vakamova.Utils = CoreUtils;
    window.Vakamova.createUtils = createUtils;
}

console.log('[Utils] CORE_utils.js loaded successfully');
