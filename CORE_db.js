q// ==================== CORE DATABASE SYSTEM ====================
// HyperLang Pro - Professional Database Layer
// Version: 1.0.0 | ES6+ Module Pattern

class AppDatabase {
    constructor() {
        this.name = 'HyperLangDB';
        this.version = 3; // Version for schema migrations
        this.db = null;
        this.initialized = false;
        
        // Database schema definition
        this.schema = {
            users: {
                keyPath: 'id',
                autoIncrement: true,
                indexes: [
                    { name: 'email', keyPath: 'email', unique: true },
                    { name: 'username', keyPath: 'username', unique: false }
                ]
            },
            lessons: {
                keyPath: 'id',
                autoIncrement: true,
                indexes: [
                    { name: 'language', keyPath: 'language', unique: false },
                    { name: 'level', keyPath: 'level', unique: false },
                    { name: 'category', keyPath: 'category', unique: false }
                ]
            },
            progress: {
                keyPath: ['userId', 'lessonId'],
                indexes: [
                    { name: 'userId', keyPath: 'userId', unique: false },
                    { name: 'lessonId', keyPath: 'lessonId', unique: false },
                    { name: 'completedAt', keyPath: 'completedAt', unique: false }
                ]
            },
            settings: {
                keyPath: 'key',
                indexes: []
            }
        };
        
        console.log(`[Database] ${this.name} v${this.version} instance created`);
    }
    
    async init() {
        if (this.initialized) {
            console.warn('[Database] Already initialized');
            return this;
        }
        
        return new Promise((resolve, reject) => {
            try {
                const request = indexedDB.open(this.name, this.version);
                
                request.onerror = (event) => {
                    console.error('[Database] Error opening database:', event.target.error);
                    reject(new Error(`Failed to open database: ${event.target.error}`));
                };
                
                request.onsuccess = (event) => {
                    this.db = event.target.result;
                    this.initialized = true;
                    
                    // Attach error handler
                    this.db.onerror = (event) => {
                        console.error('[Database] Database error:', event.target.error);
                    };
                    
                    console.log('[Database] Successfully initialized');
                    resolve(this);
                };
                
                request.onupgradeneeded = (event) => {
                    const db = event.target.result;
                    console.log(`[Database] Upgrading to version ${event.newVersion}`);
                    
                    // Create object stores based on schema
                    for (const [storeName, config] of Object.entries(this.schema)) {
                        if (!db.objectStoreNames.contains(storeName)) {
                            const store = db.createObjectStore(storeName, {
                                keyPath: config.keyPath,
                                autoIncrement: config.autoIncrement || false
                            });
                            
                            // Create indexes
                            config.indexes.forEach(index => {
                                store.createIndex(index.name, index.keyPath, {
                                    unique: index.unique || false
                                });
                            });
                            
                            console.log(`[Database] Created object store: ${storeName}`);
                        }
                    }
                    
                    // Add initial data if needed
                    if (event.oldVersion < 1) {
                        this._seedInitialData(db);
                    }
                };
                
            } catch (error) {
                console.error('[Database] Critical initialization error:', error);
                reject(error);
            }
        });
    }
    
    _seedInitialData(db) {
        // Seed default settings
        const settingsStore = db.transaction(['settings'], 'readwrite').objectStore('settings');
        
        const defaultSettings = [
            { key: 'app_theme', value: 'dark', type: 'string' },
            { key: 'default_language', value: 'en', type: 'string' },
            { key: 'default_level', value: 'beginner', type: 'string' },
            { key: 'notifications_enabled', value: true, type: 'boolean' },
            { key: 'auto_save', value: true, type: 'boolean' },
            { key: 'last_sync', value: null, type: 'datetime' }
        ];
        
        defaultSettings.forEach(setting => {
            settingsStore.add(setting);
        });
        
        console.log('[Database] Seeded initial data');
    }
    
    // ==================== CRUD OPERATIONS ====================
    
    async add(storeName, data) {
        this._validateStore(storeName);
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            
            const request = store.add(data);
            
            request.onsuccess = (event) => {
                resolve(event.target.result);
            };
            
            request.onerror = (event) => {
                reject(new Error(`Failed to add to ${storeName}: ${event.target.error}`));
            };
        });
    }
    
    async get(storeName, key) {
        this._validateStore(storeName);
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            
            const request = store.get(key);
            
            request.onsuccess = (event) => {
                resolve(event.target.result);
            };
            
            request.onerror = (event) => {
                reject(new Error(`Failed to get from ${storeName}: ${event.target.error}`));
            };
        });
    }
    
    async getAll(storeName, indexName = null, query = null) {
        this._validateStore(storeName);
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readonly');
            let store = transaction.objectStore(storeName);
            
            if (indexName && store.indexNames.contains(indexName)) {
                store = store.index(indexName);
            }
            
            const request = query ? store.getAll(query) : store.getAll();
            
            request.onsuccess = (event) => {
                resolve(event.target.result);
            };
            
            request.onerror = (event) => {
                reject(new Error(`Failed to get all from ${storeName}: ${event.target.error}`));
            };
        });
    }
    
    async update(storeName, key, data) {
        this._validateStore(storeName);
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            
            // First get the existing record
            const getRequest = store.get(key);
            
            getRequest.onsuccess = (event) => {
                const existing = event.target.result;
                if (!existing) {
                    reject(new Error(`Record with key ${key} not found in ${storeName}`));
                    return;
                }
                
                // Merge existing data with updates
                const updated = { ...existing, ...data, updatedAt: new Date().toISOString() };
                
                // Update the record
                const updateRequest = store.put(updated);
                
                updateRequest.onsuccess = (event) => {
                    resolve(event.target.result);
                };
                
                updateRequest.onerror = (event) => {
                    reject(new Error(`Failed to update in ${storeName}: ${event.target.error}`));
                };
            };
            
            getRequest.onerror = (event) => {
                reject(new Error(`Failed to get record from ${storeName}: ${event.target.error}`));
            };
        });
    }
    
    async delete(storeName, key) {
        this._validateStore(storeName);
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            
            const request = store.delete(key);
            
            request.onsuccess = (event) => {
                resolve(true);
            };
            
            request.onerror = (event) => {
                reject(new Error(`Failed to delete from ${storeName}: ${event.target.error}`));
            };
        });
    }
    
    // ==================== SPECIFIC APP METHODS ====================
    
    async saveUserProgress(userId, lessonId, score, completed = true) {
        const progress = {
            userId,
            lessonId,
            score,
            completed,
            completedAt: new Date().toISOString(),
            attempts: 1
        };
        
        try {
            // Check if progress already exists
            const existing = await this.get('progress', [userId, lessonId]);
            if (existing) {
                progress.attempts = existing.attempts + 1;
                progress.bestScore = Math.max(existing.score || 0, score);
            }
            
            return await this.add('progress', progress);
        } catch (error) {
            console.error('[Database] Error saving progress:', error);
            throw error;
        }
    }
    
    async getUserProgress(userId, language = null) {
        try {
            const allProgress = await this.getAll('progress', 'userId', userId);
            
            if (language) {
                // Filter by language if specified
                // This would require joining with lessons table
                return allProgress.filter(p => p.language === language);
            }
            
            return allProgress;
        } catch (error) {
            console.error('[Database] Error getting user progress:', error);
            return [];
        }
    }
    
    async getLessonsByLanguage(language, level = null) {
        try {
            let lessons = await this.getAll('lessons', 'language', language);
            
            if (level) {
                lessons = lessons.filter(lesson => lesson.level === level);
            }
            
            return lessons.sort((a, b) => a.order - b.order);
        } catch (error) {
            console.error('[Database] Error getting lessons:', error);
            return [];
        }
    }
    
    async getAppSetting(key) {
        try {
            const setting = await this.get('settings', key);
            return setting ? setting.value : null;
        } catch (error) {
            console.warn(`[Database] Setting ${key} not found, returning null`);
            return null;
        }
    }
    
    async setAppSetting(key, value, type = 'string') {
        try {
            const setting = {
                key,
                value,
                type,
                updatedAt: new Date().toISOString()
            };
            
            // Check if setting exists
            const existing = await this.get('settings', key);
            if (existing) {
                return await this.update('settings', key, setting);
            } else {
                return await this.add('settings', setting);
            }
        } catch (error) {
            console.error(`[Database] Error setting ${key}:`, error);
            throw error;
        }
    }
    
    // ==================== UTILITY METHODS ====================
    
    _validateStore(storeName) {
        if (!this.initialized) {
            throw new Error('Database not initialized. Call init() first.');
        }
        
        if (!this.db.objectStoreNames.contains(storeName)) {
            throw new Error(`Object store "${storeName}" does not exist`);
        }
    }
    
    async clearStore(storeName) {
        this._validateStore(storeName);
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            
            const request = store.clear();
            
            request.onsuccess = (event) => {
                console.log(`[Database] Cleared store: ${storeName}`);
                resolve(true);
            };
            
            request.onerror = (event) => {
                reject(new Error(`Failed to clear ${storeName}: ${event.target.error}`));
            };
        });
    }
    
    async exportData() {
        const exportData = {};
        
        for (const storeName of this.db.objectStoreNames) {
            try {
                exportData[storeName] = await this.getAll(storeName);
            } catch (error) {
                console.error(`[Database] Error exporting ${storeName}:`, error);
                exportData[storeName] = [];
            }
        }
        
        return exportData;
    }
    
    async importData(data) {
        // Validate data structure
        for (const storeName in data) {
            if (!this.db.objectStoreNames.contains(storeName)) {
                throw new Error(`Cannot import data for non-existent store: ${storeName}`);
            }
        }
        
        // Import data for each store
        for (const [storeName, items] of Object.entries(data)) {
            try {
                // Clear existing data
                await this.clearStore(storeName);
                
                // Add new data
                for (const item of items) {
                    await this.add(storeName, item);
                }
                
                console.log(`[Database] Imported ${items.length} items to ${storeName}`);
            } catch (error) {
                console.error(`[Database] Error importing to ${storeName}:`, error);
                throw error;
            }
        }
        
        return true;
    }
    
    async backup() {
        try {
            const data = await this.exportData();
            const backup = {
                timestamp: new Date().toISOString(),
                version: this.version,
                data
            };
            
            // Store backup in localStorage as fallback
            localStorage.setItem(`backup_${this.name}`, JSON.stringify(backup));
            
            console.log('[Database] Backup created and saved to localStorage');
            return backup;
        } catch (error) {
            console.error('[Database] Backup failed:', error);
            throw error;
        }
    }
    
    async restoreFromBackup() {
        try {
            const backupStr = localStorage.getItem(`backup_${this.name}`);
            if (!backupStr) {
                throw new Error('No backup found in localStorage');
            }
            
            const backup = JSON.parse(backupStr);
            
            // Validate backup version
            if (backup.version > this.version) {
                console.warn(`[Database] Backup version (${backup.version}) is higher than current (${this.version})`);
            }
            
            await this.importData(backup.data);
            console.log('[Database] Restored from backup');
            return true;
        } catch (error) {
            console.error('[Database] Restore failed:', error);
            throw error;
        }
    }
    
    async close() {
        if (this.db) {
            this.db.close();
            this.initialized = false;
            console.log('[Database] Database connection closed');
        }
    }
    
    async destroy() {
        await this.close();
        
        return new Promise((resolve, reject) => {
            const request = indexedDB.deleteDatabase(this.name);
            
            request.onsuccess = () => {
                console.log('[Database] Database deleted successfully');
                resolve(true);
            };
            
            request.onerror = (event) => {
                reject(new Error(`Failed to delete database: ${event.target.error}`));
            };
            
            request.onblocked = () => {
                console.warn('[Database] Database deletion blocked - close all connections');
                reject(new Error('Database is blocked by other connections'));
            };
        });
    }
}

// ==================== DATABASE INITIALIZATION FUNCTION ====================
async function initDatabase() {
    try {
        console.log('[Database] Starting database initialization...');
        
        const database = new AppDatabase();
        await database.init();
        
        // Set default user if none exists
        const users = await database.getAll('users');
        if (users.length === 0) {
            const defaultUser = {
                id: 'guest_' + Date.now(),
                username: 'Guest',
                email: null,
                createdAt: new Date().toISOString(),
                settings: {
                    theme: 'dark',
                    language: 'en',
                    notifications: true
                },
                isGuest: true
            };
            
            await database.add('users', defaultUser);
            console.log('[Database] Created default guest user');
        }
        
        console.log('[Database] Initialization complete');
        return database;
        
    } catch (error) {
        console.error('[Database] Initialization failed:', error);
        
        // Fallback: Create a simple mock database
        console.warn('[Database] Using fallback mock database');
        return createMockDatabase();
    }
}

// ==================== MOCK DATABASE (FALLBACK) ====================
function createMockDatabase() {
    console.warn('[Database] Creating mock database (IndexedDB not available)');
    
    return {
        name: 'MockDB',
        initialized: true,
        
        // Mock implementations of main methods
        async get(storeName, key) {
            console.log(`[MockDB] get from ${storeName}:`, key);
            return null;
        },
        
        async getAll(storeName) {
            console.log(`[MockDB] getAll from ${storeName}`);
            return [];
        },
        
        async add(storeName, data) {
            console.log(`[MockDB] add to ${storeName}:`, data);
            return data.id || Date.now();
        },
        
        async update(storeName, key, data) {
            console.log(`[MockDB] update in ${storeName}:`, key, data);
            return key;
        },
        
        async delete(storeName, key) {
            console.log(`[MockDB] delete from ${storeName}:`, key);
            return true;
        },
        
        async saveUserProgress(userId, lessonId, score) {
            console.log(`[MockDB] Saving progress: user=${userId}, lesson=${lessonId}, score=${score}`);
            return { userId, lessonId, score, saved: true };
        },
        
        async getUserProgress(userId) {
            console.log(`[MockDB] Getting progress for user:`, userId);
            return [];
        },
        
        async getAppSetting(key) {
            const defaults = {
                'app_theme': 'dark',
                'default_language': 'en',
                'notifications_enabled': true
            };
            return defaults[key] || null;
        },
        
        async setAppSetting(key, value) {
            console.log(`[MockDB] Setting ${key} =`, value);
            return true;
        },
        
        async close() {
            console.log('[MockDB] Closed');
        }
    };
}

// ==================== EXPORT FOR GLOBAL USE ====================
// For non-module environment (global scope)
if (typeof window !== 'undefined') {
    window.AppDatabase = AppDatabase;
    window.initDatabase = initDatabase;
}

console.log('[Database] CORE_db.js loaded successfully');
