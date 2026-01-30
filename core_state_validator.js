/**
 * HyperLang - State Validation System
 * Version: 1.0.0
 * Principles: Dependency Injection + Interface Contract
 */

import { CONFIG } from './core_config.js';
import { context } from './core_context_provider.js';
import { eventBus } from './core_event_bus.js';

// Validation Contract Interface
export const VALIDATION_CONTRACT = {
    schema: {
        type: 'string',
        fields: 'object',
        required: 'array?',
        validators: 'object?'
    },
    rule: {
        name: 'string',
        test: 'function',
        message: 'string',
        severity: 'string?'
    },
    result: {
        valid: 'boolean',
        errors: 'array',
        warnings: 'array',
        timestamp: 'number'
    }
};

export class StateValidator {
    constructor(options = {}) {
        // Dependency Injection
        this.config = context.get('config');
        this.logger = context.get('logger');
        this.eventBus = context.get('eventBus') || eventBus;
        
        // Configuration
        this.options = {
            strictMode: options.strictMode ?? true,
            validateOnChange: options.validateOnChange ?? true,
            logErrors: options.logErrors ?? true,
            throwOnError: options.throwOnError ?? false,
            customValidators: options.customValidators || {},
            ...options
        };
        
        // Schema Registry
        this.schemas = new Map();
        this.rules = new Map();
        this.validationHistory = [];
        
        // Load built-in schemas and rules
        this.loadBuiltInSchemas();
        this.loadBuiltInRules();
        
        // Setup
        this.setupChangeValidation();
        
        // Register with context
        context.register('stateValidator', {
            factory: () => this,
            dependencies: ['config', 'logger', 'eventBus'],
            lifecycle: 'singleton'
        });
        
        this.logger?.log('StateValidator initialized');
    }
    
    // ==================== SCHEMA MANAGEMENT ====================
    
    registerSchema(name, schema) {
        this.validateSchema(schema);
        
        if (this.schemas.has(name)) {
            throw new Error(`Schema "${name}" already registered`);
        }
        
        this.schemas.set(name, {
            ...schema,
            name,
            registeredAt: Date.now(),
            version: schema.version || '1.0.0'
        });
        
        this.eventBus.emit('validator:schema_registered', {
            schemaName: name,
            fields: Object.keys(schema.fields || {}),
            timestamp: Date.now()
        });
        
        this.logger?.log(`Schema registered: ${name}`);
        
        return this;
    }
    
    getSchema(name) {
        const schema = this.schemas.get(name);
        if (!schema) {
            throw new Error(`Schema "${name}" not found`);
        }
        return { ...schema };
    }
    
    removeSchema(name) {
        const removed = this.schemas.delete(name);
        
        if (removed) {
            this.eventBus.emit('validator:schema_removed', {
                schemaName: name,
                timestamp: Date.now()
            });
        }
        
        return removed;
    }
    
    // ==================== RULE MANAGEMENT ====================
    
    registerRule(name, rule) {
        this.validateRule(rule);
        
        if (this.rules.has(name)) {
            throw new Error(`Rule "${name}" already registered`);
        }
        
        this.rules.set(name, {
            ...rule,
            name,
            registeredAt: Date.now()
        });
        
        this.logger?.log(`Rule registered: ${name}`);
        
        return this;
    }
    
    getRule(name) {
        const rule = this.rules.get(name);
        if (!rule) {
            throw new Error(`Rule "${name}" not found`);
        }
        return { ...rule };
    }
    
    // ==================== VALIDATION METHODS ====================
    
    validate(schemaName, data, options = {}) {
        const schema = this.schemas.get(schemaName);
        if (!schema) {
            throw new Error(`Schema "${schemaName}" not found`);
        }
        
        const startTime = Date.now();
        
        const result = {
            valid: true,
            errors: [],
            warnings: [],
            schema: schemaName,
            timestamp: Date.now(),
            duration: 0
        };
        
        try {
            // 1. Validate against schema
            this.validateAgainstSchema(schema, data, result, options);
            
            // 2. Apply custom validators
            this.applyCustomValidators(schema, data, result, options);
            
            // 3. Apply field-specific rules
            this.applyFieldRules(schema, data, result, options);
            
            // 4. Apply global rules
            this.applyGlobalRules(data, result, options);
            
            // Determine overall validity
            result.valid = result.errors.length === 0;
            
            // Calculate duration
            result.duration = Date.now() - startTime;
            
            // Record in history
            this.recordValidation(result);
            
            // Log if configured
            if (this.options.logErrors && !result.valid) {
                this.logValidationResult(result);
            }
            
            // Emit event
            this.eventBus.emit('validator:validation_complete', {
                schema: schemaName,
                valid: result.valid,
                errorCount: result.errors.length,
                warningCount: result.warnings.length,
                duration: result.duration,
                timestamp: Date.now()
            });
            
            // Throw if configured and invalid
            if (this.options.throwOnError && !result.valid) {
                throw new Error(`Validation failed: ${result.errors.map(e => e.message).join(', ')}`);
            }
            
            return result;
            
        } catch (error) {
            const errorResult = {
                valid: false,
                errors: [{ 
                    type: 'validation_error', 
                    message: error.message,
                    stack: error.stack 
                }],
                warnings: [],
                schema: schemaName,
                timestamp: Date.now(),
                duration: Date.now() - startTime
            };
            
            this.recordValidation(errorResult);
            
            this.eventBus.emit('validator:validation_error', {
                schema: schemaName,
                error: error.message,
                timestamp: Date.now()
            });
            
            throw error;
        }
    }
    
    validateAgainstSchema(schema, data, result, options) {
        const { fields = {}, required = [] } = schema;
        
        // Check required fields
        required.forEach(field => {
            if (data[field] === undefined || data[field] === null) {
                result.errors.push({
                    field,
                    type: 'required',
                    message: `Field "${field}" is required`,
                    severity: 'error'
                });
            }
        });
        
        // Validate each field
        Object.entries(fields).forEach(([field, fieldSchema]) => {
            const value = data[field];
            
            // Skip validation if field is optional and not provided
            if (field.endsWith('?') && value === undefined) {
                return;
            }
            
            const cleanField = field.replace('?', '');
            
            // Validate field type
            this.validateFieldType(cleanField, value, fieldSchema, result);
            
            // Validate field constraints
            this.validateFieldConstraints(cleanField, value, fieldSchema, result);
        });
        
        // Validate extra fields (if strict mode)
        if (this.options.strictMode && schema.strict !== false) {
            Object.keys(data).forEach(field => {
                if (!fields[field] && !fields[`${field}?`]) {
                    result.errors.push({
                        field,
                        type: 'extra_field',
                        message: `Unexpected field "${field}"`,
                        severity: 'warning'
                    });
                }
            });
        }
    }
    
    validateFieldType(field, value, fieldSchema, result) {
        if (value === undefined || value === null) {
            return; // Already handled by required check
        }
        
        const expectedType = Array.isArray(fieldSchema) ? fieldSchema[0] : fieldSchema;
        
        switch (expectedType) {
            case 'string':
                if (typeof value !== 'string') {
                    result.errors.push({
                        field,
                        type: 'type_mismatch',
                        message: `Field "${field}" must be a string, got ${typeof value}`,
                        severity: 'error'
                    });
                }
                break;
                
            case 'number':
                if (typeof value !== 'number' || isNaN(value)) {
                    result.errors.push({
                        field,
                        type: 'type_mismatch',
                        message: `Field "${field}" must be a number, got ${typeof value}`,
                        severity: 'error'
                    });
                }
                break;
                
            case 'boolean':
                if (typeof value !== 'boolean') {
                    result.errors.push({
                        field,
                        type: 'type_mismatch',
                        message: `Field "${field}" must be a boolean, got ${typeof value}`,
                        severity: 'error'
                    });
                }
                break;
                
            case 'object':
                if (typeof value !== 'object' || value === null || Array.isArray(value)) {
                    result.errors.push({
                        field,
                        type: 'type_mismatch',
                        message: `Field "${field}" must be an object, got ${typeof value}`,
                        severity: 'error'
                    });
                }
                break;
                
            case 'array':
                if (!Array.isArray(value)) {
                    result.errors.push({
                        field,
                        type: 'type_mismatch',
                        message: `Field "${field}" must be an array, got ${typeof value}`,
                        severity: 'error'
                    });
                }
                break;
                
            default:
                // Custom type or enum
                if (Array.isArray(fieldSchema)) {
                    // Enum validation
                    if (!fieldSchema.includes(value)) {
                        result.errors.push({
                            field,
                            type: 'enum_mismatch',
                            message: `Field "${field}" must be one of: ${fieldSchema.join(', ')}`,
                            severity: 'error'
                        });
                    }
                } else if (typeof expectedType === 'string' && expectedType.includes('|')) {
                    // Union type
                    const types = expectedType.split('|').map(t => t.trim());
                    const matches = types.some(type => {
                        switch (type) {
                            case 'string': return typeof value === 'string';
                            case 'number': return typeof value === 'number';
                            case 'boolean': return typeof value === 'boolean';
                            case 'object': return typeof value === 'object' && !Array.isArray(value);
                            case 'array': return Array.isArray(value);
                            default: return false;
                        }
                    });
                    
                    if (!matches) {
                        result.errors.push({
                            field,
                            type: 'union_mismatch',
                            message: `Field "${field}" must be one of types: ${types.join(', ')}`,
                            severity: 'error'
                        });
                    }
                }
        }
    }
    
    validateFieldConstraints(field, value, fieldSchema, result) {
        const constraints = Array.isArray(fieldSchema) 
            ? fieldSchema[1] 
            : typeof fieldSchema === 'object' && fieldSchema !== null && !Array.isArray(fieldSchema)
                ? fieldSchema
                : {};
        
        // Min/Max for numbers
        if (typeof value === 'number') {
            if (constraints.min !== undefined && value < constraints.min) {
                result.errors.push({
                    field,
                    type: 'min_constraint',
                    message: `Field "${field}" must be at least ${constraints.min}`,
                    severity: 'error'
                });
            }
            
            if (constraints.max !== undefined && value > constraints.max) {
                result.errors.push({
                    field,
                    type: 'max_constraint',
                    message: `Field "${field}" must be at most ${constraints.max}`,
                    severity: 'error'
                });
            }
        }
        
        // Min/Max length for strings and arrays
        if (typeof value === 'string' || Array.isArray(value)) {
            const length = value.length;
            
            if (constraints.minLength !== undefined && length < constraints.minLength) {
                result.errors.push({
                    field,
                    type: 'min_length',
                    message: `Field "${field}" must have at least ${constraints.minLength} characters/items`,
                    severity: 'error'
                });
            }
            
            if (constraints.maxLength !== undefined && length > constraints.maxLength) {
                result.errors.push({
                    field,
                    type: 'max_length',
                    message: `Field "${field}" must have at most ${constraints.maxLength} characters/items`,
                    severity: 'error'
                });
            }
        }
        
        // Pattern for strings
        if (typeof value === 'string' && constraints.pattern) {
            const regex = new RegExp(constraints.pattern);
            if (!regex.test(value)) {
                result.errors.push({
                    field,
                    type: 'pattern_mismatch',
                    message: `Field "${field}" must match pattern: ${constraints.pattern}`,
                    severity: 'error'
                });
            }
        }
        
        // Custom validator function
        if (constraints.validate && typeof constraints.validate === 'function') {
            try {
                const validationResult = constraints.validate(value, field, result);
                if (validationResult === false || typeof validationResult === 'string') {
                    result.errors.push({
                        field,
                        type: 'custom_validation',
                        message: typeof validationResult === 'string' 
                            ? validationResult 
                            : `Field "${field}" failed custom validation`,
                        severity: 'error'
                    });
                }
            } catch (error) {
                result.errors.push({
                    field,
                    type: 'validator_error',
                    message: `Validator error for field "${field}": ${error.message}`,
                    severity: 'error'
                });
            }
        }
    }
    
    // ==================== CUSTOM VALIDATORS ====================
    
    applyCustomValidators(schema, data, result, options) {
        if (!schema.validators) return;
        
        Object.entries(schema.validators).forEach(([validatorName, validator]) => {
            if (typeof validator === 'function') {
                try {
                    const validationResult = validator(data, options);
                    
                    if (validationResult === false || typeof validationResult === 'string') {
                        result.errors.push({
                            type: 'schema_validator',
                            validator: validatorName,
                            message: typeof validationResult === 'string' 
                                ? validationResult 
                                : `Failed schema validator: ${validatorName}`,
                            severity: 'error'
                        });
                    } else if (Array.isArray(validationResult)) {
                        validationResult.forEach(error => {
                            result.errors.push({
                                ...error,
                                validator: validatorName,
                                type: error.type || 'schema_validator'
                            });
                        });
                    }
                } catch (error) {
                    result.errors.push({
                        type: 'validator_error',
                        validator: validatorName,
                        message: `Validator "${validatorName}" error: ${error.message}`,
                        severity: 'error'
                    });
                }
            }
        });
    }
    
    applyFieldRules(schema, data, result, options) {
        if (!schema.rules) return;
        
        Object.entries(schema.rules).forEach(([field, fieldRules]) => {
            if (!Array.isArray(fieldRules)) return;
            
            const value = data[field];
            
            fieldRules.forEach(ruleName => {
                const rule = this.rules.get(ruleName);
                if (!rule) return;
                
                try {
                    const ruleResult = rule.test(value, field, data, options);
                    
                    if (ruleResult === false || typeof ruleResult === 'string') {
                        const severity = rule.severity || 'error';
                        const entry = {
                            field,
                            type: 'field_rule',
                            rule: ruleName,
                            message: typeof ruleResult === 'string' 
                                ? ruleResult 
                                : rule.message || `Field "${field}" failed rule: ${ruleName}`,
                            severity
                        };
                        
                        if (severity === 'error') {
                            result.errors.push(entry);
                        } else {
                            result.warnings.push(entry);
                        }
                    }
                } catch (error) {
                    result.errors.push({
                        field,
                        type: 'rule_error',
                        rule: ruleName,
                        message: `Rule "${ruleName}" error for field "${field}": ${error.message}`,
                        severity: 'error'
                    });
                }
            });
        });
    }
    
    applyGlobalRules(data, result, options) {
        // Apply rules from options
        if (options.rules && Array.isArray(options.rules)) {
            options.rules.forEach(ruleName => {
                const rule = this.rules.get(ruleName);
                if (!rule) return;
                
                try {
                    const ruleResult = rule.test(data, null, data, options);
                    
                    if (ruleResult === false || typeof ruleResult === 'string') {
                        const severity = rule.severity || 'error';
                        const entry = {
                            type: 'global_rule',
                            rule: ruleName,
                            message: typeof ruleResult === 'string' 
                                ? ruleResult 
                                : rule.message || `Data failed rule: ${ruleName}`,
                            severity
                        };
                        
                        if (severity === 'error') {
                            result.errors.push(entry);
                        } else {
                            result.warnings.push(entry);
                        }
                    }
                } catch (error) {
                    result.errors.push({
                        type: 'rule_error',
                        rule: ruleName,
                        message: `Rule "${ruleName}" error: ${error.message}`,
                        severity: 'error'
                    });
                }
            });
        }
    }
    
    // ==================== VALIDATION HELPERS ====================
    
    validateSchema(schema) {
        if (!schema || typeof schema !== 'object') {
            throw new Error('Schema must be an object');
        }
        
        if (!schema.fields || typeof schema.fields !== 'object') {
            throw new Error('Schema must have a fields object');
        }
        
        return true;
    }
    
    validateRule(rule) {
        if (!rule || typeof rule !== 'object') {
            throw new Error('Rule must be an object');
        }
        
        if (!rule.name || typeof rule.name !== 'string') {
            throw new Error('Rule must have a name string');
        }
        
        if (!rule.test || typeof rule.test !== 'function') {
            throw new Error('Rule must have a test function');
        }
        
        if (!rule.message || typeof rule.message !== 'string') {
            throw new Error('Rule must have a message string');
        }
        
        if (rule.severity && !['error', 'warning', 'info'].includes(rule.severity)) {
            throw new Error('Rule severity must be one of: error, warning, info');
        }
        
        return true;
    }
    
    // ==================== HISTORY AND LOGGING ====================
    
    recordValidation(result) {
        this.validationHistory.unshift({
            ...result,
            recordedAt: Date.now()
        });
        
        // Keep only last 100 validations
        if (this.validationHistory.length > 100) {
            this.validationHistory.pop();
        }
    }
    
    logValidationResult(result) {
        if (result.valid) return;
        
        console.groupCollapsed(`❌ Validation failed for schema: ${result.schema}`);
        console.log('Errors:', result.errors);
        console.log('Warnings:', result.warnings);
        console.groupEnd();
    }
    
    getValidationHistory(limit = 20) {
        return this.validationHistory.slice(0, limit);
    }
    
    // ==================== BUILT-IN SCHEMAS AND RULES ====================
    
    loadBuiltInSchemas() {
        // User Schema
        this.registerSchema('user', {
            fields: {
                id: 'string',
                email: ['string', { pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$' }],
                username: ['string', { minLength: 3, maxLength: 30 }],
                name: 'string?',
                age: ['number?', { min: 0, max: 150 }],
                settings: 'object?',
                createdAt: 'number',
                updatedAt: 'number?',
                isActive: 'boolean?'
            },
            required: ['id', 'email', 'username', 'createdAt']
        });
        
        // Lesson Schema
        this.registerSchema('lesson', {
            fields: {
                id: 'string',
                title: ['string', { minLength: 1, maxLength: 200 }],
                language: ['string', { 
                    validate: (value) => 
                        ['en', 'fa', 'ar', 'tr', 'de', 'es'].includes(value) 
                        || 'Invalid language code'
                }],
                level: ['beginner|intermediate|advanced', {}],
                duration: ['number', { min: 1, max: 300 }],
                content: 'object?',
                metadata: 'object?',
                createdAt: 'number',
                updatedAt: 'number?'
            },
            required: ['id', 'title', 'language', 'level', 'duration', 'createdAt']
        });
        
        // Progress Schema
        this.registerSchema('progress', {
            fields: {
                userId: 'string',
                lessonId: 'string',
                score: ['number', { min: 0, max: 100 }],
                completed: 'boolean?',
                timeSpent: ['number', { min: 0 }],
                attempts: ['number', { min: 1 }],
                data: 'object?',
                completedAt: 'number?',
                updatedAt: 'number'
            },
            required: ['userId', 'lessonId', 'score', 'updatedAt']
        });
    }
    
    loadBuiltInRules() {
        // Email format rule
        this.registerRule('email_format', {
            name: 'email_format',
            test: (value) => {
                if (typeof value !== 'string') return false;
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                return emailRegex.test(value);
            },
            message: 'Invalid email format',
            severity: 'error'
        });
        
        // Strong password rule
        this.registerRule('strong_password', {
            name: 'strong_password',
            test: (value) => {
                if (typeof value !== 'string') return false;
                return value.length >= 8 && 
                       /[A-Z]/.test(value) && 
                       /[a-z]/.test(value) && 
                       /[0-9]/.test(value);
            },
            message: 'Password must be at least 8 characters with uppercase, lowercase, and number',
            severity: 'error'
        });
        
        // Valid URL rule
        this.registerRule('valid_url', {
            name: 'valid_url',
            test: (value) => {
                if (typeof value !== 'string') return false;
                try {
                    new URL(value);
                    return true;
                } catch {
                    return false;
                }
            },
            message: 'Invalid URL format',
            severity: 'error'
        });
        
        // Future date rule
        this.registerRule('future_date', {
            name: 'future_date',
            test: (value) => {
                if (typeof value !== 'number') return false;
                return value > Date.now();
            },
            message: 'Date must be in the future',
            severity: 'error'
        });
        
        // Past date rule
        this.registerRule('past_date', {
            name: 'past_date',
            test: (value) => {
                if (typeof value !== 'number') return false;
                return value < Date.now();
            },
            message: 'Date must be in the past',
            severity: 'error'
        });
    }
    
    // ==================== CHANGE VALIDATION ====================
    
    setupChangeValidation() {
        if (!this.options.validateOnChange) return;
        
        // Listen for state changes
        this.eventBus.on('state:changed', (event) => {
            // Try to auto-detect schema based on state structure
            const schema = this.detectSchema(event.data.newState);
            if (schema) {
                const result = this.validate(schema, event.data.newState, {
                    context: 'state_change',
                    changeDescription: event.data.description
                });
                
                if (!result.valid) {
                    this.eventBus.emit('validator:state_change_validation_failed', {
                        schema,
                        errors: result.errors,
                        warnings: result.warnings,
                        changeDescription: event.data.description,
                        timestamp: Date.now()
                    });
                }
            }
        });
    }
    
    detectSchema(state) {
        // Simple schema detection based on state structure
        if (state?.user?.id && state?.user?.email) {
            return 'user';
        } else if (state?.lesson?.id && state?.lesson?.title) {
            return 'lesson';
        } else if (state?.progress?.userId && state?.progress?.lessonId) {
            return 'progress';
        }
        return null;
    }
    
    // ==================== CONTRACT VALIDATION ====================
    
    validateContract() {
        const errors = [];
        
        // Check required methods
        const requiredMethods = ['registerSchema', 'validate', 'getSchema'];
        requiredMethods.forEach(method => {
            if (typeof this[method] !== 'function') {
                errors.push(`Missing required method: ${method}`);
            }
        });
        
        // Check schemas against contract
        for (const [name, schema] of this.schemas) {
            for (const [key, type] of Object.entries(VALIDATION_CONTRACT.schema)) {
                if (!key.endsWith('?') && schema[key] === undefined) {
                    errors.push(`Schema ${name} missing required field: ${key}`);
                }
            }
        }
        
        return {
            valid: errors.length === 0,
            errors,
            contract: VALIDATION_CONTRACT,
            schemasCount: this.schemas.size,
            rulesCount: this.rules.size,
            timestamp: new Date().toISOString()
        };
    }
    
    // ==================== LIFECYCLE ====================
    
    destroy() {
        // Save validation history
        this.saveValidationHistory();
        
        // Clear all registrations
        this.schemas.clear();
        this.rules.clear();
        this.validationHistory = [];
        
        this.logger?.log('StateValidator destroyed');
    }
    
    saveValidationHistory() {
        try {
            localStorage.setItem(
                'hyperlang_validation_history',
                JSON.stringify(this.validationHistory.slice(0, 50))
            );
        } catch (error) {
            this.logger?.warn('Failed to save validation history:', error);
        }
    }
}

// Singleton instance
export const stateValidator = new StateValidator();

// Register with context
context.registerSingleton('stateValidator', stateValidator);

// Export for global use
if (typeof window !== 'undefined') {
    window.stateValidator = stateValidator;
}

export default stateValidator;
