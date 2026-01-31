
/**
 * VAKAMOVA AUTH VALIDATOR - سیستم اعتبارسنجی پیشرفته احراز هویت
 * اصول: تزریق وابستگی، قرارداد رابط، رویدادمحور، پیکربندی متمرکز
 * وابستگی داخلی: auth/utils.js (برای اعتبارسنجی پایه)
 */

class AuthValidator {
    constructor(authUtils, eventSystem, config = {}) {
        // ==================== تزریق وابستگی ====================
        this._authUtils = authUtils || {
            validateEmail: () => ({ valid: false }),
            validatePassword: () => ({ valid: false })
        };
        
        this._eventSystem = eventSystem || {
            emit: () => console.warn('[AuthValidator] Event system not available')
        };
        
        // ==================== پیکربندی متمرکز ====================
        this._config = Object.freeze({
            // تنظیمات اعتبارسنجی فرم
            form: {
                maxEmailLength: config.maxEmailLength || 254,
                minUsernameLength: config.minUsernameLength || 3,
                maxUsernameLength: config.maxUsernameLength || 30,
                usernameRegex: /^[a-zA-Z0-9_\-\.]+$/,
                fullNameRegex: /^[a-zA-Zآ-یء-ئ\s\.]{2,50}$/,
                phoneRegex: /^[\+]?[0-9\s\-\(\)]{10,15}$/,
                birthDateRange: {
                    minAge: config.minAge || 13,
                    maxAge: config.maxAge || 120
                }
            },
            
            // تنظیمات امنیتی پیشرفته
            security: {
                passwordHistorySize: config.passwordHistorySize || 5,
                preventCommonPasswords: config.preventCommonPasswords ?? true,
                commonPasswords: config.commonPasswords || [
                    'password', '123456', 'qwerty', 'admin', 'welcome'
                ],
                maxLoginAttempts: config.maxLoginAttempts || 5,
                accountLockoutMinutes: config.accountLockoutMinutes || 30,
                sessionInactivityTimeout: config.sessionInactivityTimeout || 30 * 60 * 1000 // 30 دقیقه
            },
            
            // تنظیمات اعتبارسنجی پیشرفته
            validation: {
                enableRealTimeValidation: config.enableRealTimeValidation ?? true,
                debounceTimeout: config.debounceTimeout || 300,
                asyncValidationTimeout: config.asyncValidationTimeout || 5000,
                cacheValidationResults: config.cacheValidationResults ?? true,
                cacheTTL: config.cacheTTL || 60000 // 1 دقیقه
            },
            
            // تنظیمات پیام‌های خطا (قابل بومی‌سازی)
            messages: {
                emailRequired: 'ایمیل الزامی است',
                emailInvalid: 'ایمیل معتبر نیست',
                emailTooLong: 'ایمیل نمی‌تواند بیشتر از {max} کاراکتر باشد',
                passwordRequired: 'رمز عبور الزامی است',
                passwordTooWeak: 'رمز عبور ضعیف است',
                passwordCommon: 'رمز عبور بسیار رایج است',
                usernameInvalid: 'نام کاربری فقط می‌تواند حروف، اعداد و خط تیره داشته باشد',
                usernameTaken: 'نام کاربری قبلاً استفاده شده',
                phoneInvalid: 'شماره تلفن معتبر نیست',
                ageRestriction: 'حداقل سن برای ثبت نام {minAge} سال است',
                // ... سایر پیام‌ها
                ...config.messages
            },
            
            // تنظیمات پیش‌فرض
            defaults: {
                version: '1.0.0',
                locale: config.locale || 'fa-IR',
                timezone: config.timezone || 'Asia/Tehran'
            },
            
            ...config
        });
        
        // ==================== وضعیت داخلی ====================
        this._cache = new Map();
        this._pendingValidations = new Map();
        this._validationQueue = [];
        this._isProcessingQueue = false;
        
        this._metrics = {
            validations: 0,
            successful: 0,
            failed: 0,
            cacheHits: 0,
            asyncValidations: 0,
            securityBlocks: 0
        };
        
        this._commonPasswordsSet = new Set(
            this._config.security.commonPasswords.map(p => p.toLowerCase())
        );
        
        this._init();
        Object.seal(this._metrics);
        Object.seal(this);
    }
    
    // ==================== متدهای اصلی (قرارداد رابط) ====================
    
    async validateRegistration(data, options = {}) {
        this._metrics.validations++;
        
        const validationId = `reg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const startTime = Date.now();
        
        this._eventSystem.emit('auth:validation:start', {
            type: 'registration',
            data: this._sanitizeData(data),
            validationId,
            timestamp: startTime
        });
        
        try {
            // اعتبارسنجی سنکرون پایه
            const basicResults = this._validateBasicRegistration(data, options);
            
            if (!basicResults.overallValid) {
                return this._finalizeValidation({
                    validationId,
                    type: 'registration',
                    valid: false,
                    errors: basicResults.errors,
                    warnings: basicResults.warnings,
                    duration: Date.now() - startTime,
                    data: this._sanitizeData(data)
                }, startTime);
            }
            
            // اعتبارسنجی آسنکرون پیشرفته
            const asyncResults = await this._validateAsyncRegistration(data, options);
            
            const finalResult = {
                ...basicResults,
                ...asyncResults,
                validationId,
                type: 'registration',
                valid: basicResults.overallValid && asyncResults.asyncValid,
                duration: Date.now() - startTime,
                data: this._sanitizeData(data),
                timestamp: new Date().toISOString()
            };
            
            return this._finalizeValidation(finalResult, startTime);
            
        } catch (error) {
            this._metrics.failed++;
            
            this._eventSystem.emit('auth:validation:error', {
                validationId,
                type: 'registration',
                error: error.message,
                duration: Date.now() - startTime,
                timestamp: new Date().toISOString()
            });
            
            return {
                validationId,
                type: 'registration',
                valid: false,
                errors: [{
                    field: 'system',
                    code: 'VALIDATION_ERROR',
                    message: 'خطای سیستم در اعتبارسنجی',
                    details: error.message
                }],
                duration: Date.now() - startTime,
                timestamp: new Date().toISOString()
            };
        }
    }
    
    async validateLogin(credentials, context = {}) {
        this._metrics.validations++;
        
        const validationId = `login_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const startTime = Date.now();
        
        // بررسی محدودیت تلاش‌های ناموفق
        const blockCheck = this._checkLoginBlock(context);
        if (!blockCheck.allowed) {
            this._metrics.securityBlocks++;
            
            this._eventSystem.emit('auth:validation:blocked', {
                validationId,
                type: 'login',
                reason: blockCheck.reason,
                remainingTime: blockCheck.remainingTime,
                context
            });
            
            return {
                validationId,
                type: 'login',
                valid: false,
                blocked: true,
                reason: blockCheck.reason,
                remainingTime: blockCheck.remainingTime,
                errors: [{
                    field: 'system',
                    code: 'ACCOUNT_BLOCKED',
                    message: 'اکانت به دلیل تلاش‌های ناموفق موقتاً مسدود شده است',
                    details: `تا ${Math.ceil(blockCheck.remainingTime / 60000)} دقیقه دیگر مجددا تلاش کنید`
                }],
                duration: Date.now() - startTime,
                timestamp: new Date().toISOString()
            };
        }
        
        // اعتبارسنجی فرمت اولیه
        const formatErrors = [];
        
        if (!credentials.identifier) {
            formatErrors.push({
                field: 'identifier',
                code: 'IDENTIFIER_REQUIRED',
                message: 'ایمیل یا نام کاربری الزامی است'
            });
        }
        
        if (!credentials.password) {
            formatErrors.push({
                field: 'password',
                code: 'PASSWORD_REQUIRED',
                message: 'رمز عبور الزامی است'
            });
        }
        
        if (formatErrors.length > 0) {
            return this._finalizeValidation({
                validationId,
                type: 'login',
                valid: false,
                errors: formatErrors,
                duration: Date.now() - startTime,
                timestamp: new Date().toISOString()
            }, startTime);
        }
        
        // شناسایی نوع identifier
        const identifierType = this._identifyIdentifierType(credentials.identifier);
        const identifierValidation = this._validateIdentifier(
            credentials.identifier, 
            identifierType
        );
        
        if (!identifierValidation.valid) {
            return this._finalizeValidation({
                validationId,
                type: 'login',
                valid: false,
                errors: [identifierValidation.error],
                duration: Date.now() - startTime,
                timestamp: new Date().toISOString()
            }, startTime);
        }
        
        // همه چیز درست است
        return this._finalizeValidation({
            validationId,
            type: 'login',
            valid: true,
            identifierType,
            normalizedIdentifier: identifierValidation.normalized,
            duration: Date.now() - startTime,
            timestamp: new Date().toISOString(),
            context
        }, startTime);
    }
    
    validateProfileUpdate(profileData, userId, options = {}) {
        this._metrics.validations++;
        
        const validationId = `profile_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const startTime = Date.now();
        
        const errors = [];
        const warnings = [];
        const validatedData = {};
        
        // اعتبارسنجی نام کامل
        if (profileData.fullName !== undefined) {
            const nameValidation = this.validateFullName(profileData.fullName);
            if (!nameValidation.valid) {
                errors.push({
                    field: 'fullName',
                    code: 'INVALID_FULL_NAME',
                    message: nameValidation.error,
                    details: nameValidation
                });
            } else {
                validatedData.fullName = nameValidation.normalized;
            }
        }
        
        // اعتبارسنجی شماره تلفن
        if (profileData.phone !== undefined) {
            const phoneValidation = this.validatePhone(profileData.phone);
            if (!phoneValidation.valid) {
                errors.push({
                    field: 'phone',
                    code: 'INVALID_PHONE',
                    message: phoneValidation.error,
                    details: phoneValidation
                });
            } else {
                validatedData.phone = phoneValidation.normalized;
            }
        }
        
        // اعتبارسنجی تاریخ تولد
        if (profileData.birthDate !== undefined) {
            const ageValidation = this.validateBirthDate(profileData.birthDate);
            if (!ageValidation.valid) {
                errors.push({
                    field: 'birthDate',
                    code: 'INVALID_BIRTH_DATE',
                    message: ageValidation.error,
                    details: ageValidation
                });
            } else {
                validatedData.birthDate = ageValidation.normalized;
                validatedData.age = ageValidation.age;
            }
        }
        
        // اعتبارسنجی بیوگرافی
        if (profileData.bio !== undefined) {
            const bioValidation = this.validateBio(profileData.bio, options);
            if (!bioValidation.valid) {
                warnings.push({
                    field: 'bio',
                    code: 'BIO_VALIDATION_WARNING',
                    message: bioValidation.warning,
                    details: bioValidation
                });
            }
            validatedData.bio = bioValidation.sanitized;
        }
        
        const result = {
            validationId,
            type: 'profile_update',
            valid: errors.length === 0,
            errors,
            warnings,
            validatedData,
            userId,
            duration: Date.now() - startTime,
            timestamp: new Date().toISOString()
        };
        
        return this._finalizeValidation(result, startTime);
    }
    
    validatePasswordChange(currentPassword, newPassword, context = {}) {
        this._metrics.validations++;
        
        const validationId = `pwd_change_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const startTime = Date.now();
        
        const errors = [];
        
        // اعتبارسنجی رمز عبور فعلی
        if (!currentPassword || currentPassword.trim().length === 0) {
            errors.push({
                field: 'currentPassword',
                code: 'CURRENT_PASSWORD_REQUIRED',
                message: 'رمز عبور فعلی الزامی است'
            });
        }
        
        // اعتبارسنجی رمز عبور جدید
        const passwordValidation = this._authUtils.validatePassword(newPassword, {
            minPasswordLength: this._config.security.minPasswordLength || 8
        });
        
        if (!passwordValidation.valid) {
            errors.push({
                field: 'newPassword',
                code: 'NEW_PASSWORD_INVALID',
                message: 'رمز عبور جدید معتبر نیست',
                details: passwordValidation.issues
            });
        }
        
        // بررسی شباهت با رمزهای قبلی (اگر تاریخچه موجود باشد)
        if (context.passwordHistory && this._config.security.passwordHistorySize > 0) {
            const isReused = this._checkPasswordReuse(newPassword, context.passwordHistory);
            if (isReused) {
                errors.push({
                    field: 'newPassword',
                    code: 'PASSWORD_REUSED',
                    message: `رمز عبور نمی‌تواند بین ${this._config.security.passwordHistorySize} رمز آخر تکرار شود`
                });
            }
        }
        
        // بررسی رمزهای رایج
        if (this._config.security.preventCommonPasswords) {
            const isCommon = this._isCommonPassword(newPassword);
            if (isCommon) {
                errors.push({
                    field: 'newPassword',
                    code: 'COMMON_PASSWORD',
                    message: 'رمز عبور بسیار رایج است. لطفاً رمز قوی‌تری انتخاب کنید'
                });
            }
        }
        
        const result = {
            validationId,
            type: 'password_change',
            valid: errors.length === 0,
            errors,
            passwordStrength: passwordValidation.strength,
            duration: Date.now() - startTime,
            timestamp: new Date().toISOString(),
            context: this._sanitizeContext(context)
        };
        
        return this._finalizeValidation(result, startTime);
    }
    
    // ==================== متدهای اعتبارسنجی جزئی ====================
    
    validateEmail(email, options = {}) {
        const cacheKey = `email_${email}_${JSON.stringify(options)}`;
        
        if (this._config.validation.cacheValidationResults) {
            const cached = this._cache.get(cacheKey);
            if (cached && Date.now() - cached.timestamp < this._config.validation.cacheTTL) {
                this._metrics.cacheHits++;
                return cached.result;
            }
        }
        
        const result = this._authUtils.validateEmail(email);
        
        // اعتبارسنجی اضافی طول
        if (result.valid && email.length > this._config.form.maxEmailLength) {
            result.valid = false;
            result.error = this._config.messages.emailTooLong
                .replace('{max}', this._config.form.maxEmailLength);
            result.code = 'EMAIL_TOO_LONG';
        }
        
        // ذخیره در کش
        if (this._config.validation.cacheValidationResults) {
            this._cache.set(cacheKey, {
                result,
                timestamp: Date.now()
            });
        }
        
        this._eventSystem.emit('auth:email:validated', {
            email: this._maskEmail(email),
            valid: result.valid,
            domain: result.domain
        });
        
        return result;
    }
    
    validatePassword(password, options = {}) {
        const cacheKey = `password_${this._simpleHash(password)}_${JSON.stringify(options)}`;
        
        if (this._config.validation.cacheValidationResults) {
            const cached = this._cache.get(cacheKey);
            if (cached && Date.now() - cached.timestamp < this._config.validation.cacheTTL) {
                this._metrics.cacheHits++;
                return cached.result;
            }
        }
        
        const baseValidation = this._authUtils.validatePassword(password, {
            minPasswordLength: options.minLength || this._config.security.minPasswordLength
        });
        
        const result = { ...baseValidation };
        
        // بررسی رمزهای رایج
        if (this._config.security.preventCommonPasswords && this._isCommonPassword(password)) {
            result.valid = false;
            result.issues.push({
                code: 'COMMON_PASSWORD',
                message: this._config.messages.passwordCommon
            });
        }
        
        // ذخیره در کش
        if (this._config.validation.cacheValidationResults) {
            this._cache.set(cacheKey, {
                result,
                timestamp: Date.now()
            });
        }
        
        // انتشار رویداد (بدون نمایش رمز)
        this._eventSystem.emit('auth:password:validated', {
            strength: result.strength,
            valid: result.valid,
            issuesCount: result.issues.length
        });
        
        return result;
    }
    
    validateUsername(username, options = {}) {
        const errors = [];
        
        // بررسی طول
        if (username.length < this._config.form.minUsernameLength) {
            errors.push({
                code: 'USERNAME_TOO_SHORT',
                message: `نام کاربری باید حداقل ${this._config.form.minUsernameLength} کاراکتر باشد`
            });
        }
        
        if (username.length > this._config.form.maxUsernameLength) {
            errors.push({
                code: 'USERNAME_TOO_LONG',
                message: `نام کاربری نمی‌تواند بیشتر از ${this._config.form.maxUsernameLength} کاراکتر باشد`
            });
        }
        
        // بررسی کاراکترهای مجاز
        if (!this._config.form.usernameRegex.test(username)) {
            errors.push({
                code: 'USERNAME_INVALID_CHARS',
                message: this._config.messages.usernameInvalid
            });
        }
        
        // بررسی کلمات ممنوعه
        const forbiddenWords = ['admin', 'root', 'system', 'support'];
        const lowerUsername = username.toLowerCase();
        for (const word of forbiddenWords) {
            if (lowerUsername.includes(word)) {
                errors.push({
                    code: 'USERNAME_FORBIDDEN',
                    message: `نام کاربری نمی‌تواند شامل کلمه "${word}" باشد`
                });
                break;
            }
        }
        
        const result = {
            valid: errors.length === 0,
            errors,
            normalized: username.toLowerCase(),
            length: username.length,
            timestamp: new Date().toISOString()
        };
        
        this._eventSystem.emit('auth:username:validated', result);
        return result;
    }
    
    validateFullName(fullName) {
        if (!fullName || typeof fullName !== 'string') {
            return {
                valid: false,
                error: 'نام کامل باید یک رشته متنی باشد'
            };
        }
        
        const trimmed = fullName.trim();
        
        if (trimmed.length < 2) {
            return {
                valid: false,
                error: 'نام کامل باید حداقل ۲ کاراکتر باشد'
            };
        }
        
        if (trimmed.length > 50) {
            return {
                valid: false,
                error: 'نام کامل نمی‌تواند بیشتر از ۵۰ کاراکتر باشد'
            };
        }
        
        if (!this._config.form.fullNameRegex.test(trimmed)) {
            return {
                valid: false,
                error: 'نام کامل فقط می‌تواند شامل حروف و فاصله باشد'
            };
        }
        
        return {
            valid: true,
            normalized: trimmed,
            parts: trimmed.split(/\s+/),
            length: trimmed.length
        };
    }
    
    validatePhone(phoneNumber) {
        if (!phoneNumber || typeof phoneNumber !== 'string') {
            return {
                valid: false,
                error: 'شماره تلفن باید یک رشته متنی باشد'
            };
        }
        
        // حذف فاصله‌ها و کاراکترهای خاص
        const cleaned = phoneNumber.replace(/[\s\-\(\)]/g, '');
        
        if (!this._config.form.phoneRegex.test(phoneNumber)) {
            return {
                valid: false,
                error: this._config.messages.phoneInvalid
            };
        }
        
        // بررسی طول نهایی
        if (cleaned.length < 10 || cleaned.length > 15) {
            return {
                valid: false,
                error: 'شماره تلفن باید بین ۱۰ تا ۱۵ رقم باشد'
            };
        }
        
        return {
            valid: true,
            normalized: cleaned,
            international: cleaned.startsWith('+'),
            length: cleaned.length
        };
    }
    
    validateBirthDate(birthDate, options = {}) {
        let date;
        
        if (birthDate instanceof Date) {
            date = birthDate;
        } else if (typeof birthDate === 'string' || typeof birthDate === 'number') {
            date = new Date(birthDate);
        } else {
            return {
                valid: false,
                error: 'تاریخ تولد معتبر نیست'
            };
        }
        
        // بررسی معتبر بودن تاریخ
        if (isNaN(date.getTime())) {
            return {
                valid: false,
                error: 'تاریخ تولد معتبر نیست'
            };
        }
        
        // محاسبه سن
        const today = new Date();
        let age = today.getFullYear() - date.getFullYear();
        const monthDiff = today.getMonth() - date.getMonth();
        
        if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < date.getDate())) {
            age--;
        }
        
        // بررسی محدودیت سنی
        const minAge = options.minAge || this._config.form.birthDateRange.minAge;
        const maxAge = options.maxAge || this._config.form.birthDateRange.maxAge;
        
        if (age < minAge) {
            return {
                valid: false,
                error: this._config.messages.ageRestriction.replace('{minAge}', minAge),
                age,
                minAge
            };
        }
        
        if (age > maxAge) {
            return {
                valid: false,
                error: `سن نمی‌تواند بیشتر از ${maxAge} سال باشد`,
                age,
                maxAge
            };
        }
        
        return {
            valid: true,
            normalized: date.toISOString().split('T')[0],
            age,
            date: date,
            timestamp: date.getTime()
        };
    }
    
    validateBio(bioText, options = {}) {
        const maxLength = options.maxLength || 500;
        const minLength = options.minLength || 0;
        
        if (!bioText || typeof bioText !== 'string') {
            return {
                valid: false,
                error: 'بیوگرافی باید یک رشته متنی باشد',
                sanitized: ''
            };
        }
        
        const sanitized = this._sanitizeText(bioText, {
            allowLinks: options.allowLinks || false,
            allowEmojis: options.allowEmojis || true,
            maxLength
        });
        
        const valid = sanitized.length >= minLength && sanitized.length <= maxLength;
        
        return {
            valid,
            sanitized,
            length: sanitized.length,
            warning: !valid ? `بیوگرافی باید بین ${minLength} تا ${maxLength} کاراکتر باشد` : null,
            truncated: bioText.length > maxLength
        };
    }
    
    // ==================== متدهای کمکی و داخلی ====================
    
    _validateBasicRegistration(data, options) {
        const errors = [];
        const warnings = [];
        const validated = {};
        
        // اعتبارسنجی ایمیل
        if (!data.email) {
            errors.push({
                field: 'email',
                code: 'EMAIL_REQUIRED',
                message: this._config.messages.emailRequired
            });
        } else {
            const emailValidation = this.validateEmail(data.email);
            if (!emailValidation.valid) {
                errors.push({
                    field: 'email',
                    code: 'EMAIL_INVALID',
                    message: emailValidation.error || this._config.messages.emailInvalid,
                    details: emailValidation
                });
            } else {
                validated.email = emailValidation.normalized;
            }
        }
        
        // اعتبارسنجی رمز عبور
        if (!data.password) {
            errors.push({
                field: 'password',
                code: 'PASSWORD_REQUIRED',
                message: this._config.messages.passwordRequired
            });
        } else {
            const passwordValidation = this.validatePassword(data.password, {
                minLength: options.minPasswordLength
            });
            
            if (!passwordValidation.valid) {
                errors.push({
                    field: 'password',
                    code: 'PASSWORD_INVALID',
                    message: this._config.messages.passwordTooWeak,
                    details: passwordValidation.issues
                });
            } else {
                validated.passwordStrength = passwordValidation.strength;
            }
        }
        
        // اعتبارسنجی نام کاربری (اگر وجود دارد)
        if (data.username) {
            const usernameValidation = this.validateUsername(data.username);
            if (!usernameValidation.valid) {
                warnings.push({
                    field: 'username',
                    code: 'USERNAME_WARNING',
                    message: 'نام کاربری معتبر نیست',
                    details: usernameValidation.errors
                });
            } else {
                validated.username = usernameValidation.normalized;
            }
        }
        
        // اعتبارسنجی شرایط استفاده
        if (!data.termsAccepted) {
            errors.push({
                field: 'termsAccepted',
                code: 'TERMS_NOT_ACCEPTED',
                message: 'پذیرش شرایط استفاده الزامی است'
            });
        }
        
        return {
            overallValid: errors.length === 0,
            errors,
            warnings,
            validated,
            timestamp: new Date().toISOString()
        };
    }
    
    async _validateAsyncRegistration(data, options) {
        this._metrics.asyncValidations++;
        
        const asyncErrors = [];
        const promises = [];
        
        // بررسی تکراری نبودن ایمیل (شبیه‌سازی)
        if (data.email && options.checkEmailUnique) {
            promises.push(
                this._checkEmailUnique(data.email).then(isUnique => {
                    if (!isUnique) {
                        asyncErrors.push({
                            field: 'email',
                            code: 'EMAIL_TAKEN',
                            message: 'این ایمیل قبلاً ثبت شده است'
                        });
                    }
                })
            );
        }
        
        // بررسی تکراری نبودن نام کاربری (شبیه‌سازی)
        if (data.username && options.checkUsernameUnique) {
            promises.push(
                this._checkUsernameUnique(data.username).then(isUnique => {
                    if (!isUnique) {
                        asyncErrors.push({
                            field: 'username',
                            code: 'USERNAME_TAKEN',
                            message: this._config.messages.usernameTaken
                        });
                    }
                })
            );
        }
        
        // بررسی لیست سیاه (شبیه‌سازی)
        if (options.checkBlacklist && data.email) {
            promises.push(
                this._checkBlacklist(data.email).then(isBlacklisted => {
                    if (isBlacklisted) {
                        asyncErrors.push({
                            field: 'email',
                            code: 'EMAIL_BLACKLISTED',
                            message: 'این ایمیل در لیست سیاه قرار دارد'
                        });
                    }
                })
            );
        }
        
        // اجرای همه بررسی‌های آسنکرون
        try {
            await Promise.all(promises);
        } catch (error) {
            asyncErrors.push({
                field: 'system',
                code: 'ASYNC_VALIDATION_FAILED',
                message: 'بررسی‌های اضافی با خطا مواجه شد',
                details: error.message
            });
        }
        
        return {
            asyncValid: asyncErrors.length === 0,
            asyncErrors,
            asyncChecked: promises.length
        };
    }
    
    _checkLoginBlock(context) {
        const { ipAddress, userId } = context;
        const cacheKey = `login_block_${ipAddress || userId || 'unknown'}`;
        
        const blockData = this._cache.get(cacheKey);
        if (!blockData) {
            return { allowed: true };
        }
        
        const now = Date.now();
        const { attempts, firstAttempt, lastAttempt, blockedUntil } = blockData;
        
        if (blockedUntil && now < blockedUntil) {
            return {
                allowed: false,
                reason: 'TOO_MANY_ATTEMPTS',
                remainingTime: blockedUntil - now,
                attempts
            };
        }
        
        // ریست کردن اگر زمان زیادی گذشته
        if (lastAttempt && now - lastAttempt > this._config.security.accountLockoutMinutes * 60 * 1000) {
            this._cache.delete(cacheKey);
            return { allowed: true };
        }
        
        return { allowed: true };
    }
    
    _identifyIdentifierType(identifier) {
        if (!identifier || typeof identifier !== 'string') {
            return 'unknown';
        }
        
        // بررسی ایمیل
        const emailResult = this._authUtils.validateEmail(identifier);
        if (emailResult.valid) {
            return 'email';
        }
        
        // بررسی نام کاربری
        const usernameResult = this.validateUsername(identifier);
        if (usernameResult.valid) {
            return 'username';
        }
        
        // بررسی شماره تلفن
        const phoneResult = this.validatePhone(identifier);
        if (phoneResult.valid) {
            return 'phone';
        }
        
        return 'unknown';
    }
    
    _validateIdentifier(identifier, type) {
        switch (type) {
            case 'email':
                const emailValidation = this.validateEmail(identifier);
                return {
                    valid: emailValidation.valid,
                    normalized: emailValidation.normalized,
                    error: emailValidation.valid ? null : {
                        field: 'identifier',
                        code: 'INVALID_EMAIL',
                        message: 'ایمیل معتبر نیست'
                    }
                };
                
            case 'username':
                const usernameValidation = this.validateUsername(identifier);
                return {
                    valid: usernameValidation.valid,
                    normalized: usernameValidation.normalized,
                    error: usernameValidation.valid ? null : {
                        field: 'identifier',
                        code: 'INVALID_USERNAME',
                        message: 'نام کاربری معتبر نیست'
                    }
                };
                
            case 'phone':
                const phoneValidation = this.validatePhone(identifier);
                return {
                    valid: phoneValidation.valid,
                    normalized: phoneValidation.normalized,
                    error: phoneValidation.valid ? null : {
                        field: 'identifier',
                        code: 'INVALID_PHONE',
                        message: 'شماره تلفن معتبر نیست'
                    }
                };
                
            default:
                return {
                    valid: false,
                    normalized: null,
                    error: {
                        field: 'identifier',
                        code: 'INVALID_IDENTIFIER',
                        message: 'شناسه ورودی معتبر نیست (ایمیل، نام کاربری یا شماره تلفن)'
                    }
                };
        }
    }
    
    _checkPasswordReuse(newPassword, passwordHistory) {
        // اینجا در نسخه واقعی باید hash جدید با hashهای قبلی مقایسه شود
        // برای نمونه، یک بررسی ساده:
        return passwordHistory.some(oldHash => {
            // در واقعیت: await authUtils.verifyPassword(newPassword, oldHash)
            return oldHash === this._simpleHash(newPassword);
        });
    }
    
    _isCommonPassword(password) {
        const lowerPassword = password.toLowerCase();
        return this._commonPasswordsSet.has(lowerPassword);
    }
    
    async _checkEmailUnique(email) {
        // در نسخه واقعی، اینجا درخواست به سرور ارسال می‌شود
        // برای نمونه، همیشه true برمی‌گردانیم
        this._eventSystem.emit('auth:email:uniqueness_checked', { email });
        return true;
    }
    
    async _checkUsernameUnique(username) {
        // در نسخه واقعی، اینجا درخواست به سرور ارسال می‌شود
        this._eventSystem.emit('auth:username:uniqueness_checked', { username });
        return true;
    }
    
    async _checkBlacklist(email) {
        // در نسخه واقعی، بررسی لیست سیاه
        this._eventSystem.emit('auth:blacklist:checked', { email });
        return false;
    }
    
    _finalizeValidation(result, startTime) {
        result.duration = Date.now() - startTime;
        
        if (result.valid) {
            this._metrics.successful++;
            this._eventSystem.emit('auth:validation:success', result);
        } else {
            this._metrics.failed++;
            this._eventSystem.emit('auth:validation:failed', result);
        }
        
        return result;
    }
    
    _sanitizeData(data) {
        const sanitized = {};
        for (const [key, value] of Object.entries(data)) {
            if (key.includes('password') || key.includes('token')) {
                sanitized[key] = '[HIDDEN]';
            } else if (typeof value === 'string') {
                sanitized[key] = value.substring(0, 100) + (value.length > 100 ? '...' : '');
            } else {
                sanitized[key] = value;
            }
        }
        return sanitized;
    }
    
    _sanitizeContext(context) {
        const sanitized = { ...context };
        if (sanitized.ipAddress) {
            // مخفی کردن بخشی از IP برای حفظ حریم خصوصی
            sanitized.ipAddress = sanitized.ipAddress.replace(/\.[0-9]+$/, '.xxx');
        }
        return sanitized;
    }
    
    _sanitizeText(text, options = {}) {
        let sanitized = text;
        
        // حذف تگ‌های HTML
        sanitized = sanitized.replace(/<[^>]*>/g, '');
        
        // محدودیت طول
        if (options.maxLength && sanitized.length > options.maxLength) {
            sanitized = sanitized.substring(0, options.maxLength);
        }
        
        // حذف لینک‌ها اگر مجاز نباشند
        if (!options.allowLinks) {
            sanitized = sanitized.replace(/https?:\/\/[^\s]+/g, '');
        }
        
        // حذف ایموجی‌ها اگر مجاز نباشند
        if (!options.allowEmojis) {
            sanitized = sanitized.replace(
                /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}]/gu, 
                ''
            );
        }
        
        return sanitized.trim();
    }
    
    _maskEmail(email) {
        const [local, domain] = email.split('@');
        if (!local || !domain) return email;
        
        const maskedLocal = local.length > 2 
            ? local.substring(0, 2) + '*'.repeat(local.length - 2)
            : '*'.repeat(local.length);
        
        return `${maskedLocal}@${domain}`;
    }
    
    _simpleHash(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash |= 0;
        }
        return hash.toString(36);
    }
    
    _init() {
        // راه‌اندازی event listeners
        this._eventSystem.on('auth:validator:reset', () => {
            this._cache.clear();
            this.resetMetrics();
        });
        
        this._eventSystem.on('auth:validator:flush_cache', () => {
            this._cache.clear();
            this._eventSystem.emit('auth:validator:cache_flushed', {
                clearedEntries: this._cache.size
            });
        });
        
        // راه‌اندازی timed cache cleanup
        setInterval(() => {
            this._cleanupExpiredCache();
        }, 5 * 60 * 1000); // هر ۵ دقیقه
        
        this._eventSystem.emit('auth:validator:initialized', {
            version: this._config.defaults.version,
            timestamp: new Date().toISOString(),
            features: Object.keys(this._config)
        });
    }
    
    _cleanupExpiredCache() {
        const now = Date.now();
        let clearedCount = 0;
        
        for (const [key, value] of this._cache.entries()) {
            if (now - value.timestamp > this._config.validation.cacheTTL) {
                this._cache.delete(key);
                clearedCount++;
            }
        }
        
        if (clearedCount > 0) {
            this._eventSystem.emit('auth:validator:cache_cleaned', { clearedCount });
        }
    }
    
    // ==================== متدهای عمومی ====================
    
    getMetrics() {
        return { ...this._metrics };
    }
    
    resetMetrics() {
        this._metrics.validations = 0;
        this._metrics.successful = 0;
        this._metrics.failed = 0;
        this._metrics.cacheHits = 0;
        this._metrics.asyncValidations = 0;
        this._metrics.securityBlocks = 0;
        return this;
    }
    
    clearCache(pattern = null) {
        if (!pattern) {
            const size = this._cache.size;
            this._cache.clear();
            this._eventSystem.emit('auth:validator:cache_cleared', { clearedEntries: size });
            return size;
        }
        
        const regex = new RegExp(pattern);
        let cleared = 0;
        
        for (const key of this._cache.keys()) {
            if (regex.test(key)) {
                this._cache.delete(key);
                cleared++;
            }
        }
        
        this._eventSystem.emit('auth:validator:cache_cleared', { 
            clearedEntries: cleared,
            pattern 
        });
        
        return cleared;
    }
    
    getCacheStats() {
        return {
            size: this._cache.size,
            hitRate: this._metrics.validations > 0 
                ? (this._metrics.cacheHits / this._metrics.validations) * 100 
                : 0,
            memoryUsage: this._estimateCacheMemory()
        };
    }
    
    _estimateCacheMemory() {
        let total = 0;
        for (const [key, value] of this._cache.entries()) {
            total += key.length * 2; // UTF-16
            total += JSON.stringify(value).length * 2;
        }
        return total; // bytes
    }
}

// ==================== Singleton Export ====================

let authValidatorInstance = null;

function createAuthValidator(authUtils, eventSystem, config) {
    if (!authValidatorInstance) {
        authValidatorInstance = new AuthValidator(authUtils, eventSystem, config);
        Object.freeze(authValidatorInstance);
    }
    return authValidatorInstance;
}

function getAuthValidator() {
    if (!authValidatorInstance) {
        console.warn('[AuthValidator] Instance not initialized. Call createAuthValidator() first.');
    }
    return authValidatorInstance;
}

// ==================== Export ====================

export { AuthValidator, createAuthValidator, getAuthValidator };

// ==================== Auto-init در صورت وجود پیش‌نیازها ====================
if (typeof window !== 'undefined' && window.getAuthUtils && window.eventBus) {
    const authUtils = window.getAuthUtils();
    if (authUtils) {
        createAuthValidator(authUtils, window.eventBus);
        console.log('[AuthValidator] Auto-initialized with global instances');
    }
              }
