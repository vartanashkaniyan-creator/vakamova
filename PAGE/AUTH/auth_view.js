/**
 * VAKAMOVA AUTH VIEW - رابط کاربری پیشرفته احراز هویت
 * اصول: تزریق وابستگی، قرارداد رابط، رویدادمحور، پیکربندی متمرکز
 */

class AuthView {
    constructor(services = {}) {
        // تزریق وابستگی‌های اصلی
        this.services = {
            eventBus: services.eventBus || window.eventBus,
            authManager: services.authManager || window.authManager,
            stateManager: services.stateManager || window.stateManager,
            router: services.router || window.router,
            config: services.config || {}
        };
        
        this._validateServices();
        
        // وضعیت داخلی کامپوننت
        this.state = {
            mode: 'login', // 'login' | 'register' | 'forgot' | 'reset'
            loading: false,
            errors: {},
            formData: {
                email: '',
                username: '',
                password: '',
                confirmPassword: '',
                rememberMe: false,
                agreeToTerms: false
            },
            validation: {
                email: { isValid: false, message: '' },
                password: { isValid: false, message: '' },
                username: { isValid: false, message: '' }
            },
            socialProviders: ['google', 'github', 'microsoft'],
            passwordStrength: 0
        };
        
        // پیکربندی
        this.config = Object.freeze({
            enableSocialLogin: true,
            enableRememberMe: true,
            enableTermsCheckbox: true,
            passwordMinLength: 8,
            autoFocus: true,
            animationDuration: 300,
            ...this.services.config.authView
        });
        
        // رجیستری المنت‌های DOM
        this.elements = {};
        
        // ایونت‌های سفارشی
        this.EVENTS = {
            VIEW_READY: 'auth:view:ready',
            FORM_SUBMIT: 'auth:form:submit',
            FORM_VALIDATION: 'auth:form:validation',
            SOCIAL_LOGIN: 'auth:social:login',
            MODE_CHANGE: 'auth:mode:change',
            PASSWORD_STRENGTH: 'auth:password:strength'
        };
        
        // Bind methods
        this._init = this._init.bind(this);
        this.render = this.render.bind(this);
        this._handleSubmit = this._handleSubmit.bind(this);
        this._handleSocialLogin = this._handleSocialLogin.bind(this);
        
        this._init();
    }
    
    // ==================== PUBLIC API ====================
    
    async render(containerId = 'auth-container') {
        const container = document.getElementById(containerId);
        if (!container) {
            throw new Error(`Container #${containerId} not found`);
        }
        
        this.elements.container = container;
        
        // رندر HTML
        container.innerHTML = this._generateHTML();
        
        // کش کردن المنت‌ها
        this._cacheElements();
        
        // تنظیم event listeners
        this._setupEventListeners();
        
        // انیمیشن ورود
        setTimeout(() => {
            container.style.opacity = 1;
            container.style.transform = 'translateY(0)';
        }, 50);
        
        // انتشار ایونت آماده بودن
        this.services.eventBus.emit(this.EVENTS.VIEW_READY, {
            mode: this.state.mode,
            timestamp: Date.now()
        });
        
        console.log('[AuthView] ✅ رندر شد');
    }
    
    setMode(mode) {
        const validModes = ['login', 'register', 'forgot', 'reset'];
        if (!validModes.includes(mode)) {
            throw new Error(`Invalid mode: ${mode}`);
        }
        
        const oldMode = this.state.mode;
        this.state.mode = mode;
        
        // ریست فرم در صورت تغییر مد
        if (oldMode !== mode) {
            this._resetForm();
            this.render();
            
            this.services.eventBus.emit(this.EVENTS.MODE_CHANGE, {
                from: oldMode,
                to: mode,
                timestamp: Date.now()
            });
        }
    }
    
    showError(field, message) {
        if (!this.elements.container) return;
        
        this.state.errors[field] = message;
        
        const errorEl = this.elements.container.querySelector(`.error-${field}`);
        if (errorEl) {
            errorEl.textContent = message;
            errorEl.style.display = 'block';
        }
        
        // هایلاین فیلد
        const inputEl = this.elements.container.querySelector(`[name="${field}"]`);
        if (inputEl) {
            inputEl.classList.add('error');
            setTimeout(() => inputEl.classList.remove('error'), 3000);
        }
    }
    
    clearErrors() {
        this.state.errors = {};
        
        if (this.elements.container) {
            const errorEls = this.elements.container.querySelectorAll('.error-message');
            errorEls.forEach(el => {
                el.textContent = '';
                el.style.display = 'none';
            });
            
            const inputEls = this.elements.container.querySelectorAll('input');
            inputEls.forEach(input => input.classList.remove('error'));
        }
    }
    
    setLoading(isLoading) {
        this.state.loading = isLoading;
        
        if (!this.elements.container) return;
        
        const submitBtn = this.elements.container.querySelector('.submit-btn');
        const loadingEl = this.elements.container.querySelector('.loading-indicator');
        
        if (submitBtn) {
            submitBtn.disabled = isLoading;
            submitBtn.innerHTML = isLoading 
                ? '<span class="spinner"></span> در حال پردازش...' 
                : this._getSubmitButtonText();
        }
        
        if (loadingEl) {
            loadingEl.style.display = isLoading ? 'flex' : 'none';
        }
    }
    
    // ==================== CORE LOGIC ====================
    
    async _handleSubmit(event) {
        event.preventDefault();
        
        // اعتبارسنجی فرم
        const isValid = await this._validateForm();
        if (!isValid) {
            return;
        }
        
        this.setLoading(true);
        this.clearErrors();
        
        try {
            // انتشار ایونت submit
            this.services.eventBus.emit(this.EVENTS.FORM_SUBMIT, {
                mode: this.state.mode,
                formData: { ...this.state.formData },
                timestamp: Date.now()
            });
            
            // پردازش بر اساس مد
            let result;
            switch (this.state.mode) {
                case 'login':
                    result = await this.services.authManager.login(
                        this.state.formData.email,
                        this.state.formData.password,
                        { rememberMe: this.state.formData.rememberMe }
                    );
                    break;
                    
                case 'register':
                    result = await this.services.authManager.register({
                        email: this.state.formData.email,
                        username: this.state.formData.username,
                        password: this.state.formData.password,
                        agreeToTerms: this.state.formData.agreeToTerms
                    });
                    break;
                    
                case 'forgot':
                    result = await this.services.authManager.forgotPassword(
                        this.state.formData.email
                    );
                    break;
                    
                case 'reset':
                    // برای reset نیاز به token داریم - می‌تواند از URL گرفته شود
                    const token = new URLSearchParams(window.location.search).get('token');
                    result = await this.services.authManager.resetPassword(
                        token,
                        this.state.formData.password,
                        this.state.formData.confirmPassword
                    );
                    break;
            }
            
            // پردازش نتیجه
            if (result.success) {
                await this._handleSuccess(result);
            } else {
                this._handleFailure(result);
            }
            
        } catch (error) {
            console.error('[AuthView] Submit error:', error);
            this.showError('general', 'خطا در ارتباط با سرور');
            this.setLoading(false);
        }
    }
    
    async _handleSocialLogin(provider) {
        if (!this.config.enableSocialLogin) return;
        
        this.setLoading(true);
        
        try {
            // انتشار ایونت social login
            this.services.eventBus.emit(this.EVENTS.SOCIAL_LOGIN, {
                provider,
                timestamp: Date.now()
            });
            
            const result = await this.services.authManager.socialLogin(provider);
            
            if (result.success) {
                await this._handleSuccess(result);
            } else {
                this.showError('social', `خطا در ورود با ${provider}`);
            }
            
        } catch (error) {
            console.error(`[AuthView] Social login error (${provider}):`, error);
            this.showError('social', 'خطا در ارتباط با سرویس خارجی');
        } finally {
            this.setLoading(false);
        }
    }
    
    // ==================== FORM VALIDATION ====================
    
    async _validateForm() {
        const errors = {};
        
        // اعتبارسنجی ایمیل
        if (!this.state.formData.email) {
            errors.email = 'ایمیل الزامی است';
        } else if (!this._isValidEmail(this.state.formData.email)) {
            errors.email = 'ایمیل معتبر نیست';
        }
        
        // اعتبارسنجی بر اساس مد
        switch (this.state.mode) {
            case 'login':
            case 'register':
                if (!this.state.formData.password) {
                    errors.password = 'رمز عبور الزامی است';
                } else if (this.state.formData.password.length < this.config.passwordMinLength) {
                    errors.password = `رمز عبور باید حداقل ${this.config.passwordMinLength} کاراکتر باشد`;
                }
                break;
                
            case 'register':
                if (!this.state.formData.username) {
                    errors.username = 'نام کاربری الزامی است';
                } else if (this.state.formData.username.length < 3) {
                    errors.username = 'نام کاربری باید حداقل ۳ کاراکتر باشد';
                }
                
                if (this.state.formData.password !== this.state.formData.confirmPassword) {
                    errors.confirmPassword = 'رمز عبور و تکرار آن مطابقت ندارند';
                }
                
                if (this.config.enableTermsCheckbox && !this.state.formData.agreeToTerms) {
                    errors.agreeToTerms = 'لطفاً شرایط استفاده را بپذیرید';
                }
                break;
                
            case 'reset':
                if (this.state.formData.password !== this.state.formData.confirmPassword) {
                    errors.confirmPassword = 'رمز عبور و تکرار آن مطابقت ندارند';
                }
                break;
        }
        
        // نمایش خطاها
        Object.entries(errors).forEach(([field, message]) => {
            this.showError(field, message);
        });
        
        // انتشار ایونت اعتبارسنجی
        this.services.eventBus.emit(this.EVENTS.FORM_VALIDATION, {
            mode: this.state.mode,
            isValid: Object.keys(errors).length === 0,
            errors,
            timestamp: Date.now()
        });
        
        return Object.keys(errors).length === 0;
    }
    
    _validateEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        const isValid = emailRegex.test(email);
        
        this.state.validation.email = {
            isValid,
            message: isValid ? '' : 'ایمیل معتبر نیست'
        };
        
        return isValid;
    }
    
    _validatePassword(password) {
        let strength = 0;
        let message = '';
        
        if (password.length >= this.config.passwordMinLength) strength++;
        if (/[A-Z]/.test(password)) strength++;
        if (/[0-9]/.test(password)) strength++;
        if (/[^A-Za-z0-9]/.test(password)) strength++;
        
        // محاسبه درصد قدرت
        this.state.passwordStrength = (strength / 4) * 100;
        
        // انتشار ایونت قدرت رمز عبور
        this.services.eventBus.emit(this.EVENTS.PASSWORD_STRENGTH, {
            strength: this.state.passwordStrength,
            length: password.length,
            timestamp: Date.now()
        });
        
        return strength >= 2;
    }
    
    // ==================== EVENT HANDLERS ====================
    
    _handleInputChange(event) {
        const { name, value, type, checked } = event.target;
        
        this.state.formData[name] = type === 'checkbox' ? checked : value;
        
        // اعتبارسنجی بلادرنگ
        if (name === 'email') {
            this._validateEmail(value);
        }
        
        if (name === 'password') {
            this._validatePassword(value);
        }
        
        // پاک کردن خطای فیلد
        if (this.state.errors[name]) {
            delete this.state.errors[name];
            this.clearErrors();
        }
    }
    
    async _handleSuccess(result) {
        // انتشار ایونت موفقیت
        this.services.eventBus.emit('auth:success', {
            mode: this.state.mode,
            user: result.user,
            timestamp: Date.now()
        });
        
        // نمایش پیام موفقیت
        await this._showSuccessMessage();
        
        // ریدایرکت
        setTimeout(() => {
            if (this.state.mode === 'login' || this.state.mode === 'register') {
                this.services.router.navigate('/dashboard');
            } else {
                this.setMode('login');
            }
        }, 2000);
    }
    
    _handleFailure(result) {
        // نمایش خطاهای سرور
        if (result.errors) {
            Object.entries(result.errors).forEach(([field, message]) => {
                this.showError(field, message);
            });
        } else if (result.message) {
            this.showError('general', result.message);
        }
        
        this.setLoading(false);
    }
    
    // ==================== UI GENERATION ====================
    
    _generateHTML() {
        const { mode } = this.state;
        
        return `
            <div class="auth-view" style="opacity: 0; transform: translateY(20px); transition: all 0.3s ease;">
                <!-- هدر -->
                <div class="auth-header">
                    <h1>${this._getTitle()}</h1>
                    <p class="auth-subtitle">${this._getSubtitle()}</p>
                </div>
                
                <!-- فرم اصلی -->
                <form class="auth-form" id="authForm" novalidate>
                    ${this._generateFormFields()}
                    
                    <!-- دکمه ارسال -->
                    <button type="submit" class="submit-btn" ${this.state.loading ? 'disabled' : ''}>
                        ${this._getSubmitButtonText()}
                    </button>
                </form>
                
                <!-- گزینه‌های اضافی -->
                ${this._generateAdditionalOptions()}
                
                <!-- دکمه‌های تغییر مد -->
                <div class="auth-mode-switcher">
                    ${this._generateModeSwitcher()}
                </div>
                
                <!-- نمایشگر قدرت رمز عبور -->
                ${mode === 'register' || mode === 'reset' ? this._generatePasswordStrength() : ''}
                
                <!-- نمایشگر loading -->
                <div class="loading-indicator" style="display: none;">
                    <div class="spinner"></div>
                    <p>در حال پردازش...</p>
                </div>
                
                <!-- نمایش خطاهای عمومی -->
                ${this.state.errors.general ? `
                    <div class="error-general">
                        ⚠️ ${this.state.errors.general}
                    </div>
                ` : ''}
            </div>
            
            <!-- استایل‌های داخلی -->
            <style>
                ${this._generateStyles()}
            </style>
        `;
    }
    
    _generateFormFields() {
        const { mode, formData } = this.state;
        
        let fields = '';
        
        // فیلد ایمیل (در همه مدها)
        fields += `
            <div class="form-group">
                <label for="email">آدرس ایمیل</label>
                <input 
                    type="email" 
                    id="email" 
                    name="email" 
                    value="${formData.email}"
                    placeholder="example@domain.com"
                    required
                    autocomplete="email"
                    ${this.config.autoFocus && mode === 'login' ? 'autofocus' : ''}
                />
                <div class="error-message error-email" style="display: none;"></div>
            </div>
        `;
        
        // فیلد نام کاربری (فقط ثبت‌نام)
        if (mode === 'register') {
            fields += `
                <div class="form-group">
                    <label for="username">نام کاربری</label>
                    <input 
                        type="text" 
                        id="username" 
                        name="username" 
                        value="${formData.username}"
                        placeholder="نام دلخواه خود را وارد کنید"
                        required
                        autocomplete="username"
                        ${this.config.autoFocus ? 'autofocus' : ''}
                    />
                    <div class="error-message error-username" style="display: none;"></div>
                </div>
            `;
        }
        
        // فیلد رمز عبور (در login, register, reset)
        if (['login', 'register', 'reset'].includes(mode)) {
            fields += `
                <div class="form-group">
                    <label for="password">رمز عبور</label>
                    <input 
                        type="password" 
                        id="password" 
                        name="password" 
                        value="${formData.password}"
                        placeholder="حداقل ${this.config.passwordMinLength} کاراکتر"
                        required
                        autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}"
                        minlength="${this.config.passwordMinLength}"
                    />
                    <div class="error-message error-password" style="display: none;"></div>
                </div>
            `;
        }
        
        // فیلد تکرار رمز عبور (در register, reset)
        if (mode === 'register' || mode === 'reset') {
            fields += `
                <div class="form-group">
                    <label for="confirmPassword">تکرار رمز عبور</label>
                    <input 
                        type="password" 
                        id="confirmPassword" 
                        name="confirmPassword" 
                        value="${formData.confirmPassword}"
                        placeholder="رمز عبور را مجدداً وارد کنید"
                        required
                        autocomplete="new-password"
                    />
                    <div class="error-message error-confirmPassword" style="display: none;"></div>
                </div>
            `;
        }
        
        // چک‌باکس‌ها
        if (mode === 'login' && this.config.enableRememberMe) {
            fields += `
                <div class="form-checkbox">
                    <input 
                        type="checkbox" 
                        id="rememberMe" 
                        name="rememberMe"
                        ${formData.rememberMe ? 'checked' : ''}
                    />
                    <label for="rememberMe">مرا به خاطر بسپار</label>
                </div>
            `;
        }
        
        if (mode === 'register' && this.config.enableTermsCheckbox) {
            fields += `
                <div class="form-checkbox">
                    <input 
                        type="checkbox" 
                        id="agreeToTerms" 
                        name="agreeToTerms"
                        ${formData.agreeToTerms ? 'checked' : ''}
                        required
                    />
                    <label for="agreeToTerms">
                        <a href="/terms" target="_blank">شرایط استفاده</a> را می‌پذیرم
                    </label>
                    <div class="error-message error-agreeToTerms" style="display: none;"></div>
                </div>
            `;
        }
        
        return fields;
    }
    
    _generateAdditionalOptions() {
        if (!this.config.enableSocialLogin && this.state.mode !== 'login') {
            return '';
        }
        
        let options = '';
        
        // لینک فراموشی رمز عبور
        if (this.state.mode === 'login') {
            options += `
                <div class="auth-option">
                    <a href="#" class="forgot-password-link" data-mode="forgot">
                        رمز عبور خود را فراموش کرده‌اید؟
                    </a>
                </div>
            `;
        }
        
        // دکمه‌های social login
        if (this.config.enableSocialLogin && this.state.mode === 'login') {
            options += `
                <div class="social-login">
                    <p class="social-divider">یا وارد شوید با</p>
                    <div class="social-buttons">
                        ${this.state.socialProviders.map(provider => `
                            <button 
                                type="button" 
                                class="social-btn ${provider}"
                                data-provider="${provider}"
                                title="ورود با ${provider}"
                            >
                                <span class="social-icon">${this._getSocialIcon(provider)}</span>
                                ${provider}
                            </button>
                        `).join('')}
                    </div>
                </div>
            `;
        }
        
        return options;
    }
    
    _generateModeSwitcher() {
        const { mode } = this.state;
        
        switch (mode) {
            case 'login':
                return `
                    <p class="mode-switch-text">
                        حساب کاربری ندارید؟
                        <a href="#" class="mode-switch-link" data-mode="register">
                            ثبت‌نام کنید
                        </a>
                    </p>
                `;
                
            case 'register':
                return `
                    <p class="mode-switch-text">
                        قبلاً ثبت‌نام کرده‌اید؟
                        <a href="#" class="mode-switch-link" data-mode="login">
                            وارد شوید
                        </a>
                    </p>
                `;
                
            case 'forgot':
                return `
                    <p class="mode-switch-text">
                        به یاد آوردید؟
                        <a href="#" class="mode-switch-link" data-mode="login">
                            وارد شوید
                        </a>
                    </p>
                `;
                
            case 'reset':
                return `
                    <p class="mode-switch-text">
                        <a href="#" class="mode-switch-link" data-mode="login">
                            بازگشت به صفحه ورود
                        </a>
                    </p>
                `;
                
            default:
                return '';
        }
    }
    
    _generatePasswordStrength() {
        const strength = this.state.passwordStrength;
        let color = '#ff5252';
        let text = 'ضعیف';
        
        if (strength > 50) {
            color = '#ffb74d';
            text = 'متوسط';
        }
        if (strength > 75) {
            color = '#4CAF50';
            text = 'قوی';
        }
        
        return `
            <div class="password-strength">
                <div class="strength-bar">
                    <div class="strength-fill" style="width: ${strength}%; background: ${color};"></div>
                </div>
                <div class="strength-text">
                    قدرت رمز عبور: <span style="color: ${color}">${text}</span>
                </div>
            </div>
        `;
    }
    
    _generateStyles() {
        return `
            .auth-view {
                max-width: 400px;
                margin: 0 auto;
                padding: 30px;
                background: rgba(255, 255, 255, 0.05);
                border-radius: 15px;
                border: 1px solid rgba(255, 255, 255, 0.1);
                backdrop-filter: blur(10px);
            }
            
            .auth-header {
                text-align: center;
                margin-bottom: 30px;
            }
            
            .auth-header h1 {
                color: #64ffda;
                margin-bottom: 10px;
                font-size: 1.8rem;
            }
            
            .auth-subtitle {
                color: #8892b0;
                font-size: 0.95rem;
            }
            
            .form-group {
                margin-bottom: 20px;
            }
            
            .form-group label {
                display: block;
                margin-bottom: 8px;
                color: #ccd6f6;
                font-weight: 500;
            }
            
            .form-group input {
                width: 100%;
                padding: 12px 15px;
                background: rgba(255, 255, 255, 0.07);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 8px;
                color: #e6e6e6;
                font-size: 1rem;
                transition: all 0.3s;
            }
            
            .form-group input:focus {
                outline: none;
                border-color: #64ffda;
                box-shadow: 0 0 0 2px rgba(100, 255, 218, 0.2);
            }
            
            .form-group input.error {
                border-color: #ff5252;
            }
            
            .error-message {
                color: #ff5252;
                font-size: 0.85rem;
                margin-top: 5px;
                display: none;
            }
            
            .error-general {
                background: rgba(255, 82, 82, 0.1);
                border: 1px solid rgba(255, 82, 82, 0.3);
                color: #ff5252;
                padding: 12px;
                border-radius: 8px;
                margin-top: 20px;
                text-align: center;
            }
            
            .form-checkbox {
                display: flex;
                align-items: center;
                gap: 10px;
                margin: 15px 0;
            }
            
            .form-checkbox input {
                width: auto;
            }
            
            .form-checkbox label {
                margin: 0;
                font-size: 0.9rem;
                color: #8892b0;
            }
            
            .form-checkbox a {
                color: #64ffda;
                text-decoration: none;
            }
            
            .form-checkbox a:hover {
                text-decoration: underline;
            }
            
            .submit-btn {
                width: 100%;
                padding: 14px;
                background: linear-gradient(135deg, #0d7377 0%, #14ffec 100%);
                color: #000;
                border: none;
                border-radius: 8px;
                font-size: 1.1rem;
                font-weight: bold;
                cursor: pointer;
                transition: all 0.3s;
                margin-top: 10px;
            }
            
            .submit-btn:hover:not(:disabled) {
                transform: translateY(-2px);
                box-shadow: 0 5px 15px rgba(13, 115, 119, 0.4);
            }
            
            .submit-btn:disabled {
                opacity: 0.7;
                cursor: not-allowed;
            }
            
            .auth-option {
                text-align: center;
                margin: 20px 0;
            }
            
            .forgot-password-link {
                color: #64ffda;
                text-decoration: none;
                font-size: 0.9rem;
            }
            
            .forgot-password-link:hover {
                text-decoration: underline;
            }
            
            .social-login {
                margin: 25px 0;
            }
            
            .social-divider {
                text-align: center;
                color: #8892b0;
                font-size: 0.9rem;
                position: relative;
                margin: 20px 0;
            }
            
            .social-divider:before,
            .social-divider:after {
                content: '';
                position: absolute;
                top: 50%;
                width: 45%;
                height: 1px;
                background: rgba(255, 255, 255, 0.1);
            }
            
            .social-divider:before {
                left: 0;
            }
            
            .social-divider:after {
                right: 0;
            }
            
            .social-buttons {
                display: flex;
                gap: 10px;
                justify-content: center;
            }
            
            .social-btn {
                padding: 10px 15px;
                background: rgba(255, 255, 255, 0.07);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 8px;
                color: #e6e6e6;
                cursor: pointer;
                transition: all 0.3s;
                display: flex;
                align-items: center;
                gap: 8px;
                font-size: 0.9rem;
            }
            
            .social-btn:hover {
                background: rgba(255, 255, 255, 0.12);
                transform: translateY(-1px);
            }
            
            .social-icon {
                font-size: 1.2rem;
            }
            
            .auth-mode-switcher {
                text-align: center;
                margin-top: 25px;
                padding-top: 20px;
                border-top: 1px solid rgba(255, 255, 255, 0.1);
            }
            
            .mode-switch-text {
                color: #8892b0;
                font-size: 0.95rem;
            }
            
            .mode-switch-link {
                color: #64ffda;
                text-decoration: none;
                font-weight: 500;
            }
            
            .mode-switch-link:hover {
                text-decoration: underline;
            }
            
            .password-strength {
                margin-top: 15px;
            }
            
            .strength-bar {
                height: 6px;
                background: rgba(255, 255, 255, 0.1);
                border-radius: 3px;
                overflow: hidden;
                margin-bottom: 8px;
            }
            
            .strength-fill {
                height: 100%;
                transition: width 0.3s;
            }
            
            .strength-text {
                font-size: 0.85rem;
                color: #8892b0;
            }
            
            .loading-indicator {
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 10px;
                margin-top: 20px;
            }
            
            .spinner {
                width: 30px;
                height: 30px;
                border: 3px solid rgba(100, 255, 218, 0.3);
                border-top-color: #64ffda;
                border-radius: 50%;
                animation: spin 1s linear infinite;
            }
            
            @keyframes spin {
                to { transform: rotate(360deg); }
            }
            
            @media (max-width: 480px) {
                .auth-view {
                    padding: 20px;
                    margin: 0 15px;
                }
                
                .social-buttons {
                    flex-direction: column;
                }
            }
        `;
    }
    
    // ==================== UTILITY METHODS ====================
    
    _validateServices() {
        const required = ['eventBus', 'authManager', 'stateManager'];
        required.forEach(service => {
            if (!this.services[service]) {
                throw new Error(`Required service "${service}" not provided`);
            }
        });
    }
    
    _init() {
        // گوش دادن به ایونت‌های auth
        this.services.eventBus.on('auth:login:required', () => {
            this.setMode('login');
            this.render();
        });
        
        this.services.eventBus.on('auth:registration:required', () => {
            this.setMode('register');
            this.render();
        });
        
        // گوش دادن به تغییرات state
        this.services.stateManager.subscribe('auth.status', (status) => {
            if (status === 'logged_in') {
                this._handleLoggedIn();
            }
        });
    }
    
    _cacheElements() {
        if (!this.elements.container) return;
        
        this.elements.form = this.elements.container.querySelector('#authForm');
        this.elements.inputs = this.elements.container.querySelectorAll('input');
        this.elements.submitBtn = this.elements.container.querySelector('.submit-btn');
        this.elements.modeLinks = this.elements.container.querySelectorAll('.mode-switch-link');
        this.elements.socialBtns = this.elements.container.querySelectorAll('.social-btn');
        this.elements.forgotLink = this.elements.container.querySelector('.forgot-password-link');
    }
    
    _setupEventListeners() {
        if (!this.elements.form) return;
        
        // Submit form
        this.elements.form.addEventListener('submit', this._handleSubmit);
        
        // Input changes
        this.elements.inputs.forEach(input => {
            input.addEventListener('input', this._handleInputChange.bind(this));
        });
        
        // Mode switching
        this.elements.modeLinks.forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const mode = e.target.dataset.mode;
                this.setMode(mode);
            });
        });
        
        // Social login buttons
        this.elements.socialBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const provider = btn.dataset.provider;
                this._handleSocialLogin(provider);
            });
        });
        
        // Forgot password link
        if (this.elements.forgotLink) {
            this.elements.forgotLink.addEventListener('click', (e) => {
                e.preventDefault();
                this.setMode('forgot');
            });
        }
    }
    
    _getTitle() {
        const titles = {
            login: 'ورود به حساب کاربری',
            register: 'ایجاد حساب جدید',
            forgot: 'بازیابی رمز عبور',
            reset: 'تنظیم رمز عبور جدید'
        };
        return titles[this.state.mode] || titles.login;
    }
    
    _getSubtitle() {
        const subtitles = {
            login: 'لطفاً اطلاعات حساب خود را وارد کنید',
            register: 'برای شروع یادگیری زبان، حساب خود را ایجاد کنید',
            forgot: 'ایمیل خود را وارد کنید تا لینک بازیابی برای شما ارسال شود',
            reset: 'رمز عبور جدید خود را انتخاب کنید'
        };
        return subtitles[this.state.mode] || '';
    }
    
    _getSubmitButtonText() {
        const texts = {
            login: 'ورود به سیستم',
            register: 'ایجاد حساب',
            forgot: 'ارسال لینک بازیابی',
            reset: 'تنظیم رمز عبور'
        };
        return texts[this.state.mode] || 'ثبت';
    }
    
    _getSocialIcon(provider) {
        const icons = {
            google: 'G',
            github: 'G',
            microsoft: 'M'
        };
        return icons[provider] || provider.charAt(0).toUpperCase();
    }
    
    _isValidEmail(email) {
        const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return re.test(email);
    }
    
    _resetForm() {
        this.state.formData = {
            email: '',
            username: '',
            password: '',
            confirmPassword: '',
            rememberMe: false,
            agreeToTerms: false
        };
        
        this.state.validation = {
            email: { isValid: false, message: '' },
            password: { isValid: false, message: '' },
            username: { isValid: false, message: '' }
        };
        
        this.state.passwordStrength = 0;
        this.clearErrors();
    }
    
    async _showSuccessMessage() {
        if (!this.elements.container) return;
        
        const messages = {
            login: 'ورود موفقیت‌آمیز بود! در حال انتقال...',
            register: 'ثبت‌نام موفقیت‌آمیز بود! به صفحه اصلی منتقل می‌شوید.',
            forgot: 'ایمیل بازیابی ارسال شد. لطفاً صندوق ورودی خود را بررسی کنید.',
            reset: 'رمز عبور با موفقیت تغییر کرد. اکنون می‌توانید وارد شوید.'
        };
        
        const message = messages[this.state.mode];
        if (message) {
            const successEl = document.createElement('div');
            successEl.className = 'success-message';
            successEl.innerHTML = `
                <div style="
                    background: rgba(76, 175, 80, 0.1);
                    border: 1px solid rgba(76, 175, 80, 0.3);
                    color: #4CAF50;
                    padding: 15px;
                    border-radius: 8px;
                    text-align: center;
                    margin-top: 20px;
                ">
                    ✅ ${message}
                </div>
            `;
            
            this.elements.container.appendChild(successEl);
            
            // حذف خودکار پس از 3 ثانیه
            setTimeout(() => {
                if (successEl.parentNode) {
                    successEl.remove();
                }
            }, 3000);
        }
    }
    
    _handleLoggedIn() {
        // پاک کردن فرم
        this._resetForm();
        
        // مخفی کردن view
        if (this.elements.container) {
            this.elements.container.style.opacity = 0;
            this.elements.container.style.transform = 'translateY(-20px)';
            
            setTimeout(() => {
                if (this.elements.container) {
                    this.elements.container.style.display = 'none';
                }
            }, 300);
        }
    }
    
    // ==================== PUBLIC UTILITIES ====================
    
    show() {
        if (this.elements.container) {
            this.elements.container.style.display = 'block';
            
            setTimeout(() => {
                this.elements.container.style.opacity = 1;
                this.elements.container.style.transform = 'translateY(0)';
            }, 50);
        }
    }
    
    hide() {
        if (this.elements.container) {
            this.elements.container.style.opacity = 0;
            this.elements.container.style.transform = 'translateY(-20px)';
            
            setTimeout(() => {
                if (this.elements.container) {
                    this.elements.container.style.display = 'none';
                }
            }, 300);
        }
    }
    
    toggle() {
        if (this.elements.container) {
            const isVisible = this.elements.container.style.opacity !== '0' && 
                            this.elements.container.style.display !== 'none';
            
            if (isVisible) {
                this.hide();
            } else {
                this.show();
            }
        }
    }
    
    destroy() {
        // پاک کردن event listeners
        if (this.elements.form) {
            this.elements.form.removeEventListener('submit', this._handleSubmit);
        }
        
        if (this.elements.inputs) {
            this.elements.inputs.forEach(input => {
                input.removeEventListener('input', this._handleInputChange);
            });
        }
        
        // پاک کردن container
        if (this.elements.container) {
            this.elements.container.innerHTML = '';
        }
        
        console.log('[AuthView] 🧹 از بین رفت');
    }
}

// Export برای استفاده
export { AuthView };
