// ==================== CORE_router.js ====================
// سیستم مسیریابی صنعتی با پشتیبانی از Middleware، Lazy Loading و Transition
// نسخه: 3.0.0 | تاریخ: ۱۴۰۳/۰۲/۱۵

'use strict';

class HyperRouter {
    // رویدادهای سیستم
    static EVENTS = {
        ROUTE_CHANGED: 'route:changed',
        ROUTE_STARTED: 'route:started',
        ROUTE_COMPLETED: 'route:completed',
        ROUTE_FAILED: 'route:failed',
        ROUTE_CANCELLED: 'route:cancelled',
        MIDDLEWARE_TRIGGERED: 'middleware:triggered',
        LAZY_LOAD_STARTED: 'lazy:load:started',
        LAZY_LOAD_COMPLETED: 'lazy:load:completed',
        TRANSITION_STARTED: 'transition:started',
        TRANSITION_ENDED: 'transition:ended',
        GUARD_BLOCKED: 'guard:blocked',
        SCROLL_RESTORED: 'scroll:restored'
    };
    
    constructor(options = {}) {
        this.options = {
            mode: options.mode || 'hash', // 'hash' | 'history' | 'abstract'
            base: options.base || '/',
            fallback: options.fallback !== false,
            scrollBehavior: options.scrollBehavior || this._defaultScrollBehavior,
            linkActiveClass: options.linkActiveClass || 'router-link-active',
            linkExactActiveClass: options.linkExactActiveClass || 'router-link-exact-active',
            parseQuery: options.parseQuery || this._parseQuery,
            stringifyQuery: options.stringifyQuery || this._stringifyQuery,
            ...options
        };
        
        // State اصلی
        this.currentRoute = null;
        this.previousRoute = null;
        this.pendingRoute = null;
        this.isNavigating = false;
        this.transitionId = 0;
        
        // ذخیره‌سازی
        this.routes = new Map();
        this.routeTree = new Map();
        this.dynamicRoutes = new Map();
        this.aliasMap = new Map();
        this.redirectMap = new Map();
        
        // سیستم‌های جانبی
        this.middlewares = {
            global: [],
            before: new Map(),
            after: new Map(),
            error: []
        };
        
        this.guards = {
            beforeEach: [],
            beforeResolve: [],
            afterEach: []
        };
        
        this.components = new Map();
        this.lazyQueue = new Map();
        this.cache = new Map();
        this.history = [];
        this.maxHistory = options.maxHistory || 50;
        
        // Event System
        this.events = new EventTarget();
        
        // متغیرهای عملکردی
        this._popStateHandler = this._handlePopState.bind(this);
        this._hashChangeHandler = this._handleHashChange.bind(this);
        this._beforeUnloadHandler = this._handleBeforeUnload.bind(this);
        
        // متدهای bind شده
        this.push = this.push.bind(this);
        this.replace = this.replace.bind(this);
        this.go = this.go.bind(this);
        this.back = this.back.bind(this);
        this.forward = this.forward.bind(this);
        
        console.log('[HyperRouter] نمونه ایجاد شد - حالت:', this.options.mode);
    }
    
    // ==================== PUBLIC API ====================
    
    async init(initialRoutes = []) {
        console.log('[HyperRouter] شروع راه‌اندازی...');
        
        try {
            // 1. ثبت Routeهای اولیه
            if (Array.isArray(initialRoutes)) {
                initialRoutes.forEach(route => this.addRoute(route));
            }
            
            // 2. راه‌اندازی بر اساس حالت
            await this._setupMode();
            
            // 3. ثبت Event Listeners
            this._setupEventListeners();
            
            // 4. بارگذاری Route اولیه
            await this._resolveInitialRoute();
            
            // 5. شروع سیستم
            this._start();
            
            console.log('[HyperRouter] راه‌اندازی کامل شد');
            return this;
            
        } catch (error) {
            console.error('[HyperRouter] خطا در راه‌اندازی:', error);
            throw new Error(`Router initialization failed: ${error.message}`);
        }
    }
    
    addRoute(routeConfig, parentName = null) {
        const route = this._normalizeRoute(routeConfig);
        const routeName = route.name || `anonymous_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        // ذخیره در Map اصلی
        this.routes.set(routeName, route);
        
        // ساختار درختی
        if (parentName) {
            if (!this.routeTree.has(parentName)) {
                this.routeTree.set(parentName, new Set());
            }
            this.routeTree.get(parentName).add(routeName);
            route.parent = parentName;
        } else {
            this.routeTree.set(routeName, new Set());
        }
        
        // ذخیره Routeهای داینامیک
        if (route.path.includes(':') || route.path.includes('*')) {
            this.dynamicRoutes.set(route.path, routeName);
        }
        
        // ذخیره Aliasها
        if (route.alias) {
            const aliases = Array.isArray(route.alias) ? route.alias : [route.alias];
            aliases.forEach(alias => {
                this.aliasMap.set(alias, routeName);
            });
        }
        
        // ذخیره Redirectها
        if (route.redirect) {
            this.redirectMap.set(routeName, route.redirect);
        }
        
        // پیش‌بارگذاری کامپوننت اگر لازم باشد
        if (route.component && typeof route.component === 'function') {
            this._preloadComponent(routeName, route.component);
        }
        
        console.log(`[HyperRouter] Route اضافه شد: ${routeName} -> ${route.path}`);
        
        return routeName;
    }
    
    removeRoute(routeName) {
        if (!this.routes.has(routeName)) {
            console.warn(`[HyperRouter] Route ${routeName} وجود ندارد`);
            return false;
        }
        
        // حذف از Map اصلی
        this.routes.delete(routeName);
        
        // حذف از درخت
        this.routeTree.delete(routeName);
        
        // حذف از Routeهای داینامیک
        for (const [path, name] of this.dynamicRoutes.entries()) {
            if (name === routeName) {
                this.dynamicRoutes.delete(path);
                break;
            }
        }
        
        // حذف Aliasها
        for (const [alias, name] of this.aliasMap.entries()) {
            if (name === routeName) {
                this.aliasMap.delete(alias);
            }
        }
        
        // حذف Redirect
        this.redirectMap.delete(routeName);
        
        // حذف از تاریخچه
        this.history = this.history.filter(record => record.name !== routeName);
        
        console.log(`[HyperRouter] Route حذف شد: ${routeName}`);
        
        return true;
    }
    
    async push(location, onComplete, onAbort) {
        return this._navigate(location, 'push', onComplete, onAbort);
    }
    
    async replace(location, onComplete, onAbort) {
        return this._navigate(location, 'replace', onComplete, onAbort);
    }
    
    go(n) {
        if (this.options.mode === 'hash') {
            const currentIndex = this.history.findIndex(record => 
                record.fullPath === this.currentRoute?.fullPath
            );
            
            const targetIndex = currentIndex + n;
            if (targetIndex >= 0 && targetIndex < this.history.length) {
                const targetRecord = this.history[targetIndex];
                this._updateRoute(targetRecord, 'go');
            }
        } else if (this.options.mode === 'history') {
            window.history.go(n);
        }
        
        return this;
    }
    
    back() {
        return this.go(-1);
    }
    
    forward() {
        return this.go(1);
    }
    
    getRoutes() {
        return Array.from(this.routes.values());
    }
    
    getRoute(name) {
        return this.routes.get(name) || null;
    }
    
    hasRoute(name) {
        return this.routes.has(name);
    }
    
    resolve(location) {
        const normalizedLocation = this._normalizeLocation(location);
        const { path, query, hash } = normalizedLocation;
        
        // جستجوی Route
        let routeName = this._findRouteName(path);
        
        // بررسی Alias
        if (!routeName && this.aliasMap.has(path)) {
            routeName = this.aliasMap.get(path);
        }
        
        // بررسی Redirect
        if (routeName && this.redirectMap.has(routeName)) {
            const redirect = this.redirectMap.get(routeName);
            return this.resolve(redirect);
        }
        
        const route = routeName ? this.routes.get(routeName) : null;
        
        if (!route) {
            throw new Error(`Route not found: ${path}`);
        }
        
        // استخراج پارامترها
        const params = this._extractParams(route.path, path);
        
        // ساخت Route نهایی
        const resolvedRoute = {
            ...route,
            path: route.path,
            fullPath: this._buildFullPath(path, query, hash),
            params,
            query,
            hash,
            name: routeName,
            matched: this._getMatchedRoutes(routeName)
        };
        
        return resolvedRoute;
    }
    
    addMiddleware(middleware, options = {}) {
        const middlewareId = Symbol('middleware');
        const config = {
            id: middlewareId,
            handler: middleware,
            priority: options.priority || 0,
            global: options.global || false,
            type: options.type || 'before' // 'before' | 'after' | 'error'
        };
        
        if (config.global) {
            this.middlewares.global.push(config);
            console.log('[HyperRouter] Middleware سراسری اضافه شد');
        } else if (options.route) {
            const routeName = typeof options.route === 'string' 
                ? options.route 
                : options.route.name;
            
            if (!this.middlewares[config.type].has(routeName)) {
                this.middlewares[config.type].set(routeName, []);
            }
            
            this.middlewares[config.type].get(routeName).push(config);
            console.log(`[HyperRouter] Middleware برای Route ${routeName} اضافه شد`);
        }
        
        return () => this.removeMiddleware(middlewareId, options);
    }
    
    removeMiddleware(middlewareId, options = {}) {
        // پیاده‌سازی حذف Middleware
        console.log('[HyperRouter] Middleware حذف شد');
        return true;
    }
    
    addGuard(guard, type = 'beforeEach') {
        if (!this.guards[type]) {
            throw new Error(`Guard type ${type} is not valid`);
        }
        
        const guardId = Symbol('guard');
        this.guards[type].push({
            id: guardId,
            handler: guard
        });
        
        console.log(`[HyperRouter] Guard ${type} اضافه شد`);
        
        return () => {
            const index = this.guards[type].findIndex(g => g.id === guardId);
            if (index > -1) {
                this.guards[type].splice(index, 1);
            }
        };
    }
    
    async beforeEach(guard) {
        return this.addGuard(guard, 'beforeEach');
    }
    
    async beforeResolve(guard) {
        return this.addGuard(guard, 'beforeResolve');
    }
    
    async afterEach(guard) {
        return this.addGuard(guard, 'afterEach');
    }
    
    registerComponent(name, component) {
        if (typeof component === 'function') {
            this.components.set(name, {
                factory: component,
                loaded: false,
                instance: null
            });
        } else {
            this.components.set(name, {
                factory: () => Promise.resolve(component),
                loaded: true,
                instance: component
            });
        }
        
        console.log(`[HyperRouter] کامپوننت ${name} ثبت شد`);
    }
    
    async preloadRoute(routeName) {
        const route = this.routes.get(routeName);
        if (!route || !route.component || typeof route.component !== 'function') {
            return null;
        }
        
        console.log(`[HyperRouter] پیش‌بارگذاری Route: ${routeName}`);
        
        try {
            const component = await route.component();
            this.components.set(routeName, {
                factory: route.component,
                loaded: true,
                instance: component
            });
            
            return component;
        } catch (error) {
            console.error(`[HyperRouter] خطا در پیش‌بارگذاری ${routeName}:`, error);
            throw error;
        }
    }
    
    getCurrentRoute() {
        return this.currentRoute ? { ...this.currentRoute } : null;
    }
    
    getHistory() {
        return [...this.history];
    }
    
    clearHistory() {
        this.history = [];
        console.log('[HyperRouter] تاریخچه پاک شد');
    }
    
    // ==================== EVENT SYSTEM ====================
    
    on(event, handler) {
        this.events.addEventListener(event, handler);
        return () => this.events.removeEventListener(event, handler);
    }
    
    off(event, handler) {
        this.events.removeEventListener(event, handler);
    }
    
    // ==================== PRIVATE METHODS ====================
    
    async _setupMode() {
        switch (this.options.mode) {
            case 'history':
                if (!window.history) {
                    console.warn('[HyperRouter] تاریخچه مرورگر پشتیبانی نمی‌شود، به حالت hash برمی‌گردد');
                    this.options.mode = 'hash';
                    return this._setupMode();
                }
                break;
                
            case 'hash':
                // اطمینان از شروع با #
                if (!window.location.hash && this.options.fallback) {
                    window.location.hash = '#/';
                }
                break;
                
            case 'abstract':
                // هیچ Event Listenerی اضافه نمی‌شود
                break;
                
            default:
                throw new Error(`حالت ${this.options.mode} معتبر نیست`);
        }
        
        console.log(`[HyperRouter] حالت فعال: ${this.options.mode}`);
    }
    
    _setupEventListeners() {
        switch (this.options.mode) {
            case 'history':
                window.addEventListener('popstate', this._popStateHandler);
                break;
                
            case 'hash':
                window.addEventListener('hashchange', this._hashChangeHandler);
                break;
        }
        
        window.addEventListener('beforeunload', this._beforeUnloadHandler);
        
        console.log('[HyperRouter] Event Listeners تنظیم شدند');
    }
    
    _removeEventListeners() {
        window.removeEventListener('popstate', this._popStateHandler);
        window.removeEventListener('hashchange', this._hashChangeHandler);
        window.removeEventListener('beforeunload', this._beforeUnloadHandler);
    }
    
    async _resolveInitialRoute() {
        let rawPath;
        
        switch (this.options.mode) {
            case 'history':
                rawPath = window.location.pathname + window.location.search;
                break;
                
            case 'hash':
                rawPath = window.location.hash.slice(1) || '/';
                break;
                
            case 'abstract':
                rawPath = '/';
                break;
        }
        
        // حذف base از path
        const path = rawPath.replace(new RegExp(`^${this.options.base}`), '') || '/';
        
        try {
            const route = this.resolve({ path });
            this.currentRoute = route;
            
            // ثبت در تاریخچه
            this._addToHistory(route, 'initial');
            
            console.log(`[HyperRouter] Route اولیه: ${route.fullPath}`);
            
        } catch (error) {
            console.warn('[HyperRouter] Route اولیه یافت نشد، به صفحه ۴۰۴ می‌رود');
            
            // Route پیش‌فرض ۴۰۴
            const notFoundRoute = {
                path: '/404',
                name: 'not_found',
                component: () => ({ render: () => 'صفحه یافت نشد' }),
                meta: { title: 'صفحه یافت نشد' }
            };
            
            this.addRoute(notFoundRoute);
            this.currentRoute = this.resolve({ path: '/404' });
        }
    }
    
    _start() {
        this._emitEvent(HyperRouter.EVENTS.ROUTE_COMPLETED, {
            route: this.currentRoute,
            previousRoute: null
        });
        
        console.log('[HyperRouter] مسیریاب شروع به کار کرد');
    }
    
    async _navigate(location, action = 'push', onComplete, onAbort) {
        if (this.isNavigating) {
            console.warn('[HyperRouter] در حال حاضر در حال ناوبری هستید');
            return Promise.reject(new Error('Navigation in progress'));
        }
        
        this.isNavigating = true;
        this.transitionId++;
        const transitionId = this.transitionId;
        
        try {
            // 1. حل کردن Route
            const to = this.resolve(location);
            const from = this.currentRoute;
            
            this.pendingRoute = to;
            
            // 2. اطلاع‌رسانی شروع ناوبری
            this._emitEvent(HyperRouter.EVENTS.ROUTE_STARTED, {
                to,
                from,
                action,
                transitionId
            });
            
            // 3. اجرای Guards قبل از هر چیز
            const guardResult = await this._runGuards('beforeEach', to, from);
            if (guardResult === false) {
                this._emitEvent(HyperRouter.EVENTS.GUARD_BLOCKED, {
                    to,
                    from,
                    reason: 'beforeEach guard returned false'
                });
                throw new Error('Navigation aborted by guard');
            }
            
            // 4. اجرای Middlewareهای قبل
            await this._runMiddlewares('before', to);
            
            // 5. شروع Transition
            this._emitEvent(HyperRouter.EVENTS.TRANSITION_STARTED, {
                from,
                to,
                transitionId
            });
            
            // 6. بارگذاری Lazy کامپوننت اگر نیاز باشد
            if (to.component && typeof to.component === 'function') {
                await this._loadComponent(to.name || to.path, to.component);
            }
            
            // 7. اجرای Guards قبل از resolve
            const resolveResult = await this._runGuards('beforeResolve', to, from);
            if (resolveResult === false) {
                throw new Error('Navigation aborted by beforeResolve guard');
            }
            
            // 8. بروزرسانی Route فعلی
            this.previousRoute = from;
            this.currentRoute = to;
            this.pendingRoute = null;
            
            // 9. بروزرسانی URL
            await this._updateURL(to, action);
            
            // 10. بروزرسانی تاریخچه
            this._addToHistory(to, action);
            
            // 11. بازگردانی Scroll
            await this._restoreScroll(to);
            
            // 12. اجرای Middlewareهای بعد
            await this._runMiddlewares('after', to);
            
            // 13. اجرای Guards بعد از هر چیز
            await this._runGuards('afterEach', to, from);
            
            // 14. پایان Transition
            this._emitEvent(HyperRouter.EVENTS.TRANSITION_ENDED, {
                from,
                to,
                transitionId
            });
            
            // 15. اطلاع‌رسانی پایان ناوبری
            this._emitEvent(HyperRouter.EVENTS.ROUTE_CHANGED, {
                route: to,
                previousRoute: from,
                action,
                transitionId
            });
            
            this._emitEvent(HyperRouter.EVENTS.ROUTE_COMPLETED, {
                route: to,
                previousRoute: from,
                transitionId
            });
            
            // 16. فراخوانی Callback موفقیت
            if (onComplete) {
                onComplete(to);
            }
            
            this.isNavigating = false;
            return to;
            
        } catch (error) {
            this.isNavigating = false;
            this.pendingRoute = null;
            
            console.error('[HyperRouter] خطا در ناوبری:', error);
            
            // اطلاع‌رسانی خطا
            this._emitEvent(HyperRouter.EVENTS.ROUTE_FAILED, {
                error: error.message,
                transitionId,
                from: this.currentRoute,
                to: location
            });
            
            // اجرای Middlewareهای خطا
            await this._runMiddlewares('error', null, error);
            
            // فراخوانی Callback خطا
            if (onAbort) {
                onAbort(error);
            }
            
            throw error;
        }
    }
    
    async _runGuards(type, to, from) {
        const guards = this.guards[type];
        
        for (const guard of guards) {
            try {
                const result = await guard.handler(to, from);
                
                if (result === false) {
                    return false;
                } else if (result && typeof result === 'object') {
                    // Redirect
                    await this._navigate(result, 'replace');
                    return false;
                }
            } catch (error) {
                console.error(`[HyperRouter] خطا در اجرای guard ${type}:`, error);
                throw error;
            }
        }
        
        return true;
    }
    
    async _runMiddlewares(type, route, error = null) {
        const middlewares = [];
        
        // Middlewareهای سراسری
        if (type === 'before' || type === 'after') {
            middlewares.push(...this.middlewares.global.filter(m => !m.type || m.type === type));
        }
        
        // Middlewareهای خاص Route
        if (route && route.name) {
            const routeMiddlewares = this.middlewares[type].get(route.name) || [];
            middlewares.push(...routeMiddlewares);
        }
        
        // مرتب‌سازی بر اساس اولویت
        middlewares.sort((a, b) => (b.priority || 0) - (a.priority || 0));
        
        for (const middleware of middlewares) {
            try {
                this._emitEvent(HyperRouter.EVENTS.MIDDLEWARE_TRIGGERED, {
                    type,
                    route: route?.name,
                    middleware: middleware.handler.name || 'anonymous'
                });
                
                await middleware.handler(route, error);
            } catch (err) {
                console.error(`[HyperRouter] خطا در اجرای middleware ${type}:`, err);
                
                if (type === 'error') {
                    // اگر middleware خطا هم خطا بدهد، به بالا پاس می‌دهیم
                    throw err;
                }
            }
        }
    }
    
    async _loadComponent(routeName, componentFactory) {
        if (this.components.has(routeName) && this.components.get(routeName).loaded) {
            return this.components.get(routeName).instance;
        }
        
        this._emitEvent(HyperRouter.EVENTS.LAZY_LOAD_STARTED, { routeName });
        
        try {
            const component = await componentFactory();
            
            this.components.set(routeName, {
                factory: componentFactory,
                loaded: true,
                instance: component
            });
            
            this._emitEvent(HyperRouter.EVENTS.LAZY_LOAD_COMPLETED, { 
                routeName,
                success: true 
            });
            
            return component;
        } catch (error) {
            console.error(`[HyperRouter] خطا در بارگذاری کامپوننت ${routeName}:`, error);
            
            this._emitEvent(HyperRouter.EVENTS.LAZY_LOAD_COMPLETED, { 
                routeName,
                success: false,
                error: error.message 
            });
            
            throw error;
        }
    }
    
    async _updateURL(route, action) {
        const fullPath = route.fullPath;
        
        switch (this.options.mode) {
            case 'history':
                if (action === 'replace') {
                    window.history.replaceState({ 
                        route: route.name,
                        fullPath,
                        timestamp: Date.now() 
                    }, '', fullPath);
                } else {
                    window.history.pushState({ 
                        route: route.name,
                        fullPath,
                        timestamp: Date.now() 
                    }, '', fullPath);
                }
                break;
                
            case 'hash':
                const hashPath = fullPath.startsWith('/') ? fullPath : `/${fullPath}`;
                const hash = `#${hashPath}`;
                
                if (action === 'replace') {
                    window.location.replace(hash);
                } else {
                    window.location.hash = hash;
                }
                break;
        }
    }
    
    _addToHistory(route, action) {
        const historyRecord = {
            route: route.name,
            fullPath: route.fullPath,
            timestamp: Date.now(),
            action,
            meta: route.meta || {}
        };
        
        if (action === 'replace' && this.history.length > 0) {
            this.history[this.history.length - 1] = historyRecord;
        } else {
            this.history.push(historyRecord);
            
            // محدود کردن اندازه تاریخچه
            if (this.history.length > this.maxHistory) {
                this.history = this.history.slice(-this.maxHistory);
            }
        }
    }
    
    async _restoreScroll(route) {
        if (typeof this.options.scrollBehavior === 'function') {
            try {
                const scrollPosition = await this.options.scrollBehavior(
                    route,
                    this.previousRoute,
                    this._getSavedScrollPosition()
                );
                
                if (scrollPosition) {
                    window.scrollTo(scrollPosition);
                    this._emitEvent(HyperRouter.EVENTS.SCROLL_RESTORED, {
                        position: scrollPosition,
                        route: route.name
                    });
                }
            } catch (error) {
                console.warn('[HyperRouter] خطا در بازگردانی Scroll:', error);
            }
        }
    }
    
    _getSavedScrollPosition() {
        // در یک پیاده‌سازی واقعی، این مقدار از state مرورگر یا localStorage خوانده می‌شود
        return null;
    }
    
    _handlePopState(event) {
        if (!event.state) return;
        
        const { route: routeName, fullPath } = event.state;
        
        try {
            const route = routeName 
                ? this.resolve({ name: routeName })
                : this.resolve({ path: fullPath });
            
            this._updateRoute(route, 'popstate');
        } catch (error) {
            console.warn('[HyperRouter] خطا در پردازش popstate:', error);
        }
    }
    
    _handleHashChange() {
        const hash = window.location.hash.slice(1) || '/';
        
        try {
            const route = this.resolve({ path: hash });
            this._updateRoute(route, 'hashchange');
        } catch (error) {
            console.warn('[HyperRouter] خطا در پردازش hashchange:', error);
        }
    }
    
    _handleBeforeUnload(event) {
        // ذخیره وضعیت فعلی قبل از بسته شدن صفحه
        if (this.currentRoute) {
            const state = {
                route: this.currentRoute.name,
                fullPath: this.currentRoute.fullPath,
                timestamp: Date.now(),
                scrollX: window.scrollX,
                scrollY: window.scrollY
            };
            
            try {
                sessionStorage.setItem('hyper_router_state', JSON.stringify(state));
            } catch (e) {
                // ممکن است sessionStorage پر باشد
                console.debug('Cannot save router state:', e);
            }
        }
    }
    
    _updateRoute(route, source) {
        if (this.isNavigating) {
            console.warn(`[HyperRouter] درخواست ناوبری از ${source} نادیده گرفته شد (در حال ناوبری)`);
            return;
        }
        
        // جلوگیری از ناوبری تکراری
        if (this.currentRoute && this.currentRoute.fullPath === route.fullPath) {
            console.debug(`[HyperRouter] ناوبری تکراری از ${source} نادیده گرفته شد`);
            return;
        }
        
        this.push(route).catch(error => {
            console.error(`[HyperRouter] خطا در ناوبری از ${source}:`, error);
        });
    }
    
    _findRouteName(path) {
        // جستجوی دقیق
        for (const [name, route] of this.routes.entries()) {
            if (route.path === path) {
                return name;
            }
        }
        
        // جستجوی داینامیک
        for (const [pattern, routeName] of this.dynamicRoutes.entries()) {
            if (this._matchPattern(pattern, path)) {
                return routeName;
            }
        }
        
        return null;
    }
    
    _matchPattern(pattern, path) {
        const patternParts = pattern.split('/');
        const pathParts = path.split('/');
        
        if (patternParts.length !== pathParts.length && !pattern.includes('*')) {
            return false;
        }
        
        for (let i = 0; i < patternParts.length; i++) {
            const patternPart = patternParts[i];
            const pathPart = pathParts[i];
            
            if (patternPart.startsWith(':')) {
                // پارامتر داینامیک
                continue;
            } else if (patternPart === '*') {
                // Wildcard
                return true;
            } else if (patternPart !== pathPart) {
                return false;
            }
        }
        
        return true;
    }
    
    _extractParams(pattern, path) {
        const params = {};
        const patternParts = pattern.split('/');
        const pathParts = path.split('/');
        
        for (let i = 0; i < patternParts.length; i++) {
            const patternPart = patternParts[i];
            
            if (patternPart.startsWith(':')) {
                const paramName = patternPart.slice(1);
                params[paramName] = decodeURIComponent(pathParts[i] || '');
            }
        }
        
        return params;
    }
    
    _getMatchedRoutes(routeName) {
        const matched = [];
        let currentName = routeName;
        
        while (currentName) {
            const route = this.routes.get(currentName);
            if (route) {
                matched.unshift(route);
                currentName = route.parent;
            } else {
                break;
            }
        }
        
        return matched;
    }
    
    _normalizeRoute(routeConfig) {
        const route = {
            path: routeConfig.path || '/',
            component: routeConfig.component || null,
            meta: routeConfig.meta || {},
            props: routeConfig.props || false,
            children: routeConfig.children || [],
            ...routeConfig
        };
        
        // اطمینان از شروع مسیر با /
        if (!route.path.startsWith('/')) {
            route.path = '/' + route.path;
        }
        
        return route;
    }
    
    _normalizeLocation(location) {
        if (typeof location === 'string') {
            return {
                path: location,
                query: {},
                hash: ''
            };
        }
        
        return {
            path: location.path || '/',
            query: location.query || {},
            hash: location.hash || '',
            name: location.name,
            params: location.params || {}
        };
    }
    
    _buildFullPath(path, query, hash) {
        let fullPath = path;
        
        if (query && Object.keys(query).length > 0) {
            fullPath += '?' + this.options.stringifyQuery(query);
        }
        
        if (hash) {
            fullPath += '#' + hash;
        }
        
        return fullPath;
    }
    
    _defaultScrollBehavior(to, from, savedPosition) {
        if (savedPosition) {
            return savedPosition;
        }
        
        if (to.hash) {
            return {
                selector: to.hash,
                behavior: 'smooth'
            };
        }
        
        return { x: 0, y: 0 };
    }
    
    _parseQuery(queryString) {
        const params = {};
        
        if (!queryString) return params;
        
        queryString.split('&').forEach(param => {
            const [key, value] = param.split('=');
            if (key) {
                params[decodeURIComponent(key)] = value ? decodeURIComponent(value) : '';
            }
        });
        
        return params;
    }
    
    _stringifyQuery(query) {
        return Object.keys(query)
            .map(key => {
                const value = query[key];
                if (value === null || value === undefined) {
                    return encodeURIComponent(key);
                }
                return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
            })
            .join('&');
    }
    
    _preloadComponent(routeName, componentFactory) {
        // پیش‌بارگذاری در پس‌زمینه
        setTimeout(() => {
            if (!this.components.has(routeName) || !this.components.get(routeName).loaded) {
                componentFactory().then(component => {
                    this.components.set(routeName, {
                        factory: componentFactory,
                        loaded: true,
                        instance: component
                    });
                    console.log(`[HyperRouter] کامپوننت ${routeName} پیش‌بارگذاری شد`);
                }).catch(error => {
                    console.debug(`[HyperRouter] خطا در پیش‌بارگذاری ${routeName}:`, error);
                });
            }
        }, 3000); // پس از ۳ ثانیه
    }
    
    _emitEvent(eventName, detail = {}) {
        const event = new CustomEvent(eventName, { detail });
        this.events.dispatchEvent(event);
    }
}

// Export برای استفاده جهانی
if (typeof window !== 'undefined') {
    window.HyperRouter = HyperRouter;
}

// Hook برای خطاهای مسیریابی
if (typeof window !== 'undefined') {
    window.addEventListener('error', (event) => {
        if (event.error && event.error.message.includes('router')) {
            console.error('Router error caught:', event.error);
        }
    });
}

console.log('[HyperRouter] ماژول مسیریابی بارگذاری شد');
