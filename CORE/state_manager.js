/**
 * HYPERLANG STATE MANAGER - سیستم مدیریت وضعیت پیشرفته (نسخه اصلاح‌شده)
 * اصل: پیکربندی متمرکز، قرارداد رابط، معماری حرفه‌ای
 * وابستگی: event-bus.js (برای تغییرات state)
 */

class HyperStateManager {
    constructor(eventSystem, config = {}) {
        // ==================== تزریق وابستگی‌ها ====================
        this._eventSystem = eventSystem;
        
        // تزریق logger برای مدیریت خطاها
        this._logger = config.logger || {
            error: (msg, error) => {
                if (typeof console !== 'undefined' && console.error) {
                    console.error(`[StateManager] ${msg}`, error);
                }
            },
            warn: (msg, data) => {
                if (typeof console !== 'undefined' && console.warn) {
                    console.warn(`[StateManager] ${msg}`, data);
                }
            },
            info: (msg, data) => {
                if (typeof console !== 'undefined' && console.info) {
                    console.info(`[StateManager] ${msg}`, data);
                }
            }
        };
        
        // ==================== ذخیره‌سازی حالت ====================
        this._state = new Map();
        this._history = [];
        this._transactions = new Map();
        this._middlewares = [];
        
        // ==================== پیکربندی متمرکز ====================
        this._config = Object.freeze({
            maxHistory: config.maxHistory || 100,
            enableHistory: config.enableHistory ?? true,
            enableMiddleware: config.enableMiddleware ?? true,
            strictMode: config.strictMode ?? false,
            defaultNamespace: config.defaultNamespace || 'global',
            autoCleanupInterval: config.autoCleanupInterval || 300000, // 5 دقیقه
            ...config
        });
        
        // ==================== سیستم‌های پیشرفته ====================
        this._validators = new Map();
        this._snapshots = new Map();
        
        // سیستم subscription بهینه‌شده
        this._subscriptions = {
            byPath: new Map(),           // Subscriptionهای مستقیم
            byPattern: new Map(),        // Subscriptionهای الگویی
            computedDeps: new Map(),     // وابستگی‌های computed
            cleanupQueue: new Set()      // صف پاکسازی
        };
        
        // Dependency tracker متمرکز برای computed states
        this._dependencyTracker = this._createDependencyTracker();
        
        Object.seal(this._config);
        
        // راه‌اندازی cleanup خودکار
        this._setupAutoCleanup();
        
        // Initialize default state
        this._initDefaultState();
    }
    
    // ==================== CORE STATE OPERATIONS ====================
    
    set(path, value, options = {}) {
        const normalizedPath = this._normalizePath(path);
        const namespace = options.namespace || this._config.defaultNamespace;
        const fullPath = `${namespace}.${normalizedPath}`;
        
        // Validation
        if (this._validators.has(fullPath)) {
            const isValid = this._validators.get(fullPath)(value);
            if (!isValid) {
                throw new Error(`Validation failed for path "${fullPath}"`);
            }
        }
        
        // Middleware processing
        if (this._config.enableMiddleware) {
            const middlewareResult = this._runMiddlewares('beforeSet', {
                path: fullPath,
                value,
                oldValue: this.get(path, { namespace })
            });
            
            if (middlewareResult.canceled) {
                return { success: false, reason: 'middleware_blocked' };
            }
            
            value = middlewareResult.value !== undefined ? middlewareResult.value : value;
        }
        
        // Transaction support
        const transactionId = options.transactionId;
        if (transactionId) {
            if (!this._transactions.has(transactionId)) {
                this._transactions.set(transactionId, []);
            }
            this._transactions.get(transactionId).push({
                path: fullPath,
                oldValue: this.get(path, { namespace }),
                newValue: value
            });
        }
        
        // Get old value for history
        const oldValue = this._getStateValue(fullPath);
        
        // Update state
        this._setStateValue(fullPath, value);
        
        // Update computed states
        this._updateComputedStates(fullPath, value);
        
        // Add to history
        if (this._config.enableHistory) {
            this._addToHistory(fullPath, oldValue, value, options);
        }
        
        // Notify subscribers
        this._notifySubscribers(fullPath, value, oldValue);
        
        // Emit event
        this._eventSystem.emit('state:changed', {
            path: fullPath,
            value,
            oldValue,
            namespace,
            source: options.source || 'direct'
        });
        
        return { 
            success: true, 
            path: fullPath, 
            oldValue, 
            newValue: value 
        };
    }
    
    get(path, options = {}) {
        const normalizedPath = this._normalizePath(path);
        const namespace = options.namespace || this._config.defaultNamespace;
        const fullPath = `${namespace}.${normalizedPath}`;
        
        // Check computed state first
        const computedValue = this._dependencyTracker.getComputedValue(fullPath);
        if (computedValue !== undefined) {
            return computedValue;
        }
        
        return this._getStateValue(fullPath);
    }
    
    update(path, updater, options = {}) {
        const currentValue = this.get(path, options);
        const newValue = typeof updater === 'function' 
            ? updater(currentValue) 
            : { ...currentValue, ...updater };
        
        return this.set(path, newValue, options);
    }
    
    delete(path, options = {}) {
        const normalizedPath = this._normalizePath(path);
        const namespace = options.namespace || this._config.defaultNamespace;
        const fullPath = `${namespace}.${normalizedPath}`;
        
        const oldValue = this._getStateValue(fullPath);
        
        // Remove from state
        this._deleteStateValue(fullPath);
        
        // Remove computed states
        this._dependencyTracker.removeComputedState(fullPath);
        
        // Notify subscribers
        this._notifySubscribers(fullPath, undefined, oldValue);
        
        // Emit event
        this._eventSystem.emit('state:deleted', {
            path: fullPath,
            oldValue,
            namespace
        });
        
        return { success: true, path: fullPath, oldValue };
    }
    
    // ==================== ADVANCED FEATURES ====================
    
    subscribe(path, callback, options = {}) {
        const normalizedPath = this._normalizePath(path);
        const namespace = options.namespace || this._config.defaultNamespace;
        const fullPath = `${namespace}.${normalizedPath}`;
        
        const subscriptionId = Symbol(`sub_${Date.now()}`);
        
        if (!this._subscriptions.byPath.has(fullPath)) {
            this._subscriptions.byPath.set(fullPath, new Map());
        }
        
        this._subscriptions.byPath.get(fullPath).set(subscriptionId, {
            callback,
            options: {
                immediate: options.immediate ?? false,
                deep: options.deep ?? false,
                ...options
            }
        });
        
        // Immediate callback if requested
        if (options.immediate) {
            try {
                callback(this.get(path, { namespace }), undefined, fullPath);
            } catch (error) {
                this._logger.error('Immediate subscription error:', error);
            }
        }
        
        const unsubscribe = () => {
            const pathSubs = this._subscriptions.byPath.get(fullPath);
            if (pathSubs) {
                pathSubs.delete(subscriptionId);
                if (pathSubs.size === 0) {
                    this._subscriptions.byPath.delete(fullPath);
                }
            }
            return true;
        };
        
        // ثبت برای cleanup خودکار
        this._subscriptions.cleanupQueue.add(unsubscribe);
        
        return unsubscribe;
    }
    
    computed(path, computer, options = {}) {
        const normalizedPath = this._normalizePath(path);
        const namespace = options.namespace || this._config.defaultNamespace;
        const fullPath = `${namespace}.${normalizedPath}`;
        
        // استفاده از dependency tracker متمرکز
        return this._dependencyTracker.createComputedState(
            fullPath,
            computer,
            options.dependencies || [],
            options
        );
    }
    
    transaction(callback) {
        const transactionId = Symbol(`tx_${Date.now()}`);
        this._transactions.set(transactionId, []);
        
        try {
            const result = callback(transactionId);
            this._commitTransaction(transactionId);
            return { success: true, result };
        } catch (error) {
            this._rollbackTransaction(transactionId);
            return { success: false, error };
        }
    }
    
    snapshot(name = `snapshot_${Date.now()}`) {
        const snapshot = {
            timestamp: Date.now(),
            state: this._serializeState(),
            name
        };
        
        this._snapshots.set(name, snapshot);
        
        // Emit event
        this._eventSystem.emit('state:snapshot:created', { name, snapshot });
        
        return name;
    }
    
    restore(snapshotName) {
        if (!this._snapshots.has(snapshotName)) {
            throw new Error(`Snapshot "${snapshotName}" not found`);
        }
        
        const snapshot = this._snapshots.get(snapshotName);
        this._restoreState(snapshot.state);
        
        // Emit event
        this._eventSystem.emit('state:snapshot:restored', { name: snapshotName });
        
        return { success: true, name: snapshotName };
    }
    
    use(middleware) {
        if (typeof middleware !== 'function') {
            throw new TypeError('Middleware must be a function');
        }
        
        this._middlewares.push(middleware);
        return () => {
            this._middlewares = this._middlewares.filter(m => m !== middleware);
        };
    }
    
    addValidator(path, validator) {
        const normalizedPath = this._normalizePath(path);
        const fullPath = `${this._config.defaultNamespace}.${normalizedPath}`;
        
        if (!this._validators.has(fullPath)) {
            this._validators.set(fullPath, []);
        }
        
        this._validators.get(fullPath).push(validator);
        return this;
    }
    
    // ==================== NEW: CLEANUP METHODS ====================
    
    cleanupAllSubscriptions() {
        let cleanedCount = 0;
        
        // پاکسازی همه subscriptionها
        this._subscriptions.cleanupQueue.forEach(unsubscribe => {
            if (unsubscribe()) {
                cleanedCount++;
            }
        });
        
        this._subscriptions.cleanupQueue.clear();
        this._subscriptions.byPath.clear();
        this._subscriptions.byPattern.clear();
        
        // پاکسازی dependency tracker
        this._dependencyTracker.cleanup();
        
        this._logger.info(`Cleaned up ${cleanedCount} subscriptions`, {
            timestamp: Date.now()
        });
        
        return { success: true, cleanedCount };
    }
    
    cleanupUnusedSubscriptions() {
        const unused = [];
        
        for (const [path, subscribers] of this._subscriptions.byPath) {
            // اگر مسیر در state وجود ندارد
            if (this.get(path) === undefined) {
                unused.push(path);
                subscribers.clear();
                this._subscriptions.byPath.delete(path);
            }
        }
        
        return { success: true, unusedPaths: unused, count: unused.length };
    }
    
    // ==================== UTILITY METHODS ====================
    
    getAllState(namespace = null) {
        const result = {};
        
        for (const [key, value] of this._state) {
            if (namespace && !key.startsWith(`${namespace}.`)) continue;
            
            const parts = key.split('.');
            let current = result;
            
            for (let i = 0; i < parts.length - 1; i++) {
                if (!current[parts[i]]) {
                    current[parts[i]] = {};
                }
                current = current[parts[i]];
            }
            
            current[parts[parts.length - 1]] = value;
        }
        
        return result;
    }
    
    getHistory(limit = 50) {
        return this._history.slice(-limit);
    }
    
    clearHistory() {
        this._history = [];
        return this;
    }
    
    getSnapshotNames() {
        return Array.from(this._snapshots.keys());
    }
    
    getSubscriptionCount() {
        let total = 0;
        for (const subscribers of this._subscriptions.byPath.values()) {
            total += subscribers.size;
        }
        return total;
    }
    
    // ==================== PRIVATE METHODS ====================
    
    _createDependencyTracker() {
        const computedStates = new Map();
        const dependencyMap = new Map();
        
        return {
            createComputedState(fullPath, computer, dependencies, options) {
                const computedState = {
                    computer,
                    dependencies: dependencies.map(dep => 
                        Array.isArray(dep) ? dep.join('.') : dep
                    ),
                    value: null,
                    cache: options.cache ?? true,
                    subscribers: new Set()
                };
                
                // Compute initial value
                computedState.value = this._computeValue(computedState);
                
                computedStates.set(fullPath, computedState);
                
                // Register dependencies
                for (const dep of computedState.dependencies) {
                    if (!dependencyMap.has(dep)) {
                        dependencyMap.set(dep, new Set());
                    }
                    dependencyMap.get(dep).add(fullPath);
                }
                
                return computedState.value;
            },
            
            _computeValue(computedState) {
                try {
                    const depsValues = computedState.dependencies.map(dep => {
                        const path = Array.isArray(dep) ? dep.join('.') : dep;
                        return this._getStateValue(path);
                    });
                    
                    return computedState.computer(...depsValues);
                } catch (error) {
                    this._logger.error('Computed state error:', error);
                    return null;
                }
            },
            
            getComputedValue(fullPath) {
                const computed = computedStates.get(fullPath);
                return computed ? computed.value : undefined;
            },
            
            removeComputedState(fullPath) {
                const computed = computedStates.get(fullPath);
                if (computed) {
                    // Remove from dependency map
                    for (const dep of computed.dependencies) {
                        const dependents = dependencyMap.get(dep);
                        if (dependents) {
                            dependents.delete(fullPath);
                            if (dependents.size === 0) {
                                dependencyMap.delete(dep);
                            }
                        }
                    }
                    computedStates.delete(fullPath);
                }
            },
            
            updateDependents(changedPath) {
                const dependents = dependencyMap.get(changedPath);
                if (dependents) {
                    for (const dependentPath of dependents) {
                        const computed = computedStates.get(dependentPath);
                        if (computed) {
                            computed.value = this._computeValue(computed);
                            // Notify subscribers
                            this._notifySubscribers(dependentPath, computed.value);
                        }
                    }
                }
            },
            
            cleanup() {
                computedStates.clear();
                dependencyMap.clear();
            }
        };
    }
    
    _setupAutoCleanup() {
        if (this._config.autoCleanupInterval > 0) {
            this._cleanupInterval = setInterval(() => {
                this.cleanupUnusedSubscriptions();
            }, this._config.autoCleanupInterval);
        }
    }
    
    _initDefaultState() {
        this.set('initialized', false, { 
            namespace: 'system',
            source: 'init' 
        });
        
        this.set('lastUpdated', Date.now(), {
            namespace: 'system',
            source: 'init'
        });
    }
    
    _normalizePath(path) {
        if (Array.isArray(path)) {
            return path.join('.');
        }
        
        if (typeof path !== 'string') {
            throw new TypeError('Path must be string or array');
        }
        
        return path.replace(/\[(\w+)\]/g, '.$1').replace(/^\.+|\.+$/g, '');
    }
    
    _getStateValue(fullPath) {
        const parts = fullPath.split('.');
        let current = this._state;
        
        for (const part of parts) {
            if (!current.has(part)) {
                return undefined;
            }
            current = current.get(part);
        }
        
        return current;
    }
    
    _setStateValue(fullPath, value) {
        const parts = fullPath.split('.');
        let current = this._state;
        
        for (let i = 0; i < parts.length - 1; i++) {
            const part = parts[i];
            if (!current.has(part)) {
                current.set(part, new Map());
            }
            current = current.get(part);
        }
        
        const lastPart = parts[parts.length - 1];
        current.set(lastPart, value);
    }
    
    _deleteStateValue(fullPath) {
        const parts = fullPath.split('.');
        let current = this._state;
        
        for (let i = 0; i < parts.length - 1; i++) {
            const part = parts[i];
            if (!current.has(part)) return false;
            current = current.get(part);
        }
        
        const lastPart = parts[parts.length - 1];
        return current.delete(lastPart);
    }
    
    _addToHistory(path, oldValue, newValue, options) {
        const historyEntry = {
            timestamp: Date.now(),
            path,
            oldValue,
            newValue,
            source: options.source || 'direct',
            namespace: options.namespace
        };
        
        this._history.push(historyEntry);
        
        // Trim history if too long
        if (this._history.length > this._config.maxHistory) {
            this._history.shift();
        }
        
        // Update lastUpdated
        this.update('lastUpdated', Date.now(), { 
            namespace: 'system',
            source: 'history' 
        });
    }
    
    _notifySubscribers(path, newValue, oldValue) {
        // Notify direct subscribers
        if (this._subscriptions.byPath.has(path)) {
            const subscribers = this._subscriptions.byPath.get(path);
            
            for (const [id, config] of subscribers) {
                try {
                    config.callback(newValue, oldValue, path);
                } catch (error) {
                    this._logger.error('Subscriber error:', error);
                }
            }
        }
        
        // Notify pattern subscribers
        for (const [pattern, subscribers] of this._subscriptions.byPattern) {
            if (this._matchesPattern(path, pattern)) {
                for (const [id, config] of subscribers) {
                    try {
                        config.callback(newValue, oldValue, path);
                    } catch (error) {
                        this._logger.error('Pattern subscriber error:', error);
                    }
                }
            }
        }
        
        // Update computed dependents
        this._dependencyTracker.updateDependents(path);
    }
    
    _matchesPattern(path, pattern) {
        if (pattern === '*') return true;
        
        const pathParts = path.split('.');
        const patternParts = pattern.split('.');
        
        if (pathParts.length !== patternParts.length) return false;
        
        for (let i = 0; i < pathParts.length; i++) {
            if (patternParts[i] !== '*' && patternParts[i] !== pathParts[i]) {
                return false;
            }
        }
        
        return true;
    }
    
    _runMiddlewares(phase, data) {
        let result = { canceled: false, value: data.value };
        
        for (const middleware of this._middlewares) {
            try {
                const middlewareResult = middleware(phase, data, result);
                if (middlewareResult === false) {
                    return { canceled: true, reason: 'middleware_blocked' };
                }
                if (middlewareResult && middlewareResult.value !== undefined) {
                    result.value = middlewareResult.value;
                }
            } catch (error) {
                this._logger.error('Middleware error:', error);
                if (this._config.strictMode) throw error;
            }
        }
        
        return result;
    }
    
    _updateComputedStates(changedPath, newValue) {
        // Handled by dependency tracker
        this._dependencyTracker.updateDependents(changedPath);
    }
    
    _commitTransaction(transactionId) {
        const changes = this._transactions.get(transactionId) || [];
        
        for (const change of changes) {
            this._eventSystem.emit('state:transaction:committed', change);
        }
        
        this._transactions.delete(transactionId);
    }
    
    _rollbackTransaction(transactionId) {
        const changes = this._transactions.get(transactionId) || [];
        
        // Rollback in reverse order
        for (let i = changes.length - 1; i >= 0; i--) {
            const change = changes[i];
            this.set(change.path, change.oldValue, { 
                source: 'rollback',
                silent: true 
            });
            
            this._eventSystem.emit('state:transaction:rolledback', change);
        }
        
        this._transactions.delete(transactionId);
    }
    
    _serializeState() {
        const serializeMap = (map) => {
            const obj = {};
            for (const [key, value] of map) {
                obj[key] = value instanceof Map ? serializeMap(value) : value;
            }
            return obj;
        };
        
        return serializeMap(this._state);
    }
    
    _restoreState(serializedState) {
        const restoreMap = (obj) => {
            const map = new Map();
            for (const [key, value] of Object.entries(obj)) {
                map.set(key, 
                    value && typeof value === 'object' && !Array.isArray(value) 
                        ? restoreMap(value) 
                        : value
                );
            }
            return map;
        };
        
        this._state = restoreMap(serializedState);
        
        // Notify all subscribers
        for (const [path] of this._subscriptions.byPath) {
            this._notifySubscribers(path, this.get(path));
        }
    }
    
    // ==================== DESTRUCTOR ====================
    
    destroy() {
        // توقف cleanup خودکار
        if (this._cleanupInterval) {
            clearInterval(this._cleanupInterval);
        }
        
        // پاکسازی کامل
        this.cleanupAllSubscriptions();
        
        // پاکسازی state
        this._state.clear();
        this._history = [];
        this._transactions.clear();
        this._middlewares = [];
        this._validators.clear();
        this._snapshots.clear();
        
        this._logger.info('StateManager destroyed', { timestamp: Date.now() });
        
        return { success: true };
    }
}

// ==================== فکتوری و Singleton ====================

const StateManagerFactory = {
    create(eventSystem, config = {}) {
        return new HyperStateManager(eventSystem, config);
    },
    
    getInstance(eventSystem, config = {}) {
        if (!this._instance) {
            this._instance = this.create(eventSystem, config);
        }
        return this._instance;
    },
    
    destroyInstance() {
        if (this._instance) {
            this._instance.destroy();
            this._instance = null;
        }
    }
};

export { HyperStateManager, StateManagerFactory };
