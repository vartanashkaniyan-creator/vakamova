// ==================== VAKAMOVA DATABASE CORE ====================
// Professional IndexedDB Wrapper with Dependency Injection & Event-Driven Architecture

class VakamovaDatabase {
    static CONTRACT = {
        name: 'VakamovaDatabase',
        version: '4.0.0',
        methods: ['init', 'query', 'transaction', 'migrate', 'backup', 'restore'],
        events: ['db:ready', 'db:error', 'db:migrated', 'db:backup']
    };

    constructor(dependencies = {}) {
        // Dependency Injection
        this.config = dependencies.config || window.VakamovaConfig;
        this.eventBus = dependencies.eventBus || window.VakamovaEventBus;
        this.logger = dependencies.logger || console;
        this.validator = dependencies.validator;
        this.security = dependencies.security;
        
        this.name = this.config?.database?.name || 'VakamovaDB';
        this.version = this.config?.database?.version || 4;
        this.db = null;
        this.connections = new Map();
        this.metrics = {
            queries: 0,
            transactions: 0,
            errors: 0,
            cacheHits: 0
        };
        
        // Schema definition with relationships
        this.schema = {
            users: {
                keyPath: 'id',
                indexes: [
                    { name: 'email', keyPath: 'email', unique: true },
                    { name: 'username', keyPath: 'username' },
                    { name: 'createdAt', keyPath: 'createdAt' }
                ]
            },
            lessons: {
                keyPath: 'id',
                indexes: [
                    { name: 'language', keyPath: 'language' },
                    { name: 'level', keyPath: 'level' },
                    { name: 'category', keyPath: 'category' },
                    { name: 'language_level', keyPath: ['language', 'level'] }
                ]
            },
            progress: {
                keyPath: 'id',
                autoIncrement: true,
                indexes: [
                    { name: 'userId', keyPath: 'userId' },
                    { name: 'lessonId', keyPath: 'lessonId' },
                    { name: 'completedAt', keyPath: 'completedAt' },
                    { name: 'user_lesson', keyPath: ['userId', 'lessonId'], unique: true }
                ]
            },
            cache: {
                keyPath: 'key',
                indexes: [
                    { name: 'expiresAt', keyPath: 'expiresAt' },
                    { name: 'category', keyPath: 'category' }
                ]
            }
        };
        
        this._bindMethods();
    }

    async init() {
        try {
            if (this.db) {
                this.logger?.warn('Database already initialized');
                return this;
            }

            // Test IndexedDB availability
            if (!window.indexedDB) {
                throw new Error('IndexedDB is not supported in this browser');
            }

            this.db = await this._openDatabase();
            await this._runMigrations();
            await this._createConnectionPool();
            
            this.eventBus?.emit('db:ready', { 
                name: this.name, 
                version: this.version,
                timestamp: new Date().toISOString()
            });
            
            this.logger?.info(`Database ${this.name} v${this.version} initialized`);
            return this;
        } catch (error) {
            this.eventBus?.emit('db:error', { error: error.message });
            this.logger?.error('Database initialization failed:', error);
            throw error;
        }
    }

    async query(storeName, options = {}) {
        this.metrics.queries++;
        
        const {
            type = 'get',
            key,
            index,
            range,
            filter,
            limit = 100,
            offset = 0,
            orderBy,
            orderDirection = 'asc'
        } = options;

        return new Promise((resolve, reject) => {
            try {
                const transaction = this.db.transaction([storeName], 'readonly');
                const store = transaction.objectStore(storeName);
                
                let request;
                switch (type) {
                    case 'get':
                        request = store.get(key);
                        break;
                    case 'getAll':
                        if (index && store.indexNames.contains(index)) {
                            const idx = store.index(index);
                            request = range ? idx.getAll(range) : idx.getAll();
                        } else {
                            request = store.getAll();
                        }
                        break;
                    case 'count':
                        request = store.count(key);
                        break;
                    default:
                        throw new Error(`Invalid query type: ${type}`);
                }

                request.onsuccess = (event) => {
                    let result = event.target.result;
                    
                    // Apply filters if provided
                    if (filter && Array.isArray(result)) {
                        result = result.filter(filter);
                    }
                    
                    // Apply ordering if provided
                    if (orderBy && Array.isArray(result)) {
                        result.sort((a, b) => {
                            const aVal = a[orderBy];
                            const bVal = b[orderBy];
                            const direction = orderDirection === 'asc' ? 1 : -1;
                            
                            if (aVal < bVal) return -1 * direction;
                            if (aVal > bVal) return 1 * direction;
                            return 0;
                        });
                    }
                    
                    // Apply pagination
                    if (Array.isArray(result) && (offset > 0 || limit < result.length)) {
                        result = result.slice(offset, offset + limit);
                    }
                    
                    resolve(result);
                };

                request.onerror = (event) => {
                    reject(new Error(`Query failed: ${event.target.error}`));
                };
            } catch (error) {
                reject(error);
            }
        });
    }

    async transaction(operations, storeNames = null) {
        this.metrics.transactions++;
        
        if (!storeNames) {
            // Extract unique store names from operations
            storeNames = [...new Set(operations.map(op => op.store))];
        }

        return new Promise((resolve, reject) => {
            try {
                const transaction = this.db.transaction(storeNames, 'readwrite');
                const results = [];
                let opIndex = 0;

                const executeNextOperation = () => {
                    if (opIndex >= operations.length) {
                        return;
                    }

                    const operation = operations[opIndex];
                    const store = transaction.objectStore(operation.store);
                    
                    let request;
                    switch (operation.type) {
                        case 'add':
                            request = store.add(operation.data);
                            break;
                        case 'put':
                            request = store.put(operation.data);
                            break;
                        case 'delete':
                            request = store.delete(operation.key);
                            break;
                        case 'clear':
                            request = store.clear();
                            break;
                        default:
                            reject(new Error(`Invalid operation type: ${operation.type}`));
                            return;
                    }

                    request.onsuccess = (event) => {
                        results.push({
                            index: opIndex,
                            success: true,
                            result: event.target.result,
                            operation
                        });
                        opIndex++;
                        executeNextOperation();
                    };

                    request.onerror = (event) => {
                        results.push({
                            index: opIndex,
                            success: false,
                            error: event.target.error,
                            operation
                        });
                        opIndex++;
                        executeNextOperation();
                    };
                };

                transaction.oncomplete = () => {
                    resolve({
                        success: results.every(r => r.success),
                        results,
                        transactionId: Date.now()
                    });
                };

                transaction.onerror = (event) => {
                    reject(new Error(`Transaction failed: ${event.target.error}`));
                };

                executeNextOperation();
            } catch (error) {
                reject(error);
            }
        });
    }

    async migrate(newVersion, migrationScripts) {
        return new Promise((resolve, reject) => {
            this.db.close();
            
            const request = indexedDB.open(this.name, newVersion);
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                const oldVersion = event.oldVersion;
                
                try {
                    // Execute migration scripts
                    for (let v = oldVersion; v < newVersion; v++) {
                        const migration = migrationScripts[v];
                        if (migration) {
                            migration(db);
                        }
                    }
                    
                    this.eventBus?.emit('db:migrated', {
                        from: oldVersion,
                        to: newVersion,
                        timestamp: new Date().toISOString()
                    });
                } catch (error) {
                    reject(new Error(`Migration failed: ${error.message}`));
                }
            };
            
            request.onsuccess = (event) => {
                this.db = event.target.result;
                this.version = newVersion;
                resolve({
                    success: true,
                    oldVersion: this.version,
                    newVersion
                });
            };
            
            request.onerror = (event) => {
                reject(new Error(`Migration failed: ${event.target.error}`));
            };
        });
    }

    async backup(includeData = true) {
        const backup = {
            name: this.name,
            version: this.version,
            timestamp: new Date().toISOString(),
            schema: this.schema,
            data: {}
        };

        if (includeData) {
            // Backup all data from each store
            for (const storeName of Object.keys(this.schema)) {
                try {
                    const data = await this.query(storeName, { type: 'getAll' });
                    backup.data[storeName] = data;
                } catch (error) {
                    this.logger?.warn(`Failed to backup store ${storeName}:`, error);
                    backup.data[storeName] = [];
                }
            }
        }

        this.eventBus?.emit('db:backup', {
            name: this.name,
            timestamp: backup.timestamp,
            size: JSON.stringify(backup).length
        });

        return backup;
    }

    async restore(backupData) {
        // Validate backup structure
        if (!backupData || !backupData.name || !backupData.schema) {
            throw new Error('Invalid backup data');
        }

        // Clear existing data
        for (const storeName of Object.keys(this.schema)) {
            try {
                await this.transaction([{ type: 'clear', store: storeName }]);
            } catch (error) {
                this.logger?.warn(`Failed to clear store ${storeName}:`, error);
            }
        }

        // Restore data
        if (backupData.data) {
            const operations = [];
            for (const [storeName, items] of Object.entries(backupData.data)) {
                for (const item of items) {
                    operations.push({
                        type: 'add',
                        store: storeName,
                        data: item
                    });
                }
            }
            
            await this.transaction(operations);
        }

        return { success: true, restoredItems: Object.keys(backupData.data || {}).length };
    }

    async clearCache(category = null) {
        try {
            let queryOptions = { type: 'getAll', store: 'cache' };
            
            if (category) {
                queryOptions.index = 'category';
                queryOptions.range = category;
            }
            
            const cacheItems = await this.query('cache', queryOptions);
            const now = Date.now();
            
            const deleteOperations = [];
            for (const item of cacheItems) {
                if (!category || item.category === category) {
                    if (item.expiresAt && new Date(item.expiresAt).getTime() < now) {
                        deleteOperations.push({
                            type: 'delete',
                            store: 'cache',
                            key: item.key
                        });
                    }
                }
            }
            
            if (deleteOperations.length > 0) {
                await this.transaction(deleteOperations);
            }
            
            return { cleared: deleteOperations.length };
        } catch (error) {
            this.logger?.error('Cache clear failed:', error);
            return { cleared: 0, error: error.message };
        }
    }

    async getMetrics() {
        return {
            ...this.metrics,
            name: this.name,
            version: this.version,
            stores: Object.keys(this.schema),
            connectionCount: this.connections.size,
            isInitialized: !!this.db
        };
    }

    close() {
        if (this.db) {
            this.db.close();
            this.db = null;
            this.connections.clear();
            this.logger?.info('Database connection closed');
        }
    }

    destroy() {
        return new Promise((resolve, reject) => {
            this.close();
            
            const request = indexedDB.deleteDatabase(this.name);
            
            request.onsuccess = () => {
                this.logger?.info(`Database ${this.name} destroyed`);
                resolve(true);
            };
            
            request.onerror = (event) => {
                reject(new Error(`Failed to destroy database: ${event.target.error}`));
            };
        });
    }

    // ==================== PRIVATE METHODS ====================

    _bindMethods() {
        const methods = [
            'init', 'query', 'transaction', 'migrate', 
            'backup', 'restore', 'clearCache', 'getMetrics',
            'close', 'destroy'
        ];
        
        methods.forEach(method => {
            this[method] = this[method].bind(this);
        });
    }

    _openDatabase() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.name, this.version);
            
            request.onerror = (event) => {
                reject(new Error(`Failed to open database: ${event.target.error}`));
            };
            
            request.onsuccess = (event) => {
                const db = event.target.result;
                
                // Add error handler
                db.onerror = (event) => {
                    this.eventBus?.emit('db:error', { 
                        error: event.target.error,
                        context: 'database_operation'
                    });
                };
                
                resolve(db);
            };
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                this._createObjectStores(db, event.oldVersion);
            };
        });
    }

    _createObjectStores(db, oldVersion) {
        // Create object stores based on schema
        for (const [storeName, config] of Object.entries(this.schema)) {
            if (!db.objectStoreNames.contains(storeName)) {
                const store = db.createObjectStore(storeName, {
                    keyPath: config.keyPath,
                    autoIncrement: config.autoIncrement || false
                });
                
                // Create indexes
                config.indexes?.forEach(index => {
                    store.createIndex(index.name, index.keyPath, {
                        unique: index.unique || false
                    });
                });
            }
        }
    }

    _runMigrations() {
        // Placeholder for future migrations
        return Promise.resolve();
    }

    _createConnectionPool() {
        // Simple connection pool for future optimization
        this.connections.set('main', {
            db: this.db,
            status: 'active',
            lastUsed: Date.now()
        });
        
        return this.connections;
    }
}

// Export as singleton or class
if (typeof window !== 'undefined') {
    window.VakamovaDatabase = VakamovaDatabase;
}

export default VakamovaDatabase;
