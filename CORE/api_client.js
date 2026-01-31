/**
 * HYPERLANG API CLIENT - سیستم ارتباط HTTP حرفه‌ای
 * اصل: قرارداد رابط، پیکربندی متمرکز، معماری حرفه‌ای
 * وابستگی: event-bus.js (برای رویدادهای API)
 */

class HyperApiClient {
    constructor(eventSystem, config = {}) {
        this._eventSystem = eventSystem;
        
        this._config = Object.freeze({
            baseURL: config.baseURL || '',
            timeout: config.timeout || 30000,
            retryAttempts: config.retryAttempts || 3,
            retryDelay: config.retryDelay || 1000,
            cacheTTL: config.cacheTTL || 60000,
            enableCache: config.enableCache ?? true,
            enableOfflineQueue: config.enableOfflineQueue ?? true,
            defaultHeaders: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                ...config.defaultHeaders
            },
            ...config
        });
        
        this._cache = new Map();
        this._requestQueue = [];
        this._pendingRequests = new Map();
        this._interceptors = {
            request: [],
            response: [],
            error: []
        };
        
        this._metrics = {
            requests: 0,
            successes: 0,
            errors: 0,
            cacheHits: 0
        };
        
        this._initEventListeners();
        Object.seal(this._metrics);
    }
    
    // ==================== CORE HTTP METHODS ====================
    
    async request(config) {
        const requestId = Symbol(`req_${Date.now()}`);
        this._metrics.requests++;
        
        // Build request config
        const requestConfig = this._buildRequestConfig(config);
        
        // Check cache first
        if (this._config.enableCache && requestConfig.method?.toUpperCase() === 'GET') {
            const cached = this._getFromCache(requestConfig);
            if (cached) {
                this._metrics.cacheHits++;
                this._eventSystem.emit('api:cache:hit', { 
                    url: requestConfig.url,
                    requestId 
                });
                return cached;
            }
        }
        
        // Run request interceptors
        const interceptedConfig = await this._runInterceptors('request', requestConfig);
        
        // Emit request start event
        this._eventSystem.emit('api:request:start', {
            config: interceptedConfig,
            requestId
        });
        
        try {
            // Check offline mode
            if (!navigator.onLine && this._config.enableOfflineQueue) {
                return this._queueOfflineRequest(interceptedConfig, requestId);
            }
            
            // Execute request
            const response = await this._executeRequest(interceptedConfig, requestId);
            
            // Run response interceptors
            const interceptedResponse = await this._runInterceptors('response', response);
            
            // Cache response if needed
            if (this._config.enableCache && requestConfig.method?.toUpperCase() === 'GET') {
                this._addToCache(requestConfig, interceptedResponse);
            }
            
            // Emit success event
            this._eventSystem.emit('api:request:success', {
                config: interceptedConfig,
                response: interceptedResponse,
                requestId
            });
            
            this._metrics.successes++;
            return interceptedResponse;
            
        } catch (error) {
            // Run error interceptors
            const interceptedError = await this._runInterceptors('error', error, {
                config: requestConfig,
                requestId
            });
            
            // Emit error event
            this._eventSystem.emit('api:request:error', {
                config: requestConfig,
                error: interceptedError,
                requestId
            });
            
            this._metrics.errors++;
            throw interceptedError;
        }
    }
    
    async get(url, config = {}) {
        return this.request({ ...config, method: 'GET', url });
    }
    
    async post(url, data = null, config = {}) {
        return this.request({ ...config, method: 'POST', url, data });
    }
    
    async put(url, data = null, config = {}) {
        return this.request({ ...config, method: 'PUT', url, data });
    }
    
    async patch(url, data = null, config = {}) {
        return this.request({ ...config, method: 'PATCH', url, data });
    }
    
    async delete(url, config = {}) {
        return this.request({ ...config, method: 'DELETE', url });
    }
    
    // ==================== ADVANCED FEATURES ====================
    
    use(interceptor) {
        if (typeof interceptor !== 'object') {
            throw new TypeError('Interceptor must be an object');
        }
        
        if (interceptor.request) {
            this._interceptors.request.push(interceptor.request);
        }
        
        if (interceptor.response) {
            this._interceptors.response.push(interceptor.response);
        }
        
        if (interceptor.error) {
            this._interceptors.error.push(interceptor.error);
        }
        
        return () => {
            this._interceptors.request = this._interceptors.request
                .filter(i => i !== interceptor.request);
            this._interceptors.response = this._interceptors.response
                .filter(i => i !== interceptor.response);
            this._interceptors.error = this._interceptors.error
                .filter(i => i !== interceptor.error);
        };
    }
    
    setHeader(key, value) {
        this._config.defaultHeaders[key] = value;
        return this;
    }
    
    removeHeader(key) {
        delete this._config.defaultHeaders[key];
        return this;
    }
    
    setBaseURL(url) {
        this._config.baseURL = url;
        return this;
    }
    
    clearCache(pattern = null) {
        if (!pattern) {
            this._cache.clear();
        } else {
            const regex = new RegExp(pattern);
            for (const key of this._cache.keys()) {
                if (regex.test(key)) {
                    this._cache.delete(key);
                }
            }
        }
        
        this._eventSystem.emit('api:cache:cleared', { pattern });
        return this;
    }
    
    getQueueSize() {
        return this._requestQueue.length;
    }
    
    processQueue() {
        if (!navigator.onLine) {
            console.warn('[ApiClient] Cannot process queue while offline');
            return;
        }
        
        const queueSize = this._requestQueue.length;
        if (queueSize === 0) return;
        
        this._eventSystem.emit('api:queue:processing', { size: queueSize });
        
        const promises = this._requestQueue.map(item => 
            this.request(item.config).then(response => {
                // Notify original caller if possible
                if (item.resolve) {
                    item.resolve(response);
                }
                return { success: true, item };
            }).catch(error => {
                if (item.reject) {
                    item.reject(error);
                }
                return { success: false, item, error };
            })
        );
        
        this._requestQueue = [];
        
        return Promise.allSettled(promises).then(results => {
            const successful = results.filter(r => r.status === 'fulfilled' && r.value.success);
            const failed = results.filter(r => r.status === 'fulfilled' && !r.value.success);
            
            this._eventSystem.emit('api:queue:processed', {
                total: queueSize,
                successful: successful.length,
                failed: failed.length
            });
            
            return { successful, failed };
        });
    }
    
    getMetrics() {
        return { ...this._metrics };
    }
    
    resetMetrics() {
        this._metrics.requests = 0;
        this._metrics.successes = 0;
        this._metrics.errors = 0;
        this._metrics.cacheHits = 0;
        return this;
    }
    
    // ==================== PRIVATE METHODS ====================
    
    _initEventListeners() {
        // Network status listener
        window.addEventListener('online', () => {
            this._eventSystem.emit('api:network:online');
            this.processQueue();
        });
        
        window.addEventListener('offline', () => {
            this._eventSystem.emit('api:network:offline');
        });
        
        // Listen for cache clear events
        this._eventSystem.on('cache:clear', (data) => {
            if (data?.target === 'api' || data?.target === 'all') {
                this.clearCache(data.pattern);
            }
        });
    }
    
    _buildRequestConfig(userConfig) {
        const method = (userConfig.method || 'GET').toUpperCase();
        const url = this._buildFullUrl(userConfig.url);
        
        const defaultConfig = {
            method,
            url,
            headers: { ...this._config.defaultHeaders },
            timeout: this._config.timeout,
            retryAttempts: this._config.retryAttempts,
            retryDelay: this._config.retryDelay,
            params: {},
            data: null,
            responseType: 'json',
            withCredentials: false,
            validateStatus: (status) => status >= 200 && status < 300
        };
        
        // Merge user config
        const config = { ...defaultConfig, ...userConfig };
        
        // Merge headers
        config.headers = { ...defaultConfig.headers, ...userConfig.headers };
        
        return config;
    }
    
    _buildFullUrl(url) {
        if (url.startsWith('http://') || url.startsWith('https://')) {
            return url;
        }
        
        const baseURL = this._config.baseURL.replace(/\/$/, '');
        const normalizedUrl = url.replace(/^\//, '');
        
        return `${baseURL}/${normalizedUrl}`;
    }
    
    async _executeRequest(config, requestId) {
        let attempts = 0;
        const maxAttempts = config.retryAttempts || 1;
        
        while (attempts < maxAttempts) {
            attempts++;
            
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), config.timeout);
                
                // Add to pending requests
                this._pendingRequests.set(requestId, { controller, timeoutId });
                
                const fetchConfig = {
                    method: config.method,
                    headers: config.headers,
                    signal: controller.signal,
                    credentials: config.withCredentials ? 'include' : 'same-origin'
                };
                
                if (config.data && ['POST', 'PUT', 'PATCH'].includes(config.method)) {
                    fetchConfig.body = typeof config.data === 'string' 
                        ? config.data 
                        : JSON.stringify(config.data);
                }
                
                const response = await fetch(config.url, fetchConfig);
                
                // Clear timeout and remove from pending
                clearTimeout(timeoutId);
                this._pendingRequests.delete(requestId);
                
                // Parse response
                let data;
                if (config.responseType === 'json') {
                    data = await response.json().catch(() => null);
                } else if (config.responseType === 'text') {
                    data = await response.text();
                } else if (config.responseType === 'blob') {
                    data = await response.blob();
                } else {
                    data = await response.arrayBuffer();
                }
                
                // Validate status
                const isValid = config.validateStatus(response.status);
                if (!isValid) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
                
                return {
                    data,
                    status: response.status,
                    statusText: response.statusText,
                    headers: Object.fromEntries(response.headers.entries()),
                    config,
                    requestId
                };
                
            } catch (error) {
                // Remove from pending on error
                if (this._pendingRequests.has(requestId)) {
                    const { timeoutId } = this._pendingRequests.get(requestId);
                    clearTimeout(timeoutId);
                    this._pendingRequests.delete(requestId);
                }
                
                // Retry logic
                if (attempts < maxAttempts && this._shouldRetry(error)) {
                    const delay = config.retryDelay * Math.pow(2, attempts - 1);
                    
                    this._eventSystem.emit('api:request:retry', {
                        config,
                        error,
                        attempt: attempts,
                        delay,
                        requestId
                    });
                    
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }
                
                throw error;
            }
        }
        
        throw new Error(`Max retry attempts (${maxAttempts}) exceeded`);
    }
    
    _shouldRetry(error) {
        // Retry on network errors or 5xx status codes
        if (error.name === 'AbortError' || error.name === 'TypeError') {
            return true;
        }
        
        if (error.message && error.message.includes('HTTP 5')) {
            return true;
        }
        
        return false;
    }
    
    async _runInterceptors(type, value, context = {}) {
        let result = value;
        const interceptors = this._interceptors[type];
        
        for (const interceptor of interceptors) {
            try {
                result = await interceptor(result, context);
                if (result === undefined) {
                    throw new Error(`Interceptor "${type}" returned undefined`);
                }
            } catch (error) {
                console.error(`[ApiClient] ${type} interceptor error:`, error);
                throw error;
            }
        }
        
        return result;
    }
    
    _getFromCache(config) {
        const cacheKey = this._generateCacheKey(config);
        const cached = this._cache.get(cacheKey);
        
        if (!cached) return null;
        
        // Check TTL
        if (Date.now() - cached.timestamp > this._config.cacheTTL) {
            this._cache.delete(cacheKey);
            return null;
        }
        
        return cached.data;
    }
    
    _addToCache(config, response) {
        const cacheKey = this._generateCacheKey(config);
        
        this._cache.set(cacheKey, {
            data: response,
            timestamp: Date.now(),
            config: { ...config }
        });
        
        // Emit cache update event
        this._eventSystem.emit('api:cache:updated', {
            key: cacheKey,
            url: config.url
        });
    }
    
    _generateCacheKey(config) {
        const { method, url, params, data } = config;
        const paramsStr = params ? JSON.stringify(params) : '';
        const dataStr = data ? JSON.stringify(data) : '';
        
        return `${method}:${url}:${paramsStr}:${dataStr}`;
    }
    
    _queueOfflineRequest(config, requestId) {
        return new Promise((resolve, reject) => {
            const queueItem = {
                config,
                requestId,
                timestamp: Date.now(),
                resolve,
                reject
            };
            
            this._requestQueue.push(queueItem);
            
            this._eventSystem.emit('api:request:queued', {
                config,
                requestId,
                queueSize: this._requestQueue.length
            });
            
            // Auto-resolve with offline response if configured
            if (config.offlineResponse) {
                resolve({
                    data: config.offlineResponse,
                    status: 200,
                    statusText: 'OK (Offline)',
                    headers: {},
                    config,
                    requestId,
                    offline: true
                });
            }
        });
    }
    
    cancelRequest(requestId) {
        if (this._pendingRequests.has(requestId)) {
            const { controller, timeoutId } = this._pendingRequests.get(requestId);
            controller.abort();
            clearTimeout(timeoutId);
            this._pendingRequests.delete(requestId);
            
            this._eventSystem.emit('api:request:canceled', { requestId });
            return true;
        }
        
        // Check if in queue
        const queueIndex = this._requestQueue.findIndex(item => item.requestId === requestId);
        if (queueIndex > -1) {
            this._requestQueue.splice(queueIndex, 1);
            this._eventSystem.emit('api:request:canceled', { requestId });
            return true;
        }
        
        return false;
    }
    
    cancelAll() {
        // Cancel pending requests
        for (const [requestId, { controller, timeoutId }] of this._pendingRequests) {
            controller.abort();
            clearTimeout(timeoutId);
            this._eventSystem.emit('api:request:canceled', { requestId });
        }
        
        this._pendingRequests.clear();
        
        // Clear queue
        const queueSize = this._requestQueue.length;
        this._requestQueue = [];
        
        this._eventSystem.emit('api:request:allCanceled', { 
            pendingCanceled: this._pendingRequests.size,
            queueCanceled: queueSize 
        });
        
        return { pendingCanceled: this._pendingRequests.size, queueCanceled: queueSize };
    }
}

export { HyperApiClient };
