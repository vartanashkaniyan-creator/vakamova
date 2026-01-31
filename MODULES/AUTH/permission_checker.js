/**
 * VAKAMOVA PERMISSION CHECKER - سیستم مدیریت مجوزهای پیشرفته
 * اصول: تزریق وابستگی، قرارداد رابط، رویداد محور، پیکربندی متمرکز
 * وابستگی‌های داخلی: session_service.js, state_manager.js, event_bus.js
 */

class VakamovaPermissionChecker {
    constructor(dependencies = {}) {
        // ==================== تزریق وابستگی‌ها ====================
        this._services = {
            session: dependencies.sessionService || window.sessionService,
            state: dependencies.stateManager || window.stateManager,
            events: dependencies.eventBus || window.eventBus
        };
        
        // اعتبارسنجی وجود سرویس‌های ضروری
        this._validateDependencies();
        
        // ==================== پیکربندی متمرکز ====================
        this._config = Object.freeze({
            permissionCacheTTL: 30000, // 30 ثانیه کش مجوزها
            enableAuditLog: true,
            defaultRole: 'guest',
            strictMode: false,
            ...dependencies.config
        });
        
        // ==================== سیستم کشینگ داخلی ====================
        this._permissionCache = new Map();
        this._roleCache = new Map();
        this._cacheTimestamps = new Map();
        
        // ==================== سیستم رویداد داخلی ====================
        this._internalEvents = {
            onPermissionChecked: 'permission:checked',
            onPermissionDenied: 'permission:denied',
            onRoleChanged: 'permission:role:changed'
        };
        
        // ==================== رجیستری قوانین مجوز ====================
        this._permissionRules = new Map();
        this._roleHierarchy = new Map();
        
        // ==================== راه‌اندازی اولیه ====================
        this._initializeDefaultRules();
        this._setupEventListeners();
        
        // ==================== متریک‌ها و مانیتورینگ ====================
        this._metrics = {
            checks: 0,
            cacheHits: 0,
            denies: 0,
            grants: 0
        };
        
        Object.seal(this._metrics);
        Object.seal(this);
        
        console.log('[PermissionChecker] ✅ سیستم مجوزها راه‌اندازی شد');
    }
    
    // ==================== قرارداد رابط اصلی (Public API) ====================
    
    async check(permission, context = {}) {
        this._metrics.checks++;
        
        // بررسی کش
        const cacheKey = this._generateCacheKey(permission, context);
        const cachedResult = this._getFromCache(cacheKey);
        
        if (cachedResult !== null) {
            this._metrics.cacheHits++;
            return cachedResult;
        }
        
        try {
            // دریافت اطلاعات کاربر فعلی
            const userState = await this._getUserState();
            
            // بررسی مجوز
            const result = await this._evaluatePermission(
                permission, 
                userState, 
                context
            );
            
            // ذخیره در کش
            this._addToCache(cacheKey, result);
            
            // انتشار رویداد
            this._services.events.emit(this._internalEvents.onPermissionChecked, {
                permission,
                granted: result.granted,
                userId: userState?.id,
                timestamp: Date.now(),
                context
            });
            
            // ثبت متریک
            result.granted ? this._metrics.grants++ : this._metrics.denies++;
            
            // لاگ اگر رد شد
            if (!result.granted && this._config.enableAuditLog) {
                this._logDenial(permission, userState, context, result.reason);
            }
            
            return result;
            
        } catch (error) {
            console.error('[PermissionChecker] خطا در بررسی مجوز:', error);
            
            // انتشار رویداد خطا
            this._services.events.emit('permission:error', {
                permission,
                error: error.message,
                context
            });
            
            return {
                granted: false,
                reason: 'SYSTEM_ERROR',
                message: 'خطای سیستمی در بررسی مجوز'
            };
        }
    }
    
    async can(permission, context = {}) {
        const result = await this.check(permission, context);
        return result.granted;
    }
    
    async cannot(permission, context = {}) {
        const result = await this.check(permission, context);
        return !result.granted;
    }
    
    // ==================== مدیریت قوانین (Rule Management) ====================
    
    defineRule(permission, ruleConfig) {
        if (typeof ruleConfig === 'function') {
            this._permissionRules.set(permission, {
                type: 'function',
                handler: ruleConfig
            });
        } else {
            this._permissionRules.set(permission, {
                type: 'static',
                config: ruleConfig
            });
        }
        
        // پاکسازی کش مرتبط
        this._clearRelatedCache(permission);
        
        this._services.events.emit('permission:rule:defined', { permission });
        
        return this;
    }
    
    defineRole(roleName, permissions = []) {
        this._roleCache.set(roleName, new Set(permissions));
        
        this._services.events.emit('permission:role:defined', { 
            role: roleName,
            permissionCount: permissions.length 
        });
        
        return this;
    }
    
    extendRole(baseRole, extendingRole) {
        if (!this._roleHierarchy.has(baseRole)) {
            this._roleHierarchy.set(baseRole, new Set());
        }
        
        this._roleHierarchy.get(baseRole).add(extendingRole);
        this._clearRoleCache();
        
        return this;
    }
    
    // ==================== ابزارهای کمکی ====================
    
    getUserPermissions(userState) {
        const permissions = new Set();
        
        // اضافه کردن مجوزهای نقش اصلی
        const mainRole = userState?.role || this._config.defaultRole;
        const rolePerms = this._roleCache.get(mainRole);
        if (rolePerms) {
            rolePerms.forEach(perm => permissions.add(perm));
        }
        
        // اضافه کردن مجوزهای نقش‌های سلسله مراتبی
        const hierarchy = this._getRoleHierarchy(mainRole);
        hierarchy.forEach(role => {
            const rolePerms = this._roleCache.get(role);
            if (rolePerms) {
                rolePerms.forEach(perm => permissions.add(perm));
            }
        });
        
        // اضافه کردن مجوزهای اختصاصی کاربر
        const userPerms = userState?.permissions || [];
        userPerms.forEach(perm => permissions.add(perm));
        
        return Array.from(permissions);
    }
    
    clearCache(pattern = null) {
        if (!pattern) {
            this._permissionCache.clear();
            this._cacheTimestamps.clear();
        } else {
            const regex = new RegExp(pattern);
            for (const key of this._permissionCache.keys()) {
                if (regex.test(key)) {
                    this._permissionCache.delete(key);
                    this._cacheTimestamps.delete(key);
                }
            }
        }
        
        this._services.events.emit('permission:cache:cleared', { pattern });
        
        return this;
    }
    
    getMetrics() {
        return { ...this._metrics };
    }
    
    resetMetrics() {
        this._metrics.checks = 0;
        this._metrics.cacheHits = 0;
        this._metrics.denies = 0;
        this._metrics.grants = 0;
        return this;
    }
    
    // ==================== Private Methods ====================
    
    _validateDependencies() {
        const required = ['session', 'state', 'events'];
        required.forEach(service => {
            if (!this._services[service]) {
                throw new Error(
                    `سرویس ${service} برای PermissionChecker ضروری است. ` +
                    `لطفاً از طریق تزریق وابستگی ارائه دهید.`
                );
            }
        });
    }
    
    _setupEventListeners() {
        // پاکسازی کش هنگام تغییر وضعیت کاربر
        this._services.events.on('user:logged_in', () => {
            this.clearCache();
        });
        
        this._services.events.on('user:logged_out', () => {
            this.clearCache();
        });
        
        this._services.events.on('user:role:updated', (data) => {
            this.clearCache();
            this._services.events.emit(this._internalEvents.onRoleChanged, data);
        });
        
        // پاکسازی دوره‌ای کش
        setInterval(() => {
            this._cleanupExpiredCache();
        }, 60000); // هر دقیقه
    }
    
    _initializeDefaultRules() {
        // نقش‌های پیش‌فرض
        this.defineRole('guest', [
            'view_public_content',
            'access_home'
        ]);
        
        this.defineRole('student', [
            'view_lessons',
            'take_quizzes',
            'view_progress',
            'access_dashboard'
        ]);
        
        this.defineRole('teacher', [
            'create_lessons',
            'grade_assignments',
            'manage_students',
            'view_analytics'
        ]);
        
        this.defineRole('admin', [
            'manage_users',
            'system_settings',
            'view_all_analytics',
            'access_admin_panel'
        ]);
        
        // سلسله مراتب نقش‌ها
        this.extendRole('student', 'guest');
        this.extendRole('teacher', 'student');
        this.extendRole('admin', 'teacher');
        
        // قوانین پیش‌فرض پویا
        this.defineRule('edit_own_content', async (user, resource) => {
            return user.id === resource.authorId;
        });
        
        this.defineRule('access_premium', async (user) => {
            return user.subscription === 'premium' || user.subscription === 'enterprise';
        });
    }
    
    async _getUserState() {
        try {
            // اولویت: از session service
            if (this._services.session.getCurrentUser) {
                const user = await this._services.session.getCurrentUser();
                if (user) return user;
            }
            
            // جایگزین: از state manager
            if (this._services.state.get) {
                const user = this._services.state.get('user.current');
                if (user) return user;
            }
            
            // کاربر مهمان
            return {
                id: null,
                role: this._config.defaultRole,
                permissions: [],
                isGuest: true
            };
            
        } catch (error) {
            console.warn('[PermissionChecker] خطا در دریافت وضعیت کاربر:', error);
            return {
                id: null,
                role: this._config.defaultRole,
                permissions: [],
                isGuest: true,
                error: error.message
            };
        }
    }
    
    async _evaluatePermission(permission, userState, context) {
        // بررسی مستقیم در قوانین تعریف شده
        if (this._permissionRules.has(permission)) {
            const rule = this._permissionRules.get(permission);
            
            if (rule.type === 'function') {
                try {
                    const granted = await rule.handler(userState, context);
                    return {
                        granted: !!granted,
                        reason: granted ? 'RULE_PASSED' : 'RULE_FAILED',
                        evaluatedBy: 'custom_rule'
                    };
                } catch (error) {
                    return {
                        granted: false,
                        reason: 'RULE_ERROR',
                        message: error.message,
                        evaluatedBy: 'custom_rule'
                    };
                }
            } else {
                // قانون استاتیک
                const staticRule = rule.config;
                const requiredRole = staticRule.requiredRole;
                const requiredPerms = staticRule.requiredPermissions || [];
                
                // بررسی نقش
                if (requiredRole && userState.role !== requiredRole) {
                    return {
                        granted: false,
                        reason: 'ROLE_MISMATCH',
                        requiredRole,
                        userRole: userState.role,
                        evaluatedBy: 'static_rule'
                    };
                }
                
                // بررسی مجوزهای اضافی
                if (requiredPerms.length > 0) {
                    const userPerms = this.getUserPermissions(userState);
                    const hasAllPerms = requiredPerms.every(perm => 
                        userPerms.includes(perm)
                    );
                    
                    if (!hasAllPerms) {
                        return {
                            granted: false,
                            reason: 'INSUFFICIENT_PERMISSIONS',
                            missingPermissions: requiredPerms.filter(perm => 
                                !userPerms.includes(perm)
                            ),
                            evaluatedBy: 'static_rule'
                        };
                    }
                }
                
                return {
                    granted: true,
                    reason: 'STATIC_RULE_PASSED',
                    evaluatedBy: 'static_rule'
                };
            }
        }
        
        // بررسی بر اساس نقش کاربر
        const userPermissions = this.getUserPermissions(userState);
        if (userPermissions.includes(permission)) {
            return {
                granted: true,
                reason: 'ROLE_PERMISSION',
                userRole: userState.role,
                evaluatedBy: 'role_based'
            };
        }
        
        // بررسی سلسله مراتب نقش
        const roleHierarchy = this._getRoleHierarchy(userState.role);
        for (const role of roleHierarchy) {
            const rolePerms = this._roleCache.get(role);
            if (rolePerms && rolePerms.has(permission)) {
                return {
                    granted: true,
                    reason: 'HIERARCHY_PERMISSION',
                    inheritedFrom: role,
                    userRole: userState.role,
                    evaluatedBy: 'hierarchy'
                };
            }
        }
        
        // پیش‌فرض: رد مجوز
        return {
            granted: false,
            reason: 'PERMISSION_NOT_FOUND',
            message: 'مجوز در سیستم تعریف نشده است',
            evaluatedBy: 'default'
        };
    }
    
    _getRoleHierarchy(role) {
        const hierarchy = new Set();
        const stack = [role];
        
        while (stack.length > 0) {
            const current = stack.pop();
            if (this._roleHierarchy.has(current)) {
                const parents = this._roleHierarchy.get(current);
                parents.forEach(parent => {
                    if (!hierarchy.has(parent)) {
                        hierarchy.add(parent);
                        stack.push(parent);
                    }
                });
            }
        }
        
        return hierarchy;
    }
    
    _generateCacheKey(permission, context) {
        const userState = this._services.state.get('user.current') || {};
        const contextStr = JSON.stringify(context);
        return `${permission}:${userState.id || 'guest'}:${userState.role}:${contextStr}`;
    }
    
    _getFromCache(key) {
        if (!this._cacheTimestamps.has(key)) return null;
        
        const timestamp = this._cacheTimestamps.get(key);
        const age = Date.now() - timestamp;
        
        if (age > this._config.permissionCacheTTL) {
            this._permissionCache.delete(key);
            this._cacheTimestamps.delete(key);
            return null;
        }
        
        return this._permissionCache.get(key) || null;
    }
    
    _addToCache(key, result) {
        this._permissionCache.set(key, result);
        this._cacheTimestamps.set(key, Date.now());
    }
    
    _clearRelatedCache(permission) {
        const pattern = `^${permission}:`;
        this.clearCache(pattern);
    }
    
    _clearRoleCache() {
        this._roleCache.clear();
        this.clearCache(); // همه مجوزها به نقش‌ها وابسته‌اند
    }
    
    _cleanupExpiredCache() {
        const now = Date.now();
        let cleaned = 0;
        
        for (const [key, timestamp] of this._cacheTimestamps) {
            if (now - timestamp > this._config.permissionCacheTTL) {
                this._permissionCache.delete(key);
                this._cacheTimestamps.delete(key);
                cleaned++;
            }
        }
        
        if (cleaned > 0) {
            console.log(`[PermissionChecker] ${cleaned} کش منقضی پاکسازی شد`);
        }
    }
    
    _logDenial(permission, userState, context, reason) {
        const auditLog = {
            timestamp: new Date().toISOString(),
            permission,
            userId: userState?.id,
            userRole: userState?.role,
            userIp: context.ip || 'unknown',
            userAgent: context.userAgent || 'unknown',
            resource: context.resource || 'unknown',
            action: context.action || 'unknown',
            reason,
            context: JSON.stringify(context)
        };
        
        // انتشار رویداد لاگ
        this._services.events.emit('audit:permission:denied', auditLog);
        
        // چاپ در کنسول در حالت توسعه
        if (this._config.strictMode) {
            console.warn('[PermissionChecker] دسترسی رد شد:', auditLog);
        }
    }
}

// ==================== Export Pattern ====================
// الگوی سازگار با سیستم ماژول‌های Vakamova

let permissionCheckerInstance = null;

function createPermissionChecker(dependencies = {}) {
    if (!permissionCheckerInstance) {
        permissionCheckerInstance = new VakamovaPermissionChecker(dependencies);
    }
    return permissionCheckerInstance;
}

function getPermissionChecker() {
    if (!permissionCheckerInstance) {
        throw new Error('PermissionChecker هنوز راه‌اندازی نشده است');
    }
    return permissionCheckerInstance;
}

// قرارداد رابط برای تزریق وابستگی
const PermissionCheckerInterface = {
    create: createPermissionChecker,
    get: getPermissionChecker,
    reset: () => { permissionCheckerInstance = null; }
};

// Export برای محیط‌های مختلف
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { VakamovaPermissionChecker, PermissionCheckerInterface };
}

if (typeof window !== 'undefined') {
    window.VakamovaPermissionChecker = VakamovaPermissionChecker;
    window.PermissionChecker = PermissionCheckerInterface;
}

console.log('[PermissionChecker] ✅ ماژول مجوزها بارگذاری شد');
