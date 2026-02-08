// core/db/indexeddb-wrapper.js
/**
 * IndexedDB Wrapper - مدیریت اتصال و عملیات پایه پایگاه داده
 * مسئولیت: ایجاد و نگهداری اتصال به IndexedDB با الگوی Singleton
 * اصل SRP: فقط مدیریت اتصال DB و عملیات پایه
 * اصل DIP: وابستگی به interface (DBWrapper) نه پیاده‌سازی مستقیم
 */

class IndexedDBWrapper {
    constructor() {
        if (IndexedDBWrapper.instance) {
            return IndexedDBWrapper.instance;
        }
        
        this.db = null;
        this.dbName = 'farsinglish_db';
        this.dbVersion = 1;
        IndexedDBWrapper.instance = this;
    }

    /**
     * ایجاد یا ارتقای اتصال به پایگاه داده
     * @param {Object} schemaConfig - تنظیمات اسکیما جداول
     * @returns {Promise<IDBDatabase>} - اتصال پایگاه داده
     */
    async connect(schemaConfig = null) {
        return new Promise((resolve, reject) => {
            if (this.db) {
                resolve(this.db);
                return;
            }

            const request = indexedDB.open(this.dbName, this.dbVersion);

            request.onerror = (event) => {
                console.error('خطا در اتصال به IndexedDB:', event.target.error);
                reject(new Error(`Connection failed: ${event.target.error}`));
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                console.log('اتصال به IndexedDB با موفقیت برقرار شد');
                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                console.log('بروزرسانی اسکیما IndexedDB');

                // اگر schemaConfig ارائه شده، جداول را ایجاد کن
                if (schemaConfig) {
                    this._createTables(db, schemaConfig);
                }
            };
        });
    }

    /**
     * ایجاد جداول بر اساس تنظیمات اسکیما
     * @param {IDBDatabase} db - اتصال پایگاه داده
     * @param {Object} schemaConfig - تنظیمات جداول
     * @private
     */
    _createTables(db, schemaConfig) {
        Object.entries(schemaConfig).forEach(([tableName, config]) => {
            if (!db.objectStoreNames.contains(tableName)) {
                const store = db.createObjectStore(tableName, {
                    keyPath: config.keyPath || 'id',
                    autoIncrement: config.autoIncrement || false
                });

                // ایجاد ایندکس‌ها
                if (config.indexes && Array.isArray(config.indexes)) {
                    config.indexes.forEach(indexConfig => {
                        store.createIndex(
                            indexConfig.name,
                            indexConfig.keyPath,
                            indexConfig.options || {}
                        );
                    });
                }

                console.log(`جدول ${tableName} ایجاد شد`);
            }
        });
    }

    /**
     * دریافت اتصال فعلی پایگاه داده
     * @returns {IDBDatabase|null} - اتصال DB یا null
     */
    getConnection() {
        return this.db;
    }

    /**
     * بررسی وضعیت اتصال
     * @returns {boolean} - وضعیت اتصال
     */
    isConnected() {
        return !!this.db;
    }

    /**
     * بستن اتصال پایگاه داده
     * @returns {Promise<void>}
     */
    async disconnect() {
        return new Promise((resolve) => {
            if (this.db) {
                this.db.close();
                this.db = null;
                console.log('اتصال IndexedDB بسته شد');
            }
            resolve();
        });
    }

    /**
     * حذف کامل پایگاه داده (برای توسعه)
     * @returns {Promise<void>}
     */
    async deleteDatabase() {
        await this.disconnect();
        return new Promise((resolve, reject) => {
            const request = indexedDB.deleteDatabase(this.dbName);
            
            request.onerror = (event) => {
                reject(new Error(`Delete failed: ${event.target.error}`));
            };
            
            request.onsuccess = () => {
                console.log('پایگاه داده حذف شد');
                resolve();
            };
        });
    }

    /**
     * شروع تراکنش
     * @param {string} storeName - نام استور
     * @param {string} mode - حالت تراکنش ('readonly' یا 'readwrite')
     * @returns {IDBTransaction} - تراکنش
     */
    startTransaction(storeName, mode = 'readonly') {
        if (!this.db) {
            throw new Error('اتصال پایگاه داده برقرار نیست');
        }
        
        if (!this.db.objectStoreNames.contains(storeName)) {
            throw new Error(`جدول ${storeName} وجود ندارد`);
        }

        return this.db.transaction(storeName, mode);
    }

    /**
     * اجرای عملیات در تراکنش
     * @param {Function} operation - عملیات برای اجرا
     * @param {string} storeName - نام استور
     * @param {string} mode - حالت تراکنش
     * @returns {Promise<any>} - نتیجه عملیات
     */
    async executeInTransaction(operation, storeName, mode = 'readwrite') {
        return new Promise((resolve, reject) => {
            const transaction = this.startTransaction(storeName, mode);
            const store = transaction.objectStore(storeName);
            
            transaction.oncomplete = () => resolve();
            transaction.onerror = (event) => reject(event.target.error);
            
            operation(store, transaction);
        });
    }
}

// Singleton instance
const indexedDBWrapper = new IndexedDBWrapper();

// Interface برای Dependency Injection
class IDBWrapperInterface {
    async connect(schemaConfig) {}
    getConnection() {}
    isConnected() {}
    async disconnect() {}
    async deleteDatabase() {}
    startTransaction(storeName, mode) {}
    async executeInTransaction(operation, storeName, mode) {}
}

export { IndexedDBWrapper, indexedDBWrapper, IDBWrapperInterface };
