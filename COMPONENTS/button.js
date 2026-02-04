/**
 * VAKAMOVA BUTTON COMPONENT - کامپوننت دکمه هوشمند (نسخه اصلاح‌شده)
 * اصول: تزریق وابستگی، قرارداد رابط، رویدادمحور، پیکربندی متمرکز
 * وابستگی: فقط event_bus.js (از طریق تزریق اجباری)
 */

class VakamovaButton {
    constructor(config = {}) {
        // ==================== اعتبارسنجی وابستگی‌های حیاتی ====================
        if (!config.eventBus && !window.eventBus) {
            throw new Error('[VakamovaButton] EventBus dependency is required. Provide via config.eventBus');
        }
        
        if (!config.containerId && !config.containerElement) {
            console.warn('[VakamovaButton] No container specified. Use render(container) later.');
        }

        // ==================== پیکربندی متمرکز ====================
        this._config = Object.freeze({
            types: {
                primary: { base: 'v-btn-primary', color: '#0d7377', text: '#fff' },
                secondary: { base: 'v-btn-secondary', color: '#323a4d', text: '#fff' },
                success: { base: 'v-btn-success', color: '#4CAF50', text: '#fff' },
                warning: { base: 'v-btn-warning', color: '#FF9800', text: '#000' },
                danger: { base: 'v-btn-danger', color: '#f44336', text: '#fff' },
                ghost: { base: 'v-btn-ghost', color: 'transparent', text: '#0d7377' }
            },
            sizes: {
                sm: { class: 'v-btn-sm', padding: '8px 16px', fontSize: '12px' },
                md: { class: 'v-btn-md', padding: '12px 24px', fontSize: '14px' },
                lg: { class: 'v-btn-lg', padding: '16px 32px', fontSize: '16px' },
                xl: { class: 'v-btn-xl', padding: '20px 40px', fontSize: '18px' }
            },
            animations: {
                none: 'v-btn-no-animation',
                pulse: 'v-btn-pulse',
                bounce: 'v-btn-bounce',
                shimmer: 'v-btn-shimmer'
            },
            ...config
        });

        // ==================== تزریق وابستگی (ایمن) ====================
        this._eventBus = config.eventBus || window.eventBus;
        
        // ==================== وضعیت داخلی ====================
        this._state = Object.seal({
            disabled: false,
            loading: false,
            pressed: false,
            hover: false,
            focus: false,
            rendered: false,
            destroyed: false
        });

        this._elements = {
            container: config.containerElement || null,
            button: null,
            icon: null,
            label: null,
            loader: null
        };

        this._listeners = new Map();
        this._buttonId = `btn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        this._initialContainerId = config.containerId;

        // ==================== bind ایمن ====================
        this._safeBindMethods();
    }

    // ==================== مدیریت متدها (ایمن) ====================
    _safeBindMethods() {
        const methods = [
            'render', 'update', 'destroy', 'enable', 'disable', 
            'setLoading', '_handleInteraction', '_cleanupResources'
        ];
        
        methods.forEach(method => {
            if (this[method]) {
                this[method] = this[method].bind(this);
            }
        });
        
        // محافظت در برابر override
        Object.keys(this).forEach(key => {
            if (typeof this[key] === 'function') {
                Object.defineProperty(this, key, {
                    value: this[key].bind(this),
                    writable: false,
                    configurable: false
                });
            }
        });
    }

    // ==================== قرارداد رابط - API عمومی ====================
    render(container = null, options = {}) {
        if (this._state.destroyed) {
            throw new Error('[VakamovaButton] Cannot render a destroyed button');
        }
        
        if (this._state.rendered) {
            console.warn('[VakamovaButton] Button already rendered, updating instead');
            return this.update(options);
        }

        try {
            // 1. تعیین container
            const targetContainer = this._resolveContainer(container);
            if (!targetContainer) {
                throw new Error('[VakamovaButton] Valid container element is required');
            }

            // 2. نرمالایز options
            this._options = this._normalizeOptions(options);
            
            // 3. ایجاد template
            const template = this._createTemplate();
            
            // 4. رندر ایمن
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = template.trim();
            const buttonElement = tempDiv.firstChild;
            
            targetContainer.appendChild(buttonElement);
            
            // 5. ذخیره عناصر
            this._elements.container = targetContainer;
            this._elements.button = buttonElement;
            this._elements.icon = buttonElement.querySelector('.v-btn-icon');
            this._elements.label = buttonElement.querySelector('.v-btn-label');
            this._elements.loader = buttonElement.querySelector('.v-btn-loader');
            
            // 6. اعمال استایل‌ها
            this._applyStyles();
            
            // 7. اتصال رویدادها
            this._attachEventListeners();
            
            this._state.rendered = true;
            
            // 8. انتشار رویداد
            this._eventBus.emit('ui:button:rendered', {
                id: this._buttonId,
                options: this._options,
                containerId: targetContainer.id || 'anonymous'
            });

            return this;
            
        } catch (error) {
            this._eventBus.emit('ui:button:error', {
                id: this._buttonId,
                error: error.message,
                phase: 'render'
            });
            throw error;
        }
    }

    update(options = {}) {
        if (!this._state.rendered || this._state.destroyed) {
            console.warn('[VakamovaButton] Cannot update - button not rendered or destroyed');
            return this;
        }

        try {
            const previousOptions = { ...this._options };
            this._options = this._normalizeOptions({ ...this._options, ...options });
            
            this._updateAppearance();
            
            this._eventBus.emit('ui:button:updated', {
                id: this._buttonId,
                previous: previousOptions,
                current: this._options
            });

            return this;
            
        } catch (error) {
            this._eventBus.emit('ui:button:error', {
                id: this._buttonId,
                error: error.message,
                phase: 'update'
            });
            return this;
        }
    }

    destroy() {
        if (this._state.destroyed) return null;
        
        try {
            // 1. حذف رویدادها
            this._detachEventListeners();
            
            // 2. انتشار رویداد تخریب
            this._eventBus.emit('ui:button:destroying', {
                id: this._buttonId,
                options: this._options
            });
            
            // 3. پاک‌سازی DOM (ایمن)
            if (this._elements.button && this._elements.button.parentNode) {
                this._elements.button.parentNode.removeChild(this._elements.button);
            }
            
            // 4. پاک‌سازی منابع
            this._cleanupResources();
            
            this._state.destroyed = true;
            
            this._eventBus.emit('ui:button:destroyed', {
                id: this._buttonId
            });
            
            return null;
            
        } catch (error) {
            console.error('[VakamovaButton] Error during destroy:', error);
            return this;
        }
    }

    enable() {
        return this._setDisabled(false);
    }

    disable() {
        return this._setDisabled(true);
    }

    setLoading(isLoading) {
        if (this._state.destroyed) return this;
        
        this._state.loading = Boolean(isLoading);
        
        if (this._elements.button) {
            this._elements.button.classList.toggle('v-btn-loading', this._state.loading);
            this._elements.button.setAttribute('aria-busy', this._state.loading);
            
            if (this._elements.loader) {
                this._elements.loader.style.display = this._state.loading ? 'block' : 'none';
            }
        }
        
        this._eventBus.emit('ui:button:loading', {
            id: this._buttonId,
            loading: this._state.loading
        });
        
        return this;
    }

    // ==================== متدهای کمکی (ایمن) ====================
    _resolveContainer(container) {
        if (container instanceof Element) return container;
        if (typeof container === 'string') return document.getElementById(container);
        if (this._elements.container) return this._elements.container;
        if (this._initialContainerId) return document.getElementById(this._initialContainerId);
        
        return null;
    }

    _normalizeOptions(options) {
        const defaults = {
            type: 'primary',
            size: 'md',
            text: 'دکمه',
            icon: null,
            iconPosition: 'left',
            disabled: false,
            loading: false,
            fullWidth: false,
            animation: 'none',
            href: null,
            target: '_self',
            ariaLabel: null,
            title: null,
            customClass: '',
            styles: {},
            onClick: null,
            onHover: null,
            onFocus: null,
            dataAttributes: {}
        };
        
        const normalized = { ...defaults, ...options };
        
        // اعتبارسنجی نوع
        if (!this._config.types[normalized.type]) {
            console.warn(`[VakamovaButton] Invalid type "${normalized.type}", using "primary"`);
            normalized.type = 'primary';
        }
        
        // اعتبارسنجی سایز
        if (!this._config.sizes[normalized.size]) {
            normalized.size = 'md';
        }
        
        // اعتبارسنجی آیکون پوزیشن
        if (!['left', 'right'].includes(normalized.iconPosition)) {
            normalized.iconPosition = 'left';
        }
        
        return Object.freeze(normalized);
    }

    _createTemplate() {
        const { 
            text, icon, iconPosition, href, type, size, 
            animation, fullWidth, ariaLabel, title, customClass, dataAttributes 
        } = this._options;
        
        const typeConfig = this._config.types[type];
        const sizeConfig = this._config.sizes[size];
        const animationClass = this._config.animations[animation] || '';
        
        const classes = [
            'vakamova-button',
            typeConfig.base,
            sizeConfig.class,
            animationClass,
            fullWidth ? 'v-btn-fullwidth' : '',
            this._state.disabled ? 'v-btn-disabled' : '',
            this._state.loading ? 'v-btn-loading' : '',
            customClass
        ].filter(Boolean).join(' ');
        
        const iconHtml = icon ? 
            `<span class="v-btn-icon" aria-hidden="true">${icon}</span>` : '';
        
        const labelHtml = text ? 
            `<span class="v-btn-label" data-text="${text}">${text}</span>` : '';
        
        const loaderHtml = `
            <span class="v-btn-loader" aria-hidden="true" style="display: none;">
                <span class="v-btn-loader-dot"></span>
                <span class="v-btn-loader-dot"></span>
                <span class="v-btn-loader-dot"></span>
            </span>
        `;
        
        const contentHtml = iconPosition === 'left' ? 
            `${iconHtml}${labelHtml}` : `${labelHtml}${iconHtml}`;
        
        const dataAttrs = Object.entries(dataAttributes)
            .map(([key, value]) => `data-${key}="${value}"`)
            .join(' ');
        
        const ariaAttrs = ariaLabel ? `aria-label="${ariaLabel}"` : '';
        const titleAttr = title ? `title="${title}"` : '';
        const disabledAttr = this._state.disabled ? 'disabled aria-disabled="true"' : '';
        
        if (href && !this._state.disabled) {
            return `
                <a id="${this._buttonId}" 
                   href="${href}" 
                   target="${this._options.target}"
                   class="${classes}"
                   role="button"
                   ${ariaAttrs}
                   ${titleAttr}
                   ${dataAttrs}
                   ${disabledAttr}>
                   ${contentHtml}
                   ${loaderHtml}
                </a>
            `;
        }
        
        return `
            <button id="${this._buttonId}" 
                    type="button"
                    class="${classes}"
                    ${ariaAttrs}
                    ${titleAttr}
                    ${dataAttrs}
                    ${disabledAttr}>
                ${contentHtml}
                ${loaderHtml}
            </button>
        `;
    }

    _applyStyles() {
        if (!this._elements.button || this._state.destroyed) return;
        
        const { type, size, styles } = this._options;
        const typeConfig = this._config.types[type];
        const sizeConfig = this._config.sizes[size];
        
        const baseStyles = {
            backgroundColor: typeConfig.color,
            color: typeConfig.text,
            padding: sizeConfig.padding,
            fontSize: sizeConfig.fontSize,
            border: 'none',
            borderRadius: '8px',
            cursor: this._state.disabled ? 'not-allowed' : 'pointer',
            transition: 'all 0.3s ease',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            fontFamily: 'inherit',
            fontWeight: '500',
            lineHeight: '1.5',
            textDecoration: 'none',
            position: 'relative',
            overflow: 'hidden',
            opacity: this._state.disabled ? '0.6' : '1',
            outline: 'none',
            ...styles
        };
        
        Object.assign(this._elements.button.style, baseStyles);
        
        // حذف listenerهای قبلی برای جلوگیری از memory leak
        this._elements.button.removeEventListener('mouseenter', this._hoverHandler);
        this._elements.button.removeEventListener('mouseleave', this._hoverHandler);
        
        // تعریف handlerهای جدید
        this._hoverHandler = (e) => {
            if (this._state.disabled || this._state.loading || this._state.destroyed) return;
            
            const isEnter = e.type === 'mouseenter';
            this._elements.button.style.transform = isEnter ? 'translateY(-2px)' : 'translateY(0)';
            this._elements.button.style.boxShadow = isEnter 
                ? '0 6px 12px rgba(0, 0, 0, 0.15)' 
                : 'none';
        };
        
        // اتصال listenerهای جدید
        this._elements.button.addEventListener('mouseenter', this._hoverHandler);
        this._elements.button.addEventListener('mouseleave', this._hoverHandler);
        
        // RTL support
        if (document.documentElement.dir === 'rtl') {
            this._elements.button.style.flexDirection = 'row-reverse';
        }
    }

    _attachEventListeners() {
        if (!this._elements.button || this._state.destroyed) return;
        
        const clickHandler = (event) => {
            if (this._state.disabled || this._state.loading || this._state.destroyed) {
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            
            this._eventBus.emit('ui:button:clicked', {
                id: this._buttonId,
                options: this._options,
                event: {
                    type: event.type,
                    timestamp: Date.now(),
                    target: event.target.tagName
                }
            });
            
            if (typeof this._options.onClick === 'function') {
                try {
                    this._options.onClick(event, this);
                } catch (error) {
                    console.error('[VakamovaButton] onClick handler error:', error);
                }
            }
        };
        
        const hoverHandler = (event) => {
            if (this._state.destroyed) return;
            
            this._state.hover = event.type === 'mouseenter';
            
            this._eventBus.emit(`ui:button:${event.type}`, {
                id: this._buttonId,
                hover: this._state.hover
            });
            
            if (typeof this._options.onHover === 'function') {
                this._options.onHover(this._state.hover, event, this);
            }
        };
        
        const focusHandler = (event) => {
            if (this._state.destroyed) return;
            
            this._state.focus = event.type === 'focus';
            
            this._eventBus.emit(`ui:button:${event.type}`, {
                id: this._buttonId,
                focused: this._state.focus
            });
            
            if (typeof this._options.onFocus === 'function') {
                this._options.onFocus(this._state.focus, event, this);
            }
        };
        
        // ذخیره هندلرها برای cleanup بعدی
        this._listeners.set('click', clickHandler);
        this._listeners.set('mouseenter', hoverHandler);
        this._listeners.set('mouseleave', hoverHandler);
        this._listeners.set('focus', focusHandler);
        this._listeners.set('blur', focusHandler);
        
        // اتصال رویدادها
        this._elements.button.addEventListener('click', clickHandler);
        this._elements.button.addEventListener('mouseenter', hoverHandler);
        this._elements.button.addEventListener('mouseleave', hoverHandler);
        this._elements.button.addEventListener('focus', focusHandler);
        this._elements.button.addEventListener('blur', focusHandler);
    }

    _detachEventListeners() {
        if (!this._elements.button) return;
        
        this._listeners.forEach((handler, event) => {
            this._elements.button.removeEventListener(event, handler);
        });
        
        this._listeners.clear();
        
        // حذف hover handlerهای خاص
        if (this._hoverHandler) {
            this._elements.button.removeEventListener('mouseenter', this._hoverHandler);
            this._elements.button.removeEventListener('mouseleave', this._hoverHandler);
            this._hoverHandler = null;
        }
    }

    _cleanupResources() {
        this._detachEventListeners();
        
        this._elements = {
            container: null,
            button: null,
            icon: null,
            label: null,
            loader: null
        };
        
        this._options = null;
        this._listeners.clear();
        
        // تمیز کردن referenceها برای GC
        if (this._eventBus && typeof this._eventBus.off === 'function') {
            this._eventBus.off(`ui:button:${this._buttonId}:*`);
        }
    }

    _setDisabled(isDisabled) {
        if (this._state.destroyed) return this;
        
        this._state.disabled = Boolean(isDisabled);
        
        if (this._elements.button) {
            this._elements.button.disabled = this._state.disabled;
            this._elements.button.setAttribute('aria-disabled', this._state.disabled);
            this._elements.button.classList.toggle('v-btn-disabled', this._state.disabled);
            
            this._applyStyles();
        }
        
        this._eventBus.emit('ui:button:disabled', {
            id: this._buttonId,
            disabled: this._state.disabled
        });
        
        return this;
    }

    _updateAppearance() {
        if (!this._elements.button || this._state.destroyed) return;
        
        const oldClasses = this._elements.button.className.split(' ');
        const newClasses = [
            'vakamova-button',
            this._config.types[this._options.type].base,
            this._config.sizes[this._options.size].class,
            this._config.animations[this._options.animation] || '',
            this._options.fullWidth ? 'v-btn-fullwidth' : '',
            this._state.disabled ? 'v-btn-disabled' : '',
            this._state.loading ? 'v-btn-loading' : '',
            this._options.customClass
        ].filter(Boolean);
        
        this._elements.button.className = newClasses.join(' ');
        
        if (this._elements.label && this._options.text) {
            this._elements.label.textContent = this._options.text;
            this._elements.label.setAttribute('data-text', this._options.text);
        }
        
        if (this._elements.icon) {
            if (this._options.icon) {
                this._elements.icon.innerHTML = this._options.icon;
                this._elements.icon.style.display = 'inline-flex';
            } else {
                this._elements.icon.style.display = 'none';
            }
        }
        
        this._applyStyles();
    }

    // ==================== متدهای دسترسی (ایمن) ====================
    getState() {
        return Object.freeze({ 
            ...this._state, 
            id: this._buttonId, 
            options: this._options ? { ...this._options } : null 
        });
    }

    getId() {
        return this._buttonId;
    }

    getElement() {
        return this._state.destroyed ? null : this._elements.button;
    }

    isDisabled() {
        return this._state.disabled;
    }

    isLoading() {
        return this._state.loading;
    }

    isRendered() {
        return this._state.rendered;
    }

    isDestroyed() {
        return this._state.destroyed;
    }
}

// ==================== Factory Pattern (ایمن) ====================
class ButtonFactory {
    static create(config = {}) {
        try {
            return new VakamovaButton(config);
        } catch (error) {
            console.error('[ButtonFactory] Failed to create button:', error);
            throw error;
        }
    }
    
    static createPrimary(text, options = {}) {
        return this.create({
            type: 'primary',
            text,
            ...options
        });
    }
    
    static createSecondary(text, options = {}) {
        return this.create({
            type: 'secondary',
            text,
            ...options
        });
    }
    
    static createIconButton(icon, options = {}) {
        return this.create({
            icon,
            text: '',
            size: options.size || 'sm',
            ...options
        });
    }
}

// ==================== اکسپورت ایمن ====================
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { VakamovaButton, ButtonFactory };
} else if (typeof define === 'function' && define.amd) {
    define([], () => ({ VakamovaButton, ButtonFactory }));
} else {
    // جلوگیری از override تصادفی
    Object.defineProperty(window, 'VakamovaButton', {
        value: VakamovaButton,
        writable: false,
        configurable: false
    });
    
    Object.defineProperty(window, 'ButtonFactory', {
        value: ButtonFactory,
        writable: false,
        configurable: false
    });
            }
