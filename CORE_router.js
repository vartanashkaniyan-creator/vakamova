
// ==================== CORE_router.js ====================
// سیستم مسیریابی پیشرفته Vakamova - مبتنی بر ۴ اصل معماری
// نسخه: 1.0.0 | تاریخ: ۱۴۰۳/۰۱/۱۵

/**
 * ۴ اصل معماری رعایت شده:
 * ۱. Dependency Injection - تزریق وابستگی‌ها
 * ۲. Interface/Contract - قراردادهای مشخص
 * ۳. Event-Driven - ارتباط رویدادمحور
 * ۴. Centralized Config - پیکربندی متمرکز
 */

// قرارداد ماژول مسیریابی
const ROUTER_CONTRACT = {
    name: 'Vakamova Router',
    version: '1.0.0',
    init: 'function',
    navigateTo: 'function',
    getCurrentRoute: 'function',
    getRouteParams: 'function',
    back: 'function',
    forward: 'function',
    registerGuard: 'function',
    cleanup: 'function'
};

// کلاس اصلی مسیریابی
class VakamovaRouter {
    /**
     * سازنده با تزریق وابستگی‌ها
     * @param {Object} deps - وابستگی‌های تزریق شده
     */
    constructor(deps = {}) {
        // وابستگی‌های ضروری
        this.deps = {
            config: deps.config || window.CONFIG || { router: { mode: 'hash' } },
            eventBus: deps.eventBus || window.EVENT_BUS || this.createEventBus(),
            logger: deps.logger || window.LOGGER || console,
            security: deps.security || window.SECURITY || { checkPermission: () => true },
            validator: deps.validator || window.VALIDATOR || { validate: () => ({ valid: true }) },
            errorHandler: deps.errorHandler || window.ERROR_HANDLER || console.error,
            ...deps
        };

        // وضعیت داخلی
        this.state = {
            currentRoute: null,
            previousRoute: null,
            routes: new Map(),
            guards: new Map(),
            history: [],
            historyIndex: -1,
            isInitialized: false,
            middleware: []
        };

        // پیکربندی
        this.config = {
            mode: this.deps.config.router?.mode || 'hash',
            basePath: this.deps.config.router?.basePath || '',
            fallbackRoute: this.deps.config.router?.fallbackRoute || '/home',
            scrollToTop: this.deps.config.router?.scrollToTop ?? true,
            trackAnalytics: this.deps.config.router?.trackAnalytics ?? true,
            maxHistoryLength: 50
        };

        // bind methods
        this.init = this.init.bind(this);
        this.navigateTo = this.navigateTo.bind(this);
        this.handlePopState = this.handlePopState.bind(this);
        this.handleHashChange = this.handleHashChange.bind(this);
        this.cleanup = this.cleanup.bind(this);

        this.deps.logger?.log('[Router] Instance created');
    }

    // ==================== INITIALIZATION ====================

    /**
     * مقداردهی اولیه مسیریاب
     * @param {Array} routes - آرایه‌ای از مسیرها
     * @returns {Promise<boolean>}
     */
    async init(routes = []) {
        if (this.state.isInitialized) {
            this.deps.logger?.warn('[Router] Already initialized');
            return true;
        }

        try {
            // اعتبارسنجی مسیرها
            const validation = this.deps.validator.validate(routes, {
                type: 'array',
                min: 1,
                items: {
                    type: 'object',
                    required: ['path', 'component'],
                    properties: {
                        path: { type: 'string', pattern: '^/' },
                        component: { type: 'function' },
                        guards: { type: 'array', optional: true },
                        metadata: { type: 'object', optional: true }
                    }
                }
            });

            if (!validation.valid) {
                throw new Error(`Invalid routes: ${validation.errors?.join(', ')}`);
            }

            // ثبت مسیرها
            this.registerRoutes(routes);

            // راه‌اندازی بر اساس mode
            await this.setupRoutingMode();

            // پردازش مسیر اولیه
            await this.processInitialRoute();

            this.state.isInitialized = true;
            this.deps.logger?.log('[Router] Initialized successfully');
            this.deps.eventBus?.emit('router:initialized', {
                timestamp: new Date().toISOString(),
                routeCount: this.state.routes.size
            });

            return true;

        } catch (error) {
            this.deps.errorHandler?.handle(error, {
                module: 'Router',
                operation: 'init',
                severity: 'critical'
            });
            return false;
        }
    }

    /**
     * ثبت مسیرها در سیستم
     * @param {Array} routes
     */
    registerRoutes(routes) {
        routes.forEach(route => {
            // تبدیل مسیرهای پویا به regex
            const { pattern, paramNames } = this.parseRoutePattern(route.path);
            
            this.state.routes.set(route.path, {
                ...route,
                pattern,
                paramNames,
                compiledPath: route.path,
                metadata: route.metadata || {}
            });

            // ثبت route guards
            if (route.guards?.length) {
                this.state.guards.set(route.path, route.guards);
            }

            this.deps.logger?.debug(`[Router] Registered route: ${route.path}`);
        });
    }

    /**
     * راه‌اندازی mode مسیریابی
     */
    async setupRoutingMode() {
        switch (this.config.mode) {
            case 'hash':
                window.addEventListener('hashchange', this.handleHashChange);
                window.addEventListener('popstate', this.handlePopState);
                break;

            case 'history':
                window.addEventListener('popstate', this.handlePopState);
                break;

            default:
                this.deps.logger?.warn(`[Router] Unknown mode: ${this.config.mode}, using hash`);
                this.config.mode = 'hash';
                await this.setupRoutingMode();
        }

        this.deps.logger?.log(`[Router] Mode set to: ${this.config.mode}`);
    }

    /**
     * پردازش مسیر اولیه
     */
    async processInitialRoute() {
        let initialPath = this.config.fallbackRoute;

        if (this.config.mode === 'hash') {
            const hash = window.location.hash.slice(1);
            if (hash && this.isValidRoute(hash)) {
                initialPath = hash;
            }
        } else {
            const path = window.location.pathname.replace(this.config.basePath, '');
            if (path && this.isValidRoute(path)) {
                initialPath = path;
            }
        }

        // ناوبری به مسیر اولیه
        await this.navigateTo(initialPath, {
            replace: true,
            silent: true,
            skipGuards: true
        });
    }

    // ==================== NAVIGATION METHODS ====================

    /**
     * ناوبری به مسیر مشخص
     * @param {string} path - مسیر مقصد
     * @param {Object} options - تنظیمات ناوبری
     * @returns {Promise<boolean>}
     */
    async navigateTo(path, options = {}) {
        const startTime = performance.now();
        
        try {
            // اعتبارسنجی اولیه
            if (!path || typeof path !== 'string') {
                throw new Error('Invalid path provided');
            }

            // نرمال‌سازی مسیر
            const normalizedPath = this.normalizePath(path);
            
            // یافتن مسیر تطبیق‌یافته
            const { matchedRoute, params } = this.matchRoute(normalizedPath);
            
            if (!matchedRoute) {
                if (!options.silent) {
                    this.deps.eventBus?.emit('router:notFound', { path: normalizedPath });
                }
                return await this.handleNotFound(normalizedPath, options);
            }

            // بررسی route guards
            if (!options.skipGuards) {
                const guardResult = await this.executeGuards(matchedRoute, params, options);
                if (!guardResult.allowed) {
                    this.deps.eventBus?.emit('router:guardBlocked', {
                        path: normalizedPath,
                        reason: guardResult.reason
                    });
                    return false;
                }
            }

            // اجرای middlewareها
            const middlewareResult = await this.executeMiddleware(matchedRoute, params, options);
            if (middlewareResult.abort) {
                return false;
            }

            // ثبت در تاریخچه
            this.updateHistory(normalizedPath, options);

            // تغییر URL مرورگر
            this.updateBrowserUrl(normalizedPath, options);

            // به‌روزرسانی وضعیت
            this.updateRouteState(matchedRoute, params, normalizedPath);

            // اجرای انیمیشن‌ها
            if (!options.silent) {
                await this.executeTransitions(matchedRoute, options.transition);
            }

            // اجرای component
            if (matchedRoute.component && !options.silent) {
                await this.renderComponent(matchedRoute, params);
            }

            // تحلیل و رهگیری
            this.trackNavigation(normalizedPath, matchedRoute, startTime);

            this.deps.logger?.log(`[Router] Navigated to: ${normalizedPath}`);
            return true;

        } catch (error) {
            this.deps.errorHandler?.handle(error, {
                module: 'Router',
                operation: 'navigateTo',
                path,
                options
            });
            
            if (!options.silent) {
                this.deps.eventBus?.emit('router:error', {
                    error: error.message,
                    path
                });
            }
            
            return false;
        }
    }

    /**
     * برگشت به مسیر قبلی
     * @param {number} steps - تعداد قدم‌ها به عقب
     * @returns {Promise<boolean>}
     */
    async back(steps = 1) {
        if (this.state.historyIndex - steps < 0) {
            this.deps.logger?.warn('[Router] No more history to go back');
            return false;
        }

        const targetIndex = this.state.historyIndex - steps;
        const targetPath = this.state.history[targetIndex];

        if (!targetPath) {
            return false;
        }

        this.state.historyIndex = targetIndex;
        
        // استفاده از popstate برای حفظ هماهنگی با مرورگر
        if (this.config.mode === 'history') {
            window.history.go(-steps);
        } else {
            await this.navigateTo(targetPath, { replace: true, silent: false });
        }

        return true;
    }

    /**
     * رفتن به مسیر بعدی
     * @param {number} steps - تعداد قدم‌ها به جلو
     * @returns {Promise<boolean>}
     */
    async forward(steps = 1) {
        if (this.state.historyIndex + steps >= this.state.history.length - 1) {
            this.deps.logger?.warn('[Router] No more history to go forward');
            return false;
        }

        const targetIndex = this.state.historyIndex + steps;
        const targetPath = this.state.history[targetIndex];

        if (!targetPath) {
            return false;
        }

        this.state.historyIndex = targetIndex;
        
        if (this.config.mode === 'history') {
            window.history.go(steps);
        } else {
            await this.navigateTo(targetPath, { replace: true, silent: false });
        }

        return true;
    }

    // ==================== ROUTE MATCHING ====================

    /**
     * تطبیق مسیر با الگوهای ثبت شده
     * @param {string} path
     * @returns {Object}
     */
    matchRoute(path) {
        // جستجوی مستقیم
        const exactMatch = this.state.routes.get(path);
        if (exactMatch) {
            return {
                matchedRoute: exactMatch,
                params: {},
                isExact: true
            };
        }

        // جستجوی با pattern matching
        for (const [routePath, route] of this.state.routes.entries()) {
            if (route.pattern) {
                const match = path.match(route.pattern);
                if (match) {
                    const params = {};
                    route.paramNames.forEach((name, index) => {
                        params[name] = match[index + 1];
                    });

                    return {
                        matchedRoute: route,
                        params,
                        isExact: routePath === path
                    };
                }
            }
        }

        return { matchedRoute: null, params: {}, isExact: false };
    }

    /**
     * تبدیل مسیر پویا به regex
     * @param {string} routePath
     * @returns {Object}
     */
    parseRoutePattern(routePath) {
        const paramNames = [];
        let pattern = routePath
            .replace(/\//g, '\\/')
            .replace(/:([\w-]+)/g, (match, paramName) => {
                paramNames.push(paramName);
                return '([^\\/]+)';
            })
            .replace(/\*/g, '.*');

        return {
            pattern: new RegExp(`^${pattern}$`),
            paramNames
        };
    }

    /**
     * بررسی اعتبار مسیر
     * @param {string} path
     * @returns {boolean}
     */
    isValidRoute(path) {
        const normalized = this.normalizePath(path);
        
        // بررسی مستقیم
        if (this.state.routes.has(normalized)) {
            return true;
        }

        // بررسی pattern matching
        for (const route of this.state.routes.values()) {
            if (route.pattern && route.pattern.test(normalized)) {
                return true;
            }
        }

        return false;
    }

    // ==================== GUARDS & MIDDLEWARE ====================

    /**
     * ثبت route guard
     * @param {string} routePath
     * @param {Function} guard
     */
    registerGuard(routePath, guard) {
        if (!this.state.guards.has(routePath)) {
            this.state.guards.set(routePath, []);
        }
        this.state.guards.get(routePath).push(guard);
    }

    /**
     * اجرای route guards
     * @param {Object} route
     * @param {Object} params
     * @param {Object} options
     * @returns {Promise<Object>}
     */
    async executeGuards(route, params, options) {
        const guards = this.state.guards.get(route.path) || [];
        
        for (const guard of guards) {
            try {
                const result = await guard({
                    to: route,
                    params,
                    options,
                    router: this
                });

                if (result === false || (result && result.allowed === false)) {
                    return {
                        allowed: false,
                        reason: result?.reason || 'Guard blocked navigation'
                    };
                }
            } catch (error) {
                this.deps.logger?.error('[Router] Guard error:', error);
                return {
                    allowed: false,
                    reason: 'Guard execution failed'
                };
            }
        }

        return { allowed: true };
    }

    /**
     * ثبت middleware
     * @param {Function} middleware
     */
    registerMiddleware(middleware) {
        this.state.middleware.push(middleware);
    }

    /**
     * اجرای middlewareها
     * @param {Object} route
     * @param {Object} params
     * @param {Object} options
     * @returns {Promise<Object>}
     */
    async executeMiddleware(route, params, options) {
        for (const middleware of this.state.middleware) {
            try {
                const result = await middleware({
                    route,
                    params,
                    options,
                    router: this,
                    next: async () => ({ abort: false })
                });

                if (result?.abort) {
                    return result;
                }
            } catch (error) {
                this.deps.logger?.error('[Router] Middleware error:', error);
                // ادامه بده حتی اگر middleware خطا داد
            }
        }

        return { abort: false };
    }

    // ==================== HISTORY MANAGEMENT ====================

    /**
     * به‌روزرسانی تاریخچه
     * @param {string} path
     * @param {Object} options
     */
    updateHistory(path, options) {
        const historyEntry = {
            path,
            timestamp: new Date().toISOString(),
            params: this.getRouteParams(),
            metadata: options.metadata || {}
        };

        if (options.replace || this.state.currentRoute === null) {
            // جایگزینی مسیر فعلی
            this.state.history[this.state.historyIndex] = historyEntry;
        } else {
            // اضافه کردن به تاریخچه
            this.state.historyIndex++;
            this.state.history.splice(this.state.historyIndex);
            this.state.history.push(historyEntry);

            // محدود کردن طول تاریخچه
            if (this.state.history.length > this.config.maxHistoryLength) {
                this.state.history.shift();
                this.state.historyIndex = Math.max(0, this.state.historyIndex - 1);
            }
        }

        this.deps.eventBus?.emit('router:historyUpdated', {
            history: this.state.history,
            currentIndex: this.state.historyIndex
        });
    }

    // ==================== BROWSER INTEGRATION ====================

    /**
     * به‌روزرسانی URL مرورگر
     * @param {string} path
     * @param {Object} options
     */
    updateBrowserUrl(path, options) {
        const fullPath = this.config.basePath + path;

        try {
            if (this.config.mode === 'hash') {
                const hash = '#' + fullPath;
                if (window.location.hash !== hash) {
                    if (options.replace) {
                        window.location.replace(hash);
                    } else {
                        window.location.hash = hash;
                    }
                }
            } else {
                if (options.replace) {
                    window.history.replaceState({ router: true }, '', fullPath);
                } else {
                    window.history.pushState({ router: true }, '', fullPath);
                }
            }
        } catch (error) {
            this.deps.logger?.warn('[Router] Browser URL update failed:', error);
        }
    }

    /**
     * هندلر تغییر hash
     */
    handleHashChange() {
        const hash = window.location.hash.slice(1);
        const normalized = this.normalizePath(hash || '/');
        
        if (normalized !== this.state.currentRoute?.path) {
            this.navigateTo(normalized, { silent: true }).catch(() => {
                // در صورت خطا به fallback برو
                this.navigateTo(this.config.fallbackRoute, { replace: true });
            });
        }
    }

    /**
     * هندلر popstate
     */
    handlePopState(event) {
        if (event.state?.router) {
            let path;
            
            if (this.config.mode === 'hash') {
                path = window.location.hash.slice(1) || '/';
            } else {
                path = window.location.pathname.replace(this.config.basePath, '') || '/';
            }

            const normalized = this.normalizePath(path);
            if (normalized !== this.state.currentRoute?.path) {
                this.navigateTo(normalized, { silent: true });
            }
        }
    }

    // ==================== RENDER & TRANSITIONS ====================

    /**
     * رندر component مسیر
     * @param {Object} route
     * @param {Object} params
     */
    async renderComponent(route, params) {
        const container = document.getElementById('app-content') || document.body;
        
        if (!container) {
            throw new Error('No container found for rendering');
        }

        try {
            // ایجاد context برای component
            const context = {
                router: this,
                params,
                state: this.deps.state?.getState() || {},
                config: this.deps.config,
                eventBus: this.deps.eventBus
            };

            // اجرای component
            const result = await route.component(context);
            
            if (result && typeof result === 'object') {
                // component جدید
                container.innerHTML = '';
                
                if (result.render && typeof result.render === 'function') {
                    container.appendChild(result.render());
                } else if (result.template) {
                    container.innerHTML = result.template;
                }
                
                // اجرای lifecycle hooks
                if (result.mounted && typeof result.mounted === 'function') {
                    setTimeout(() => result.mounted(context), 0);
                }
            }

        } catch (error) {
            this.deps.errorHandler?.handle(error, {
                module: 'Router',
                operation: 'renderComponent',
                route: route.path
            });
            
            // نمایش خطای رندر
            container.innerHTML = `
                <div class="router-error">
                    <h3>خطا در بارگذاری صفحه</h3>
                    <p>${error.message}</p>
                    <button onclick="window.router.navigateTo('/')">بازگشت به صفحه اصلی</button>
                </div>
            `;
        }
    }

    /**
     * اجرای انیمیشن‌های انتقال
     * @param {Object} route
     * @param {string} transitionName
     */
    async executeTransitions(route, transitionName = 'fade') {
        const container = document.getElementById('app-content');
        if (!container) return;

        const transitions = {
            fade: () => {
                container.style.opacity = '0';
                container.style.transition = 'opacity 0.3s ease';
                setTimeout(() => {
                    container.style.opacity = '1';
                }, 10);
            },
            slide: () => {
                container.style.transform = 'translateX(100px)';
                container.style.opacity = '0';
                container.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
                setTimeout(() => {
                    container.style.transform = 'translateX(0)';
                    container.style.opacity = '1';
                }, 10);
            },
            none: () => {}
        };

        const transition = transitions[transitionName] || transitions.fade;
        transition();
    }

    // ==================== UTILITY METHODS ====================

    /**
     * نرمال‌سازی مسیر
     * @param {string} path
     * @returns {string}
     */
    normalizePath(path) {
        if (!path.startsWith('/')) {
            path = '/' + path;
        }
        
        // حذف slash اضافی در انتها
        if (path.length > 1 && path.endsWith('/')) {
            path = path.slice(0, -1);
        }
        
        return path;
    }

    /**
     * دریافت پارامترهای مسیر فعلی
     * @returns {Object}
     */
    getRouteParams() {
        return this.state.currentRoute?.params || {};
    }

    /**
     * دریافت مسیر فعلی
     * @returns {Object|null}
     */
    getCurrentRoute() {
        return this.state.currentRoute;
    }

    /**
     * دریافت کل تاریخچه
     * @returns {Array}
     */
    getHistory() {
        return [...this.state.history];
    }

    /**
     * به‌روزرسانی وضعیت مسیر
     * @param {Object} route
     * @param {Object} params
     * @param {string} path
     */
    updateRouteState(route, params, path) {
        this.state.previousRoute = this.state.currentRoute;
        this.state.currentRoute = {
            ...route,
            params,
            path,
            timestamp: new Date().toISOString()
        };

        this.deps.eventBus?.emit('router:changed', {
            previous: this.state.previousRoute,
            current: this.state.currentRoute,
            params
        });
    }

    // ==================== ANALYTICS & TRACKING ====================

    /**
     * رهگیری ناوبری برای تحلیل
     * @param {string} path
     * @param {Object} route
     * @param {number} startTime
     */
    trackNavigation(path, route, startTime) {
        if (this.config.trackAnalytics) {
            const duration = performance.now() - startTime;
            
            this.deps.eventBus?.emit('router:navigationTracked', {
                path,
                route: route.path,
                duration,
                timestamp: new Date().toISOString(),
                mode: this.config.mode
            });

            // ارسال به Google Analytics (اگر موجود باشد)
            if (typeof gtag === 'function') {
                gtag('event', 'page_view', {
                    page_path: path,
                    page_title: route.metadata?.title || path
                });
            }
        }
    }

    // ==================== ERROR HANDLING ====================

    /**
     * هندل کردن مسیر پیدا نشده
     * @param {string} path
     * @param {Object} options
     */
    async handleNotFound(path, options) {
        this.deps.logger?.warn(`[Router] Route not found: ${path}`);
        
        if (!options.silent) {
            this.deps.eventBus?.emit('router:notFound', { path });
            
            // نمایش صفحه ۴۰۴
            const notFoundRoute = this.state.routes.get('/404') || {
                component: () => ({
                    template: `
                        <div class="not-found">
                            <h1>صفحه پیدا نشد</h1>
                            <p>مسیر "${path}" وجود ندارد</p>
                            <button onclick="window.router.navigateTo('/')">بازگشت به خانه</button>
                        </div>
                    `
                })
            };
            
            await this.renderComponent(notFoundRoute, {});
        }
        
        return false;
    }

    // ==================== FALLBACK EVENT BUS ====================

    /**
     * ایجاد event bus جایگزین
     * @returns {Object}
     */
    createEventBus() {
        const events = new Map();
        
        return {
            emit(event, data) {
                const handlers = events.get(event) || [];
                handlers.forEach(handler => {
                    try {
                        handler(data);
                    } catch (error) {
                        console.error(`Event handler error for ${event}:`, error);
                    }
                });
            },
            on(event, handler) {
                if (!events.has(event)) {
                    events.set(event, []);
                }
                events.get(event).push(handler);
                
                // بازگرداندن تابع unsubscribe
                return () => {
                    const handlers = events.get(event) || [];
                    const index = handlers.indexOf(handler);
                    if (index > -1) {
                        handlers.splice(index, 1);
                    }
                };
            }
        };
    }

    // ==================== CLEANUP ====================

    /**
     * پاک‌سازی منابع
     */
    cleanup() {
        window.removeEventListener('hashchange', this.handleHashChange);
        window.removeEventListener('popstate', this.handlePopState);
        
        this.state.routes.clear();
        this.state.guards.clear();
        this.state.history = [];
        this.state.middleware = [];
        this.state.isInitialized = false;
        
        this.deps.logger?.log('[Router] Cleaned up');
        this.deps.eventBus?.emit('router:cleanedUp');
    }
}

// ==================== EXPORT & GLOBAL REGISTRATION ====================

// ایجاد instance پیش‌فرض
const routerInstance = new VakamovaRouter();

// Export برای سیستم ماژولار
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        VakamovaRouter,
        router: routerInstance,
        CONTRACT: ROUTER_CONTRACT
    };
}

// ثبت در محیط جهانی
if (typeof window !== 'undefined') {
    window.VakamovaRouter = VakamovaRouter;
    window.router = routerInstance;
    
    // auto-init در صورت وجود routes
    document.addEventListener('DOMContentLoaded', () => {
        if (window.APP_ROUTES) {
            routerInstance.init(window.APP_ROUTES).catch(console.error);
        }
    });
}

console.log('[Router] CORE_router.js loaded successfully');
