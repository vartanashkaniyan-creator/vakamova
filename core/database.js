// core/database.js

import IDatabase from './database-interface.js';
import SchemaManager from './schema-manager.js';
import MigrationEngine from './migration-engine.js';

/**
 * پیاده‌سازی نهایی لایه دیتابیس
 * ترکیبی از: ذخیره‌سازی + مدیریت اسکیما + مهاجرت
 * @implements {IDatabase}
 */
class Database extends IDatabase {
  constructor(dbName = 'VakamovaDB') {
    super();
    this.dbName = dbName;
    this._db = null;
    this.schemaManager = new SchemaManager();
    this.migrationEngine = null;
    this.currentSchemaVersion = 0;
    this.isInitialized = false;
    
    // کش در حافظه برای عملکرد بهتر
    this._cache = new Map();
    this._cacheEnabled = true;
  }

  /**
   * مقداردهی اولیه دیتابیس با مدیریت خودکار مهاجرت
   */
  async init(schema) {
    if (this.isInitialized) {
      console.warn('Database already initialized');
      return true;
    }

    // 1. تعریف اسکیما در SchemaManager
    await this.schemaManager.defineSchema(schema.version, schema.stores);
    this.currentSchemaVersion = schema.version;

    // 2. باز کردن دیتابیس IndexedDB
    await this._openIndexedDB(schema);

    // 3. تنظیم MigrationEngine
    this.migrationEngine = new MigrationEngine(this, this.schemaManager);
    
    // 4. بررسی نسخه فعلی ذخیره شده
    const storedVersion = await this._getStoredVersion();
    
    // 5. اجرای مهاجرت اگر لازم باشد
    if (storedVersion < schema.version) {
      await this.migrationEngine.migrate(storedVersion, schema.version);
      await this._setStoredVersion(schema.version);
    }

    // 6. لود کش اولیه
    if (this._cacheEnabled) {
      await this._loadInitialCache();
    }

    this.isInitialized = true;
    console.log(`Database initialized: ${this.dbName} v${schema.version}`);
    return true;
  }

  /**
   * باز کردن ارتباط با IndexedDB
   * @private
   */
  async _openIndexedDB(schema) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, schema.version);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this._db = request.result;
        resolve(true);
      };
      
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        const oldVersion = event.oldVersion;
        const newVersion = event.newVersion;
        
        console.log(`Upgrading database from v${oldVersion} to v${newVersion}`);
        
        // ایجاد/به‌روزرسانی storeها
        schema.stores.forEach(store => {
          if (!db.objectStoreNames.contains(store.name)) {
            this._createObjectStore(db, store);
          }
        });
      };
    });
  }

  /**
   * ایجاد object store جدید
   * @private
   */
  _createObjectStore(db, store) {
    const objectStore = db.createObjectStore(store.name, {
      keyPath: store.keyPath || 'id',
      autoIncrement: store.autoIncrement || false
    });
    
    if (store.indexes) {
      store.indexes.forEach(index => {
        objectStore.createIndex(index.name, index.keyPath, {
          unique: index.unique || false,
          multiEntry: index.multiEntry || false
        });
      });
    }
  }

  /**
   * دریافت نسخه ذخیره شده دیتابیس
   * @private
   */
  async _getStoredVersion() {
    try {
      if (!this._db) return 0;
      
      const transaction = this._db.transaction(['_metadata'], 'readonly');
      const store = transaction.objectStore('_metadata');
      const request = store.get('db_version');
      
      return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result?.value || 0);
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      return 0; // اگر store وجود نداشت
    }
  }

  /**
   * ذخیره نسخه فعلی دیتابیس
   * @private
   */
  async _setStoredVersion(version) {
    if (!this._db) return;
    
    const transaction = this._db.transaction(['_metadata'], 'readwrite');
    const store = transaction.objectStore('_metadata');
    store.put({ id: 'db_version', value: version, updatedAt: new Date().toISOString() });
    
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  /**
   * لود کش اولیه برای داده‌های پرکاربرد
   * @private
   */
  async _loadInitialCache() {
    try {
      // کش کردن آخرین 100 رکورد هر store
      const stores = Array.from(this._db.objectStoreNames);
      for (const storeName of stores) {
        if (storeName.startsWith('_')) continue; // storeهای سیستمی را نادیده بگیر
        
        const records = await this.getAll(storeName, { limit: 100 });
        this._cache.set(storeName, records.slice(0, 50)); // فقط 50 تای اول را کش کن
      }
    } catch (error) {
      console.warn('Cache preload failed:', error.message);
    }
  }

  /**
   * متدهای اصلی CRUD با پشتیبانی از کش
   */

  async add(storeName, record) {
    this._validateStoreName(storeName);
    
    const transaction = this._db.transaction([storeName], 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.add(record);
    
    const result = await this._executeRequest(request);
    
    // به‌روزرسانی کش
    if (this._cacheEnabled && this._cache.has(storeName)) {
      const cached = this._cache.get(storeName);
      cached.unshift({ ...record, id: result });
      if (cached.length > 100) cached.pop();
    }
    
    return result;
  }

  async bulkAdd(storeName, records) {
    this._validateStoreName(storeName);
    
    const results = [];
    const transaction = this._db.transaction([storeName], 'readwrite');
    const store = transaction.objectStore(storeName);
    
    for (const record of records) {
      const request = store.add(record);
      const result = await new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      results.push(result);
    }
    
    return results;
  }

  async get(storeName, key) {
    this._validateStoreName(storeName);
    
    // بررسی کش
    if (this._cacheEnabled) {
      const cached = this._cache.get(storeName);
      if (cached) {
        const cachedRecord = cached.find(r => r.id === key);
        if (cachedRecord) return cachedRecord;
      }
    }
    
    const transaction = this._db.transaction([storeName], 'readonly');
    const store = transaction.objectStore(storeName);
    const request = store.get(key);
    
    return this._executeRequest(request);
  }

  async update(storeName, key, updates) {
    this._validateStoreName(storeName);
    
    // ابتدا رکورد فعلی را بگیر
    const current = await this.get(storeName, key);
    if (!current) {
      throw new Error(`Record with key ${key} not found in ${storeName}`);
    }
    
    // ادغام تغییرات
    const updatedRecord = { ...current, ...updates, _updatedAt: new Date().toISOString() };
    
    const transaction = this._db.transaction([storeName], 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.put(updatedRecord);
    
    const result = await this._executeRequest(request);
    
    // به‌روزرسانی کش
    if (this._cacheEnabled && this._cache.has(storeName)) {
      const cached = this._cache.get(storeName);
      const index = cached.findIndex(r => r.id === key);
      if (index !== -1) {
        cached[index] = updatedRecord;
      }
    }
    
    return result;
  }

  async delete(storeName, key) {
    this._validateStoreName(storeName);
    
    const transaction = this._db.transaction([storeName], 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.delete(key);
    
    // حذف از کش
    if (this._cacheEnabled && this._cache.has(storeName)) {
      const cached = this._cache.get(storeName);
      const index = cached.findIndex(r => r.id === key);
      if (index !== -1) {
        cached.splice(index, 1);
      }
    }
    
    return this._executeRequest(request);
  }

  async clear(storeName) {
    this._validateStoreName(storeName);
    
    const transaction = this._db.transaction([storeName], 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.clear();
    
    // پاک کردن کش
    if (this._cacheEnabled) {
      this._cache.delete(storeName);
    }
    
    return this._executeRequest(request);
  }

  async queryByIndex(storeName, indexName, value, options = {}) {
    this._validateStoreName(storeName);
    
    const transaction = this._db.transaction([storeName], 'readonly');
    const store = transaction.objectStore(storeName);
    const index = store.index(indexName);
    const range = value === null || value === undefined 
      ? null 
      : IDBKeyRange.only(value);
    
    const request = range ? index.openCursor(range) : index.openCursor();
    return this._collectResults(request, options);
  }

  async queryByRange(storeName, indexName, lowerBound, upperBound, options = {}) {
    this._validateStoreName(storeName);
    
    const transaction = this._db.transaction([storeName], 'readonly');
    const store = transaction.objectStore(storeName);
    const index = store.index(indexName);
    const range = IDBKeyRange.bound(lowerBound, upperBound);
    const request = index.openCursor(range);
    
    return this._collectResults(request, options);
  }

  async getAll(storeName, options = {}) {
    this._validateStoreName(storeName);
    
    // بررسی کش
    if (this._cacheEnabled && !options.forceRefresh) {
      const cached = this._cache.get(storeName);
      if (cached) {
        return this._applyOptions(cached, options);
      }
    }
    
    const transaction = this._db.transaction([storeName], 'readonly');
    const store = transaction.objectStore(storeName);
    const request = store.openCursor();
    
    const results = await this._collectResults(request, options);
    
    // ذخیره در کش
    if (this._cacheEnabled && !options.skipCache) {
      this._cache.set(storeName, results.slice(0, 100));
    }
    
    return results;
  }

  async count(storeName) {
    this._validateStoreName(storeName);
    
    const transaction = this._db.transaction([storeName], 'readonly');
    const store = transaction.objectStore(storeName);
    const request = store.count();
    
    return this._executeRequest(request);
  }

  async transaction(storeNames, mode, transactionLogic) {
    if (!this._db) {
      throw new Error('Database not initialized');
    }
    
    // اعتبارسنجی نام storeها
    storeNames.forEach(name => this._validateStoreName(name));
    
    const transaction = this._db.transaction(storeNames, mode);
    
    try {
      const result = await transactionLogic(transaction);
      
      return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve(result);
        transaction.onerror = () => reject(transaction.error);
      });
    } catch (error) {
      transaction.abort();
      throw error;
    }
  }

  async close() {
    if (this._db) {
      this._db.close();
      this._db = null;
      this.isInitialized = false;
      this._cache.clear();
    }
  }

  async isReady() {
    return this.isInitialized && this._db !== null;
  }

  async deleteDatabase() {
    await this.close();
    
    return new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(this.dbName);
      request.onsuccess = () => {
        this._cache.clear();
        resolve(true);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * ابزارهای کمکی
   * @private
   */

  _executeRequest(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  _collectResults(request, options) {
    const results = [];
    let offset = options.offset || 0;
    const limit = options.limit || Infinity;
    const filter = options.filter || (() => true);
    const sort = options.sort;

    return new Promise((resolve, reject) => {
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          if (offset > 0) {
            offset--;
            cursor.continue();
            return;
          }
          
          if (filter(cursor.value)) {
            results.push(cursor.value);
          }
          
          if (results.length >= limit) {
            resolve(this._applySort(results, sort));
          } else {
            cursor.continue();
          }
        } else {
          resolve(this._applySort(results, sort));
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  _applySort(results, sort) {
    if (!sort || results.length === 0) return results;
    
    return results.sort((a, b) => {
      for (const [key, direction] of Object.entries(sort)) {
        if (a[key] < b[key]) return direction === 'asc' ? -1 : 1;
        if (a[key] > b[key]) return direction === 'asc' ? 1 : -1;
      }
      return 0;
    });
  }

  _applyOptions(results, options) {
    let filtered = results;
    
    if (options.filter) {
      filtered = filtered.filter(options.filter);
    }
    
    if (options.sort) {
      filtered = this._applySort(filtered, options.sort);
    }
    
    if (options.offset) {
      filtered = filtered.slice(options.offset);
    }
    
    if (options.limit && options.limit < filtered.length) {
      filtered = filtered.slice(0, options.limit);
    }
    
    return filtered;
  }

  _validateStoreName(storeName) {
    if (!this._db) {
      throw new Error('Database not initialized');
    }
    
    if (!this._db.objectStoreNames.contains(storeName)) {
      throw new Error(`Store "${storeName}" does not exist`);
    }
  }

  /**
   * متدهای مدیریتی اضافی
   */

  async getSchema() {
    return this.schemaManager.getSchema();
  }

  async registerMigration(version, migrationFunction) {
    return this.migrationEngine.registerDataMigration(version, migrationFunction);
  }

  async getMigrationHistory() {
    return this.migrationEngine.getMigrationHistory();
  }

  async enableCache(enable = true) {
    this._cacheEnabled = enable;
    if (!enable) this._cache.clear();
  }

  async clearCache() {
    this._cache.clear();
  }

  async getDatabaseInfo() {
    if (!this._db) return null;
    
    const info = {
      name: this.dbName,
      version: this.currentSchemaVersion,
      stores: [],
      cacheStats: {
        enabled: this._cacheEnabled,
        size: this._cache.size,
        totalItems: Array.from(this._cache.values()).reduce((sum, arr) => sum + arr.length, 0)
      }
    };
    
    for (const storeName of this._db.objectStoreNames) {
      const count = await this.count(storeName);
      info.stores.push({
        name: storeName,
        recordCount: count
      });
    }
    
    return info;
  }
}

export default Database;
