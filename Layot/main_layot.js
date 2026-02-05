/**
 * VAKAMOVA MAIN LAYOUT - سیستم قالب اصلی هوشمند
 * اصول: تزریق وابستگی، قرارداد رابط، رویدادمحور، پیکربندی متمرکز
 * وابستگی داخلی: event_bus.js, state_manager.js, router.js, header.js, footer.js
 */

class VakamovaMainLayout {
    constructor(config = {}) {
        // اصل ۴: پیکربندی متمرکز
        this.config = Object.freeze({
            containerId: config.containerId || '#app',
            defaultPage: config.defaultPage || '/home',
            layoutType: config.layoutType || 'default', // default | dashboard | minimal
            showHeader: config.showHeader ?? true,
            showFooter: config.showFooter ?? true,
            showSidebar: config.showSidebar ?? false,
            sidebarPosition: config.sidebarPosition || 'right', // right | left
            transitionEffect: config.transitionEffect || 'fade', // fade | slide | none
            loadingIndicator: config.loadingIndicator || true,
            errorBoundary: config.errorBoundary ?? true,
            
            layoutStyles: config.layoutStyles || {
                headerHeight: '64px',
                footerHeight: 'auto',
                sidebarWidth: '280px',
                maxContentWidth: '1400px',
                mobileBreakpoint: '768px',
                zIndexes: { header: 1000, sidebar: 900, modal: 2000 }
            },
            
            // مسیرهای کامپوننت‌های لایه‌ای
            componentPaths: config.componentPaths || {
                header: './layouts/header.js',
                footer: './layouts/footer.js',
                sidebar: './layouts/sidebar.js'
            },
            
            // صفحه‌های استاتیک (مانند 404، loading)
            staticPages: config.staticPages || {
                loading: '<div class="layout-loading">در حال بارگذاری...</div>',
                notFound: '<div class="layout-404">صفحه مورد نظر یافت نشد</div>',
                error: '<div class="layout-error">خطا در بارگذاری صفحه</div>'
            },
            
            // تنظیمات پیشرفته
            enablePrefetch: config.enablePrefetch ?? true,
            enableCaching: config.enableCaching ?? true,
            cacheTTL: config.cacheTTL || 30000,
            performanceMonitoring: config.performanceMonitoring ?? true,
            ...config
        });
        
        // اصل ۱: تزریق وابستگی‌های داخلی
        this.eventBus = config.eventBus || window.eventBus;
        this.stateManager = config.stateManager || window.stateManager;
        this.router = config.router || window.router;
        this.utils = config.utils || window.utils;
        
        // ماژول‌های لایه‌ای (با lazy loading)
        this.components = {
            header: null,
            footer: null,
            sidebar: null
        };
        
        // وضعیت داخلی
        this.isMounted = false;
        this.isInitialized = false;
        this.currentPage = null;
        this.previousPage = null;
        this.layoutContainer = null;
        this.contentArea = null;
        
        // کش صفحات
        this.pageCache = new Map();
        this.prefetchQueue = new Set();
        
        // متدهای bind شده
        this.init = this.init.bind(this);
        this.renderPage = this.renderPage.bind(this);
        this.switchLayout = this.switchLayout.bind(this);
        this.handleRouteChange = this.handleRouteChange.bind(this);
        this.handleResize = this.handleResize.bind(this);
        
        // متریک‌های عملکرد
        this.metrics = {
            pageLoads: 0,
            avgLoadTime: 0,
            cacheHits: 0,
            errors: 0
        };
        
        // اصل ۳: رویدادمحور - ثبت listeners اولیه
        this._registerCoreListeners();
    }
    
    // ==================== CORE METHODS ====================
    
    async init() {
        if (this.isInitialized) {
            console.warn('[MainLayout] Already initialized');
            return this;
        }
        
        try {
            console.log('[MainLayout] Starting initialization...');
            
            // 1. پیدا کردن کانتینر اصلی
            this.layoutContainer = document.querySelector(this.config.containerId);
            if (!this.layoutContainer) {
                throw new Error(`Container ${this.config.containerId} not found`);
            }
            
            // 2. ایجاد ساختار DOM پایه
            this._createBaseStructure();
            
            // 3. بارگذاری lazy components
            await this._loadLayoutComponents();
            
            // 4. تنظیم event listeners
            this._setupEventListeners();
            
            // 5. تنظیم state اولیه
            await this._setupInitialState();
            
            this.isInitialized = true;
            
            // انتشار رویداد
            this.eventBus.emit('layout:initialized', {
                timestamp: Date.now(),
                containerId: this.config.containerId,
                layoutType: this.config.layoutType
            });
            
            console.log('[MainLayout] ✅ Successfully initialized');
            return this;
            
        } catch (error) {
            console.error('[MainLayout] ❌ Initialization failed:', error);
            this.eventBus.emit('layout:error', { 
                phase: 'init', 
                error: error.message 
            });
            throw error;
        }
    }
    
    async mount() {
        if (this.isMounted) return this;
        
        try {
            // 1. نمایش loading indicator
            if (this.config.loadingIndicator) {
                this._showLoading();
            }
            
            // 2. رندر هدر (اگر فعال باشد)
            if (this.config.showHeader && this.components.header) {
                await this.components.header.render('.layout-header-area');
                console.log('[MainLayout] Header rendered');
            }
            
            // 3. رندر sidebar (اگر فعال باشد)
            if (this.config.showSidebar && this.components.sidebar) {
                await this.components.sidebar.render('.layout-sidebar-area');
                console.log('[MainLayout] Sidebar rendered');
            }
            
            // 4. رندر فوتر (اگر فعال باشد)
            if (this.config.showFooter && this.components.footer) {
                await this.components.footer.render('.layout-footer-area');
                console.log('[MainLayout] Footer rendered');
            }
            
            // 5. بارگذاری صفحه اولیه
            await this._loadInitialPage();
            
            // 6. مخفی کردن loading
            if (this.config.loadingIndicator) {
                this._hideLoading();
            }
            
            // 7. فعال‌سازی prefetch (اگر فعال باشد)
            if (this.config.enablePrefetch) {
                this._startPrefetching();
            }
            
            this.isMounted = true;
            
            // انتشار رویداد
            this.eventBus.emit('layout:mounted', {
                timestamp: Date.now(),
                metrics: { ...this.metrics }
            });
            
            console.log('[MainLayout] 🚀 Successfully mounted');
            return this;
            
        } catch (error) {
            console.error('[MainLayout] ❌ Mount failed:', error);
            this.eventBus.emit('layout:error', { 
                phase: 'mount', 
                error: error.message 
            });
            
            // نمایش صفحه خطا
            this._showErrorPage(error);
            throw error;
        }
    }
    
    async renderPage(pageData) {
        const startTime = performance.now();
        
        try {
            const { pageId, content, metadata = {} } = pageData;
            
            // اعتبارسنجی
            if (!pageId || !content) {
                throw new Error('Invalid page data');
            }
            
            // ذخیره صفحه قبلی برای انیمیشن
            this.previousPage = this.currentPage;
            this.currentPage = pageId;
            
            // انتشار رویداد شروع رندر
            this.eventBus.emit('layout:page:render:start', {
                pageId,
                previousPage: this.previousPage,
                metadata
            });
            
            // اعمال افکت انتقال (اگر فعال باشد)
            if (this.config.transitionEffect !== 'none' && this.previousPage) {
                await this._applyTransition('out');
            }
            
            // رندر محتوا
            this.contentArea.innerHTML = content;
            
            // اجرای اسکریپت‌های درون صفحه
            this._executePageScripts();
            
            // اعمال افکت ورود
            if (this.config.transitionEffect !== 'none') {
                await this._applyTransition('in');
            }
            
            // به‌روزرسانی state
            this.stateManager?.set('layout.currentPage', {
                id: pageId,
                metadata,
                timestamp: Date.now()
            });
            
            // به‌روزرسانی متریک‌ها
            const loadTime = performance.now() - startTime;
            this.metrics.pageLoads++;
            this.metrics.avgLoadTime = 
                (this.metrics.avgLoadTime * (this.metrics.pageLoads - 1) + loadTime) / this.metrics.pageLoads;
            
            // انتشار رویداد موفقیت
            this.eventBus.emit('layout:page:rendered', {
                pageId,
                loadTime,
                metadata,
                metrics: { ...this.metrics }
            });
            
            // Prefetch صفحات مرتبط
            if (this.config.enablePrefetch && metadata.relatedPages) {
                this._prefetchPages(metadata.relatedPages);
            }
            
            console.log(`[MainLayout] ✅ Page "${pageId}" rendered in ${loadTime.toFixed(1)}ms`);
            
            return { success: true, loadTime };
            
        } catch (error) {
            console.error(`[MainLayout] ❌ Page render failed:`, error);
            
            this.metrics.errors++;
            this.eventBus.emit('layout:page:error', {
                pageId: pageData?.pageId,
                error: error.message,
                metrics: { ...this.metrics }
            });
            
            if (this.config.errorBoundary) {
                this._showErrorPage(error, pageData?.pageId);
            }
            
            return { success: false, error: error.message };
        }
    }
    
    async switchLayout(layoutType, options = {}) {
        const validLayouts = ['default', 'dashboard', 'minimal', 'fullscreen'];
        if (!validLayouts.includes(layoutType)) {
            throw new Error(`Invalid layout type: ${layoutType}`);
        }
        
        const oldLayout = this.config.layoutType;
        
        // انتشار رویداد شروع تغییر
        this.eventBus.emit('layout:switch:start', {
            from: oldLayout,
            to: layoutType,
            options
        });
        
        try {
            // 1. مخفی کردن کامپوننت‌های فعلی
            await this._hideLayoutComponents();
            
            // 2. به‌روزرسانی پیکربندی
            this.config = Object.freeze({
                ...this.config,
                layoutType,
                showHeader: options.showHeader ?? (layoutType !== 'minimal' && layoutType !== 'fullscreen'),
                showFooter: options.showFooter ?? (layoutType === 'default'),
                showSidebar: options.showSidebar ?? (layoutType === 'dashboard')
            });
            
            // 3. اعمال استایل‌های جدید
            this._applyLayoutStyles(layoutType);
            
            // 4. نمایش مجدد کامپوننت‌ها (اگر نیاز باشد)
            await this._showLayoutComponents();
            
            // 5. به‌روزرسانی state
            this.stateManager?.set('layout.current', {
                type: layoutType,
                changedAt: Date.now(),
                options
            });
            
            // انتشار رویداد موفقیت
            this.eventBus.emit('layout:switched', {
                from: oldLayout,
                to: layoutType,
                options,
                timestamp: Date.now()
            });
            
            console.log(`[MainLayout] 🔄 Layout switched from ${oldLayout} to ${layoutType}`);
            
            return { success: true, from: oldLayout, to: layoutType };
            
        } catch (error) {
            console.error(`[MainLayout] ❌ Layout switch failed:`, error);
            this.eventBus.emit('layout:switch:error', {
                from: oldLayout,
                to: layoutType,
                error: error.message
            });
            throw error;
        }
    }
    
    // ==================== EVENT HANDLERS ====================
    
    async handleRouteChange(event) {
        const { route, params = {}, query = {} } = event;
        
        try {
            // انتشار رویداد شروع تغییر مسیر
            this.eventBus.emit('layout:route:change:start', {
                route,
                params,
                query,
                previousRoute: this.currentPage
            });
            
            // بررسی کش
            const cacheKey = this._generateCacheKey(route, params, query);
            const cachedPage = this.pageCache.get(cacheKey);
            
            if (cachedPage && this.config.enableCaching) {
                // استفاده از صفحه کش شده
                this.metrics.cacheHits++;
                
                console.log(`[MainLayout] 🔄 Loading from cache: ${route}`);
                
                await this.renderPage({
                    pageId: route,
                    content: cachedPage.content,
                    metadata: cachedPage.metadata
                });
                
                return;
            }
            
            // نمایش loading (اگر فعال باشد)
            if (this.config.loadingIndicator) {
                this._showLoading();
            }
            
            // درخواست صفحه از router
            const pageData = await this.router.resolveRoute(route, params, query);
            
            if (!pageData) {
                throw new Error(`Route not resolved: ${route}`);
            }
            
            // رندر صفحه
            const result = await this.renderPage(pageData);
            
            if (result.success && this.config.enableCaching) {
                // ذخیره در کش
                this.pageCache.set(cacheKey, {
                    content: pageData.content,
                    metadata: pageData.metadata,
                    timestamp: Date.now(),
                    expiresAt: Date.now() + this.config.cacheTTL
                });
                
                // پاک‌سازی کش منقضی شده
                this._cleanupExpiredCache();
            }
            
            // مخفی کردن loading
            if (this.config.loadingIndicator) {
                this._hideLoading();
            }
            
            // انتشار رویداد موفقیت
            this.eventBus.emit('layout:route:changed', {
                route,
                params,
                query,
                loadTime: result.loadTime,
                cached: !!cachedPage
            });
            
        } catch (error) {
            console.error(`[MainLayout] ❌ Route change failed:`, error);
            
            // انتشار رویداد خطا
            this.eventBus.emit('layout:route:error', {
                route,
                params,
                query,
                error: error.message
            });
            
            // نمایش صفحه خطا
            if (this.config.errorBoundary) {
                this._showErrorPage(error, route);
            }
            
            // مخفی کردن loading
            if (this.config.loadingIndicator) {
                this._hideLoading();
            }
        }
    }
    
    handleResize() {
        const width = window.innerWidth;
        const isMobile = width <= parseInt(this.config.layoutStyles.mobileBreakpoint);
        
        // انتشار رویداد تغییر سایز
        this.eventBus.emit('layout:resize', {
            width,
            height: window.innerHeight,
            isMobile,
            previousWidth: this._lastWidth || width
        });
        
        this._lastWidth = width;
        
        // اعمال تغییرات برای موبایل
        if (isMobile) {
            this._adaptForMobile();
        } else {
            this._adaptForDesktop();
        }
    }
    
    // ==================== PRIVATE METHODS ====================
    
    _createBaseStructure() {
        // پاک‌سازی کانتینر
        this.layoutContainer.innerHTML = '';
        
        // ایجاد ساختار پایه
        this.layoutContainer.innerHTML = `
            <!-- Loading Indicator -->
            ${this.config.loadingIndicator ? 
                `<div class="layout-loading-indicator" aria-hidden="true">
                    <div class="loading-spinner"></div>
                    <div class="loading-text">در حال بارگذاری...</div>
                </div>` : ''}
            
            <!-- Error Boundary -->
            ${this.config.errorBoundary ? 
                `<div class="layout-error-boundary" aria-hidden="true"></div>` : ''}
            
            <!-- Layout Structure -->
            <div class="layout-wrapper" data-layout="${this.config.layoutType}">
                ${this.config.showHeader ? 
                    `<header class="layout-header-area" role="banner"></header>` : ''}
                
                <div class="layout-body">
                    ${this.config.showSidebar && this.config.sidebarPosition === 'left' ? 
                        `<aside class="layout-sidebar-area sidebar-left" role="complementary"></aside>` : ''}
                    
                    <main class="layout-content-area" role="main">
                        <div class="content-container" id="content-container"></div>
                    </main>
                    
                    ${this.config.showSidebar && this.config.sidebarPosition === 'right' ? 
                        `<aside class="layout-sidebar-area sidebar-right" role="complementary"></aside>` : ''}
                </div>
                
                ${this.config.showFooter ? 
                    `<footer class="layout-footer-area" role="contentinfo"></footer>` : ''}
            </div>
        `;
        
        // ذخیره ارجاع‌ها به عناصر مهم
        this.contentArea = this.layoutContainer.querySelector('#content-container');
        
        // اعمال استایل‌های پایه
        this._applyBaseStyles();
    }
    
    async _loadLayoutComponents() {
        const loadPromises = [];
        
        // بارگذاری هدر
        if (this.config.showHeader && this.config.componentPaths.header) {
            loadPromises.push(
                this._loadComponent('header', this.config.componentPaths.header)
                    .then(module => {
                        this.components.header = module.createHeader || module.default;
                    })
            );
        }
        
        // بارگذاری فوتر
        if (this.config.showFooter && this.config.componentPaths.footer) {
            loadPromises.push(
                this._loadComponent('footer', this.config.componentPaths.footer)
                    .then(module => {
                        this.components.footer = module.createFooter || module.default;
                    })
            );
        }
        
        // بارگذاری sidebar
        if (this.config.showSidebar && this.config.componentPaths.sidebar) {
            loadPromises.push(
                this._loadComponent('sidebar', this.config.componentPaths.sidebar)
                    .then(module => {
                        this.components.sidebar = module.createSidebar || module.default;
                    })
            );
        }
        
        // اجرای موازی بارگذاری
       
