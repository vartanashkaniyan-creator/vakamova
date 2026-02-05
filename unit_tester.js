// ==================== VAkamova Unit Tester ====================
// فایل: unit_tester.js - تستر واحد پیشرفته برای پروژه Vakamova

class VakamovaUnitTester {
    constructor() {
        this.results = new Map();
        this.metrics = {
            totalTests: 0,
            passed: 0,
            failed: 0,
            warnings: 0
        };
        
        this.config = {
            strictMode: false,
            timeout: 5000,
            checkDependencies: true,
            checkCohesion: true,
            exportRequirements: true
        };
    }
    
    // ==================== CORE TESTING METHODS ====================
    
    async testFile(filePath, options = {}) {
        const testId = `test_${Date.now()}`;
        const startTime = Date.now();
        
        console.log(`🧪 شروع تست فایل: ${filePath}`);
        
        try {
            // بارگذاری ماژول
            const module = await this.loadModule(filePath);
            
            // اجرای تست‌های مختلف
            const tests = {
                dependency: this.config.checkDependencies ? await this.testDependencies(module, filePath) : { skipped: true },
                cohesion: this.config.checkCohesion ? this.testCohesion(module) : { skipped: true },
                exports: this.config.exportRequirements ? this.testExports(module) : { skipped: true },
                functional: options.functionalTests ? await this.runFunctionalTests(module, options.functionalTests) : { skipped: true }
            };
            
            const executionTime = Date.now() - startTime;
            
            // جمع‌بندی نتایج
            const result = {
                filePath,
                tests,
                executionTime,
                timestamp: new Date().toISOString(),
                passed: Object.values(tests).every(t => t.skipped || t.passed),
                warnings: Object.values(tests).filter(t => t.warning).length
            };
            
            // ذخیره نتایج
            this.results.set(testId, result);
            this.updateMetrics(result);
            
            // نمایش گزارش
            this.printReport(result);
            
            return result;
            
        } catch (error) {
            const errorResult = {
                filePath,
                error: error.message,
                executionTime: Date.now() - startTime,
                timestamp: new Date().toISOString(),
                passed: false
            };
            
            console.error(`❌ خطا در تست ${filePath}:`, error.message);
            return errorResult;
        }
    }
    
    // ==================== DEPENDENCY TESTING ====================
    
    async testDependencies(module, filePath) {
        console.log(`  📦 بررسی وابستگی‌های ${filePath}`);
        
        const dependencies = {
            internal: new Set(),
            external: new Set(),
            circular: [],
            missing: []
        };
        
        try {
            // تحلیل کد برای پیدا کردن import/require
            const code = await this.fetchFileContent(filePath);
            
            // تشخیص import‌های ES6
            const es6Imports = code.match(/import\s+.*from\s+['"](.+?)['"]/g) || [];
            const es6Dynamic = code.match(/import\s*\(['"](.+?)['"]\)/g) || [];
            
            // تشخیص require‌های CommonJS
            const requires = code.match(/require\s*\(['"](.+?)['"]\)/g) || [];
            
            // استخراج مسیرها
            const allImports = [...es6Imports, ...es6Dynamic, ...requires]
                .map(imp => {
                    const match = imp.match(/['"](.+?)['"]/);
                    return match ? match[1] : null;
                })
                .filter(Boolean);
            
            // دسته‌بندی وابستگی‌ها
            for (const imp of allImports) {
                if (imp.startsWith('./') || imp.startsWith('../')) {
                    dependencies.internal.add(imp);
                    
                    // بررسی وجود فایل
                    try {
                        await this.checkFileExists(imp, filePath);
                    } catch (error) {
                        dependencies.missing.push(imp);
                    }
                } else if (imp.startsWith('http') || imp.includes('://')) {
                    dependencies.external.add(imp);
                } else {
                    dependencies.external.add(imp); // ماژول‌های npm
                }
            }
            
            // بررسی وابستگی‌های حلقوی (ساده)
            if (this.hasCircularDependencies(filePath, dependencies.internal)) {
                dependencies.circular.push('Possible circular dependency detected');
            }
            
            return {
                passed: dependencies.missing.length === 0 && dependencies.circular.length === 0,
                dependencies,
                warning: dependencies.circular.length > 0
            };
            
        } catch (error) {
            return {
                passed: false,
                error: error.message,
                dependencies: null
            };
        }
    }
    
    // ==================== COHESION TESTING ====================
    
    testCohesion(module) {
        console.log(`  🔗 بررسی پیوستگی ماژول`);
        
        const moduleKeys = Object.keys(module);
        const cohesionMetrics = {
            totalExports: moduleKeys.length,
            functionExports: moduleKeys.filter(key => typeof module[key] === 'function').length,
            classExports: moduleKeys.filter(key => typeof module[key] === 'function' && module[key].prototype).length,
            objectExports: moduleKeys.filter(key => typeof module[key] === 'object' && !Array.isArray(module[key])).length,
            constantExports: moduleKeys.filter(key => typeof module[key] !== 'function' && typeof module[key] !== 'object').length
        };
        
        // محاسبه متریک پیوستگی (ساده)
        const cohesionScore = this.calculateCohesionScore(cohesionMetrics);
        
        return {
            passed: cohesionScore >= 0.6, // آستانه پیوستگی قابل قبول
            metrics: cohesionMetrics,
            cohesionScore,
            warning: cohesionScore < 0.7
        };
    }
    
    calculateCohesionScore(metrics) {
        // یک متریک ساده برای پیوستگی
        const total = metrics.totalExports;
        if (total === 0) return 1.0; // ماژول خالی
        
        const functionRatio = metrics.functionExports / total;
        const relatedness = functionRatio * 0.7 + (metrics.classExports / total) * 0.3;
        
        return Math.min(1.0, relatedness);
    }
    
    // ==================== EXPORT TESTING ====================
    
    testExports(module) {
        console.log(`  📤 بررسی export‌های ماژول`);
        
        const exports = Object.keys(module);
        const issues = [];
        
        // بررسی export‌های نامعتبر
        exports.forEach(exp => {
            if (exp.startsWith('_')) {
                issues.push(`Private export "${exp}" should not be exported`);
            }
            
            if (exp.includes(' ')) {
                issues.push(`Export name "${exp}" contains spaces`);
            }
            
            if (module[exp] === undefined) {
                issues.push(`Export "${exp}" is undefined`);
            }
        });
        
        // بررسی default export
        const hasDefault = exports.includes('default');
        
        return {
            passed: issues.length === 0,
            totalExports: exports.length,
            hasDefaultExport: hasDefault,
            issues,
            warning: !hasDefault && exports.length > 3
        };
    }
    
    // ==================== FUNCTIONAL TESTING ====================
    
    async runFunctionalTests(module, testCases) {
        console.log(`  ⚡ اجرای تست‌های عملکردی`);
        
        const results = [];
        
        for (const testCase of testCases) {
            try {
                const { name, test, expected } = testCase;
                const start = Date.now();
                
                const result = await test(module);
                const executionTime = Date.now() - start;
                
                const passed = this.deepEqual(result, expected);
                
                results.push({
                    name,
                    passed,
                    executionTime,
                    result,
                    expected
                });
                
            } catch (error) {
                results.push({
                    name: testCase.name,
                    passed: false,
                    error: error.message
                });
            }
        }
        
        return {
            passed: results.every(r => r.passed),
            tests: results,
            total: results.length,
            passedCount: results.filter(r => r.passed).length
        };
    }
    
    // ==================== UTILITY METHODS ====================
    
    async loadModule(filePath) {
        if (typeof window !== 'undefined') {
            // محیط مرورگر
            return import(filePath).catch(() => {
                throw new Error(`Failed to load module: ${filePath}`);
            });
        } else {
            // محیط Node.js
            return require(filePath);
        }
    }
    
    async fetchFileContent(filePath) {
        if (typeof window !== 'undefined') {
            const response = await fetch(filePath);
            if (!response.ok) throw new Error(`Failed to fetch: ${filePath}`);
            return await response.text();
        } else {
            const fs = require('fs');
            const path = require('path');
            return fs.readFileSync(path.resolve(filePath), 'utf-8');
        }
    }
    
    async checkFileExists(importPath, basePath) {
        // پیاده‌سازی ساده بررسی وجود فایل
        return new Promise((resolve, reject) => {
            // در محیط واقعی باید مسیر را resolve و بررسی کنی
            resolve(true);
        });
    }
    
    hasCircularDependencies(filePath, dependencies) {
        // پیاده‌سازی ساده تشخیص وابستگی حلقوی
        // در نسخه کامل، باید گراف وابستگی‌ها را بسازی
        return false;
    }
    
    deepEqual(a, b) {
        return JSON.stringify(a) === JSON.stringify(b);
    }
    
    // ==================== REPORTING ====================
    
    printReport(result) {
        console.log(`\n📊 ===== گزارش تست: ${result.filePath} =====`);
        console.log(`⏱️  زمان اجرا: ${result.executionTime}ms`);
        console.log(`📅 تاریخ: ${result.timestamp}`);
        
        Object.entries(result.tests).forEach(([name, test]) => {
            if (test.skipped) {
                console.log(`  ⏭️  ${name}: رد شد`);
                return;
            }
            
            const icon = test.passed ? '✅' : '❌';
            const warn = test.warning ? ' ⚠️' : '';
            console.log(`  ${icon} ${name}: ${test.passed ? 'گذشت' : 'شکست'}${warn}`);
            
            if (name === 'dependency' && test.dependencies) {
                console.log(`    📦 وابستگی‌های داخلی: ${test.dependencies.internal.size}`);
                console.log(`    🌍 وابستگی‌های خارجی: ${test.dependencies.external.size}`);
                if (test.dependencies.missing.length > 0) {
                    console.log(`    ❌ فایل‌های مفقود: ${test.dependencies.missing.join(', ')}`);
                }
            }
            
            if (name === 'cohesion' && test.metrics) {
                console.log(`    🔗 نمره پیوستگی: ${test.cohesionScore.toFixed(2)}`);
                console.log(`    📊 تعداد export: ${test.metrics.totalExports}`);
            }
        });
        
        console.log(`\n🎯 نتیجه نهایی: ${result.passed ? '✅ تمام تست‌ها گذشتند' : '❌ نیاز به بررسی'}`);
        if (result.warnings > 0) {
            console.log(`⚠️  هشدارها: ${result.warnings} مورد`);
        }
    }
    
    updateMetrics(result) {
        this.metrics.totalTests++;
        if (result.passed) {
            this.metrics.passed++;
        } else {
            this.metrics.failed++;
        }
        this.metrics.warnings += result.warnings || 0;
    }
    
    // ==================== BATCH TESTING ====================
    
    async testBatch(fileList, options = {}) {
        console.log(`🚀 شروع تست دسته‌ای (${fileList.length} فایل)`);
        
        const results = [];
        const startTime = Date.now();
        
        for (const filePath of fileList) {
            const result = await this.testFile(filePath, options);
            results.push(result);
        }
        
        const totalTime = Date.now() - startTime;
        
        // گزارش کلی
        this.printBatchSummary(results, totalTime);
        
        return results;
    }
    
    printBatchSummary(results, totalTime) {
        const passed = results.filter(r => r.passed).length;
        const failed = results.length - passed;
        
        console.log(`\n📈 ===== خلاصه تست دسته‌ای =====`);
        console.log(`📁 تعداد فایل‌ها: ${results.length}`);
        console.log(`✅ موفق: ${passed}`);
        console.log(`❌ ناموفق: ${failed}`);
        console.log(`⏱️  زمان کل: ${totalTime}ms`);
        console.log(`📊 میانگین زمان هر تست: ${(totalTime / results.length).toFixed(2)}ms`);
        
        // فایل‌های ناموفق
        const failedFiles = results.filter(r => !r.passed).map(r => r.filePath);
        if (failedFiles.length > 0) {
            console.log(`\n🔴 فایل‌های نیازمند بررسی:`);
            failedFiles.forEach(file => console.log(`  ❌ ${file}`));
        }
    }
    
    // ==================== EXPORT AND CONFIG ====================
    
    exportResults(format = 'json') {
        const data = {
            metrics: this.metrics,
            results: Array.from(this.results.entries()).map(([id, result]) => ({
                id,
                ...result
            })),
            timestamp: new Date().toISOString(),
            project: 'Vakamova'
        };
        
        switch (format) {
            case 'json':
                return JSON.stringify(data, null, 2);
            case 'csv':
                return this.convertToCSV(data);
            case 'html':
                return this.generateHTMLReport(data);
            default:
                return data;
        }
    }
    
    convertToCSV(data) {
        // پیاده‌سازی ساده تبدیل به CSV
        const headers = ['File', 'Status', 'Execution Time', 'Dependencies', 'Cohesion Score'];
        const rows = data.results.map(r => [
            r.filePath,
            r.passed ? 'PASSED' : 'FAILED',
            r.executionTime,
            r.tests.dependency?.dependencies?.internal?.size || 0,
            r.tests.cohesion?.cohesionScore?.toFixed(2) || 'N/A'
        ]);
        
        return [headers, ...rows].map(row => row.join(',')).join('\n');
    }
    
    generateHTMLReport(data) {
        return `
            <!DOCTYPE html>
            <html dir="rtl" lang="fa">
            <head>
                <meta charset="UTF-8">
                <title>گزارش تست Vakamova</title>
                <style>
                    body { font-family: system-ui; padding: 20px; }
                    .passed { color: green; }
                    .failed { color: red; }
                    .warning { color: orange; }
                </style>
            </head>
            <body>
                <h1>گزارش تست واحد Vakamova</h1>
                <p>تاریخ: ${data.timestamp}</p>
                <p>تعداد تست‌ها: ${data.metrics.totalTests}</p>
                <p>موفق: <span class="passed">${data.metrics.passed}</span></p>
                <p>ناموفق: <span class="failed">${data.metrics.failed}</span></p>
            </body>
            </html>
        `;
    }
    
    // ==================== QUICK TEST METHODS ====================
    
    static async quickTest(filePath) {
        const tester = new VakamovaUnitTester();
        return await tester.testFile(filePath);
    }
    
    static async testDependenciesOnly(filePath) {
        const tester = new VakamovaUnitTester();
        tester.config.checkCohesion = false;
        tester.config.exportRequirements = false;
        return await tester.testFile(filePath);
    }
    
    static async testCohesionOnly(filePath) {
        const tester = new VakamovaUnitTester();
        tester.config.checkDependencies = false;
        tester.config.exportRequirements = false;
        return await tester.testFile(filePath);
    }
}

// ==================== GLOBAL ACCESS ====================
if (typeof window !== 'undefined') {
    window.VakamovaTester = VakamovaUnitTester;
    console.log('🧪 تستر واحد Vakamova بارگذاری شد. دستورات:');
    console.log('  - VakamovaTester.quickTest("path/to/file.js")');
    console.log('  - new VakamovaTester().testBatch([file1, file2])');
}

// ==================== SAMPLE USAGE ====================
/*
// مثال استفاده در پروژه Vakamova:
const tester = new VakamovaUnitTester();

// تست یک فایل
tester.testFile('core/event_bus.js')
    .then(result => console.log('نتیجه:', result));

// تست دسته‌ای
tester.testBatch([
    'core/state_manager.js',
    'modules/auth/auth_manager.js',
    'components/Button.js'
]);

// تست با تنظیمات خاص
tester.testFile('core/router.js', {
    functionalTests: [
        {
            name: 'Route Creation',
            test: (module) => module.createRoute('/test', () => {}),
            expected: { path: '/test', handler: expect.any(Function) }
        }
    ]
});
*/

export { VakamovaUnitTester };
