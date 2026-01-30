/**
 * HyperLang - State Backup System
 * Version: 1.0.0
 * Principles: Dependency Injection + Event-Driven + Interface Contract
 */

import { CONFIG } from './core_config.js';
import { context } from './core_context_provider.js';
import { eventBus } from './core_event_bus.js';

// Backup Contract Interface
export const BACKUP_CONTRACT = {
    backup: {
        id: 'string',
        name: 'string',
        timestamp: 'number',
        size: 'number',
        checksum: 'string',
        metadata: 'object?',
        data: 'object'
    },
    restore: {
        id: 'string',
        backupId: 'string',
        timestamp: 'number',
        status: 'string',
        errors: 'array?'
    },
    schedule: {
        enabled: 'boolean',
        interval: 'number',
        lastRun: 'number?',
        nextRun: 'number?'
    }
};

export class StateBackup {
    constructor(options = {}) {
        // Dependency Injection
        this.config = context.get('config');
        this.logger = context.get('logger');
        this.eventBus = context.get('eventBus') || eventBus;
        this.stateManager = context.get('stateManager');
        this.statePersistence = context.get('statePersistence');
        
        // Configuration
        this.options = {
            backupKey: options.backupKey || 'hyperlang_backups',
            maxBackups: options.maxBackups || 10,
            maxBackupSize: options.maxBackupSize || 5242880, // 5MB
            autoBackup: options.autoBackup ?? true,
            autoBackupInterval: options.autoBackupInterval || 3600000, // 1 hour
            compressBackups: options.compressBackups ?? true,
            encryptBackups: options.encryptBackups ?? true,
            encryptionKey: options.encryptionKey || 'hyperlang_backup_key',
            validateBackups: options.validateBackups ?? true,
            ...options
        };
        
        // Backup State
        this.backups = new Map();
        this.restoreHistory = [];
        this.schedule = {
            enabled: this.options.autoBackup,
            interval: this.options.autoBackupInterval,
            lastRun: null,
            nextRun: null
        };
        
        // Load existing backups
        this.loadBackups();
        
        // Setup auto-backup
        if (this.options.autoBackup) {
            this.setupAutoBackup();
        }
        
        // Register with context
        context.register('stateBackup', {
            factory: () => this,
            dependencies: ['config', 'logger', 'eventBus', 'stateManager', 'statePersistence'],
            lifecycle: 'singleton'
        });
        
        this.logger?.log('StateBackup initialized');
    }
    
    // ==================== BACKUP CREATION ====================
    
    async createBackup(name = 'manual', metadata = {}) {
        const startTime = Date.now();
        
        try {
            // Get current state
            const state = this.stateManager?.getState() || {};
            
            // Create backup object
            const backup = {
                id: this.generateBackupId(),
                name,
                timestamp: startTime,
                size: 0,
                checksum: this.generateChecksum(state),
                metadata: {
                    ...metadata,
                    source: 'state_backup',
                    version: CONFIG.APP.VERSION,
                    createdBy: 'StateBackup'
                },
                data: this.prepareBackupData(state)
            };
            
            // Calculate size
            backup.size = JSON.stringify(backup).length;
            
            // Validate size limit
            if (backup.size > this.options.maxBackupSize) {
                throw new Error(`Backup size ${backup.size} bytes exceeds limit ${this.options.maxBackupSize}`);
            }
            
            // Compress if enabled
            if (this.options.compressBackups) {
                backup.data = this.compressData(backup.data);
                backup.compressed = true;
                backup.compressionRatio = backup.size / JSON.stringify(backup.data).length;
            }
            
            // Encrypt if enabled
            if (this.options.encryptBackups) {
                backup.data = this.encryptData(backup.data, this.options.encryptionKey);
                backup.encrypted = true;
            }
            
            // Store backup
            await this.storeBackup(backup);
            
            // Manage backup count
            await this.cleanupOldBackups();
            
            const duration = Date.now() - startTime;
            
            // Emit event
            this.eventBus.emit('backup:created', {
                backupId: backup.id,
                name,
                size: backup.size,
                duration,
                timestamp: startTime
            });
            
            this.logger?.log(`Backup created: ${backup.id} (${backup.size} bytes, ${duration}ms)`);
            
            return {
                success: true,
                backup: this.sanitizeBackup(backup),
                duration
            };
            
        } catch (error) {
            this.logger?.error('Backup creation failed:', error);
            
            this.eventBus.emit('backup:creation_failed', {
                name,
                error: error.message,
                timestamp: startTime
            });
            
            throw error;
        }
    }
    
    async createIncrementalBackup(name = 'incremental', metadata = {}) {
        const startTime = Date.now();
        
        try {
            // Get latest backup for comparison
            const latestBackup = this.getLatestBackup();
            const currentState = this.stateManager?.getState() || {};
            
            let backupData;
            if (latestBackup) {
                // Create incremental backup
                const previousState = await this.restoreBackup(latestBackup.id, { loadOnly: true });
                const diff = this.calculateStateDiff(previousState, currentState);
                
                backupData = {
                    type: 'incremental',
                    baseBackupId: latestBackup.id,
                    timestamp: startTime,
                    changes: diff,
                    fullState: currentState // Include full state for safety
                };
                
                metadata.incremental = true;
                metadata.baseBackup = latestBackup.id;
            } else {
                // First backup is always full
                backupData = {
                    type: 'full',
                    data: currentState
                };
            }
            
            // Create backup with incremental data
            return await this.createBackup(name, {
                ...metadata,
                backupType: backupData.type
            });
            
        } catch (error) {
            this.logger?.error('Incremental backup failed:', error);
            
            // Fallback to full backup
            this.logger?.warn('Falling back to full backup');
            return await this.createBackup(`${name}_fallback`, metadata);
        }
    }
    
    // ==================== BACKUP STORAGE ====================
    
    async storeBackup(backup) {
        // Store in memory
        this.backups.set(backup.id, backup);
        
        // Store in localStorage
        await this.persistBackups();
        
        // Also store in IndexedDB if available
        await this.storeInIndexedDB(backup);
        
        return true;
    }
    
    async persistBackups() {
        try {
            // Convert Map to array and sanitize
            const backupArray = Array.from(this.backups.values())
                .map(backup => this.sanitizeBackup(backup));
            
            const storageData = {
                backups: backupArray,
                lastUpdated: Date.now(),
                version: '1.0.0'
            };
            
            localStorage.setItem(this.options.backupKey, JSON.stringify(storageData));
            
            return true;
        } catch (error) {
            this.logger?.error('Failed to persist backups:', error);
            
            // Try to save with reduced size
            return await this.persistBackupsWithReduction();
        }
    }
    
    async persistBackupsWithReduction() {
        try {
            // Keep only last 5 backups
            const backupArray = Array.from(this.backups.values())
                .sort((a, b) => b.timestamp - a.timestamp)
                .slice(0, 5)
                .map(backup => this.sanitizeBackup(backup));
            
            const storageData = {
                backups: backupArray,
                lastUpdated: Date.now(),
                version: '1.0.0',
                reduced: true
            };
            
            localStorage.setItem(this.options.backupKey, JSON.stringify(storageData));
            
            this.logger?.warn('Backups reduced to 5 due to storage constraints');
            
            return true;
        } catch (error) {
            this.logger?.error('Failed to persist reduced backups:', error);
            return false;
        }
    }
    
    async loadBackups() {
        try {
            const stored = localStorage.getItem(this.options.backupKey);
            if (!stored) return false;
            
            const data = JSON.parse(stored);
            if (data.version !== '1.0.0') {
                this.logger?.warn('Backup version mismatch, clearing old backups');
                localStorage.removeItem(this.options.backupKey);
                return false;
            }
            
            // Restore backups to Map
            this.backups.clear();
            data.backups.forEach(backup => {
                this.backups.set(backup.id, backup);
            });
            
            this.logger?.log(`Loaded ${this.backups.size} backups`);
            
            return true;
        } catch (error) {
            this.logger?.error('Failed to load backups:', error);
            return false;
        }
    }
    
    // ==================== BACKUP RETRIEVAL ====================
    
    getBackup(backupId) {
        const backup = this.backups.get(backupId);
        if (!backup) return null;
        
        return this.sanitizeBackup(backup);
    }
    
    getAllBackups(sortBy = 'timestamp', order = 'desc') {
        const backups = Array.from(this.backups.values())
            .map(backup => this.sanitizeBackup(backup));
        
        // Sort backups
        backups.sort((a, b) => {
            let aValue, bValue;
            
            switch (sortBy) {
                case 'timestamp':
                    aValue = a.timestamp;
                    bValue = b.timestamp;
                    break;
                case 'size':
                    aValue = a.size;
                    bValue = b.size;
                    break;
                case 'name':
                    aValue = a.name.toLowerCase();
                    bValue = b.name.toLowerCase();
                    break;
                default:
                    aValue = a.timestamp;
                    bValue = b.timestamp;
            }
            
            if (order === 'desc') {
                return bValue - aValue;
            } else {
                return aValue - bValue;
            }
        });
        
        return backups;
    }
    
    getLatestBackup() {
        const backups = this.getAllBackups('timestamp', 'desc');
        return backups[0] || null;
    }
    
    getBackupStats() {
        const backups = Array.from(this.backups.values());
        
        if (backups.length === 0) {
            return {
                total: 0,
                totalSize: 0,
                averageSize: 0,
                oldest: null,
                newest: null
            };
        }
        
        const sizes = backups.map(b => b.size);
        const totalSize = sizes.reduce((a, b) => a + b, 0);
        const timestamps = backups.map(b => b.timestamp);
        
        return {
            total: backups.length,
            totalSize,
            averageSize: Math.round(totalSize / backups.length),
            oldest: new Date(Math.min(...timestamps)),
            newest: new Date(Math.max(...timestamps)),
            largest: Math.max(...sizes),
            smallest: Math.min(...sizes)
        };
    }
    
    // ==================== BACKUP RESTORATION ====================
    
    async restoreBackup(backupId, options = {}) {
        const startTime = Date.now();
        
        try {
            // Get backup
            const backup = this.backups.get(backupId);
            if (!backup) {
                throw new Error(`Backup ${backupId} not found`);
            }
            
            // If loadOnly flag is set, just return the data without applying
            if (options.loadOnly) {
                return await this.extractBackupData(backup);
            }
            
            this.eventBus.emit('backup:restore_started', {
                backupId,
                timestamp: startTime,
                options
            });
            
            // Extract backup data
            const backupData = await this.extractBackupData(backup);
            
            // Validate backup data
            if (this.options.validateBackups) {
                await this.validateBackupData(backup, backupData);
            }
            
            // Apply backup to state
            await this.applyBackup(backupData, options);
            
            const duration = Date.now() - startTime;
            
            // Record restore history
            const restoreRecord = {
                id: this.generateRestoreId(),
                backupId,
                timestamp: startTime,
                status: 'success',
                duration,
                options
            };
            
            this.restoreHistory.unshift(restoreRecord);
            if (this.restoreHistory.length > 50) {
                this.restoreHistory.pop();
            }
            
            // Emit event
            this.eventBus.emit('backup:restored', {
                backupId,
                duration,
                timestamp: startTime,
                restoreId: restoreRecord.id
            });
            
            this.logger?.log(`Backup restored: ${backupId} (${duration}ms)`);
            
            return {
                success: true,
                restoreId: restoreRecord.id,
                duration,
                backup: this.sanitizeBackup(backup)
            };
            
        } catch (error) {
            const duration = Date.now() - startTime;
            
            // Record failed restore
            const restoreRecord = {
                id: this.generateRestoreId(),
                backupId,
                timestamp: startTime,
                status: 'failed',
                error: error.message,
                duration,
                options
            };
            
            this.restoreHistory.unshift(restoreRecord);
            
            this.logger?.error('Backup restore failed:', error);
            
            this.eventBus.emit('backup:restore_failed', {
                backupId,
                error: error.message,
                duration,
                timestamp: startTime
            });
            
            throw error;
        }
    }
    
    async extractBackupData(backup) {
        let data = backup.data;
        
        // Decrypt if encrypted
        if (backup.encrypted) {
            data = this.decryptData(data, this.options.encryptionKey);
        }
        
        // Decompress if compressed
        if (backup.compressed) {
            data = this.decompressData(data);
        }
        
        // Handle incremental backups
        if (data.type === 'incremental') {
            // Restore base backup first
            const baseBackup = this.backups.get(data.baseBackupId);
            if (!baseBackup) {
                throw new Error(`Base backup ${data.baseBackupId} not found`);
            }
            
            const baseData = await this.extractBackupData(baseBackup);
            
            // Apply changes
            return this.applyIncrementalChanges(baseData, data.changes);
        }
        
        return data.data || data;
    }
    
    async applyBackup(backupData, options) {
        // Pause auto-backup during restore
        const wasAutoBackupEnabled = this.schedule.enabled;
        if (wasAutoBackupEnabled) {
            this.schedule.enabled = false;
        }
        
        try {
            // Use state manager to apply backup
            if (this.stateManager) {
                if (options.merge !== false) {
                    // Merge with current state
                    const currentState = this.stateManager.getState();
                    const mergedState = this.mergeStates(currentState, backupData);
                    this.stateManager.replaceState(mergedState, `Restored from backup`);
                } else {
                    // Replace entire state
                    this.stateManager.replaceState(backupData, `Restored from backup`);
                }
            }
            
            // Also persist to storage
            if (this.statePersistence && options.persist !== false) {
                await this.statePersistence.save(backupData, {
                    source: 'backup_restore',
                    backupId: options.backupId
                });
            }
            
        } finally {
            // Restore auto-backup setting
            if (wasAutoBackupEnabled) {
                this.schedule.enabled = true;
            }
        }
    }
    
    // ==================== BACKUP VALIDATION ====================
    
    async validateBackupData(backup, extractedData) {
        // Validate checksum
        if (backup.checksum) {
            const currentChecksum = this.generateChecksum(extractedData);
            if (currentChecksum !== backup.checksum) {
                throw new Error('Backup checksum mismatch. Data may be corrupted.');
            }
        }
        
        // Validate structure
        if (!extractedData || typeof extractedData !== 'object') {
            throw new Error('Invalid backup data structure');
        }
        
        // Validate required fields for app state
        if (extractedData.version === undefined) {
            throw new Error('Backup missing version information');
        }
        
        return true;
    }
    
    async validateAllBackups() {
        const results = [];
        
        for (const [backupId, backup] of this.backups) {
            try {
                const data = await this.extractBackupData(backup);
                await this.validateBackupData(backup, data);
                
                results.push({
                    backupId,
                    valid: true,
                    size: backup.size,
                    timestamp: backup.timestamp
                });
            } catch (error) {
                results.push({
                    backupId,
                    valid: false,
                    error: error.message,
                    size: backup.size,
                    timestamp: backup.timestamp
                });
            }
        }
        
        // Remove invalid backups
        const invalidBackups = results.filter(r => !r.valid);
        invalidBackups.forEach(result => {
            this.backups.delete(result.backupId);
            this.logger?.warn(`Removed invalid backup: ${result.backupId}`);
        });
        
        // Persist changes
        if (invalidBackups.length > 0) {
            await this.persistBackups();
        }
        
        return {
            total: results.length,
            valid: results.filter(r => r.valid).length,
            invalid: invalidBackups.length,
            results
        };
    }
    
    // ==================== BACKUP MANAGEMENT ====================
    
    async cleanupOldBackups() {
        if (this.backups.size <= this.options.maxBackups) {
            return 0;
        }
        
        // Sort backups by timestamp (oldest first)
        const sortedBackups = Array.from(this.backups.values())
            .sort((a, b) => a.timestamp - b.timestamp);
        
        const toRemove = sortedBackups.slice(0, this.backups.size - this.options.maxBackups);
        const removedCount = toRemove.length;
        
        // Remove old backups
        toRemove.forEach(backup => {
            this.backups.delete(backup.id);
            
            // Also remove from IndexedDB
            this.removeFromIndexedDB(backup.id);
        });
        
        // Persist changes
        await this.persistBackups();
        
        if (removedCount > 0) {
            this.logger?.log(`Removed ${removedCount} old backups`);
            
            this.eventBus.emit('backup:cleanup_completed', {
                removed: removedCount,
                remaining: this.backups.size,
                timestamp: Date.now()
            });
        }
        
        return removedCount;
    }
    
    async deleteBackup(backupId) {
        const backup = this.backups.get(backupId);
        if (!backup) return false;
        
        // Remove from memory
        this.backups.delete(backupId);
        
        // Remove from IndexedDB
        await this.removeFromIndexedDB(backupId);
        
        // Persist changes
        await this.persistBackups();
        
        this.eventBus.emit('backup:deleted', {
            backupId,
            timestamp: Date.now()
        });
        
        this.logger?.log(`Backup deleted: ${backupId}`);
        
        return true;
    }
    
    async exportBackup(backupId, format = 'json') {
        const backup = this.backups.get(backupId);
        if (!backup) {
            throw new Error(`Backup ${backupId} not found`);
        }
        
        const sanitized = this.sanitizeBackup(backup);
        
        switch (format) {
            case 'json':
                return {
                    data: JSON.stringify(sanitized, null, 2),
                    type: 'application/json',
                    filename: `backup_${backupId}.json`
                };
                
            case 'blob':
                const blob = new Blob([JSON.stringify(sanitized, null, 2)], {
                    type: 'application/json'
                });
                return {
                    blob,
                    filename: `backup_${backupId}.json`
                };
                
            default:
                throw new Error(`Unsupported export format: ${format}`);
        }
    }
    
    async importBackup(backupData, options = {}) {
        const startTime = Date.now();
        
        try {
            let backup;
            
            // Parse backup data
            if (typeof backupData === 'string') {
                backup = JSON.parse(backupData);
            } else if (backupData instanceof Blob) {
                const text = await backupData.text();
                backup = JSON.parse(text);
            } else if (typeof backupData === 'object') {
                backup = backupData;
            } else {
                throw new Error('Invalid backup data format');
            }
            
            // Validate backup structure
            this.validateBackupStructure(backup);
            
            // Generate new ID if needed
            if (options.generateNewId !== false) {
                backup.id = this.generateBackupId();
                backup.timestamp = Date.now();
            }
            
            // Store backup
            await this.storeBackup(backup);
            
            const duration = Date.now() - startTime;
            
            this.eventBus.emit('backup:imported', {
                backupId: backup.id,
                source: options.source || 'external',
                duration,
                timestamp: startTime
            });
            
            this.logger?.log(`Backup imported: ${backup.id}`);
            
            return {
                success: true,
                backupId: backup.id,
                duration
            };
            
        } catch (error) {
            this.logger?.error('Backup import failed:', error);
            
            this.eventBus.emit('backup:import_failed', {
                error: error.message,
                timestamp: startTime
            });
            
            throw error;
        }
    }
    
    // ==================== AUTO-BACKUP SCHEDULING ====================
    
    setupAutoBackup() {
        if (!this.options.autoBackup) return;
        
        // Calculate next run time
        this.schedule.nextRun = Date.now() + this.options.autoBackupInterval;
        
        // Start auto-backup interval
        this.autoBackupInterval = setInterval(() => {
            this.runAutoBackup();
        }, this.options.autoBackupInterval);
        
        // Also backup on page visibility change (before unload)
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') {
                this.runAutoBackup({ urgent: true });
            }
        });
        
        this.logger?.log('Auto-backup scheduled');
    }
    
    async runAutoBackup(options = {}) {
        if (!this.schedule.enabled) return;
        
        // Check if enough time has passed since last backup
        const now = Date.now();
        if (this.schedule.lastRun && (now - this.schedule.lastRun < 300000) && !options.urgent) {
            return; // Minimum 5 minutes between backups
        }
        
        try {
            this.schedule.lastRun = now;
            this.schedule.nextRun = now + this.options.autoBackupInterval;
            
            const backupName = options.urgent ? 'auto_urgent' : 'auto_scheduled';
            
            await this.createBackup(backupName, {
                trigger: options.urgent ? 'page_hide' : 'scheduled',
                urgent: options.urgent || false
            });
            
        } catch (error) {
            this.logger?.warn('Auto-backup failed:', error);
        }
    }
    
    // ==================== UTILITY METHODS ====================
    
    prepareBackupData(state) {
        // Prepare state for backup
        const backupData = {
            state: this.deepClone(state),
            metadata: {
                appVersion: CONFIG.APP.VERSION,
                backupVersion: '1.0.0',
                timestamp: Date.now()
            }
        };
        
        return backupData;
    }
    
    sanitizeBackup(backup) {
        // Remove sensitive data from backup object
        const sanitized = { ...backup };
        
        // Don't include actual data in sanitized version
        if (sanitized.data) {
            sanitized.data = '[ENCRYPTED_DATA]';
        }
        
        return sanitized;
    }
    
    generateBackupId() {
        const timestamp = Date.now();
        const random = Math.random().toString(36).substr(2, 9);
        return `backup_${timestamp}_${random}`;
    }
    
    generateRestoreId() {
        return `restore_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    }
    
    generateChecksum(data) {
        const str = JSON.stringify(data);
        let hash = 0;
        
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        
        return hash.toString(16);
    }
    
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
    
    calculateStateDiff(oldState, newState) {
        const diff = {
            added: {},
            removed: {},
            changed: {}
        };
        
        const compare = (oldObj, newObj, path = '') => {
            const allKeys = new Set([
                ...Object.keys(oldObj || {}),
                ...Object.keys(newObj || {})
            ]);
            
            allKeys.forEach(key => {
                const currentPath = path ? `${path}.${key}` : key;
                const oldVal = oldObj?.[key];
                const newVal = newObj?.[key];
                
                if (oldVal === undefined && newVal !== undefined) {
                    diff.added[currentPath] = newVal;
                } else if (oldVal !== undefined && newVal === undefined) {
                    diff.removed[currentPath] = oldVal;
                } else if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
                    if (typeof oldVal === 'object' && typeof newVal === 'object') {
                        compare(oldVal, newVal, currentPath);
                    } else {
                        diff.changed[currentPath] = {
                            from: oldVal,
                            to: newVal
                        };
                    }
                }
            });
        };
        
        compare(oldState, newState);
        return diff;
    }
    
    applyIncrementalChanges(baseState, changes) {
        const newState = this.deepClone(baseState);
        
        // Apply additions
        Object.entries(changes.added || {}).forEach(([path, value]) => {
            this.setByPath(newState, path, value);
        });
        
        // Apply changes
        Object.entries(changes.changed || {}).forEach(([path, change]) => {
            this.setByPath(newState, path, change.to);
        });
        
        // Apply removals
        Object.keys(changes.removed || {}).forEach(path => {
            this.deleteByPath(newState, path);
        });
        
        return newState;
    }
    
    setByPath(obj, path, value) {
        const keys = path.split('.');
        const lastKey = keys.pop();
        let current = obj;
        
        for (const key of keys) {
            if (!current[key] || typeof current[key] !== 'object') {
                current[key] = {};
            }
            current = current[key];
        }
        
        current[lastKey] = value;
        return obj;
    }
    
    deleteByPath(obj, path) {
        const keys = path.split('.');
        const lastKey = keys.pop();
        let current = obj;
        
        for (const key of keys) {
            if (!current[key] || typeof current[key] !== 'object') {
                return; // Path doesn't exist
            }
            current = current[key];
        }
        
        delete current[lastKey];
    }
    
    mergeStates(currentState, backupState) {
        // Deep merge with backup taking precedence
        const merge = (target, source) => {
            for (const key in source) {
                if (source.hasOwnProperty(key)) {
                    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
                        if (!target[key] || typeof target[key] !== 'object') {
                            target[key] = {};
                        }
                        merge(target[key], source[key]);
                    } else {
                        target[key] = source[key];
                    }
                }
            }
            return target;
        };
        
        return merge(this.deepClone(currentState), backupState);
    }
    
    validateBackupStructure(backup) {
        const required = ['id', 'timestamp', 'data'];
        const missing = required.filter(field => !backup[field]);
        
        if (missing.length > 0) {
            throw new Error(`Backup missing required fields: ${missing.join(', ')}`);
        }
        
        return true;
    }
    
    // ==================== COMPRESSION AND ENCRYPTION ====================
    
    compressData(data) {
        // Simple compression for demo
        const jsonString = JSON.stringify(data);
        
        if (jsonString.length < 1000) {
            return data; // Don't compress small data
        }
        
        try {
            const compressed = btoa(unescape(encodeURIComponent(jsonString)));
            
            return {
                compressed: true,
                data: compressed,
                originalSize: jsonString.length
            };
        } catch (error) {
            this.logger?.warn('Compression failed:', error);
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
        // Simple encryption for demo
        try {
            const jsonString = JSON.stringify(data);
            const encrypted = btoa(unescape(encodeURIComponent(jsonString + '|' + key)));
            
            return {
                encrypted: true,
                data: encrypted,
                algorithm: 'simple_base64'
            };
        } catch (error) {
            this.logger?.warn('Encryption failed:', error);
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
    
    // ==================== INDEXEDDB STORAGE ====================
    
    async storeInIndexedDB(backup) {
        // Implement IndexedDB storage for larger backups
        return Promise.resolve(true);
    }
    
    async removeFromIndexedDB(backupId) {
        // Implement IndexedDB removal
        return Promise.resolve(true);
    }
    
    // ==================== CONTRACT VALIDATION ====================
    
    validateContract() {
        const errors = [];
        
        // Check required methods
        const requiredMethods = ['createBackup', 'restoreBackup', 'getAllBackups', 'deleteBackup'];
        requiredMethods.forEach(method => {
            if (typeof this[method] !== 'function') {
                errors.push(`Missing required method: ${method}`);
            }
        });
        
        // Check schedule against contract
        for (const [key, type] of Object.entries(BACKUP_CONTRACT.schedule)) {
            if (!key.endsWith('?') && this.schedule[key] === undefined) {
                errors.push(`Schedule missing required field: ${key}`);
            }
        }
        
        return {
            valid: errors.length === 0,
            errors,
            contract: BACKUP_CONTRACT,
            backupsCount: this.backups.size,
            schedule: this.schedule,
            timestamp: new Date().toISOString()
        };
    }
    
    // ==================== LIFECYCLE ====================
    
    destroy() {
        // Clear intervals
        if (this.autoBackupInterval) {
            clearInterval(this.autoBackupInterval);
        }
        
        // Save all data
        this.persistBackups();
        
        this.logger?.log('StateBackup destroyed');
    }
}

// Singleton instance
export const stateBackup = new StateBackup();

// Register with context
context.registerSingleton('stateBackup', stateBackup);

// Export for global use
if (typeof window !== 'undefined') {
    window.stateBackup = stateBackup;
}

export default stateBackup;
