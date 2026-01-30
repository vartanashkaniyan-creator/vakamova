/**
 * HyperLang - State Management System with Interface Contract
 * Version: 1.0.0
 * Principle: Interface Contract + Dependency Injection + Event-Driven
 */

import { CONFIG } from './config.js';
import { context } from './context-provider.js';
import { eventBus, EVENT_CONTRACT } from './event-bus.js';

// ==================== STATE CONTRACT INTERFACE ====================

export const STATE_CONTRACT = {
    // Core State Structure
    state: 'object',
    
    // State Metadata
    metadata: {
        version: 'string',
        timestamp: 'number',
        checksum: 'string?',
        source: 'string?'
    },
    
    // State Methods Contract
    methods: {
        getState: 'function',
        setState: 'function',
        subscribe: 'function',
        unsubscribe: 'function',
        getSnapshot: 'function',
        replaceState: 'function'
    },
    
    // State Events Contract
    events: {
        'state:changed': 'function',
        'state:beforeChange': 'function',
        'state:error': 'function',
        'state:restored': 'function'
    },
    
    // Validation Rules
    validation: {
        schema: 'object?',
        strict: 'boolean?',
        onChange: 'boolean?'
    }
};

// ==================== STATE MANAGER CLASS ====================

export class StateManager {
    constructor(options = {}) {
        // Dependency Injection
        this.config = context.get('config')?.STATE || CONFIG.STATE;
        this.logger = context.get('logger');
        this.eventBus = context.get('eventBus') || eventBus;
        
        // Configuration
        this.options = {
            name: options.name || 'global',
            initialState: options.initialState || this.createInitialState(),
            schema: options.schema || null,
            strict: options.strict ?? this.config.VALIDATE_ON_CHANGE,
            encrypt: options.encrypt ?? this.config.ENCRYPT_SENSITIVE,
            maxHistory: options.maxHistory || this.config.MAX_HISTORY,
            autoSave: options.autoSave ?? true,
            autoSaveInterval: options.autoSaveInterval || this.config.AUTO_SAVE_INTERVAL,
            middleware: options.middleware || [],
            ...options
        };
        
        // State Properties
        this.state = this.initializeState(this.options.initialState);
        this.history = [];
        this.future = [];
        this.listeners = new Map();
        this.middleware = [...this.options.middleware];
        this.isUpdating = false;
        this.batchQueue = [];
        this.isBatching = false;
        
        // State Metadata
        this.metadata = {
            version: '1.0.0',
            name: this.options.name,
            created: Date.now(),
            lastModified: Date.now(),
            modifications: 0,
            checksum: this.generateChecksum(this.state)
        };
        
        // Setup
        this.setupEventListeners();
        this.setupAutoSave();
        this.setupDevTools();
        
        // Register with context
        context.register(`state:${this.options.name}`, {
            factory: () => this,
            dependencies: ['config', 'logger', 'eventBus'],
            lifecycle: 'singleton'
        });
        
        this.logger?.log(`StateManager "${this.options.name}" initialized`);
    }
    
    // ==================== CORE STATE METHODS ====================
    
    getState(path = null) {
        if (!path) {
            return this.deepClone(this.state);
        }
        
        return this.getByPath(this.state, path);
    }
    
    setState(updater, description = '') {
        if (this.isUpdating) {
            throw new Error('Cannot set state while another update is in progress');
        }
        
        this.isUpdating = true;
        
        try {
            // Run beforeChange middleware
            const beforeResult = this.runMiddleware('beforeChange', {
                current: this.state,
                updater,
                description
            });
            
            if (beforeResult === false) {
                this.isUpdating = false;
                return false;
            }
            
            // Save to history for undo
            if (this.history.length < this.options.maxHistory) {
                this.history.push({
                    state: this.deepClone(this.state),
                    timestamp: Date.now(),
                    description
                });
            }
            
            // Clear future (redo) when new change is made
            this.future = [];
            
            // Calculate new state
            const newState = typeof updater === 'function' 
                ? updater(this.deepClone(this.state))
                : { ...this.deepClone(this.state), ...updater };
            
            // Validate new state
            this.validateState(newState);
            
            // Update state
            const oldState = this.state;
            this.state = newState;
            
            // Update metadata
            this.metadata.lastModified = Date.now();
            this.metadata.modifications++;
            this.metadata.checksum = this.generateChecksum(newState);
            
            // Run afterChange middleware
            this.runMiddleware('afterChange', {
                oldState,
                newState,
                description
            });
            
            // Notify listeners
            this.notifyListeners(oldState, newState, description);
            
            // Emit event
            this.eventBus.emit(`state:${this.options.name}:changed`, {
                oldState,
                newState,
                description,
                metadata: this.metadata
            });
            
            return true;
            
        } catch (error) {
            this.eventBus.emit(`state:${this.options.name}:error`, {
                error: error.message,
                operation: 'setState',
                description
            });
            
            throw error;
            
        } finally {
            this.isUpdating = false;
        }
    }
    
    // ==================== ADVANCED STATE OPERATIONS ====================
    
    batch(updater, description = 'batch') {
        this.isBatching = true;
        
        try {
            const result = updater(this);
            this.flushBatch(description);
            return result;
        } finally {
            this.isBatching = false;
        }
    }
    
    flushBatch(description = 'batch') {
        if (this.batchQueue.length === 0) return;
        
        const batchUpdate = this.batchQueue.reduce((state, update) => {
            return typeof update === 'function' 
                ? update(state)
                : { ...state, ...update };
        }, this.deepClone(this.state));
        
        this.setState(batchUpdate, description);
        this.batchQueue = [];
    }
    
    enqueueUpdate(updater) {
        if (this.isBatching) {
            this.batchQueue.push(updater);
        } else {
            this.setState(updater);
        }
    }
    
    undo() {
        if (this.history.length === 0) return false;
        
        const previous = this.history.pop();
        this.future.push({
            state: this.deepClone(this.state),
            timestamp: Date.now(),
            description: 'undo'
        });
        
        this.replaceState(previous.state, `Undo: ${previous.description}`);
        return true;
    }
    
    redo() {
        if (this.future.length === 0) return false;
        
        const next = this.future.pop();
        this.history.push({
            state: this.deepClone(this.state),
            timestamp: Date.now(),
            description: 'redo'
        });
        
        this.replaceState(next.state, `Redo`);
        return true;
    }
    
    replaceState(newState, description = 'replace') {
        const oldState = this.state;
        this.state = this.deepClone(newState);
        
        // Reset history and future
        this.history = [];
        this.future = [];
        
        this.metadata.lastModified = Date.now();
        this.metadata.modifications++;
        this.metadata.checksum = this.generateChecksum(newState);
        
        this.notifyListeners(oldState, newState, description);
        
        this.eventBus.emit(`state:${this.options.name}:replaced`, {
            oldState,
            newState,
            description
        });
    }
    
    // ==================== SUBSCRIPTION SYSTEM ====================
    
    subscribe(listener, selector = null) {
        const id = this.generateId();
        
        this.listeners.set(id, {
            listener,
            selector,
            lastState: this.deepClone(this.state)
        });
        
        return () => this.unsubscribe(id);
    }
    
    unsubscribe(id) {
        return this.listeners.delete(id);
    }
    
    subscribeToPath(path, listener) {
        const id = this.generateId();
        const currentValue = this.getByPath(this.state, path);
        
        this.listeners.set(id, {
            listener,
            selector: (state) => this.getByPath(state, path),
            lastValue: currentValue,
            isPathListener: true,
            path
        });
        
        return () => this.unsubscribe(id);
    }
    
    // ==================== SNAPSHOT AND SERIALIZATION ====================
    
    getSnapshot() {
        return {
            state: this.deepClone(this.state),
            metadata: { ...this.metadata },
            history: this.history.length,
            future: this.future.length,
            listeners: this.listeners.size,
            timestamp: Date.now()
        };
    }
    
    serialize() {
        return JSON.stringify({
            state: this.state,
            metadata: this.metadata,
            version: '1.0.0'
        });
    }
    
    static deserialize(serialized, options = {}) {
        try {
            const data = JSON.parse(serialized);
            
            if (data.version !== '1.0.0') {
                throw new Error(`Unsupported version: ${data.version}`);
            }
            
            const manager = new StateManager({
                ...options,
                initialState: data.state
            });
            
            manager.metadata = data.metadata;
            
            return manager;
        } catch (error) {
            throw new Error(`Failed to deserialize state: ${error.message}`);
        }
    }
    
    // ==================== VALIDATION AND SCHEMA ====================
    
    validateState(state) {
        if (!this.options.strict) return true;
        
        // Schema validation
        if (this.options.schema) {
            this.validateWithSchema(state);
        }
        
        // Type validation
        this.validateTypes(state);
        
        // Circular reference check
        this.checkCircularReferences(state);
        
        return true;
    }
    
    validateWithSchema(state) {
        // Implement schema validation based on JSON Schema or similar
        // This is a simplified version
        const schema = this.options.schema;
        
        if (schema.required) {
            schema.required.forEach(field => {
                if (state[field] === undefined) {
                    throw new Error(`Required field missing: ${field}`);
                }
            });
        }
    }
    
    validateTypes(state) {
        // Basic type validation
        const validate = (value, path = '') => {
            if (value === null || value === undefined) return;
            
            if (Array.isArray(value)) {
                value.forEach((item, index) => validate(item, `${path}[${index}]`));
            } else if (typeof value === 'object' && !(value instanceof Date)) {
                Object.entries(value).forEach(([key, val]) => validate(val, path ? `${path}.${key}` : key));
            } else if (typeof value === 'function') {
                throw new Error(`Functions are not allowed in state (at ${path})`);
            }
        };
        
        validate(state);
    }
    
    checkCircularReferences(obj, seen = new Set()) {
        if (obj && typeof obj === 'object') {
            if (seen.has(obj)) {
                throw new Error('Circular reference detected in state');
            }
            
            seen.add(obj);
            
            for (const key in obj) {
                if (obj.hasOwnProperty(key)) {
                    this.checkCircularReferences(obj[key], new Set(seen));
                }
            }
        }
    }
    
    // ==================== MIDDLEWARE SYSTEM ====================
    
    use(middleware) {
        if (typeof middleware !== 'function') {
            throw new Error('Middleware must be a function');
        }
        
        this.middleware.push(middleware);
        return () => {
            const index = this.middleware.indexOf(middleware);
            if (index > -1) this.middleware.splice(index, 1);
        };
    }
    
    runMiddleware(phase, context) {
        return this.middleware.reduce((ctx, middleware) => {
            try {
                const result = middleware(phase, ctx, this);
                return result !== undefined ? result : ctx;
            } catch (error) {
                this.logger?.error(`Middleware error in phase ${phase}:`, error);
                return ctx;
            }
        }, context);
    }
    
    // ==================== UTILITY METHODS ====================
    
    createInitialState() {
        return {
            version: '1.0.0',
            timestamp: Date.now(),
            data: {},
            ui: {
                isLoading: false,
                theme: 'dark',
                language: 'fa'
            },
            user: null,
            session: {
                isAuthenticated: false,
                lastActivity: Date.now()
            }
        };
    }
    
    initializeState(initialState) {
        // Merge with default state structure
        const defaultState = this.createInitialState();
        const state = this.deepMerge(defaultState, initialState);
        
        // Validate initial state
        this.validateState(state);
        
        return state;
    }
    
    deepClone(obj) {
        if (obj === null || typeof obj !== 'object') return obj;
        if (obj instanceof Date) return new Date(obj);
        if (Array.isArray(obj)) return obj.map(item => this.deepClone(item));
        
        const cloned = {};
        for (const key in obj) {
            if (obj.hasOwnProperty(key)) {
                cloned[key] = this.deepClone(obj[key]);
            }
        }
        return cloned;
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
                } else if (Array.isArray(source[key]) && Array.isArray(target[key])) {
                    output[key] = [...target[key], ...source[key]];
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
            if (current && typeof current === 'object' && key in current) {
                return current[key];
            }
            return undefined;
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
    
    generateChecksum(state) {
        const str = JSON.stringify(state);
        let hash = 0;
        
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        
        return hash.toString(16);
    }
    
    generateId() {
        return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    
    // ==================== EVENT HANDLING ====================
    
    setupEventListeners() {
        // Listen for external state updates
        this.eventBus.on(`state:${this.options.name}:update`, (event) => {
            if (event.data && event.data.state) {
                this.setState(event.data.state, event.data.description || 'external update');
            }
        });
        
        // Listen for reset commands
        this.eventBus.on(`state:${this.options.name}:reset`, () => {
            this.replaceState(this.options.initialState, 'reset');
        });
        
        // Listen for snapshot requests
        this.eventBus.on(`state:${this.options.name}:snapshot`, (event) => {
            const snapshot = this.getSnapshot();
            this.eventBus.emit(`state:${this.options.name}:snapshotResponse`, {
                requestId: event.data?.requestId,
                snapshot
            });
        });
    }
    
    notifyListeners(oldState, newState, description) {
        for (const [id, listenerData] of this.listeners) {
            try {
                if (listenerData.isPathListener) {
                    const oldValue = this.getByPath(oldState, listenerData.path);
                    const newValue = this.getByPath(newState, listenerData.path);
                    
                    if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
                        listenerData.listener(newValue, oldValue, description);
                        listenerData.lastValue = newValue;
                    }
                } else if (listenerData.selector) {
                    const oldSelected = listenerData.selector(oldState);
                    const newSelected = listenerData.selector(newState);
                    
                    if (JSON.stringify(oldSelected) !== JSON.stringify(newSelected)) {
                        listenerData.listener(newSelected, oldSelected, description);
                    }
                } else {
                    listenerData.listener(newState, oldState, description);
                }
                
                listenerData.lastState = this.deepClone(newState);
            } catch (error) {
                this.logger?.error(`Listener error for ${id}:`, error);
                this.eventBus.emit(`state:${this.options.name}:listenerError`, {
                    listenerId: id,
                    error: error.message
                });
            }
        }
    }
    
    // ==================== AUTO SAVE ====================
    
    setupAutoSave() {
        if (!this.options.autoSave) return;
        
        this.autoSaveInterval = setInterval(() => {
            this.saveToStorage();
        }, this.options.autoSaveInterval);
        
        // Also save on page unload
        window.addEventListener('beforeunload', () => {
            this.saveToStorage();
        });
    }
    
    saveToStorage() {
        try {
            const data = {
                state: this.state,
                metadata: this.metadata,
                version: '1.0.0',
                timestamp: Date.now()
            };
            
            localStorage.setItem(`hyperlang_state_${this.options.name}`, JSON.stringify(data));
            
            this.eventBus.emit(`state:${this.options.name}:saved`, {
                timestamp: Date.now(),
                size: JSON.stringify(data).length
            });
        } catch (error) {
            this.logger?.error('Failed to save state:', error);
        }
    }
    
    loadFromStorage() {
        try {
            const stored = localStorage.getItem(`hyperlang_state_${this.options.name}`);
            if (!stored) return false;
            
            const data = JSON.parse(stored);
            
            if (data.version !== '1.0.0') {
                this.logger?.warn(`State version mismatch: ${data.version}`);
                return false;
            }
            
            this.replaceState(data.state, 'loaded from storage');
            this.metadata = data.metadata;
            
            this.eventBus.emit(`state:${this.options.name}:loaded`, {
                timestamp: Date.now(),
                fromStorage: true
            });
            
            return true;
        } catch (error) {
            this.logger?.error('Failed to load state:', error);
            return false;
        }
    }
    
    // ==================== DEV TOOLS INTEGRATION ====================
    
    setupDevTools() {
        if (!CONFIG.APP.DEBUG) return;
        
        // Expose to window for debugging
        window[`stateManager_${this.options.name}`] = this;
        
        // Connect to Redux DevTools if available
        if (window.__REDUX_DEVTOOLS_EXTENSION__) {
            this.devtools = window.__REDUX_DEVTOOLS_EXTENSION__.connect({
                name: `HyperLang State: ${this.options.name}`,
                features: {
                    pause: true,
                    lock: true,
                    persist: false,
                    export: true,
                    import: 'custom',
                    jump: true,
                    skip: false,
                    reorder: false,
                    dispatch: false,
                    test: false
                }
            });
            
            this.devtools.init(this.state);
            
            // Subscribe to state changes
            this.subscribe((state) => {
                this.devtools.send('STATE_CHANGE', state);
            });
        }
    }
    
    // ==================== CONTRACT VALIDATION ====================
    
    validateContract() {
        const errors = [];
        
        // Validate against STATE_CONTRACT
        if (!this.state || typeof this.state !== 'object') {
            errors.push('State must be an object');
        }
        
        if (!this.metadata || !this.metadata.version) {
            errors.push('State metadata missing version');
        }
        
        // Validate methods exist
        const requiredMethods = ['getState', 'setState', 'subscribe', 'unsubscribe', 'getSnapshot'];
        requiredMethods.forEach(method => {
            if (typeof this[method] !== 'function') {
                errors.push(`Missing required method: ${method}`);
            }
        });
        
        return {
            valid: errors.length === 0,
            errors,
            contract: STATE_CONTRACT,
            timestamp: new Date().toISOString()
        };
    }
    
    // ==================== LIFECYCLE ====================
    
    destroy() {
        // Clear intervals
        if (this.autoSaveInterval) {
            clearInterval(this.autoSaveInterval);
        }
        
        // Remove listeners
        this.listeners.clear();
        
        // Remove from window
        if (CONFIG.APP.DEBUG) {
            delete window[`stateManager_${this.options.name}`];
        }
        
        // Disconnect devtools
        if (this.devtools) {
            this.devtools.unsubscribe();
        }
        
        this.logger?.log(`StateManager "${this.options.name}" destroyed`);
    }
}

// ==================== GLOBAL STATE MANAGER INSTANCE ====================

// Create default global state manager
export const stateManager = new StateManager({
    name: 'global',
    strict: true,
    autoSave: true
});

// Register with context
context.registerSingleton('stateManager', stateManager);

// Export for global use
if (typeof window !== 'undefined') {
    window.stateManager = stateManager;
}

export default stateManager;
