/**
 * core/offline-queue.js
 * Offline operation queue with automatic retry and synchronization
 * 
 * Principles Applied:
 * - SRP: Single responsibility - manages offline operations queue only
 * - OCP: Extensible operation types and processors without modifying core
 * - ISP: Small, focused interfaces for queue, storage, and processors
 * - DIP: Depends on abstractions (EventBus, Storage) not implementations
 * - DRY: Reusable operation processing and retry logic
 * - KISS: Simple queue management with clear states
 * - Testable: Pure operation processors and mockable dependencies
 */

// ============================================
// INTERFACES (Abstractions)
// ============================================

/**
 * @interface Operation
 * Contract for queueable operations
 */
class Operation {
  /**
   * Unique operation identifier
   * @returns {string}
   */
  get id() {
    throw new Error('id getter must be implemented');
  }

  /**
   * Operation type for routing to processor
   * @returns {string}
   */
  get type() {
    throw new Error('type getter must be implemented');
  }

  /**
   * Operation priority (higher = processed first)
   * @returns {number}
   */
  get priority() {
    throw new Error('priority getter must be implemented');
  }

  /**
   * Operation data payload
   * @returns {Object}
   */
  get data() {
    throw new Error('data getter must be implemented');
  }

  /**
   * Maximum retry attempts
   * @returns {number}
   */
  get maxRetries() {
    throw new Error('maxRetries getter must be implemented');
  }

  /**
   * Current retry count
   * @returns {number}
   */
  get retryCount() {
    throw new Error('retryCount getter must be implemented');
  }

  /**
   * Increment retry count
   */
  incrementRetryCount() {
    throw new Error('incrementRetryCount() must be implemented');
  }

  /**
   * Check if operation can be retried
   * @returns {boolean}
   */
  canRetry() {
    throw new Error('canRetry() must be implemented');
  }

  /**
   * Get delay before next retry (exponential backoff)
   * @returns {number}
   */
  getRetryDelay() {
    throw new Error('getRetryDelay() must be implemented');
  }

  /**
   * Serialize operation for storage
   * @returns {Object}
   */
  serialize() {
    throw new Error('serialize() must be implemented');
  }
}

/**
 * @interface OperationProcessor
 * Contract for processing specific operation types
 */
class OperationProcessor {
  /**
   * Check if processor can handle operation type
   * @param {string} operationType
   * @returns {boolean}
   */
  canProcess(operationType) {
    throw new Error('canProcess() must be implemented');
  }

  /**
   * Process the operation
   * @param {Operation} operation
   * @returns {Promise<ProcessingResult>}
   */
  async process(operation) {
    throw new Error('process() must be implemented');
  }

  /**
   * Compensate/rollback if processing fails permanently
   * @param {Operation} operation
   * @returns {Promise<void>}
   */
  async compensate(operation) {
    throw new Error('compensate() must be implemented');
  }
}

/**
 * @interface QueueStorage
 * Contract for persistent queue storage
 */
class QueueStorage {
  /**
   * Save operation to storage
   * @param {Object} serializedOperation
   * @returns {Promise<void>}
   */
  async save(serializedOperation) {
    throw new Error('save() must be implemented');
  }

  /**
   * Load all operations from storage
   * @returns {Promise<Object[]>}
   */
  async loadAll() {
    throw new Error('loadAll() must be implemented');
  }

  /**
   * Update operation in storage
   * @param {string} operationId
   * @param {Object} updates
   * @returns {Promise<void>}
   */
  async update(operationId, updates) {
    throw new Error('update() must be implemented');
  }

  /**
   * Remove operation from storage
   * @param {string} operationId
   * @returns {Promise<void>}
   */
  async remove(operationId) {
    throw new Error('remove() must be implemented');
  }

  /**
   * Clear all operations from storage
   * @returns {Promise<void>}
   */
  async clear() {
    throw new Error('clear() must be implemented');
  }
}

// ============================================
// TYPES
// ============================================

/**
 * @typedef {Object} ProcessingResult
 * @property {boolean} success - Whether processing succeeded
 * @property {*} [result] - Processing result if successful
 * @property {Error} [error] - Error if processing failed
 * @property {boolean} [retryable=true] - Whether operation can be retried
 */

/**
 * @typedef {Object} QueueConfig
 * @property {number} maxQueueSize - Maximum operations in queue
 * @property {number} processInterval - Interval between processing attempts (ms)
 * @property {number} maxProcessingAttempts - Maximum concurrent processing attempts
 * @property {boolean} autoStart - Start processing automatically when online
 * @property {boolean} persistOperations - Persist operations to storage
 */

/**
 * @typedef {('PENDING'|'PROCESSING'|'COMPLETED'|'FAILED'|'RETRYING')} OperationState
 */

// ============================================
// BASE OPERATION IMPLEMENTATION
// ============================================

/**
 * Base operation implementation
 */
class BaseOperation extends Operation {
  /**
   * @constructor
   * @param {Object} params
   * @param {string} params.id - Operation ID
   * @param {string} params.type - Operation type
   * @param {Object} params.data - Operation data
   * @param {number} [params.priority=0] - Operation priority
   * @param {number} [params.maxRetries=3] - Maximum retry attempts
   * @param {number} [params.retryCount=0] - Current retry count
   * @param {OperationState} [params.state='PENDING'] - Operation state
   * @param {number} [params.createdAt] - Creation timestamp
   */
  constructor({
    id,
    type,
    data,
    priority = 0,
    maxRetries = 3,
    retryCount = 0,
    state = 'PENDING',
    createdAt = Date.now()
  }) {
    super();
    this._id = id;
    this._type = type;
    this._data = data;
    this._priority = priority;
    this._maxRetries = maxRetries;
    this._retryCount = retryCount;
    this._state = state;
    this._createdAt = createdAt;
    this._updatedAt = createdAt;
  }

  get id() { return this._id; }
  get type() { return this._type; }
  get data() { return this._data; }
  get priority() { return this._priority; }
  get maxRetries() { return this._maxRetries; }
  get retryCount() { return this._retryCount; }
  get state() { return this._state; }
  get createdAt() { return this._createdAt; }
  get updatedAt() { return this._updatedAt; }

  incrementRetryCount() {
    this._retryCount++;
    this._updatedAt = Date.now();
  }

  canRetry() {
    return this._retryCount < this._maxRetries;
  }

  getRetryDelay() {
    // Exponential backoff: 1s, 2s, 4s, 8s, ...
    return Math.min(1000 * Math.pow(2, this._retryCount), 30000); // Max 30 seconds
  }

  setState(state) {
    this._state = state;
    this._updatedAt = Date.now();
  }

  serialize() {
    return {
      id: this._id,
      type: this._type,
      data: this._data,
      priority: this._priority,
      maxRetries: this._maxRetries,
      retryCount: this._retryCount,
      state: this._state,
      createdAt: this._createdAt,
      updatedAt: this._updatedAt
    };
  }

  /**
   * Deserialize from stored data
   * @param {Object} data
   * @returns {BaseOperation}
   */
  static deserialize(data) {
    return new BaseOperation(data);
  }
}

// ============================================
// OFFLINE QUEUE MANAGER
// ============================================

/**
 * Offline Queue Manager
 */
class OfflineQueue {
  /**
   * @constructor
   * @param {Object} dependencies
   * @param {EventBus} dependencies.eventBus - Event bus for communication
   * @param {QueueStorage} dependencies.storage - Queue storage
   * @param {QueueConfig} [config] - Queue configuration
   */
  constructor(dependencies, config = {}) {
    /** @private @type {EventBus} */
    this.eventBus = dependencies.eventBus;

    /** @private @type {QueueStorage} */
    this.storage = dependencies.storage;

    /** @private @type {QueueConfig} */
    this.config = {
      maxQueueSize: config.maxQueueSize || 100,
      processInterval: config.processInterval || 5000,
      maxProcessingAttempts: config.maxProcessingAttempts || 3,
      autoStart: config.autoStart !== false,
      persistOperations: config.persistOperations !== false,
      ...config
    };

    /** @private @type {Map<string, OperationProcessor>} */
    this.processors = new Map();

    /** @private @type {BaseOperation[]} */
    this.queue = [];

    /** @private @type {Set<string>} */
    this.processingIds = new Set();

    /** @private */
    this.isOnline = false;

    /** @private */
    this.processingTimer = null;

    /** @private */
    this.isProcessing = false;

    // Subscribe to network events
    this.eventBus.subscribe('network.status', this.handleNetworkStatus.bind(this));
  }

  // ============================================
  // PUBLIC API
  // ============================================

  /**
   * Initialize queue and load persisted operations
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this.config.persistOperations) {
      await this.loadPersistedOperations();
    }

    if (this.config.autoStart) {
      this.startProcessing();
    }

    await this.emitEvent('QUEUE_INITIALIZED', {
      queueSize: this.queue.length
    });
  }

  /**
   * Register operation processor
   * @param {OperationProcessor} processor
   */
  registerProcessor(processor) {
    // Get supported operation types from processor
    if (processor.supportedTypes) {
      processor.supportedTypes.forEach(type => {
        this.processors.set(type, processor);
      });
    } else {
      // Assume processor can handle based on canProcess method
      this.processors.set('*', processor);
    }
  }

  /**
   * Enqueue new operation
   * @param {string} type - Operation type
   * @param {Object} data - Operation data
   * @param {Object} [options] - Enqueue options
   * @returns {Promise<BaseOperation>}
   */
  async enqueue(type, data, options = {}) {
    // Check queue size limit
    if (this.queue.length >= this.config.maxQueueSize) {
      throw new Error(`Queue is full (max: ${this.config.maxQueueSize})`);
    }

    const operation = new BaseOperation({
      id: this.generateOperationId(type),
      type,
      data,
      priority: options.priority || 0,
      maxRetries: options.maxRetries || 3
    });

    // Add to memory queue
    this.queue.push(operation);
    this.sortQueueByPriority();

    // Persist if enabled
    if (this.config.persistOperations) {
      await this.storage.save(operation.serialize());
    }

    await this.emitEvent('OPERATION_ENQUEUED', {
      operationId: operation.id,
      type: operation.type,
      queueSize: this.queue.length
    });

    // Auto-process if online
    if (this.isOnline && this.config.autoStart) {
      this.processQueue();
    }

    return operation;
  }

  /**
   * Remove operation from queue
   * @param {string} operationId
   * @returns {Promise<boolean>}
   */
  async remove(operationId) {
    const index = this.queue.findIndex(op => op.id === operationId);
    
    if (index === -1) {
      return false;
    }

    const operation = this.queue[index];
    this.queue.splice(index, 1);

    // Remove from storage
    if (this.config.persistOperations) {
      await this.storage.remove(operationId);
    }

    await this.emitEvent('OPERATION_REMOVED', {
      operationId,
      type: operation.type
    });

    return true;
  }

  /**
   * Start automatic queue processing
   */
  startProcessing() {
    if (this.processingTimer) {
      return;
    }

    this.processingTimer = setInterval(() => {
      this.processQueue();
    }, this.config.processInterval);

    await this.emitEvent('PROCESSING_STARTED');
  }

  /**
   * Stop automatic queue processing
   */
  stopProcessing() {
    if (this.processingTimer) {
      clearInterval(this.processingTimer);
      this.processingTimer = null;
    }

    await this.emitEvent('PROCESSING_STOPPED');
  }

  /**
   * Process all pending operations
   * @returns {Promise<void>}
   */
  async processQueue() {
    if (!this.isOnline || this.isProcessing) {
      return;
    }

    this.isProcessing = true;

    try {
      // Get pending operations (not already being processed)
      const pendingOperations = this.queue
        .filter(op => op.state === 'PENDING' || op.state === 'RETRYING')
        .filter(op => !this.processingIds.has(op.id))
        .slice(0, this.config.maxProcessingAttempts);

      if (pendingOperations.length === 0) {
        return;
      }

      // Process operations concurrently
      const processingPromises = pendingOperations.map(op => 
        this.processOperation(op)
      );

      await Promise.allSettled(processingPromises);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Clear all operations from queue
   * @returns {Promise<void>}
   */
  async clear() {
    this.queue = [];
    this.processingIds.clear();

    if (this.config.persistOperations) {
      await this.storage.clear();
    }

    await this.emitEvent('QUEUE_CLEARED');
  }

  /**
   * Get queue statistics
   * @returns {Object}
   */
  getStats() {
    const stats = {
      total: this.queue.length,
      byState: {},
      byType: {}
    };

    this.queue.forEach(op => {
      // Count by state
      stats.byState[op.state] = (stats.byState[op.state] || 0) + 1;
      
      // Count by type
      stats.byType[op.type] = (stats.byType[op.type] || 0) + 1;
    });

    return stats;
  }

  // ============================================
  // PRIVATE METHODS
  // ============================================

  /** @private */
  async loadPersistedOperations() {
    try {
      const storedOperations = await this.storage.loadAll();
      
      this.queue = storedOperations
        .map(data => BaseOperation.deserialize(data))
        .sort((a, b) => b.priority - a.priority);

      await this.emitEvent('OPERATIONS_LOADED', {
        count: this.queue.length
      });
    } catch (error) {
      console.error('Failed to load persisted operations:', error);
      await this.emitEvent('OPERATIONS_LOAD_FAILED', null, error);
    }
  }

  /** @private */
  async processOperation(operation) {
    // Mark as processing
    operation.setState('PROCESSING');
    this.processingIds.add(operation.id);

    if (this.config.persistOperations) {
      await this.storage.update(operation.id, { state: 'PROCESSING' });
    }

    try {
      // Find processor for this operation type
      const processor = this.findProcessor(operation.type);
      
      if (!processor) {
        throw new Error(`No processor found for operation type: ${operation.type}`);
      }

      await this.emitEvent('OPERATION_PROCESSING_STARTED', {
        operationId: operation.id,
        type: operation.type,
        retryCount: operation.retryCount
      });

      // Process the operation
      const result = await processor.process(operation);

      if (result.success) {
        await this.handleOperationSuccess(operation, result);
      } else {
        await this.handleOperationFailure(operation, result);
      }
    } catch (error) {
      await this.handleOperationFailure(operation, {
        success: false,
        error,
        retryable: true
      });
    } finally {
      this.processingIds.delete(operation.id);
    }
  }

  /** @private */
  async handleOperationSuccess(operation, result) {
    operation.setState('COMPLETED');
    
    if (this.config.persistOperations) {
      await this.storage.update(operation.id, {
        state: 'COMPLETED',
        updatedAt: operation.updatedAt
      });
    }

    // Remove from memory queue after short delay
    setTimeout(() => {
      const index = this.queue.findIndex(op => op.id === operation.id);
      if (index !== -1) {
        this.queue.splice(index, 1);
      }
    }, 1000);

    await this.emitEvent('OPERATION_COMPLETED', {
      operationId: operation.id,
      type: operation.type,
      result: result.result
    });
  }

  /** @private */
  async handleOperationFailure(operation, result) {
    operation.incrementRetryCount();

    if (operation.canRetry() && result.retryable !== false) {
      // Schedule retry
      operation.setState('RETRYING');
      
      const retryDelay = operation.getRetryDelay();
      
      setTimeout(() => {
        if (this.queue.find(op => op.id === operation.id)) {
          operation.setState('PENDING');
          if (this.isOnline) {
            this.processQueue();
          }
        }
      }, retryDelay);

      await this.emitEvent('OPERATION_RETRY_SCHEDULED', {
        operationId: operation.id,
        type: operation.type,
        retryCount: operation.retryCount,
        retryDelay,
        error: result.error?.message
      });
    } else {
      // Permanent failure
      operation.setState('FAILED');
      
      await this.emitEvent('OPERATION_FAILED', {
        operationId: operation.id,
        type: operation.type,
        retryCount: operation.retryCount,
        error: result.error?.message,
        permanent: true
      });

      // Optionally execute compensation
      try {
        const processor = this.findProcessor(operation.type);
        if (processor && processor.compensate) {
          await processor.compensate(operation);
        }
      } catch (compensationError) {
        console.error('Compensation failed:', compensationError);
      }
    }

    if (this.config.persistOperations) {
      await this.storage.update(operation.id, {
        state: operation.state,
        retryCount: operation.retryCount,
        updatedAt: operation.updatedAt
      });
    }
  }

  /** @private */
  findProcessor(operationType) {
    // Try exact match first
    if (this.processors.has(operationType)) {
      return this.processors.get(operationType);
    }

    // Try wildcard processor
    if (this.processors.has('*')) {
      const wildcardProcessor = this.processors.get('*');
      if (wildcardProcessor.canProcess(operationType)) {
        return wildcardProcessor;
      }
    }

    // Try processors with canProcess method
    for (const processor of this.processors.values()) {
      if (processor.canProcess && processor.canProcess(operationType)) {
        return processor;
      }
    }

    return null;
  }

  /** @private */
  sortQueueByPriority() {
    this.queue.sort((a, b) => {
      // First by priority (higher first)
      if (b.priority !== a.priority) {
        return b.priority - a.priority;
      }
      
      // Then by creation time (older first)
      return a.createdAt - b.createdAt;
    });
  }

  /** @private */
  generateOperationId(type) {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substr(2, 9);
    return `${type}_${timestamp}_${random}`;
  }

  /** @private */
  async handleNetworkStatus(eventType, eventData) {
    const wasOnline = this.isOnline;
    this.isOnline = eventData.isOnline;

    if (!wasOnline && this.isOnline) {
      await this.emitEvent('BACK_ONLINE');
      this.processQueue();
    } else if (wasOnline && !this.isOnline) {
      await this.emitEvent('WENT_OFFLINE');
      this.stopProcessing();
    }
  }

  /** @private */
  async emitEvent(eventType, data = null, error = null) {
    const event = {
      type: eventType,
      data,
      error,
      timestamp: Date.now(),
      queueStats: this.getStats()
    };

    await this.eventBus.publish(`offline_queue.${eventType.toLowerCase()}`, event);
  }
}

// ============================================
// STORAGE IMPLEMENTATIONS
// ============================================

/**
 * Local Storage implementation for queue
 */
class LocalQueueStorage extends QueueStorage {
  constructor(storageKey = 'vakamova_offline_queue') {
    super();
    this.storageKey = storageKey;
  }

  async save(serializedOperation) {
    const operations = await this.loadAll();
    operations.push(serializedOperation);
    localStorage.setItem(this.storageKey, JSON.stringify(operations));
  }

  async loadAll() {
    const data = localStorage.getItem(this.storageKey);
    return data ? JSON.parse(data) : [];
  }

  async update(operationId, updates) {
    const operations = await this.loadAll();
    const index = operations.findIndex(op => op.id === operationId);
    
    if (index !== -1) {
      operations[index] = { ...operations[index], ...updates };
      localStorage.setItem(this.storageKey, JSON.stringify(operations));
    }
  }

  async remove(operationId) {
    const operations = await this.loadAll();
    const filtered = operations.filter(op => op.id !== operationId);
    localStorage.setItem(this.storageKey, JSON.stringify(filtered));
  }

  async clear() {
    localStorage.removeItem(this.storageKey);
  }
}

// ============================================
// PROCESSOR EXAMPLES (OCP: Extensible)
// ============================================

/**
 * Sync Lesson Progress Processor
 */
class SyncLessonProgressProcessor extends OperationProcessor {
  constructor(apiClient) {
    super();
    this.apiClient = apiClient;
    this.supportedTypes = ['SYNC_LESSON_PROGRESS', 'SYNC_QUIZ_RESULT'];
  }

  async process(operation) {
    try {
      let result;
      
      switch (operation.type) {
        case 'SYNC_LESSON_PROGRESS':
          result = await this.apiClient.syncLessonProgress(operation.data);
          break;
        case 'SYNC_QUIZ_RESULT':
          result = await this.apiClient.syncQuizResult(operation.data);
          break;
        default:
          throw new Error(`Unsupported operation type: ${operation.type}`);
      }

      return {
        success: true,
        result
      };
    } catch (error) {
      return {
        success: false,
        error,
        retryable: this.isRetryableError(error)
      };
    }
  }

  async compensate(operation) {
    // If sync fails permanently, we might want to show a notification to the user
    console.warn(`Failed to sync ${operation.type}:`, operation.data);
    
    // Could emit event to show notification to user
    // this.eventBus.publish('sync.failed', { operation });
  }

  isRetryableError(error) {
    // Network errors are retryable, validation errors are not
    return error.message.includes('network') || 
           error.message.includes('timeout') ||
           error.code === 'ECONNABORTED';
  }
}

/**
 * User Data Sync Processor
 */
class UserDataSyncProcessor extends OperationProcessor {
  constructor(apiClient) {
    super();
    this.apiClient = apiClient;
  }

  canProcess(operationType) {
    return operationType.startsWith('SYNC_USER_');
  }

  async process(operation) {
    try {
      const result = await this.apiClient.updateUserData(operation.data);
      return {
        success: true,
        result
      };
    } catch (error) {
      return {
        success: false,
        error,
        retryable: error.status !== 400 // Don't retry bad requests
      };
    }
  }
}

// ============================================
// FACTORY FUNCTIONS
// ============================================

/**
 * Create offline queue for web environment
 * @param {EventBus} eventBus
 * @param {QueueConfig} config
 * @returns {OfflineQueue}
 */
export function createWebOfflineQueue(eventBus, config = {}) {
  const dependencies = {
    eventBus,
    storage: new LocalQueueStorage()
  };

  return new OfflineQueue(dependencies, config);
}

// ============================================
// DEFAULT CONFIGURATIONS
// ============================================

export const DEFAULT_QUEUE_CONFIG = {
  maxQueueSize: 100,
  processInterval: 5000,
  maxProcessingAttempts: 3,
  autoStart: true,
  persistOperations: true,
  retryBackoffFactor: 2,
  maxRetryDelay: 30000
};

// ============================================
// EXPORTS
// ============================================

export {
  OfflineQueue,
  Operation,
  OperationProcessor,
  QueueStorage,
  BaseOperation,
  LocalQueueStorage,
  SyncLessonProgressProcessor,
  UserDataSyncProcessor
};
