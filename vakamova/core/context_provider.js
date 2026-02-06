/**
 * Context Provider - سیستم تزریق وابستگی و Context API
 * اصول رعایت شده: DIP, ISP, SRP, OCP
 */

// ==================== تعریف Interfaceها (قراردادها) ====================
// اصل ISP: اینترفیس‌های کوچک و خاص

/**
 * @interface ServiceProvider
 * قرارداد پایه برای همه Providerها
 */
class ServiceProvider {
  constructor() {
    if (this.constructor === ServiceProvider) {
      throw new Error('Cannot instantiate interface ServiceProvider');
    }
  }
  
  /**
   * راه‌اندازی سرویس
   * @returns {Promise<boolean>}
   */
  async initialize() {
    throw new Error('Method initialize() must be implemented');
  }
  
  /**
   * غیرفعال کردن سرویس
   * @returns {Promise<void>}
   */
  async shutdown() {
    throw new Error('Method shutdown() must be implemented');
  }
  
  /**
   * دریافت وضعیت سرویس
   * @returns {string}
   */
  getStatus() {
    throw new Error('Method getStatus() must be implemented');
  }
}

/**
 * @interface StateProvider
 * قرارداد ویژه برای ارائه State
 */
class StateProvider extends ServiceProvider {
  constructor() {
    super();
  }
  
  /**
   * دریافت State فعلی
   * @returns {Object}
   */
  getState() {
    throw new Error('Method getState() must be implemented');
  }
  
  /**
   * ارسال Action
   * @param {Object} action
   */
  dispatch(action) {
    throw new Error('Method dispatch() must be implemented');
  }
  
  /**
   * گوش دادن به تغییرات State
   * @param {Function} listener
   * @returns {Function} تابع لغو اشتراک
   */
  subscribe(listener) {
    throw new Error('Method subscribe() must be implemented');
  }
}

// ==================== پیاده‌سازی‌ها ====================

/**
 * VakamovaStateProvider - پیاده‌سازی StateProvider
 * اصل DIP: وابسته به interface، نه پیاده‌سازی خاص
 */
class VakamovaStateProvider extends StateProvider {
  constructor(stateManager) {
    super();
    
    if (!stateManager || typeof stateManager.getState !== 'function') {
      throw new Error('Valid stateManager required');
    }
    
    this._stateManager = stateManager;
    this._isInitialized = false;
    this._subscriptions = new Map();
  }
  
  async initialize() {
    if (this._isInitialized) return true;
    
    // State Manager قبلاً توسط فایل‌های قبلی راه‌اندازی شده
    this._isInitialized = true;
    return true;
  }
  
  async shutdown() {
    // لغو همه اشتراک‌ها
    this._subscriptions.forEach((unsubscribe, id) => {
      try {
        unsubscribe();
      } catch (error) {
        // نادیده گرفتن خطا در زمان shutdown
      }
    });
    
    this._subscriptions.clear();
    this._isInitialized = false;
  }
  
  getStatus() {
    return this._isInitialized ? 'active' : 'inactive';
  }
  
  getState() {
    this._ensureInitialized();
    return this._stateManager.getState();
  }
  
  dispatch(action) {
    this._ensureInitialized();
    
    if (!action || typeof action !== 'object') {
      throw new Error('Action must be an object');
    }
    
    return this._stateManager.dispatch(action);
  }
  
  subscribe(listener, subscriberId = null) {
    this._ensureInitialized();
    
    if (typeof listener !== 'function') {
      throw new Error('Listener must be a function');
    }
    
    // ثبت شنودکننده در State Manager
    const unsubscribe = this._stateManager.subscribe(listener);
    
    // ذخیره برای مدیریت بهتر
    const subscriptionId = subscriberId || `sub_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this._subscriptions.set(subscriptionId, unsubscribe);
    
    // بازگرداندن تابع لغو اشتراک
    return () => {
      const unsub = this._subscriptions.get(subscriptionId);
      if (unsub) {
        unsub();
        this._subscriptions.delete(subscriptionId);
      }
    };
  }
  
  /**
   * دریافت State با selector برای بهینه‌سازی رندر
   * @param {Function} selector - تابع انتخاب‌گر (مثال: state => state.user)
   * @param {Function} listener - تابع شنود
   * @returns {Function} تابع لغو اشتراک
   */
  subscribeWithSelector(selector, listener, subscriberId = null) {
    this._ensureInitialized();
    
    if (typeof selector !== 'function') {
      throw new Error('Selector must be a function');
    }
    
    let previousValue = selector(this.getState());
    
    const wrappedListener = (state) => {
      const currentValue = selector(state);
      
      // فقط اگر مقدار تغییر کرده، listener را صدا بزن
      if (JSON.stringify(previousValue) !== JSON.stringify(currentValue)) {
        previousValue = currentValue;
        listener(currentValue, state);
      }
    };
    
    return this.subscribe(wrappedListener, subscriberId);
  }
  
  _ensureInitialized() {
    if (!this._isInitialized) {
      throw new Error('StateProvider not initialized. Call initialize() first.');
    }
  }
}

/**
 * ServiceRegistry - رجیستری مرکزی سرویس‌ها
 * اصل SRP: فقط ثبت و واکشی سرویس‌ها
 */
class ServiceRegistry {
  constructor() {
    this._services = new Map();
    this._initializationQueue = [];
    this._isShuttingDown = false;
  }
  
  /**
   * ثبت سرویس جدید
   * @param {string} serviceName
   * @param {ServiceProvider} serviceInstance
   * @param {boolean} initializeNow - آیا بلافاصله راه‌اندازی شود؟
   */
  register(serviceName, serviceInstance, initializeNow = true) {
    if (this._services.has(serviceName)) {
      console.warn(`Service ${serviceName} is already registered. Overwriting...`);
    }
    
    // بررسی اینکه سرویس قرارداد ServiceProvider را رعایت کند
    if (!serviceInstance || typeof serviceInstance.initialize !== 'function') {
      throw new Error(`Service ${serviceName} must implement ServiceProvider interface`);
    }
    
    this._services.set(serviceName, serviceInstance);
    
    if (initializeNow && !this._isShuttingDown) {
      this._initializationQueue.push(
        serviceInstance.initialize()
          .then(() => {
            console.log(`Service ${serviceName} initialized successfully`);
          })
          .catch(error => {
            console.error(`Failed to initialize service ${serviceName}:`, error);
          })
      );
    }
    
    return this;
  }
  
  /**
   * دریافت سرویس
   * @param {string} serviceName
   * @returns {ServiceProvider}
   */
  get(serviceName) {
    const service = this._services.get(serviceName);
    
    if (!service) {
      throw new Error(`Service ${serviceName} not found in registry`);
    }
    
    return service;
  }
  
  /**
   * بررسی وجود سرویس
   * @param {string} serviceName
   * @returns {boolean}
   */
  has(serviceName) {
    return this._services.has(serviceName);
  }
  
  /**
   * دریافت همه سرویس‌ها
   * @returns {Map<string, ServiceProvider>}
   */
  getAll() {
    return new Map(this._services);
  }
  
  /**
   * راه‌اندازی همه سرویس‌ها
   * @returns {Promise<Array>}
   */
  async initializeAll() {
    if (this._isShuttingDown) {
      throw new Error('Cannot initialize while shutting down');
    }
    
    const initializationPromises = [];
    
    this._services.forEach((service, name) => {
      initializationPromises.push(
        service.initialize()
          .then(() => {
            console.log(`Service ${name} initialized`);
            return { name, status: 'success' };
          })
          .catch(error => {
            console.error(`Service ${name} initialization failed:`, error);
            return { name, status: 'failed', error };
          })
      );
    });
    
    return Promise.all(initializationPromises);
  }
  
  /**
   * خاموش کردن همه سرویس‌ها
   * @returns {Promise<void>}
   */
  async shutdownAll() {
    this._isShuttingDown = true;
    
    const shutdownPromises = [];
    
    // برعکس ترتیب ثبت، خاموش می‌کنیم (LIFO)
    const servicesArray = Array.from(this._services.entries()).reverse();
    
    for (const [name, service] of servicesArray) {
      shutdownPromises.push(
        service.shutdown()
          .then(() => {
            console.log(`Service ${name} shut down`);
          })
          .catch(error => {
            console.error(`Error shutting down service ${name}:`, error);
          })
      );
    }
    
    await Promise.all(shutdownPromises);
    this._services.clear();
    this._isShuttingDown = false;
  }
  
  /**
   * دریافت وضعیت همه سرویس‌ها
   * @returns {Array<Object>}
   */
  getServicesStatus() {
    const status = [];
    
    this._services.forEach((service, name) => {
      try {
        status.push({
          name,
          status: service.getStatus(),
          type: service.constructor.name
        });
      } catch (error) {
        status.push({
          name,
          status: 'error',
          error: error.message,
          type: service.constructor.name
        });
      }
    });
    
    return status;
  }
}

/**
 * VakamovaContext - کلاس اصلی Context
 * اصل OCP: قابل گسترش بدون تغییر کد اصلی
 */
class VakamovaContext {
  constructor() {
    this._registry = new ServiceRegistry();
    this._contextCache = new Map();
    this._isGlobalContext = false;
    
    // ثبت سرویس‌های پیش‌فرض
    this._registerCoreServices();
  }
  
  /**
   * ثبت سرویس‌های هسته
   */
  _registerCoreServices() {
    // State Provider به صورت lazy ثبت می‌شود
    // چون به State Manager نیاز دارد که از بیرون تزریق می‌شود
  }
  
  /**
   * تنظیم State Manager (باید از بیرون فراخوانی شود)
   * @param {Object} stateManager
   */
  setStateManager(stateManager) {
    const stateProvider = new VakamovaStateProvider(stateManager);
    this._registry.register('state', stateProvider, true);
    
    // کش را پاک کن چون State Manager عوض شده
    this._contextCache.clear();
    
    return this;
  }
  
  /**
   * ثبت سرویس دلخواه
   * @param {string} name
   * @param {ServiceProvider} service
   * @param {boolean} initializeNow
   */
  registerService(name, service, initializeNow = true) {
    this._registry.register(name, service, initializeNow);
    return this;
  }
  
  /**
   * دریافت سرویس
   * @param {string} serviceName
   * @returns {ServiceProvider}
   */
  getService(serviceName) {
    return this._registry.get(serviceName);
  }
  
  /**
   * دریافت State Provider (کمک‌کننده)
   * @returns {VakamovaStateProvider}
   */
  getStateProvider() {
    return this.getService('state');
  }
  
  /**
   * ایجاد Context برای کامپوننت‌ها
   * @param {string} contextName
   * @param {Object} dependencies
   * @returns {Object}
   */
  createComponentContext(contextName, dependencies = {}) {
    if (this._contextCache.has(contextName)) {
      return this._contextCache.get(contextName);
    }
    
    const context = {
      name: contextName,
      dependencies: { ...dependencies },
      services: {},
      timestamp: new Date().toISOString()
    };
    
    // اضافه کردن دسترسی به سرویس‌های رجیستری
    context.getService = (serviceName) => {
      if (!context.services[serviceName]) {
        context.services[serviceName] = this._registry.get(serviceName);
      }
      return context.services[serviceName];
    };
    
    // اضافه کردن State Helper
    context.getState = () => {
      const stateProvider = context.getService('state');
      return stateProvider.getState();
    };
    
    context.dispatch = (action) => {
      const stateProvider = context.getService('state');
      return stateProvider.dispatch(action);
    };
    
    context.subscribe = (listener, id) => {
      const stateProvider = context.getService('state');
      return stateProvider.subscribe(listener, id);
    };
    
    context.subscribeTo = (selector, listener, id) => {
      const stateProvider = context.getService('state');
      return stateProvider.subscribeWithSelector(selector, listener, id);
    };
    
    this._contextCache.set(contextName, context);
    return context;
  }
  
  /**
   * راه‌اندازی کامل Context
   * @returns {Promise<Array>}
   */
  async initialize() {
    console.log('Initializing Vakamova Context...');
    return this._registry.initializeAll();
  }
  
  /**
   * خاموش کردن Context
   * @returns {Promise<void>}
   */
  async shutdown() {
    console.log('Shutting down Vakamova Context...');
    this._contextCache.clear();
    await this._registry.shutdownAll();
  }
  
  /**
   * دریافت وضعیت Context
   * @returns {Object}
   */
  getStatus() {
    return {
      isInitialized: true, // چون ثبت سرویس‌ها synchronous است
      servicesCount: this._registry.getAll().size,
      cachedContexts: this._contextCache.size,
      servicesStatus: this._registry.getServicesStatus()
    };
  }
  
  /**
   * پاک‌سازی کش Context
   */
  clearCache() {
    const count = this._contextCache.size;
    this._contextCache.clear();
    return count;
  }
}

// ==================== ایجاد نمونه سراسری ====================

let globalContextInstance = null;

/**
 * ایجاد یا دریافت Context سراسری
 * اصل Singleton برای دسترسی آسان
 * @returns {VakamovaContext}
 */
export function createGlobalContext() {
  if (!globalContextInstance) {
    globalContextInstance = new VakamovaContext();
    globalContextInstance._isGlobalContext = true;
    
    // ذخیره در localStorage برای دسترسی بین تب‌ها
    try {
      localStorage.setItem('vakamova_context_initialized', 'true');
    } catch (error) {
      // نادیده گرفتن خطای localStorage
    }
  }
  
  return globalContextInstance;
}

export function getGlobalContext() {
  if (!globalContextInstance) {
    throw new Error('Global context not created. Call createGlobalContext() first.');
  }
  
  return globalContextInstance;
}

/**
 * Helper برای استفاده سریع
 */
export const VakamovaContextHelpers = {
  /**
   * ایجاد Context برای یک ماژول خاص
   * @param {string} moduleName
   * @returns {Object}
   */
  forModule(moduleName) {
    const context = getGlobalContext();
    return context.createComponentContext(`module_${moduleName}`);
  },
  
  /**
   * ایجاد Context برای یک صفحه خاص
   * @param {string} pageName
   * @returns {Object}
   */
  forPage(pageName) {
    const context = getGlobalContext();
    return context.createComponentContext(`page_${pageName}`);
  },
  
  /**
   * دریافت State Provider
   * @returns {VakamovaStateProvider}
   */
  getStateProvider() {
    const context = getGlobalContext();
    return context.getStateProvider();
  },
  
  /**
   * ثبت Service جدید
   * @param {string} name
   * @param {ServiceProvider} service
   */
  registerService(name, service) {
    const context = getGlobalContext();
    return context.registerService(name, service);
  }
};

// ==================== Export اصلی ====================

export default {
  createGlobalContext,
  getGlobalContext,
  VakamovaContext,
  VakamovaStateProvider,
  ServiceRegistry,
  ServiceProvider,
  StateProvider,
  helpers: VakamovaContextHelpers
};
