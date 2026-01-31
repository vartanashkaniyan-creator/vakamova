// core/database.js - سیستم پایگاه داده پیشرفته Vakamova
// اصول: تزریق وابستگی، قرارداد رابط، رویداد محور، پیکربندی متمرکز

class VakamovaDatabase {
    // ==================== پیکربندی متمرکز ====================
    static config = {
        name: 'VakamovaDB',
        version: 1,
        stores: {
            users: { keyPath: 'id', indexes: ['email'] },
            lessons: { keyPath: 'id', indexes: ['language', 'level'] },
            progress: { keyPath: 'id', indexes: ['userId', 'lessonId'] },
            cache: { keyPath: 'key', indexes: ['expiresAt'] }
        },
        limits: {
            maxSize: 50 * 1024 * 1024, // 50MB
            maxConnections: 3,
            queryTimeout: 10000 // 10s
        }
    };

    // ==================== قرارداد رابط ====================
    constructor(dependencies = {}) {
        // تزریق وابستگی‌ها
        this.eventBus = dependencies.eventBus || this.createEventBus();
        this.logger = dependencies.logger || console;
        this.config = { ...VakamovaDatabase.config, ...dependencies.config };
        
        // وضعیت داخلی
        this.db = null;
        this.isInitialized = false;
        this.pendingOperations = new Map();
        this.connectionQueue = [];
        
        // رویدادهای داخلی
        this.events = {
            CONNECTED: 'database:connected',
            ERROR: 'database:error',
            QUERY_START: 'database:query:start',
            QUERY_END: 'database:query:end',
            MIGRATION: 'database:migration'
        };
    }

    // ==================== رابط عمومی ====================
    async init() {
        try {
            await this.connect();
            await this.createStores();
            await this.runMigrations();
            
            this.isInitialized = true;
            this.emit(this.events.CONNECTED, { timestamp: Date.now() });
            
            this.logger.log('[VakamovaDB] ✅ پایگاه داده راه‌اندازی شد');
            return this;
        } catch (error) {
            this.handleError('init', error);
            throw error;
        }
    }

    async query(storeName, operation, ...args) {
        this.validateStore(storeName);
        
        const queryId = this.generateQueryId();
        this.emit(this.events.QUERY_START, { queryId, storeName, operation });
        
        try {
            const result = await this.executeWithTimeout(
                () => this[`_${operation}`](storeName, ...args),
                this.config.limits.queryTimeout
            );
            
            this.emit(this.events.QUERY_END, { queryId, success: true });
            return result;
        } catch (error) {
            this.emit(this.events.QUERY_END, { queryId, success: false, error: error.message });
            throw error;
        }
    }

    async transaction(operations) {
        if (!Array.isArray(operations)) {
            throw new Error('Operations must be an array');
        }

        const transactionId = `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const results = [];
        const errors = [];

        for (const op of operations) {
            try {
                const result = await this.query(op.store, op.operation, ...(op.args || []));
                results.push({ ...op, success: true, result });
            } catch (error) {
                errors.push({ ...op, success: false, error: error.message });
                
                // Rollback if requested
                if (op.rollbackOnError) {
                    this.logger.warn(`[VakamovaDB] Rolling back transaction ${transactionId}`);
                    await this.rollbackTransaction(results);
                    throw new Error(`Transaction failed: ${error.message}`);
                }
            }
        }

        return { transactionId, results, errors, completed: errors.length === 0 };
    }

    // ==================== عملیات CRUD ====================
    async create(storeName, data) {
        return this.query(storeName, 'create', data);
    }

    async read(storeName, key) {
        return this.query(storeName, 'read', key);
    }

    async readAll(storeName, indexName, queryRange) {
        return this.query(storeName, 'readAll', indexName, queryRange);
    }

    async update(storeName, key, updates) {
        return this.query(storeName, 'update', key, updates);
    }

    async delete(storeName, key) {
        return this.query(storeName, 'delete', key);
    }

    // ==================== عملیات ویژه ====================
    async search(storeName, criteria) {
        const allItems = await this.readAll(storeName);
        return allItems.filter(item => this.matchesCriteria(item, criteria));
    }

    async paginate(storeName, page = 1, pageSize = 20, sortBy = 'createdAt', sortOrder = 'desc') {
        const allItems = await this.readAll(storeName);
        const sorted = allItems.sort((a, b) => {
            const aVal = a[sortBy] || 0;
            const bVal = b[sortBy] || 0;
            return sortOrder === 'desc' ? bVal - aVal : aVal - bVal;
        });

        const start = (page - 1) * pageSize;
        const end = start + pageSize;
        const items = sorted.slice(start, end);

        return {
            items,
            page,
            pageSize,
            total: allItems.length,
            totalPages: Math.ceil(allItems.length / pageSize),
            hasNext: end < allItems.length,
            hasPrev: page > 1
        };
    }

    async bulkUpsert(storeName, items) {
        const operations = items.map(item => ({
            store: storeName,
            operation: item.id ? 'update' : 'create',
            args: item.id ? [item.id, item] : [item],
            rollbackOnError: true
        }));

        return this.transaction(operations);
    }

    // ==================== مدیریت کش ====================
    async cache(key, value, ttl = 3600000) {
        const cacheItem = {
            key,
            value,
            expiresAt: Date.now() + ttl,
            createdAt: new Date().toISOString()
        };

        await this.create('cache', cacheItem);
        return cacheItem;
    }

    async getCached(key) {
        try {
            const item = await this.read('cache', key);
            
            if (!item || item.expiresAt < Date.now()) {
                if (item) await this.delete('cache', key);
                return null;
            }

            return item.value;
        } catch {
            return null;
        }
    }

    async cleanupCache() {
        const allCache = await this.readAll('cache');
        const expired = allCache.filter(item => item.expiresAt < Date.now());
        
        for (const item of expired) {
            await this.delete('cache', item.key);
        }

        return { cleaned: expired.length };
    }

    // ==================== پشتیبان‌گیری ====================
    async backup() {
        const backup = {
            timestamp: new Date().toISOString(),
            version: this.config.version,
            stores: {}
        };

        for (const storeName in this.config.stores) {
            try {
                backup.stores[storeName] = await this.readAll(storeName);
            } catch (error) {
                backup.stores[storeName] = [];
                this.logger.warn(`[VakamovaDB] Failed to backup ${storeName}: ${error.message}`);
            }
        }

        // ذخیره در localStorage به عنوان fallback
        try {
            localStorage.setItem('vakamova_db_backup', JSON.stringify(backup));
        } catch (error) {
            this.logger.warn('[VakamovaDB] Could not save backup to localStorage');
        }

        return backup;
    }

    async restore(backupData) {
        if (!backupData || !backupData.stores) {
            throw new Error('Invalid backup data');
        }

        const operations = [];
        for (const [storeName, items] of Object.entries(backupData.stores)) {
            if (!this.config.stores[storeName]) continue;
            
            // Clear existing data
            operations.push({
                store: storeName,
                operation: 'clear',
                rollbackOnError: true
            });

            // Add backup items
            items.forEach(item => {
                operations.push({
                    store: storeName,
                    operation: 'create',
                    args: [item],
                    rollbackOnError: true
                });
            });
        }

        return this.transaction(operations);
    }

    // ==================== متدهای خصوصی ====================
    async _create(storeName, data) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            
            // Add metadata
            const enhancedData = {
                ...data,
                _createdAt: new Date().toISOString(),
                _updatedAt: new Date().toISOString(),
                _version: this.config.version
            };

            const request = store.add(enhancedData);
            
            request.onsuccess = (event) => resolve(event.target.result);
            request.onerror = (event) => reject(new Error(`Create failed: ${event.target.error}`));
        });
    }

    async _read(storeName, key) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            
            const request = store.get(key);
            
            request.onsuccess = (event) => {
                const result = event.target.result;
                if (result && result._expiresAt && result._expiresAt < Date.now()) {
                    this._delete(storeName, key).catch(() => {});
                    resolve(null);
                } else {
                    resolve(result);
                }
            };
            
            request.onerror = (event) => reject(new Error(`Read failed: ${event.target.error}`));
        });
    }

    async _readAll(storeName, indexName, queryRange) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readonly');
            let store = transaction.objectStore(storeName);
            
            if (indexName && store.indexNames.contains(indexName)) {
                store = store.index(indexName);
            }
            
            const request = queryRange ? store.getAll(queryRange) : store.getAll();
            
            request.onsuccess = (event) => resolve(event.target.result);
            request.onerror = (event) => reject(new Error(`ReadAll failed: ${event.target.error}`));
        });
    }

    async _update(storeName, key, updates) {
        const existing = await this._read(storeName, key);
        if (!existing) {
            throw new Error(`Record with key ${key} not found`);
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            
            const updatedData = {
                ...existing,
                ...updates,
                _updatedAt: new Date().toISOString(),
                _version: this.config.version
            };

            const request = store.put(updatedData);
            
            request.onsuccess = (event) => resolve(event.target.result);
            request.onerror = (event) => reject(new Error(`Update failed: ${event.target.error}`));
        });
    }

    async _delete(storeName, key) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            
            const request = store.delete(key);
            
            request.onsuccess = () => resolve(true);
            request.onerror = (event) => reject(new Error(`Delete failed: ${event.target.error}`));
        });
    }

    async _clear(storeName) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            
            const request = store.clear();
            
            request.onsuccess = () => resolve(true);
            request.onerror = (event) => reject(new Error(`Clear failed: ${event.target.error}`));
        });
    }

    // ==================== سرویس‌های کمکی ====================
    async connect() {
        return new Promise((resolve, reject) => {
            if (this.db) {
                resolve(this.db);
                return;
            }

            const request = indexedDB.open(this.config.name, this.config.version);
            
            request.onerror = (event) => {
                reject(new Error(`Connection failed: ${event.target.error}`));
            };
            
            request.onsuccess = (event) => {
                this.db = event.target.result;
                
                // تنظیم هندلرهای خطا
                this.db.onerror = (event) => {
                    this.handleError('database', event.target.error);
                };
                
                this.db.onversionchange = () => {
                    this.db.close();
                    this.logger.warn('[VakamovaDB] Database version changed, connection closed');
                };
                
                resolve(this.db);
            };
            
            request.onupgradeneeded = (event) => {
                this.handleUpgrade(event);
            };
        });
    }

    handleUpgrade(event) {
        const db = event.target.result;
        
        for (const [storeName, config] of Object.entries(this.config.stores)) {
            if (!db.objectStoreNames.contains(storeName)) {
                const store = db.createObjectStore(storeName, { keyPath: config.keyPath });
                
                // ایجاد ایندکس‌ها
                config.indexes.forEach(index => {
                    store.createIndex(index, index, { unique: false });
                });
                
                this.emit(this.events.MIGRATION, { storeName, action: 'created' });
            }
        }
    }

    async runMigrations() {
        const migrations = {
            1: async (db) => {
                // Migration logic for version 1
                this.logger.log('[VakamovaDB] Running migration to version 1');
            }
            // Add more migrations as version increases
        };

        const currentVersion = this.db.version;
        for (let version = 1; version <= currentVersion; version++) {
            if (migrations[version]) {
                await migrations[version](this.db);
            }
        }
    }

    async executeWithTimeout(operation, timeout) {
        return new Promise(async (resolve, reject) => {
            const timeoutId = setTimeout(() => {
                reject(new Error(`Operation timeout after ${timeout}ms`));
            }, timeout);

            try {
                const result = await operation();
                clearTimeout(timeoutId);
                resolve(result);
            } catch (error) {
                clearTimeout(timeoutId);
                reject(error);
            }
        });
    }

    async rollbackTransaction(completedOperations) {
        const rollbackOps = [];
        
        for (const op of completedOperations.reverse()) {
            if (op.operation === 'create' && op.success) {
                rollbackOps.push({
                    store: op.store,
                    operation: 'delete',
                    args: [op.result], // result is the key for created items
                    rollbackOnError: false
                });
            }
        }

        if (rollbackOps.length > 0) {
            await this.transaction(rollbackOps);
        }
    }

    // ==================== اعتبارسنجی‌ها ====================
    validateStore(storeName) {
        if (!this.isInitialized) {
            throw new Error('Database not initialized. Call init() first.');
        }
        
        if (!this.config.stores[storeName]) {
            throw new Error(`Store "${storeName}" does not exist`);
        }
        
        if (!this.db.objectStoreNames.contains(storeName)) {
            throw new Error(`Store "${storeName}" not found in database`);
        }
    }

    matchesCriteria(item, criteria) {
        for (const [key, value] of Object.entries(criteria)) {
            if (item[key] !== value) {
                return false;
            }
        }
        return true;
    }

    generateQueryId() {
        return `q_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    // ==================== مدیریت رویدادها ====================
    createEventBus() {
        const listeners = new Map();
        
        return {
            emit: (event, data) => {
                const eventListeners = listeners.get(event) || [];
                eventListeners.forEach(listener => {
                    try {
                        listener(data);
                    } catch (error) {
                        this.logger.error(`[EventBus] Listener error for ${event}:`, error);
                    }
                });
            },
            on: (event, listener) => {
                if (!listeners.has(event)) {
                    listeners.set(event, []);
                }
                listeners.get(event).push(listener);
                
                // Return unsubscribe function
                return () => {
                    const eventListeners = listeners.get(event) || [];
                    const index = eventListeners.indexOf(listener);
                    if (index > -1) {
                        eventListeners.splice(index, 1);
                    }
                };
            },
            off: (event, listener) => {
                const eventListeners = listeners.get(event);
                if (eventListeners) {
                    const index = eventListeners.indexOf(listener);
                    if (index > -1) {
                        eventListeners.splice(index, 1);
                    }
                }
            }
        };
    }

    emit(event, data) {
        this.eventBus.emit(event, data);
    }

    on(event, listener) {
        return this.eventBus.on(event, listener);
    }

    // ==================== مدیریت خطاها ====================
    handleError(context, error) {
        const errorInfo = {
            context,
            message: error.message,
            timestamp: new Date().toISOString(),
            stack: error.stack
        };
        
        this.logger.error(`[VakamovaDB] Error in ${context}:`, error);
        this.emit(this.events.ERROR, errorInfo);
    }

    // ==================== ابزارهای کمکی ====================
    async getStats() {
        if (!this.db) return null;
        
        const stats = {
            stores: Array.from(this.db.objectStoreNames),
            version: this.db.version,
            isInitialized: this.isInitialized,
            pendingOperations: this.pendingOperations.size,
            connectionQueue: this.connectionQueue.length
        };

        // Count records in each store
        stats.storeCounts = {};
        for (const storeName of stats.stores) {
            try {
                const items = await this.readAll(storeName);
                stats.storeCounts[storeName] = items.length;
            } catch {
                stats.storeCounts[storeName] = 0;
            }
        }

        return stats;
    }

    async close() {
        if (this.db) {
            this.db.close();
            this.db = null;
            this.isInitialized = false;
            this.logger.log('[VakamovaDB] Database connection closed');
        }
    }

    async destroy() {
        await this.close();
        
        return new Promise((resolve, reject) => {
            const request = indexedDB.deleteDatabase(this.config.name);
            
            request.onsuccess = () => {
                this.logger.log('[VakamovaDB] Database destroyed');
                resolve(true);
            };
            
            request.onerror = (event) => {
                reject(new Error(`Destroy failed: ${event.target.error}`));
            };
        });
    }
}

// ==================== فکتوری برای ایجاد نمونه‌ها ====================
class DatabaseFactory {
    static instances = new Map();
    
    static async create(config = {}) {
        const instance = new VakamovaDatabase(config);
        await instance.init();
        return instance;
    }
    
    static async getInstance(name = 'default', config = {}) {
        if (!this.instances.has(name)) {
            const instance = await this.create(config);
            this.instances.set(name, instance);
        }
        
        return this.instances.get(name);
    }
    
    static destroyInstance(name = 'default') {
        const instance = this.instances.get(name);
        if (instance) {
            instance.close();
            this.instances.delete(name);
        }
    }
}

// ==================== اکسپورت ====================
export { VakamovaDatabase as Database, DatabaseFactory };

// اکسپورت پیش‌فرض برای backward compatibility
export default VakamovaDatabase;
