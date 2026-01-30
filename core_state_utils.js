
/**
 * State Utilities Module - Advanced state manipulation and validation
 * Contract: STATE_UTILS_CONTRACT
 */

export const STATE_UTILS_CONTRACT = {
    name: 'state-utils',
    version: '2.0.0',
    dependencies: ['eventBus', 'config', 'logger'],
    init: 'function',
    deepMerge: 'function',
    deepClone: 'function',
    diff: 'function',
    patch: 'function',
    validateSchema: 'function',
    normalize: 'function',
    denormalize: 'function',
    methods: [
        'createSelector',
        'createMemoizer',
        'throttle',
        'debounce',
        'retry',
        'batchUpdates',
        'createPipeline',
        'createTransformer'
    ]
};

export class StateUtils {
    #eventBus;
    #config;
    #logger;
    #schemaRegistry = new Map();
    #selectorCache = new WeakMap();
    #memoizerCache = new Map();
    #transformers = new Map();
    #pipelines = new Map();
    #performanceCache = new Map();
    #validationRules = {
        string: (value) => typeof value === 'string',
        number: (value) => typeof value === 'number' && !isNaN(value),
        boolean: (value) => typeof value === 'boolean',
        array: (value) => Array.isArray(value),
        object: (value) => value && typeof value === 'object' && !Array.isArray(value),
        date: (value) => value instanceof Date,
        email: (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
        url: (value) => {
            try {
                new URL(value);
                return true;
            } catch {
                return false;
            }
        },
        uuid: (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value),
        phone: (value) => /^[\+]?[1-9][\d]{0,15}$/.test(value)
    };

    constructor({ eventBus, config, logger }) {
        if (!eventBus || !config || !logger) {
            throw new Error('Missing required dependencies: eventBus, config, logger');
        }
        
        this.#eventBus = eventBus;
        this.#config = config.get('utils') || {};
        this.#logger = logger;
        
        this.#setupEventListeners();
        this.#loadBuiltinSchemas();
        this.#logger.info('StateUtils initialized', { version: '2.0.0' });
    }

    init() {
        this.#eventBus.emit('utils:initialized', {
            schemas: this.#schemaRegistry.size,
            validators: Object.keys(this.#validationRules).length
        });
        return this;
    }

    deepMerge(target, ...sources) {
        const startTime = performance.now();
        
        if (!target || typeof target !== 'object') {
            throw new Error('Target must be an object');
        }

        const result = this.deepClone(target);
        let totalMerged = 0;
        let conflicts = [];

        for (const source of sources) {
            if (!source || typeof source !== 'object') continue;
            
            const mergeResult = this.#performDeepMerge(result, source, '', conflicts);
            Object.assign(result, mergeResult.result);
            totalMerged += mergeResult.mergedCount;
        }

        const endTime = performance.now();
        
        this.#eventBus.emit('utils:deepMergeCompleted', {
            duration: endTime - startTime,
            totalMerged,
            conflicts,
            resultSize: JSON.stringify(result).length
        });

        return result;
    }

    deepClone(obj, options = {}) {
        const cache = new WeakMap();
        const startTime = performance.now();
        
        const clone = this.#performDeepClone(obj, cache, options);
        
        const endTime = performance.now();
        
        if (options.trackPerformance) {
            this.#performanceCache.set('lastClone', {
                duration: endTime - startTime,
                originalType: typeof obj,
                size: JSON.stringify(obj).length
            });
        }

        this.#eventBus.emit('utils:deepCloneCompleted', {
            duration: endTime - startTime,
            type: obj?.constructor?.name || typeof obj
        });

        return clone;
    }

    diff(prev, next, options = {}) {
        const startTime = performance.now();
        
        if (prev === next) {
            return { changed: false, patches: [] };
        }

        const patches = this.#calculateDiff(prev, next, '', options);
        const endTime = performance.now();

        this.#eventBus.emit('utils:diffCalculated', {
            duration: endTime - startTime,
            patchesCount: patches.length,
            changed: patches.length > 0
        });

        return {
            changed: patches.length > 0,
            patches,
            summary: {
                additions: patches.filter(p => p.op === 'add').length,
                removals: patches.filter(p => p.op === 'remove').length,
                modifications: patches.filter(p => p.op === 'replace').length
            }
        };
    }

    patch(target, patches, options = {}) {
        const startTime = performance.now();
        const result = this.deepClone(target);
        const applied = [];
        const failed = [];

        for (const patch of patches) {
            try {
                this.#applyPatch(result, patch, options);
                applied.push(patch);
            } catch (error) {
                failed.push({ patch, error: error.message });
                
                if (options.failFast) {
                    throw new Error(`Patch application failed: ${error.message}`);
                }
            }
        }

        const endTime = performance.now();

        this.#eventBus.emit('utils:patchApplied', {
            duration: endTime - startTime,
            applied: applied.length,
            failed: failed.length,
            successRate: patches.length > 0 ? (applied.length / patches.length) * 100 : 100
        });

        if (failed.length > 0 && !options.silent) {
            this.#logger.warn('Some patches failed to apply', { failed });
        }

        return { result, applied, failed };
    }

    validateSchema(data, schemaName, options = {}) {
        const schema = this.#schemaRegistry.get(schemaName);
        if (!schema) {
            throw new Error(`Schema "${schemaName}" not found`);
        }

        const startTime = performance.now();
        const errors = [];
        const warnings = [];
        const path = options.path || '';

        this.#validateAgainstSchema(data, schema, path, errors, warnings, options);

        const endTime = performance.now();
        const isValid = errors.length === 0;

        this.#eventBus.emit('utils:schemaValidated', {
            schemaName,
            duration: endTime - startTime,
            isValid,
            errors: errors.length,
            warnings: warnings.length,
            strict: options.strict || false
        });

        if (!isValid && options.throwOnError) {
            throw new Error(`Schema validation failed:\n${errors.map(e => `  ${e.path}: ${e.message}`).join('\n')}`);
        }

        return {
            valid: isValid,
            errors,
            warnings,
            metadata: {
                schema: schemaName,
                validatedAt: Date.now(),
                dataType: typeof data
            }
        };
    }

    normalize(data, schemaName) {
        const schema = this.#schemaRegistry.get(schemaName);
        if (!schema) {
            throw new Error(`Schema "${schemaName}" not found`);
        }

        const startTime = performance.now();
        const normalized = this.#performNormalization(data, schema);
        const endTime = performance.now();

        this.#eventBus.emit('utils:normalized', {
            schemaName,
            duration: endTime - startTime,
            originalSize: JSON.stringify(data).length,
            normalizedSize: JSON.stringify(normalized).length,
            reduction: ((JSON.stringify(data).length - JSON.stringify(normalized).length) / JSON.stringify(data).length) * 100
        });

        return normalized;
    }

    denormalize(normalizedData, schemaName) {
        const schema = this.#schemaRegistry.get(schemaName);
        if (!schema) {
            throw new Error(`Schema "${schemaName}" not found`);
        }

        const startTime = performance.now();
        const denormalized = this.#performDenormalization(normalizedData, schema);
        const endTime = performance.now();

        this.#eventBus.emit('utils:denormalized', {
            schemaName,
            duration: endTime - startTime
        });

        return denormalized;
    }

    createSelector(selectorFn, options = {}) {
        const cache = new WeakMap();
        const memoizedSelector = (state, ...args) => {
            if (!options.disableCache && cache.has(state)) {
                const cached = cache.get(state);
                if (cached.args.every((arg, i) => Object.is(arg, args[i]))) {
                    this.#eventBus.emit('utils:selectorCacheHit', { selector: selectorFn.name || 'anonymous' });
                    return cached.result;
                }
            }

            const result = selectorFn(state, ...args);
            
            if (!options.disableCache) {
                cache.set(state, { result, args });
            }

            this.#eventBus.emit('utils:selectorComputed', {
                selector: selectorFn.name || 'anonymous',
                cached: cache.has(state)
            });

            return result;
        };

        memoizedSelector.clearCache = () => {
            this.#selectorCache.delete(selectorFn);
            cache.clear();
        };

        this.#selectorCache.set(selectorFn, memoizedSelector);
        return memoizedSelector;
    }

    createMemoizer(fn, options = {}) {
        const cacheKey = options.cacheKey || fn.name || 'anonymous';
        const maxSize = options.maxSize || 100;
        const ttl = options.ttl || 0; // 0 = no expiration
        
        const memoized = (...args) => {
            const key = this.#generateCacheKey(cacheKey, args);
            const cached = this.#memoizerCache.get(key);
            
            if (cached) {
                if (ttl > 0 && Date.now() - cached.timestamp > ttl) {
                    this.#memoizerCache.delete(key);
                } else {
                    this.#eventBus.emit('utils:memoizerCacheHit', { key, hits: cached.hits });
                    cached.hits++;
                    return cached.value;
                }
            }

            const value = fn(...args);
            this.#memoizerCache.set(key, {
                value,
                timestamp: Date.now(),
                hits: 1,
                args
            });

            this.#cleanupMemoizerCache(maxSize);
            
            this.#eventBus.emit('utils:memoizerComputed', { key, cacheSize: this.#memoizerCache.size });

            return value;
        };

        memoized.clear = () => this.#memoizerCache.clear();
        memoized.getCacheStats = () => ({
            size: this.#memoizerCache.size,
            hits: Array.from(this.#memoizerCache.values()).reduce((sum, item) => sum + item.hits, 0),
            oldest: Math.min(...Array.from(this.#memoizerCache.values()).map(item => item.timestamp))
        });

        return memoized;
    }

    throttle(fn, delay, options = {}) {
        let lastCall = 0;
        let timeoutId = null;
        let trailingCall = null;

        const throttled = (...args) => {
            const now = Date.now();
            const remaining = delay - (now - lastCall);

            if (remaining <= 0) {
                if (timeoutId) {
                    clearTimeout(timeoutId);
                    timeoutId = null;
                }
                lastCall = now;
                this.#eventBus.emit('utils:throttleExecuted', { delay, immediate: true });
                return fn(...args);
            }

            if (!timeoutId && options.trailing !== false) {
                timeoutId = setTimeout(() => {
                    lastCall = Date.now();
                    timeoutId = null;
                    if (trailingCall) {
                        const args = trailingCall;
                        trailingCall = null;
                        this.#eventBus.emit('utils:throttleExecuted', { delay, immediate: false });
                        fn(...args);
                    }
                }, remaining);
            }

            if (options.trailing !== false) {
                trailingCall = args;
            }

            return undefined;
        };

        throttled.cancel = () => {
            if (timeoutId) {
                clearTimeout(timeoutId);
                timeoutId = null;
                trailingCall = null;
            }
        };

        return throttled;
    }

    debounce(fn, delay, options = {}) {
        let timeoutId = null;
        let lastCallTime = 0;
        let maxWait = options.maxWait || 0;
        let maxWaitId = null;

        const debounced = (...args) => {
            const now = Date.now();
            const invoke = () => {
                clearTimeout(timeoutId);
                if (maxWaitId) clearTimeout(maxWaitId);
                timeoutId = null;
                maxWaitId = null;
                lastCallTime = now;
                this.#eventBus.emit('utils:debounceExecuted', { delay, immediate: false });
                return fn(...args);
            };

            if (timeoutId) {
                clearTimeout(timeoutId);
            }

            if (maxWait > 0 && !maxWaitId && now - lastCallTime >= maxWait) {
                return invoke();
            }

            timeoutId = setTimeout(invoke, delay);

            if (maxWait > 0 && !maxWaitId) {
                maxWaitId = setTimeout(() => {
                    if (timeoutId) {
                        invoke();
                    }
                }, maxWait);
            }

            if (options.immediate && !timeoutId) {
                return invoke();
            }
        };

        debounced.cancel = () => {
            if (timeoutId) clearTimeout(timeoutId);
            if (maxWaitId) clearTimeout(maxWaitId);
            timeoutId = null;
            maxWaitId = null;
        };

        debounced.flush = () => {
            if (timeoutId) {
                clearTimeout(timeoutId);
                timeoutId = null;
                lastCallTime = Date.now();
                this.#eventBus.emit('utils:debounceFlushed', { delay });
                return fn();
            }
        };

        return debounced;
    }

    async retry(fn, options = {}) {
        const maxAttempts = options.maxAttempts || 3;
        const delay = options.delay || 1000;
        const backoff = options.backoff || 2;
        const retryableErrors = options.retryableErrors || [];
        
        let lastError = null;
        let attempt = 0;

        while (attempt < maxAttempts) {
            try {
                attempt++;
                this.#eventBus.emit('utils:retryAttempt', { attempt, maxAttempts });
                
                const result = await fn();
                
                this.#eventBus.emit('utils:retrySuccess', {
                    attempt,
                    totalAttempts: attempt
                });
                
                return result;
            } catch (error) {
                lastError = error;
                
                const shouldRetry = retryableErrors.length === 0 || 
                    retryableErrors.some(pattern => 
                        error.message.includes(pattern) || 
                        error.name === pattern
                    );

                if (!shouldRetry || attempt >= maxAttempts) {
                    break;
                }

                const waitTime = delay * Math.pow(backoff, attempt - 1);
                this.#eventBus.emit('utils:retryWait', { attempt, waitTime });
                
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }
        }

        this.#eventBus.emit('utils:retryFailed', {
            attempts: attempt,
            lastError: lastError?.message
        });
        
        throw lastError || new Error('Retry failed');
    }

    batchUpdates(updateFn, options = {}) {
        const queue = [];
        let scheduled = false;
        const batchId = `batch-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        const scheduleUpdate = () => {
            if (!scheduled) {
                scheduled = true;
                
                if (options.defer) {
                    setTimeout(executeBatch, 0);
                } else {
                    requestAnimationFrame(executeBatch);
                }
            }
        };

        const executeBatch = () => {
            scheduled = false;
            
            if (queue.length === 0) return;

            const updates = [...queue];
            queue.length = 0;

            try {
                const result = updateFn(updates);
                this.#eventBus.emit('utils:batchExecuted', {
                    batchId,
                    updatesCount: updates.length,
                    success: true
                });
                return result;
            } catch (error) {
                this.#eventBus.emit('utils:batchFailed', {
                    batchId,
                    error: error.message
                });
                throw error;
            }
        };

        return (update) => {
            queue.push(update);
            scheduleUpdate();
            
            if (options.maxSize && queue.length >= options.maxSize) {
                executeBatch();
            }
        };
    }

    createPipeline(...transformers) {
        const pipelineId = `pipeline-${Date.now()}`;
        
        const pipeline = async (input, context = {}) => {
            let result = input;
            const startTime = performance.now();
            const steps = [];

            for (let i = 0; i < transformers.length; i++) {
                const transformer = transformers[i];
                const stepStart = performance.now();
                
                try {
                    result = await transformer(result, context);
                    const stepEnd = performance.now();
                    
                    steps.push({
                        index: i,
                        transformer: transformer.name || 'anonymous',
                        duration: stepEnd - stepStart,
                        success: true
                    });
                } catch (error) {
                    const stepEnd = performance.now();
                    
                    steps.push({
                        index: i,
                        transformer: transformer.name || 'anonymous',
                        duration: stepEnd - stepStart,
                        success: false,
                        error: error.message
                    });

                    this.#eventBus.emit('utils:pipelineStepFailed', {
                        pipelineId,
                        step: i,
                        error: error.message
                    });

                    if (context.failFast !== false) {
                        throw error;
                    }
                }
            }

            const endTime = performance.now();
            
            this.#eventBus.emit('utils:pipelineCompleted', {
                pipelineId,
                duration: endTime - startTime,
                steps: steps.length,
                successfulSteps: steps.filter(s => s.success).length,
                failedSteps: steps.filter(s => !s.success).length
            });

            return { result, steps, metadata: { pipelineId, totalTime: endTime - startTime } };
        };

        pipeline.id = pipelineId;
        pipeline.transformers = transformers;
        this.#pipelines.set(pipelineId, pipeline);
        
        return pipeline;
    }

    createTransformer(transformFn, options = {}) {
        const cache = options.cache ? new Map() : null;
        const name = options.name || transformFn.name || 'anonymous';
        
        const transformer = (input, context = {}) => {
            if (cache) {
                const cacheKey = this.#generateCacheKey(name, [input, context]);
                const cached = cache.get(cacheKey);
                
                if (cached) {
                    this.#eventBus.emit('utils:transformerCacheHit', { name });
                    return cached;
                }
            }

            const startTime = performance.now();
            const result = transformFn(input, context);
            const endTime = performance.now();

            if (cache && result !== undefined) {
                const cacheKey = this.#generateCacheKey(name, [input, context]);
                cache.set(cacheKey, result);
                
                if (options.maxCacheSize && cache.size > options.maxCacheSize) {
                    const firstKey = cache.keys().next().value;
                    cache.delete(firstKey);
                }
            }

            this.#eventBus.emit('utils:transformerExecuted', {
                name,
                duration: endTime - startTime,
                cached: cache !== null
            });

            return result;
        };

        transformer.name = name;
        transformer.clearCache = () => cache?.clear();
        transformer.getCacheStats = () => ({
            size: cache?.size || 0,
            hasCache: cache !== null
        });

        this.#transformers.set(name, transformer);
        return transformer;
    }

    registerSchema(name, schema) {
        if (!name || !schema) {
            throw new Error('Schema name and definition are required');
        }

        if (this.#schemaRegistry.has(name)) {
            this.#logger.warn(`Overwriting existing schema: ${name}`);
        }

        this.#schemaRegistry.set(name, schema);
        this.#eventBus.emit('utils:schemaRegistered', {
            name,
            fields: Object.keys(schema).length,
            timestamp: Date.now()
        });

        return true;
    }

    registerValidationRule(name, validatorFn) {
        if (!name || typeof validatorFn !== 'function') {
            throw new Error('Validation rule name and function are required');
        }

        this.#validationRules[name] = validatorFn;
        this.#eventBus.emit('utils:validationRuleRegistered', { name });
        
        return true;
    }

    getRegisteredSchemas() {
        return Array.from(this.#schemaRegistry.keys());
    }

    getValidationRules() {
        return Object.keys(this.#validationRules);
    }

    clearCaches() {
        this.#selectorCache = new WeakMap();
        this.#memoizerCache.clear();
        this.#performanceCache.clear();
        
        this.#eventBus.emit('utils:cachesCleared', { timestamp: Date.now() });
        this.#logger.info('All utility caches cleared');
    }

    // Private methods
    #setupEventListeners() {
        this.#eventBus.on('utils:clearCaches', () => this.clearCaches());
        this.#eventBus.on('utils:getStats', (data, callback) => {
            callback({
                schemas: this.#schemaRegistry.size,
                transformers: this.#transformers.size,
                pipelines: this.#pipelines.size,
                memoizerCacheSize: this.#memoizerCache.size
            });
        });
    }

    #loadBuiltinSchemas() {
        const builtinSchemas = {
            'user': {
                id: { type: 'string', required: true },
                email: { type: 'email', required: true },
                name: { type: 'string', required: true },
                createdAt: { type: 'date', required: true },
                updatedAt: { type: 'date', required: false }
            },
            'lesson': {
                id: { type: 'string', required: true },
                title: { type: 'string', required: true },
                language: { type: 'string', required: true },
                difficulty: { type: 'string', enum: ['beginner', 'intermediate', 'advanced'], required: true },
                duration: { type: 'number', min: 0, required: true },
                completed: { type: 'boolean', required: false, default: false }
            },
            'app-state': {
                user: { type: 'object', schema: 'user', required: false },
                lessons: { type: 'array', items: { type: 'object', schema: 'lesson' }, required: false },
                settings: { type: 'object', required: false },
                session: { type: 'object', required: false }
            }
        };

        for (const [name, schema] of Object.entries(builtinSchemas)) {
            this.registerSchema(name, schema);
        }
    }

    #performDeepMerge(target, source, path, conflicts) {
        let mergedCount = 0;
        
        for (const key in source) {
            if (source.hasOwnProperty(key)) {
                const sourceValue = source[key];
                const targetValue = target[key];
                const currentPath = path ? `${path}.${key}` : key;
                
                if (this.#isObject(sourceValue) && this.#isObject(targetValue)) {
                    const subMerge = this.#performDeepMerge(targetValue, sourceValue, currentPath, conflicts);
                    target[key] = subMerge.result;
                    mergedCount += subMerge.mergedCount;
                } else if (Array.isArray(sourceValue) && Array.isArray(targetValue)) {
                    const mergedArray = this.#mergeArrays(targetValue, sourceValue, currentPath, conflicts);
                    target[key] = mergedArray.result;
                    mergedCount += mergedArray.mergedCount;
                } else {
                    if (key in target && !this.#isEqual(targetValue, sourceValue)) {
                        conflicts.push({
                            path: currentPath,
                            target: targetValue,
                            source: sourceValue,
                            resolved: 'source'
                        });
                    }
                    
                    target[key] = this.deepClone(sourceValue);
                    mergedCount++;
                }
            }
        }
        
        return { result: target, mergedCount };
    }

    #mergeArrays(targetArr, sourceArr, path, conflicts) {
        const result = [...targetArr];
        let mergedCount = 0;
        
        for (let i = 0; i < sourceArr.length; i++) {
            const sourceItem = sourceArr[i];
            const targetItem = result[i];
            
            if (i < result.length) {
                if (this.#isObject(sourceItem) && this.#isObject(targetItem)) {
                    const subMerge = this.#performDeepMerge(targetItem, sourceItem, `${path}[${i}]`, conflicts);
                    result[i] = subMerge.result;
                    mergedCount += subMerge.mergedCount;
                } else if (!this.#isEqual(targetItem, sourceItem)) {
                    conflicts.push({
                        path: `${path}[${i}]`,
                        target: targetItem,
                        source: sourceItem,
                        resolved: 'source'
                    });
                    result[i] = this.deepClone(sourceItem);
                    mergedCount++;
                }
            } else {
                result.push(this.deepClone(sourceItem));
                mergedCount++;
            }
        }
        
        return { result, mergedCount };
    }

    #performDeepClone(obj, cache, options) {
        if (obj === null || typeof obj !== 'object') {
            return obj;
        }

        if (cache.has(obj)) {
            return cache.get(obj);
        }

        if (obj instanceof Date) {
            return new Date(obj);
        }

        if (obj instanceof RegExp) {
            return new RegExp(obj);
        }

        if (obj instanceof Map) {
            const clonedMap = new Map();
            cache.set(obj, clonedMap);
            for (const [key, value] of obj) {
                clonedMap.set(
                    this.#performDeepClone(key, cache, options),
                    this.#performDeepClone(value, cache, options)
                );
            }
            return clonedMap;
        }

        if (obj instanceof Set) {
            const clonedSet = new Set();
            cache.set(obj, clonedSet);
            for (const value of obj) {
                clonedSet.add(this.#performDeepClone(value, cache, options));
            }
            return clonedSet;
        }

        if (obj instanceof ArrayBuffer) {
            return obj.slice(0);
        }

        if (Array.isArray(obj)) {
            const clonedArray = [];
            cache.set(obj, clonedArray);
            for (let i = 0; i < obj.length; i++) {
                clonedArray[i] = this.#performDeepClone(obj[i], cache, options);
            }
            return clonedArray;
        }

        if (obj instanceof Object) {
            const clonedObj = Object.create(Object.getPrototypeOf(obj));
            cache.set(obj, clonedObj);
            
            const keys = options.includeSymbols 
                ? Reflect.ownKeys(obj)
                : Object.keys(obj);
            
            for (const key of keys) {
                if (key === 'constructor') continue;
                const descriptor = Object.getOwnPropertyDescriptor(obj, key);
                
                if (descriptor) {
                    if (descriptor.get || descriptor.set) {
                        Object.defineProperty(clonedObj, key, descriptor);
                    } else {
                        clonedObj[key] = this.#performDeepClone(obj[key], cache, options);
                    }
                }
            }
            
            return clonedObj;
        }

        return obj;
    }

    #calculateDiff(prev, next, path, options) {
        const patches = [];
        
        if (prev === next) {
            return patches;
        }

        if (this.#isObject(prev) && this.#isObject(next)) {
            const allKeys = new Set([
                ...Object.keys(prev),
                ...Object.keys(next)
            ]);

            for (const key of allKeys) {
                const currentPath = path ? `${path}.${key}` : key;
                const prevValue = prev[key];
                const nextValue = next[key];

                if (key in prev && !(key in next)) {
                    patches.push({
                        op: 'remove',
                        path: currentPath,
                        value: prevValue
                    });
                } else if (!(key in prev) && key in next) {
                    patches.push({
                        op: 'add',
                        path: currentPath,
                        value: nextValue
                    });
                } else if (!this.#isEqual(prevValue, nextValue)) {
                    if (this.#isObject(prevValue) && this.#isObject(nextValue)) {
                        patches.push(...this.#calculateDiff(prevValue, nextValue, currentPath, options));
                    } else if (Array.isArray(prevValue) && Array.isArray(nextValue)) {
                        patches.push(...this.#calculateArrayDiff(prevValue, nextValue, currentPath, options));
                    } else {
                        patches.push({
                            op: 'replace',
                            path: currentPath,
                            oldValue: prevValue,
                            value: nextValue
                        });
                    }
                }
            }
        } else if (Array.isArray(prev) && Array.isArray(next)) {
            patches.push(...this.#calculateArrayDiff(prev, next, path, options));
        } else {
            patches.push({
                op: 'replace',
                path: path || '/',
                oldValue: prev,
                value: next
            });
        }

        return patches;
    }

    #calculateArrayDiff(prev, next, path, options) {
        const patches = [];
        const maxLength = Math.max(prev.length, next.length);

        for (let i = 0; i < maxLength; i++) {
            const currentPath = `${path}[${i}]`;
            const prevValue = prev[i];
            const nextValue = next[i];

            if (i >= prev.length) {
                patches.push({
                    op: 'add',
                    path: currentPath,
                    value: nextValue
                });
            } else if (i >= next.length) {
                patches.push({
                    op: 'remove',
                    path: currentPath,
                    value: prevValue
                });
            } else if (!this.#isEqual(prevValue, nextValue)) {
                if (this.#isObject(prevValue) && this.#isObject(nextValue)) {
                    patches.push(...this.#calculateDiff(prevValue, nextValue, currentPath, options));
                } else if (Array.isArray(prevValue) && Array.isArray(nextValue)) {
                    patches.push(...this.#calculateArrayDiff(prevValue, nextValue, currentPath, options));
                } else {
                    patches.push({
                        op: 'replace',
                        path: currentPath,
                        oldValue: prevValue,
                        value: nextValue
                    });
                }
            }
        }

        return patches;
    }

    #applyPatch(target, patch, options) {
        const pathParts = patch.path.split(/[\.\[\]]+/).filter(Boolean);
        let current = target;

        for (let i = 0; i < pathParts.length - 1; i++) {
            const part = pathParts[i];
            if (!current[part] && patch.op !== 'add') {
                throw new Error(`Path not found: ${part}`);
            }
            current = current[part];
        }

        const lastPart = pathParts[pathParts.length - 1] || '';

        switch (patch.op) {
            case 'add':
            case 'replace':
                if (lastPart === '') {
                    Object.assign(target, patch.value);
                } else if (Array.isArray(current) && /^\d+$/.test(lastPart)) {
                    const index = parseInt(lastPart);
                    if (index >= 0 && index <= current.length) {
                        if (patch.op === 'add') {
                            current.splice(index, 0, patch.value);
                        } else {
                            current[index] = patch.value;
                        }
                    } else {
                        throw new Error(`Array index out of bounds: ${index}`);
                    }
                } else {
                    current[lastPart] = patch.value;
                }
                break;

            case 'remove':
                if (Array.isArray(current) && /^\d+$/.test(lastPart)) {
                    const index = parseInt(lastPart);
                    if (index >= 0 && index < current.length) {
                        current.splice(index, 1);
                    } else {
                        throw new Error(`Array index out of bounds: ${index}`);
                    }
                } else if (lastPart in current) {
                    delete current[lastPart];
                } else {
                    throw new Error(`Property not found: ${lastPart}`);
                }
                break;

            default:
                throw new Error(`Unknown patch operation: ${patch.op}`);
        }
    }

    #validateAgainstSchema(data, schema, path, errors, warnings, options) {
        for (const [field, rules] of Object.entries(schema)) {
            const currentPath = path ? `${path}.${field}` : field;
            const value = data[field];
            
            // Check required fields
            if (rules.required && (value === undefined || value === null)) {
                errors.push({
                    path: currentPath,
                    message: `Required field is missing`,
                    code: 'REQUIRED_FIELD_MISSING'
                });
                continue;
            }

            // Skip validation if value is undefined and field is not required
            if (value === undefined) {
                continue;
            }

            // Type validation
            if (rules.type && !this.#validateType(value, rules.type)) {
                errors.push({
                    path: currentPath,
                    message: `Expected type ${rules.type}, got ${typeof value}`,
                    code: 'TYPE_MISMATCH',
                    expected: rules.type,
                    actual: typeof value
                });
            }

            // Custom validator
            if (rules.validate && typeof rules.validate === 'function') {
                try {
                    const isValid = rules.validate(value);
                    if (!isValid) {
                        errors.push({
                            path: currentPath,
                            message: `Custom validation failed`,
                            code: 'CUSTOM_VALIDATION_FAILED'
                        });
                    }
                } catch (error) {
                    errors.push({
                        path: currentPath,
                        message: `Validator threw an error: ${error.message}`,
                        code: 'VALIDATOR_ERROR'
                    });
                }
            }

            // Enum validation
            if (rules.enum && !rules.enum.includes(value)) {
                errors.push({
                    path: currentPath,
                    message: `Value must be one of: ${rules.enum.join(', ')}`,
                    code: 'ENUM_MISMATCH',
                    allowed: rules.enum,
                    actual: value
                });
            }

            // Range validation for numbers
            if (rules.type === 'number') {
                if (rules.min !== undefined && value < rules.min) {
                    errors.push({
                        path: currentPath,
                        message: `Value must be at least ${rules.min}`,
                        code: 'MIN_VALUE',
                        min: rules.min,
                        actual: value
                    });
                }
                
                if (rules.max !== undefined && value > rules.max) {
                    errors.push({
                        path: currentPath,
                        message: `Value must be at most ${rules.max}`,
                        code: 'MAX_VALUE',
                        max: rules.max,
                        actual: value
                    });
                }
            }

            // Length validation for strings and arrays
            if (rules.minLength !== undefined && value.length < rules.minLength) {
                errors.push({
                    path: currentPath,
                    message: `Length must be at least ${rules.minLength}`,
                    code: 'MIN_LENGTH',
                    minLength: rules.minLength,
                    actual: value.length
                });
            }
            
            if (rules.maxLength !== undefined && value.length > rules.maxLength) {
                errors.push({
                    path: currentPath,
                    message: `Length must be at most ${rules.maxLength}`,
                    code: 'MAX_LENGTH',
                    maxLength: rules.maxLength,
                    actual: value.length
                });
            }

            // Pattern validation for strings
            if (rules.pattern && !rules.pattern.test(value)) {
                errors.push({
                    path: currentPath,
                    message: `Value does not match pattern ${rules.pattern}`,
                    code: 'PATTERN_MISMATCH'
                });
            }

            // Recursive validation for nested objects
            if (rules.schema && this.#isObject(value)) {
                const nestedSchema = this.#schemaRegistry.get(rules.schema);
                if (nestedSchema) {
                    this.#validateAgainstSchema(value, nestedSchema, currentPath, errors, warnings, options);
                }
            }

            // Recursive validation for array items
            if (rules.items && Array.isArray(value)) {
                const itemSchema = rules.items.schema 
                    ? this.#schemaRegistry.get(rules.items.schema)
                    : rules.items;
                
                if (itemSchema) {
                    for (let i = 0; i < value.length; i++) {
                        this.#validateAgainstSchema(
                            value[i],
                            itemSchema,
                            `${currentPath}[${i}]`,
                            errors,
                            warnings,
                            options
                        );
                    }
                }
            }

            // Default value application (if not strict mode)
            if (!options.strict && value === undefined && rules.default !== undefined) {
                data[field] = typeof rules.default === 'function' 
                    ? rules.default() 
                    : this.deepClone(rules.default);
                
                warnings.push({
                    path: currentPath,
                    message: `Applied default value`,
                    code: 'DEFAULT_APPLIED',
                    value: data[field]
                });
            }
        }

        // Additional properties check (if strict mode)
        if (options.strict && schema.additionalProperties === false) {
            const allowedFields = new Set(Object.keys(schema));
            for (const field in data) {
                if (!allowedFields.has(field)) {
                    errors.push({
                        path: path ? `${path}.${field}` : field,
                        message: `Additional property "${field}" is not allowed`,
                        code: 'ADDITIONAL_PROPERTY'
                    });
                }
            }
        }
    }

    #validateType(value, type) {
        if (typeof type === 'string') {
            if (this.#validationRules[type]) {
                return this.#validationRules[type](value);
            }
            
            switch (type) {
                case 'string': return typeof value === 'string';
                case 'number': return typeof value === 'number' && !isNaN(value);
                case 'boolean': return typeof value === 'boolean';
                case 'array': return Array.isArray(value);
                case 'object': return value && typeof value === 'object' && !Array.isArray(value);
                case 'date': return value instanceof Date;
                case 'null': return value === null;
                case 'undefined': return value === undefined;
                default: return true; // Unknown type, skip validation
            }
        }
        
        return true;
    }

    #performNormalization(data, schema) {
        const result = {};
        const entities = {};
        
        for (const [field, rules] of Object.entries(schema)) {
            const value = data[field];
            
            if (value === undefined) {
                continue;
            }
            
            if (rules.schema && this.#isObject(value)) {
                const nestedSchema = this.#schemaRegistry.get(rules.schema);
                if (nestedSchema) {
                    const normalized = this.#performNormalization(value, nestedSchema);
                    result[field] = normalized.id;
                    
                    if (!entities[rules.schema]) {
                        entities[rules.schema] = {};
                    }
                    entities[rules.schema][normalized.id] = normalized;
                }
            } else if (rules.items && rules.items.schema && Array.isArray(value)) {
                const itemSchema = this.#schemaRegistry.get(rules.items.schema);
                if (itemSchema) {
                    result[field] = value.map(item => {
                        const normalized = this.#performNormalization(item, itemSchema);
                        
                        if (!entities[rules.items.schema]) {
                            entities[rules.items.schema] = {};
                        }
                        entities[rules.items.schema][normalized.id] = normalized;
                        
                        return normalized.id;
                    });
                }
            } else {
                result[field] = this.deepClone(value);
            }
        }
        
        return { ...result, _entities: entities };
    }

    #performDenormalization(normalizedData, schema) {
        const result = {};
        const entities = normalizedData._entities || {};
        
        for (const [field, rules] of Object.entries(schema)) {
            const value = normalizedData[field];
            
            if (value === undefined) {
                continue;
            }
            
            if (rules.schema && typeof value === 'string') {
                const nestedSchema = this.#schemaRegistry.get(rules.schema);
                if (nestedSchema && entities[rules.schema]) {
                    const entity = entities[rules.schema][value];
                    if (entity) {
                        result[field] = this.#performDenormalization(entity, nestedSchema);
                    }
                }
            } else if (rules.items && rules.items.schema && Array.isArray(value)) {
                const itemSchema = this.#schemaRegistry.get(rules.items.schema);
                if (itemSchema && entities[rules.items.schema]) {
                    result[field] = value.map(id => {
                        const entity = entities[rules.items.schema][id];
                        return entity ? this.#performDenormalization(entity, itemSchema) : null;
                    }).filter(Boolean);
                }
            } else {
                result[field] = this.deepClone(value);
            }
        }
        
        return result;
    }

    #cleanupMemoizerCache(maxSize) {
        if (this.#memoizerCache.size > maxSize) {
            const entries = Array.from(this.#memoizerCache.entries());
            entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
            
            const toRemove = entries.slice(0, entries.length - maxSize);
            for (const [key] of toRemove) {
                this.#memoizerCache.delete(key);
            }
        }
    }

    #generateCacheKey(base, args) {
        const argsString = args.map(arg => {
            if (arg === undefined) return 'undefined';
            if (arg === null) return 'null';
            if (typeof arg === 'function') return arg.toString();
            if (typeof arg === 'object') return JSON.stringify(arg);
            return String(arg);
        }).join('|');
        
        return `${base}:${this.#hashString(argsString)}`;
    }

    #hashString(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return hash.toString(36);
    }

    #isObject(value) {
        return value && typeof value === 'object' && !Array.isArray(value);
    }

    #isEqual(a, b) {
        if (a === b) return true;
        if (a == null || b == null) return false;
        if (typeof a !== typeof b) return false;
        
        if (Array.isArray(a) && Array.isArray(b)) {
            if (a.length !== b.length) return false;
            for (let i = 0; i < a.length; i++) {
                if (!this.#isEqual(a[i], b[i])) return false;
            }
            return true;
        }
        
        if (this.#isObject(a) && this.#isObject(b)) {
            const keysA = Object.keys(a);
            const keysB = Object.keys(b);
            if (keysA.length !== keysB.length) return false;
            
            for (const key of keysA) {
                if (!keysB.includes(key) || !this.#isEqual(a[key], b[key])) {
                    return false;
                }
            }
            return true;
        }
        
        return false;
    }
}

// Factory function for Dependency Injection
export const createStateUtils = (dependencies) => {
    return new StateUtils(dependencies);
};

// Default export with validation
export default (dependencies) => {
    const required = ['eventBus', 'config', 'logger'];
    const missing = required.filter(dep => !dependencies[dep]);
    
    if (missing.length > 0) {
        throw new Error(`Missing dependencies: ${missing.join(', ')}`);
    }
    
    return new StateUtils(dependencies);
};
