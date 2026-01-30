/**
 * HyperLang - State Migration System
 * Version: 1.0.0
 * Principles: Dependency Injection + Interface Contract
 */

import { CONFIG } from './config.js';
import { context } from './context-provider.js';
import { eventBus } from './event-bus.js';

// Migration Contract
export const MIGRATION_CONTRACT = {
    version: 'string',
    description: 'string',
    up: 'function',
    down: 'function?',
    timestamp: 'number',
    checksum: 'string?'
};

export class StateMigrations {
    constructor(options = {}) {
        // Dependency Injection
        this.config = context.get('config');
        this.logger = context.get('logger');
        this.eventBus = context.get('eventBus') || eventBus;
        
        // Configuration
        this.options = {
            migrationsPath: options.migrationsPath || 'migrations/',
            versionKey: options.versionKey || 'hyperlang_schema_version',
            autoMigrate: options.autoMigrate ?? true,
            backupBeforeMigrate: options.backupBeforeMigrate ?? true,
            validateAfterMigrate: options.validateAfterMigrate ?? true,
            ...options
        };
        
        // Migration Registry
        this.migrations = new Map();
        this.versionHistory = [];
        
        // Load existing migrations
        this.loadMigrations();
        
        // Register with context
        context.register('stateMigrations', {
            factory: () => this,
            dependencies: ['config', 'logger', 'eventBus'],
            lifecycle: 'singleton'
        });
        
        this.logger?.log('StateMigrations initialized');
    }
    
    // ==================== MIGRATION REGISTRATION ====================
    
    register(migration) {
        this.validateMigration(migration);
        
        if (this.migrations.has(migration.version)) {
            throw new Error(`Migration ${migration.version} already registered`);
        }
        
        this.migrations.set(migration.version, {
            ...migration,
            registeredAt: Date.now(),
            applied: false
        });
        
        // Sort migrations by version
        this.sortMigrations();
        
        this.logger?.log(`Migration registered: ${migration.version} - ${migration.description}`);
        
        return this;
    }
    
    registerBatch(migrations) {
        migrations.forEach(migration => this.register(migration));
        return this;
    }
    
    // ==================== MIGRATION EXECUTION ====================
    
    async migrate(state, targetVersion = null) {
        const startTime = Date.now();
        const currentVersion = this.getCurrentVersion(state);
        
        if (!targetVersion) {
            targetVersion = this.getLatestVersion();
        }
        
        // Check if migration is needed
        if (currentVersion === targetVersion) {
            this.logger?.log(`No migration needed. Current: ${currentVersion}, Target: ${targetVersion}`);
            return {
                migrated: false,
                state,
                currentVersion,
                targetVersion,
                duration: 0
            };
        }
        
        // Determine direction
        const direction = this.compareVersions(currentVersion, targetVersion) < 0 ? 'up' : 'down';
        const migrationsToRun = this.getMigrationsBetween(currentVersion, targetVersion, direction);
        
        if (migrationsToRun.length === 0) {
            this.logger?.warn(`No migrations found between ${currentVersion} and ${targetVersion}`);
            return {
                migrated: false,
                state,
                currentVersion,
                targetVersion,
                duration: 0
            };
        }
        
        // Backup state before migration
        let backup = null;
        if (this.options.backupBeforeMigrate) {
            backup = this.createBackup(state, currentVersion);
        }
        
        let migratedState = { ...state };
        const results = [];
        
        // Run migrations
        for (const migration of migrationsToRun) {
            try {
                const migrationStart = Date.now();
                
                this.eventBus.emit('migration:start', {
                    migration: migration.version,
                    direction,
                    timestamp: Date.now()
                });
                
                // Execute migration
                if (direction === 'up') {
                    migratedState = await migration.up(migratedState);
                } else if (direction === 'down' && migration.down) {
                    migratedState = await migration.down(migratedState);
                } else {
                    throw new Error(`No ${direction} migration available for ${migration.version}`);
                }
                
                // Update migration status
                migration.applied = direction === 'up';
                migration.lastApplied = Date.now();
                
                const migrationDuration = Date.now() - migrationStart;
                
                results.push({
                    version: migration.version,
                    direction,
                    success: true,
                    duration: migrationDuration,
                    timestamp: Date.now()
                });
                
                this.logger?.log(`Migration ${migration.version} ${direction} completed in ${migrationDuration}ms`);
                
                this.eventBus.emit('migration:complete', {
                    migration: migration.version,
                    direction,
                    duration: migrationDuration,
                    timestamp: Date.now()
                });
                
            } catch (error) {
                results.push({
                    version: migration.version,
                    direction,
                    success: false,
                    error: error.message,
                    timestamp: Date.now()
                });
                
                this.logger?.error(`Migration ${migration.version} failed:`, error);
                
                this.eventBus.emit('migration:error', {
                    migration: migration.version,
                    direction,
                    error: error.message,
                    timestamp: Date.now()
                });
                
                // Rollback if backup exists
                if (backup) {
                    this.logger?.warn('Rolling back due to migration failure');
                    migratedState = backup.state;
                }
                
                throw new Error(`Migration failed at ${migration.version}: ${error.message}`);
            }
        }
        
        // Update version in state
        migratedState = this.updateVersionInState(migratedState, targetVersion);
        
        // Validate migrated state
        if (this.options.validateAfterMigrate) {
            this.validateMigratedState(migratedState);
        }
        
        const totalDuration = Date.now() - startTime;
        
        // Record version history
        this.recordVersionHistory({
            fromVersion: currentVersion,
            toVersion: targetVersion,
            direction,
            migrations: results,
            duration: totalDuration,
            timestamp: Date.now()
        });
        
        this.logger?.log(`Migration completed: ${currentVersion} → ${targetVersion} in ${totalDuration}ms`);
        
        this.eventBus.emit('migration:all_complete', {
            fromVersion: currentVersion,
            toVersion: targetVersion,
            direction,
            results,
            duration: totalDuration,
            timestamp: Date.now()
        });
        
        return {
            migrated: true,
            state: migratedState,
            currentVersion: targetVersion,
            previousVersion: currentVersion,
            results,
            duration: totalDuration,
            backup
        };
    }
    
    // ==================== MIGRATION MANAGEMENT ====================
    
    getCurrentVersion(state) {
        return state?.metadata?.version || state?.version || '0.0.0';
    }
    
    getLatestVersion() {
        const versions = Array.from(this.migrations.keys());
        if (versions.length === 0) return '0.0.0';
        
        // Sort and get latest
        return versions.sort(this.compareVersions).pop();
    }
    
    getPendingMigrations(currentVersion = '0.0.0') {
        const latestVersion = this.getLatestVersion();
        return this.getMigrationsBetween(currentVersion, latestVersion, 'up');
    }
    
    getMigrationsBetween(fromVersion, toVersion, direction = 'up') {
        const allVersions = Array.from(this.migrations.keys())
            .sort(this.compareVersions);
        
        let startIndex = allVersions.indexOf(fromVersion);
        if (startIndex === -1) startIndex = 0;
        
        let endIndex = allVersions.indexOf(toVersion);
        if (endIndex === -1) endIndex = allVersions.length - 1;
        
        // Determine range based on direction
        let versionsInRange;
        if (direction === 'up') {
            versionsInRange = allVersions.slice(startIndex, endIndex + 1)
                .filter(v => this.compareVersions(v, fromVersion) > 0);
        } else {
            versionsInRange = allVersions.slice(endIndex, startIndex + 1)
                .filter(v => this.compareVersions(v, fromVersion) < 0)
                .reverse();
        }
        
        return versionsInRange
            .map(v => this.migrations.get(v))
            .filter(m => m);
    }
    
    // ==================== VERSION MANAGEMENT ====================
    
    compareVersions(v1, v2) {
        const parts1 = v1.split('.').map(Number);
        const parts2 = v2.split('.').map(Number);
        
        for (let i = 0; i < 3; i++) {
            if (parts1[i] > parts2[i]) return 1;
            if (parts1[i] < parts2[i]) return -1;
        }
        
        return 0;
    }
    
    updateVersionInState(state, version) {
        const newState = { ...state };
        
        if (!newState.metadata) {
            newState.metadata = {};
        }
        
        newState.metadata.version = version;
        newState.metadata.lastMigrated = Date.now();
        
        return newState;
    }
    
    // ==================== VALIDATION ====================
    
    validateMigration(migration) {
        const required = ['version', 'description', 'up'];
        const missing = required.filter(field => !migration[field]);
        
        if (missing.length > 0) {
            throw new Error(`Migration missing required fields: ${missing.join(', ')}`);
        }
        
        // Validate version format
        if (!/^\d+\.\d+\.\d+$/.test(migration.version)) {
            throw new Error(`Invalid version format: ${migration.version}. Use semantic versioning (x.x.x)`);
        }
        
        // Validate functions
        if (typeof migration.up !== 'function') {
            throw new Error('Migration up must be a function');
        }
        
        if (migration.down && typeof migration.down !== 'function') {
            throw new Error('Migration down must be a function if provided');
        }
        
        return true;
    }
    
    validateMigratedState(state) {
        // Basic validation
        if (!state || typeof state !== 'object') {
            throw new Error('Migrated state must be an object');
        }
        
        // Check for required fields
        if (!state.metadata || !state.metadata.version) {
            throw new Error('Migrated state missing version metadata');
        }
        
        // Check for circular references
        this.checkCircularReferences(state);
        
        return true;
    }
    
    checkCircularReferences(obj, seen = new Set()) {
        if (obj && typeof obj === 'object') {
            if (seen.has(obj)) {
                throw new Error('Circular reference detected in migrated state');
            }
            
            seen.add(obj);
            
            for (const key in obj) {
                if (obj.hasOwnProperty(key)) {
                    this.checkCircularReferences(obj[key], new Set(seen));
                }
            }
        }
    }
    
    // ==================== BACKUP AND RECOVERY ====================
    
    createBackup(state, version) {
        return {
            state: this.deepClone(state),
            version,
            timestamp: Date.now(),
            checksum: this.generateChecksum(state)
        };
    }
    
    async rollback(state, backup) {
        if (!backup) {
            throw new Error('No backup available for rollback');
        }
        
        // Validate backup
        const currentChecksum = this.generateChecksum(backup.state);
        if (currentChecksum !== backup.checksum) {
            throw new Error('Backup checksum mismatch');
        }
        
        this.logger?.log(`Rolling back to version ${backup.version}`);
        
        return {
            state: backup.state,
            version: backup.version,
            rolledBackFrom: this.getCurrentVersion(state),
            timestamp: Date.now()
        };
    }
    
    // ==================== HISTORY AND LOGGING ====================
    
    recordVersionHistory(entry) {
        this.versionHistory.unshift(entry);
        
        // Keep only last 50 entries
        if (this.versionHistory.length > 50) {
            this.versionHistory.pop();
        }
        
        // Save to storage
        this.saveHistory();
    }
    
    getVersionHistory(limit = 20) {
        return this.versionHistory.slice(0, limit);
    }
    
    saveHistory() {
        try {
            localStorage.setItem(
                'hyperlang_migration_history',
                JSON.stringify({
                    history: this.versionHistory,
                    lastUpdated: Date.now()
                })
            );
        } catch (error) {
            this.logger?.warn('Failed to save migration history:', error);
        }
    }
    
    loadHistory() {
        try {
            const stored = localStorage.getItem('hyperlang_migration_history');
            if (stored) {
                const data = JSON.parse(stored);
                this.versionHistory = data.history || [];
            }
        } catch (error) {
            this.logger?.warn('Failed to load migration history:', error);
        }
    }
    
    // ==================== BUILT-IN MIGRATIONS ====================
    
    loadMigrations() {
        // Load from localStorage or predefined
        this.loadFromStorage();
        
        // Register built-in migrations
        this.registerBuiltInMigrations();
    }
    
    registerBuiltInMigrations() {
        // Migration 1.0.0: Initial schema
        this.register({
            version: '1.0.0',
            description: 'Initial state schema',
            up: (state) => ({
                ...state,
                version: '1.0.0',
                metadata: {
                    created: Date.now(),
                    version: '1.0.0',
                    migrated: true
                }
            }),
            down: (state) => {
                const newState = { ...state };
                delete newState.metadata;
                return newState;
            }
        });
        
        // Migration 1.1.0: Add user progress tracking
        this.register({
            version: '1.1.0',
            description: 'Add user progress tracking',
            up: (state) => ({
                ...state,
                user: {
                    ...state.user,
                    progress: state.user?.progress || {},
                    stats: state.user?.stats || {
                        lessonsCompleted: 0,
                        totalTime: 0,
                        streak: 0
                    }
                },
                metadata: {
                    ...state.metadata,
                    version: '1.1.0'
                }
            })
        });
        
        // Migration 1.2.0: Add offline support
        this.register({
            version: '1.2.0',
            description: 'Add offline support and caching',
            up: (state) => ({
                ...state,
                system: {
                    ...state.system,
                    offline: {
                        enabled: true,
                        lastSync: null,
                        pendingActions: []
                    },
                    cache: state.system?.cache || {}
                },
                metadata: {
                    ...state.metadata,
                    version: '1.2.0'
                }
            })
        });
    }
    
    loadFromStorage() {
        try {
            const stored = localStorage.getItem('hyperlang_migrations');
            if (stored) {
                const migrations = JSON.parse(stored);
                migrations.forEach(migration => {
                    // Recreate functions from strings (simplified)
                    if (migration.up && typeof migration.up === 'string') {
                        migration.up = new Function('return ' + migration.up)();
                    }
                    if (migration.down && typeof migration.down === 'string') {
                        migration.down = new Function('return ' + migration.down)();
                    }
                    
                    this.migrations.set(migration.version, migration);
                });
                
                this.sortMigrations();
            }
        } catch (error) {
            this.logger?.warn('Failed to load migrations from storage:', error);
        }
    }
    
    saveToStorage() {
        try {
            const migrations = Array.from(this.migrations.values()).map(m => ({
                ...m,
                up: m.up.toString(),
                down: m.down ? m.down.toString() : null
            }));
            
            localStorage.setItem('hyperlang_migrations', JSON.stringify(migrations));
        } catch (error) {
            this.logger?.warn('Failed to save migrations to storage:', error);
        }
    }
    
    // ==================== UTILITY METHODS ====================
    
    sortMigrations() {
        const sorted = Array.from(this.migrations.entries())
            .sort((a, b) => this.compareVersions(a[0], b[0]));
        
        this.migrations = new Map(sorted);
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
    
    // ==================== CONTRACT VALIDATION ====================
    
    validateContract() {
        const errors = [];
        
        // Check required methods
        const requiredMethods = ['register', 'migrate', 'getCurrentVersion', 'getLatestVersion'];
        requiredMethods.forEach(method => {
            if (typeof this[method] !== 'function') {
                errors.push(`Missing required method: ${method}`);
            }
        });
        
        // Check migrations against contract
        for (const [version, migration] of this.migrations) {
            for (const [key, type] of Object.entries(MIGRATION_CONTRACT)) {
                if (!key.endsWith('?') && migration[key] === undefined) {
                    errors.push(`Migration ${version} missing required field: ${key}`);
                }
            }
        }
        
        return {
            valid: errors.length === 0,
            errors,
            contract: MIGRATION_CONTRACT,
            migrationsCount: this.migrations.size,
            timestamp: new Date().toISOString()
        };
    }
    
    // ==================== LIFECYCLE ====================
    
    destroy() {
        // Save migrations before destruction
        this.saveToStorage();
        this.saveHistory();
        
        this.logger?.log('StateMigrations destroyed');
    }
}

// Singleton instance
export const stateMigrations = new StateMigrations();

// Register with context
context.registerSingleton('stateMigrations', stateMigrations);

// Export for global use
if (typeof window !== 'undefined') {
    window.stateMigrations = stateMigrations;
}

export default stateMigrations;
