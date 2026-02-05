/**
 * HYPERLANG EVENT BUS - سیستم ارتباط رویدادمحور
 * 
 * اصول رعایت شده:
 * ✅ SRP: فقط مدیریت رویدادها
 * ✅ OCP: قابل توسعه با middleware و transformers
 * ✅ ISP: رابط‌های مجزا برای EventBus و IEventMetrics
 * ✅ DIP: وابستگی به ILogger و IValidator از طریق constructor
 */

// ==================== INTERFACES (ISP) ====================
/**
 * @interface ILogger
 * اصل ISP: رابط کوچک و اختصاصی برای لاگینگ
 */
class ILogger {
  debug(message, data) {}
  info(message, data) {}
  warn(message, data) {}
  error(message, data) {}
}

/**
 * @interface IValidator
 * اصل ISP: رابط کوچک برای اعتبارسنجی
 */
class IValidator {
  validateEventName(eventName) {}
  validateListener(listener) {}
  validateConfig(config) {}
}

/**
 * @interface IEventMetrics
 * اصل ISP: رابط برای متریک‌ها
 */
class IEventMetrics {
  getMetrics() {}
  resetMetrics() {}
  incrementEmission() {}
  incrementDelivery() {}
  incrementError() {}
}

/**
 * @interface IEventBus
 * اصل ISP: رابط اصلی EventBus
 */
class IEventBus {
  on(eventName, listener, options) {}
  off(eventName, identifier) {}
  emit(eventName, data, options) {}
  once(eventName, listener, options) {}
  clear(eventName) {}
}

// ==================== CONCRETE IMPLEMENTATIONS ====================

/**
 * @class ConsoleLogger
 * اصل SRP: فقط لاگینگ به کنسول
 */
class ConsoleLogger extends ILogger {
  debug(message, data = null) {
    console.debug(`[EventBus] ${message}`, data);
  }
  
  info(message, data = null) {
    console.info(`[EventBus] ${message}`, data);
  }
  
  warn(message, data = null) {
    console.warn(`[EventBus] ${message}`, data);
  }
  
  error(message, data = null) {
    console.error(`[EventBus] ${message}`, data);
  }
}

/**
 * @class EventValidator
 * اصل SRP: فقط اعتبارسنجی
 */
class EventValidator extends IValidator {
  validateEventName(eventName) {
    if (typeof eventName !== 'string' || eventName.trim() === '') {
      throw new TypeError('Event name must be a non-empty string');
    }
    
    if (!/^[a-z0-9_:.*?-]+$/i.test(eventName)) {
      throw new Error(`Invalid event name format: "${eventName}"`);
    }
  }
  
  validateListener(listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('Listener must be a function');
    }
  }
  
  validateConfig(config) {
    const schema = {
      maxListeners: 'number',
      enableWildcards: 'boolean',
      strictMode: 'boolean',
      namespaceSeparator: 'string',
      debug: 'boolean'
    };
    
    for (const [key, type] of Object.entries(schema)) {
      if (config[key] !== undefined && typeof config[key] !== type) {
        throw new TypeError(`Config "${key}" must be ${type}`);
      }
    }
  }
}

/**
 * @class EventMetrics
 * اصل SRP: فقط مدیریت متریک‌ها
 * اصل DIP: وابستگی به ILogger از طریق constructor
 */
class EventMetrics extends IEventMetrics {
  constructor(logger) {
    super();
    this._logger = logger; // Dependency Injection
    this._metrics = {
      emissions: 0,
      deliveries: 0,
      errors: 0,
      totalListeners: 0
    };
    Object.seal(this._metrics);
  }
  
  getMetrics() {
    return { ...this._metrics };
  }
  
  resetMetrics() {
    this._metrics.emissions = 0;
    this._metrics.deliveries = 0;
    this._metrics.errors = 0;
    this._metrics.totalListeners = 0;
  }
  
  incrementEmission() {
    this._metrics.emissions++;
  }
  
  incrementDelivery() {
    this._metrics.deliveries++;
  }
  
  incrementError() {
    this._metrics.errors++;
  }
  
  updateTotalListeners(count) {
    this._metrics.totalListeners = count;
  }
}

/**
 * @class ListenerConfig
 * اصل SRP: فقط نگهداری تنظیمات Listener
 */
class ListenerConfig {
  constructor(listener, options = {}) {
    this.listener = listener;
    this.once = options.once || false;
    this.priority = options.priority || 0;
    this.context = options.context || null;
    this.id = Symbol(`listener_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`);
  }
}

/**
 * @class EventEmitter
 * اصل SRP: فقط عملیات emit
 * اصل DIP: وابستگی به Validator, Metrics, Logger
 */
class EventEmitter {
  constructor(validator, metrics, logger, config) {
    this._validator = validator;
    this._metrics = metrics;
    this._logger = logger;
    this._config = config;
    this._events = new Map();
    this._wildcards = new Map();
  }
  
  emit(eventName, data, options) {
    this._validator.validateEventName(eventName);
    this._metrics.incrementEmission();
    
    const event = {
      name: eventName,
      data,
      timestamp: Date.now(),
      id: Symbol(`emit_${Date.now()}`),
      source: options?.source || 'unknown',
      canceled: false
    };
    
    if (this._config.debug) {
      this._logger.debug(`Emitting event: ${eventName}`, { data, listeners: this.getListenerCount(eventName) });
    }
    
    const results = this._processExactListeners(eventName, event);
    const wildcardResults = this._processWildcardListeners(eventName, event);
    
    return {
      success: true,
      event,
      listenersTriggered: results.length + wildcardResults.length,
      results: [...results, ...wildcardResults].filter(r => r !== undefined)
    };
  }
  
  _processExactListeners(eventName, event) {
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
        
        this._metrics.incrementDelivery();
        results.push(result);
        
        if (config.once) {
          listeners.splice(i, 1);
          i--;
        }
        
        if (event.canceled) break;
      } catch (error) {
        this._metrics.incrementError();
        this._logger.error(`Listener error for "${eventName}"`, error);
        
        if (this._config.strictMode) {
          throw error;
        }
      }
    }
    
    if (listeners.length === 0) {
      this._events.delete(eventName);
    }
    
    return results;
  }
  
  _processWildcardListeners(eventName, event) {
    if (!this._config.enableWildcards) return [];
    
    const results = [];
    const patterns = this._generateWildcardPatterns(eventName);
    
    for (const pattern of patterns) {
      if (this._wildcards.has(pattern)) {
        const listeners = this._wildcards.get(pattern);
        for (const config of listeners) {
          try {
            const result = config.listener(event.data, event);
            results.push(result);
            this._metrics.incrementDelivery();
          } catch (error) {
            this._metrics.incrementError();
            this._logger.error(`Wildcard listener error for pattern "${pattern}"`, error);
          }
        }
      }
    }
    
    return results;
  }
  
  _generateWildcardPatterns(eventName) {
    const parts = eventName.split(this._config.namespaceSeparator);
    const patterns = new Set(['*']);
    
    for (let i = 0; i < parts.length; i++) {
      const pattern = [
        ...parts.slice(0, i),
        '*',
        ...parts.slice(i + 1)
      ].join(this._config.namespaceSeparator);
      patterns.add(pattern);
    }
    
    return Array.from(patterns);
  }
  
  getListenerCount(eventName) {
    if (eventName) {
      return this._events.has(eventName) ? this._events.get(eventName).length : 0;
    }
    
    let total = 0;
    for (const listeners of this._events.values()) {
      total += listeners.length;
    }
    return total;
  }
}

/**
 * @class ListenerManager
 * اصل SRP: فقط مدیریت listeners
 */
class ListenerManager {
  constructor(validator, config) {
    this._validator = validator;
    this._config = config;
    this._events = new Map();
    this._wildcards = new Map();
  }
  
  addListener(eventName, listener, options) {
    this._validator.validateEventName(eventName);
    this._validator.validateListener(listener);
    
    const config = new ListenerConfig(listener, options);
    
    if (this._isWildcardPattern(eventName)) {
      return this._addWildcardListener(eventName, config);
    }
    
    return this._addExactListener(eventName, config);
  }
  
  _isWildcardPattern(eventName) {
    return this._config.enableWildcards && 
           (eventName.includes('*') || eventName.includes('?'));
  }
  
  _addExactListener(eventName, config) {
    if (!this._events.has(eventName)) {
      this._events.set(eventName, []);
    }
    
    const listeners = this._events.get(eventName);
    listeners.push(config);
    listeners.sort((a, b) => b.priority - a.priority);
    
    this._enforceMaxListeners(eventName, listeners);
    
    return () => this.removeListener(eventName, config.id);
  }
  
  _addWildcardListener(pattern, config) {
    if (!this._wildcards.has(pattern)) {
      this._wildcards.set(pattern, []);
    }
    
    this._wildcards.get(pattern).push(config);
    
    return () => {
      const listeners = this._wildcards.get(pattern);
      if (listeners) {
        const index = listeners.findIndex(l => l.id === config.id);
        if (index > -1) {
          listeners.splice(index, 1);
        }
        if (listeners.length === 0) {
          this._wildcards.delete(pattern);
        }
      }
    };
  }
  
  removeListener(eventName, identifier) {
    if (!this._events.has(eventName)) return false;
    
    const listeners = this._events.get(eventName);
    const initialLength = listeners.length;
    
    if (typeof identifier === 'function') {
      this._events.set(eventName, listeners.filter(l => l.listener !== identifier));
    } else if (identifier) {
      this._events.set(eventName, listeners.filter(l => l.id !== identifier));
    } else {
      this._events.delete(eventName);
    }
    
    return listeners.length !== initialLength;
  }
  
  _enforceMaxListeners(eventName, listeners) {
    if (listeners.length > this._config.maxListeners) {
      console.warn(`[EventBus] Event "${eventName}" exceeded max listeners (${this._config.maxListeners})`);
    }
  }
  
  clear(eventName = null) {
    if (eventName) {
      this._events.delete(eventName);
    } else {
      this._events.clear();
      this._wildcards.clear();
    }
    return true;
  }
  
  getEventNames() {
    return Array.from(this._events.keys());
  }
}

/**
 * @class HyperEventBus
 * اصل SRP: هماهنگ‌کننده کامپوننت‌ها
 * اصل DIP: وابستگی به Interface‌ها
 * اصل OCP: قابل توسعه با Middleware
 */
class HyperEventBus extends IEventBus {
  constructor(config = {}, dependencies = {}) {
    super();
    
    // Dependency Injection (DIP)
    this._logger = dependencies.logger || new ConsoleLogger();
    this._validator = dependencies.validator || new EventValidator();
    this._metrics = dependencies.metrics || new EventMetrics(this._logger);
    
    // Validate config
    this._validator.validateConfig(config);
    
    // Configuration with defaults
    this._config = Object.freeze({
      maxListeners: config.maxListeners || 50,
      enableWildcards: config.enableWildcards ?? true,
      strictMode: config.strictMode ?? false,
      namespaceSeparator: config.namespaceSeparator || ':',
      debug: config.debug ?? false,
      ...config
    });
    
    // Composition over inheritance
    this._listenerManager = new ListenerManager(this._validator, this._config);
    this._eventEmitter = new EventEmitter(
      this._validator,
      this._metrics,
      this._logger,
      this._config
    );
    
    // Middleware system
    this._middlewares = {
      pre: [],
      post: []
    };
    
    this._logger.info('EventBus initialized', { config: this._config });
  }
  
  // ==================== PUBLIC API ====================
  
  on(eventName, listener, options = {}) {
    return this._listenerManager.addListener(eventName, listener, options);
  }
  
  once(eventName, listener, options = {}) {
    return this.on(eventName, listener, { ...options, once: true });
  }
  
  off(eventName, identifier) {
    return this._listenerManager.removeListener(eventName, identifier);
  }
  
  emit(eventName, data = null, options = {}) {
    // Run pre-emit middlewares
    if (!this._runMiddlewares('pre', { name: eventName, data })) {
      return { canceled: true, reason: 'middleware_blocked' };
    }
    
    const result = this._eventEmitter.emit(eventName, data, options);
    
    // Run post-emit middlewares
    this._runMiddlewares('post', { name: eventName, data, result });
    
    return result;
  }
  
  clear(eventName = null) {
    return this._listenerManager.clear(eventName);
  }
  
  // ==================== ADVANCED FEATURES ====================
  
  use(phase, middleware) {
    if (!['pre', 'post'].includes(phase)) {
      throw new Error('Middleware phase must be "pre" or "post"');
    }
    
    if (typeof middleware !== 'function') {
      throw new TypeError('Middleware must be a function');
    }
    
    this._middlewares[phase].push(middleware);
    
    return () => {
      this._middlewares[phase] = this._middlewares[phase].filter(m => m !== middleware);
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
        reject(new Error(`Timeout waiting for event "${eventName}"`));
      }, timeout) : null;
      
      const unsubscribe = this.once(eventName, (data) => {
        if (timer) clearTimeout(timer);
        resolve(data);
      });
      
      // Auto-unsubscribe on timeout
      if (timer) {
        const originalReject = reject;
        reject = (error) => {
          unsubscribe();
          originalReject(error);
        };
      }
    });
  }
  
  // ==================== UTILITIES ====================
  
  getListenerCount(eventName = null) {
    return this._eventEmitter.getListenerCount(eventName);
  }
  
  getEventNames() {
    return this._listenerManager.getEventNames();
  }
  
  getMetrics() {
    return this._metrics.getMetrics();
  }
  
  resetMetrics() {
    this._metrics.resetMetrics();
  }
  
  serialize() {
    return {
      config: { ...this._config },
      metrics: this.getMetrics(),
      events: this.getEventNames().map(name => ({
        name,
        listenerCount: this.getListenerCount(name)
      }))
    };
  }
  
  // ==================== PRIVATE METHODS ====================
  
  _runMiddlewares(phase, context) {
    for (const middleware of this._middlewares[phase]) {
      try {
        const result = middleware(context);
        if (result === false) return false;
      } catch (error) {
        this._logger.error(`Middleware error in ${phase} phase`, error);
        if (this._config.strictMode) throw error;
      }
    }
    return true;
  }
}

// ==================== FACTORY PATTERN ====================
/**
 * @class EventBusFactory
 * اصل SRP: فقط ساخت EventBus
 */
class EventBusFactory {
  static createDefault() {
    return new HyperEventBus();
  }
  
  static createWithConfig(config) {
    return new HyperEventBus(config);
  }
  
  static createSecure() {
    return new HyperEventBus({
      strictMode: true,
      maxListeners: 100,
      debug: process.env.NODE_ENV === 'development'
    });
  }
}

// ==================== EXPORTS ====================
// Singleton instance for global use (YAGNI: فقط اگر واقعاً نیاز است)
const globalEventBus = EventBusFactory.createDefault();

// برای جلوگیری از تغییرات ناخواسته
Object.freeze(globalEventBus);

export {
  // Interfaces (برای تست‌پذیری و وارونگی وابستگی)
  IEventBus,
  ILogger,
  IValidator,
  IEventMetrics,
  
  // Implementations
  HyperEventBus,
  ConsoleLogger,
  EventValidator,
  EventMetrics,
  
  // Factory
  EventBusFactory,
  
  // Singleton
  globalEventBus
};

// برای backward compatibility با کد موجود
window.eventBus = globalEventBus;
