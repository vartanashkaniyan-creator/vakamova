// ==================== VAkamova Advanced Unit Tester ====================
// فایل: unit_tester.js - تستر واحد پیشرفته منطبق با معماری Event-Driven
// نسخه: 2.0.0 | سازگار با معماری Vakamova

class VakamovaUnitTester {
    constructor(eventBus = null, config = {}) {
        // اتصال به Event Bus پروژه
        this.eventBus = eventBus || (window.eventBus ? window.eventBus : null);
        
        this.results = new Map();
        this.metrics = {
            totalTests: 0,
            passed: 0,
            failed: 0,
            warnings: 0,
            startTime: Date.now()
        };
        
        this.config = {
            strictMode: config.strictMode || false,
            timeout: config.timeout || 10000,
            checkDependencies: config.checkDependencies !== false,
            checkCohesion: config.checkCohesion !== false,
            checkExports: config.checkExports !== false,
            autoConnectToEventBus: config.autoConnectToEventBus !== false,
            logToConsole: config.logToConsole !== false,
            ...config
        };
        
        this.dependencyGraph = new Map();
        this.fileCache = new Map();
        
        // اتصال به Event Bus اگر فعال باشد
        if (this.config.autoConnectToEventBus && this.eventBus) {
            this.setupEventListeners();
        }
        
        console.log('🧪 تستر واحد Vakamova v2.0.0 بارگذاری شد');
    }
    
    // ==================== EVENT SYSTEM INTEGRATION ====================
    
    setupEventListeners() {
        if (!this.eventBus) return;
        
        // گوش دادن به درخواست‌های تست
        this.eventBus.on('tester:run_test', async (data) => {
            const result = await this.testFile(data.filePath, data.options);
            this.eventBus.emit('tester:test_completed', result);
        });
        
        // گوش دادن به درخواست تست دسته‌ای
        this.eventBus.on('tester:run_batch', async (data) => {
            const results = await this.testBatch(data.fileList, data.options);
            this.eventBus.emit('tester:batch_completed', results);
        });
        
        // گوش دادن به درخواست گزارش
        this.eventBus.on('tester:get_report', () => {
            const report = this.exportResults('json');
            this.eventBus.emit('tester:report_generated', report);
        });
        
        console.log('✅ تستر به سیستم رویداد متصل شد');
    }
    
    // ==================== CORE TESTING METHODS ====================
    
    async testFile(filePath, options = {}) {
        const testId = `test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const startTime = Date.now();
        
        this.log(`🧪 شروع تست فایل: ${filePath}`, 'info');
        
        try {
            // اعتبارسنجی مسیر فایل
            if (!await this.validateFilePath(filePath)) {
                throw new Error(`مسیر فایل نامعتبر است: ${filePath}`);
            }
            
            // بارگذاری ماژول
            const module = await this.loadModule(filePath);
            
            // اجرای تست‌های مختلف
            const tests = {
                fileValidation: await this.testFileValidation(filePath),
                dependencies: this.config.checkDependencies ? 
                    await this.testDependenciesAdvanced(filePath) : { skipped: true },
                cohesion: this.config.checkCohesion ? 
                    this.testCohesionAdvanced(module, filePath) : { skipped: true },
                exports: this.config.checkExports ? 
                    this.testExportsAdvanced(module, filePath) : { skipped: true },
                functional: options.functionalTests ? 
                    await this.runFunctionalTests(module, options.functionalTests) : { skipped: true }
            };
            
            const executionTime = Date.now() - startTime;
            
            // جمع‌بندی نتایج
            const result = {
                id: testId,
                filePath,
                tests,
                executionTime,
                timestamp: new Date().toISOString(),
                passed: Object.values(tests).every(t => t.skipped || t.passed),
                warnings: Object.values(tests).filter(t => t.warning).length,
                score: this.calculateTestScore(tests)
            };
            
            // ذخیره نتایج
            this.results.set(testId, result);
            this.updateMetrics(result);
            
            // نمایش گزارش
            this.printReport(result);
            
            // انتشار رویداد تکمیل تست
            if (this.eventBus) {
                this.eventBus.emit('tester:test_finished', {
                    testId,
                    result,
                    filePath
                });
            }
            
            return result;
            
        } catch (error) {
            const errorResult = {
                id: testId,
                filePath,
                error: error.message,
                stack: error.stack,
                executionTime: Date.now() - startTime,
                timestamp: new Date().toISOString(),
                passed: false,
                score: 0
            };
            
            this.log(`❌ خطا در تست ${filePath}: ${error.message}`, 'error');
            
            // انتشار رویداد خطا
            if (this.eventBus) {
                this.eventBus.emit('tester:test_error', errorResult);
            }
            
            return errorResult;
        }
    }
    
    // ==================== ADVANCED DEPENDENCY TESTING ====================
    
    async testDependenciesAdvanced(filePath) {
        this.log(`  📦 بررسی پیشرفته وابستگی‌های ${filePath}`, 'info');
        
        const dependencies = {
            internal: new Map(),    // مسیر → نوع وابستگی
            external: new Map(),    // نام ماژول → نسخه (اگر باشد)
            circular: [],
            missing: [],
            depth: 0,
            analyzed: false
        };
        
        try {
            // خواندن محتوای فایل
            const code = await this.readFileContent(filePath);
            
            // تحلیل ساختار فایل
            const analysis = await this.analyzeFileStructure(filePath, code);
            
            // استخراج وابستگی‌های ES6
            const es6Imports = this.extractES6Imports(code);
            
            // استخراج وابستگی‌های Dynamic
            const dynamicImports = this.extractDynamicImports(code);
            
            // ادغام همه وابستگی‌ها
            const allDeps = [...es6Imports, ...dynamicImports];
            
            // تحلیل هر وابستگی
            for (const dep of allDeps) {
                const depInfo = await this.analyzeDependency(dep, filePath);
                
                if (depInfo.type === 'internal') {
                    dependencies.internal.set(depInfo.resolvedPath, {
                        original: dep,
                        type: depInfo.importType,
                        exists: depInfo.exists,
                        isRelative: depInfo.isRelative
                    });
                    
                    if (!depInfo.exists) {
                        dependencies.missing.push(depInfo.resolvedPath);
                    }
                    
                    // بررسی بازگشتی وابستگی‌های داخلی
                    if (depInfo.exists && options?.deepAnalysis) {
                        const subDeps = await this.testDependenciesAdvanced(depInfo.resolvedPath);
                        dependencies.depth = Math.max(dependencies.depth, subDeps.depth + 1);
                    }
                } else {
                    dependencies.external.set(depInfo.name, {
                        type: depInfo.type,
                        version: depInfo.version,
                        isNodeModule: depInfo.isNodeModule
                    });
                }
            }
            
            // بررسی وابستگی‌های حلقوی با الگوریتم DFS
            const circular = this.detectCircularDependencies(filePath, Array.from(dependencies.internal.keys()));
            dependencies.circular = circular;
            
            // محاسبه متریک وابستگی
            const dependencyMetrics = this.calculateDependencyMetrics(dependencies);
            
            dependencies.analyzed = true;
            dependencies.metrics = dependencyMetrics;
            
            return {
                passed: dependencies.missing.length === 0 && dependencies.circular.length === 0,
                dependencies,
                metrics: dependencyMetrics,
                warning: dependencies.circular.length > 0 || dependencies.missing.length > 0
            };
            
        } catch (error) {
            return {
                passed: false,
                error: error.message,
                dependencies,
                warning: true
            };
        }
    }
    
    // ==================== ADVANCED COHESION TESTING ====================
    
    testCohesionAdvanced(module, filePath) {
        this.log(`  🔗 بررسی پیشرفته پیوستگی ماژول`, 'info');
        
        try {
            const moduleKeys = Object.keys(module);
            
            // تحلیل عمیق‌تر ساختار ماژول
            const cohesionAnalysis = {
                totalExports: moduleKeys.length,
                byType: {
                    functions: [],
                    classes: [],
                    objects: [],
                    constants: [],
                    others: []
                },
                exportNames: [],
                complexity: 0
            };
            
            // دسته‌بندی و تحلیل هر export
            moduleKeys.forEach(key => {
                const value = module[key];
                const type = this.determineExportType(value);
                
                cohesionAnalysis.exportNames.push(key);
                cohesionAnalysis.byType[type].push(key);
                
                // محاسبه پیچیدگی
                cohesionAnalysis.complexity += this.calculateExportComplexity(value);
            });
            
            // محاسبه متریک‌های پیوستگی پیشرفته
            const cohesionMetrics = {
                lcom4: this.calculateLCOM4(cohesionAnalysis), // Lack of Cohesion of Methods
                cohesionScore: this.calculateAdvancedCohesionScore(cohesionAnalysis),
                responsibilityScore: this.calculateSingleResponsibilityScore(cohesionAnalysis),
                exportDistribution: this.calculateExportDistribution(cohesionAnalysis),
                suggestion: this.generateCohesionSuggestion(cohesionAnalysis)
            };
            
            return {
                passed: cohesionMetrics.cohesionScore >= 0.65,
                analysis: cohesionAnalysis,
                metrics: cohesionMetrics,
                warning: cohesionMetrics.cohesionScore < 0.7 || cohesionMetrics.lcom4 > 2
            };
            
        } catch (error) {
            return {
                passed: false,
                error: error.message,
                warning: true
            };
        }
    }
    
    // ==================== ADVANCED EXPORT TESTING ====================
    
    testExportsAdvanced(module, filePath) {
        this.log(`  📤 بررسی پیشرفته export‌ها`, 'info');
        
        const exports = Object.keys(module);
        const issues = [];
        const suggestions = [];
        const exportAnalysis = [];
        
        exports.forEach(exp => {
            const analysis = {
                name: exp,
                type: this.determineExportType(module[exp]),
                isValid: true,
                issues: [],
                suggestions: []
            };
            
            // بررسی‌های نام export
            if (!this.isValidExportName(exp)) {
                analysis.isValid = false;
                analysis.issues.push('نام export نامعتبر است');
                issues.push(`نام export نامعتبر: "${exp}"`);
            }
            
            if (exp.startsWith('_') && exp !== '_') {
                analysis.warning = true;
                analysis.suggestions.push('نام‌های با underscore بهتر است export نشوند');
                suggestions.push(`Export خصوصی: "${exp}"`);
            }
            
            if (exp.includes('-')) {
                analysis.suggestions.push('استفاده از camelCase برای نام export توصیه می‌شود');
            }
            
            // بررسی مقدار export
            if (module[exp] === undefined) {
                analysis.isValid = false;
                analysis.issues.push('مقدار export undefined است');
                issues.push(`Export undefined: "${exp}"`);
            }
            
            if (module[exp] === null) {
                analysis.warning = true;
                analysis.suggestions.push('مقدار null ممکن است باعث خطا شود');
            }
            
            exportAnalysis.push(analysis);
        });
        
        // بررسی default export
        const hasDefault = exports.includes('default');
        const defaultExport = hasDefault ? module.default : null;
        
        return {
            passed: issues.length === 0,
            totalExports: exports.length,
            hasDefaultExport: hasDefault,
            defaultExportType: defaultExport ? this.determineExportType(defaultExport) : null,
            exportAnalysis,
            issues,
            suggestions,
            warning: issues.length > 0 || suggestions.length > 3
        };
    }
    
    // ==================== FILE VALIDATION ====================
    
    async testFileValidation(filePath) {
        try {
            const stats = await this.getFileStats(filePath);
            const content = await this.readFileContent(filePath);
            
            return {
                passed: true,
                stats: {
                    size: stats.size,
                    modified: stats.mtime,
                    lines: content.split('\n').length,
                    characters: content.length
                },
                validation: {
                    hasBOM: content.startsWith('\uFEFF'),
                    encoding: this.detectEncoding(content),
                    lineEndings: this.detectLineEndings(content)
                }
            };
        } catch (error) {
            return {
                passed: false,
                error: error.message
            };
        }
    }
    
    // ==================== UTILITY METHODS ====================
    
    async validateFilePath(filePath) {
        // اعتبارسنجی مسیر فایل
        if (!filePath || typeof filePath !== 'string') return false;
        if (filePath.includes('..')) return false; // مسیرهای نسبی خطرناک
        
        try {
            // در محیط مرورگر
            if (typeof window !== 'undefined') {
                const response = await fetch(filePath, { method: 'HEAD' });
                return response.ok;
            }
            // در محیط Node.js
            else {
                const fs = require('fs');
                return fs.existsSync(filePath);
            }
        } catch (error) {
            return false;
        }
    }
    
    async loadModule(filePath) {
        // بارگذاری ماژول با پشتیبانی از خطاهای بهتر
        try {
            if (typeof window !== 'undefined') {
                // در مرورگر با dynamic import
                const module = await import(filePath + '?t=' + Date.now()); // جلوگیری از کش
                return module;
            } else {
                // در Node.js
                const module = await import('file://' + require('path').resolve(filePath));
                return module;
            }
        } catch (error) {
            // خطاهای خاص را بررسی کن
            if (error.message.includes('Cannot find module')) {
                throw new Error(`ماژول پیدا نشد: ${filePath}`);
            }
            if (error.message.includes('Unexpected token')) {
                throw new Error(`خطای syntax در فایل: ${filePath}`);
            }
            throw error;
        }
    }
    
    async readFileContent(filePath) {
        // خواندن محتوای فایل
        if (this.fileCache.has(filePath)) {
            return this.fileCache.get(filePath);
        }
        
        try {
            let content;
            if (typeof window !== 'undefined') {
                const response = await fetch(filePath);
                if (!response.ok) throw new Error(`خطای HTTP ${response.status}`);
                content = await response.text();
            } else {
                const fs = require('fs');
                content = fs.readFileSync(filePath, 'utf-8');
            }
            
            this.fileCache.set(filePath, content);
            return content;
        } catch (error) {
            throw new Error(`خطا در خواندن فایل ${filePath}: ${error.message}`);
        }
    }
    
    // ==================== ANALYSIS METHODS ====================
    
    extractES6Imports(code) {
        const imports = [];
        
        // الگوی import استاندارد
        const standardImports = code.match(/import\s+.*from\s+['"](.+?)['"]/g) || [];
        // الگوی import بدون from
        const sideEffectImports = code.match(/import\s+['"](.+?)['"]/g) || [];
        // الگوی import با نام‌های مختلف
        const namedImports = code.match(/import\s*{.*}\s*from\s+['"](.+?)['"]/g) || [];
        
        // استخراج مسیرها
        [...standardImports, ...sideEffectImports, ...namedImports].forEach(imp => {
            const match = imp.match(/['"](.+?)['"]/);
            if (match && match[1]) {
                imports.push(match[1]);
            }
        });
        
        return [...new Set(imports)]; // حذف موارد تکراری
    }
    
    extractDynamicImports(code) {
        const imports = [];
        const dynamicPattern = /import\s*\(['"](.+?)['"]\)/g;
        
        let match;
        while ((match = dynamicPattern.exec(code)) !== null) {
            imports.push(match[1]);
        }
        
        return imports;
    }
    
    async analyzeDependency(dep, basePath) {
        const analysis = {
            original: dep,
            resolvedPath: null,
            type: 'unknown',
            exists: false,
            isRelative: false,
            importType: 'unknown'
        };
        
        // تشخیص نوع وابستگی
        if (dep.startsWith('./') || dep.startsWith('../')) {
            analysis.type = 'internal';
            analysis.isRelative = true;
            
            // resolve مسیر
            analysis.resolvedPath = this.resolvePath(dep, basePath);
            
            // بررسی وجود فایل
            analysis.exists = await this.validateFilePath(analysis.resolvedPath);
            
            // تشخیص نوع import
            if (dep.endsWith('.js') || dep.endsWith('.mjs')) {
                analysis.importType = 'module';
            } else if (dep.endsWith('.json')) {
                analysis.importType = 'json';
            } else {
                analysis.importType = 'package';
            }
        }
        else if (dep.startsWith('http://') || dep.startsWith('https://')) {
            analysis.type = 'external';
            analysis.importType = 'url';
            analysis.resolvedPath = dep;
            analysis.exists = await this.validateFilePath(dep);
        }
        else {
            // احتمالاً ماژول npm یا ماژول core
            analysis.type = 'external';
            analysis.name = dep.split('/')[0];
            analysis.isNodeModule = true;
            analysis.importType = 'package';
        }
        
        return analysis;
    }
    
    resolvePath(relativePath, basePath) {
        // ساده‌سازی resolve مسیر (نسخه کامل‌تر در محیط واقعی)
        if (typeof window !== 'undefined') {
            const baseDir = basePath.substring(0, basePath.lastIndexOf('/'));
            return baseDir + '/' + relativePath;
        } else {
            const path = require('path');
            return path.resolve(path.dirname(basePath), relativePath);
        }
    }
    
    detectCircularDependencies(startPath, dependencies) {
        const visited = new Set();
        const stack = new Set();
        const circular = [];
        
        const dfs = (currentPath) => {
            if (stack.has(currentPath)) {
                circular.push(Array.from(stack).concat(currentPath));
                return;
            }
            
            if (visited.has(currentPath)) return;
            
            visited.add(currentPath);
            stack.add(currentPath);
            
            // بررسی وابستگی‌های این فایل
            const deps = this.dependencyGraph.get(currentPath) || [];
            deps.forEach(dep => {
                if (dependencies.includes(dep)) {
                    dfs(dep);
                }
            });
            
            stack.delete(currentPath);
        };
        
        dfs(startPath);
        return circular;
    }
    
    // ==================== METRIC CALCULATIONS ====================
    
    calculateTestScore(tests) {
        let score = 0;
        let weight = 0;
        
        const weights = {
            fileValidation: 0.1,
            dependencies: 0.3,
            cohesion: 0.3,
            exports: 0.2,
            functional: 0.1
        };
        
        Object.entries(tests).forEach(([name, test]) => {
            if (test.skipped) return;
            
            if (test.passed) {
                score += weights[name] || 0.1;
            }
            
            weight += weights[name] || 0.1;
        });
        
        return weight > 0 ? (score / weight) * 100 : 0;
    }
    
    calculateDependencyMetrics(dependencies) {
        const internalCount = dependencies.internal.size;
        const externalCount = dependencies.external.size;
        const total = internalCount + externalCount;
        
        return {
            total,
            internalRatio: total > 0 ? internalCount / total : 0,
            externalRatio: total > 0 ? externalCount / total : 0,
            missingCount: dependencies.missing.length,
            circularCount: dependencies.circular.length,
            depth: dependencies.depth,
            complexity: this.calculateDependencyComplexity(dependencies)
        };
    }
    
    calculateAdvancedCohesionScore(analysis) {
        const { totalExports, byType } = analysis;
        if (totalExports === 0) return 1.0;
        
        // هرچه تعداد export‌ها از یک نوع بیشتر باشد، پیوستگی بیشتر است
        const maxGroup = Math.max(
            byType.functions.length,
            byType.classes.length,
            byType.objects.length,
            byType.constants.length
        );
        
        const homogeneity = maxGroup / totalExports;
        const typeConcentration = 1 - (Object.values(byType).filter(arr => arr.length > 0).length / 5);
        
        return (homogeneity * 0.6 + typeConcentration * 0.4);
    }
    
    calculateLCOM4(analysis) {
        // محاسبه Lack of Cohesion of Methods (نسخه ساده‌شده)
        const { byType } = analysis;
        const methods = byType.functions.length + byType.classes.length;
        
        if (methods <= 1) return 0;
        
        const totalExports = analysis.totalExports;
        const unrelatedExports = totalExports - methods;
        
        return Math.max(0, unrelatedExports / totalExports);
    }
    
    // ==================== REPORTING ====================
    
    printReport(result) {
        if (!this.config.logToConsole) return;
        
        const color = result.passed ? '#4CAF50' : '#F44336';
        const emoji = result.passed ? '✅' : '❌';
        
        console.log(`%c${emoji} ===== گزارش تست: ${result.filePath} =====`, 
            `font-weight: bold; color: ${color}; font-size: 14px;`);
        console.log(`⏱️  زمان اجرا: ${result.executionTime}ms | 📊 امتیاز: ${result.score.toFixed(1)}%`);
        
        Object.entries(result.tests).forEach(([name, test]) => {
            if (test.skipped) {
                console.log(`  ⏭️  ${this.formatTestName(name)}: رد شد`);
                return;
            }
            
            const icon = test.passed ? '✓' : '✗';
            const color = test.passed ? 'green' : 'red';
            const warn = test.warning ? ' ⚠️' : '';
            
            console.log(`  %c${icon} ${this.formatTestName(name)}: ${test.passed ? 'گذشت' : 'شکست'}${warn}`, 
                `color: ${color}`);
            
            // نمایش جزئیات برای تست‌های مهم
            if (name === 'dependencies' && test.dependencies) {
                const metrics = test.metrics || {};
                console.log(`    📦 وابستگی‌ها: ${metrics.total || 0} کل | ${test.dependencies.internal.size} داخلی | ${test.dependencies.external.size} خارجی`);
                if (test.dependencies.missing.length > 0) {
                    console.log(`    ❌ مفقود: ${test.dependencies.missing.join(', ')}`);
                }
            }
            
            if (name === 'cohesion' && test.metrics) {
                console.log(`    🔗 پیوستگی: ${(test.metrics.cohesionScore * 100).toFixed(1)}% | LCOM4: ${test.metrics.lcom4.toFixed(2)}`);
            }
        });
        
        console.log(`\n🎯 نتیجه نهایی: ${result.passed ? '✅ موفق' : '❌ نیاز به بررسی'} | امتیاز: ${result.score.toFixed(1)}%`);
    }
    
    formatTestName(name) {
        const names = {
            fileValidation: 'اعتبارسنجی فایل',
            dependencies: 'وابستگی‌ها',
            cohesion: 'پیوستگی',
            exports: 'Export‌ها',
            functional: 'عملکردی'
        };
        return names[name] || name;
    }
    
    log(message, level = 'info') {
        if (!this.config.logToConsole) return;
        
        const colors = {
            info: '#64B5F6',
            success: '#4CAF50',
            warning: '#FF9800',
            error: '#F44336'
        };
        
        const emoji = {
            info: 'ℹ️',
            success: '✅',
            warning: '⚠️',
            error: '❌'
        };
        
        console.log(`%c${emoji[level]} ${message}`, `color: ${colors[level]}`);
        
        // انتشار رویداد لاگ
        if (this.eventBus) {
            this.eventBus.emit('tester:log', { message, level, timestamp: new Date().toISOString() });
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
        this.log(`🚀 شروع تست دسته‌ای (${fileList.length} فایل)`, 'info');
        
        const results = [];
        const startTime = Date.now();
        
        // انتشار رویداد شروع
        if (this.eventBus) {
            this.eventBus.emit('tester:batch_started', {
                fileCount: fileList.length,
                timestamp: startTime
            });
        }
        
        for (let i = 0; i < fileList.length; i++) {
            const filePath = fileList[i];
            
            // انتشار رویداد پیشرفت
            if (this.eventBus) {
                this.eventBus.emit('tester:batch_progress', {
                    current: i + 1,
                    total: fileList.length,
                    filePath,
                    percentage: ((i + 1) / fileList.length) * 100
                });
            }
            
            const result = await this.testFile(filePath, options);
            results.push(result);
        }
        
        const totalTime = Date.now() - startTime;
        
        // گزارش کلی
        this.printBatchSummary(results, totalTime);
        
        // انتشار رویداد اتمام
        if (this.eventBus) {
            this.eventBus.emit('tester:batch_finished', {
                results,
                totalTime,
                metrics: this.calculateBatchMetrics(results)
            });
        }
        
        return results;
    }
    
    printBatchSummary(results, totalTime) {
        const passed = results.filter(r => r.passed).length;
        const failed = results.length - passed;
        const avgScore = results.reduce((sum, r) => sum + (r.score || 0), 0) / results.length;
        
        console.log(`\n%c📈 ===== خلاصه تست دسته‌ای =====`, 'font-weight: bold; font-size: 16px; color: #2196F3;');
        console.log(`📁 تعداد فایل‌ها: ${results.length}`);
        console.log(`✅ موفق: ${passed} (${((passed / results.length) * 100).toFixed(1)}%)`);
        console.log(`❌ ناموفق: ${failed} (${((failed / results.length) * 100).toFixed(1)}%)`);
        console.log(`📊 میانگین امتیاز: ${avgScore.toFixed(1)}%`);
        console.log(`⏱️  زمان کل: ${totalTime}ms | میانگین: ${(totalTime / results.length).toFixed(2)}ms`);
        
        // فایل‌های ناموفق
        const failedFiles = results.filter(r => !r.passed).map(r => ({ path: r.filePath, error: r.error }));
        if (failedFiles.length > 0) {
            console.log(`\n🔴 فایل‌های نیازمند بررسی:`);
            failedFiles.forEach((file, i) => {
                console.log(`  ${i + 1}. ❌ ${file.path}`);
                if (file.error) console.log(`     ${file.error}`);
            });
        }
        
        // فایل‌های با امتیاز پایین
        const lowScoreFiles = results.filter(r => r.score < 70 && r.passed);
        if (lowScoreFiles.length > 0) {
            console.log(`\n🟡 فایل‌های با امتیاز پایین (کمتر از ۷۰):`);
            lowScoreFiles.forEach((file, i) => {
                console.log(`  ${i + 1}. ⚠️ ${file.path} - ${file.score.toFixed(1)}%`);
            });
        }
    }
    
    calculateBatchMetrics(results) {
        return {
            total: results.length,
            passed: results.filter(r => r.passed).length,
            failed: results.filter(r => !r.passed).length,
            avgScore: results.reduce((sum, r) => sum + (r.score || 0), 0) / results.length,
            totalTime: results.reduce((sum, r) => sum + r.executionTime, 0),
            warnings: results.reduce((sum, r) => sum + (r.warnings || 0), 0)
        };
    }
    
    // ==================== EXPORT METHODS ====================
    
    exportResults(format = 'json') {
        const data = {
            project: 'Vakamova',
            version: '2.0.0',
            timestamp: new Date().toISOString(),
            metrics: { ...this.metrics, uptime: Date.now() - this.metrics.startTime },
            results: Array.from(this.results.entries()).map(([id, result]) => ({
                id,
                ...result
            })),
            summary: this.generateSummary()
        };
        
        switch (format) {
            case 'json':
                return JSON.stringify(data, null, 2);
            case 'html':
                return this.generateHTMLReport(data);
            case 'csv':
                return this.generateCSVReport(data);
            case 'markdown':
                return this.generateMarkdownReport(data);
            default:
                return data;
        }
    }
    
    generateSummary() {
        const passed = this.metrics.passed;
        const total = this.metrics.totalTests;
        const successRate = total > 0 ? (passed / total) * 100 : 0;
        
        return {
            successRate: successRate.toFixed(1),
            totalTests: total,
            passed,
            failed: this.metrics.failed,
            warnings: this.metrics.warnings,
            recommendation: this.generateRecommendation(successRate)
        };
    }
    
    generateRecommendation(successRate) {
        if (successRate >= 90) return 'کیفیت کد عالی است. ادامه دهید!';
        if (successRate >= 70) return 'کیفیت قابل قبول. برخی فایل‌ها نیاز به بازبینی دارند.';
        if (successRate >= 50) return 'نیاز به بهبود جدی. وابستگی‌ها و پیوستگی را بررسی کنید.';
        return 'وضعیت بحرانی. نیاز به بازنویسی بخش‌های زیادی دارید.';
    }
    
    generateHTMLReport(data) {
        // ایجاد گزارش HTML زیبا
        return `
            <!DOCTYPE html>
            <html dir="rtl" lang="fa">
            <head>
                <meta charset="UTF-8">
                <title>گزارش تست Vakamova</title>
                <style>
                    body { font-family: 'Vazirmatn', system-ui; padding: 20px; background: #f5f5f5; }
                    .report { max-width: 1200px; margin: 0 auto; background: white; border-radius: 10px; padding: 30px; box-shadow: 0 5px 15px rgba(0,0,0,0.1); }
                    .header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #4CAF50; padding-bottom: 20px; }
                    .metric-card { background: #f8f9fa; border-radius: 8px; padding: 20px; margin: 10px; display: inline-block; min-width: 200px; }
                    .passed { color: #4CAF50; font-weight: bold; }
                    .failed { color: #F44336; font-weight: bold; }
                    .warning { color: #FF9800; }
                    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                    th, td { padding: 12px; text-align: right; border-bottom: 1px solid #ddd; }
                    th { background: #4CAF50; color: white; }
                </style>
            </head>
            <body>
                <div class="report">
                    <div class="header">
                        <h1>📊 گزارش تست واحد Vakamova</h1>
                        <p>تاریخ: ${data.timestamp}</p>
                    </div>
                    
                    <div style="text-align: center;">
                        <div class="metric-card">
                            <h3>تعداد تست‌ها</h3>
                            <p style="font-size: 2em;">${data.metrics.totalTests}</p>
                        </div>
                        <div class="metric-card">
                            <h3>موفق</h3>
                            <p class="passed" style="font-size: 2em;">${data.metrics.passed}</p>
                        </div>
                        <div class="metric-card">
                            <h3>ناموفق</h3>
                            <p class="failed" style="font-size: 2em;">${data.metrics.failed}</p>
                        </div>
                        <div class="metric-card">
                            <h3>نرخ موفقیت</h3>
                            <p style="font-size: 2em; color: #2196F3;">${data.summary.successRate}%</p>
                        </div>
                    </div>
                    
                    <h2>نتایج تفصیلی</h2>
                    <table>
                        <thead>
                            <tr>
                                <th>فایل</th>
                                <th>وضعیت</th>
                                <th>امتیاز</th>
                                <th>زمان</th>
                                <th>هشدارها</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${data.results.map(r => `
                                <tr>
                                    <td>${r.filePath}</td>
                                    <td class="${r.passed ? 'passed' : 'failed'}">${r.passed ? '✅ موفق' : '❌ ناموفق'}</td>
                                    <td>${r.score ? r.score.toFixed(1) + '%' : 'N/A'}</td>
                                    <td>${r.executionTime}ms</td>
                                    <td class="${r.warnings > 0 ? 'warning' : ''}">${r.warnings || 0}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                    
                    <div style="margin-top: 30px; padding: 20px; background: #E8F5E9; border-radius: 8px;">
                        <h3>💡 توصیه</h3>
                        <p>${data.summary.recommendation}</p>
                    </div>
                </div>
            </body>
            </html>
        `;
    }
    
    generateCSVReport(data) {
        const headers = ['File', 'Status', 'Score', 'Execution Time', 'Warnings', 'Timestamp'];
        const rows = data.results.map(r => [
            r.filePath,
            r.passed ? 'PASSED' : 'FAILED',
            r.score ? r.score.toFixed(1) + '%' : 'N/A',
            r.executionTime + 'ms',
            r.warnings || 0,
            r.timestamp
        ]);
        
        return [headers, ...rows].map(row => row.join(',')).join('\n');
    }
    
    // ==================== QUICK TEST METHODS ====================
    
    static async quickTest(filePath, eventBus = null) {
        const tester = new VakamovaUnitTester(eventBus, {
            logToConsole: true,
            autoConnectToEventBus: false
        });
        
        return await tester.testFile(filePath);
    }
    
    static async comprehensiveTest(filePath, eventBus = null) {
        const tester = new VakamovaUnitTester(eventBus, {
            logToConsole: true,
            checkDependencies: true,
            checkCohesion: true,
            checkExports: true,
            strictMode: true
        });
        
        return await tester.testFile(filePath, {
            functionalTests: [
                {
                    name: 'Module Integrity',
                    test: (module) => {
                        return {
                            isObject: typeof module === 'object',
                            hasExports: Object.keys(module).length > 0,
                            isValid: module !== null && module !== undefined
                        };
                    },
                    expected: { isObject: true, hasExports: true, isValid: true }
                }
            ]
        });
    }
    
    // ==================== HELPER METHODS ====================
    
    determineExportType(value) {
        if (typeof value === 'function') {
            return value.prototype && value.prototype.constructor ? 'classes' : 'functions';
        }
        if (typeof value === 'object' && value !== null) {
            if (Array.isArray(value)) return 'arrays';
            return 'objects';
        }
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            return 'constants';
        }
        return 'others';
    }
    
    isValidExportName(name) {
        // نام‌های مجاز برای export
        const validPattern = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;
        const reservedWords = ['default', 'import', 'export', 'class', 'function', 'var', 'let', 'const'];
        
        return validPattern.test(name) && !reservedWords.includes(name);
    }
    
    calculateExportComplexity(value) {
        // محاسبه ساده پیچیدگی
        if (typeof value === 'function') {
            // برای توابع، طول کد را تخمین بزن
            return value.toString().length / 100;
        }
        if (typeof value === 'object' && value !== null) {
            // برای آبجکت‌ها، تعداد پراپرتی‌ها
            return Object.keys(value).length / 10;
        }
        return 0.1; // مقادیر ساده
    }
    
    calculateSingleResponsibilityScore(analysis) {
        // هرچه تعداد export‌های هم‌نوع بیشتر باشد، مسئولیت واحدتر است
        const maxGroup = Math.max(
            analysis.byType.functions.length,
            analysis.byType.classes.length,
            analysis.byType.objects.length,
            analysis.byType.constants.length
        );
        
        return maxGroup / analysis.totalExports;
    }
    
    calculateExportDistribution(analysis) {
        const distribution = {};
        Object.entries(analysis.byType).forEach(([type, items]) => {
            distribution[type] = {
                count: items.length,
                percentage: analysis.totalExports > 0 ? (items.length / analysis.totalExports) * 100 : 0
            };
        });
        return distribution;
    }
    
    generateCohesionSuggestion(analysis) {
        const { byType, totalExports } = analysis;
        
        if (totalExports === 0) {
            return 'ماژول خالی است. بررسی کنید آیا نیاز به export دارد یا خیر.';
        }
        
        if (byType.functions.length > 0 && byType.classes.length > 0) {
            return 'ترکیب توابع و کلاس‌ها در یک ماژول ممکن است نشان‌دهنده مسئولیت چندگانه باشد.';
        }
        
        if (byType.constants.length > 5) {
            return 'تعداد زیاد ثابت‌ها. ممکن است بهتر باشد در یک فایل constants جداگانه قرار گیرند.';
        }
        
        return 'ساختار ماژول منطقی و متمرکز به نظر می‌رسد.';
    }
    
    calculateDependencyComplexity(dependencies) {
        const internal = dependencies.internal.size;
        const external = dependencies.external.size;
        const circular = dependencies.circular.length;
        const missing = dependencies.missing.length;
        
        // فرمول ساده برای محاسبه پیچیدگی
        return (internal * 1) + (external * 2) + (circular * 10) + (missing * 5);
    }
    
    detectEncoding(content) {
        if (content.startsWith('\uFEFF')) return 'UTF-8 with BOM';
        // تشخیص ساده encoding
        try {
            new TextDecoder('utf-8').decode(new TextEncoder().encode(content));
            return 'UTF-8';
        } catch {
            return 'Unknown';
        }
    }
    
    detectLineEndings(content) {
        const crlf = (content.match(/\r\n/g) || []).length;
        const lf = (content.match(/\n/g) || []).length - crlf;
        const cr = (content.match(/\r/g) || []).length - crlf;
        
        if (crlf > lf && crlf > cr) return 'CRLF (Windows)';
        if (lf > crlf && lf > cr) return 'LF (Unix)';
        if (cr > crlf && cr > lf) return 'CR (Mac)';
        return 'Mixed';
    }
}

// ==================== GLOBAL ACCESS ====================
if (typeof window !== 'undefined') {
    window.VakamovaUnitTester = VakamovaUnitTester;
    window.VakamovaTester = VakamovaUnitTester; // برای سازگاری با نسخه قبل
    
    console.log('🧪 تستر واحد پیشرفته Vakamova v2.0.0 بارگذاری شد');
    console.log('دستورات موجود:');
    console.log('  - new VakamovaUnitTester(eventBus).testFile("path/to/file.js")');
    console.log('  - VakamovaUnitTester.quickTest("path/to/file.js")');
    console.log('  - VakamovaUnitTester.comprehensiveTest("path/to/file.js")');
}

// ==================== MODULE EXPORTS ====================
// برای محیط‌های مختلف
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { VakamovaUnitTester };
} else if (typeof define === 'function' && define.amd) {
    define([], () => ({ VakamovaUnitTester }));
}

// ==================== AUTO-INITIALIZATION ====================
// اگر eventBus در صفحه موجود باشد، به طور خودکار متصل می‌شود
document.addEventListener('DOMContentLoaded', () => {
    if (window.eventBus && !window.vakamovaTesterInstance) {
        window.vakamovaTesterInstance = new VakamovaUnitTester(window.eventBus, {
            logToConsole: true,
            autoConnectToEventBus: true
        });
        console.log('✅ تستر به طور خودکار به Event Bus متصل شد');
    }
});

export { VakamovaUnitTester };
