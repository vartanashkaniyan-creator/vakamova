// ==================== CORE_utils.js ====================
// Vakamova - Professional Utilities Module (Complete Version)
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
            intl: dependencies.intl || window.Intl,
            ...dependencies
        };

        // وضعیت داخلی
        this.state = {
            initialized: false,
            cache: new Map(),
            timers: new Map(),
            listeners: new Map(),
            encryptionKeys: new Map()
        };

        // متدهای عمومی
        this.methods = {
            // رشته‌ها
            string: ['escapeHtml', 'truncate', 'slugify', 'camelCase', 'kebabCase', 'snakeCase'],
            
            // آرایه‌ها
            array: ['unique', 'chunk', 'groupBy', 'sortBy', 'filterBy', 'shuffle', 'intersection'],
            
            // شیءها
            object: ['deepClone', 'merge', 'pick', 'omit', 'flatten', 'deepEqual', 'isEmpty'],
            
            // تاریخ و زمان
            datetime: ['formatDate', 'relativeTime', 'duration', 'isToday', 'isPast', 'isFuture', 'addDays'],
            
            // اعتبارسنجی
            validation: ['isEmail', 'isPhone', 'isUrl', 'isStrongPassword', 'isNumeric', 'isAlphaNumeric'],
            
            // امنیت
            security: ['hash', 'encrypt', 'decrypt', 'generateToken', 'generateKeyPair', 'verifySignature'],
            
            // عملکرد
            performance: ['debounce', 'throttle', 'memoize', 'retry', 'batchProcess', 'measureTime'],
            
            // بین‌المللی‌سازی
            i18n: ['formatNumber', 'formatCurrency', 'getLanguageDirection', 'normalizeText']
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

            // راه‌اندازی i18n
            this._setupI18n(options.i18nConfig);

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
     */
    truncate(text, maxLength = 100, suffix = '...') {
        if (!text || text.length <= maxLength) return text || '';
        
        const truncated = text.substr(0, maxLength);
        const lastSpace = truncated.lastIndexOf(' ');
        
        if (lastSpace > maxLength * 0.7) {
            return truncated.substr(0, lastSpace) + suffix;
        }
        
        return truncated + suffix;
    }

    /**
     * تولید slug از متن
     */
    slugify(text) {
        return text
            .toString()
            .toLowerCase()
            .normalize('NFKD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^\w\s-]/g, '')
            .replace(/\s+/g, '-')
            .replace(/--+/g, '-')
            .replace(/^-+/, '')
            .replace(/-+$/, '');
    }

    /**
     * تبدیل به camelCase
     */
    camelCase(text) {
        if (!text) return '';
        
        return text
            .toString()
            .toLowerCase()
            .replace(/[^a-zA-Z0-9]+(.)/g, (match, char) => char.toUpperCase())
            .replace(/^[A-Z]/, firstChar => firstChar.toLowerCase());
    }

    /**
     * تبدیل به kebab-case
     */
    kebabCase(text) {
        if (!text) return '';
        
        return text
            .toString()
            .replace(/([a-z])([A-Z])/g, '$1-$2')
            .replace(/[\s_]+/g, '-')
            .toLowerCase()
            .replace(/[^a-z0-9-]/g, '')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');
    }

    /**
     * تبدیل به snake_case
     */
    snakeCase(text) {
        if (!text) return '';
        
        return text
            .toString()
            .replace(/([a-z])([A-Z])/g, '$1_$2')
            .replace(/[\s-]+/g, '_')
            .toLowerCase()
            .replace(/[^a-z0-9_]/g, '')
            .replace(/_+/g, '_')
            .replace(/^_|_$/g, '');
    }

    // ==================== ARRAY UTILITIES ====================
    
    /**
     * حذف موارد تکراری از آرایه
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

    /**
     * مرتب‌سازی آرایه بر اساس کلید
     */
    sortBy(array, key, order = 'asc') {
        if (!Array.isArray(array)) return [];
        
        const direction = order.toLowerCase() === 'desc' ? -1 : 1;
        
        return [...array].sort((a, b) => {
            const aValue = typeof key === 'function' ? key(a) : a[key];
            const bValue = typeof key === 'function' ? key(b) : b[key];
            
            if (aValue < bValue) return -1 * direction;
            if (aValue > bValue) return 1 * direction;
            return 0;
        });
    }

    /**
     * فیلتر آرایه بر اساس شرایط
     */
    filterBy(array, conditions) {
        if (!Array.isArray(array)) return [];
        
        return array.filter(item => {
            if (typeof conditions === 'function') {
                return conditions(item);
            }
            
            if (typeof conditions === 'object') {
                return Object.entries(conditions).every(([key, value]) => {
                    if (typeof value === 'function') {
                        return value(item[key], key, item);
                    }
                    return item[key] === value;
                });
            }
            
            return true;
        });
    }

    /**
     * تصادفی کردن ترتیب آرایه (Fisher-Yates shuffle)
     */
    shuffle(array) {
        if (!Array.isArray(array)) return [];
        
        const shuffled = [...array];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
    }

    /**
     * پیدا کردن اشتراک دو آرایه
     */
    intersection(array1, array2, key = null) {
        if (!Array.isArray(array1) || !Array.isArray(array2)) return [];
        
        if (key) {
            const set2 = new Set(array2.map(item => item[key]));
            return array1.filter(item => set2.has(item[key]));
        }
        
        const set2 = new Set(array2);
        return array1.filter(item => set2.has(item));
    }

    // ==================== OBJECT UTILITIES ====================
    
    /**
     * کپی عمیق شیء
     */
    deepClone(obj) {
        if (obj === null || typeof obj !== 'object') return obj;
        
        if (obj instanceof Date) return new Date(obj.getTime());
        
        if (Array.isArray(obj)) return obj.map(item => this.deepClone(item));
        
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
     */
    merge(target, ...sources) {
        if (!target || typeof target !== 'object') return target;
        
        for (const source of sources) {
            if (!source || typeof source !== 'object') continue;
            
            for (const key in source) {
                if (source.hasOwnProperty(key)) {
                    if (source[key] && typeof source[key] === 'object' && 
                        target[key] && typeof target[key] === 'object') {
                        target[key] = this.merge(target[key], source[key]);
                    } else {
                        target[key] = this.deepClone(source[key]);
                    }
                }
            }
        }
        
        return target;
    }

    /**
     * انتخاب ویژگی‌های خاص از شیء
     */
    pick(obj, keys) {
        if (!obj || typeof obj !== 'object') return {};
        
        const selected = {};
        const keyArray = Array.isArray(keys) ? keys : [keys];
        
        keyArray.forEach(key => {
            if (key in obj) {
                selected[key] = this.deepClone(obj[key]);
            }
        });
        
        return selected;
    }

    /**
     * حذف ویژگی‌های خاص از شیء
     */
    omit(obj, keys) {
        if (!obj || typeof obj !== 'object') return {};
        
        const result = { ...obj };
        const keyArray = Array.isArray(keys) ? keys : [keys];
        
        keyArray.forEach(key => {
            delete result[key];
        });
        
        return result;
    }

    /**
     * تبدیل شیء تو در تو به شیء تخت
     */
    flatten(obj, prefix = '', separator = '.') {
        if (!obj || typeof obj !== 'object') return {};
        
        const result = {};
        
        for (const key in obj) {
            if (obj.hasOwnProperty(key)) {
                const newKey = prefix ? `${prefix}${separator}${key}` : key;
                const value = obj[key];
                
                if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
                    Object.assign(result, this.flatten(value, newKey, separator));
                } else {
                    result[newKey] = value;
                }
            }
        }
        
        return result;
    }

    /**
     * مقایسه عمیق دو شیء
     */
    deepEqual(obj1, obj2) {
        if (obj1 === obj2) return true;
        
        if (typeof obj1 !== 'object' || typeof obj2 !== 'object' || obj1 === null || obj2 === null) {
            return obj1 === obj2;
        }
        
        const keys1 = Object.keys(obj1);
        const keys2 = Object.keys(obj2);
        
        if (keys1.length !== keys2.length) return false;
        
        for (const key of keys1) {
            if (!keys2.includes(key) || !this.deepEqual(obj1[key], obj2[key])) {
                return false;
            }
        }
        
        return true;
    }

    /**
     * بررسی خالی بودن شیء
     */
    isEmpty(obj) {
        if (!obj) return true;
        
        if (Array.isArray(obj)) return obj.length === 0;
        
        if (typeof obj === 'object') {
            return Object.keys(obj).length === 0;
        }
        
        return false;
    }

    // ==================== DATE/TIME UTILITIES ====================
    
    /**
     * فرمت‌دهی تاریخ
     */
    formatDate(date, format = 'persian', locale = 'fa-IR') {
        const d = new Date(date);
        if (isNaN(d.getTime())) return 'تاریخ نامعتبر';
        
        switch (format) {
            case 'persian':
                return this._toLocalizedDate(d, locale);
                
            case 'relative':
                return this.relativeTime(d);
                
            case 'iso':
                return d.toISOString();
                
            case 'custom':
                return `${d.getFullYear()}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getDate().toString().padStart(2, '0')}`;
                
            default:
                return d.toLocaleDateString(locale);
        }
    }

    /**
     * زمان نسبی
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

    /**
     * محاسبه مدت زمان
     */
    duration(start, end, unit = 'auto') {
        const startDate = new Date(start);
        const endDate = new Date(end);
        const diffMs = endDate - startDate;
        
        if (unit === 'auto') {
            const diffSec = Math.abs(diffMs / 1000);
            const diffMin = Math.abs(diffMs / (1000 * 60));
            const diffHour = Math.abs(diffMs / (1000 * 60 * 60));
            const diffDay = Math.abs(diffMs / (1000 * 60 * 60 * 24));
            
            if (diffDay >= 1) return `${Math.round(diffDay)} روز`;
            if (diffHour >= 1) return `${Math.round(diffHour)} ساعت`;
            if (diffMin >= 1) return `${Math.round(diffMin)} دقیقه`;
            return `${Math.round(diffSec)} ثانیه`;
        }
        
        const units = {
            ms: 1,
            seconds: 1000,
            minutes: 1000 * 60,
            hours: 1000 * 60 * 60,
            days: 1000 * 60 * 60 * 24
        };
        
        return diffMs / (units[unit] || units.ms);
    }

    /**
     * بررسی امروز بودن تاریخ
     */
    isToday(date) {
        const today = new Date();
        const checkDate = new Date(date);
        
        return today.getDate() === checkDate.getDate() &&
               today.getMonth() === checkDate.getMonth() &&
               today.getFullYear() === checkDate.getFullYear();
    }

    /**
     * بررسی گذشته بودن تاریخ
     */
    isPast(date) {
        return new Date(date) < new Date();
    }

    /**
     * بررسی آینده بودن تاریخ
     */
    isFuture(date) {
        return new Date(date) > new Date();
    }

    /**
     * اضافه کردن روز به تاریخ
     */
    addDays(date, days) {
        const result = new Date(date);
        result.setDate(result.getDate() + days);
        return result;
    }

    // ==================== VALIDATION UTILITIES ====================
    
    /**
     * اعتبارسنجی ایمیل
     */
    isEmail(email) {
        if (!email || typeof email !== 'string') return false;
        
        const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
        return emailRegex.test(email.trim());
    }

    /**
     * اعتبارسنجی شماره تلفن بین‌المللی
     */
    isPhone(phone, countryCode = null) {
        if (!phone || typeof phone !== 'string') return false;
        
        const cleaned = phone.replace(/[^\d+]/g, '');
        
        // اگر کد کشور مشخص شده
        if (countryCode) {
            const patterns = {
                'IR': /^(\+98|0)?9\d{9}$/, // ایران
                'US': /^(\+1)?[2-9]\d{9}$/, // آمریکا
                'UK': /^(\+44|0)7\d{9}$/, // انگلیس
                'DE': /^(\+49|0)[1-9]\d{10,11}$/, // آلمان
                'FR': /^(\+33|0)[67]\d{8}$/, // فرانسه
                'default': /^\+[1-9]\d{1,14}$/ // فرمت بین‌المللی
            };
            
            const pattern = patterns[countryCode] || patterns.default;
            return pattern.test(cleaned);
        }
        
        // بررسی فرمت عمومی
        const generalPattern = /^(\+\d{1,3})?[\d\s\-\(\)]{6,}$/;
        return generalPattern.test(cleaned);
    }

    /**
     * اعتبارسنجی URL
     */
    isUrl(url, options = {}) {
        if (!url || typeof url !== 'string') return false;
        
        const defaults = {
            requireProtocol: true,
            allowLocalhost: false,
            allowedProtocols: ['http:', 'https:', 'ftp:']
        };
        
        const config = { ...defaults, ...options };
        
        try {
            const urlObj = new URL(url);
            
            if (config.requireProtocol && !config.allowedProtocols.includes(urlObj.protocol)) {
                return false;
            }
            
            if (!config.allowLocalhost && urlObj.hostname === 'localhost') {
                return false;
            }
            
            return true;
        } catch {
            return false;
        }
    }

    /**
     * اعتبارسنجی رمز عبور قوی
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

    /**
     * بررسی عددی بودن
     */
    isNumeric(value) {
        if (typeof value === 'number') return !isNaN(value);
        if (typeof value !== 'string') return false;
        return !isNaN(value) && !isNaN(parseFloat(value));
    }

    /**
     * بررسی آلفانومریک بودن
     */
    isAlphaNumeric(text, options = {}) {
        if (!text || typeof text !== 'string') return false;
        
        const defaults = {
            allowSpaces: false,
            allowSpecialChars: false
        };
        
        const config = { ...defaults, ...options };
        
        let pattern = '^[a-zA-Z0-9';
        if (config.allowSpaces) pattern += '\\s';
        if (config.allowSpecialChars) pattern += '\\w\\W';
        pattern += ']*$';
        
        return new RegExp(pattern).test(text);
    }

    // ==================== SECURITY UTILITIES ====================
    
    /**
     * هش کردن متن
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
     * رمزنگاری متن
     */
    async encrypt(text, keyId = 'default', options = {}) {
        if (!this.deps.crypto || !this.deps.crypto.subtle) {
            throw new Error('Web Crypto API not available');
        }
        
        try {
            const defaults = {
                algorithm: { name: 'AES-GCM', length: 256 },
                extractable: false,
                keyUsages: ['encrypt', 'decrypt']
            };
            
            const config = { ...defaults, ...options };
            
            // دریافت یا ایجاد کلید
            let key = this.state.encryptionKeys.get(keyId);
            if (!key) {
                key = await this.deps.crypto.subtle.generateKey(
                    config.algorithm,
                    config.extractable,
                    config.keyUsages
                );
                this.state.encryptionKeys.set(keyId, key);
            }
            
            const encoder = new TextEncoder();
            const data = encoder.encode(text);
            const iv = this.deps.crypto.getRandomValues(new Uint8Array(12));
            
            const encrypted = await this.deps.crypto.subtle.encrypt(
                { name: 'AES-GCM', iv },
                key,
                data
            );
            
            return {
                encrypted: Array.from(new Uint8Array(encrypted)),
                iv: Array.from(iv),
                keyId,
                algorithm: config.algorithm.name
            };
            
        } catch (error) {
            this.deps.logger.error('[Utils] Encryption error:', error);
            throw error;
        }
    }

    /**
     * رمزگشایی متن
     */
    async decrypt(encryptedData, keyId = 'default') {
        if (!this.deps.crypto || !this.deps.crypto.subtle) {
            throw new Error('Web Crypto API not available');
        }
        
        try {
            const key = this.state.encryptionKeys.get(keyId);
            if (!key) {
                throw new Error(`Encryption key not found: ${keyId}`);
            }
            
            const { encrypted, iv, algorithm } = encryptedData;
            
            const decrypted = await this.deps.crypto.subtle.decrypt(
                { name: algorithm || 'AES-GCM', iv: new Uint8Array(iv) },
                key,
                new Uint8Array(encrypted)
            );
            
            const decoder = new TextDecoder();
            return decoder.decode(decrypted);
            
        } catch (error) {
            this.deps.logger.error('[Utils] Decryption error:', error);
            throw error;
        }
    }

    /**
     * تولید توکن تصادفی
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

    /**
     * تولید جفت کلید عمومی/خصوصی
     */
    async generateKeyPair(keyId = 'default', options = {}) {
        if (!this.deps.crypto || !this.deps.crypto.subtle) {
            throw new Error('Web Crypto API not available');
        }
        
        try {
            const defaults = {
                algorithm: { 
                    name: 'RSA-OAEP', 
                    modulusLength: 2048,
                    publicExponent: new Uint8Array([1, 0, 1]),
                    hash: 'SHA-256'
                },
                extractable: true,
                keyUsages: ['encrypt', 'decrypt']
            };
            
            const config = { ...defaults, ...options };
            
            const keyPair = await this.deps.crypto.subtle.generateKey(
                config.algorithm,
                config.extractable,
                ['encrypt', 'decrypt']
            );
            
            this.state.encryptionKeys.set(`${keyId}_public`, keyPair.publicKey);
            this.state.encryptionKeys.set(`${keyId}_private`, keyPair.privateKey);
            
            return {
                publicKey: keyPair.publicKey,
                privateKey: keyPair.privateKey,
                keyId,
                algorithm: config.algorithm.name
            };
            
        } catch (error) {
            this.deps.logger.error('[Utils] Key pair generation error:', error);
            throw error;
        }
    }

    /**
     * تأیید امضا
     */
    async verifySignature(data, signature, keyId) {
        if (!this.deps.crypto || !this.deps.crypto.subtle) {
            throw new Error('Web Crypto API not available');
        }
        
        try {
            const key = this.state.encryptionKeys.get(keyId);
            if (!key) {
                throw new Error(`Verification key not found: ${keyId}`);
            }
            
            const encoder = new TextEncoder();
            const encodedData = encoder.encode(data);
            
            const isValid = await this.deps.crypto.subtle.verify(
                { name: 'RSA-PSS', saltLength: 32 },
                key,
                new Uint8Array(signature),
                encodedData
            );
            
            return isValid;
            
        } catch (error) {
            this.deps.logger.error('[Utils] Signature verification error:', error);
            throw error;
        }
    }

    // ==================== PERFORMANCE UTILITIES ====================
    
    /**
     * تابع debounce
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

    /**
     * اجرای مجدد عملیات در صورت شکست
     */
    async retry(operation, options = {}) {
        const defaults = {
            maxAttempts: 3,
            delay: 1000,
            backoff: true,
            shouldRetry: error => true
        };
        
        const config = { ...defaults, ...options };
        
        let lastError;
        
        for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
            try {
                const result = await operation(attempt);
                return { success: true, result, attempts: attempt };
            } catch (error) {
                lastError = error;
                
                if (!config.shouldRetry(error) || attempt === config.maxAttempts) {
                    break;
                }
                
                const delay = config.backoff 
                    ? config.delay * Math.pow(2, attempt - 1)
                    : config.delay;
                
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
        
        return { 
            success: false, 
            error: lastError, 
            attempts: config.maxAttempts 
        };
    }

    /**
     * پردازش دسته‌ای
     */
    async batchProcess(items, processor, options = {}) {
        const defaults = {
            batchSize: 10,
            concurrency: 1,
            onProgress: null
        };
        
        const config = { ...defaults, ...options };
        
        const batches = this.chunk(items, config.batchSize);
        const results = [];
        let processed = 0;
        
        for (let i = 0; i < batches.length; i += config.concurrency) {
            const currentBatches = batches.slice(i, i + config.concurrency);
            
            const batchPromises = currentBatches.map(async (batch, batchIndex) => {
                const batchResult = await processor(batch, i + batchIndex);
                processed += batch.length;
                
                if (config.onProgress) {
                    config.onProgress({
                        total: items.length,
                        processed,
                        percentage: (processed / items.length) * 100,
                        currentBatch: batch
                    });
                }
                
                return batchResult;
            });
            
            const batchResults = await Promise.all(batchPromises);
            results.push(...batchResults);
        }
        
        return results;
    }

    /**
     * اندازه‌گیری زمان اجرا
     */
    async measureTime(operation, label = 'Operation') {
        const start = performance.now();
        
        try {
            const result = await operation();
            const end = performance.now();
            const duration = end - start;
            
            this.deps.logger.info(`[Performance] ${label}: ${duration.toFixed(2)}ms`);
            
            return {
                success: true,
                result,
                duration,
                label
            };
        } catch (error) {
            const end = performance.now();
            const duration = end - start;
            
            this.deps.logger.error(`[Performance] ${label} failed after ${duration.toFixed(2)}ms:`, error);
            
            return {
                success: false,
                error,
                duration,
                label
            };
        }
    }

    // ==================== I18N UTILITIES ====================
    
    /**
     * فرمت اعداد
     */
    formatNumber(number, locale = 'fa-IR', options = {}) {
        if (!this.deps.intl || !this.deps.intl.NumberFormat) {
            return number.toString();
        }
        
        const defaults = {
            minimumFractionDigits: 0,
            maximumFractionDigits: 2
        };
        
        const config = { ...defaults, ...options };
        
        try {
            const formatter = new Intl.NumberFormat(locale, config);
            return formatter.format(number);
        } catch (error) {
            this.deps.logger.warn('[Utils] Number formatting error:', error);
            return number.toString();
        }
    }

    /**
     * فرمت ارز
     */
    formatCurrency(amount, currency = 'IRR', locale = 'fa-IR', options = {}) {
        if (!this.deps.intl || !this.deps.intl.NumberFormat) {
            return `${amount} ${currency}`;
        }
        
        const defaults = {
            style: 'currency',
            currency,
            minimumFractionDigits: 0
        };
        
        const config = { ...defaults, ...options };
        
        try {
            const formatter = new Intl.NumberFormat(locale, config);
            return formatter.format(amount);
        } catch (error) {
            this.deps.logger.warn('[Utils] Currency formatting error:', error);
            return `${amount} ${currency}`;
        }
    }

    /**
     * دریافت جهت زبان
     */
    getLanguageDirection(languageCode) {
        const rtlLanguages = ['ar', 'fa', 'he', 'ur', 'ku', 'ps', 'sd'];
        return rtlLanguages.includes(languageCode.toLowerCase()) ? 'rtl' : 'ltr';
    }

    /**
     * نرمال‌سازی متن برای جستجو
     */
    normalizeText(text, options = {}) {
        if (!text || typeof text !== 'string') return '';
        
        const defaults = {
            removeDiacritics: true,
            toLowerCase: true,
            trim: true,
            removeExtraSpaces: true
        };
        
        const config = { ...defaults, ...options };
        
        let normalized = text;
        
        if (config.removeDiacritics) {
            normalized = normalized.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
        }
        
        if (config.toLowerCase) {
            normalized = normalized.toLowerCase();
        }
        
        if (config.trim) {
            normalized = normalized.trim();
        }
        
        if (config.removeExtraSpaces) {
            normalized = normalized.replace(/\s+/g, ' ');
        }
        
        return normalized;
    }

    // ==================== PRIVATE METHODS ====================
    
    _bindMethods() {
        const allMethods = Object.values(this.methods).flat();
        allMethods.forEach(methodName => {
            if (typeof this[methodName] === 'function') {
                this[methodName] = this[methodName].bind(this);
            }
        });
    }

    _createDefaultConfig() {
        return {
            app: {
                name: 'Vakamova',
                version: '1.0.0',
                supportedLanguages: ['fa', 'en', 'ar', 'tr', 'de', 'es', 'fr', 'ru', 'zh', 'ja', 'ko', 'it']
            },
            utils: {
                cacheEnabled: true,
                cacheTTL: 300000,
                securityEnabled: true,
                defaultLocale: 'fa-IR',
                fallbackLocale: 'en-US'
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
                return () => {};
            },
            off(event, handler) {
                console.log(`[EventBus] Stopped listening to: ${event}`);
            }
        };
    }

    _setupCache(config = {}) {
        const cacheConfig = {
            enabled: config.enabled ?? true,
            ttl: config.ttl ?? 300000,
            maxSize: config.maxSize ?? 100,
            cleanupInterval: config.cleanupInterval ?? 60000
        };
        
        if (cacheConfig.enabled) {
            this.state.cacheCleanupInterval = setInterval(() => {
                this._cleanupExpiredCache();
            }, cacheConfig.cleanupInterval);
        }
    }

    _setupPerformanceMonitoring() {
        this.state.performance = {
            marks: new Map(),
            measures: new Map(),
            startTime: Date.now(),
            metrics: {
                operations: 0,
                averageTime: 0,
                errors: 0
            }
        };
    }

    async _setupSecurity() {
        this.state.security = {
            cryptoAvailable: !!this.deps.crypto?.subtle,
            webCryptoAvailable: !!window.crypto?.subtle,
            strongRandomAvailable: !!this.deps.crypto?.getRandomValues,
            keyStorage: new Map()
        };
        
        if (!this.state.security.cryptoAvailable) {
            this.deps.logger.warn('[Utils] Web Crypto API not available, using fallback methods');
        }
    }

    _setupI18n(config = {}) {
        this.state.i18n = {
            defaultLocale: config.defaultLocale || 'fa-IR',
            fallbackLocale: config.fallbackLocale || 'en-US',
            supportedLocales: config.supportedLocales || ['fa-IR', 'en-US', 'ar-SA'],
            direction: 'rtl',
            formatters: new Map()
        };
    }

    _cleanupExpiredCache() {
        const now = Date.now();
        let expiredCount = 0;
        
        for (const [key, entry] of this.state.cache.entries()) {
            if (entry.expiry && entry.expiry < now) {
                this.state.cache.delete(key);
                expiredCount++;
            }
        }
        
        if (expiredCount > 0) {
            this.deps.logger.debug(`[Utils] Cleaned ${expiredCount} expired cache entries`);
        }
    }

    _toLocalizedDate(date, locale = 'fa-IR') {
        try {
            return new Intl.DateTimeFormat(locale, {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                weekday: 'long'
            }).format(date);
        } catch (error) {
            this.deps.logger.warn('[Utils] Date formatting error:', error);
            return date.toLocaleDateString(locale);
        }
    }

    _calculatePasswordStrength(password) {
        let score = 0;
        
        // طول
        if (password.length >= 8) score += 1;
        if (password.length >= 12) score += 1;
        if (password.length >= 16) score += 2;
        
        // تنوع کاراکتر
        if (/[a-z]/.test(password)) score += 1;
        if (/[A-Z]/.test(password)) score += 1;
        if (/\d/.test(password)) score += 1;
        if (/[^a-zA-Z0-9]/.test(password)) score += 2;
        
        // الگوهای رایج
        const commonPatterns = [
            '123456', 'password', 'qwerty', 'admin', 'welcome'
        ];
        
        if (!commonPatterns.some(pattern => password.toLowerCase().includes(pattern))) {
            score += 1;
        }
        
        // آنتروپی
        const charSetSize = new Set(password).size;
        score += Math.min(Math.floor(charSetSize / 5), 3);
        
        return Math.min(score, 10);
    }

    _fallbackHash(text) {
        let hash = 0;
        for (let i = 0; i < text.length; i++) {
            const char = text.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return Math.abs(hash).toString(16).padStart(8, '0');
    }

    _fallbackToken(length) {
        const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let token = '';
        for (let i = 0; i < length; i++) {
            token += charset.charAt(Math.floor(Math.random() * charset.length));
        }
        return token;
    }

    // ==================== CLEANUP ====================
    async cleanup() {
        // پاکسازی تایمرها
        for (const timerId of this.state.timers.values()) {
            clearTimeout(timerId);
        }
        
        if (this.state.cacheCleanupInterval) {
            clearInterval(this.state.cacheCleanupInterval);
        }
        
        // پاکسازی listeners
        for (const [event, listeners] of this.state.listeners.entries()) {
            if (this.deps.eventBus && this.deps.eventBus.off) {
                listeners.forEach(listener => {
                    this.deps.eventBus.off(event, listener);
                });
            }
        }
        
        // پاکسازی کلیدهای رمزنگاری
        this.state.encryptionKeys.clear();
        
        // پاکسازی کش
        this.state.cache.clear();
        
        this.state.initialized = false;
        this.deps.logger.info('[Utils] Cleaned up successfully');
        
        if (this.deps.eventBus && this.deps.eventBus.emit) {
            this.deps.eventBus.emit('utils:cleaned', { timestamp: Date.now() });
        }
        
        return { success: true };
    }

    // ==================== GETTERS ====================
    get isInitialized() {
        return this.state.initialized;
    }

    get cacheStats() {
        return {
            size: this.state.cache.size,
            keys: Array.from(this.state.cache.keys()),
            hitRate: this.state.cacheHits ? (this.state.cacheHits / (this.state.cacheHits + this.state.cacheMisses)) * 100 : 0
        };
    }

    get performanceStats() {
        return this.state.performance?.metrics || {};
    }

    get securityStatus() {
        return this.state.security || {};
    }

    get contract() {
        return {
            name: 'CoreUtils',
            version: '2.0.0',
            init: this.init.bind(this),
            cleanup: this.cleanup.bind(this),
            methods: this.methods,
            dependencies: Object.keys(this.deps)
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
    window.Vakamova.utils = createUtils();
}

console.log('[Utils] CORE_utils.js v2.0.0 loaded successfully');
