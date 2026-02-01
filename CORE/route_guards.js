/**
 * VAKAMOVA ROUTE GUARDS - سیستم محافظت از مسیرهای پیشرفته
 * اصول: تزریق وابستگی، قرارداد رابط، رویدادمحور، پیکربندی متمرکز
 * وابستگی‌های داخلی: event_bus.js, auth_middleware.js, config.js
 */

class VakamovaRouteGuard {
    constructor(dependencies = {}) {
        // ==================== DEPENDENCY INJECTION ====================
        this._eventBus = dependencies.eventBus || {
            on: () => () => {},
            emit: () => {},
            off: () => {}
        };
        
        this._authMiddleware = dependencies.authMiddleware || {
            isAuthenticated: () => false,
            getUserRole: () => 'guest',
            getPermissions: () => []
        };
        
        this._config = dependencies.config || {
            get: () => null,
            subscribe: () => () => {}
        };
        
        this._router = dependencies.router || {
            navigateTo: () => {},
            getCurrentRoute: () => ({ path: '/', params: {} }),
            addMiddleware: () => {}
        };
        
        // ==================== INTERFACE CONTRACT ====================
        this.GUARD_TYPES = Object.freeze({
            AUTH: 'authentication',
            ROLE: 'role_based',
            PERMISSION: 'permission_based',
            FEATURE_FLAG: 'feature_flag',
            CUSTOM: 'custom'
        });
        
        this.GUARD_ACTIONS = Object.freeze({
            ALLOW: 'allow',
            DENY: 'deny',
            REDIRECT: 'redirect',
            REQUIRE_AUTH: 'require_auth',
            REQUIRE_GUEST: 'require_guest'
        });
        
        // ==================== EVENT-DRIVEN CONFIGURATION ====================
        this._guards = new Map();
        this._routeConfigs = new Map();
        this._activeGuards = new Set();
        this._subscriptions = new Map();
        this._redirectCache = new Map();
        
        // Centralized configuration schema
        this._configSchema = {
            defaultRedirects: {
                unauthorized: '/auth/login',
                authenticated: '/dashboard',
                forbidden: '/error/403'
            },
            guardPriorities: {
                [this.GUARD_TYPES.AUTH]: 100,
                [this.GUARD_TYPES.ROLE]: 90,
                [this.GUARD_TYPES.PERMISSION]: 80,
                [this.GUARD_TYPES.FEATURE_FLAG]: 70,
                [this.GUARD_TYPES.CUSTOM]: 50
            },
            cacheTTL: 30000 // 30 seconds
        };
        
        // Initialize event listeners
        this._initEventSystem();
        
        // Load configuration
        this._loadConfiguration();
        
        Object.seal(this);
        Object.freeze(this.GUARD_TYPES);
        Object.freeze(this.GUARD_ACTIONS);
    }
    
    // ==================== INTERFACE CONTRACT METHODS ====================
    
    registerGuard(guardName, guardConfig) {
        this._validateGuardConfig(guardConfig);
        
        const guard = {
            ...guardConfig,
            id: Symbol(`guard_${guardName}`),
            priority: guardConfig.priority || 
                     this._configSchema.guardPriorities[guardConfig.type] || 50,
            enabled: guardConfig.enabled !== false,
            statistics: {
                checks: 0,
                allows: 0,
                denies: 0,
                redirects: 0
            }
        };
        
        this._guards.set(guardName, guard);
        
        // Subscribe to relevant events if specified
        if (guardConfig.eventSubscriptions) {
            this._subscribeGuardToEvents(guardName, guardConfig.eventSubscriptions);
        }
        
        this._eventBus.emit('route_guard:registered', {
            guardName,
            type: guard.type,
            priority: guard.priority
        });
        
        return () => this.unregisterGuard(guardName);
    }
    
    unregisterGuard(guardName) {
        if (!this._guards.has(guardName)) {
            return false;
        }
        
        const guard = this._guards.get(guardName);
        
        // Unsubscribe from events
        if (this._subscriptions.has(guard.id)) {
            this._subscriptions.get(guard.id).forEach(unsubscribe => unsubscribe());
            this._subscriptions.delete(guard.id);
        }
        
        this._guards.delete(guardName);
        
        this._eventBus.emit('route_guard:unregistered', { guardName });
        
        return true;
    }
    
    configureRoute(routePath, guardConfigs) {
        if (!Array.isArray(guardConfigs)) {
            throw new Error('Guard configs must be an array');
        }
        
        const validatedConfigs = guardConfigs.map(config => 
            this._validateRouteGuardConfig(config)
        );
        
        this._routeConfigs.set(routePath, {
            guards: validatedConfigs,
            lastUpdated: Date.now(),
            cacheKey: this._generateCacheKey(routePath, validatedConfigs)
        });
        
        // Clear redirect cache for this route
        this._redirectCache.delete(routePath);
        
        this._eventBus.emit('route_guard:configured', {
            route: routePath,
            guardCount: validatedConfigs.length
        });
        
        return this;
    }
    
    async checkAccess(routePath, context = {}) {
        const startTime = Date.now();
        
        // Check cache first
        const cachedResult = this._getCachedResult(routePath, context);
        if (cachedResult) {
            return cachedResult;
        }
        
        // Get route configuration
        const routeConfig = this._routeConfigs.get(routePath);
        if (!routeConfig || routeConfig.guards.length === 0) {
            return this._createAllowResult(routePath, context);
        }
        
        // Sort guards by priority
        const sortedGuards = [...routeConfig.guards].sort((a, b) => 
            (this._guards.get(b.guard)?.priority || 0) - 
            (this._guards.get(a.guard)?.priority || 0)
        );
        
        let finalResult = null;
        
        // Execute guards in order
        for (const guardConfig of sortedGuards) {
            const guard = this._guards.get(guardConfig.guard);
            if (!guard || !guard.enabled) continue;
            
            guard.statistics.checks++;
            
            try {
                const guardResult = await this._executeGuard(
                    guard, 
                    guardConfig, 
                    routePath, 
                    context
                );
                
                if (guardResult.action === this.GUARD_ACTIONS.DENY) {
                    finalResult = guardResult;
                    guard.statistics.denies++;
                    break;
                } else if (guardResult.action === this.GUARD_ACTIONS.REDIRECT) {
                    finalResult = guardResult;
                    guard.statistics.redirects++;
                    break;
                } else if (guardResult.action === this.GUARD_ACTIONS.ALLOW) {
                    guard.statistics.allows++;
                    // Continue to next guard
                }
            } catch (error) {
                console.error(`[RouteGuard] Error in guard "${guardConfig.guard}":`, error);
                guard.statistics.denies++;
                finalResult = this._createErrorResult(routePath, context, error);
                break;
            }
        }
        
        // If no guard denied, allow access
        if (!finalResult) {
            finalResult = this._createAllowResult(routePath, context);
        }
        
        // Add metadata
        finalResult.metadata = {
            processingTime: Date.now() - startTime,
            guardsChecked: sortedGuards.length,
            timestamp: Date.now()
        };
        
        // Cache result
        this._cacheResult(routePath, context, finalResult);
        
        // Emit access check event
        this._eventBus.emit('route_guard:access_checked', {
            route: routePath,
            allowed: finalResult.allowed,
            action: finalResult.action,
            metadata: finalResult.metadata
        });
        
        return finalResult;
    }
    
    async enforceAccess(routePath, context = {}) {
        const accessResult = await this.checkAccess(routePath, context);
        
        if (!accessResult.allowed) {
            if (accessResult.redirectTo) {
                this._router.navigateTo(accessResult.redirectTo, {
                    replace: true,
                    guardRedirect: true,
                    originalRoute: routePath
                });
            }
            
            this._eventBus.emit('route_guard:access_denied', {
                route: routePath,
                result: accessResult,
                context
            });
            
            throw new Error(`Access denied to ${routePath}: ${accessResult.message}`);
        }
        
        return accessResult;
    }
    
    // ==================== BUILT-IN GUARDS ====================
    
    createAuthGuard() {
        return this.registerGuard('auth_required', {
            type: this.GUARD_TYPES.AUTH,
            handler: async (routePath, context) => {
                const isAuthenticated = await this._authMiddleware.isAuthenticated();
                
                if (!isAuthenticated) {
                    return {
                        action: this.GUARD_ACTIONS.REDIRECT,
                        redirectTo: this._config.get('guard.redirects.unauthorized', '/auth/login'),
                        message: 'Authentication required'
                    };
                }
                
                return { action: this.GUARD_ACTIONS.ALLOW };
            },
            priority: 100,
            description: 'Requires user authentication'
        });
    }
    
    createRoleGuard(allowedRoles) {
        return this.registerGuard(`role_${allowedRoles.join('_')}`, {
            type: this.GUARD_TYPES.ROLE,
            handler: async (routePath, context) => {
                const userRole = await this._authMiddleware.getUserRole();
                
                if (!allowedRoles.includes(userRole)) {
                    return {
                        action: this.GUARD_ACTIONS.DENY,
                        message: `Insufficient role. Required: ${allowedRoles.join(', ')}`,
                        statusCode: 403
                    };
                }
                
                return { action: this.GUARD_ACTIONS.ALLOW };
            },
            config: { allowedRoles },
            priority: 90
        });
    }
    
    createPermissionGuard(requiredPermissions) {
        return this.registerGuard(`perm_${requiredPermissions.join('_')}`, {
            type: this.GUARD_TYPES.PERMISSION,
            handler: async (routePath, context) => {
                const userPermissions = await this._authMiddleware.getPermissions();
                const hasAllPermissions = requiredPermissions.every(perm => 
                    userPermissions.includes(perm)
                );
                
                if (!hasAllPermissions) {
                    return {
                        action: this.GUARD_ACTIONS.DENY,
                        message: `Missing permissions: ${requiredPermissions.join(', ')}`,
                        statusCode: 403
                    };
                }
                
                return { action: this.GUARD_ACTIONS.ALLOW };
            },
            config: { requiredPermissions },
            priority: 80
        });
    }
    
    createFeatureFlagGuard(featureName) {
        return this.registerGuard(`feature_${featureName}`, {
            type: this.GUARD_TYPES.FEATURE_FLAG,
            handler: async (routePath, context) => {
                const isEnabled = this._config.get(`features.${featureName}`, false);
                
                if (!isEnabled) {
                    return {
                        action: this.GUARD_ACTIONS.REDIRECT,
                        redirectTo: this._config.get('guard.redirects.feature_disabled', '/error/feature-disabled'),
                        message: `Feature "${featureName}" is not enabled`
                    };
                }
                
                return { action: this.GUARD_ACTIONS.ALLOW };
            },
            config: { featureName },
            priority: 70
        });
    }
    
    // ==================== UTILITY METHODS ====================
    
    getGuardStats(guardName = null) {
        if (guardName) {
            const guard = this._guards.get(guardName);
            return guard ? { ...guard.statistics } : null;
        }
        
        const stats = {};
        for (const [name, guard] of this._guards) {
            stats[name] = { ...guard.statistics };
        }
        return stats;
    }
    
    resetGuardStats(guardName = null) {
        if (guardName) {
            const guard = this._guards.get(guardName);
            if (guard) {
                guard.statistics = { checks: 0, allows: 0, denies: 0, redirects: 0 };
            }
        } else {
            for (const guard of this._guards.values()) {
                guard.statistics = { checks: 0, allows: 0, denies: 0, redirects: 0 };
            }
        }
        
        return this;
    }
    
    getConfiguredRoutes() {
        return Array.from(this._routeConfigs.keys());
    }
    
    getRouteConfig(routePath) {
        const config = this._routeConfigs.get(routePath);
        return config ? { ...config, guards: [...config.guards] } : null;
    }
    
    clearRouteConfig(routePath = null) {
        if (routePath) {
            this._routeConfigs.delete(routePath);
            this._redirectCache.delete(routePath);
        } else {
            this._routeConfigs.clear();
            this._redirectCache.clear();
        }
        
        return this;
    }
    
    enableGuard(guardName) {
        const guard = this._guards.get(guardName);
        if (guard) {
            guard.enabled = true;
            this._eventBus.emit('route_guard:enabled', { guardName });
        }
        return this;
    }
    
    disableGuard(guardName) {
        const guard = this._guards.get(guardName);
        if (guard) {
            guard.enabled = false;
            this._eventBus.emit('route_guard:disabled', { guardName });
        }
        return this;
    }
    
    // ==================== PRIVATE METHODS ====================
    
    _initEventSystem() {
        // Listen for auth state changes
        const authUnsubscribe = this._eventBus.on('auth:state_changed', (event) => {
            // Clear cache on auth changes
            this._redirectCache.clear();
            this._eventBus.emit('route_guard:cache_cleared', { reason: 'auth_state_change' });
        });
        
        // Listen for config changes
        const configUnsubscribe = this._config.subscribe('guard.', (newValue, oldValue, path) => {
            this._loadConfiguration();
            this._eventBus.emit('route_guard:config_updated', { path });
        });
        
        // Store unsubscribe functions
        this._subscriptions.set('system', [authUnsubscribe, configUnsubscribe]);
        
        // Listen for router navigation
        this._router.addMiddleware(async (to, from, next) => {
            try {
                const result = await this.enforceAccess(to.path, {
                    from: from.path,
                    navigationType: 'router'
                });
                next();
            } catch (error) {
                // Router will handle the redirect from the guard result
                next(false);
            }
        });
    }
    
    _loadConfiguration() {
        // Load redirect configuration
        const redirects = this._config.get('guard.redirects', {});
        this._configSchema.defaultRedirects = {
            ...this._configSchema.defaultRedirects,
            ...redirects
        };
        
        // Load guard priorities
        const priorities = this._config.get('guard.priorities', {});
        this._configSchema.guardPriorities = {
            ...this._configSchema.guardPriorities,
            ...priorities
        };
        
        // Update cache TTL
        this._configSchema.cacheTTL = this._config.get('guard.cacheTTL', 30000);
    }
    
    _validateGuardConfig(config) {
        const required = ['type', 'handler'];
        const missing = required.filter(field => !config[field]);
        
        if (missing.length > 0) {
            throw new Error(`Missing required guard fields: ${missing.join(', ')}`);
        }
        
        if (!Object.values(this.GUARD_TYPES).includes(config.type)) {
            throw new Error(`Invalid guard type. Must be one of: ${Object.values(this.GUARD_TYPES).join(', ')}`);
        }
        
        if (typeof config.handler !== 'function') {
            throw new Error('Guard handler must be a function');
        }
    }
    
    _validateRouteGuardConfig(config) {
        if (!config.guard || !this._guards.has(config.guard)) {
            throw new Error(`Invalid guard name: ${config.guard}`);
        }
        
        const validated = { ...config };
        
        // Validate conditions if provided
        if (validated.conditions) {
            if (typeof validated.conditions !== 'function' && 
                !Array.isArray(validated.conditions)) {
                throw new Error('Conditions must be a function or array of functions');
            }
        }
        
        // Validate options
        if (validated.options) {
            if (typeof validated.options !== 'object') {
                throw new Error('Options must be an object');
            }
        }
        
        return validated;
    }
    
    async _executeGuard(guard, guardConfig, routePath, context) {
        // Check conditions first
        if (guardConfig.conditions) {
            const conditions = Array.isArray(guardConfig.conditions) 
                ? guardConfig.conditions 
                : [guardConfig.conditions];
            
            for (const condition of conditions) {
                if (typeof condition === 'function') {
                    const conditionResult = await condition(routePath, context);
                    if (!conditionResult) {
                        return { action: this.GUARD_ACTIONS.ALLOW }; // Skip this guard
                    }
                }
            }
        }
        
        // Execute guard handler
        const result = await guard.handler(routePath, {
            ...context,
            guardConfig: guardConfig.options || {},
            routeParams: this._extractRouteParams(routePath)
        });
        
        // Validate result
        return this._validateGuardResult(result, guard.name);
    }
    
    _validateGuardResult(result, guardName) {
        if (!result || !result.action) {
            throw new Error(`Guard "${guardName}" must return an action`);
        }
        
        const validActions = Object.values(this.GUARD_ACTIONS);
        if (!validActions.includes(result.action)) {
            throw new Error(`Invalid action "${result.action}". Must be one of: ${validActions.join(', ')}`);
        }
        
        const validated = { ...result };
        
        // Set defaults
        if (!validated.allowed) {
            validated.allowed = validated.action === this.GUARD_ACTIONS.ALLOW;
        }
        
        if (validated.action === this.GUARD_ACTIONS.REDIRECT && !validated.redirectTo) {
            validated.redirectTo = this._configSchema.defaultRedirects.unauthorized;
        }
        
        return validated;
    }
    
    _createAllowResult(routePath, context) {
        return {
            action: this.GUARD_ACTIONS.ALLOW,
            allowed: true,
            route: routePath,
            context,
            timestamp: Date.now()
        };
    }
    
    _createErrorResult(routePath, context, error) {
        return {
            action: this.GUARD_ACTIONS.REDIRECT,
            allowed: false,
            redirectTo: this._configSchema.defaultRedirects.forbidden,
            message: error.message || 'Internal guard error',
            error: error.toString(),
            route: routePath,
            context,
            timestamp: Date.now()
        };
    }
    
    _subscribeGuardToEvents(guardName, eventSubscriptions) {
        const guard = this._guards.get(guardName);
        if (!guard) return;
        
        const subscriptions = [];
        
        for (const [eventName, handler] of Object.entries(eventSubscriptions)) {
            const unsubscribe = this._eventBus.on(eventName, (eventData) => {
                handler(eventData, guard);
            });
            
            subscriptions.push(unsubscribe);
        }
        
        if (subscriptions.length > 0) {
            this._subscriptions.set(guard.id, subscriptions);
        }
    }
    
    _generateCacheKey(routePath, guardConfigs) {
        const keyData = {
            route: routePath,
            guards: guardConfigs.map(g => ({
                guard: g.guard,
                conditions: !!g.conditions,
                options: g.options || {}
            })),
            timestamp: Math.floor(Date.now() / this._configSchema.cacheTTL)
        };
        
        return JSON.stringify(keyData);
    }
    
    _getCachedResult(routePath, context) {
        const cacheKey = this._generateCacheKey(
            routePath, 
            this._routeConfigs.get(routePath)?.guards || []
        );
        
        const cached = this._redirectCache.get(routePath);
        
        if (cached && cached.key === cacheKey && cached.expires > Date.now()) {
            // Add cache hit metadata
            const result = { ...cached.result };
            result.metadata = {
                ...result.metadata,
                cacheHit: true,
                cacheAge: Date.now() - cached.timestamp
            };
            
            return result;
        }
        
        return null;
    }
    
    _cacheResult(routePath, context, result) {
        const cacheKey = this._generateCacheKey(
            routePath, 
            this._routeConfigs.get(routePath)?.guards || []
        );
        
        this._redirectCache.set(routePath, {
            key: cacheKey,
            result,
            timestamp: Date.now(),
            expires: Date.now() + this._configSchema.cacheTTL
        });
        
        // Clean up old cache entries
        if (this._redirectCache.size > 100) {
            for (const [key, entry] of this._redirectCache.entries()) {
                if (entry.expires < Date.now()) {
                    this._redirectCache.delete(key);
                }
            }
        }
    }
    
    _extractRouteParams(routePath) {
        // Simple route param extraction
        const params = {};
        const pathParts = routePath.split('/');
        
        for (let i = 0; i < pathParts.length; i++) {
            if (pathParts[i].startsWith(':')) {
                const paramName = pathParts[i].substring(1);
                params[paramName] = pathParts[i + 1] || null;
            }
        }
        
        return params;
    }
}

// ==================== SINGLETON EXPORT PATTERN ====================

let routeGuardInstance = null;

function createRouteGuard(dependencies = {}) {
    if (!routeGuardInstance) {
        routeGuardInstance = new VakamovaRouteGuard(dependencies);
        
        // Auto-register built-in guards
        routeGuardInstance.createAuthGuard();
        
        console.log('[RouteGuard] ✅ Vakamova Route Guard System initialized');
    }
    
    return routeGuardInstance;
}

// Export both for flexibility
export { VakamovaRouteGuard, createRouteGuard };
