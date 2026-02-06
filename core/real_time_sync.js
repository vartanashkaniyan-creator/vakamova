/**
 * core/real-time-sync.js
 * Real-time synchronization with conflict resolution and delta updates
 * 
 * Principles Applied:
 * - SRP: Single responsibility - manages real-time synchronization only
 * - OCP: Extensible sync strategies and conflict resolvers without modifying core
 * - ISP: Small, focused interfaces for sync, conflict resolution, and delta management
 * - DIP: Depends on abstractions (EventBus, OfflineQueue, StateManager) not implementations
 * - DRY: Reusable sync patterns and conflict resolution logic
 * - KISS: Simple synchronization state machine
 * - Testable: Pure conflict resolvers and mockable dependencies
 */

// ============================================
// INTERFACES (Abstractions)
// ============================================

/**
 * @interface Syncable
 * Contract for syncable data entities
 */
class Syncable {
  /**
   * Unique identifier for sync tracking
   * @returns {string}
   */
  get syncId() {
    throw new Error('syncId getter must be implemented');
  }

  /**
   * Last sync version/timestamp
   * @returns {number}
   */
  get syncVersion() {
    throw new Error('syncVersion getter must be implemented');
  }

  /**
   * Update sync version
   * @param {number} version
   */
  setSyncVersion(version) {
    throw new Error('setSyncVersion() must be implemented');
  }

  /**
   * Check if entity has local modifications
   * @returns {boolean}
   */
  hasLocalChanges() {
    throw new Error('hasLocalChanges() must be implemented');
  }

  /**
   * Get changes since last sync
   * @returns {Object|null}
   */
  getChangesSinceLastSync() {
    throw new Error('getChangesSinceLastSync() must be implemented');
  }

  /**
   * Apply remote changes
   * @param {Object} changes
   * @returns {boolean} True if changes were applied
   */
  applyRemoteChanges(changes) {
    throw new Error('applyRemoteChanges() must be implemented');
  }

  /**
   * Serialize for transmission
   * @returns {Object}
   */
  serializeForSync() {
    throw new Error('serializeForSync() must be implemented');
  }
}

/**
 * @interface SyncStrategy
 * Contract for synchronization strategies
 */
class SyncStrategy {
  /**
   * Synchronize local and remote states
   * @param {Syncable} local - Local entity
   * @param {Object} remote - Remote entity data
   * @param {SyncContext} context - Sync context
   * @returns {Promise<SyncResult>}
   */
  async sync(local, remote, context) {
    throw new Error('sync() must be implemented');
  }

  /**
   * Check if strategy supports entity type
   * @param {string} entityType
   * @returns {boolean}
   */
  supports(entityType) {
    throw new Error('supports() must be implemented');
  }
}

/**
 * @interface ConflictResolver
 * Contract for conflict resolution
 */
class ConflictResolver {
  /**
   * Resolve conflict between local and remote changes
   * @param {Object} localChanges - Local changes
   * @param {Object} remoteChanges - Remote changes
   * @param {SyncContext} context - Sync context
   * @returns {Promise<ResolutionResult>}
   */
  async resolve(localChanges, remoteChanges, context) {
    throw new Error('resolve() must be implemented');
  }

  /**
   * Check if resolver supports conflict type
   * @param {string} conflictType
   * @returns {boolean}
   */
  supports(conflictType) {
    throw new Error('supports() must be implemented');
  }
}

// ============================================
// TYPES
// ============================================

/**
 * @typedef {Object} SyncResult
 * @property {boolean} success - Whether sync succeeded
 * @property {'SYNCED'|'CONFLICT'|'ERROR'} status - Sync status
 * @property {Object} [merged] - Merged data if successful
 * @property {Object} [localChanges] - Local changes if conflict
 * @property {Object} [remoteChanges] - Remote changes if conflict
 * @property {Error} [error] - Error if any
 * @property {number} timestamp - Sync completion timestamp
 */

/**
 * @typedef {Object} ResolutionResult
 * @property {'LOCAL_WINS'|'REMOTE_WINS'|'MERGED'|'CUSTOM'} resolution
 * @property {Object} resolvedData - Resolved data
 * @property {boolean} notifyUser - Whether to notify user about conflict
 */

/**
 * @typedef {Object} SyncContext
 * @property {string} userId - Current user ID
 * @property {string} deviceId - Current device ID
 * @property {boolean} isOnline - Whether device is online
 * @property {number} syncPriority - Sync priority (0-10)
 * @property {Object} metadata - Additional sync metadata
 */

/**
 * @typedef {Object} DeltaUpdate
 * @property {string} entityId - Entity identifier
 * @property {string} entityType - Entity type
 * @property {number} fromVersion - Starting version
 * @property {number} toVersion - Target version
 * @property {Object} changes - Actual changes
 * @property {number} timestamp - Change timestamp
 */

/**
 * @typedef {Object} SyncConfig
 * @property {number} syncInterval - Auto-sync interval (ms)
 * @property {number} maxRetries - Maximum sync retry attempts
 * @property {number} conflictRetryDelay - Delay before retrying conflicted sync
 * @property {boolean} autoSyncOnOnline - Auto-sync when coming online
 * @property {boolean} deltaSyncEnabled - Enable delta updates
 * @property {number} deltaHistorySize - How many delta versions to keep
 * @property {string[]} priorityEntities - Entity types to sync first
 */

// ============================================
// CORE REAL-TIME SYNC MANAGER
// ============================================

/**
 * Real-time Sync Manager
 */
class RealTimeSync {
  /**
   * @constructor
   * @param {Object} dependencies
   * @param {EventBus} dependencies.eventBus - Event bus
   * @param {StateManager} dependencies.stateManager - State manager
   * @param {OfflineQueue} dependencies.offlineQueue - Offline queue
   * @param {SyncConfig} [config] - Sync configuration
   */
  constructor(dependencies, config = {}) {
    /** @private @type {EventBus} */
    this.eventBus = dependencies.eventBus;

    /** @private @type {StateManager} */
    this.stateManager = dependencies.stateManager;

    /** @private @type {OfflineQueue} */
    this.offlineQueue = dependencies.offlineQueue;

    /** @private @type {SyncConfig} */
    this.config = {
      syncInterval: config.syncInterval || 30000, // 30 seconds
      maxRetries: config.maxRetries || 3,
      conflictRetryDelay: config.conflictRetryDelay || 10000,
      autoSyncOnOnline: config.autoSyncOnOnline !== false,
      deltaSyncEnabled: config.deltaSyncEnabled !== false,
      deltaHistorySize: config.deltaHistorySize || 50,
      priorityEntities: config.priorityEntities || ['user', 'lesson_progress'],
      ...config
    };

    /** @private @type {Map<string, SyncStrategy>} */
    this.syncStrategies = new Map();

    /** @private @type {Map<string, ConflictResolver>} */
    this.conflictResolvers = new Map();

    /** @private @type {Set<string>} */
    this.syncingEntities = new Set();

    /** @private @type {Map<string, number>} */
    this.entitySyncVersions = new Map();

    /** @private @type {Map<string, DeltaUpdate[]>} */
    this.deltaHistory = new Map();

    /** @private */
    this.syncTimer = null;

    /** @private */
    this.isOnline = false;

    /** @private */
    this.isSyncing = false;

    /** @private */
    this.pendingSyncs = new Map();

    // Subscribe to events
    this.eventBus.subscribe('network.status', this.handleNetworkStatus.bind(this));
    this.eventBus.subscribe('state.changed', this.handleStateChange.bind(this));
  }

  // ============================================
  // PUBLIC API
  // ============================================

  /**
   * Initialize sync manager
   * @returns {Promise<void>}
   */
  async initialize() {
    // Load last sync versions from storage
    await this.loadSyncVersions();

    // Start auto-sync if enabled
    if (this.config.autoSyncOnOnline) {
      this.startAutoSync();
    }

    await this.emitEvent('SYNC_INITIALIZED', {
      deltaSyncEnabled: this.config.deltaSyncEnabled,
      syncInterval: this.config.syncInterval
    });
  }

  /**
   * Register sync strategy for entity type
   * @param {SyncStrategy} strategy
   */
  registerSyncStrategy(strategy) {
    // Strategy should declare supported types
    if (strategy.supportedTypes) {
      strategy.supportedTypes.forEach(type => {
        this.syncStrategies.set(type, strategy);
      });
    } else {
      // Assume supports based on supports() method
      this.syncStrategies.set('*', strategy);
    }
  }

  /**
   * Register conflict resolver
   * @param {ConflictResolver} resolver
   */
  registerConflictResolver(resolver) {
    if (resolver.supportedConflictTypes) {
      resolver.supportedConflictTypes.forEach(type => {
        this.conflictResolvers.set(type, resolver);
      });
    } else {
      this.conflictResolvers.set('*', resolver);
    }
  }

  /**
   * Manually trigger sync for entity
   * @param {string} entityType
   * @param {string} entityId
   * @param {Object} [options]
   * @returns {Promise<SyncResult>}
   */
  async syncEntity(entityType, entityId, options = {}) {
    const syncKey = `${entityType}:${entityId}`;

    // Check if already syncing
    if (this.syncingEntities.has(syncKey)) {
      return this.waitForPendingSync(syncKey);
    }

    this.syncingEntities.add(syncKey);

    try {
      await this.emitEvent('SYNC_STARTED', {
        entityType,
        entityId,
        syncKey,
        priority: options.priority || 0
      });

      const result = await this.performEntitySync(entityType, entityId, options);

      await this.emitEvent('SYNC_COMPLETED', {
        entityType,
        entityId,
        syncKey,
        result
      });

      return result;
    } catch (error) {
      await this.emitEvent('SYNC_FAILED', {
        entityType,
        entityId,
        syncKey,
        error
      });
      throw error;
    } finally {
      this.syncingEntities.delete(syncKey);
      this.pendingSyncs.delete(syncKey);
    }
  }

  /**
   * Sync all entities
   * @param {Object} [options]
   * @returns {Promise<SyncResult[]>}
   */
  async syncAll(options = {}) {
    if (this.isSyncing) {
      throw new Error('Sync already in progress');
    }

    this.isSyncing = true;

    try {
      // Get all syncable entities from state
      const entities = this.getSyncableEntities();
      
      // Sort by priority
      const sortedEntities = this.sortEntitiesByPriority(entities);

      const results = [];
      
      // Sync priority entities first
      for (const entity of sortedEntities) {
        if (entity.priority || options.force) {
          try {
            const result = await this.syncEntity(
              entity.type,
              entity.id,
              { priority: entity.priority }
            );
            results.push(result);
          } catch (error) {
            results.push({
              success: false,
              error,
              entityType: entity.type,
              entityId: entity.id
            });
          }
        }
      }

      await this.emitEvent('BULK_SYNC_COMPLETED', {
        total: sortedEntities.length,
        successful: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
        results
      });

      return results;
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Get delta updates for entity
   * @param {string} entityType
   * @param {string} entityId
   * @param {number} fromVersion
   * @param {number} [toVersion]
   * @returns {DeltaUpdate[]}
   */
  getDeltaUpdates(entityType, entityId, fromVersion, toVersion) {
    const historyKey = `${entityType}:${entityId}`;
    const history = this.deltaHistory.get(historyKey) || [];

    if (!toVersion) {
      toVersion = Math.max(...history.map(h => h.toVersion), fromVersion);
    }

    return history.filter(update =>
      update.fromVersion >= fromVersion &&
      update.toVersion <= toVersion
    );
  }

  /**
   * Apply delta update to entity
   * @param {DeltaUpdate} deltaUpdate
   * @returns {Promise<boolean>}
   */
  async applyDeltaUpdate(deltaUpdate) {
    try {
      const entity = this.getEntity(
        deltaUpdate.entityType,
        deltaUpdate.entityId
      );

      if (!entity) {
        throw new Error(`Entity not found: ${deltaUpdate.entityType}:${deltaUpdate.entityId}`);
      }

      // Apply changes
      const success = entity.applyRemoteChanges(deltaUpdate.changes);
      
      if (success) {
        entity.setSyncVersion(deltaUpdate.toVersion);
        
        // Store in delta history
        await this.storeDeltaUpdate(deltaUpdate);
        
        await this.emitEvent('DELTA_APPLIED', {
          entityType: deltaUpdate.entityType,
          entityId: deltaUpdate.entityId,
          fromVersion: deltaUpdate.fromVersion,
          toVersion: deltaUpdate.toVersion
        });
      }

      return success;
    } catch (error) {
      await this.emitEvent('DELTA_APPLY_FAILED', {
        deltaUpdate,
        error
      });
      return false;
    }
  }

  /**
   * Start automatic synchronization
   */
  startAutoSync() {
    if (this.syncTimer) {
      return;
    }

    this.syncTimer = setInterval(async () => {
      if (this.isOnline && !this.isSyncing) {
        await this.syncAll({ background: true });
      }
    }, this.config.syncInterval);

    await this.emitEvent('AUTO_SYNC_STARTED');
  }

  /**
   * Stop automatic synchronization
   */
  stopAutoSync() {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }

    this.emitEvent('AUTO_SYNC_STOPPED');
  }

  // ============================================
  // PRIVATE METHODS
  // ============================================

  /** @private */
  async performEntitySync(entityType, entityId, options) {
    const entity = this.getEntity(entityType, entityId);
    
    if (!entity) {
      throw new Error(`Entity not found: ${entityType}:${entityId}`);
    }

    // Get sync strategy
    const strategy = this.getSyncStrategy(entityType);
    
    if (!strategy) {
      throw new Error(`No sync strategy for entity type: ${entityType}`);
    }

    // Get current sync context
    const context = this.createSyncContext(entityType, entityId, options);

    // Get remote data (simulated - in real app, this would be API call)
    const remoteData = await this.fetchRemoteData(entityType, entityId, context);

    // Perform sync using strategy
    const result = await strategy.sync(entity, remoteData, context);

    // Handle result
    if (result.success) {
      await this.handleSyncSuccess(entityType, entityId, result, context);
    } else if (result.status === 'CONFLICT') {
      await this.handleSyncConflict(entityType, entityId, result, context);
    } else {
      await this.handleSyncError(entityType, entityId, result, context);
    }

    return result;
  }

  /** @private */
  async handleSyncSuccess(entityType, entityId, result, context) {
    // Update sync version
    const newVersion = result.merged?.syncVersion || Date.now();
    this.entitySyncVersions.set(`${entityType}:${entityId}`, newVersion);

    // Store delta if enabled
    if (this.config.deltaSyncEnabled && result.merged?.changes) {
      const deltaUpdate = {
        entityId,
        entityType,
        fromVersion: result.merged.fromVersion || 0,
        toVersion: newVersion,
        changes: result.merged.changes,
        timestamp: Date.now()
      };
      await this.storeDeltaUpdate(deltaUpdate);
    }

    // Save sync versions to storage
    await this.saveSyncVersions();

    await this.emitEvent('ENTITY_SYNC_SUCCESS', {
      entityType,
      entityId,
      newVersion,
      context
    });
  }

  /** @private */
  async handleSyncConflict(entityType, entityId, result, context) {
    // Find conflict resolver
    const resolver = this.getConflictResolver(entityType);
    
    if (!resolver) {
      await this.emitEvent('CONFLICT_NO_RESOLVER', {
        entityType,
        entityId,
        localChanges: result.localChanges,
        remoteChanges: result.remoteChanges
      });
      return;
    }

    // Attempt resolution
    const resolution = await resolver.resolve(
      result.localChanges,
      result.remoteChanges,
      context
    );

    if (resolution.resolution === 'MERGED' || resolution.resolution === 'CUSTOM') {
      // Apply resolved changes
      const entity = this.getEntity(entityType, entityId);
      if (entity) {
        entity.applyRemoteChanges(resolution.resolvedData);
        
        // Retry sync with resolved data
        setTimeout(() => {
          this.syncEntity(entityType, entityId, {
            ...context,
            retry: true
          });
        }, this.config.conflictRetryDelay);
      }
    }

    await this.emitEvent('CONFLICT_RESOLUTION_ATTEMPTED', {
      entityType,
      entityId,
      resolution,
      notifyUser: resolution.notifyUser
    });
  }

  /** @private */
  async handleSyncError(entityType, entityId, result, context) {
    // Queue for retry if retryable
    if (result.retryable !== false && context.retryCount < this.config.maxRetries) {
      await this.offlineQueue.enqueue('RETRY_SYNC', {
        entityType,
        entityId,
        context: { ...context, retryCount: (context.retryCount || 0) + 1 }
      }, {
        priority: 5,
        maxRetries: 2
      });
    }

    await this.emitEvent('ENTITY_SYNC_ERROR', {
      entityType,
      entityId,
      error: result.error,
      retryable: result.retryable,
      context
    });
  }

  /** @private */
  getSyncStrategy(entityType) {
    // Exact match
    if (this.syncStrategies.has(entityType)) {
      return this.syncStrategies.get(entityType);
    }

    // Wildcard strategy
    if (this.syncStrategies.has('*')) {
      const wildcardStrategy = this.syncStrategies.get('*');
      if (wildcardStrategy.supports(entityType)) {
        return wildcardStrategy;
      }
    }

    // Strategy with supports() method
    for (const strategy of this.syncStrategies.values()) {
      if (strategy.supports && strategy.supports(entityType)) {
        return strategy;
      }
    }

    return null;
  }

  /** @private */
  getConflictResolver(entityType) {
    // Try entity-specific resolver first
    if (this.conflictResolvers.has(entityType)) {
      return this.conflictResolvers.get(entityType);
    }

    // Try wildcard
    if (this.conflictResolvers.has('*')) {
      return this.conflictResolvers.get('*');
    }

    // Find by supports method
    for (const resolver of this.conflictResolvers.values()) {
      if (resolver.supports && resolver.supports(entityType)) {
        return resolver;
      }
    }

    return null;
  }

  /** @private */
  getEntity(entityType, entityId) {
    // This would typically come from state manager
    // Simplified for example
    const state = this.stateManager.getState();
    
    switch (entityType) {
      case 'user':
        return state.user;
      case 'lesson_progress':
        return state.lessons?.progress?.find(p => p.id === entityId);
      case 'settings':
        return state.settings;
      default:
        return null;
    }
  }

  /** @private */
  getSyncableEntities() {
    const state = this.stateManager.getState();
    const entities = [];

    // Add user if exists
    if (state.user) {
      entities.push({
        type: 'user',
        id: state.user.id,
        priority: this.config.priorityEntities.includes('user') ? 10 : 5
      });
    }

    // Add lesson progress
    if (state.lessons?.progress) {
      state.lessons.progress.forEach(progress => {
        entities.push({
          type: 'lesson_progress',
          id: progress.id,
          priority: this.config.priorityEntities.includes('lesson_progress') ? 9 : 4
        });
      });
    }

    // Add settings
    if (state.settings) {
      entities.push({
        type: 'settings',
        id: 'global_settings',
        priority: 3
      });
    }

    return entities;
  }

  /** @private */
  sortEntitiesByPriority(entities) {
    return entities.sort((a, b) => b.priority - a.priority);
  }

  /** @private */
  createSyncContext(entityType, entityId, options) {
    const state = this.stateManager.getState();
    
    return {
      userId: state.user?.id,
      deviceId: state.deviceId || 'unknown',
      isOnline: this.isOnline,
      syncPriority: options.priority || 0,
      retryCount: options.retryCount || 0,
      metadata: {
        entityType,
        entityId,
        timestamp: Date.now(),
        appVersion: '1.0.0'
      }
    };
  }

  /** @private */
  async fetchRemoteData(entityType, entityId, context) {
    // In real implementation, this would call an API
    // For now, return mock data
    return {
      id: entityId,
      type: entityType,
      data: {},
      syncVersion: Date.now() - 1000, // Slightly older than local
      lastModified: Date.now() - 5000
    };
  }

  /** @private */
  async storeDeltaUpdate(deltaUpdate) {
    const historyKey = `${deltaUpdate.entityType}:${deltaUpdate.entityId}`;
    let history = this.deltaHistory.get(historyKey) || [];

    // Add new delta
    history.push(deltaUpdate);

    // Keep only recent history
    if (history.length > this.config.deltaHistorySize) {
      history = history.slice(-this.config.deltaHistorySize);
    }

    this.deltaHistory.set(historyKey, history);
  }

  /** @private */
  async loadSyncVersions() {
    // Load from localStorage or similar
    try {
      const stored = localStorage.getItem('vakamova_sync_versions');
      if (stored) {
        this.entitySyncVersions = new Map(JSON.parse(stored));
      }
    } catch (error) {
      console.warn('Failed to load sync versions:', error);
    }
  }

  /** @private */
  async saveSyncVersions() {
    try {
      const serialized = JSON.stringify(Array.from(this.entitySyncVersions.entries()));
      localStorage.setItem('vakamova_sync_versions', serialized);
    } catch (error) {
      console.warn('Failed to save sync versions:', error);
    }
  }

  /** @private */
  async waitForPendingSync(syncKey) {
    return new Promise((resolve, reject) => {
      const checkInterval = setInterval(() => {
        if (!this.syncingEntities.has(syncKey)) {
          clearInterval(checkInterval);
          const result = this.pendingSyncs.get(syncKey);
          if (result) {
            resolve(result);
          } else {
            reject(new Error('Sync completed without result'));
          }
        }
      }, 100);
    });
  }

  /** @private */
  async handleNetworkStatus(eventType, eventData) {
    const wasOnline = this.isOnline;
    this.isOnline = eventData.isOnline;

    if (!wasOnline && this.isOnline && this.config.autoSyncOnOnline) {
      await this.emitEvent('NETWORK_RESTORED');
      // Small delay before syncing to ensure stable connection
      setTimeout(() => this.syncAll({ background: true }), 2000);
    }
  }

  /** @private */
  async handleStateChange(eventType, eventData) {
    // Check if state change is syncable
    if (eventData.entityType && this.config.autoSyncOnOnline && this.isOnline) {
      // Debounce sync to avoid too many requests
      clearTimeout(this.stateChangeDebounce);
      this.stateChangeDebounce = setTimeout(() => {
        this.syncEntity(eventData.entityType, eventData.entityId, {
          background: true,
          priority: 1
        });
      }, 1000);
    }
  }

  /** @private */
  async emitEvent(eventType, data = null, error = null) {
    const event = {
      type: eventType,
      data,
      error,
      timestamp: Date.now(),
      isOnline: this.isOnline,
      isSyncing: this.isSyncing
    };

    await this.eventBus.publish(`sync.${eventType.toLowerCase()}`, event);
  }
}

// ============================================
// SYNC STRATEGIES (OCP: Extensible)
// ============================================

/**
 * Last-Write-Wins Sync Strategy
 */
class LastWriteWinsStrategy extends SyncStrategy {
  constructor() {
    super();
    this.supportedTypes = ['settings', 'user_preferences'];
  }

  async sync(local, remote, context) {
    const localVersion = local.syncVersion || 0;
    const remoteVersion = remote.syncVersion || 0;

    if (remoteVersion > localVersion) {
      // Remote is newer, apply remote changes
      const success = local.applyRemoteChanges(remote.data);
      if (success) {
        local.setSyncVersion(remoteVersion);
        return {
          success: true,
          status: 'SYNCED',
          merged: {
            ...remote.data,
            syncVersion: remoteVersion,
            fromVersion: localVersion,
            toVersion: remoteVersion,
            changes: remote.data
          }
        };
      }
    } else if (localVersion > remoteVersion) {
      // Local is newer, return local changes to push to server
      return {
        success: false,
        status: 'CONFLICT',
        localChanges: local.getChangesSinceLastSync(),
        remoteChanges: remote.data,
        retryable: true
      };
    } else {
      // Versions match, no sync needed
      return {
        success: true,
        status: 'SYNCED',
        merged: local.serializeForSync()
      };
    }

    return {
      success: false,
      status: 'ERROR',
      error: new Error('Sync failed'),
      retryable: true
    };
  }
}

/**
 * Merge Sync Strategy (for collaborative data)
 */
class MergeSyncStrategy extends SyncStrategy {
  constructor() {
    super();
    this.supportedTypes = ['lesson_progress', 'quiz_results'];
  }

  async sync(local, remote, context) {
    const localChanges = local.getChangesSinceLastSync() || {};
    const remoteChanges = remote.data || {};

    // Simple merge logic - in production would be more sophisticated
    const merged = this.mergeChanges(localChanges, remoteChanges);

    if (this.hasConflict(localChanges, remoteChanges)) {
      return {
        success: false,
        status: 'CONFLICT',
        localChanges,
        remoteChanges,
        retryable: true
      };
    }

    // Apply merged changes
    const success = local.applyRemoteChanges(merged);
    if (success) {
      const newVersion = Date.now();
      local.setSyncVersion(newVersion);

      return {
        success: true,
        status: 'SYNCED',
        merged: {
          ...merged,
          syncVersion: newVersion,
          fromVersion: Math.max(local.syncVersion, remote.syncVersion),
          toVersion: newVersion,
          changes: merged
        }
      };
    }

    return {
      success: false,
      status: 'ERROR',
      error: new Error('Failed to apply merged changes'),
      retryable: true
    };
  }

  /** @private */
  mergeChanges(local, remote) {
    // Simple deep merge
    const merged = { ...local };
    
    for (const [key, remoteValue] of Object.entries(remote)) {
      if (merged[key] === undefined) {
        merged[key] = remoteValue;
      } else if (typeof remoteValue === 'object' && remoteValue !== null) {
        merged[key] = this.mergeChanges(merged[key] || {}, remoteValue);
      } else if (remoteValue !== merged[key]) {
        // Conflict - keep both? This is where strategy matters
        merged[`${key}_remote`] = remoteValue;
      }
    }

    return merged;
  }

  /** @private */
  hasConflict(local, remote) {
    // Check for direct conflicts in scalar values
    for (const [key, localValue] of Object.entries(local)) {
      if (remote[key] !== undefined && 
          remote[key] !== localValue &&
          typeof localValue !== 'object') {
        return true;
      }
    }
    return false;
  }
}

// ============================================
// CONFLICT RESOLVERS (OCP: Extensible)
// ============================================

/**
 * User Preference Conflict Resolver (local wins)
 */
class UserPreferenceConflictResolver extends ConflictResolver {
  constructor() {
    super();
    this.supportedConflictTypes = ['user_preferences', 'settings'];
  }

  async resolve(localChanges, remoteChanges, context) {
    // For user preferences, local usually wins
    return {
      resolution: 'LOCAL_WINS',
      resolvedData: localChanges,
      notifyUser: false
    };
  }
}

/**
 * Lesson Progress Conflict Resolver (merge with notification)
 */
class LessonProgressConflictResolver extends ConflictResolver {
  constructor() {
    super();
    this.supportedConflictTypes = ['lesson_progress', 'quiz_results'];
  }

  async resolve(localChanges, remoteChanges, context) {
    // For progress, try to merge intelligently
    const resolved = this.mergeProgress(localChanges, remoteChanges);
    
    return {
      resolution: 'MERGED',
      resolvedData: resolved,
      notifyUser: true // Notify user that progress was merged
    };
  }

  /** @private */
  mergeProgress(local, remote) {
    // Merge progress by taking maximum values
    const merged = { ...local };
    
    if (remote.progressPercentage !== undefined) {
      merged.progressPercentage = Math.max(
        local.progressPercentage || 0,
        remote.progressPercentage
      );
    }
    
    if (remote.completedLessons) {
      const localCompleted = new Set(local.completedLessons || []);
      const remoteCompleted = new Set(remote.completedLessons);
      merged.completedLessons = Array.from(
        new Set([...localCompleted, ...remoteCompleted])
      );
    }
    
    return merged;
  }
}

// ============================================
// FACTORY FUNCTIONS
// ============================================

/**
 * Create real-time sync manager
 * @param {Object} dependencies
 * @param {EventBus} dependencies.eventBus
 * @param {StateManager} dependencies.stateManager
 * @param {OfflineQueue} dependencies.offlineQueue
 * @param {SyncConfig} config
 * @returns {RealTimeSync}
 */
export function createRealTimeSync(dependencies, config = {}) {
  const syncManager = new RealTimeSync(dependencies, config);
  
  // Register default strategies
  syncManager.registerSyncStrategy(new LastWriteWinsStrategy());
  syncManager.registerSyncStrategy(new MergeSyncStrategy());
  
  // Register default conflict resolvers
  syncManager.registerConflictResolver(new UserPreferenceConflictResolver());
  syncManager.registerConflictResolver(new LessonProgressConflictResolver());
  
  return syncManager;
}

// ============================================
// DEFAULT CONFIGURATIONS
// ============================================

export const DEFAULT_SYNC_CONFIG = {
  syncInterval: 30000,
  maxRetries: 3,
  conflictRetryDelay: 10000,
  autoSyncOnOnline: true,
  deltaSyncEnabled: true,
  deltaHistorySize: 50,
  priorityEntities: ['user', 'lesson_progress', 'settings'],
  backgroundSync: true
};

// ============================================
// EXPORTS
// ============================================

export {
  RealTimeSync,
  Syncable,
  SyncStrategy,
  ConflictResolver,
  LastWriteWinsStrategy,
  MergeSyncStrategy,
  UserPreferenceConflictResolver,
  LessonProgressConflictResolver
};
