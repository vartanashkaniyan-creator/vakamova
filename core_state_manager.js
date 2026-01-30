// ==================== STATE MANAGER (COMPLETE STANDALONE VERSION) ====================
// HyperLang - Professional State Management (No Dependencies)
// Version: 2.0.0 | Standalone | No Imports Needed

class StateManager {
    constructor(options = {}) {
        // Configuration
        this.config = {
            name: options.name || 'global',
            encrypt: options.encrypt || false,
            maxHistory: options.maxHistory || 50,
            autoSave: options.autoSave || true,
            debug: options.debug || true,
            ...options
        };
        
        // Core State
        this.state = this.initializeState(options.initialState || {});
        this.history = [];
        this.future = [];
        this.listeners = new Map();
        this.isUpdating = false;
        this.isBatching = false;
        this.batchQueue = [];
        
        // Internal Event System (replaces event-bus dependency)
        this.events = new Map();
        
        // Metadata
        this.metadata = {
            version: '2.0.0',
            created: Date.now(),
            modifications: 0,
            checksum: this.generateChecksum(this.state)
        };
        
        // Setup
        this.setupAutoSave();
        this.setupDebug();
        
        this.log(`StateManager "${this.config.name}" initialized`);
    }
    
    // ==================== CORE METHODS ====================
    
    getState(path = null) {
        if (!path) return JSON.parse(JSON.stringify(this.state));
        return this.getByPath(this.state, path);
    }
    
    setState(updater, description = '') {
        if (this.isUpdating) {
            throw new Error('State update already in progress');
        }
        
        this.isUpdating = true;
        
        try {
            // Save to history
            if (this.history.length < this.config.maxHistory) {
                this.history.push({
                    state: JSON.parse(JSON.stringify(this.state)),
                    timestamp: Date.now(),
                    description
                });
            }
            
            // Clear redo future
            this.future = [];
            
            // Calculate new state
            const newState = typeof updater === 'function' 
                ? updater(JSON.parse(JSON.stringify(this.state)))
                : { ...JSON.parse(JSON.stringify(this.state)), ...updater };
            
            // Validate
            this.validateState(newState);
            
            // Update
            const oldState = this.state;
            this.state = newState;
            
            // Update metadata
            this.metadata.modifications++;
            this.metadata.lastModified = Date.now();
            this.metadata.checksum = this.generateChecksum(newState);
            
            // Notify listeners
            this.notifyListeners(oldState, newState, description);
            
            // Emit internal event
            this.emitEvent('state:changed', {
                oldState,
                newState,
                description,
                source: 'internal'
            });
            
            // Auto-save if enabled
            if (this.config.autoSave) {
                this.saveToStorage();
            }
            
            return true;
            
        } catch (error) {
            this.emitEvent('state:error', { error: error.message });
            throw error;
            
        } finally {
            this.isUpdating = false;
        }
    }
    
    // ==================== BATCH OPERATIONS ====================
    
    batch(operations, description = 'batch') {
        this.isBatching = true;
        
        try {
            const result = operations(this);
            this.flushBatch(description);
            return result;
        } finally {
            this.isBatching = false;
        }
    }
    
    enqueueUpdate(updater) {
        if (this.isBatching) {
            this.batchQueue.push(updater);
        } else {
            this.setState(updater);
        }
    }
    
    flushBatch(description = 'batch') {
        if (this.batchQueue.length === 0) return;
        
        const batchResult = this.batchQueue.reduce((state, update) => {
            return typeof update === 'function' 
                ? update(state)
                : { ...state, ...update };
        }, JSON.parse(JSON.stringify(this.state)));
        
        this.setState(batchResult, description);
        this.batchQueue = [];
    }
    
    // ==================== UNDO/REDO ====================
    
    undo() {
        if (this.history.length === 0) return false;
        
        const previous = this.history.pop();
        this.future.push({
            state: JSON.parse(JSON.stringify(this.state)),
            timestamp: Date.now(),
            description: 'undo'
        });
        
        this.state = previous.state;
        this.notifyListeners(this.state, previous.state, 'undo');
        
        this.emitEvent('state:undo', { 
            state: this.state,
            previousState: previous.state 
        });
        
        return true;
    }
    
    redo() {
        if (this.future.length === 0) return false;
        
        const next = this.future.pop();
        this.history.push({
            state: JSON.parse(JSON.stringify(this.state)),
            timestamp: Date.now(),
            description: 'redo'
        });
        
        this.state = next.state;
        this.notifyListeners(this.state, next.state, 'redo');
        
        this.emitEvent('state:redo', {
            state: this.state,
            nextState: next.state
        });
        
        return true;
    }
    
    // ==================== SUBSCRIPTION SYSTEM ====================
    
    subscribe(key, callback) {
        if (!this.listeners.has(key)) {
            this.listeners.set(key, new Set());
        }
        
        this.listeners.get(key).add(callback);
        
        this.log(`Listener added for key: ${key}`);
        
        // Return unsubscribe function
        return () => {
            if (this.listeners.has(key)) {
                this.listeners.get(key).delete(callback);
                this.log(`Listener removed for key: ${key}`);
            }
        };
    }
    
    subscribeToPath(path, callback) {
        const id = `path_${path}_${Date.now()}`;
        const currentValue = this.getByPath(this.state, path);
        
        if (!this.listeners.has(id)) {
            this.listeners.set(id, new Set());
        }
        
        const listenerWrapper = (newState, oldState) => {
            const newValue = this.getByPath(newState, path);
            const oldValue = this.getByPath(oldState, path);
            
            if (JSON.stringify(newValue) !== JSON.stringify(oldValue)) {
                callback(newValue, oldValue);
            }
        };
        
        this.listeners.get(id).add(listenerWrapper);
        
        return () => {
            if (this.listeners.has(id)) {
                this.listeners.get(id).delete(listenerWrapper);
            }
        };
    }
    
    unsubscribe(key, callback) {
        if (this.listeners.has(key)) {
            const removed = this.listeners.get(key).delete(callback);
            if (removed) {
                this.log(`Unsubscribed from key: ${key}`);
            }
            return removed;
        }
        return false;
    }
    
    notifyListeners(oldState, newState, description) {
        for (const [key, callbacks] of this.listeners) {
            if (key.startsWith('path_')) {
                // Path listeners
                callbacks.forEach(callback => {
                    try {
                        callback(newState, oldState, description);
                    } catch (error) {
                        console.error(`Path listener error for ${key}:`, error);
                    }
                });
            } else if (key in newState || key in oldState) {
                // Key-based listeners
                callbacks.forEach(callback => {
                    try {
                        callback(newState[key], oldState[key], description);
                    } catch (error) {
                        console.error(`Listener error for ${key}:`, error);
                    }
                });
            }
        }
    }
    
    // ==================== EVENT SYSTEM (INTERNAL) ====================
    
    on(event, callback) {
        if (!this.events.has(event)) {
            this.events.set(event, new Set());
        }
        this.events.get(event).add(callback);
        
        return () => this.off(event, callback);
    }
    
    off(event, callback) {
        if (this.events.has(event)) {
            return this.events.get(event).delete(callback);
        }
        return false;
    }
    
    emitEvent(event, data) {
        if (this.events.has(event)) {
            this.events.get(event).forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    console.error(`Event handler error for ${event}:`, error);
                }
            });
        }
    }
    
    // ==================== PERSISTENCE ====================
    
    saveToStorage(key = null) {
        try {
            const storageKey = key || `hyperlang_state_${this.config.name}`;
            const data = {
                state: this.state,
                metadata: this.metadata,
                version: '2.0.0',
                savedAt: Date.now()
            };
            
            localStorage.setItem(storageKey, JSON.stringify(data));
            
            this.emitEvent('state:saved', {
                key: storageKey,
                size: JSON.stringify(data).length,
                timestamp: Date.now()
            });
            
            return true;
        } catch (error) {
            console.error('Failed to save state:', error);
            return false;
        }
    }
    
    loadFromStorage(key = null) {
        try {
            const storageKey = key || `hyperlang_state_${this.config.name}`;
            const stored = localStorage.getItem(storageKey);
            
            if (!stored) {
                this.log('No stored state found');
                return false;
            }
            
            const data = JSON.parse(stored);
            
            if (data.version !== '2.0.0') {
                console.warn('State version mismatch:', data.version);
                return false;
            }
            
            this.state = data.state;
            this.metadata = data.metadata;
            this.history = [];
            this.future = [];
            
            this.notifyListeners({}, this.state, 'loaded from storage');
            this.emitEvent('state:loaded', {
                key: storageKey,
                timestamp: Date.now()
            });
            
            return true;
        } catch (error) {
            console.error('Failed to load state:', error);
            return false;
        }
    }
    
    clearStorage(key = null) {
        const storageKey = key || `hyperlang_state_${this.config.name}`;
        localStorage.removeItem(storageKey);
        this.log(`Storage cleared for key: ${storageKey}`);
    }
    
    // ==================== UTILITY METHODS ====================
    
    initializeState(initialState) {
        const defaultState = {
            app: {
                name: 'HyperLang',
                version: '1.0.0',
                theme: 'dark',
                language: 'fa',
                isLoading: false
            },
            user: {
                id: null,
                name: 'Guest',
                email: null,
                isAuthenticated: false,
                level: 'beginner',
                streak: 0
            },
            lessons: {
                current: null,
                completed: [],
                progress: {}
            },
            ui: {
                sidebarOpen: true,
                notifications: true,
                soundEnabled: true
            }
        };
        
        return this.deepMerge(defaultState, initialState);
    }
    
    deepMerge(target, source) {
        const output = { ...target };
        
        if (this.isObject(target) && this.isObject(source)) {
            Object.keys(source).forEach(key => {
                if (this.isObject(source[key])) {
                    if (!(key in target)) {
                        output[key] = source[key];
                    } else {
                        output[key] = this.deepMerge(target[key], source[key]);
                    }
                } else {
                    output[key] = source[key];
                }
            });
        }
        
        return output;
    }
    
    isObject(item) {
        return item && typeof item === 'object' && !Array.isArray(item);
    }
    
    getByPath(obj, path) {
        return path.split('.').reduce((current, key) => {
            return current && typeof current === 'object' && key in current 
                ? current[key] 
                : undefined;
        }, obj);
    }
    
    setByPath(obj, path, value) {
        const keys = path.split('.');
        const lastKey = keys.pop();
        const target = keys.reduce((current, key) => {
            if (!(key in current)) {
                current[key] = {};
            }
            return current[key];
        }, obj);
        
        target[lastKey] = value;
        return obj;
    }
    
    validateState(state) {
        // Basic validation - can be extended
        if (!state || typeof state !== 'object') {
            throw new Error('State must be an object');
        }
        
        if (Array.isArray(state)) {
            throw new Error('State cannot be an array');
        }
        
        // Check for functions (not allowed in state)
        const hasFunctions = JSON.stringify(state, (key, value) => {
            if (typeof value === 'function') {
                throw new Error(`Functions not allowed in state (key: ${key})`);
            }
            return value;
        });
        
        return true;
    }
    
    generateChecksum(data) {
        const str = JSON.stringify(data);
        let hash = 0;
        
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        
        return hash.toString(16);
    }
    
    // ==================== DEBUG & LOGGING ====================
    
    setupDebug() {
        if (this.config.debug) {
            // Expose to window for debugging
            window[`stateManager_${this.config.name}`] = this;
            
            // Log initial state
            this.log('Initial state:', this.state);
        }
    }
    
    setupAutoSave() {
        if (this.config.autoSave) {
            // Auto-save every 30 seconds
            this.autoSaveInterval = setInterval(() => {
                this.saveToStorage();
            }, 30000);
            
            // Save on page unload
            window.addEventListener('beforeunload', () => {
                this.saveToStorage();
            });
        }
    }
    
    log(...args) {
        if (this.config.debug) {
            console.log(`[StateManager:${this.config.name}]`, ...args);
        }
    }
    
    // ==================== DEBUG METHODS ====================
    
    getHistorySize() {
        return this.history.length;
    }
    
    getFutureSize() {
        return this.future.length;
    }
    
    getListenerCount() {
        let count = 0;
        for (const callbacks of this.listeners.values()) {
            count += callbacks.size;
        }
        return count;
    }
    
    getMetadata() {
        return { ...this.metadata };
    }
    
    // ==================== RESET & DESTROY ====================
    
    reset() {
        const oldState = this.state;
        this.state = this.initializeState({});
        this.history = [];
        this.future = [];
        
        this.notifyListeners(oldState, this.state, 'reset');
        this.emitEvent('state:reset', { 
            oldState, 
            newState: this.state 
        });
        
        this.log('State reset to initial values');
    }
    
    destroy() {
        // Clear intervals
        if (this.autoSaveInterval) {
            clearInterval(this.autoSaveInterval);
        }
        
        // Clear listeners
        this.listeners.clear();
        this.events.clear();
        
        // Clear from window
        if (this.config.debug) {
            delete window[`stateManager_${this.config.name}`];
        }
        
        this.log('StateManager destroyed');
    }
    
    // ==================== QUICK API (for easy use) ====================
    
    get(path) {
        return this.getByPath(this.state, path);
    }
    
    set(path, value) {
        const newState = JSON.parse(JSON.stringify(this.state));
        this.setByPath(newState, path, value);
        return this.setState(newState, `set ${path}`);
    }
    
    update(path, updater) {
        const current = this.getByPath(this.state, path);
        const newValue = typeof updater === 'function' ? updater(current) : updater;
        return this.set(path, newValue);
    }
    
    toggle(path) {
        const current = this.getByPath(this.state, path);
        if (typeof current === 'boolean') {
            return this.set(path, !current);
        }
        return false;
    }
    
    increment(path, amount = 1) {
        const current = this.getByPath(this.state, path);
        if (typeof current === 'number') {
            return this.set(path, current + amount);
        }
        return false;
    }
    
    push(path, item) {
        const current = this.getByPath(this.state, path);
        if (Array.isArray(current)) {
            const newArray = [...current, item];
            return this.set(path, newArray);
        }
        return false;
    }
}

// ==================== GLOBAL INSTANCE ====================

// Create default global instance
const stateManager = new StateManager({
    name: 'global',
    debug: true,
    autoSave: true,
    maxHistory: 100
});

// Auto-load from storage on init
setTimeout(() => {
    stateManager.loadFromStorage();
}, 100);

// Export for ES6 modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { StateManager, stateManager };
}

// Make available globally for browser
if (typeof window !== 'undefined') {
    window.StateManager = StateManager;
    window.stateManager = stateManager;
}

console.log('✅ StateManager 2.0.0 loaded (Standalone Version)');

// Optional: Initialize with some demo data for testing
if (typeof window !== 'undefined' && window.location.href.includes('debug')) {
    setTimeout(() => {
        stateManager.setState({
            user: { 
                name: 'تست کاربر', 
                level: 'intermediate',
                streak: 7 
            },
            app: { 
                theme: 'dark',
                language: 'fa'
            }
        }, 'demo initialization');
        
        console.log('Demo state initialized:', stateManager.getState());
    }, 500);
    }
