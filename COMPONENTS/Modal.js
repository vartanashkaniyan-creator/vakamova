/**
 * VAKAMOVA MODAL COMPONENT - سیستم پنجره‌های محاوره‌ای پیشرفته
 * اصول: تزریق وابستگی، قرارداد رابط، رویدادمحور، پیکربندی متمرکز
 */

class VakamovaModal {
    constructor(config = {}, dependencies = {}) {
        // اصل ۱: تزریق وابستگی
        this._deps = {
            eventBus: dependencies.eventBus || window.eventBus,
            animationEngine: dependencies.animationEngine || null,
            focusManager: dependencies.focusManager || null,
            ...dependencies
        };
        
        // اصل ۴: پیکربندی متمرکز
        this._config = Object.freeze({
            id: config.id || `modal_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            title: config.title || '',
            content: config.content || '',
            type: config.type || 'default', // default, alert, confirm, dialog
            size: config.size || 'medium', // small, medium, large, fullscreen
            position: config.position || 'center', // center, top, bottom, left, right
            backdrop: config.backdrop ?? true,
            closable: config.closable ?? true,
            closeOnEscape: config.closeOnEscape ?? true,
            closeOnBackdropClick: config.closeOnBackdropClick ?? true,
            animation: config.animation || 'fade', // fade, slide, zoom, none
            animationDuration: config.animationDuration || 300,
            autoOpen: config.autoOpen ?? false,
            autoFocus: config.autoFocus ?? true,
            trapFocus: config.trapFocus ?? true,
            scrollLock: config.scrollLock ?? true,
            zIndex: config.zIndex || 1000,
            className: config.className || '',
            overlayClass: config.overlayClass || '',
            headerClass: config.headerClass || '',
            bodyClass: config.bodyClass || '',
            footerClass: config.footerClass || '',
            ...config
        });
        
        // وضعیت داخلی
        this._state = {
            isOpen: false,
            isAnimating: false,
            isMounted: false,
            hasFocusTrap: false,
            originalFocusElement: null,
            scrollLocked: false
        };
        
        // المان‌های DOM
        this._elements = {
            overlay: null,
            modal: null,
            header: null,
            title: null,
            body: null,
            footer: null,
            closeButton: null
        };
        
        // مدیریت فوکوس
        this._focusableElements = [];
        this._currentFocusIndex = -1;
        
        // Bind methods
        this._handleEscapeKey = this._handleEscapeKey.bind(this);
        this._handleBackdropClick = this._handleBackdropClick.bind(this);
        this._handleTabKey = this._handleTabKey.bind(this);
        this._animateOpen = this._animateOpen.bind(this);
        this._animateClose = this._animateClose.bind(this);
        
        // شناسه منحصر به فرد
        this._id = this._config.id;
        
        // رجیستر کردن در سیستم رویداد
        this._registerEventListeners();
        
        // Auto-open if configured
        if (this._config.autoOpen) {
            setTimeout(() => this.open(), 100);
        }
        
        console.log(`[Modal] ✅ ${this._id} ساخته شد`);
    }
    
    // ==================== PUBLIC INTERFACE (قرارداد رابط) ====================
    
    open(content = null) {
        if (this._state.isOpen || this._state.isAnimating) {
            console.warn(`[Modal] ${this._id} در حال حاضر باز است`);
            return this;
        }
        
        // به‌روزرسانی محتوا اگر ارائه شده
        if (content !== null) {
            this.setContent(content);
        }
        
        this._state.isAnimating = true;
        this._state.originalFocusElement = document.activeElement;
        
        // انتشار رویداد قبل از باز شدن
        this._emitEvent('modal:beforeOpen', {
            modalId: this._id,
            config: this._config
        });
        
        // ساخت المان‌ها اگر اولین بار است
        if (!this._state.isMounted) {
            this._createElements();
            this._state.isMounted = true;
        }
        
        // اضافه کردن به DOM
        this._attachToDOM();
        
        // اعمال استایل‌ها
        this._applyStyles();
        
        // قفل اسکرول
        if (this._config.scrollLock) {
            this._lockScroll();
        }
        
        // تله فوکوس
        if (this._config.trapFocus) {
            this._setupFocusTrap();
        }
        
        // فوکوس خودکار
        if (this._config.autoFocus) {
            this._setInitialFocus();
        }
        
        // شروع انیمیشن
        this._animateOpen();
        
        // ثبت event listeners
        this._attachEventListeners();
        
        return this;
    }
    
    close(force = false) {
        if (!this._state.isOpen || this._state.isAnimating) {
            return this;
        }
        
        this._state.isAnimating = true;
        
        // انتشار رویداد قبل از بسته شدن
        const closeEvent = this._emitEvent('modal:beforeClose', {
            modalId: this._id,
            force
        });
        
        // بررسی لغو شدن رویداد
        if (closeEvent.defaultPrevented && !force) {
            this._state.isAnimating = false;
            return this;
        }
        
        // شروع انیمیشن بسته شدن
        this._animateClose();
        
        return this;
    }
    
    toggle() {
        return this._state.isOpen ? this.close() : this.open();
    }
    
    setTitle(title) {
        this._config.title = title;
        if (this._elements.title) {
            this._elements.title.textContent = title;
        }
        
        this._emitEvent('modal:titleChanged', {
            modalId: this._id,
            title
        });
        
        return this;
    }
    
    setContent(content, type = 'html') {
        if (typeof content === 'string') {
            this._config.content = content;
            
            if (this._elements.body) {
                if (type === 'html') {
                    this._elements.body.innerHTML = content;
                } else {
                    this._elements.body.textContent = content;
                }
            }
        } else if (content instanceof Element || content instanceof DocumentFragment) {
            this._config.content = '';
            
            if (this._elements.body) {
                this._elements.body.innerHTML = '';
                this._elements.body.appendChild(content);
            }
        }
        
        // به‌روزرسانی لیست المان‌های فوکوس‌پذیر
        if (this._state.isOpen) {
            this._updateFocusableElements();
        }
        
        this._emitEvent('modal:contentChanged', {
            modalId: this._id,
            content,
            contentType: type
        });
        
        return this;
    }
    
    appendContent(content, position = 'append') {
        if (!this._elements.body) return this;
        
        const body = this._elements.body;
        
        if (position === 'prepend') {
            if (typeof content === 'string') {
                body.innerHTML = content + body.innerHTML;
            } else if (content instanceof Element) {
                body.insertBefore(content, body.firstChild);
            }
        } else {
            if (typeof content === 'string') {
                body.innerHTML += content;
            } else if (content instanceof Element) {
                body.appendChild(content);
            }
        }
        
        // به‌روزرسانی لیست المان‌های فوکوس‌پذیر
        this._updateFocusableElements();
        
        return this;
    }
    
    setSize(size) {
        const validSizes = ['small', 'medium', 'large', 'fullscreen'];
        if (!validSizes.includes(size)) {
            console.warn(`[Modal] سایز نامعتبر: ${size}`);
            return this;
        }
        
        // حذف کلاس‌های سایز قبلی
        if (this._elements.modal) {
            validSizes.forEach(s => {
                this._elements.modal.classList.remove(`vak-modal-${s}`);
            });
            
            // اضافه کردن کلاس جدید
            this._elements.modal.classList.add(`vak-modal-${size}`);
        }
        
        this._config.size = size;
        
        this._emitEvent('modal:sizeChanged', {
            modalId: this._id,
            size
        });
        
        return this;
    }
    
    setPosition(position) {
        const validPositions = ['center', 'top', 'bottom', 'left', 'right'];
        if (!validPositions.includes(position)) {
            console.warn(`[Modal] موقعیت نامعتبر: ${position}`);
            return this;
        }
        
        // حذف کلاس‌های موقعیت قبلی
        if (this._elements.modal) {
            validPositions.forEach(p => {
                this._elements.modal.classList.remove(`vak-modal-${p}`);
            });
            
            // اضافه کردن کلاس جدید
            this._elements.modal.classList.add(`vak-modal-${position}`);
        }
        
        this._config.position = position;
        
        this._emitEvent('modal:positionChanged', {
            modalId: this._id,
            position
        });
        
        return this;
    }
    
    updateConfig(newConfig) {
        // فقط ویژگی‌های قابل به‌روزرسانی
        const updatableConfig = {
            title: newConfig.title,
            closable: newConfig.closable,
            closeOnEscape: newConfig.closeOnEscape,
            closeOnBackdropClick: newConfig.closeOnBackdropClick,
            className: newConfig.className,
            ...newConfig
        };
        
        Object.assign(this._config, updatableConfig);
        
        // اعمال تغییرات روی المان‌های موجود
        if (this._state.isMounted) {
            this._applyConfigToElements();
        }
        
        this._emitEvent('modal:configUpdated', {
            modalId: this._id,
            config: updatableConfig
        });
        
        return this;
    }
    
    getState() {
        return { ...this._state };
    }
    
    getConfig() {
        return { ...this._config };
    }
    
    getElement() {
        return this._elements.modal;
    }
    
    getBodyElement() {
        return this._elements.body;
    }
    
    destroy() {
        // بستن مودال اگر باز است
        if (this._state.isOpen) {
            this.close(true);
            
            // کمی تأخیر برای اتمام انیمیشن
            setTimeout(() => this._completeDestroy(), this._config.animationDuration);
        } else {
            this._completeDestroy();
        }
        
        return null;
    }
    
    _completeDestroy() {
        // حذف event listeners
        this._removeEventListeners();
        
        // حذف المان‌ها از DOM
        this._removeFromDOM();
        
        // باز کردن قفل اسکرول
        if (this._state.scrollLocked) {
            this._unlockScroll();
        }
        
        // بازگرداندن فوکوس
        if (this._state.originalFocusElement && this._state.originalFocusElement.focus) {
            this._state.originalFocusElement.focus();
        }
        
        // انتشار رویداد نابودی
        this._emitEvent('modal:destroyed', {
            modalId: this._id
        });
        
        // پاک‌سازی منابع
        this._elements = {
            overlay: null,
            modal: null,
            header: null,
            title: null,
            body: null,
            footer: null,
            closeButton: null
        };
        
        this._state.isMounted = false;
        
        console.log(`[Modal] 🗑️ ${this._id} از بین رفت`);
    }
    
    // ==================== ELEMENT CREATION ====================
    
    _createElements() {
        // Overlay
        this._elements.overlay = document.createElement('div');
        this._elements.overlay.className = `vak-modal-overlay ${this._config.overlayClass}`.trim();
        this._elements.overlay.dataset.modalId = this._id;
        
        // Modal container
        this._elements.modal = document.createElement('div');
        this._elements.modal.className = `vak-modal ${this._config.className} vak-modal-${this._config.size} vak-modal-${this._config.position}`.trim();
        this._elements.modal.dataset.modalId = this._id;
        this._elements.modal.setAttribute('role', 'dialog');
        this._elements.modal.setAttribute('aria-modal', 'true');
        this._elements.modal.setAttribute('aria-labelledby', `${this._id}_title`);
        this._elements.modal.setAttribute('aria-describedby', `${this._id}_body`);
        
        // Header
        this._elements.header = document.createElement('div');
        this._elements.header.className = `vak-modal-header ${this._config.headerClass}`.trim();
        
        // Title
        this._elements.title = document.createElement('h3');
        this._elements.title.id = `${this._id}_title`;
        this._elements.title.className = 'vak-modal-title';
        this._elements.title.textContent = this._config.title;
        
        // Close button (if closable)
        if (this._config.closable) {
            this._elements.closeButton = document.createElement('button');
            this._elements.closeButton.className = 'vak-modal-close';
            this._elements.closeButton.innerHTML = '&times;';
            this._elements.closeButton.setAttribute('aria-label', 'بستن');
            this._elements.closeButton.setAttribute('type', 'button');
            
            this._elements.header.appendChild(this._elements.closeButton);
        }
        
        this._elements.header.appendChild(this._elements.title);
        
        // Body
        this._elements.body = document.createElement('div');
        this._elements.body.id = `${this._id}_body`;
        this._elements.body.className = `vak-modal-body ${this._config.bodyClass}`.trim();
        
        if (typeof this._config.content === 'string') {
            this._elements.body.innerHTML = this._config.content;
        } else if (this._config.content instanceof Element) {
            this._elements.body.appendChild(this._config.content);
        }
        
        // Footer (optional)
        this._elements.footer = document.createElement('div');
        this._elements.footer.className = `vak-modal-footer ${this._config.footerClass}`.trim();
        
        // ساختار درختی
        this._elements.modal.appendChild(this._elements.header);
        this._elements.modal.appendChild(this._elements.body);
        this._elements.modal.appendChild(this._elements.footer);
        this._elements.overlay.appendChild(this._elements.modal);
    }
    
    _attachToDOM() {
        if (!this._elements.overlay || !document.body) return;
        
        document.body.appendChild(this._elements.overlay);
        
        // تنظیم z-index
        this._elements.overlay.style.zIndex = this._config.zIndex;
        this._elements.modal.style.zIndex = this._config.zIndex + 1;
    }
    
    _removeFromDOM() {
        if (this._elements.overlay && this._elements.overlay.parentNode) {
            this._elements.overlay.parentNode.removeChild(this._elements.overlay);
        }
    }
    
    _applyStyles() {
        if (!this._elements.overlay) return;
        
        // استایل Overlay
        Object.assign(this._elements.overlay.style, {
            position: 'fixed',
            top: '0',
            left: '0',
            width: '100%',
            height: '100%',
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: '0',
            visibility: 'hidden',
            transition: `opacity ${this._config.animationDuration}ms ease`
        });
        
        // استایل Modal
        Object.assign(this._elements.modal.style, {
            backgroundColor: '#ffffff',
            borderRadius: '12px',
            boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)',
            maxWidth: this._getMaxWidth(),
            maxHeight: '90vh',
            overflow: 'hidden',
            transform: this._getInitialTransform(),
            transition: `transform ${this._config.animationDuration}ms ease, opacity ${this._config.animationDuration}ms ease`,
            opacity: '0'
        });
        
        // استایل Header
        if (this._elements.header) {
            Object.assign(this._elements.header.style, {
                padding: '20px 24px',
                borderBottom: '1px solid #e0e0e0',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
            });
        }
        
        // استایل Title
        if (this._elements.title) {
            Object.assign(this._elements.title.style, {
                margin: '0',
                fontSize: '1.5rem',
                fontWeight: '600',
                color: '#333'
            });
        }
        
        // استایل Close Button
        if (this._elements.closeButton) {
            Object.assign(this._elements.closeButton.style, {
                background: 'none',
                border: 'none',
                fontSize: '2rem',
                cursor: 'pointer',
                color: '#666',
                width: '40px',
                height: '40px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '50%',
                transition: 'background-color 0.2s'
            });
            
            // Hover effect
            this._elements.closeButton.addEventListener('mouseenter', () => {
                this._elements.closeButton.style.backgroundColor = '#f5f5f5';
            });
            
            this._elements.closeButton.addEventListener('mouseleave', () => {
                this._elements.closeButton.style.backgroundColor = 'transparent';
            });
        }
        
        // استایل Body
        if (this._elements.body) {
            Object.assign(this._elements.body.style, {
                padding: '24px',
                maxHeight: 'calc(90vh - 140px)',
                overflowY: 'auto'
            });
        }
        
        // استایل Footer
        if (this._elements.footer) {
            Object.assign(this._elements.footer.style, {
                padding: '16px 24px',
                borderTop: '1px solid #e0e0e0',
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '12px'
            });
        }
        
        // اضافه کردن استایل‌های دینامیک
        if (!document.querySelector('#vakamova-modal-styles')) {
            const styleEl = document.createElement('style');
            styleEl.id = 'vakamova-modal-styles';
            styleEl.textContent = `
                .vak-modal-small { width: 400px; }
                .vak-modal-medium { width: 600px; }
                .vak-modal-large { width: 800px; }
                .vak-modal-fullscreen { width: 95vw; height: 95vh; }
                
                .vak-modal-center { align-items: center; justify-content: center; }
                .vak-modal-top { align-items: flex-start; padding-top: 20px; }
                .vak-modal-bottom { align-items: flex-end; padding-bottom: 20px; }
                .vak-modal-left { justify-content: flex-start; padding-left: 20px; }
                .vak-modal-right { justify-content: flex-end; padding-right: 20px; }
                
                @media (max-width: 768px) {
                    .vak-modal-small,
                    .vak-modal-medium,
                    .vak-modal-large {
                        width: 95vw;
                        margin: 10px;
                    }
                }
            `;
            document.head.appendChild(styleEl);
        }
    }
    
    _applyConfigToElements() {
        // به‌روزرسانی عنوان
        if (this._elements.title && this._config.title !== undefined) {
            this._elements.title.textContent = this._config.title;
        }
        
        // نمایش/پنهان کردن دکمه بستن
        if (this._elements.closeButton) {
            this._elements.closeButton.style.display = this._config.closable ? 'flex' : 'none';
        }
        
        // به‌روزرسانی کلاس‌ها
        if (this._elements.modal) {
            this._elements.modal.className = `vak-modal ${this._config.className} vak-modal-${this._config.size} vak-modal-${this._config.position}`.trim();
        }
    }
    
    _getMaxWidth() {
        switch (this._config.size) {
            case 'small': return '400px';
            case 'medium': return '600px';
            case 'large': return '800px';
            case 'fullscreen': return '95vw';
            default: return '600px';
        }
    }
    
    _getInitialTransform() {
        if (this._config.animation === 'none') return 'none';
        
        switch (this._config.animation) {
            case 'slide':
                switch (this._config.position) {
                    case 'top': return 'translateY(-100px)';
                    case 'bottom': return 'translateY(100px)';
                    case 'left': return 'translateX(-100px)';
                    case 'right': return 'translateX(100px)';
                    default: return 'translateY(50px)';
                }
            case 'zoom':
                return 'scale(0.8)';
            case 'fade':
            default:
                return 'none';
        }
    }
    
    // ==================== ANIMATION SYSTEM ====================
    
    _animateOpen() {
        if (!this._elements.overlay || !this._elements.modal) return;
        
        // نمایش overlay
        this._elements.overlay.style.visibility = 'visible';
        
        // شروع انیمیشن در فریم بعدی
        requestAnimationFrame(() => {
            // فعال کردن overlay
            this._elements.overlay.style.opacity = '1';
            
            // فعال کردن modal
            this._elements.modal.style.opacity = '1';
            this._elements.modal.style.transform = this._getFinalTransform();
            
            // پایان انیمیشن
            setTimeout(() => {
                this._state.isOpen = true;
                this._state.isAnimating = false;
                
                this._emitEvent('modal:opened', {
                    modalId: this._id,
                    config: this._config
                });
                
                console.log(`[Modal] ✅ ${this._id} باز شد`);
            }, this._config.animationDuration);
        });
    }
    
    _animateClose() {
        if (!this._elements.overlay || !this._elements.modal) return;
        
        // شروع انیمیشن بسته شدن
        this._elements.overlay.style.opacity = '0';
        this._elements.modal.style.opacity = '0';
        this._elements.modal.style.transform = this._getInitialTransform();
        
        // پایان انیمیشن و پاکسازی
        setTimeout(() => {
            this._elements.overlay.style.visibility = 'hidden';
            
            this._state.isOpen = false;
            this._state.isAnimating = false;
            
            // حذف از DOM
            this._removeFromDOM();
            
            // باز کردن قفل اسکرول
            if (this._state.scrollLocked) {
                this._unlockScroll();
            }
            
            // حذف تله فوکوس
            if (this._state.hasFocusTrap) {
                this._removeFocusTrap();
            }
            
            // بازگرداندن فوکوس به المان قبلی
            if (this._state.originalFocusElement && this._state.originalFocusElement.focus) {
                this._state.originalFocusElement.focus();
            }
            
            this._emitEvent('modal:closed', {
                modalId: this._id,
                config: this._config
            });
            
            console.log(`[Modal] 🔒 ${this._id} بسته شد`);
        }, this._config.animationDuration);
    }
    
    _getFinalTransform() {
        return 'none';
    }
    
    // ==================== FOCUS MANAGEMENT ====================
    
    _setupFocusTrap() {
        if (!this._elements.modal || this._state.hasFocusTrap) return;
        
        // جمع‌آوری المان‌های فوکوس‌پذیر
        this._updateFocusableElements();
        
        // اگر المان فوکوس‌پذیری وجود ندارد، دکمه بستن را فوکوس‌پذیر می‌کنیم
        if (this._focusableElements.length === 0 && this._elements.closeButton) {
            this._focusableElements = [this._elements.closeButton];
        }
        
        // تنظیم event listener برای Tab
        this._elements.modal.addEventListener('keydown', this._handleTabKey);
        
        this._state.hasFocusTrap = true;
    }
    
    _removeFocusTrap() {
        if (!this._elements.modal || !this._state.hasFocusTrap) return;
        
        this._elements.modal.removeEventListener('keydown', this._handleTabKey);
        this._state.hasFocusTrap = false;
        this._focusableElements = [];
        this._currentFocusIndex = -1;
    }
    
    _updateFocusableElements() {
        if (!this._elements.modal) return;
        
        // جمع‌آوری همه المان‌های فوکوس‌پذیر داخل مودال
        this._focusableElements = Array.from(
            this._elements.modal.querySelectorAll(
                'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
            )
        ).filter(el => {
            return !el.disabled && el.offsetParent !== null;
        });
    }
    
    _setInitialFocus() {
        if (!this._elements.modal) return;
        
        // پیدا کردن اولین المان فوکوس‌پذیر
        const firstFocusable = this._focusableElements[0] || this._elements.closeButton;
        
        if (firstFocusable && firstFocusable.focus) {
            firstFocusable.focus();
            this._currentFocusIndex = this._focusableElements.indexOf(firstFocusable);
        }
    }
    
    _handleTabKey(event) {
        if (event.key !== 'Tab') return;
        
        if (this._focusableElements.length === 0) {
            event.preventDefault();
            return;
        }
        
        // Shift + Tab
        if (event.shiftKey) {
            if (this._currentFocusIndex <= 0) {
                // به آخرین المان برو
                this._currentFocusIndex = this._focusableElements.length - 1;
            } else {
                this._currentFocusIndex--;
            }
        } else {
            // Tab معمولی
            if (this._currentFocusIndex >= this._focusableElements.length - 1) {
                // به اولین المان برو
                this._currentFocusIndex = 0;
            } else {
                this._currentFocusIndex++;
            }
        }
        
        // اعمال فوکوس
        this._focusableElements[this._currentFocusIndex]?.focus();
        
        event.preventDefault();
    }
    
    // ==================== SCROLL LOCK ====================
    
    _lockScroll() {
        if (this._state.scrollLocked) return;
        
        const scrollBarWidth = window.innerWidth - document.documentElement.clientWidth;
        const body = document.body;
        
        // ذخیره موقعیت فعلی اسکرول
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        body.style.top = `-${scrollTop}px`;
        
        // قفل اسکرول
        body.style.position = 'fixed';
        body.style.width = '100%';
        body.style.overflowY = 'scroll';
        body.style.paddingRight = `${scrollBarWidth}px`;
        
        this._state.scrollLocked = true;
        this._state.scrollPosition = scrollTop;
    }
    
    _unlockScroll() {
        if (!this._state.scrollLocked) return;
        
        const body = document.body;
        
        // بازگرداندن استایل‌ها
        body.style.position = '';
        body.style.width = '';
        body.style.overflowY = '';
        body.style.paddingRight = '';
        
        // بازگرداندن موقعیت اسکرول
        const scrollTop = parseInt(body.style.top || '0') * -1;
        body.style.top = '';
        
        window.scrollTo(0, scrollTop || this._state.scrollPosition);
        
        this._state.scrollLocked = false;
        this._state.scrollPosition = null;
    }
    
    // ==================== EVENT HANDLING ====================
    
    _registerEventListeners() {
        this._eventHandlers = {
            escape: null,
            backdrop: null,
            closeButton: null
        };
    }
    
    _attachEventListeners() {
        // Escape key
        if (this._config.closeOnEscape) {
            this._eventHandlers.escape = this._handleEscapeKey;
            document.addEventListener('keydown', this._eventHandlers.escape);
        }
        
        // Backdrop click
        if (this._config.closeOnBackdropClick && this._config.backdrop) {
            this._eventHandlers.backdrop = this._handleBackdropClick;
            this._elements.overlay.addEventListener('click', this._eventHandlers.backdrop);
        }
        
        // Close button click
        if (this._elements.closeButton) {
            this._eventHandlers.closeButton = () => this.close();
            this._elements.closeButton.addEventListener('click', this._eventHandlers.closeButton);
        }
        
        // Prevent click propagation on modal
        if (this._elements.modal) {
            this._elements.modal.addEventListener('click', (e) => {
                e.stopPropagation();
            });
        }
    }
    
    _removeEventListeners() {
        // Escape key
        if (this._eventHandlers.escape) {
            document.removeEventListener('keydown', this._eventHandlers.escape);
            this._eventHandlers.escape = null;
        }
        
        // Backdrop click
        if (this._eventHandlers.backdrop && this._elements.overlay) {
            this._elements.overlay.removeEventListener('click', this._eventHandlers.backdrop);
            this._eventHandlers.backdrop = null;
        }
        
        // Close button click
        if (this._eventHandlers.closeButton && this._elements.closeButton) {
            this._elements.closeButton.removeEventListener('click', this._eventHandlers.closeButton);
            this._eventHandlers.closeButton = null;
        }
    }
    
    _handleEscapeKey(event) {
        if (event.key === 'Escape' && this._state.isOpen) {
            this.close();
        }
    }
    
    _handleBackdropClick(event) {
        if (event.target === this._elements.overlay) {
            this.close();
        }
    }
    
    _emitEvent(eventName, data) {
        const eventData = {
            source: 'VakamovaModal',
            timestamp: Date.now(),
            ...data
        };
        
        // انتشار از طریق Event Bus
        if (this._deps.eventBus && typeof this._deps.eventBus.emit === 'function') {
            this._deps.eventBus.emit(eventName, eventData);
        }
        
        // انتشار رویداد سفارشی در DOM
        if (this._elements.modal) {
            const customEvent = new CustomEvent(`vakamova:${eventName}`, {
                bubbles: true,
                cancelable: true,
                detail: eventData
            });
            
            this._elements.modal.dispatchEvent(customEvent);
        }
        
        return eventData;
    }
    
    // ==================== STATIC METHODS ====================
    
    static create(config, dependencies = {}) {
        return new VakamovaModal(config, dependencies);
    }
    
    static alert(config) {
        const modal = new VakamovaModal({
            type: 'alert',
            closable: false,
            ...config
        });
        
        modal.open();
        return modal;
    }
    
    static confirm(config) {
        return new Promise((resolve) => {
            const modal = new VakamovaModal({
                type: 'confirm',
                closable: false,
                ...config
            });
            
            // اضافه کردن دکمه‌های تأیید/لغو
            const confirmBtn = document.createElement('button');
            confirmBtn.textContent = config.confirmText || 'تأیید';
            confirmBtn.className = 'vak-btn vak-btn-primary';
            confirmBtn.onclick = () => {
                modal.close();
                resolve(true);
            };
            
            const cancelBtn = document.createElement('button');
            cancelBtn.textContent = config.cancelText || 'لغو';
            cancelBtn.className = 'vak-btn vak-btn-secondary';
            cancelBtn.onclick = () => {
                modal.close();
                resolve(false);
            };
            
            modal.setContent(config.content || 'آیا مطمئن هستید؟');
            
            const footer = modal.getBodyElement().parentNode.querySelector('.vak-modal-footer');
            if (footer) {
                footer.appendChild(cancelBtn);
                footer.appendChild(confirmBtn);
            }
            
            modal.open();
        });
    }
    
    static dialog(config) {
        const modal = new VakamovaModal({
            type: 'dialog',
            ...config
        });
        
        modal.open();
        return modal;
    }
}

// ثبت جهانی برای دسترسی آسان
if (typeof window !== 'undefined') {
    window.VakamovaModal = VakamovaModal;
}

export { VakamovaModal };
