/**
 * 📜 Interface API Client
 * قرارداد انتزاعی برای ارتباط با سرور - رعایت ISP و DIP
 */

class APIClientInterface {
    /**
     * تنظیم هدرهای پیش‌فرض
     * @param {Object} headers - هدرهای جدید
     */
    setHeaders(headers) {
        throw new Error('Method not implemented');
    }

    /**
     * درخواست GET
     * @param {string} endpoint - آدرس endpoint
     * @param {Object} params - پارامترهای query
     * @param {Object} options - تنظیمات اضافی
     * @returns {Promise<any>}
     */
    async get(endpoint, params = {}, options = {}) {
        throw new Error('Method not implemented');
    }

    /**
     * درخواست POST
     * @param {string} endpoint - آدرس endpoint
     * @param {Object} data - داده‌های body
     * @param {Object} options - تنظیمات اضافی
     * @returns {Promise<any>}
     */
    async post(endpoint, data = {}, options = {}) {
        throw new Error('Method not implemented');
    }

    /**
     * درخواست PUT
     * @param {string} endpoint - آدرس endpoint
     * @param {Object} data - داده‌های body
     * @param {Object} options - تنظیمات اضافی
     * @returns {Promise<any>}
     */
    async put(endpoint, data = {}, options = {}) {
        throw new Error('Method not implemented');
    }

    /**
     * درخواست DELETE
     * @param {string} endpoint - آدرس endpoint
     * @param {Object} options - تنظیمات اضافی
     * @returns {Promise<any>}
     */
    async delete(endpoint, options = {}) {
        throw new Error('Method not implemented');
    }

    /**
     * تنظیم تابع برای بازآوری توکن
     * @param {Function} tokenRefresher - تابع بازآوری توکن
     */
    setTokenRefresher(tokenRefresher) {
        throw new Error('Method not implemented');
    }

    /**
     * پاک کردن کش درخواست‌ها
     * @param {string} endpoint - آدرس endpoint (اختیاری)
     */
    clearCache(endpoint = null) {
        throw new Error('Method not implemented');
    }
}

export default APIClientInterface;
