
/**
 *  HYPERLNG EVENT BUS - سیستم ارتباط رویدادمحور
 * اصل: ارتباط رویدادمحور، قرارداد رابط، پیکربندی متمرکز
 * وابستگی: هیچ (خودکفا)
 */

class HyperEventBus {
    constructor(config = {}) {
        this._events = new Map();
        this._wildcards = new Map();
        this._config = Object.freeze({
            maxListeners: config.maxListeners || 50,
            enableWildcards: config.enableWildcards ?? true,
            strictMode: config.strictMode ?? false,
            namespaceSeparator: config.namespaceSeparator || ':',
            ...config
        });
        
        this._middlewares = [];
        this._metrics = {
            emissions: 0,
            deliveries: 0,
            errors: 0
        };
        
        Object.seal(this._metrics);
    }
    
    // ==================== CORE EVENT SYSTEM ====================
    
    on(eventName, listener, options = {}) {
        this._validateEventName(eventName);
        this._validateListener(listener);
        
        const eventConfig = {
            listener,
            once: options.once || false,
            priority: options.priority || 0,
            context: options.context || null,
            id: Symbol(`listener_${Date.now()}`)
        };
        
        if (!this._events.has(eventName)) {
            this._events.set(eventName, []);
        }
        
        const listeners = this._events.get(eventName);
        listeners.push(eventConfig);
        listeners.sort((a, b) => b.priority - a.priority);
        
        if (listeners.length > this._config.maxListeners) {
            console.warn(`[EventBus] Event "${eventName}" exceeded max listeners`);
        }
        
        return () => this.off(eventName, eventConfig.id);
    }
    
    once(eventName, listener, options = {}) {
        return this.on(eventName, listener, { ...options, once: true });
    }
    
    off(eventName, identifier) {
        if (!this._events.has(eventName)) return false;
        
        const listeners = this._events.get(eventName);
        const initialLength = listeners.length;
        
        if (typeof identifier === 'function') {
            this._events.set(eventName, 
                listeners.filter(l => l.listener !== identifier));
        } else if (identifier) {
            this._events.set(eventName, 
                listeners.filter(l => l.id !== identifier));
        } else {
            this._events.delete(eventName);
        }
        
        return listeners.length !== initialLength;
    }
    
    emit(eventName, data = null, options = {}) {
        this._validateEventName(eventName);
        
        const emissionId = Symbol(`emit_${Date.now()}`);
        this._metrics.emissions++;
        
        const event = {
            name: eventName,
            data,
            timestamp: Date.now(),
            id: emissionId,
            source: options.source || 'unknown',
            canceled: false
        };
        
        // Run middlewares
        if (!this._runMiddlewares('pre', event)) {
            return { canceled: true, reason: 'middleware_blocked' };
        }
        
        // Process exact match listeners
        const results = this._processListeners(eventName, event);
        
        // Process wildcard listeners
        if (this._config.enableWildcards) {
            const wildcardResults = this._processWildcards(eventName, event);
            results.push(...wildcardResults);
        }
        
        // Run post-emit middlewares
        this._runMiddlewares('post', event);
        
        return {
            success: true,
            event,
            listenersTriggered: results.length,
            results: results.filter(r => r !== undefined)
        };
    }
    
    // ==================== ADVANCED FEATURES ====================
    
    use(middleware) {
        if (typeof middleware !== 'function') {
            throw new TypeError('Middleware must be a function');
        }
        
        this._middlewares.push(middleware);
        return () => {
            this._middlewares = this._middlewares.filter(m => m !== middleware);
        };
    }
    
    pipe(eventName, targetBus, transformFn = null) {
        return this.on(eventName, (data, event) => {
            const transformedData = transformFn ? transformFn(data, event) : data;
            targetBus.emit(eventName, transformedData, { source: 'pipe' });
        });
    }
    
    waitFor(eventName, timeout = 5000) {
        return new Promise((resolve, reject) => {
            const timer = timeout > 0 ? setTimeout(() => {
                this.off(eventName, handler);
                reject(new Error(`Timeout waiting for event "${eventName}"`));
            }, timeout) : null;
            
            const handler = this.once(eventName, (data) => {
                if (timer) clearTimeout(timer);
                resolve(data);
            });
        });
    }
    
    // ==================== UTILITIES ====================
    
    getListenerCount(eventName = null) {
        if (eventName) {
            return this._events.has(eventName) ? this._events.get(eventName).length : 0;
        }
        
        let total = 0;
        for (const listeners of this._events.values()) {
            total += listeners.length;
        }
        return total;
    }
    
    getEventNames() {
        return Array.from(this._events.keys());
    }
    
    clear(eventName = null) {
        if (eventName) {
            this._events.delete(eventName);
        } else {
            this._events.clear();
        }
        return true;
    }
    
    getMetrics() {
        return { ...this._metrics };
    }
    
    resetMetrics() {
        this._metrics.emissions = 0;
        this._metrics.deliveries = 0;
        this._metrics.errors = 0;
    }
    
    // ==================== PRIVATE METHODS ====================
    
    _validateEventName(eventName) {
        if (typeof eventName !== 'string' || eventName.trim() === '') {
            throw new TypeError('Event name must be a non-empty string');
        }
        
        if (this._config.strictMode && !/^[a-z0-9_:.-]+$/i.test(eventName)) {
            throw new Error(`Invalid event name format: "${eventName}"`);
        }
    }
    
    _validateListener(listener) {
        if (typeof listener !== 'function') {
            throw new TypeError('Listener must be a function');
        }
    }
    
    _processListeners(eventName, event) {
        if (!this._events.has(eventName)) return [];
        
        const listeners = this._events.get(eventName);
        const results = [];
        
        for (let i = 0; i < listeners.length; i++) {
            const config = listeners[i];
            
            try {
                const result = config.listener.call(
                    config.context || this, 
                    event.data, 
                    event
                );
                
                this._metrics.deliveries++;
                results.push(result);
                
                if (config.once) {
                    listeners.splice(i, 1);
                    i--;
                }
                
                if (event.canceled) break;
                
            } catch (error) {
                this._metrics.errors++;
                console.error(`[EventBus] Listener error for "${eventName}":`, error);
                
                if (this._config.strictMode) {
                    throw error;
                }
            }
        }
        
        // Cleanup empty arrays
        if (listeners.length === 0) {
            this._events.delete(eventName);
        }
        
        return results;
    }
    
    _processWildcards(eventName, event) {
        const results = [];
        const parts = eventName.split(this._config.namespaceSeparator);
        
        // Build wildcard patterns: app:* → app:user:login
        const patterns = [];
        for (let i = 0; i < parts.length; i++) {
            const pattern = [
                ...parts.slice(0, i),
                '*',
                ...parts.slice(i + 1)
            ].join(this._config.namespaceSeparator);
            patterns.push(pattern);
        }
        
        // Add global wildcard
        patterns.push('*');
        
        // Process each pattern
        for (const pattern of patterns) {
            if (this._wildcards.has(pattern)) {
                const listeners = this._wildcards.get(pattern);
                for (const config of listeners) {
                    try {
                        const result = config.listener(event.data, event);
                        results.push(result);
                        this._metrics.deliveries++;
                    } catch (error) {
                        this._metrics.errors++;
                        console.error(`[EventBus] Wildcard listener error:`, error);
                    }
                }
            }
        }
        
        return results;
    }
    
    _runMiddlewares(phase, event) {
        for (const middleware of this._middlewares) {
            try {
                const result = middleware(phase, event);
                if (result === false) return false;
            } catch (error) {
                console.error('[EventBus] Middleware error:', error);
                if (this._config.strictMode) throw error;
            }
        }
        return true;
    }
}

// Singleton export pattern
const eventBus = new HyperEventBus();
Object.freeze(eventBus);

export { HyperEventBus, eventBus };
