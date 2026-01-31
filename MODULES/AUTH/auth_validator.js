
/**
 * VAKAMOVA AUTH VALIDATOR - سیستم اعتبارسنجی پیشرفته
 * اصول: تزریق وابستگی، قرارداد رابط، رویدادمحور، پیکربندی متمرکز
 * وابستگی داخلی: auth_utils.js (از طریق DI)
 */

class AuthValidator {
    constructor(dependencies = {}, eventSystem = null) {
        // تزریق وابستگی‌ها
        this._deps = this._validateDependencies(dependencies);
        this._eventSystem = eventSystem || { emit: () => {}, on: () => () => {} };
        
        // پیکربندی متمرکز اعتبارسنجی
        this._config = Object.freeze({
            validationRules: {
                email: {
                    required: true,
                    maxLength: 254,
                    domains: {
                        allowed: ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com'],
                        blocked: ['tempmail.com', 'throwaway.com', '10minutemail.com']
                    },
                    disposableCheck: true
                },
                username: {
                    required: true,
                    minLength: 3,
                    maxLength: 30,
                    reservedNames: ['admin', 'root', 'system', 'support', 'moderator'],
                    pattern: /^[a-zA-Z0-9_.-]+$/,
                    excludePatterns: [/\.\./, /__/, /--/, /\.$/, /^-/, /-$/]
                },
                password: {
                    required: true,
                    minLength: 8,
                    maxLength: 128,
                    historyCheck: true,
                    maxHistory: 5,
                    commonPasswords: [
                        'password', '12345678', 'qwerty123', 'admin123', 'welcome1'
                    ]
                },
                phone: {
                    pattern: /^\+?[1-9]\d{1,14}$/,
                    countryCodes: ['+98', '+1', '+44', '+91'],
                    format: 'E.164'
                },
                profile: {
                    displayName: { minLength: 2, maxLength: 50 },
                    birthDate: { minAge: 13, maxAge: 120 },
                    country: { allowed: ['IR', 'US', 'GB', 'DE', 'FR', 'TR', 'AE'] }
                }
            },
            security: {
                maxAttempts: 5,
                lockoutDuration: 15 * 60 * 1000, // 15 دقیقه
                rateLimit: { window: 60 * 1000, max: 10 } // ۱۰ درخواست در دقیقه
            },
            messages: {
                fa: {
                    required: 'این فیلد الزامی است',
                    invalidEmail: 'ایمیل معتبر نیست',
                    weakPassword: 'رمز عبور باید شامل حروف بزرگ، کوچک، عدد و کاراکتر ویژه باشد',
                    usernameTaken: 'این نام کاربری قبلاً انتخاب شده',
                    tooManyAttempts: 'تلاش‌های ناموفق زیاد، لطفاً ${time} دقیقه صبر کنید'
                },
                en: {
                    required: 'This field is required',
                    invalidEmail: 'Invalid email address',
                    weakPassword: 'Password must include uppercase, lowercase, number and special character',
                    usernameTaken: 'Username is already taken',
                    tooManyAttempts: 'Too many failed attempts, please wait ${time} minutes'
                }
            }
        });
        
        // سیستم کش و محدودیت
        this._cache = new Map();
        this._attempts = new Map();
        this._rateLimits = new Map();
        
        // متریک‌های عملکرد
        this._metrics = {
            validations: 0,
            successes: 0,
            failures: 0,
            cacheHits: 0,
            rateLimited: 0
        };
        
        // وضعیت اعتبارسنجی
        this._state = {
            lockedUsers: new Set(),
            validationSessions: new Map(),
            activeRules: new Set(Object.keys(this._config.validationRules))
        };
        
        Object.seal(this._config);
        Object.seal(this._metrics);
        
        // راه‌اندازی Event Listeners
        this._setupEventListeners();
    }
    
    // ==================== CORE VALIDATION METHODS ====================
    
    async validateEmail(email, context = {}) {
        this._metrics.validations++;
        const sessionId = context.sessionId || this._generateSessionId();
        
        // کش بررسی
        const cacheKey = `email_${email}_${JSON.stringify(context)}`;
        if (this._cache.has(cacheKey)) {
            this._metrics.cacheHits++;
            return this._cache.get(cacheKey);
        }
        
        // بررسی Rate Limit
        if (!this._checkRateLimit('email_validation', context.userId)) {
            this._metrics.rateLimited++;
            return this._createValidationResult(false, {
                code: 'RATE_LIMIT_EXCEEDED',
                message: this._getMessage('tooManyAttempts', context.language),
                field: 'email'
            });
        }
        
        const result = {
            valid: false,
            field: 'email',
            value: email,
            rules: [],
            warnings: [],
            suggestions: [],
            normalized: null,
            timestamp: Date.now(),
            sessionId
        };
        
        // 1. بررسی وجود
        if (!email || typeof email !== 'string') {
            result.rules.push({ name: 'required', passed: false });
            result.message = this._getMessage('required', context.language);
            this._cacheResult(cacheKey, result);
            return result;
        }
        
        const trimmedEmail = email.trim().toLowerCase();
        result.normalized = trimmedEmail;
        
        // 2. اعتبارسنجی ساختاری با auth_utils
        const basicValidation = this._deps.authUtils.validateEmail(trimmedEmail);
        if (!basicValidation.valid) {
            result.rules.push({ name: 'format', passed: false });
            result.message = basicValidation.error || this._getMessage('invalidEmail', context.language);
            result.code = basicValidation.code;
            this._cacheResult(cacheKey, result);
            return result;
        }
        
        result.rules.push({ name: 'format', passed: true });
        
        // 3. بررسی دامنه
        const domain = trimmedEmail.split('@')[1];
        const domainRules = this._config.validationRules.email.domains;
        
        if (domainRules.blocked.includes(domain)) {
            result.rules.push({ name: 'domain_allowed', passed: false });
            result.message = 'دامنه ایمیل مجاز نیست';
            result.code = 'DOMAIN_BLOCKED';
            this._cacheResult(cacheKey, result);
            return result;
        }
        
        if (domainRules.allowed.length > 0 && !domainRules.allowed.includes(domain)) {
            result.warnings.push({
                type: 'domain_uncommon',
                message: 'دامنه ایمیل غیرمعمول است',
                suggestion: `آیا از ${domainRules.allowed[0]} استفاده می‌کنید؟`
            });
        }
        
        result.rules.push({ name: 'domain_allowed', passed: true });
        
        // 4. بررسی ایمیل موقت (در صورت فعال بودن)
        if (this._config.validationRules.email.disposableCheck) {
            const isDisposable = await this._checkDisposableEmail(trimmedEmail);
            if (isDisposable) {
                result.rules.push({ name: 'disposable', passed: false });
                result.message = 'ایمیل موقت قابل قبول نیست';
                result.code = 'DISPOSABLE_EMAIL';
                this._cacheResult(cacheKey, result);
                return result;
            }
        }
        
        result.rules.push({ name: 'disposable', passed: true });
        
        // 5. بررسی طول
        if (trimmedEmail.length > this._config.validationRules.email.maxLength) {
            result.rules.push({ name: 'max_length', passed: false });
            result.message = `ایمیل نمی‌تواند بیشتر از ${this._config.validationRules.email.maxLength} کاراکتر باشد`;
            this._cacheResult(cacheKey, result);
            return result;
        }
        
        result.rules.push({ name: 'max_length', passed: true });
        
        // اعتبارسنجی موفق
        result.valid = true;
        result.rules.forEach(rule => rule.passed = true);
        result.message = 'ایمیل معتبر است';
        
        this._metrics.successes++;
        this._cacheResult(cacheKey, result);
        
        // ارسال رویداد
        this._eventSystem.emit('auth:validation:success', {
            field: 'email',
            value: trimmedEmail,
            sessionId,
            timestamp: Date.now()
        });
        
        return result;
    }
    
    async validateUsername(username, context = {}) {
        this._metrics.validations++;
        const sessionId = context.sessionId || this._generateSessionId();
        
        const cacheKey = `username_${username}_${JSON.stringify(context)}`;
        if (this._cache.has(cacheKey)) {
            this._metrics.cacheHits++;
            return this._cache.get(cacheKey);
        }
        
        // Rate Limit
        if (!this._checkRateLimit('username_validation', context.userId)) {
            this._metrics.rateLimited++;
            return this._createValidationResult(false, {
                code: 'RATE_LIMIT_EXCEEDED',
                message: this._getMessage('tooManyAttempts', context.language),
                field: 'username'
            });
        }
        
        const result = {
            valid: false,
            field: 'username',
            value: username,
            rules: [],
            warnings: [],
            suggestions: [],
            normalized: null,
            timestamp: Date.now(),
            sessionId
        };
        
        // 1. بررسی وجود
        if (!username || typeof username !== 'string') {
            result.rules.push({ name: 'required', passed: false });
            result.message = this._getMessage('required', context.language);
            this._cacheResult(cacheKey, result);
            return result;
        }
        
        const trimmedUsername = username.trim();
        result.normalized = trimmedUsername;
        
        // 2. اعتبارسنجی با auth_utils
        const basicValidation = this._deps.authUtils.validateUsername(trimmedUsername);
        if (!basicValidation.valid) {
            result.rules.push({ name: 'basic_format', passed: false });
            result.message = basicValidation.error;
            result.code = basicValidation.code;
            this._cacheResult(cacheKey, result);
            return result;
        }
        
        result.rules.push({ name: 'basic_format', passed: true });
        
        const rules = this._config.validationRules.username;
        
        // 3. بررسی طول
        if (trimmedUsername.length < rules.minLength || trimmedUsername.length > rules.maxLength) {
            result.rules.push({ name: 'length', passed: false });
            result.message = `نام کاربری باید بین ${rules.minLength} تا ${rules.maxLength} کاراکتر باشد`;
            this._cacheResult(cacheKey, result);
            return result;
        }
        
        result.rules.push({ name: 'length', passed: true });
        
        // 4. بررسی الگو
        if (!rules.pattern.test(trimmedUsername)) {
            result.rules.push({ name: 'pattern', passed: false });
            result.message = 'نام کاربری فقط می‌تواند شامل حروف، اعداد، نقطه، خط تیره و زیرخط باشد';
            this._cacheResult(cacheKey, result);
            return result;
        }
        
        result.rules.push({ name: 'pattern', passed: true });
        
        // 5. بررسی الگوهای ممنوع
        for (const excludePattern of rules.excludePatterns) {
            if (excludePattern.test(trimmedUsername)) {
                result.rules.push({ name: 'exclude_patterns', passed: false });
                result.message = 'نام کاربری حاوی الگوهای غیرمجاز است';
                this._cacheResult(cacheKey, result);
                return result;
            }
        }
        
        result.rules.push({ name: 'exclude_patterns', passed: true });
        
        // 6. بررسی نام‌های رزرو شده
        if (rules.reservedNames.includes(trimmedUsername.toLowerCase())) {
            result.rules.push({ name: 'reserved', passed: false });
            result.message = this._getMessage('usernameTaken', context.language);
            result.code = 'USERNAME_RESERVED';
            this._cacheResult(cacheKey, result);
            return result;
        }
        
        result.rules.push({ name: 'reserved', passed: true });
        
        // 7. بررسی تکراری بودن (با شبیه‌سازی)
        if (context.checkAvailability) {
            const isAvailable = await this._checkUsernameAvailability(trimmedUsername);
            if (!isAvailable) {
                result.rules.push({ name: 'availability', passed: false });
                result.message = this._getMessage('usernameTaken', context.language);
                result.code = 'USERNAME_TAKEN';
                this._cacheResult(cacheKey, result);
                return result;
            }
        }
        
        result.rules.push({ name: 'availability', passed: context.checkAvailability ? true : 'skipped' });
        
        // موفق
        result.valid = true;
        result.message = 'نام کاربری معتبر است';
        this._metrics.successes++;
        this._cacheResult(cacheKey, result);
        
        this._eventSystem.emit('auth:validation:success', {
            field: 'username',
            value: trimmedUsername,
            sessionId,
            timestamp: Date.now()
        });
        
        return result;
    }
    
    async validatePassword(password, context = {}) {
        this._metrics.validations++;
        const sessionId = context.sessionId || this._generateSessionId();
        
        const cacheKey = `password_${password}_${JSON.stringify(context)}`;
        if (this._cache.has(cacheKey)) {
            this._metrics.cacheHits++;
            return this._cache.get(cacheKey);
        }
        
        const result = {
            valid: false,
            field: 'password',
            value: null, // برای امنیت مقدار ذخیره نمی‌شود
            rules: [],
            warnings: [],
            suggestions: [],
            strength: 0,
            normalized: null,
            timestamp: Date.now(),
            sessionId
        };
        
        // 1. بررسی وجود
        if (!password || typeof password !== 'string') {
            result.rules.push({ name: 'required', passed: false });
            result.message = this._getMessage('required', context.language);
            this._cacheResult(cacheKey, result);
            return result;
        }
        
        // 2. اعتبارسنجی با auth_utils
        const validation = this._deps.authUtils.validatePassword(password, {
            requireUppercase: true,
            requireLowercase: true,
            requireNumbers: true,
            requireSpecialChars: true
        });
        
        if (!validation.valid) {
            result.rules.push({ name: 'strength', passed: false });
            result.message = validation.errors ? validation.errors[0] : this._getMessage('weakPassword', context.language);
            result.details = validation.errors;
            result.strength = validation.score;
            this._cacheResult(cacheKey, result);
            return result;
        }
        
        result.rules.push({ name: 'strength', passed: true });
        result.strength = validation.score;
        
        const rules = this._config.validationRules.password;
        
        // 3. بررسی طول
        if (password.length < rules.minLength || password.length > rules.maxLength) {
            result.rules.push({ name: 'length', passed: false });
            result.message = `رمز عبور باید بین ${rules.minLength} تا ${rules.maxLength} کاراکتر باشد`;
            this._cacheResult(cacheKey, result);
            return result;
        }
        
        result.rules.push({ name: 'length', passed: true });
        
        // 4. بررسی رمزهای رایج
        if (rules.commonPasswords.includes(password.toLowerCase())) {
            result.rules.push({ name: 'common', passed: false });
            result.message = 'این رمز عبور بسیار رایج است، لطفاً رمز قوی‌تری انتخاب کنید';
            result.suggestions.push('از ترکیب حروف، اعداد و کاراکترهای ویژه استفاده کنید');
            this._cacheResult(cacheKey, result);
            return result;
        }
        
        result.rules.push({ name: 'common', passed: true });
        
        // 5. بررسی تاریخچه (در صورت وجود userId)
        if (rules.historyCheck && context.userId && context.passwordHistory) {
            const isReused = await this._checkPasswordHistory(password, context.userId, context.passwordHistory);
            if (isReused) {
                result.rules.push({ name: 'history', passed: false });
                result.message = 'این رمز عبور قبلاً استفاده شده است';
                result.suggestions.push('لطفاً رمز عبور جدیدی انتخاب کنید');
                this._cacheResult(cacheKey, result);
                return result;
            }
        }
        
        result.rules.push({ name: 'history', passed: rules.historyCheck ? true : 'skipped' });
        
        // موفق
        result.valid = true;
        result.message = 'رمز عبور معتبر است';
        result.suggestions = this._getPasswordSuggestions(validation.score);
        this._metrics.successes++;
        this._cacheResult(cacheKey, result);
        
        this._eventSystem.emit('auth:validation:success', {
            field: 'password',
            strength: validation.score,
            sessionId,
            timestamp: Date.now()
        });
        
        return result;
    }
    
    // ==================== FORM VALIDATION ====================
    
    async validateRegistrationForm(formData, context = {}) {
        const sessionId = context.sessionId || this._generateSessionId();
        const results = {};
        const errors = [];
        
        // اعتبارسنجی موازی فیلدها
        const validations = await Promise.allSettled([
            this.validateEmail(formData.email, { ...context, sessionId }),
            this.validateUsername(formData.username, { 
                ...context, 
                sessionId,
                checkAvailability: true 
            }),
            this.validatePassword(formData.password, { ...context, sessionId })
        ]);
        
        // پردازش نتایج
        const fields = ['email', 'username', 'password'];
        validations.forEach((validation, index) => {
            const field = fields[index];
            
            if (validation.status === 'fulfilled') {
                results[field] = validation.value;
                if (!validation.value.valid) {
                    errors.push({
                        field,
                        message: validation.value.message,
                        code: validation.value.code
                    });
                }
            } else {
                results[field] = {
                    valid: false,
                    field,
                    message: 'خطا در اعتبارسنجی',
                    code: 'VALIDATION_ERROR',
                    error: validation.reason
                };
                errors.push({
                    field,
                    message: 'خطای سیستمی',
                    code: 'SYSTEM_ERROR'
                });
            }
        });
        
        // اعتبارسنجی اضافی
        if (formData.confirmPassword && formData.password !== formData.confirmPassword) {
            results.confirmPassword = {
                valid: false,
                field: 'confirmPassword',
                message: 'تکرار رمز عبور مطابقت ندارد',
                code: 'PASSWORD_MISMATCH'
            };
            errors.push({
                field: 'confirmPassword',
                message: 'تکرار رمز عبور مطابقت ندارد',
                code: 'PASSWORD_MISMATCH'
            });
        }
        
        // بررسی شرایط و ضوابط
        if (formData.terms !== true) {
            results.terms = {
                valid: false,
                field: 'terms',
                message: 'پذیرش شرایط و ضوابط الزامی است',
                code: 'TERMS_NOT_ACCEPTED'
            };
            errors.push({
                field: 'terms',
                message: 'پذیرش شرایط و ضوابط الزامی است',
                code: 'TERMS_NOT_ACCEPTED'
            });
        }
        
        const overallValid = errors.length === 0;
        
        const finalResult = {
            valid: overallValid,
            sessionId,
            timestamp: Date.now(),
            results,
            errors: overallValid ? null : errors,
            warnings: this._collectWarnings(results),
            suggestions: this._collectSuggestions(results),
            score: this._calculateFormScore(results)
        };
        
        // ارسال رویداد
        this._eventSystem.emit(overallValid ? 
            'auth:form:validation:success' : 
            'auth:form:validation:failed', {
            formType: 'registration',
            sessionId,
            valid: overallValid,
            errorCount: errors.length,
            score: finalResult.score
        });
        
        return finalResult;
    }
    
    async validateLoginForm(formData, context = {}) {
        const sessionId = context.sessionId || this._generateSessionId();
        
        // بررسی Lockout
        if (this._isUserLocked(formData.identifier)) {
            return {
                valid: false,
                sessionId,
                timestamp: Date.now(),
                errors: [{
                    field: 'identifier',
                    message: this._getMessage('tooManyAttempts', context.language, { time: 15 }),
                    code: 'ACCOUNT_LOCKED'
                }],
                lockout: {
                    locked: true,
                    remainingTime: this._getLockoutRemaining(formData.identifier)
                }
            };
        }
        
        const results = {};
        const errors = [];
        
        // شناسه می‌تواند ایمیل یا نام کاربری باشد
        const isEmail = formData.identifier.includes('@');
        
        if (isEmail) {
            const emailResult = await this.validateEmail(formData.identifier, { 
                ...context, 
                sessionId 
            });
            results.email = emailResult;
            if (!emailResult.valid) {
                errors.push({
                    field: 'identifier',
                    message: emailResult.message,
                    code: emailResult.code
                });
            }
        } else {
            const usernameResult = await this.validateUsername(formData.identifier, { 
                ...context, 
                sessionId 
            });
            results.username = usernameResult;
            if (!usernameResult.valid) {
                errors.push({
                    field: 'identifier',
                    message: usernameResult.message,
                    code: usernameResult.code
                });
            }
        }
        
        // بررسی رمز عبور (اعتبارسنجی ساده)
        if (!formData.password || formData.password.length < 1) {
            results.password = {
                valid: false,
                field: 'password',
                message: this._getMessage('required', context.language),
                code: 'PASSWORD_REQUIRED'
            };
            errors.push({
                field: 'password',
                message: 'رمز عبور الزامی است',
                code: 'PASSWORD_REQUIRED'
            });
        }
        
        const overallValid = errors.length === 0;
        
        // ثبت تلاش
        if (!overallValid) {
            this._recordFailedAttempt(formData.identifier);
        }
        
        const result = {
            valid: overallValid,
            sessionId,
            timestamp: Date.now(),
            results,
            errors: overallValid ? null : errors,
            identifierType: isEmail ? 'email' : 'username',
            attempts: this._getAttemptCount(formData.identifier)
        };
        
        this._eventSystem.emit(overallValid ? 
            'auth:form:validation:success' : 
            'auth:form:validation:failed', {
            formType: 'login',
            sessionId,
            valid: overallValid,
            identifierType: isEmail ? 'email' : 'username'
        });
        
        return result;
    }
    
    // ==================== ADVANCED VALIDATION ====================
    
    async validateUserProfile(profileData, context = {}) {
        const sessionId = context.sessionId || this._generateSessionId();
        const results = {};
        const errors = [];
        
        // اعتبارسنجی نام نمایشی
        if (profileData.displayName) {
            const rules = this._config.validationRules.profile.displayName;
            if (profileData.displayName.length < rules.minLength || 
                profileData.displayName.length > rules.maxLength) {
                errors.push({
                    field: 'displayName',
                    message: `نام نمایشی باید بین ${rules.minLength} تا ${rules.maxLength} کاراکتر باشد`,
                    code: 'DISPLAY_NAME_LENGTH'
                });
                results.displayName = { valid: false };
            } else {
                results.displayName = { valid: true };
            }
        }
        
        // اعتبارسنجی تاریخ تولد
        if (profileData.birthDate) {
            const birthDate = new Date(profileData.birthDate);
            const now = new Date();
            const age = now.getFullYear() - birthDate.getFullYear();
            const rules = this._config.validationRules.profile.birthDate;
            
            if (age < rules.minAge || age > rules.maxAge) {
                errors.push({
                    field: 'birthDate',
                    message: `سن باید بین ${rules.minAge} تا ${rules.maxAge} سال باشد`,
                    code: 'INVALID_AGE'
                });
                results.birthDate = { valid: false, calculatedAge: age };
            } else {
                results.birthDate = { valid: true, calculatedAge: age };
            }
        }
        
        // اعتبارسنجی کشور
        if (profileData.country) {
            const allowedCountries = this._config.validationRules.profile.country.allowed;
            if (!allowedCountries.includes(profileData.country.toUpperCase())) {
                errors.push({
                    field: 'country',
                    message: 'کشور انتخاب شده مجاز نیست',
                    code: 'COUNTRY_NOT_ALLOWED'
                });
                results.country = { valid: false };
            } else {
                results.country = { valid: true };
            }
        }
        
        // اعتبارسنجی شماره تلفن
        if (profileData.phone) {
            const phoneResult = this.validatePhoneNumber(profileData.phone, context);
            results.phone = phoneResult;
            if (!phoneResult.valid) {
                errors.push({
                    field: 'phone',
                    message: phoneResult.message,
                    code: phoneResult.code
                });
            }
        }
        
        const overallValid = errors.length === 0;
        
        return {
            valid: overallValid,
            sessionId,
            timestamp: Date.now(),
            results,
            errors: overallValid ? null : errors,
            warnings: this._collectWarnings(results)
        };
    }
    
    validatePhoneNumber(phone, context = {}) {
        const rules = this._config.validationRules.phone;
        
        if (!phone || typeof phone !== 'string') {
            return this._createValidationResult(false, {
                field: 'phone',
                message: 'شماره تلفن الزامی است',
                code: 'PHONE_REQUIRED'
            });
        }
        
        const trimmedPhone = phone.trim();
        
        // بررسی الگو
        if (!rules.pattern.test(trimmedPhone)) {
            return this._createValidationResult(false, {
                field: 'phone',
                message: 'فرمت شماره تلفن نامعتبر است',
                code: 'INVALID_PHONE_FORMAT'
            });
        }
        
        // بررسی کد کشور
        const hasValidCountryCode = rules.countryCodes.some(code => 
            trimmedPhone.startsWith(code)
        );
        
        if (!hasValidCountryCode) {
            return this._createValidationResult(false, {
                field: 'phone',
                message: `کد کشور باید یکی از موارد زیر باشد: ${rules.countryCodes.join(', ')}`,
                code: 'INVALID_COUNTRY_CODE'
            });
        }
        
        return this._createValidationResult(true, {
            field: 'phone',
            value: trimmedPhone,
            message: 'شماره تلفن معتبر است',
            normalized: this._normalizePhoneNumber(trimmedPhone)
        });
    }
    
    // ==================== VALIDATION UTILITIES ====================
    
    createValidationSchema(schemaName, schemaRules) {
        return {
            name: schemaName,
            rules: schemaRules,
            validate: async (data, context = {}) => {
                const results = {};
                const errors = [];
                
                for (const [field, rule] of Object.entries(schemaRules)) {
                    if (rule.required && !data[field]) {
                        errors.push({
                            field,
                            message: `${field} الزامی است`,
                            code: `${field.toUpperCase()}_REQUIRED`
                        });
                        results[field] = { valid: false };
                        continue;
                    }
                    
                    if (data[field] && rule.validator) {
                        const result = await rule.validator(data[field], context);
                        results[field] = result;
                        if (!result.valid) {
                            errors.push({
                                field,
                                message: result.message,
                                code: result.code
                            });
                        }
                    }
                }
                
                return {
                    valid: errors.length === 0,
                    results,
                    errors: errors.length > 0 ? errors : null,
                    timestamp: Date.now()
                };
            }
        };
    }
    
    async validateWithSchema(schema, data, context = {}) {
        return await schema.validate(data, context);
    }
    
    // ==================== SECURITY & RATE LIMITING ====================
    
    checkRateLimit(action, identifier) {
        return this._checkRateLimit(action, identifier);
    }
    
    resetAttempts(identifier) {
        if (this._attempts.has(identifier)) {
            this._attempts.delete(identifier);
            this._state.lockedUsers.delete(identifier);
            
            this._eventSystem.emit('auth:security:attempts_reset', {
                identifier,
                timestamp: Date.now()
            });
            
            return true;
        }
        return false;
    }
    
    getSecurityStatus(identifier) {
        const attempts = this._getAttemptCount(identifier);
        const isLocked = this._isUserLocked(identifier);
        const remainingTime = isLocked ? this._getLockoutRemaining(identifier) : null;
        
        return {
            attempts,
            isLocked,
            remainingTime,
            maxAttempts: this._config.security.maxAttempts,
            lockoutDuration: this._config.security.lockoutDuration
        };
    }
    
    // ==================== METRICS & DIAGNOSTICS ====================
    
    getMetrics() {
        return { ...this._metrics };
    }
    
    resetMetrics() {
        this._metrics.validations = 0;
        this._metrics.successes = 0;
        this._metrics.failures = 0;
        this._metrics.cacheHits = 0;
        this._metrics.rateLimited = 0;
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
    
    updateValidationRules(newRules) {
        Object.assign(this._config.validationRules, newRules);
        return this._config.validationRules;
    }
    
    // ==================== PRIVATE METHODS ====================
    
    _validateDependencies(deps) {
        const validated = { ...deps };
        
        if (!validated.authUtils) {
            throw new Error('AuthUtilities dependency is required');
        }
        
        return validated;
    }
    
    _setupEventListeners() {
        // گوش دادن به رویدادهای امنیتی
        this._eventSystem.on('auth:security:lockout', (data) => {
            console.warn(`User locked out: ${data.identifier}`);
        });
        
        this._eventSystem.on('auth:validation:failed', (data) => {
            this._metrics.failures++;
        });
    }
    
    _checkRateLimit(action, identifier) {
        const now = Date.now();
        const window = this._config.security.rateLimit.window;
        const max = this._config.security.rateLimit.max;
        
        const key = `${action}_${identifier}`;
        
        if (!this._rateLimits.has(key)) {
            this._rateLimits.set(key, []);
        }
        
        const requests = this._rateLimits.get(key);
        
        // حذف درخواست‌های قدیمی
        const cutoff = now - window;
        while (requests.length > 0 && requests[0] < cutoff) {
            requests.shift();
        }
        
        // بررسی تعداد درخواست‌ها
        if (requests.length >= max) {
            return false;
        }
        
        requests.push(now);
        return true;
    }
    
    _recordFailedAttempt(identifier) {
        if (!this._attempts.has(identifier)) {
            this._attempts.set(identifier, []);
        }
        
        const attempts = this._attempts.get(identifier);
        attempts.push(Date.now());
        
        // حذف تلاش‌های قدیمی
        const cutoff = Date.now() - (60 * 60 * 1000); // 1 ساعت
        const recentAttempts = attempts.filter(time => time > cutoff);
        this._attempts.set(identifier, recentAttempts);
        
        // بررسی lockout
        if (recentAttempts.length >= this._config.security.maxAttempts) {
            this._state.lockedUsers.add(identifier);
            
            this._eventSystem.emit('auth:security:lockout', {
                identifier,
                attempts: recentAttempts.length,
                timestamp: Date.now(),
                duration: this._config.security.lockoutDuration
            });
        }
    }
    
    _getAttemptCount(identifier) {
        return this._attempts.has(identifier) ? 
            this._attempts.get(identifier).length : 0;
    }
    
    _isUserLocked(identifier) {
        if (!this._state.lockedUsers.has(identifier)) {
            return false;
        }
        
        // بررسی انقضای lockout
        const lockoutTime = this._getLockoutTime(identifier);
        if (lockoutTime && Date.now() > lockoutTime) {
            this._state.lockedUsers.delete(identifier);
            return false;
        }
        
        return true;
    }
    
    _getLockoutTime(identifier) {
        // فرض: lockout به مدت 15 دقیقه
        const attempts = this._attempts.get(identifier);
        if (!attempts || attempts.length < this._config.security.maxAttempts) {
            return null;
        }
        
        const lastAttempt = attempts[attempts.length - 1];
        return lastAttempt + this._config.security.lockoutDuration;
    }
    
    _getLockoutRemaining(identifier) {
        const lockoutTime = this._getLockoutTime(identifier);
        if (!lockoutTime) return 0;
        
        const remaining = lockoutTime - Date.now();
        return Math.max(0, Math.ceil(remaining / (60 * 1000))); // دقیقه
    }
    
    async _checkDisposableEmail(email) {
        // شبیه‌سازی بررسی ایمیل موقت
        const disposableDomains = [
            'tempmail.com', '10minutemail.com', 'guerrillamail.com',
            'mailinator.com', 'throwawaymail.com', 'yopmail.com'
        ];
        
        const domain = email.split('@')[1];
        return disposableDomains.includes(domain);
    }
    
    async _checkUsernameAvailability(username) {
        // شبیه‌سازی بررسی موجودیت نام کاربری
        // در پیاده‌سازی واقعی، به دیتابیس کوئری می‌زند
        return new Promise(resolve => {
            setTimeout(() => {
                // فرض: همه نام‌ها موجود هستند مگر موارد خاص
                const takenUsernames = ['admin', 'test', 'user', 'support'];
                resolve(!takenUsernames.includes(username.toLowerCase()));
            }, 100);
        });
    }
    
    async _checkPasswordHistory(password, userId, history) {
        // شبیه‌سازی بررسی تاریخچه رمز عبور
        return new Promise(resolve => {
            setTimeout(() => {
                if (!history || !Array.isArray(history)) {
                    resolve(false);
                    return;
                }
                
                // بررسی ساده - در واقع باید hash شود
                const isReused = history.some(oldHash => 
                    this._deps.authUtils.verifyPassword(password, { hash: oldHash })
                );
                resolve(isReused);
            }, 50);
        });
    }
    
    _createValidationResult(valid, data = {}) {
        return {
            valid,
            timestamp: Date.now(),
            ...data
        };
    }
    
    _cacheResult(key, result, ttl = 5 * 60 * 1000) { // 5 دقیقه
        this._cache.set(key, result);
        setTimeout(() => {
            this._cache.delete(key);
        }, ttl);
    }
    
    _getMessage(key, language = 'fa', params = {}) {
        const messages = this._config.messages[language] || this._config.messages.fa;
        let message = messages[key] || key;
        
        // جایگزینی پارامترها
        Object.entries(params).forEach(([param, value]) => {
            message = message.replace(`\${${param}}`, value);
        });
        
        return message;
    }
    
    _generateSessionId() {
        return `val_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    
    _collectWarnings(results) {
        const warnings = [];
        Object.values(results).forEach(result => {
            if (result.warnings && result.warnings.length > 0) {
                warnings.push(...result.warnings);
            }
        });
        return warnings.length > 0 ? warnings : null;
    }
    
    _collectSuggestions(results) {
        const suggestions = [];
        Object.values(results).forEach(result => {
            if (result.suggestions && result.suggestions.length > 0) {
                suggestions.push(...result.suggestions);
            }
        });
        return suggestions.length > 0 ? suggestions : null;
    }
    
    _calculateFormScore(results) {
        let score = 0;
        let totalFields = 0;
        
        Object.values(results).forEach(result => {
            if (result.valid) {
                score += 100;
            } else if (result.strength) {
                score += result.strength;
            }
            totalFields++;
        });
        
        return totalFields > 0 ? Math.round(score / totalFields) : 0;
    }
    
    _getPasswordSuggestions(score) {
        if (score >= 80) return ['رمز عبور قوی است'];
        
        const suggestions = [];
        if (score < 40) suggestions.push('طول رمز عبور را افزایش دهید');
        if (score < 60) suggestions.push('از ترکیب حروف بزرگ و کوچک استفاده کنید');
        if (score < 80) suggestions.push('اعداد و کاراکترهای ویژه اضافه کنید');
        
        return suggestions;
    }
    
    _normalizePhoneNumber(phone) {
        // نرمال‌سازی شماره تلفن به فرمت E.164
        return phone.replace(/\s+/g, '').replace(/^0/, '+98');
    }
    
    // ==================== EXPORT ====================
    
    static create(dependencies = {}, eventSystem = null) {
        return new AuthValidator(dependencies, eventSystem);
    }
}

// Singleton export
const authValidator = new AuthValidator({}, window.eventBus || null);
Object.freeze(authValidator);

export { AuthValidator, authValidator };
