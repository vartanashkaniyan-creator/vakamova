// core/router-interface.js

/**
 * رابط انتزاعی برای سیستم مسیریابی
 * @interface
 */
class IRouter {
  // مدیریت مسیرها
  async addRoute(path, component, options = {}) { throw new Error('Not implemented'); }
  async removeRoute(path) { throw new Error('Not implemented'); }
  async getRoute(path) { throw new Error('Not implemented'); }
  
  // ناوبری
  async navigate(path, data = {}) { throw new Error('Not implemented'); }
  async replace(path, data = {}) { throw new Error('Not implemented'); }
  async back() { throw new Error('Not implemented'); }
  async forward() { throw new Error('Not implemented'); }
  
  // وضعیت
  async getCurrentRoute() { throw new Error('Not implemented'); }
  async getHistory() { throw new Error('Not implemented'); }
  async clearHistory() { throw new Error('Not implemented'); }
  
  // میدل‌ورها
  async addMiddleware(middleware) { throw new Error('Not implemented'); }
  async removeMiddleware(middleware) { throw new Error('Not implemented'); }
  
  // رویدادها
  async on(event, handler) { throw new Error('Not implemented'); }
  async off(event, handler) { throw new Error('Not implemented'); }
}

export default IRouter;
