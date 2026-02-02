/**
 * VAKAMOVA APP BOOTSTRAP - هماهنگ‌کننده نهایی برنامه
 * اصول: تزریق وابستگی، قرارداد رابط، رویدادمحور، پیکربندی متمرکز
 * وابستگی: main.js (که خودش core/ و modules/ را بارگذاری می‌کند)
 */

class VakamovaApp {
    constructor(config = {}) {
        // پیکربندی متمرکز از config.js + main.js
        this.config = Object.freeze({
            mountElement: config.mountElement || '#app',
            initialRoute: config.initialRoute || '/home',
            enableOffline: config.enableOffline ?? true,
            ...config
        });
        
        // تزریق وابستگی‌های اصلی
        this.eventBus = config.eventBus || window.eventBus;
        this.stateManager = config.stateManager || window.stateManager;
        this.router = config.router || window.router;
        this.context = config.context || window.appContext;
        
        this.isMounted = false;
        this.appInstance = null;
    }
    
    async init() {
        // ۱. بررسی وابستگی‌های حیاتی
        if (!this.eventBus || !this.router) {
            throw new Error('پیش‌نیازهای اصلی برنامه بارگذاری نشده‌اند');
        }
        
        // ۲. ثبت سرویس برنامه در Context
        if (this.context) {
            this.context.register('app', this, { singleton: true });
        }
        
        // ۳. اتصال رویدادهای سیستمی
        this._connectSystemEvents();
        
        // ۴. انتشار رویداد آماده‌سازی
        this.eventBus.emit('app:init', { timestamp: Date.now() });
        
        console.log('✅ VakamovaApp initialized');
        return this;
    }
    
    async mount() {
        if (this.isMounted) return this;
        
        // ۱. پیدا کردن المنت مونت
        const mountEl = document.querySelector(this.config.mountElement);
        if (!mountEl) throw new Error(`Element ${this.config.mountElement} not found`);
        
        // ۲. راه‌اندازی Router
        await this.router.init(mountEl);
        
        // ۳. تنظیم حالت اولیه از StateManager
        await this._restoreAppState();
        
        // ۴. هدایت به مسیر اولیه
        await this.router.navigate(this.config.initialRoute);
        
        this.isMounted = true;
        this.eventBus.emit('app:mounted', { 
            mountElement: this.config.mountElement,
            initialRoute: this.config.initialRoute
        });
        
        console.log('🚀 VakamovaApp mounted and ready');
        return this;
    }
    
    async unmount() {
        if (!this.isMounted) return;
        
        // پاک‌سازی رویدادها و state
        this._cleanup();
        this.isMounted = false;
        
        console.log('🛑 VakamovaApp unmounted');
    }
    
    _connectSystemEvents() {
        // اتصال رویدادهای مهم برنامه
        this.eventBus.on('auth:login', (user) => {
            this.stateManager.set('user.current', user);
        });
        
        this.eventBus.on('router:navigate', (route) => {
            // ذخیره آخرین مسیر برای بازگشت
            this.stateManager.set('app.lastRoute', route);
        });
        
        // مدیریت خطاهای جهانی
        window.addEventListener('error', (event) => {
            this.eventBus.emit('app:error', { error: event.error });
        });
    }
    
    async _restoreAppState() {
        // بازیابی state از localStorage یا StateManager
        const savedState = this.stateManager.get('app');
        if (savedState) {
            // بازیابی تنظیمات کاربر
            this.eventBus.emit('app:state:restored', savedState);
        }
    }
    
    _cleanup() {
        // پاک‌سازی event listeners
        // ذخیره state نهایی
    }
    
    // API عمومی برای ماژول‌های دیگر
    getService(serviceName) {
        return this.context?.resolve(serviceName) || null;
    }
}

// فکتوری برای ایجاد نمونه برنامه
export function createApp(config = {}) {
    return new VakamovaApp(config);
}

// راه‌انداز خودکار برای بارگذاری مستقیم
export async function bootstrap() {
    try {
        // بارگذاری main.js اگر وجود دارد
        const mainModule = await import('./main.js');
        const app = createApp(mainModule.config);
        await app.init();
        await app.mount();
        return app;
    } catch (error) {
        console.error('Failed to bootstrap Vakamova:', error);
        throw error;
    }
}

// راه‌اندازی خودکار اگر مستقیماً لود شود
if (import.meta.url === document.currentScript?.src) {
    document.addEventListener('DOMContentLoaded', () => {
        bootstrap().catch(console.error);
    });
          }
