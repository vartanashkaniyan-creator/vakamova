/**
 * VAKAMOVA TEST UTILITIES - ابزارهای پیشرفته تست یکپارچه
 * اصول: تزریق وابستگی، قرارداد رابط، رویدادمحور، پیکربندی متمرکز
 */

class VakamovaTestUtils {
    constructor(eventSystem = null) {
        // ==================== DEPENDENCY INJECTION ====================
        this._eventSystem = eventSystem || {
            emit: (name, data) => console.log(`[TestEvent] ${name}:`, data),
            on: (name, cb) => {
                console.log(`[TestEvent] Registered: ${name}`);
                return () => {};
            }
        };
        
        // ==================== CONFIGURATION CENTER ====================
        this._config = Object.freeze({
            paths: {
                core: '../core/',
                modules: '../modules/',
                pages: '../pages/'
            },
            timeouts: {
                fileLoad: 10000,
                testCase: 30000,
                network: 5000
            },
            limits: {
                maxFileSizeKB: 500,
                maxTestCases: 100
            }
        });
        
        // ==================== INTERFACE CONTRACT ====================
        this.INTERFACE = Object.freeze({
            LOAD_FILE: 'loadFile',
            RUN_TEST: 'runTest',
            GENERATE_REPORT: 'generateReport',
            CREATE_MOCK: 'createMock',
            VALIDATE_INTEGRATION: 'validateIntegration'
        });
        
        // ==================== EVENT-DRIVEN STATE ====================
        this._testResults = new Map();
        this._loadedFiles = new Set();
        this._mockRegistry = new Map();
        
        console.log('[TestUtils] ✅ Initialized');
    }
    
    // ==================== CORE TEST METHODS ====================
    
    async loadFile(filePath, options = {}) {
        const fileId = `file_${Date.now()}`;
        const startTime = Date.now();
        
        this._eventSystem.emit('test:file:loading', { filePath, fileId });
        
        try {
            if (options.mock && this._mockRegistry.has(filePath)) {
                const mock = this._mockRegistry.get(filePath);
                this._eventSystem.emit('test:file:loaded:mock', { 
                    filePath, 
                    duration: Date.now() - startTime,
                    mock: true 
                });
                return mock;
            }
            
            // Dynamic import for ES modules
            const module = await import(filePath);
            
            this._loadedFiles.add({
                path: filePath,
                exports: Object.keys(module),
                loadedAt: Date.now()
            });
            
            this._eventSystem.emit('test:file:loaded', {
                filePath,
                duration: Date.now() - startTime,
                exports: Object.keys(module)
            });
            
            return module;
            
        } catch (error) {
            this._eventSystem.emit('test:file:error', {
                filePath,
                error: error.message,
                duration: Date.now() - startTime
            });
            
            throw new Error(`Failed to load ${filePath}: ${error.message}`);
        }
    }
    
    async runTest(testCase) {
        const testId = `test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const startTime = Date.now();
        
        this._eventSystem.emit('test:case:start', { testId, ...testCase });
        
        try {
            // Execute test function
            const result = await testCase.execute();
            
            const testResult = {
                id: testId,
                name: testCase.name,
                description: testCase.description,
                success: result.success !== false,
                result: result.data || result,
                duration: Date.now() - startTime,
                timestamp: Date.now(),
                metadata: testCase.metadata || {}
            };
            
            // Store result
            this._testResults.set(testId, testResult);
            
            // Emit result event
            this._eventSystem.emit('test:case:end', {
                ...testResult,
                passed: testResult.success
            });
            
            return testResult;
            
        } catch (error) {
            const errorResult = {
                id: testId,
                name: testCase.name,
                description: testCase.description,
                success: false,
                error: error.message,
                stack: error.stack,
                duration: Date.now() - startTime,
                timestamp: Date.now()
            };
            
            this._testResults.set(testId, errorResult);
            
            this._eventSystem.emit('test:case:error', errorResult);
            
            return errorResult;
        }
    }
    
    generateReport(options = {}) {
        const allResults = Array.from(this._testResults.values());
        const passed = allResults.filter(r => r.success);
        const failed = allResults.filter(r => !r.success);
        
        const report = {
            summary: {
                total: allResults.length,
                passed: passed.length,
                failed: failed.length,
                successRate: allResults.length > 0 ? 
                    (passed.length / allResults.length * 100).toFixed(2) : 0,
                totalDuration: allResults.reduce((sum, r) => sum + (r.duration || 0), 0)
            },
            details: {
                passed: passed.map(r => ({
                    name: r.name,
                    duration: r.duration,
                    timestamp: r.timestamp
                })),
                failed: failed.map(r => ({
                    name: r.name,
                    error: r.error,
                    duration: r.duration
                }))
            },
            files: {
                loaded: this._loadedFiles.size,
                list: Array.from(this._loadedFiles).map(f => ({
                    path: f.path,
                    exports: f.exports
                }))
            },
            timestamp: Date.now(),
            environment: {
                userAgent: navigator.userAgent,
                online: navigator.onLine,
                platform: navigator.platform
            }
        };
        
        if (options.includeFullResults) {
            report.fullResults = allResults;
        }
        
        this._eventSystem.emit('test:report:generated', report);
        
        return report;
    }
    
    createMock(interfaceName, mockImplementation) {
        const mockId = `mock_${interfaceName}_${Date.now()}`;
        
        const mock = {
            _isMock: true,
            _mockId: mockId,
            _interface: interfaceName,
            _calls: [],
            _implementation: mockImplementation,
            
            // Track calls
            call(methodName, args) {
                this._calls.push({
                    method: methodName,
                    args: args,
                    timestamp: Date.now()
                });
                
                if (this._implementation && this._implementation[methodName]) {
                    return this._implementation[methodName](...args);
                }
                
                // Default mock returns
                const defaults = {
                    get: () => null,
                    set: () => ({ success: true }),
                    init: () => Promise.resolve({ success: true }),
                    render: () => {},
                    update: () => ({ success: true })
                };
                
                return defaults[methodName] ? defaults[methodName]() : undefined;
            },
            
            // Reset mock
            reset() {
                this._calls = [];
                return this;
            },
            
            // Get call history
            getCalls() {
                return [...this._calls];
            },
            
            // Verify calls
            verify(methodName, expectedCallCount = 1) {
                const actualCalls = this._calls.filter(call => call.method === methodName);
                return {
                    passed: actualCalls.length === expectedCallCount,
                    expected: expectedCallCount,
                    actual: actualCalls.length,
                    calls: actualCalls
                };
            }
        };
        
        this._mockRegistry.set(interfaceName, mock);
        this._eventSystem.emit('test:mock:created', { interfaceName, mockId });
        
        return mock;
    }
    
    async validateIntegration(components) {
        const integrationTests = [];
        const startTime = Date.now();
        
        // 1. Validate component interfaces
        for (const [name, component] of Object.entries(components)) {
            integrationTests.push({
                name: `Interface Contract: ${name}`,
                description: `Checking ${name} interface compliance`,
                execute: async () => {
                    if (!component) {
                        throw new Error(`${name} component is undefined`);
                    }
                    
                    const requiredMethods = ['init', 'render', 'cleanup'];
                    const missingMethods = [];
                    
                    for (const method of requiredMethods) {
                        if (typeof component[method] !== 'function') {
                            missingMethods.push(method);
                        }
                    }
                    
                    if (missingMethods.length > 0) {
                        throw new Error(
                            `${name} missing required methods: ${missingMethods.join(', ')}`
                        );
                    }
                    
                    return {
                        success: true,
                        interface: name,
                        methods: Object.keys(component).filter(k => typeof component[k] === 'function')
                    };
                }
            });
        }
        
        // 2. Validate event communication
        if (components.eventSystem) {
            integrationTests.push({
                name: 'Event System Communication',
                description: 'Testing event emission and listening',
                execute: async () => {
                    return new Promise((resolve) => {
                        const testEvent = 'test:integration:event';
                        const testData = { test: 'data', timestamp: Date.now() };
                        let eventReceived = false;
                        
                        const unsubscribe = components.eventSystem.on(testEvent, (data) => {
                            eventReceived = true;
                            
                            // Validate received data
                            if (JSON.stringify(data) !== JSON.stringify(testData)) {
                                resolve({
                                    success: false,
                                    error: 'Event data mismatch'
                                });
                                return;
                            }
                            
                            unsubscribe();
                            resolve({
                                success: true,
                                event: testEvent,
                                dataReceived: true
                            });
                        });
                        
                        // Emit event
                        components.eventSystem.emit(testEvent, testData);
                        
                        // Timeout fallback
                        setTimeout(() => {
                            if (!eventReceived) {
                                resolve({
                                    success: false,
                                    error: 'Event not received within timeout'
                                });
                            }
                        }, 1000);
                    });
                }
            });
        }
        
        // 3. Validate state management integration
        if (components.state && components.eventSystem) {
            integrationTests.push({
                name: 'State-Event Integration',
                description: 'Testing state updates trigger events',
                execute: async () => {
                    return new Promise((resolve) => {
                        const testPath = 'test.integration.value';
                        const testValue = 'integration_test_value';
                        let eventTriggered = false;
                        
                        const unsubscribe = components.eventSystem.on('state:changed', (eventData) => {
                            if (eventData.path === testPath && eventData.value === testValue) {
                                eventTriggered = true;
                                unsubscribe();
                                resolve({
                                    success: true,
                                    path: testPath,
                                    eventTriggered: true
                                });
                            }
                        });
                        
                        // Trigger state change
                        components.state.set(testPath, testValue, { source: 'integration_test' });
                        
                        setTimeout(() => {
                            if (!eventTriggered) {
                                resolve({
                                    success: false,
                                    error: 'State change did not trigger event'
                                });
                            }
                        }, 1000);
                    });
                }
            });
        }
        
        // Run all integration tests
        const results = [];
        for (const testCase of integrationTests) {
            const result = await this.runTest(testCase);
            results.push(result);
        }
        
        const integrationReport = {
            name: 'Integration Validation',
            totalTests: results.length,
            passedTests: results.filter(r => r.success).length,
            failedTests: results.filter(r => !r.success).length,
            totalDuration: Date.now() - startTime,
            componentCount: Object.keys(components).length,
            results: results,
            timestamp: Date.now()
        };
        
        this._eventSystem.emit('test:integration:validated', integrationReport);
        
        return integrationReport;
    }
    
    // ==================== UTILITY METHODS ====================
    
    createMockUser(userType = 'standard') {
        const userTypes = {
            standard: {
                id: 'usr_standard_' + Date.now(),
                name: 'کاربر تستی',
                email: 'test@vakamova.com',
                level: 'intermediate',
                streakDays: 7,
                dailyGoal: 30
            },
            admin: {
                id: 'usr_admin_' + Date.now(),
                name: 'مدیر سیستم',
                email: 'admin@vakamova.com',
                level: 'advanced',
                streakDays: 30,
                dailyGoal: 60,
                isAdmin: true
            },
            newbie: {
                id: 'usr_newbie_' + Date.now(),
                name: 'کاربر جدید',
                email: 'new@vakamova.com',
                level: 'beginner',
                streakDays: 1,
                dailyGoal: 15
            }
        };
        
        return userTypes[userType] || userTypes.standard;
    }
    
    createMockLesson(progress = 0) {
        return {
            id: 'les_' + Date.now(),
            title: 'درس تستی ' + Math.floor(Math.random() * 100),
            description: 'این یک درس تستی برای آزمایش سیستم است.',
            language: ['en', 'fa', 'ar'][Math.floor(Math.random() * 3)],
            level: ['beginner', 'intermediate', 'advanced'][Math.floor(Math.random() * 3)],
            duration: Math.floor(Math.random() * 30) + 5,
            progress: progress,
            thumbnail: null,
            createdAt: new Date().toISOString()
        };
    }
    
    simulateNetworkConditions(condition = 'online') {
        const conditions = {
            online: { latency: 50, successRate: 100 },
            slow3g: { latency: 2000, successRate: 100 },
            offline: { latency: 0, successRate: 0 },
            spotty: { latency: 1000, successRate: 70 }
        };
        
        const config = conditions[condition] || conditions.online;
        
        return {
            simulateRequest: async (requestFn) => {
                if (config.successRate < 100 && Math.random() * 100 > config.successRate) {
                    throw new Error('Simulated network failure');
                }
                
                if (config.latency > 0) {
                    await new Promise(resolve => setTimeout(resolve, config.latency));
                }
                
                return requestFn();
            },
            config
        };
    }
    
    clearResults() {
        const cleared = {
            testResults: this._testResults.size,
            loadedFiles: this._loadedFiles.size,
            mockRegistry: this._mockRegistry.size
        };
        
        this._testResults.clear();
        this._loadedFiles.clear();
        this._mockRegistry.clear();
        
        this._eventSystem.emit('test:results:cleared', cleared);
        
        return cleared;
    }
    
    getStatistics() {
        return {
            totalTests: this._testResults.size,
            loadedFiles: this._loadedFiles.size,
            mockObjects: this._mockRegistry.size,
            successRate: this._calculateSuccessRate()
        };
    }
    
    _calculateSuccessRate() {
        const results = Array.from(this._testResults.values());
        if (results.length === 0) return 100;
        
        const passed = results.filter(r => r.success).length;
        return (passed / results.length * 100).toFixed(2);
    }
}

// ==================== GLOBAL TEST UTILITY FUNCTIONS ====================

// Create singleton instance
let testUtilsInstance = null;

function getTestUtils(eventSystem = null) {
    if (!testUtilsInstance) {
        testUtilsInstance = new VakamovaTestUtils(eventSystem);
    }
    return testUtilsInstance;
}

// Helper function for quick assertions
function assert(condition, message = 'Assertion failed') {
    if (!condition) {
        const error = new Error(message);
        error.name = 'AssertionError';
        throw error;
    }
    return true;
}

function assertEquals(actual, expected, message = 'Values are not equal') {
    if (actual !== expected) {
        throw new Error(`${message}. Expected: ${expected}, Actual: ${actual}`);
    }
    return true;
}

function assertDefined(value, message = 'Value is undefined') {
    if (value === undefined || value === null) {
        throw new Error(message);
    }
    return true;
}

// Export everything
export { 
    VakamovaTestUtils, 
    getTestUtils, 
    assert, 
    assertEquals, 
    assertDefined 
};

// Auto-attach to window for quick testing
if (typeof window !== 'undefined') {
    window.TestUtils = {
        VakamovaTestUtils,
        getTestUtils,
        assert,
        assertEquals,
        assertDefined
    };
    console.log('[TestUtils] ✅ Global utilities attached to window.TestUtils');
          }
