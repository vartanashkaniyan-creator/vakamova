/**
 * VAKAMOVA REGISTER PAGE - صفحه ثبت‌نام حرفه‌ای
 * اصول: تزریق وابستگی، قرارداد رابط، رویدادمحور، پیکربندی متمرکز
 * وابستگی‌های داخلی: auth_manager.js, event_bus.js, state_manager.js, config.js, router.js
 */

class VakamovaRegisterPage {
    constructor(dependencies = {}) {
        // ==================== DEPENDENCY INJECTION ====================
        this._authManager = dependencies.authManager || {
            register: async () => ({ success: false }),
            validateUsername: async () => ({ available: true })
        };
        
        this._eventBus = dependencies.eventBus || {
            emit: () => {},
            on: () => () => {},
            off: () => {}
        };
        
        this._stateManager = dependencies.stateManager || {
            set: () => {},
            get: () => null,
            subscribe: () => () => {}
        };
        
        this._config = dependencies.config || {
            get: (path, def) => def
        };
        
        this._router = dependencies.router || {
            navigateTo: () => {},
            getQueryParam: () => null
        };
        
        // ==================== INTERFACE CONTRACT ====================
        this.PAGE_STATES = Object.freeze({
            INITIAL: 'initial',
            VALIDATING: 'validating',
            CHECKING_USERNAME: 'checking_username',
            LOADING: 'loading',
            SUCCESS: 'success',
            ERROR: 'error'
        });
        
        this.FORM_FIELDS = Object.freeze({
            USERNAME: 'username',
            EMAIL: 'email',
            PASSWORD: 'password',
            CONFIRM_PASSWORD: 'confirm_password',
            FULL_NAME: 'full_name',
            TERMS_ACCEPTED: 'terms_accepted',
            NEWSLETTER_SUBSCRIBED: 'newsletter_subscribed'
        });
        
        // ==================== EVENT-DRIVEN STATE ====================
        this._currentState = this.PAGE_STATES.INITIAL;
        this._formData = new Map();
        this._validationErrors = new Map();
        this._usernameAvailability = null;
        this._uiElements = new Map();
        this._subscriptions = new Map();
        this._pageConfig = null;
        this._validationDebounceTimer = null;
        this._usernameCheckTimer = null;
        
        // ==================== CENTRALIZED CONFIGURATION ====================
        this._initializeConfiguration();
        
        // Bind methods
        this._handleUsernameChange = this._handleUsernameChange.bind(this);
        this._handleEmailChange = this._handleEmailChange.bind(this);
        this._handlePasswordChange = this._handlePasswordChange.bind(this);
        this._handleConfirmPasswordChange = this._handleConfirmPasswordChange.bind(this);
        this._handleFullNameChange = this._handleFullNameChange.bind(this);
        this._handleTermsChange = this._handleTermsChange.bind(this);
        this._handleNewsletterChange = this._handleNewsletterChange.bind(this);
        this._handleFormSubmit = this._handleFormSubmit.bind(this);
        this._checkUsernameAvailability = this._checkUsernameAvailability.bind(this);
        this._cleanup = this._cleanup.bind(this);
        
        Object.seal(this);
        Object.freeze(this.PAGE_STATES);
        Object.freeze(this.FORM_FIELDS);
    }
    
    // ==================== INTERFACE CONTRACT METHODS ====================
    
    async initialize(containerId = 'app') {
        try {
            // Check if already authenticated
            if (await this._authManager.isAuthenticated?.()) {
                this._router.navigateTo('/dashboard', { replace: true });
                return { success: false, reason: 'already_authenticated' };
            }
            
            // Set up state
            this._setPageState(this.PAGE_STATES.INITIAL);
            
            // Initialize form data
            this._initializeFormData();
            
            // Load configuration
            await this._loadPageConfiguration();
            
            // Set up event listeners
            this._setupEventListeners();
            
            // Render the page
            await this._render(containerId);
            
            // Emit page initialized event
            this._eventBus.emit('register_page:initialized', {
                timestamp: Date.now(),
                containerId
            });
            
            return { success: true, state: this._currentState };
            
        } catch (error) {
            console.error('[RegisterPage] Initialization failed:', error);
            this._eventBus.emit('register_page:initialization_failed', { error });
            
            return {
                success: false,
                error: error.message,
                state: this._currentState
            };
        }
    }
    
    async render(containerId = 'app') {
        return this._render(containerId);
    }
    
    async update(configUpdates = {}) {
        try {
            // Update configuration
            if (configUpdates.config) {
                this._pageConfig = {
                    ...this._pageConfig,
                    ...configUpdates.config
                };
            }
            
            // Update form data if provided
            if (configUpdates.formData) {
                for (const [field, value] of Object.entries(configUpdates.formData)) {
                    this._formData.set(field, value);
                }
                
                // Re-render if needed
                if (configUpdates.reRender !== false) {
                    await this._updateFormDisplay();
                }
            }
            
            this._eventBus.emit('register_page:updated', { updates: configUpdates });
            
            return { success: true };
            
        } catch (error) {
            console.error('[RegisterPage] Update failed:', error);
            return { success: false, error: error.message };
        }
    }
    
    async validateForm(field = null) {
        try {
            this._setPageState(this.PAGE_STATES.VALIDATING);
            
            const validationResults = new Map();
            
            if (field) {
                // Validate single field
                const result = await this._validateField(field, this._formData.get(field));
                validationResults.set(field, result);
            } else {
                // Validate all fields
                for (const [fieldName, value] of this._formData) {
                    const result = await this._validateField(fieldName, value);
                    validationResults.set(fieldName, result);
                }
            }
            
            // Update validation errors
            this._validationErrors.clear();
            for (const [fieldName, result] of validationResults) {
                if (!result.isValid) {
                    this._validationErrors.set(fieldName, result.errors);
                }
            }
            
            // Update UI
            await this._updateValidationDisplay();
            
            // Check if form is valid
            const isValid = validationResults.size > 0 && 
                          Array.from(validationResults.values()).every(r => r.isValid);
            
            this._setPageState(this.PAGE_STATES.INITIAL);
            
            this._eventBus.emit('register_page:validation_completed', {
                isValid,
                results: Object.fromEntries(validationResults),
                field
            });
            
            return {
                isValid,
                results: Object.fromEntries(validationResults),
                errors: Object.fromEntries(this._validationErrors)
            };
            
        } catch (error) {
            console.error('[RegisterPage] Validation failed:', error);
            this._setPageState(this.PAGE_STATES.ERROR);
            return { isValid: false, error: error.message };
        }
    }
    
    async submit() {
        // Check if already submitting
        if (this._currentState === this.PAGE_STATES.LOADING) {
            return { success: false, error: 'Already submitting' };
        }
        
        // Check terms acceptance
        if (this._pageConfig.requireTerms && !this._formData.get(this.FORM_FIELDS.TERMS_ACCEPTED)) {
            this._validationErrors.set(this.FORM_FIELDS.TERMS_ACCEPTED, ['terms_not_accepted']);
            await this._updateValidationDisplay();
            return { success: false, error: 'Terms must be accepted' };
        }
        
        try {
            // Set loading state
            this._setPageState(this.PAGE_STATES.LOADING);
            
            // Validate form
            const validationResult = await this.validateForm();
            if (!validationResult.isValid) {
                this._setPageState(this.PAGE_STATES.ERROR);
                return {
                    success: false,
                    error: 'Form validation failed',
                    validationErrors: validationResult.errors
                };
            }
            
            // Check username availability
            if (this._usernameAvailability === false) {
                this._setPageState(this.PAGE_STATES.ERROR);
                return {
                    success: false,
                    error: 'Username is not available',
                    field: this.FORM_FIELDS.USERNAME
                };
            }
            
            // Prepare registration data
            const registerData = {
                [this.FORM_FIELDS.USERNAME]: this._formData.get(this.FORM_FIELDS.USERNAME),
                [this.FORM_FIELDS.EMAIL]: this._formData.get(this.FORM_FIELDS.EMAIL),
                [this.FORM_FIELDS.PASSWORD]: this._formData.get(this.FORM_FIELDS.PASSWORD),
                [this.FORM_FIELDS.FULL_NAME]: this._formData.get(this.FORM_FIELDS.FULL_NAME),
                [this.FORM_FIELDS.NEWSLETTER_SUBSCRIBED]: this._formData.get(this.FORM_FIELDS.NEWSLETTER_SUBSCRIBED),
                preferredLanguage: this._pageConfig.language,
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                deviceInfo: this._getDeviceInfo(),
                timestamp: Date.now(),
                referralCode: this._router.getQueryParam('ref')
            };
            
            // Emit pre-registration event
            this._eventBus.emit('register_page:pre_register', { data: registerData });
            
            // Call auth manager
            const registerResult = await this._authManager.register(registerData);
            
            if (registerResult.success) {
                // Success
                this._setPageState(this.PAGE_STATES.SUCCESS);
                
                // Update state
                this._stateManager.set('user.registration', {
                    completed: true,
                    timestamp: Date.now(),
                    method: 'email',
                    userId: registerResult.user?.id
                });
                
                // Emit success event
                this._eventBus.emit('register_page:registration_success', {
                    userId: registerResult.user?.id,
                    username: registerData.username,
                    timestamp: Date.now()
                });
                
                // Auto-login if enabled
                if (this._pageConfig.autoLoginAfterRegister) {
                    await this._handleAutoLogin(registerData);
                } else {
                    // Redirect to login or success page
                    const redirectTo = this._pageConfig.redirectAfterRegister || '/auth/registration-success';
                    
                    setTimeout(() => {
                        this._router.navigateTo(redirectTo, { 
                            replace: true,
                            transition: 'slide-left',
                            state: { email: registerData.email, username: registerData.username }
                        });
                    }, this._pageConfig.successRedirectDelay || 2000);
                }
                
                return {
                    success: true,
                    user: registerResult.user,
                    autoLogin: this._pageConfig.autoLoginAfterRegister
                };
                
            } else {
                // Failure
                this._setPageState(this.PAGE_STATES.ERROR);
                
                // Update validation errors
                if (registerResult.fieldErrors) {
                    for (const [field, error] of Object.entries(registerResult.fieldErrors)) {
                        this._validationErrors.set(field, [error]);
                    }
                    await this._updateValidationDisplay();
                }
                
                // Emit failure event
                this._eventBus.emit('register_page:registration_failed', {
                    reason: registerResult.reason,
                    error: registerResult.error,
                    timestamp: Date.now()
                });
                
                return {
                    success: false,
                    error: registerResult.error || 'Registration failed',
                    fieldErrors: registerResult.fieldErrors
                };
            }
            
        } catch (error) {
            console.error('[RegisterPage] Submit failed:', error);
            
            this._setPageState(this.PAGE_STATES.ERROR);
            this._eventBus.emit('register_page:submit_error', { error });
            
            return {
                success: false,
                error: error.message || 'An unexpected error occurred'
            };
        }
    }
    
    reset() {
        // Reset form data
        this._initializeFormData();
        
        // Clear validation errors
        this._validationErrors.clear();
        
        // Reset username availability
        this._usernameAvailability = null;
        
        // Reset state
        this._setPageState(this.PAGE_STATES.INITIAL);
        
        // Update UI
        this._updateFormDisplay();
        this._updateValidationDisplay();
        
        // Clear timers
        if (this._validationDebounceTimer) {
            clearTimeout(this._validationDebounceTimer);
            this._validationDebounceTimer = null;
        }
        
        if (this._usernameCheckTimer) {
            clearTimeout(this._usernameCheckTimer);
            this._usernameCheckTimer = null;
        }
        
        this._eventBus.emit('register_page:reset');
        
        return { success: true };
    }
    
    cleanup() {
        return this._cleanup();
    }
    
    getState() {
        return {
            pageState: this._currentState,
            formData: Object.fromEntries(this._formData),
            validationErrors: Object.fromEntries(this._validationErrors),
            usernameAvailability: this._usernameAvailability,
            config: { ...this._pageConfig }
        };
    }
    
    // ==================== PRIVATE METHODS ====================
    
    _initializeConfiguration() {
        this._pageConfig = {
            // Visual settings
            theme: 'default',
            language: 'fa',
            direction: 'rtl',
            
            // Form settings
            enableUsernameCheck: true,
            usernameCheckDelay: 500,
            requireEmailVerification: true,
            requireFullName: false,
            requireTerms: true,
            enableNewsletterOptIn: true,
            showPasswordStrength: true,
            confirmPasswordField: true,
            
            // Validation settings
            minPasswordLength: 8,
            maxPasswordLength: 72,
            minUsernameLength: 3,
            maxUsernameLength: 30,
            usernameRegex: '^[a-zA-Z0-9_.-]+$',
            requirePasswordUppercase: true,
            requirePasswordLowercase: true,
            requirePasswordNumbers: true,
            requirePasswordSpecialChars: true,
            
            // Behavior settings
            autoValidate: true,
            validateOnBlur: true,
            validateOnChange: false,
            autoLoginAfterRegister: false,
            successRedirectDelay: 2000,
            redirectAfterRegister: '/auth/registration-success',
            
            // UI settings
            showLogo: true,
            showLanguageSelector: false,
            showThemeToggle: false,
            showLoginLink: true,
            
            // Error messages
            errorMessages: {
                username_required: 'نام کاربری الزامی است',
                username_too_short: `نام کاربری باید حداقل {{min}} کاراکتر باشد`,
                username_too_long: `نام کاربری باید حداکثر {{max}} کاراکتر باشد`,
                username_invalid: 'نام کاربری فقط می‌تواند شامل حروف، اعداد و _ . - باشد',
                username_unavailable: 'این نام کاربری قبلاً ثبت شده است',
                email_required: 'ایمیل الزامی است',
                invalid_email: 'لطفا یک ایمیل معتبر وارد کنید',
                password_required: 'رمز عبور الزامی است',
                password_too_short: `رمز عبور باید حداقل {{min}} کاراکتر باشد`,
                password_too_long: `رمز عبور باید حداکثر {{max}} کاراکتر باشد`,
                password_no_uppercase: 'رمز عبور باید شامل حروف بزرگ باشد',
                password_no_lowercase: 'رمز عبور باید شامل حروف کوچک باشد',
                password_no_number: 'رمز عبور باید شامل اعداد باشد',
                password_no_special: 'رمز عبور باید شامل کاراکترهای ویژه (!@#$%^&* و ...) باشد',
                passwords_not_match: 'رمز عبور و تکرار آن مطابقت ندارند',
                full_name_required: 'نام کامل الزامی است',
                terms_not_accepted: 'برای ادامه باید قوانین را بپذیرید',
                registration_failed: 'ثبت‌نام انجام نشد',
                network_error: 'خطا در ارتباط با سرور',
                email_already_registered: 'این ایمیل قبلاً ثبت شده است'
            },
            
            // Success messages
            successMessages: {
                registration_success: 'ثبت‌نام موفقیت‌آمیز بود!',
                check_your_email: 'لطفا ایمیل خود را برای تأیید بررسی کنید',
                redirecting: 'در حال انتقال به صفحه ورود...'
            },
            
            // Password strength labels
            passwordStrengthLabels: {
                weak: 'ضعیف',
                fair: 'متوسط',
                good: 'خوب',
                strong: 'قوی',
                very_strong: 'خیلی قوی'
            }
        };
    }
    
    async _loadPageConfiguration() {
        try {
            // Load from central config
            const appConfig = this._config.get('app', {});
            const uiConfig = this._config.get('ui', {});
            const authConfig = this._config.get('auth', {});
            
            // Merge configurations
            this._pageConfig = {
                ...this._pageConfig,
                language: appConfig.defaultLanguage || 'fa',
                direction: appConfig.rtlLanguages?.includes(appConfig.defaultLanguage) ? 'rtl' : 'ltr',
                theme: uiConfig.theme || 'default',
                requireEmailVerification: authConfig.requireEmailVerification ?? true,
                autoLoginAfterRegister: authConfig.autoLoginAfterRegister ?? false,
                errorMessages: {
                    ...this._pageConfig.errorMessages,
                    ...authConfig.errorMessages
                }
            };
            
            // Load translations
            await this._loadTranslations();
            
        } catch (error) {
            console.warn('[RegisterPage] Failed to load configuration:', error);
        }
    }
    
    async _loadTranslations() {
        const translations = {
            fa: {
                title: 'ثبت‌نام در واکاموا',
                username_label: 'نام کاربری',
                username_placeholder: 'نام کاربری دلخواه',
                email_label: 'ایمیل',
                email_placeholder: 'example@domain.com',
                password_label: 'رمز عبور',
                password_placeholder: 'رمز عبور قوی انتخاب کنید',
                confirm_password_label: 'تکرار رمز عبور',
                confirm_password_placeholder: 'رمز عبور را تکرار کنید',
                full_name_label: 'نام کامل',
                full_name_placeholder: 'نام و نام خانوادگی',
                terms_label: 'با <a href="/terms">قوانین</a> و <a href="/privacy">حریم خصوصی</a> موافقم',
                newsletter_label: 'مایل به دریافت خبرنامه و اطلاعیه‌ها هستم',
                submit_button: 'ثبت‌نام',
                already_account: 'قبلاً حساب دارید؟',
                login_here: 'وارد شوید',
                loading: 'در حال ثبت‌نام...',
                success: 'ثبت‌نام موفقیت‌آمیز!',
                checking_username: 'در حال بررسی نام کاربری...',
                username_available: 'نام کاربری آزاد است',
                username_unavailable: 'نام کاربری قبلاً ثبت شده',
                password_strength: 'قدرت رمز عبور'
            }
        };
        
        this._translations = translations[this._pageConfig.language] || translations.fa;
    }
    
    _initializeFormData() {
        this._formData.set(this.FORM_FIELDS.USERNAME, '');
        this._formData.set(this.FORM_FIELDS.EMAIL, '');
        this._formData.set(this.FORM_FIELDS.PASSWORD, '');
        this._formData.set(this.FORM_FIELDS.CONFIRM_PASSWORD, '');
        this._formData.set(this.FORM_FIELDS.FULL_NAME, '');
        this._formData.set(this.FORM_FIELDS.TERMS_ACCEPTED, false);
        this._formData.set(this.FORM_FIELDS.NEWSLETTER_SUBSCRIBED, false);
    }
    
    _setupEventListeners() {
        // Listen for auth state changes
        const authSubscription = this._eventBus.on('auth:state_changed', (event) => {
            if (event.isAuthenticated && this._currentState === this.PAGE_STATES.SUCCESS) {
                this._router.navigateTo('/dashboard', { replace: true });
            }
        });
        
        // Listen for config changes
        const configSubscription = this._config.subscribe?.('auth.', (newValue, oldValue, path) => {
            this._loadPageConfiguration();
            this._eventBus.emit('register_page:config_updated', { path });
        });
        
        // Listen for language changes
        const languageSubscription = this._eventBus.on('language:changed', (event) => {
            this._pageConfig.language = event.language;
            this._pageConfig.direction = event.direction;
            this._loadTranslations();
            this._render(document.getElementById('app')?.id || 'app');
        });
        
        // Store subscriptions for cleanup
        this._subscriptions.set('auth', authSubscription);
        if (configSubscription) this._subscriptions.set('config', configSubscription);
        this._subscriptions.set('language', languageSubscription);
    }
    
    async _render(containerId) {
        const container = document.getElementById(containerId);
        if (!container) {
            throw new Error(`Container #${containerId} not found`);
        }
        
        // Clear container
        container.innerHTML = '';
        
        // Create page structure
        const pageElement = document.createElement('div');
        pageElement.className = `register-page ${this._pageConfig.direction} theme-${this._pageConfig.theme}`;
        pageElement.setAttribute('data-state', this._currentState);
        
        // Generate HTML
        pageElement.innerHTML = this._generateHTML();
        
        // Append to container
        container.appendChild(pageElement);
        
        // Cache UI elements
        this._cacheUIElements(pageElement);
        
        // Attach event listeners to form elements
        this._attachEventListeners();
        
        // Update UI based on current state
        this._updateUIState();
        
        // Emit render event
        this._eventBus.emit('register_page:rendered', {
            containerId,
            state: this._currentState
        });
        
        return pageElement;
    }
    
    _generateHTML() {
        const t = this._translations;
        const config = this._pageConfig;
        
        return `
            <div class="register-container">
                ${config.showLogo ? this._generateLogo() : ''}
                
                <div class="register-card">
                    <h1 class="register-title">${t.title}</h1>
                    
                    <form class="register-form" id="registerForm" novalidate>
                        <!-- Username field -->
                        <div class="form-group">
                            <label for="username">${t.username_label}</label>
                            <div class="input-with-status">
                                <input 
                                    type="text" 
                                    id="username" 
                                    name="username"
                                    class="form-input ${this._validationErrors.has('username') ? 'error' : ''}"
                                    placeholder="${t.username_placeholder}"
                                    value="${this._formData.get('username')}"
                                    minlength="${config.minUsernameLength}"
                                    maxlength="${config.maxUsernameLength}"
                                    ${this._currentState === this.PAGE_STATES.LOADING ? 'disabled' : ''}
                                />
                                <div class="input-status" id="usernameStatus"></div>
                            </div>
                            ${this._generateErrorDisplay('username')}
                            ${this._generateUsernameAvailabilityDisplay()}
                        </div>
                        
                        <!-- Email field -->
                        <div class="form-group">
                            <label for="email">${t.email_label}</label>
                            <input 
                                type="email" 
                                id="email" 
                                name="email"
                                class="form-input ${this._validationErrors.has('email') ? 'error' : ''}"
                                placeholder="${t.email_placeholder}"
                                value="${this._formData.get('email')}"
                                ${this._currentState === this.PAGE_STATES.LOADING ? 'disabled' : ''}
                            />
                            ${this._generateErrorDisplay('email')}
                        </div>
                        
                        <!-- Password field -->
                        <div class="form-group">
                            <label for="password">${t.password_label}</label>
                            <div class="password-input-container">
                                <input 
                                    type="password" 
                                    id="password" 
                                    name="password"
                                    class="form-input ${this._validationErrors.has('password') ? 'error' : ''}"
                                    placeholder="${t.password_placeholder}"
                                    value="${this._formData.get('password')}"
                                    minlength="${config.minPasswordLength}"
                                    maxlength="${config.maxPasswordLength}"
                                    ${this._currentState === this.PAGE_STATES.LOADING ? 'disabled' : ''}
                                />
                                <button type="button" class="password-toggle" aria-label="نمایش رمز عبور">👁️</button>
                            </div>
                            ${this._generateErrorDisplay('password')}
                            ${config.showPasswordStrength ? this._generatePasswordStrengthDisplay() : ''}
                        </div>
                        
                        <!-- Confirm password field -->
                        ${config.confirmPasswordField ? `
                            <div class="form-group">
                                <label for="confirmPassword">${t.confirm_password_label}</label>
                                <input 
                                    type="password" 
                                    id="confirmPassword" 
                                    name="confirm_password"
                                    class="form-input ${this._validationErrors.has('confirm_password') ? 'error' : ''}"
                                    placeholder="${t.confirm_password_placeholder}"
                                    value="${this._formData.get('confirm_password')}"
                                    ${this._currentState === this.PAGE_STATES.LOADING ? 'disabled' : ''}
                                />
                                ${this._generateErrorDisplay('confirm_password')}
                            </div>
                        ` : ''}
                        
                        <!-- Full name field (optional) -->
                        ${config.requireFullName ? `
                            <div class="form-group">
                                <label for="fullName">${t.full_name_label}</label>
                                <input 
                                    type="text" 
                                    id="fullName" 
                                    name="full_name"
                                    class="form-input ${this._validationErrors.has('full_name') ? 'error' : ''}"
                                    placeholder="${t.full_name_placeholder}"
                                    value="${this._formData.get('full_name')}"
                                    ${this._currentState === this.PAGE_STATES.LOADING ? 'disabled' : ''}
                                />
                                ${this._generateErrorDisplay('full_name')}
                            </div>
                        ` : ''}
                        
                        <!-- Terms and conditions -->
                        ${config.requireTerms ? `
                            <div class="form-group terms-group">
                                <label class="checkbox-label">
                                    <input 
                                        type="checkbox" 
                                        id="termsAccepted" 
                                        name="terms_accepted"
                                        ${this._formData.get('terms_accepted') ? 'checked' : ''}
                                        ${this._currentState === this.PAGE_STATES.LOADING ? 'disabled' : ''}
                                    />
                                    <span>${t.terms_label}</span>
                                </label>
                                ${this._generateErrorDisplay('terms_accepted')}
                            </div>
                        ` : ''}
                        
                        <!-- Newsletter subscription -->
                        ${config.enableNewsletterOptIn ? `
                            <div class="form-group newsletter-group">
                                <label class="checkbox-label">
                                    <input 
                                        type="checkbox" 
                                        id="newsletterSubscribed" 
                                        name="newsletter_subscribed"
                                        ${this._formData.get('newsletter_subscribed') ? 'checked' : ''}
                                        ${this._currentState === this.PAGE_STATES.LOADING ? 'disabled' : ''}
                                    />
                                    <span>${t.newsletter_label}</span>
                                </label>
                            </div>
                        ` : ''}
                        
                        <!-- Submit button -->
                        <div class="form-group">
                            <button 
                                type="submit" 
                                class="submit-button"
                                id="submitButton"
                                ${this._currentState === this.PAGE_STATES.LOADING ? 'disabled' : ''}
                            >
                                ${this._currentState === this.PAGE_STATES.LOADING ? 
                                    `<span class="loading-spinner"></span> ${t.loading}` : 
                                    t.submit_button
                                }
                            </button>
                        </div>
                    </form>
                    
                    <!-- Login link -->
                    ${config.showLoginLink ? `
                        <div class="login-link">
                            <span>${t.already_account}</span>
                            <button type="button" class="link-button" id="loginLink">
                                ${t.login_here}
                            </button>
                        </div>
                    ` : ''}
                </div>
                
                ${config.showLanguageSelector ? this._generateLanguageSelector() : ''}
                ${config.showThemeToggle ? this._generateThemeToggle() : ''}
            </div>
        `;
    }
    
    _generateLogo() {
        return `
            <div class="register-logo">
                <svg width="64" height="64" viewBox="0 0 64 64">
                    <circle cx="32" cy="32" r="30" fill="#4F46E5" opacity="0.9"/>
                    <text x="32" y="40" text-anchor="middle" fill="white" font-size="24" font-weight="bold">V</text>
                </svg>
                <h2 class="logo-text">Vakamova</h2>
            </div>
        `;
    }
    
    _generateErrorDisplay(field) {
        if (!this._validationErrors.has(field)) return '';
        
        const errors = this._validationErrors.get(field);
        return `
            <div class="error-messages" id="error-${field}">
                ${errors.map(error => {
                    let message = this._pageConfig.errorMessages[error] || error;
                    // Replace placeholders
                    message = message.replace('{{min}}', this._pageConfig.minPasswordLength);
                    message = message.replace('{{max}}', this._pageConfig.maxPasswordLength);
                    return `<div class="error-message">${message}</div>`;
                }).join('')}
            </div>
        `;
    }
    
    _generateUsernameAvailabilityDisplay() {
        if (!this._pageConfig.enableUsernameCheck || !this._formData.get('username')) {
            return '';
        }
        
        let display = '';
        
        if (this._currentState === this.PAGE_STATES.CHECKING_USERNAME) {
            display = `<div class="username-status checking">${this._translations.checking_username}</div>`;
        } else if (this._usernameAvailability === true) {
            display = `<div class="username-status available">${this._translations.username_available}</div>`;
        } else if (this._usernameAvailability === false) {
            display = `<div class="username-status unavailable">${this._translations.username_unavailable}</div>`;
        }
        
        return display;
    }
    
    _generatePasswordStrengthDisplay() {
        const password = this._formData.get('password') || '';
        if (!password) return '';
        
        const strength = this._calculatePasswordStrength(password);
        const label = this._pageConfig.passwordStrengthLabels[strength.level] || strength.level;
        
        return `
            <div class="password-strength">
                <div class="strength-label">${this._translations.password_strength}: ${label}</div>
                <div class="strength-meter">
                    <div class="strength-bar" style="width: ${strength.percentage}%; background-color: ${strength.color};"></div>
                </div>
            </div>
        `;
    }
    
    _calculatePasswordStrength(password) {
        let score = 0;
        
        // Length score
        if (password.length >= this._pageConfig.minPasswordLength) score += 1;
        if (password.length >= 12) score += 1;
        if (password.length >= 16) score += 1;
        
        // Character variety score
        if (/[A-Z]/.test(password)) score += 1;
        if (/[a-z]/.test(password)) score += 1;
        if (/[0-9]/.test(password)) score += 1;
        if (/[^A-Za-z0-9]/.test(password)) score += 1;
        
        // Bonus for mixed case and numbers
        if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score += 1;
        if (/[0-9]/.test(password) && /[^A-Za-z0-9]/.test(password)) score += 1;
        
        // Determine strength level
        let level, percentage, color;
        
        if (score <= 3) {
            level = 'weak';
            percentage = 25;
            color = '#ff5252';
        } else if (score <= 5) {
            level = 'fair';
            percentage = 50;
            color = '#ffb74d';
        } else if (score <= 7) {
            level = 'good';
            percentage = 75;
            color = '#64b5f6';
        } else if (score <= 9) {
            level = 'strong';
            percentage = 90;
            color = '#4CAF50';
        } else {
            level = 'very_strong';
            percentage = 100;
            color = '#2E7D32';
        }
        
        return { level, percentage, color, score };
    }
    
    _generateLanguageSelector() {
        return `
            <div class="language-selector">
                <select id="languageSelect">
                    <option value="fa" ${this._pageConfig.language === 'fa' ? 'selected' : ''}>فارسی</option>
                    <option value="en" ${this._pageConfig.language === 'en' ? 'selected' : ''}>English</option>
                    <option value="ar" ${this._pageConfig.language === 'ar' ? 'selected' : ''}>العربية</option>
                </select>
            </div>
        `;
    }
    
    _generateThemeToggle() {
        return `
            <div class="theme-toggle">
                <button type="button" id="themeToggle" aria-label="تغییر تم">
                    ${this._pageConfig.theme === 'dark' ? '☀️' : '🌙'}
                </button>
            </div>
        `;
    }
    
    _cacheUIElements(container) {
        this._uiElements.clear();
        
        const elements = {
            form: container.querySelector('#registerForm'),
            usernameInput: container.querySelector('#username'),
            emailInput: container.querySelector('#email'),
            passwordInput: container.querySelector('#password'),
            confirmPasswordInput: container.querySelector('#confirmPassword'),
            fullNameInput: container.querySelector('#fullName'),
            termsCheckbox: container.querySelector('#termsAccepted'),
            newsletterCheckbox: container.querySelector('#newsletterSubscribed'),
            submitButton: container.querySelector('#submitButton'),
            loginLinkButton: container.querySelector('#loginLink'),
            passwordToggle: container.querySelector('.password-toggle'),
            languageSelect: container.querySelector('#languageSelect'),
            themeToggle: container.querySelector('#themeToggle'),
            usernameStatus: container.querySelector('#usernameStatus')
        };
        
        for (const [key, element] of Object.entries(elements)) {
            if (element) {
                this._uiElements.set(key, element);
            }
        }
    }
    
    _attachEventListeners() {
        // Form submit
        const form = this._uiElements.get('form');
        if (form) {
            form.addEventListener('submit', this._handleFormSubmit);
        }
        
        // Input events with debouncing
        this._attachInputListeners();
        
        // Password toggle
        const passwordToggle = this._uiElements.get('passwordToggle');
        if (passwordToggle) {
            passwordToggle.addEventListener('click', () => {
                const input = this._uiElements.get('passwordInput');
                if (input) {
                    const type = input.type === 'password' ? 'text' : 'password';
                    input.type = type;
                    passwordToggle.setAttribute('aria-label', 
                        type === 'password' ? 'نمایش رمز عبور' : 'مخفی کردن رمز عبور'
                    );
                }
            });
        }
        
        // Checkboxes
        const termsCheckbox = this._uiElements.get('termsCheckbox');
        if (termsCheckbox) {
            termsCheckbox.addEventListener('change', this._handleTermsChange);
        }
        
        const newsletterCheckbox = this._uiElements.get('newsletterCheckbox');
        if (newsletterCheckbox) {
            newsletterCheckbox.addEventListener('change', this._handleNewsletterChange);
        }
        
        // Login link
        const loginLinkButton = this._uiElements.get('loginLinkButton');
        if (loginLinkButton) {
            loginLinkButton.addEventListener('click', () => {
                this._router.navigateTo('/login');
            });
        }
        
        // Language selector
        const languageSelect = this._uiElements.get('languageSelect');
        if (languageSelect) {
            languageSelect.addEventListener('change', (e) => {
                this._eventBus.emit('language:changed', {
                    language: e.target.value,
                    direction: e.target.value === 'fa' || e.target.value === 'ar' ? 'rtl' : 'ltr'
                });
            });
        }
        
        // Theme toggle
        const themeToggle = this._uiElements.get('themeToggle');
        if (themeToggle) {
            themeToggle.addEventListener('click', () => {
                const newTheme = this._pageConfig.theme === 'dark' ? 'light' : 'dark';
                this._pageConfig.theme = newTheme;
                this._eventBus.emit('theme:changed', { theme: newTheme });
                this._render(document.getElementById('app')?.id || 'app');
            });
        }
    }
    
    _attachInputListeners() {
        // Username input with debounced availability check
        const usernameInput = this._uiElements.get('usernameInput');
        if (usernameInput) {
            usernameInput.addEventListener('input', this._handleUsernameChange);
            
            if (this._pageConfig.validateOnBlur) {
                usernameInput.addEventListener('blur', () => {
                    this.validateForm('username');
                });
            }
        }
        
        // Email input
        const emailInput = this._uiElements.get('emailInput');
        if (emailInput) {
            emailInput.addEventListener('input', this._handleEmailChange);
            
            if (this._pageConfig.validateOnBlur) {
                emailInput.addEventListener('blur', () => {
                    this.validateForm('email');
                });
            }
        }
        
        // Password input with strength calculation
        const passwordInput = this._uiElements.get('passwordInput');
        if (passwordInput) {
            passwordInput.addEventListener('input', this._handlePasswordChange);
            
            if (this._pageConfig.validateOnBlur) {
                passwordInput.addEventListener('blur', () => {
                    this.validateForm('password');
                });
            }
        }
        
        // Confirm password input
        const confirmPasswordInput = this._uiElements.get('confirmPasswordInput');
        if (confirmPasswordInput) {
            confirmPasswordInput.addEventListener('input', this._handleConfirmPasswordChange);
            
            if (this._pageConfig.validateOnBlur) {
                confirmPasswordInput.addEventListener('blur', () => {
                    this.validateForm('confirm_password');
                });
            }
        }
        
        // Full name input (if exists)
        const fullNameInput = this._uiElements.get('fullNameInput');
        if (fullNameInput) {
            fullNameInput.addEventListener('input', this._handleFullNameChange);
            
            if (this._pageConfig.validateOnBlur) {
                fullNameInput.addEventListener('blur', () => {
                    this.validateForm('full_name');
                });
            }
        }
    }
    
    _handleUsernameChange(e) {
        const value = e.target.value.trim();
        this._formData.set(this.FORM_FIELDS.USERNAME, value);
        
        // Clear previous timer
        if (this._usernameCheckTimer) {
            clearTimeout(this._usernameCheckTimer);
        }
        
        // Clear previous availability status
        this._usernameAvailability = null;
        
        // Update UI
        this._updateUsernameAvailabilityDisplay();
        
        // Validate if configured
        if (this._pageConfig.autoValidate && value.length >= this._pageConfig.minUsernameLength) {
            // Debounce validation
            if (this._validationDebounceTimer) {
                clearTimeout(this._validationDebounceTimer);
            }
            
            this._validationDebounceTimer = setTimeout(() => {
                this.validateForm('username');
            }, 300);
            
            // Check username availability
            if (this._pageConfig.enableUsernameCheck && value.length >= 3) {
                this._usernameCheckTimer = setTimeout(() => {
                    this._checkUsernameAvailability(value);
                }, this._pageConfig.usernameCheckDelay);
            }
        }
        
        this._eventBus.emit('register_page:username_changed', { value });
    }
    
    _handleEmailChange(e) {
        const value = e.target.value.trim();
        this._formData.set(this.FORM_FIELDS.EMAIL, value);
        
        // Validate if configured
        if (this._pageConfig.autoValidate) {
            if (this._validationDebounceTimer) {
                clearTimeout(this._validationDebounceTimer);
            }
            
            this._validationDebounceTimer = setTimeout(() => {
                this.validateForm('email');
            }, 500);
        }
        
        this._eventBus.emit('register_page:email_changed', { value });
    }
    
    _handlePasswordChange(e) {
        const value = e.target.value;
        this._formData.set(this.FORM_FIELDS.PASSWORD, value);
        
        // Update password strength display
        if (this._pageConfig.showPasswordStrength) {
            this._updatePasswordStrengthDisplay();
        }
        
        // Validate if configured
        if (this._pageConfig.autoValidate) {
            if (this._validationDebounceTimer) {
                clearTimeout(this._validationDebounceTimer);
            }
            
            this._validationDebounceTimer = setTimeout(() => {
                this.validateForm('password');
            }, 300);
        }
        
        this._eventBus.emit('register_page:password_changed', { length: value.length });
    }
    
    _handleConfirmPasswordChange(e) {
        const value = e.target.value;
        this._formData.set(this.FORM_FIELDS.CONFIRM_PASSWORD, value);
        
        // Validate if configured
        if (this._pageConfig.autoValidate && this._formData.get('password')) {
            if (this._validationDebounceTimer) {
                clearTimeout(this._validationDebounceTimer);
            }
            
            this._validationDebounceTimer = setTimeout(() => {
                this.validateForm('confirm_password');
            }, 300);
        }
        
        this._eventBus.emit('register_page:confirm_password_changed', {});
    }
    
    _handleFullNameChange(e) {
        const value = e.target.value.trim();
        this._formData.set(this.FORM_FIELDS.FULL_NAME, value);
        
        this._eventBus.emit('register_page:full_name_changed', { value });
    }
    
    _handleTermsChange(e) {
        const value = e.target.checked;
        this._formData.set(this.FORM_FIELDS.TERMS_ACCEPTED, value);
        
        this._eventBus.emit('register_page:terms_changed', { value });
    }
    
    _handleNewsletterChange(e) {
        const value = e.target.checked;
        this._formData.set(this.FORM_FIELDS.NEWSLETTER_SUBSCRIBED, value);
        
        this._eventBus.emit('register_page:newsletter_changed', { value });
    }
    
    async _checkUsernameAvailability(username) {
        if (!username || username.length < this._pageConfig.minUsernameLength) {
            return;
        }
        
        try {
            this._setPageState(this.PAGE_STATES.CHECKING_USERNAME);
            
            const result = await this._authManager.validateUsername(username);
            
            this._usernameAvailability = result.available;
            
            // Update UI
            this._updateUsernameAvailabilityDisplay();
            
            // Emit event
            this._eventBus.emit('register_page:username_availability_checked', {
                username,
                available: result.available,
                suggestions: result.suggestions
            });
            
            this._setPageState(this.PAGE_STATES.INITIAL);
            
        } catch (error) {
            console.error('[RegisterPage] Username check failed:', error);
            this._usernameAvailability = null;
            this._setPageState(this.PAGE_STATES.INITIAL);
        }
    }
    
    async _handleFormSubmit(e) {
        e.preventDefault();
        await this.submit();
    }
    
    async _handleAutoLogin(registerData) {
        try {
            // Attempt to auto-login
            const loginResult = await this._authManager.login({
                email: registerData.email,
                password: registerData.password,
                remember_me: true
            });
            
            if (loginResult.success) {
                this._eventBus.emit('register_page:auto_login_success', {
                    userId: loginResult.user?.id,
                    timestamp: Date.now()
                });
                
                // Redirect to dashboard
                setTimeout(() => {
                    this._router.navigateTo('/dashboard', { 
                        replace: true,
                        transition: 'slide-left'
                    });
                }, 1000);
                
            } else {
                // Redirect to login page if auto-login fails
                this._router.navigateTo('/login', {
                    state: { 
                        email: registerData.email,
                        message: 'registration_success_please_login'
                    }
                });
            }
            
        } catch (error) {
            console.error('[RegisterPage] Auto-login failed:', error);
            this._router.navigateTo('/login', {
                state: { email: registerData.email }
            });
        }
    }
    
    async _validateField(field, value) {
        const validators = {
            [this.FORM_FIELDS.USERNAME]: this._validateUsername.bind(this),
            [this.FORM_FIELDS.EMAIL]: this._validateEmail.bind(this),
            [this.FORM_FIELDS.PASSWORD]: this._validatePassword.bind(this),
            [this.FORM_FIELDS.CONFIRM_PASSWORD]: this._validateConfirmPassword.bind(this),
            [this.FORM_FIELDS.FULL_NAME]: this._validateFullName.bind(this),
            [this.FORM_FIELDS.TERMS_ACCEPTED]: this._validateTerms.bind(this)
        };
        
        const validator = validators[field];
        if (validator) {
            return validator(value);
        }
        
        return { isValid: true, errors: [] };
    }
    
    _validateUsername(username) {
        const errors = [];
        const config = this._pageConfig;
        
        if (!username) {
            errors.push('username_required');
        } else {
            if (username.length < config.minUsernameLength) {
                errors.push('username_too_short');
            }
            
            if (username.length > config.maxUsernameLength) {
                errors.push('username_too_long');
            }
            
            if (!new RegExp(config.usernameRegex).test(username)) {
                errors.push('username_invalid');
            }
            
            // Check availability if already determined
            if (this._usernameAvailability === false) {
                errors.push('username_unavailable');
            }
        }
        
        return {
            isValid: errors.length === 0,
            errors
        };
    }
    
    _validateEmail(email) {
        const errors = [];
        
        if (!email) {
            errors.push('email_required');
        } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            errors.push('invalid_email');
        }
        
        return {
            isValid: errors.length === 0,
            errors
        };
    }
    
    _validatePassword(password) {
        const errors = [];
        const config = this._pageConfig;
        
        if (!password) {
            errors.push('password_required');
        } else {
            if (password.length < config.minPasswordLength) {
                errors.push('password_too_short');
            }
            
            if (password.length > config.maxPasswordLength) {
                errors.push('password_too_long');
            }
            
            if (config.requirePasswordUppercase && !/[A-Z]/.test(password)) {
                errors.push('password_no_uppercase');
            }
            
            if (config.requirePasswordLowercase && !/[a-z]/.test(password)) {
                errors.push('password_no_lowercase');
            }
            
            if (config.requirePasswordNumbers && !/[0-9]/.test(password)) {
                errors.push('password_no_number');
            }
            
            if (config.requirePasswordSpecialChars && !/[^A-Za-z0-9]/.test(password)) {
                errors.push('password_no_special');
            }
        }
        
        return {
            isValid: errors.length === 0,
            errors
        };
    }
    
    _validateConfirmPassword(confirmPassword) {
        const errors = [];
        const password = this._formData.get('password');
        
        if (confirmPassword !== password) {
            errors.push('passwords_not_match');
        }
        
        return {
            isValid: errors.length === 0,
            errors
        };
    }
    
    _validateFullName(fullName) {
        const errors = [];
        
        if (this._pageConfig.requireFullName && !fullName) {
            errors.push('full_name_required');
        }
        
        return {
            isValid: errors.length === 0,
            errors
        };
    }
    
    _validateTerms(accepted) {
        const errors = [];
        
        if (this._pageConfig.requireTerms && !accepted) {
            errors.push('terms_not_accepted');
        }
        
        return {
            isValid: errors.length === 0,
            errors
        };
    }
    
    _setPageState(newState) {
        const oldState = this._currentState;
        this._currentState = newState;
        
        // Update UI
        this._updateUIState();
        
        // Emit state change event
        this._eventBus.emit('register_page:state_changed', {
            oldState,
            newState,
            timestamp: Date.now()
        });
    }
    
    _updateUIState() {
        const pageElement = document.querySelector('.register-page');
        if (pageElement) {
            pageElement.setAttribute('data-state', this._currentState);
        }
        
        // Update submit button
        const submitButton = this._uiElements.get('submitButton');
        if (submitButton) {
            submitButton.disabled = this._currentState === this.PAGE_STATES.LOADING;
        }
        
        // Update inputs
        const inputs = [
            'usernameInput', 
            'emailInput', 
            'passwordInput', 
            'confirmPasswordInput', 
            'fullNameInput'
        ];
        
        inputs.forEach(inputKey => {
            const input = this._uiElements.get(inputKey);
            if (input) {
                input.disabled = this._currentState === this.PAGE_STATES.LOADING;
            }
        });
        
        // Update checkboxes
        const checkboxes = ['termsCheckbox', 'newsletterCheckbox'];
        checkboxes.forEach(checkboxKey => {
            const checkbox = this._uiElements.get(checkboxKey);
            if (checkbox) {
                checkbox.disabled = this._currentState === this.PAGE_STATES.LOADING;
            }
        });
        
        // Update other interactive elements
        const interactiveElements = [
            'loginLinkButton',
            'passwordToggle',
            'languageSelect',
            'themeToggle'
        ];
        
        interactiveElements.forEach(elementKey => {
            const element = this._uiElements.get(elementKey);
            if (element) {
                element.disabled = this._currentState === this.PAGE_STATES.LOADING;
            }
        });
    }
    
    _updateFormDisplay() {
        // Update input values
        const fields = {
            'usernameInput': this.FORM_FIELDS.USERNAME,
            'emailInput': this.FORM_FIELDS.EMAIL,
            'passwordInput': this.FORM_FIELDS.PASSWORD,
            'confirmPasswordInput': this.FORM_FIELDS.CONFIRM_PASSWORD,
            'fullNameInput': this.FORM_FIELDS.FULL_NAME
        };
        
        for (const [elementKey, fieldName] of Object.entries(fields)) {
            const element = this._uiElements.get(elementKey);
            if (element) {
                element.value = this._formData.get(fieldName) || '';
            }
        }
        
        // Update checkboxes
        const termsCheckbox = this._uiElements.get('termsCheckbox');
        if (termsCheckbox) {
            termsCheckbox.checked = this._formData.get(this.FORM_FIELDS.TERMS_ACCEPTED) || false;
        }
        
        const newsletterCheckbox = this._uiElements.get('newsletterCheckbox');
        if (newsletterCheckbox) {
            newsletterCheckbox.checked = this._formData.get(this.FORM_FIELDS.NEWSLETTER_SUBSCRIBED) || false;
        }
    }
    
    _updateValidationDisplay() {
        // Update error displays for all fields
        for (const [fieldName] of this._formData) {
            const elementKey = this._getElementKeyForField(fieldName);
            const input = this._uiElements.get(elementKey);
            const errorContainer = document.getElementById(`error-${fieldName}`);
            
            if (input) {
                if (this._validationErrors.has(fieldName)) {
                    input.classList.add('error');
                } else {
                    input.classList.remove('error');
                }
            }
            
            if (errorContainer) {
                if (this._validationErrors.has(fieldName)) {
                    const errors = this._validationErrors.get(fieldName);
                    errorContainer.innerHTML = errors.map(error => {
                        let message = this._pageConfig.errorMessages[error] || error;
                        message = message.replace('{{min}}', this._pageConfig.minPasswordLength);
                        message = message.replace('{{max}}', this._pageConfig.maxPasswordLength);
                        return `<div class="error-message">${message}</div>`;
                    }).join('');
                    errorContainer.style.display = 'block';
                } else {
                    errorContainer.style.display = 'none';
                }
            }
        }
    }
    
    _updateUsernameAvailabilityDisplay() {
        const usernameStatus = this._uiElements.get('usernameStatus');
        if (!usernameStatus) return;
        
        usernameStatus.innerHTML = '';
        
        if (this._currentState === this.PAGE_STATES.CHECKING_USERNAME) {
            usernameStatus.innerHTML = `<span class="checking">${this._translations.checking_username}</span>`;
            usernameStatus.className = 'input-status checking';
        } else if (this._usernameAvailability === true) {
            usernameStatus.innerHTML = `<span class="available">${this._translations.username_available}</span>`;
            usernameStatus.className = 'input-status available';
        } else if (this._usernameAvailability === false) {
            usernameStatus.innerHTML = `<span class="unavailable">${this._translations.username_unavailable}</span>`;
            usernameStatus.className = 'input-status unavailable';
        } else {
            usernameStatus.className = 'input-status';
        }
    }
    
    _updatePasswordStrengthDisplay() {
        // This will be handled by the render function
        // We just need to trigger a re-render of the strength display
        const password = this._formData.get('password') || '';
        if (password && this._pageConfig.showPasswordStrength) {
            // Find and update the strength display
            const strengthDisplay = document.querySelector('.password-strength');
            if (strengthDisplay) {
                const strength = this._calculatePasswordStrength(password);
                const label = this._pageConfig.passwordStrengthLabels[strength.level] || strength.level;
                
                strengthDisplay.querySelector('.strength-label').textContent = 
                    `${this._translations.password_strength}: ${label}`;
                
                const strengthBar = strengthDisplay.querySelector('.strength-bar');
                strengthBar.style.width = `${strength.percentage}%`;
                strengthBar.style.backgroundColor = strength.color;
            }
        }
    }
    
    _getElementKeyForField(fieldName) {
        const mapping = {
            [this.FORM_FIELDS.USERNAME]: 'usernameInput',
            [this.FORM_FIELDS.EMAIL]: 'emailInput',
            [this.FORM_FIELDS.PASSWORD]: 'passwordInput',
            [this.FORM_FIELDS.CONFIRM_PASSWORD]: 'confirmPasswordInput',
            [this.FORM_FIELDS.FULL_NAME]: 'fullNameInput'
        };
        
        return mapping[fieldName] || null;
    }
    
    _getDeviceInfo() {
        return {
            userAgent: navigator.userAgent,
            platform: navigator.platform,
            language: navigator.language,
            screenSize: `${window.screen.width}x${window.screen.height}`,
            isMobile: /Mobi|Android/i.test(navigator.userAgent),
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
        };
    }
    
    _cleanup() {
        // Remove event listeners
        const form = this._uiElements.get('form');
        if (form) {
            form.removeEventListener('submit', this._handleFormSubmit);
        }
        
        // Unsubscribe from events
        for (const unsubscribe of this._subscriptions.values()) {
            if (typeof unsubscribe === 'function') {
                unsubscribe();
            }
        }
        
        this._subscriptions.clear();
        this._uiElements.clear();
        
        // Clear timers
        if (this._validationDebounceTimer) {
            clearTimeout(this._validationDebounceTimer);
            this._validationDebounceTimer = null;
        }
        
        if (this._usernameCheckTimer) {
            clearTimeout(this._usernameCheckTimer);
            this._usernameCheckTimer = null;
        }
        
        // Emit cleanup event
        this._eventBus.emit('register_page:cleanup');
        
        return { success: true };
    }
}

// ==================== EXPORT PATTERN ====================

function createRegisterPage(dependencies = {}) {
    return new VakamovaRegisterPage(dependencies);
}

export { VakamovaRegisterPage, createRegisterPage };
