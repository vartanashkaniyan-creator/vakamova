
// ==================== CORE_STATE.JS ====================
// Vakamova - Professional State Management System
// Principles: 1. Dependency Injection 2. Interface Contract 
//             3. Event-Driven 4. Centralized Config

class StateManager {
    // ==================== INTERFACE CONTRACT ====================
    static CONTRACT = {
        name: 'StateManager',
        version: '1.0.0',
        requiredMethods: ['init', 'get', 'set', 'update', 'subscribe', 'unsubscribe', 'undo', 'redo', 'clear'],
        events: ['state:changed', 'state:error', 'state:restored']
    };

    // ==================== DEPENDENCY INJECTION ====================
    constructor(dependencies = {}) {
        // Required Dependencies (injected)
        this.config = dependencies.config || console;
        this.eventBus = dependencies.eventBus || this.createFallbackEventBus();
        this.logger = dependencies.logger || console;
        this.storage = dependencies.storage || localStorage;
        
        // Optional Dependencies
        this.validator = dependencies.validator || this.defaultValidator;
        this.encryptor = dependencies.encryptor || null;
        
        // Internal State
        this.state = new Map();
        this.stateHistory = [];
        this.historyPointer = -1;
        this.maxHistory = 100;
        this.subscriptions = new Map();
        this.isInitialized = false;
        this.pendingUpdates = new Map();
        
        // Configuration
        this.settings = {
            autoSave: true,
            saveInterval: 2000,
            maxStateSize: 1024 * 1024, // 1MB
            encryptSensitive: false,
            compression: false,
            debug: false
        };
        
        // Merge with external config
        if (dependencies.config?.state) {
            this.settings = { ...this.settings, ...dependencies.config.state };
        }
        
        this.initInternal();
    }

    // ==================== INITIALIZATION ====================
    async init(initialState = {}) {
        if (this.isInitialized) {
            this.logger.warn('[StateManager] Already initialized');
            return this;
        }

        try {
            // Load persisted state
            await this.loadPersistedState();
            
            // Merge with initial state
            this.mergeState(initialState);
            
            // Setup auto-save if enabled
            if (this.settings.autoSave) {
                this.setupAutoSave();
            }
            
            // Setup event listeners
            this.setupEventListeners();
            
            this.isInitialized = true;
            this.emit('state:initialized', { timestamp: Date.now() });
            this.logger.log('[StateManager] Initialized successfully');
            
            return this;
        } catch (error) {
            this.handleError('Initialization failed', error);
            throw error;
        }
    }

    // ==================== CORE STATE METHODS ====================
    get(key, defaultValue = null) {
        this.validateKey(key);
        
        if (this.state.has(key)) {
            const value = this.state.get(key);
            return this.decryptIfNeeded(value);
        }
        
        // Check nested paths (e.g., 'user.profile.name')
        if (typeof key === 'string' && key.includes('.')) {
            return this.getNested(key, defaultValue);
        }
        
        return defaultValue;
    }

    set(key, value, options = {}) {
        this.validateKey(key);
        this.validateValue(value);
        
        const oldValue = this.get(key);
        
        // Skip if value unchanged (unless forced)
        if (!options.force && this.isEqual(oldValue, value)) {
            return false;
        }
        
        // Add to history for undo/redo
        if (options.trackHistory !== false) {
            this.addToHistory(key, oldValue, value);
        }
        
        // Encrypt sensitive data if needed
        const processedValue = this.processValueBeforeStore(value, options);
        
        // Store in state
        this.state.set(key, processedValue);
        
        // Emit change event
        this.emitChange(key, oldValue, value, options);
        
        // Trigger auto-save
        if (this.settings.autoSave && options.persist !== false) {
            this.scheduleSave();
        }
        
        return true;
    }

    update(key, updates, options = {}) {
        const current = this.get(key, {});
        
        if (typeof current !== 'object' || current === null) {
            throw new Error(`Cannot update non-object key: ${key}`);
        }
        
        const newValue = { ...current, ...updates };
        return this.set(key, newValue, options);
    }

    // ==================== BATCH OPERATIONS ====================
    batch(operations) {
        const results = [];
        const changes = [];
        
        try {
            // Start batch
            this.beginBatch();
            
            // Execute operations
            operations.forEach(({ type, key, value, options = {} }) => {
                let result;
                switch (type) {
                    case 'set':
                        result = this.set(key, value, { ...options, trackHistory: false });
                        changes.push({ key, oldValue: this.get(key), newValue: value });
                        break;
                    case 'update':
                        result = this.update(key, value, { ...options, trackHistory: false });
                        changes.push({ key, oldValue: this.get(key), newValue: value });
                        break;
                    case 'delete':
                        result = this.delete(key, { ...options, trackHistory: false });
                        changes.push({ key, oldValue: this.get(key), newValue: undefined });
                        break;
                    default:
                        throw new Error(`Unknown operation type: ${type}`);
                }
                results.push(result);
            });
            
            // Commit batch
            this.commitBatch(changes);
            
            return results;
        } catch (error) {
            this.rollbackBatch();
            throw error;
        }
    }

    // ==================== SUBSCRIPTION SYSTEM ====================
    subscribe(keyOrPattern, callback, options = {}) {
        const subscriptionId = this.generateId('sub_');
        const subscription = {
            id: subscriptionId,
            pattern: keyOrPattern,
            callback,
            options: { immediate: false, ...options }
        };
        
        if (!this.subscriptions.has(keyOrPattern)) {
            this.subscriptions.set(keyOrPattern, new Map());
        }
        
        this.subscriptions.get(keyOrPattern).set(subscriptionId, subscription);
        
        // Trigger immediate callback if requested
        if (options.immediate) {
            const currentValue = this.get(keyOrPattern);
            setTimeout(() => callback(currentValue, undefined, keyOrPattern), 0);
        }
        
        return subscriptionId;
    }

    unsubscribe(subscriptionId) {
        for (const [pattern, subs] of this.subscriptions) {
            if (subs.has(subscriptionId)) {
                subs.delete(subscriptionId);
                
                // Cleanup empty pattern
                if (subs.size === 0) {
                    this.subscriptions.delete(pattern);
                }
                
                return true;
            }
        }
        return false;
    }

    // ==================== UNDO/REDO SYSTEM ====================
    undo() {
        if (this.historyPointer < 0) return false;
        
        const historyItem = this.stateHistory[this.historyPointer];
        this.state.set(historyItem.key, historyItem.oldValue);
        this.historyPointer--;
        
        this.emit('state:undo', { 
            key: historyItem.key, 
            value: historyItem.oldValue 
        });
        
        return true;
    }

    redo() {
        if (this.historyPointer >= this.stateHistory.length - 1) return false;
        
        this.historyPointer++;
        const historyItem = this.stateHistory[this.historyPointer];
        this.state.set(historyItem.key, historyItem.newValue);
        
        this.emit('state:redo', { 
            key: historyItem.key, 
            value: historyItem.newValue 
        });
        
        return true;
    }

    // ==================== PERSISTENCE ====================
    async save() {
        try {
            const stateObj = this.serializeState();
            
            if (this.settings.encryptSensitive && this.encryptor) {
                const encrypted = await this.encryptor.encrypt(JSON.stringify(stateObj));
                this.storage.setItem('vakamova_state', encrypted);
            } else {
                this.storage.setItem('vakamova_state', JSON.stringify(stateObj));
            }
            
            this.emit('state:saved', { timestamp: Date.now(), size: JSON.stringify(stateObj).length });
            return true;
        } catch (error) {
            this.handleError('Save failed', error);
            return false;
        }
    }

    async load() {
        try {
            let data = this.storage.getItem('vakamova_state');
            
            if (!data) return {};
            
            if (this.settings.encryptSensitive && this.encryptor) {
                data = await this.encryptor.decrypt(data);
            }
            
            const parsed = JSON.parse(data);
            this.state = new Map(Object.entries(parsed));
            
            this.emit('state:loaded', { timestamp: Date.now(), keys: Object.keys(parsed).length });
            return parsed;
        } catch (error) {
            this.handleError('Load failed', error);
            return {};
        }
    }

    // ==================== UTILITY METHODS ====================
    clear(options = {}) {
        const clearedKeys = Array.from(this.state.keys());
        const clearedState = Object.fromEntries(this.state);
        
        this.state.clear();
        this.stateHistory = [];
        this.historyPointer = -1;
        
        if (options.clearPersisted !== false) {
            this.storage.removeItem('vakamova_state');
        }
        
        this.emit('state:cleared', { keys: clearedKeys, timestamp: Date.now() });
        
        return clearedState;
    }

    snapshot() {
        return Object.fromEntries(this.state);
    }

    restore(snapshot) {
        if (!snapshot || typeof snapshot !== 'object') {
            throw new Error('Invalid snapshot');
        }
        
        const oldState = this.snapshot();
        this.state = new Map(Object.entries(snapshot));
        
        this.emit('state:restored', { 
            oldState, 
            newState: snapshot,
            timestamp: Date.now() 
        });
        
        return true;
    }

    // ==================== PRIVATE METHODS ====================
    initInternal() {
        // Initialize internal structures
        this.debouncedSave = this.debounce(() => this.save(), this.settings.saveInterval);
        this.batchStack = [];
        this.currentBatch = null;
    }

    emitChange(key, oldValue, newValue, options = {}) {
        // Notify event bus
        this.emit('state:changed', { 
            key, 
            oldValue, 
            newValue,
            source: options.source || 'manual',
            timestamp: Date.now()
        });
        
        // Notify subscribers
        this.notifySubscribers(key, oldValue, newValue);
        
        // Pattern-based subscribers (e.g., 'user.*')
        this.notifyPatternSubscribers(key, oldValue, newValue);
    }

    notifySubscribers(key, oldValue, newValue) {
        const subs = this.subscriptions.get(key);
        if (subs) {
            subs.forEach(sub => {
                try {
                    sub.callback(newValue, oldValue, key);
                } catch (error) {
                    this.logger.error(`[StateManager] Subscriber error for key ${key}:`, error);
                }
            });
        }
    }

    notifyPatternSubscribers(changedKey, oldValue, newValue) {
        // Check for pattern subscriptions (e.g., 'user.*', '*.profile')
        for (const [pattern, subs] of this.subscriptions) {
            if (pattern.includes('*') && this.matchesPattern(changedKey, pattern)) {
                subs.forEach(sub => {
                    try {
                        sub.callback(newValue, oldValue, changedKey);
                    } catch (error) {
                        this.logger.error(`[StateManager] Pattern subscriber error for ${pattern}:`, error);
                    }
                });
            }
        }
    }

    // ==================== HELPER METHODS ====================
    validateKey(key) {
        if (key === undefined || key === null || key === '') {
            throw new Error('State key cannot be empty');
        }
        
        // Prevent internal keys
        if (typeof key === 'string' && key.startsWith('_')) {
            throw new Error('State key cannot start with underscore');
        }
        
        // Check size limit
        if (this.settings.maxStateSize && JSON.stringify(key).length > 1000) {
            throw new Error('State key too large');
        }
    }

    validateValue(value) {
        // Check circular references
        try {
            JSON.stringify(value);
        } catch (error) {
            throw new Error('State value contains circular reference');
        }
        
        // Check size limit
        if (this.settings.maxStateSize) {
            const size = new Blob([JSON.stringify(value)]).size;
            if (size > this.settings.maxStateSize) {
                throw new Error(`State value too large: ${size} bytes (max: ${this.settings.maxStateSize})`);
            }
        }
    }

    isEqual(a, b) {
        if (a === b) return true;
        if (typeof a !== typeof b) return false;
        
        try {
            return JSON.stringify(a) === JSON.stringify(b);
        } catch {
            return false;
        }
    }

    // ==================== EVENT BUS INTEGRATION ====================
    emit(event, data) {
        if (this.eventBus && typeof this.eventBus.emit === 'function') {
            this.eventBus.emit(event, data);
        } else if (this.settings.debug) {
            this.logger.log(`[StateManager Event] ${event}:`, data);
        }
    }

    createFallbackEventBus() {
        return {
            events: new Map(),
            emit(event, data) {
                const handlers = this.events.get(event) || [];
                handlers.forEach(handler => {
                    try {
                        handler(data);
                    } catch (error) {
                        console.error(`Event handler error for ${event}:`, error);
                    }
                });
            },
            on(event, handler) {
                if (!this.events.has(event)) {
                    this.events.set(event, []);
                }
                this.events.get(event).push(handler);
            }
        };
    }

    // ==================== SERIALIZATION ====================
    serializeState() {
        const obj = {};
        for (const [key, value] of this.state) {
            // Skip internal properties
            if (key.startsWith('_')) continue;
            
            // Process value for serialization
            obj[key] = this.processValueForSerialization(value);
        }
        return obj;
    }

    // ==================== ERROR HANDLING ====================
    handleError(context, error) {
        const errorObj = {
            context,
            error: error.message,
            timestamp: Date.now(),
            stateSnapshot: this.snapshot()
        };
        
        this.logger.error(`[StateManager] ${context}:`, error);
        this.emit('state:error', errorObj);
        
        if (this.settings.debug) {
            console.trace();
        }
    }

    // ==================== UTILITIES ====================
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    generateId(prefix = '') {
        return prefix + Date.now().toString(36) + Math.random().toString(36).substr(2);
    }

    // ==================== DEFAULT IMPLEMENTATIONS ====================
    defaultValidator(key, value) {
        return { valid: true, errors: [] };
    }

    processValueBeforeStore(value, options) {
        // Clone to prevent reference issues
        let processed = this.deepClone(value);
        
        // Add metadata
        if (options.addMetadata !== false) {
            processed = {
                _value: processed,
                _meta: {
                    updatedAt: new Date().toISOString(),
                    version: 1,
                    source: options.source || 'state-manager'
                }
            };
        }
        
        return processed;
    }

    decryptIfNeeded(value) {
        if (value && value._meta && value._meta.encrypted && this.encryptor) {
            return this.encryptor.decrypt(value._value);
        }
        return value._value || value;
    }

    deepClone(obj) {
        if (obj === null || typeof obj !== 'object') return obj;
        if (obj instanceof Date) return new Date(obj);
        if (obj instanceof RegExp) return new RegExp(obj);
        
        const cloned = Array.isArray(obj) ? [] : {};
        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                cloned[key] = this.deepClone(obj[key]);
            }
        }
        return cloned;
    }
}

// ==================== EXPORT ====================
export default StateManager;

// Auto-initialize if loaded directly in browser
if (typeof window !== 'undefined' && !window.VakamovaStateManager) {
    window.VakamovaStateManager = StateManager;
              }
