
// ==================== VAKAMOVA STATE MANAGEMENT ====================
// Advanced State Management with Time Travel, Persistence & Middleware Support

class VakamovaStateManager {
    static CONTRACT = {
        name: 'VakamovaStateManager',
        version: '3.0.0',
        methods: ['get', 'set', 'update', 'subscribe', 'undo', 'redo', 'persist'],
        events: ['state:changed', 'state:persisted', 'state:restored']
    };

    constructor(dependencies = {}) {
        // Dependency Injection
        this.config = dependencies.config || window.VakamovaConfig;
        this.eventBus = dependencies.eventBus || window.VakamovaEventBus;
        this.logger = dependencies.logger || console;
        this.database = dependencies.database;
        this.security = dependencies.security;
        
        // State configuration
        this.state = this._createInitialState();
        this.previousStates = [];
        this.futureStates = [];
        this.maxHistory = this.config?.state?.maxHistory || 50;
        this.subscribers = new Map();
        this.middlewares = [];
        this.isPersisting = false;
        this.autoSaveInterval = null;
        
        // Performance tracking
        this.metrics = {
            updates: 0,
            subscriptions: 0,
            undoCount: 0,
            redoCount: 0,
            middlewareExecutions: 0
        };
        
        this._bindMethods();
        this._loadPersistedState();
        this._setupAutoPersist();
    }

    get(path = null, defaultValue = undefined) {
        if (!path) {
            return this._deepClone(this.state);
        }
        
        return this._getByPath(path, defaultValue);
    }

    async set(path, value, options = {}) {
        const {
            merge = false,
            silent = false,
            skipMiddleware = false,
            saveToHistory = true
        } = options;

        // Run middlewares if not skipped
        if (!skipMiddleware && this.middlewares.length > 0) {
            const middlewareResult = await this._runMiddlewares('beforeUpdate', { path, value, merge });
            if (middlewareResult.cancel) {
                return { success: false, cancelled: true, reason: middlewareResult.reason };
            }
            value = middlewareResult.value || value;
        }

        // Save current state to history if needed
        if (saveToHistory) {
            this._saveToHistory();
        }

        // Update state
        const oldValue = this._getByPath(path);
        let newState = this._deepClone(this.state);
        
        if (merge && oldValue && typeof oldValue === 'object' && typeof value === 'object') {
            this._mergeByPath(newState, path, { ...oldValue, ...value });
        } else {
            this._setByPath(newState, path, value);
        }

        // Update state reference
        this.state = newState;
        this.metrics.updates++;

        // Notify subscribers and emit event if not silent
        if (!silent) {
            this._notifySubscribers(path, value, oldValue);
            this.eventBus?.emit('state:changed', {
                path,
                value,
                oldValue,
                timestamp: new Date().toISOString(),
                updateId: Date.now()
            });
        }

        // Auto-persist if enabled
        if (this.config?.state?.autoPersist && !this.isPersisting) {
            this._queuePersist();
        }

        return {
            success: true,
            path,
            value,
            oldValue,
            updateId: Date.now()
        };
    }

    async update(path, updater, options = {}) {
        const currentValue = this.get(path);
        const newValue = typeof updater === 'function' ? updater(currentValue) : updater;
        return this.set(path, newValue, options);
    }

    subscribe(path, callback, options = {}) {
        const {
            immediate = false,
            id = `sub_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
        } = options;

        if (!this.subscribers.has(path)) {
            this.subscribers.set(path, new Map());
        }

        const pathSubscribers = this.subscribers.get(path);
        pathSubscribers.set(id, callback);

        this.metrics.subscriptions++;

        // Trigger immediate callback if requested
        if (immediate) {
            const currentValue = this.get(path);
            setTimeout(() => callback(currentValue, null, path), 0);
        }

        // Return unsubscribe function
        return () => {
            const pathSubs = this.subscribers.get(path);
            if (pathSubs) {
                pathSubs.delete(id);
                if (pathSubs.size === 0) {
                    this.subscribers.delete(path);
                }
            }
        };
    }

    batch(updates, options = {}) {
        const results = [];
        const batchId = `batch_${Date.now()}`;
        
        this.eventBus?.emit('state:batch:start', { batchId, count: updates.length });
        
        // Save current state to history before batch
        this._saveToHistory();
        
        // Apply all updates
        for (const update of updates) {
            const result = this.set(update.path, update.value, { ...options, silent: true, saveToHistory: false });
            results.push(result);
        }
        
        // Notify all subscribers
        this._notifyBatchSubscribers(updates);
        
        this.eventBus?.emit('state:batch:complete', {
            batchId,
            count: updates.length,
            results,
            timestamp: new Date().toISOString()
        });
        
        return { batchId, results };
    }

    undo() {
        if (this.previousStates.length === 0) {
            return { success: false, reason: 'No states to undo' };
        }

        const currentState = this._deepClone(this.state);
        const previousState = this.previousStates.pop();
        
        this.futureStates.push(currentState);
        this.state = previousState;
        this.metrics.undoCount++;

        // Notify all subscribers
        this._notifyAllSubscribers();
        
        this.eventBus?.emit('state:undo', {
            state: this.state,
            remainingUndos: this.previousStates.length,
            redosAvailable: this.futureStates.length
        });

        return { success: true, state: this.state };
    }

    redo() {
        if (this.futureStates.length === 0) {
            return { success: false, reason: 'No states to redo' };
        }

        const currentState = this._deepClone(this.state);
        const futureState = this.futureStates.pop();
        
        this.previousStates.push(currentState);
        this.state = futureState;
        this.metrics.redoCount++;

        // Notify all subscribers
        this._notifyAllSubscribers();
        
        this.eventBus?.emit('state:redo', {
            state: this.state,
            undosAvailable: this.previousStates.length,
            remainingRedos: this.futureStates.length
        });

        return { success: true, state: this.state };
    }

    addMiddleware(middleware) {
        if (typeof middleware !== 'function') {
            throw new Error('Middleware must be a function');
        }
        
        this.middlewares.push(middleware);
        return () => {
            const index = this.middlewares.indexOf(middleware);
            if (index > -1) {
                this.middlewares.splice(index, 1);
            }
        };
    }

    async persist(key = 'vakamova_state') {
        if (this.isPersisting) {
            return { success: false, reason: 'Already persisting' };
        }

        this.isPersisting = true;
        
        try {
            const stateToPersist = this._deepClone(this.state);
            const timestamp = new Date().toISOString();
            
            // Add metadata
            const persistedState = {
                data: stateToPersist,
                metadata: {
                    version: this.config?.app?.version || '1.0.0',
                    timestamp,
                    checksum: this._generateChecksum(stateToPersist),
                    size: JSON.stringify(stateToPersist).length
                }
            };

            // Encrypt if security service is available
            let storageData = persistedState;
            if (this.security?.encrypt) {
                try {
                    storageData = {
                        encrypted: true,
                        data: await this.security.encrypt(JSON.stringify(persistedState))
                    };
                } catch (error) {
                    this.logger?.warn('State encryption failed:', error);
                }
            }

            // Save to localStorage or database
            if (this.database) {
                await this.database.transaction([{
                    type: 'put',
                    store: 'cache',
                    data: {
                        key,
                        value: storageData,
                        category: 'state_persistence',
                        expiresAt: null,
                        timestamp
                    }
                }]);
            } else {
                localStorage.setItem(key, JSON.stringify(storageData));
            }

            this.eventBus?.emit('state:persisted', {
                key,
                timestamp,
                size: storageData.size || JSON.stringify(storageData).length
            });

            return { success: true, key, timestamp };
        } catch (error) {
            this.logger?.error('State persistence failed:', error);
            this.eventBus?.emit('state:persist:error', { error: error.message });
            return { success: false, error: error.message };
        } finally {
            this.isPersisting = false;
        }
    }

    async restore(key = 'vakamova_state') {
        try {
            let storedData;
            
            // Load from database or localStorage
            if (this.database) {
                const result = await this.database.query('cache', {
                    type: 'get',
                    key
                });
                storedData = result?.value;
            } else {
                const item = localStorage.getItem(key);
                storedData = item ? JSON.parse(item) : null;
            }

            if (!storedData) {
                return { success: false, reason: 'No saved state found' };
            }

            // Decrypt if needed
            let persistedState = storedData;
            if (storedData.encrypted && this.security?.decrypt) {
                const decrypted = await this.security.decrypt(storedData.data);
                persistedState = JSON.parse(decrypted);
            }

            // Validate checksum
            if (persistedState.metadata?.checksum) {
                const currentChecksum = this._generateChecksum(persistedState.data);
                if (currentChecksum !== persistedState.metadata.checksum) {
                    this.logger?.warn('State checksum validation failed');
                }
            }

            // Restore state
            this.state = persistedState.data;
            
            // Clear history
            this.previousStates = [];
            this.futureStates = [];

            // Notify all subscribers
            this._notifyAllSubscribers();
            
            this.eventBus?.emit('state:restored', {
                key,
                timestamp: persistedState.metadata?.timestamp,
                size: persistedState.metadata?.size
            });

            return { success: true, state: this.state };
        } catch (error) {
            this.logger?.error('State restoration failed:', error);
            return { success: false, error: error.message };
        }
    }

    getSnapshot() {
        return {
            state: this._deepClone(this.state),
            history: {
                previous: this.previousStates.length,
                future: this.futureStates.length
            },
            subscribers: this.subscribers.size,
            middlewares: this.middlewares.length,
            metrics: { ...this.metrics }
        };
    }

    reset() {
        const oldState = this.state;
        this.state = this._createInitialState();
        this.previousStates = [];
        this.futureStates = [];
        
        this._notifyAllSubscribers();
        this.eventBus?.emit('state:reset', { oldState, newState: this.state });
        
        return { success: true };
    }

    // ==================== PRIVATE METHODS ====================

    _createInitialState() {
        return {
            app: {
                name: 'Vakamova',
                version: this.config?.app?.version || '1.0.0',
                initialized: false,
                lastActive: new Date().toISOString()
            },
            user: {
                isAuthenticated: false,
                data: null,
                preferences: {
                    language: this.config?.defaults?.language || 'en',
                    theme: this.config?.defaults?.theme || 'light',
                    notifications: true,
                    autoPlayAudio: true
                }
            },
            lessons: {
                current: null,
                history: [],
                progress: {},
                statistics: {
                    totalLessons: 0,
                    completedLessons: 0,
                    totalTime: 0,
                    streak: 0
                }
            },
            ui: {
                isLoading: false,
                currentView: 'home',
                modals: [],
                notifications: [],
                sidebarOpen: false
            },
            network: {
                isOnline: navigator.onLine,
                lastSync: null,
                pendingSyncs: []
            }
        };
    }

    _bindMethods() {
        const methods = [
            'get', 'set', 'update', 'subscribe', 'batch',
            'undo', 'redo', 'addMiddleware', 'persist',
            'restore', 'getSnapshot', 'reset'
        ];
        
        methods.forEach(method => {
            this[method] = this[method].bind(this);
        });
    }

    _loadPersistedState() {
        if (this.config?.state?.autoRestore) {
            setTimeout(() => {
                this.restore().catch(error => {
                    this.logger?.warn('Auto-restore failed:', error);
                });
            }, 100);
        }
    }

    _setupAutoPersist() {
        if (this.config?.state?.autoPersistInterval) {
            if (this.autoSaveInterval) {
                clearInterval(this.autoSaveInterval);
            }
            
            this.autoSaveInterval = setInterval(() => {
                if (!this.isPersisting) {
                    this.persist().catch(error => {
                        this.logger?.warn('Auto-persist failed:', error);
                    });
                }
            }, this.config.state.autoPersistInterval);
        }
    }

    _queuePersist() {
        if (this.persistTimeout) {
            clearTimeout(this.persistTimeout);
        }
        
        this.persistTimeout = setTimeout(() => {
            this.persist().catch(error => {
                this.logger?.warn('Queued persist failed:', error);
            });
        }, 1000); // Debounce 1 second
    }

    _getByPath(path, defaultValue = undefined) {
        const keys = Array.isArray(path) ? path : path.split('.');
        let current = this.state;
        
        for (const key of keys) {
            if (current && typeof current === 'object' && key in current) {
                current = current[key];
            } else {
                return defaultValue;
            }
        }
        
        return this._deepClone(current);
    }

    _setByPath(obj, path, value) {
        const keys = Array.isArray(path) ? path : path.split('.');
        let current = obj;
        
        for (let i = 0; i < keys.length - 1; i++) {
            const key = keys[i];
            if (!(key in current) || typeof current[key] !== 'object') {
                current[key] = {};
            }
            current = current[key];
        }
        
        current[keys[keys.length - 1]] = this._deepClone(value);
    }

    _mergeByPath(obj, path, value) {
        const current = this._getByPath(path, {});
        if (typeof current === 'object' && typeof value === 'object') {
            this._setByPath(obj, path, { ...current, ...value });
        }
    }

    _deepClone(obj) {
        if (obj === null || typeof obj !== 'object') return obj;
        if (obj instanceof Date) return new Date(obj.getTime());
        if (Array.isArray(obj)) return obj.map(item => this._deepClone(item));
        
        const cloned = {};
        for (const key in obj) {
            if (obj.hasOwnProperty(key)) {
                cloned[key] = this._deepClone(obj[key]);
            }
        }
        return cloned;
    }

    _saveToHistory() {
        if (this.previousStates.length >= this.maxHistory) {
            this.previousStates.shift();
        }
        this.previousStates.push(this._deepClone(this.state));
        this.futureStates = []; // Clear redo stack on new action
    }

    async _runMiddlewares(phase, data) {
        if (this.middlewares.length === 0) {
            return data;
        }

        this.metrics.middlewareExecutions++;
        
        let result = { ...data, cancel: false };
        for (const middleware of this.middlewares) {
            try {
                const middlewareResult = await middleware(phase, result);
                if (middlewareResult) {
                    if (middlewareResult.cancel) {
                        return { cancel: true, reason: middlewareResult.reason };
                    }
                    result = { ...result, ...middlewareResult };
                }
            } catch (error) {
                this.logger?.warn('Middleware execution failed:', error);
            }
        }
        
        return result;
    }

    _notifySubscribers(path, newValue, oldValue) {
        const pathSubscribers = this.subscribers.get(path);
        if (pathSubscribers) {
            pathSubscribers.forEach(callback => {
                try {
                    callback(newValue, oldValue, path);
                } catch (error) {
                    this.logger?.error('Subscriber callback error:', error);
                }
            });
        }

        // Also notify wildcard subscribers
        const wildcardSubscribers = this.subscribers.get('*');
        if (wildcardSubscribers) {
            wildcardSubscribers.forEach(callback => {
                try {
                    callback(newValue, oldValue, path);
                } catch (error) {
                    this.logger?.error('Wildcard subscriber callback error:', error);
                }
            });
        }
    }

    _notifyBatchSubscribers(updates) {
        // Notify specific path subscribers
        updates.forEach(update => {
            this._notifySubscribers(update.path, update.value, null);
        });

        // Notify wildcard subscribers of batch
        const wildcardSubscribers = this.subscribers.get('*');
        if (wildcardSubscribers) {
            wildcardSubscribers.forEach(callback => {
                try {
                    callback(updates, null, 'batch');
                } catch (error) {
                    this.logger?.error('Batch subscriber callback error:', error);
                }
            });
        }
    }

    _notifyAllSubscribers() {
        // Notify all subscribers with the entire state
        this.subscribers.forEach((callbacks, path) => {
            if (path !== '*') {
                const value = this.get(path);
                callbacks.forEach(callback => {
                    try {
                        callback(value, null, path);
                    } catch (error) {
                        this.logger?.error('Subscriber callback error:', error);
                    }
                });
            }
        });

        // Notify wildcard subscribers
        const wildcardSubscribers = this.subscribers.get('*');
        if (wildcardSubscribers) {
            const fullState = this.get();
            wildcardSubscribers.forEach(callback => {
                try {
                    callback(fullState, null, '*');
                } catch (error) {
                    this.logger?.error('Wildcard subscriber callback error:', error);
                }
            });
        }
    }

    _generateChecksum(obj) {
        const str = JSON.stringify(obj);
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return hash.toString(36);
    }
}

// Export as singleton or class
if (typeof window !== 'undefined') {
    window.VakamovaStateManager = VakamovaStateManager;
}

export default VakamovaStateManager;
