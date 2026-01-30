/**
 * HyperLang - State Persistence System
 * Version: 1.0.0
 * Principles: Dependency Injection + Event-Driven + Centralized Config
 */

import { CONFIG } from './config.js';
import { context } from './context-provider.js';
import { eventBus } from './event-bus.js';

export class StatePersistence {
    constructor(options = {}) {
        // Dependency Injection
        this.config = context.get('config');
        this.logger = context.get('logger');
        this.eventBus = context.get('eventBus') || eventBus;
        
        // Configuration
        this.options = {
            storageKey: options.storageKey || 'hyperlang_state',
            backupKey: options.backupKey || 'hyperlang_state_backup',
            encryptionKey: options.encryptionKey || null,
            compress: options.compress ?? true,
            autoSave: options.autoSave ?? true,
            autoSaveInterval: options.autoSaveInterval || 30000, // 30 seconds
            maxSizeMB: options.maxSizeMB || 5,
            validateOnSave: options.validateOnSave ?? true,
            versioning: options.versioning ?? true,
            ...options
        };
        
        // State
        this.isSaving = false;
        this.lastSave = null;
        this.saveQueue = [];
        this.storageInfo = {
            totalSaves: 0,
            totalLoads: 0,
            lastError: null,
            storageUsed: 0
        };
        
        // Setup
        this.setupAutoSave();
        this.checkStorageAvailability();
        
        // Register with context
        context.register('statePersistence', {
            factory: () => this,
            dependencies: ['config', 'logger', 'eventBus'],
            lifecycle: 'singleton'
        });
        
        this.logger?.log('StatePersistence initialized');
    }
    
    // ==================== CORE PERSISTENCE METHODS ====================
    
    async save(state, metadata = {}) {
        if (this.isSaving) {
            // Queue the save if already saving
            return new Promise((resolve, reject) => {
                this.saveQueue.push({ state, metadata, resolve, reject });
            });
        }
        
        this.isSaving = true;
        
        try {
            const startTime = Date.now();
            
            // Prepare data for storage
            const storageData = this.prepareForStorage(state, metadata);
            
            // Validate before saving
            if (this.options.validateOnSave) {
                this.validateState(storageData.state);
            }
            
            // Save to primary storage
            await this.saveToStorage(this.options.storageKey, storageData);
            
            // Create backup
            await this.createBackup(storageData);
            
            // Update stats
            const saveTime = Date.now() - startTime;
            this.lastSave = Date.now();
            this.storageInfo.totalSaves++;
            this.storageInfo.lastSaveTime = saveTime;
            this.storageInfo.storageUsed = this.calculateStorageSize(storageData);
            
            // Emit event
            this.eventBus.emit('state:persisted', {
                key: this.options.storageKey,
                size: this.storageInfo.storageUsed,
                saveTime,
                timestamp: Date.now(),
                metadata
            });
            
            this.logger?.log(`State saved (${saveTime}ms, ${this.storageInfo.storageUsed} bytes)`);
            
            return {
                success: true,
                saveTime,
                size: this.storageInfo.storageUsed,
                timestamp: this.lastSave
            };
            
        } catch (error) {
            this.storageInfo.lastError = {
                message: error.message,
                timestamp: Date.now()
            };
            
            this.eventBus.emit('state:persist_error', {
                error: error.message,
                timestamp: Date.now()
            });
            
            this.logger?.error('State save failed:', error);
            
            throw error;
            
        } finally {
            this.isSaving = false;
            
            // Process queued saves
            if (this.saveQueue.length > 0) {
                const next = this.saveQueue.shift();
                setTimeout(() => {
                    this.save(next.state, next.metadata)
                        .then(next.resolve)
                        .catch(next.reject);
                }, 100);
            }
        }
    }
    
    async load() {
        try {
            const startTime = Date.now();
            
            // Try primary storage first
            let data = await this.loadFromStorage(this.options.storageKey);
            
            // If primary fails, try backup
            if (!data) {
                this.logger?.warn('Primary storage empty, trying backup...');
                data = await this.loadFromStorage(this.options.backupKey);
                
                if (data) {
                    // Restore backup to primary
                    await this.saveToStorage(this.options.storageKey, data);
                    this.eventBus.emit('state:restored_from_backup', {
                        timestamp: Date.now()
                    });
                }
            }
            
            if (!data) {
                this.logger?.warn('No persisted state found');
                return null;
            }
            
            // Validate loaded data
            if (this.options.validateOnSave) {
                this.validateState(data.state);
            }
            
            // Restore from storage format
            const restoredState = this.restoreFromStorage(data);
            
            // Update stats
            const loadTime = Date.now() - startTime;
            this.storageInfo.totalLoads++;
            this.storageInfo.lastLoadTime = loadTime;
            
            // Emit event
            this.eventBus.emit('state:loaded', {
                key: this.options.storageKey,
                loadTime,
                timestamp: Date.now(),
                version: data.version
            });
            
            this.logger?.log(`State loaded (${loadTime}ms, version: ${data.version})`);
            
            return restoredState;
            
        } catch (error) {
            this.storageInfo.lastError = {
                message: error.message,
                timestamp: Date.now()
            };
            
            this.eventBus.emit('state:load_error', {
                error: error.message,
                timestamp: Date.now()
            });
            
            this.logger?.error('State load failed:', error);
            
            // Try to recover from backup
            return await this.attemptRecovery();
        }
    }
    
    // ==================== STORAGE OPERATIONS ====================
    
    async saveToStorage(key, data) {
        let storageData = data;
        
        // Apply compression if enabled
        if (this.options.compress) {
            storageData = this.compressData(data);
        }
        
        // Apply encryption if key provided
        if (this.options.encryptionKey) {
            storageData = this.encryptData(storageData, this.options.encryptionKey);
        }
        
        // Save to localStorage
        localStorage.setItem(key, JSON.stringify(storageData));
        
        // Also save to IndexedDB if available
        await this.saveToIndexedDB(key, storageData);
        
        return true;
    }
    
    async loadFromStorage(key) {
        let storageData = null;
        
        // Try localStorage first
        try {
            const stored = localStorage.getItem(key);
            if (stored) {
                storageData = JSON.parse(stored);
            }
        } catch (error) {
            this.logger?.warn(`Failed to load from localStorage (${key}):`, error);
        }
        
        // If not in localStorage, try IndexedDB
        if (!storageData) {
            storageData = await this.loadFromIndexedDB(key);
        }
        
        if (!storageData) {
            return null;
        }
        
        // Decrypt if needed
        if (this.options.encryptionKey) {
            storageData = this.decryptData(storageData, this.options.encryptionKey);
        }
        
        // Decompress if needed
        if (this.options.compress && storageData.compressed) {
            storageData = this.decompressData(storageData);
        }
        
        return storageData;
    }
    
    async createBackup(data) {
        try {
            await this.saveToStorage(this.options.backupKey, data);
            
            // Limit backup size
            await this.cleanupOldBackups();
            
            return true;
        } catch (error) {
            this.logger?.warn('Backup creation failed:', error);
            return false;
        }
    }
    
    // ==================== DATA PREPARATION AND RESTORATION ====================
    
    prepareForStorage(state, metadata = {}) {
        const now = Date.now();
        
        const storageData = {
            state: this.deepClone(state),
            metadata: {
                ...metadata,
                savedAt: now,
                version: '1.0.0',
                checksum: this.generateChecksum(state)
            },
            version: '1.0.0',
            timestamp: now
        };
        
        // Add versioning info
        if (this.options.versioning) {
            storageData.versionInfo = {
                appVersion: CONFIG.APP.VERSION,
                schemaVersion: '1.0',
                migrationVersion: 0
            };
        }
        
        return storageData;
    }
    
    restoreFromStorage(storageData) {
        if (!storageData || !storageData.state) {
            throw new Error('Invalid storage data');
        }
        
        // Validate checksum
        if (storageData.metadata?.checksum) {
            const currentChecksum = this.generateChecksum(storageData.state);
            if (currentChecksum !== storageData.metadata.checksum) {
                throw new Error('Data integrity check failed');
            }
        }
        
        // Apply migrations if needed
        if (this.options.versioning && storageData.versionInfo) {
            // Check if migration is needed
            const needsMigration = this.checkMigrationNeeded(storageData.versionInfo);
            if (needsMigration) {
                // Apply migrations
                storageData.state = this.applyMigrations(storageData.state, storageData.versionInfo);
            }
        }
        
        return storageData.state;
    }
    
    // ==================== COMPRESSION AND ENCRYPTION ====================
    
    compressData(data) {
        // Simple compression - convert to string and use basic compression
        const jsonString = JSON.stringify(data);
        
        // For small data, don't compress
        if (jsonString.length < 1000) {
            return data;
        }
        
        // Simple compression using base64
        try {
            const compressed = btoa(unescape(encodeURIComponent(jsonString)));
            
            return {
                compressed: true,
                data: compressed,
                originalSize: jsonString.length,
                compressedSize: compressed.length,
                compressionRatio: (compressed.length / jsonString.length).toFixed(2)
            };
        } catch (error) {
            this.logger?.warn('Compression failed, storing uncompressed:', error);
            return data;
        }
    }
    
    decompressData(compressedData) {
        if (!compressedData.compressed) {
            return compressedData;
        }
        
        try {
            const jsonString = decodeURIComponent(escape(atob(compressedData.data)));
            return JSON.parse(jsonString);
        } catch (error) {
            throw new Error('Decompression failed: ' + error.message);
        }
    }
    
    encryptData(data, key) {
        // Simple encryption for demo purposes
        // In production, use Web Crypto API
        try {
            const jsonString = JSON.stringify(data);
            const encrypted = btoa(unescape(encodeURIComponent(jsonString + '|' + key)));
            
            return {
                encrypted: true,
                data: encrypted,
                algorithm: 'simple_base64',
                timestamp: Date.now()
            };
        } catch (error) {
            this.logger?.warn('Encryption failed, storing unencrypted:', error);
            return data;
        }
    }
    
    decryptData(encryptedData, key) {
        if (!encryptedData.encrypted) {
            return encryptedData;
        }
        
        try {
            const decrypted = decodeURIComponent(escape(atob(encryptedData.data)));
            const parts = decrypted.split('|');
            
            if (parts[1] !== key) {
                throw new Error('Decryption key mismatch');
            }
            
            return JSON.parse(parts[0]);
        } catch (error) {
            throw new Error('Decryption failed: ' + error.message);
        }
    }
    
    // ==================== VALIDATION ====================
    
    validateState(state) {
        // Basic validation
        if (!state || typeof state !== 'object') {
            throw new Error('State must be an object');
        }
        
        // Check for circular references
        this.checkCircularReferences(state);
        
        // Check size limits
        const size = this.calculateStorageSize(state);
        const maxSize = this.options.maxSizeMB * 1024 * 1024;
        
        if (size > maxSize) {
            throw new Error(`State size (${(size / 1024 / 1024).toFixed(2)}MB) exceeds limit (${this.options.maxSizeMB}MB)`);
        }
        
        return true;
    }
    
    checkCircularReferences(obj, seen = new Set()) {
        if (obj && typeof obj === 'object') {
            if (seen.has(obj)) {
                throw new Error('Circular reference detected in state');
            }
            
            seen.add(obj);
            
            for (const key in obj) {
                if (obj.hasOwnProperty(key)) {
                    this.checkCircularReferences(obj[key], new Set(seen));
                }
            }
        }
    }
    
    // ==================== MIGRATION SUPPORT ====================
    
    checkMigrationNeeded(versionInfo) {
        // Check if stored version matches current version
        const currentVersion = {
            appVersion: CONFIG.APP.VERSION,
            schemaVersion: '1.0',
            migrationVersion: 0
        };
        
        return (
            versionInfo.appVersion !== currentVersion.appVersion ||
            versionInfo.schemaVersion !== currentVersion.schemaVersion ||
            versionInfo.migrationVersion < currentVersion.migrationVersion
        );
    }
    
    applyMigrations(state, versionInfo) {
        // Apply version-specific migrations
        let migratedState = { ...state };
        
        // Example migration
        if (versionInfo.migrationVersion < 1) {
            // Migration from version 0 to 1
            if (!migratedState.metadata) {
                migratedState.metadata = {
                    migratedFrom: versionInfo.migrationVersion,
                    migratedAt: Date.now()
                };
            }
        }
        
        return migratedState;
    }
    
    // ==================== STORAGE MANAGEMENT ====================
    
    async cleanupOldBackups() {
        try {
            // Get all backup keys
            const backups = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key.startsWith('hyperlang_backup_')) {
                    const item = localStorage.getItem(key);
                    if (item) {
                        try {
                            const data = JSON.parse(item);
                            backups.push({
                                key,
                                timestamp: data.timestamp || 0,
                                size: item.length
                            });
                        } catch (e) {
                            // Invalid JSON, remove it
                            localStorage.removeItem(key);
                        }
                    }
                }
            }
            
            // Sort by timestamp (oldest first)
            backups.sort((a, b) => a.timestamp - b.timestamp);
            
            // Keep only 5 most recent backups
            const toRemove = backups.slice(0, Math.max(0, backups.length - 5));
            
            toRemove.forEach(backup => {
                localStorage.removeItem(backup.key);
                this.logger?.log(`Removed old backup: ${backup.key}`);
            });
            
            return toRemove.length;
        } catch (error) {
            this.logger?.warn('Backup cleanup failed:', error);
            return 0;
        }
    }
    
    calculateStorageSize(data) {
        return JSON.stringify(data).length;
    }
    
    getStorageInfo() {
        let totalUsed = 0;
        
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key.startsWith('hyperlang_')) {
                totalUsed += localStorage.getItem(key).length;
            }
        }
        
        return {
            totalUsed,
            items: localStorage.length,
            quota: 5 * 1024 * 1024, // 5MB typical limit
            percentUsed: (totalUsed / (5 * 1024 * 1024)) * 100
        };
    }
    
    checkStorageAvailability() {
        try {
            // Test write/read
            const testKey = 'hyperlang_storage_test';
            const testData = { test: true, timestamp: Date.now() };
            
            localStorage.setItem(testKey, JSON.stringify(testData));
            const retrieved = JSON.parse(localStorage.getItem(testKey));
            localStorage.removeItem(testKey);
            
            if (!retrieved || retrieved.test !== true) {
                throw new Error('Storage test failed');
            }
            
            return {
                available: true,
                type: 'localStorage',
                timestamp: Date.now()
            };
        } catch (error) {
            this.logger?.error('Storage not available:', error);
            
            return {
                available: false,
                error: error.message,
                timestamp: Date.now()
            };
        }
    }
    
    // ==================== RECOVERY AND FALLBACK ====================
    
    async attemptRecovery() {
        this.logger?.warn('Attempting state recovery...');
        
        try {
            // Try to load from any backup
            const allKeys = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key.includes('hyperlang') && key.includes('backup')) {
                    allKeys.push(key);
                }
            }
            
            // Sort by likely recency
            allKeys.sort().reverse();
            
            for (const key of allKeys) {
                try {
                    const data = await this.loadFromStorage(key);
                    if (data) {
                        this.logger?.log(`Recovered state from: ${key}`);
                        
                        // Save recovered state as primary
                        await this.saveToStorage(this.options.storageKey, data);
                        
                        this.eventBus.emit('state:recovered', {
                            source: key,
                            timestamp: Date.now()
                        });
                        
                        return this.restoreFromStorage(data);
                    }
                } catch (error) {
                    // Try next backup
                    continue;
                }
            }
            
            throw new Error('No valid backups found');
        } catch (error) {
            this.logger?.error('Recovery failed:', error);
            
            this.eventBus.emit('state:recovery_failed', {
                error: error.message,
                timestamp: Date.now()
            });
            
            return null;
        }
    }
    
    // ==================== INDEXEDDB SUPPORT ====================
    
    async saveToIndexedDB(key, data) {
        // Implement IndexedDB storage for larger data
        // This is a simplified version
        return Promise.resolve(true);
    }
    
    async loadFromIndexedDB(key) {
        // Implement IndexedDB loading
        return Promise.resolve(null);
    }
    
    // ==================== UTILITY METHODS ====================
    
    deepClone(obj) {
        if (obj === null || typeof obj !== 'object') return obj;
        if (obj instanceof Date) return new Date(obj);
        if (Array.isArray(obj)) return obj.map(item => this.deepClone(item));
        
        const cloned = {};
        for (const key in obj) {
            if (obj.hasOwnProperty(key)) {
                cloned[key] = this.deepClone(obj[key]);
            }
        }
        return cloned;
    }
    
    generateChecksum(state) {
        const str = JSON.stringify(state);
        let hash = 0;
        
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        
        return hash.toString(16);
    }
    
    // ==================== AUTO SAVE ====================
    
    setupAutoSave() {
        if (!this.options.autoSave) return;
        
        // Save on page unload
        window.addEventListener('beforeunload', () => {
            this.eventBus.emit('state:auto_save_requested', {
                timestamp: Date.now()
            });
        });
        
        // Listen for state changes to auto-save
        this.eventBus.on('state:changed', (event) => {
            if (this.options.autoSave && !this.isSaving) {
                this.debouncedAutoSave(event.data.newState);
            }
        });
    }
    
    debouncedAutoSave(state) {
        if (this.autoSaveTimeout) {
            clearTimeout(this.autoSaveTimeout);
        }
        
        this.autoSaveTimeout = setTimeout(() => {
            this.save(state, { source: 'auto_save' }).catch(error => {
                this.logger?.warn('Auto-save failed:', error);
            });
        }, this.options.autoSaveInterval);
    }
    
    // ==================== LIFECYCLE ====================
    
    destroy() {
        if (this.autoSaveTimeout) {
            clearTimeout(this.autoSaveTimeout);
        }
        
        // Clear any pending saves
        this.saveQueue = [];
        
        this.logger?.log('StatePersistence destroyed');
    }
}

// Singleton instance
export const statePersistence = new StatePersistence();

// Register with context
context.registerSingleton('statePersistence', statePersistence);

// Export for global use
if (typeof window !== 'undefined') {
    window.statePersistence = statePersistence;
}

export default statePersistence;
