// ==================== MODULES_lesson_engine_LessonManager.js ====================
// موتور هوشمند مدیریت درس‌ها با قابلیت‌های پیشرفته آموزشی
// نسخه: 4.0.0 | تاریخ: ۱۴۰۳/۰۲/۱۵

'use strict';

class HyperLessonManager {
    // انواع محتوا و تمرین
    static CONTENT_TYPES = {
        TEXT: 'text',
        AUDIO: 'audio',
        VIDEO: 'video',
        IMAGE: 'image',
        INTERACTIVE: 'interactive',
        QUIZ: 'quiz',
        DIALOG: 'dialog',
        VOCABULARY: 'vocabulary',
        GRAMMAR: 'grammar',
        PRONUNCIATION: 'pronunciation'
    };
    
    static EXERCISE_TYPES = {
        MULTIPLE_CHOICE: 'multiple_choice',
        FILL_BLANK: 'fill_blank',
        MATCHING: 'matching',
        SEQUENCING: 'sequencing',
        SPEECH_RECOGNITION: 'speech_recognition',
        TRANSLATION: 'translation',
        DICTATION: 'dictation',
        CONVERSATION: 'conversation',
        WRITING: 'writing',
        LISTENING: 'listening'
    };
    
    static DIFFICULTY_LEVELS = {
        BEGINNER: 'beginner',
        INTERMEDIATE: 'intermediate',
        ADVANCED: 'advanced',
        EXPERT: 'expert'
    };
    
    constructor(db, state, options = {}) {
        if (!db) throw new Error('[LessonManager] نمونه دیتابیس الزامی است');
        if (!state) throw new Error('[LessonManager] نمونه state الزامی است');
        
        this.db = db;
        this.state = state;
        this.options = {
            cacheEnabled: options.cacheEnabled !== false,
            prefetchEnabled: options.prefetchEnabled !== false,
            adaptiveLearning: options.adaptiveLearning !== false,
            offlineMode: options.offlineMode !== false,
            autoRetry: options.autoRetry !== false,
            maxRetries: options.maxRetries || 3,
            cacheTTL: options.cacheTTL || 24 * 60 * 60 * 1000, // 24 ساعت
            ...options
        };
        
        // ذخیره‌سازی
        this.lessonsCache = new Map();
        this.exercisesCache = new Map();
        this.vocabularyCache = new Map();
        this.progressCache = new Map();
        
        // سیستم‌های جانبی
        this.analytics = {
            lessonsLoaded: 0,
            exercisesCompleted: 0,
            averageScore: 0,
            totalStudyTime: 0,
            errors: []
        };
        
        this.schedulers = new Map();
        this.prefetchQueue = [];
        this.isPrefetching = false;
        
        // Event System
        this.events = new EventTarget();
        
        console.log('[LessonManager] نمونه ایجاد شد');
    }
    
    // ==================== PUBLIC API ====================
    
    async init() {
        console.log('[LessonManager] شروع راه‌اندازی...');
        
        try {
            // 1. بارگذاری کش از دیتابیس
            await this._loadCacheFromDB();
            
            // 2. راه‌اندازی سیستم پیش‌بارگذاری
            if (this.options.prefetchEnabled) {
                this._startPrefetchScheduler();
            }
            
            // 3. راه‌اندازی سیستم Adaptive Learning
            if (this.options.adaptiveLearning) {
                this._startAdaptiveEngine();
            }
            
            // 4. ثبت Event Listeners
            this._setupEventListeners();
            
            console.log('[LessonManager] راه‌اندازی کامل شد');
            return this;
            
        } catch (error) {
            console.error('[LessonManager] خطا در راه‌اندازی:', error);
            throw new Error(`LessonManager initialization failed: ${error.message}`);
        }
    }
    
    async getLesson(language, level, lessonId, options = {}) {
        const cacheKey = `${language}_${level}_${lessonId}`;
        const forceReload = options.forceReload || false;
        
        console.log(`[LessonManager] درخواست درس: ${cacheKey}`);
        
        try {
            // 1. بررسی کش حافظه
            if (this.options.cacheEnabled && !forceReload && this.lessonsCache.has(cacheKey)) {
                const cached = this.lessonsCache.get(cacheKey);
                if (Date.now() - cached.timestamp < this.options.cacheTTL) {
                    console.log(`[LessonManager] درس از کش حافظه بازیابی شد: ${cacheKey}`);
                    this._recordAccess('cache_hit', cacheKey);
                    return this._enhanceLesson(cached.data);
                }
            }
            
            // 2. بررسی کش دیتابیس
            if (!forceReload) {
                const dbLesson = await this._getLessonFromDB(language, level, lessonId);
                if (dbLesson) {
                    console.log(`[LessonManager] درس از دیتابیس بازیابی شد: ${cacheKey}`);
                    this._updateMemoryCache(cacheKey, dbLesson);
                    this._recordAccess('db_hit', cacheKey);
                    return this._enhanceLesson(dbLesson);
                }
            }
            
            // 3. بارگذاری از منبع اصلی
            console.log(`[LessonManager] بارگذاری درس از منبع اصلی: ${cacheKey}`);
            this._recordAccess('remote_load', cacheKey);
            
            const lesson = await this._loadLessonFromSource(language, level, lessonId, options);
            
            // 4. اعتبارسنجی و پردازش
            const validatedLesson = this._validateLessonStructure(lesson);
            const enhancedLesson = this._enhanceLesson(validatedLesson);
            
            // 5. ذخیره در کش‌ها
            this._updateMemoryCache(cacheKey, enhancedLesson);
            await this._saveLessonToDB(language, level, lessonId, enhancedLesson);
            
            // 6. به‌روزرسانی آمار
            this.analytics.lessonsLoaded++;
            
            // 7. پیش‌بارگذاری درس‌های مرتبط
            if (this.options.prefetchEnabled) {
                this._prefetchRelatedLessons(language, level, lessonId, enhancedLesson);
            }
            
            return enhancedLesson;
            
        } catch (error) {
            console.error(`[LessonManager] خطا در بارگذاری درس ${cacheKey}:`, error);
            this.analytics.errors.push({
                type: 'lesson_load_error',
                lessonKey: cacheKey,
                error: error.message,
                timestamp: new Date().toISOString()
            });
            
            // تلاش برای بازیابی از نسخه پشتیبان
            const fallback = await this._getFallbackLesson(language, level, lessonId);
            if (fallback) {
                console.log(`[LessonManager] استفاده از درس پشتیبان برای: ${cacheKey}`);
                return fallback;
            }
            
            throw new Error(`Failed to load lesson ${cacheKey}: ${error.message}`);
        }
    }
    
    async getLessonBatch(language, level, lessonIds, options = {}) {
        console.log(`[LessonManager] درخواست دسته‌ای درس‌ها: ${lessonIds.length} درس`);
        
        const results = {
            successful: [],
            failed: [],
            fromCache: 0,
            fromDB: 0,
            fromRemote: 0
        };
        
        const promises = lessonIds.map(async (lessonId, index) => {
            try {
                // تاخیر تصاعدی برای جلوگیری از overload
                if (index > 0 && options.staggerLoad) {
                    await new Promise(resolve => 
                        setTimeout(resolve, index * 100)
                    );
                }
                
                const lesson = await this.getLesson(
                    language, 
                    level, 
                    lessonId, 
                    { ...options, priority: index === 0 ? 'high' : 'low' }
                );
                
                if (lesson.source === 'cache') results.fromCache++;
                else if (lesson.source === 'db') results.fromDB++;
                else results.fromRemote++;
                
                results.successful.push(lesson);
                return lesson;
                
            } catch (error) {
                results.failed.push({
                    lessonId,
                    error: error.message
                });
                return null;
            }
        });
        
        const lessons = await Promise.all(promises);
        
        console.log(`[LessonManager] بارگذاری دسته‌ای کامل شد: 
            موفق: ${results.successful.length}, 
            ناموفق: ${results.failed.length},
            کش: ${results.fromCache}, 
            دیتابیس: ${results.fromDB}, 
            راه‌دور: ${results.fromRemote}`);
        
        return {
            lessons: lessons.filter(l => l !== null),
            metadata: results
        };
    }
    
    async startLesson(lessonKey, options = {}) {
        console.log(`[LessonManager] شروع درس: ${lessonKey}`);
        
        try {
            // 1. دریافت درس
            const [language, level, lessonId] = lessonKey.split('_');
            const lesson = await this.getLesson(language, level, lessonId, options);
            
            // 2. ثبت شروع درس در state
            await this.state.startLesson({
                language,
                level,
                id: parseInt(lessonId)
            });
            
            // 3. محاسبه تخمین زمان
            const estimatedTime = this._calculateEstimatedTime(lesson);
            
            // 4. اجرای پیش‌نیازها
            const prerequisites = await this._checkPrerequisites(lesson);
            if (prerequisites.missing.length > 0 && options.enforcePrerequisites) {
                throw new Error(`Prerequisites not met: ${prerequisites.missing.join(', ')}`);
            }
            
            // 5. ایجاد جلسه مطالعه
            const studySession = {
                lessonKey,
                lesson,
                startTime: new Date().toISOString(),
                estimatedTime,
                prerequisites,
                options,
                progress: {
                    currentExercise: 0,
                    exercisesCompleted: 0,
                    score: 0,
                    timeSpent: 0
                }
            };
            
            // 6. ذخیره در state
            this.state.setCurrentSession(studySession);
            
            // 7. اطلاع‌رسانی
            this._emitEvent('lesson:started', {
                lessonKey,
                lesson,
                estimatedTime,
                sessionId: studySession.sessionId
            });
            
            console.log(`[LessonManager] درس شروع شد: ${lessonKey} (${estimatedTime} دقیقه)`);
            return studySession;
            
        } catch (error) {
            console.error(`[LessonManager] خطا در شروع درس ${lessonKey}:`, error);
            throw error;
        }
    }
    
    async completeExercise(lessonKey, exerciseId, userAnswer, options = {}) {
        console.log(`[LessonManager] تکمیل تمرین: ${lessonKey}_${exerciseId}`);
        
        try {
            // 1. دریافت درس و تمرین
            const [language, level, lessonId] = lessonKey.split('_');
            const lesson = await this.getLesson(language, level, lessonId);
            const exercise = this._findExercise(lesson, exerciseId);
            
            if (!exercise) {
                throw new Error(`Exercise ${exerciseId} not found in lesson ${lessonKey}`);
            }
            
            // 2. ارزیابی پاسخ
            const evaluation = await this._evaluateAnswer(exercise, userAnswer, options);
            
            // 3. محاسبه امتیاز
            const score = this._calculateScore(exercise, evaluation, options);
            
            // 4. ذخیره پیشرفت
            const progressData = {
                exerciseId,
                userAnswer,
                evaluation,
                score,
                timeSpent: options.timeSpent || 0,
                attempts: options.attempts || 1,
                completedAt: new Date().toISOString(),
                metadata: options.metadata || {}
            };
            
            await this.db.saveUserProgress(
                this.state.currentUser.id,
                lessonKey,
                progressData
            );
            
            // 5. به‌روزرسانی state
            await this.state.submitExercise(lessonKey, exerciseId, userAnswer, evaluation.isCorrect, score);
            
            // 6. به‌روزرسانی آمار
            this.analytics.exercisesCompleted++;
            this.analytics.averageScore = (
                (this.analytics.averageScore * (this.analytics.exercisesCompleted - 1) + score) / 
                this.analytics.exercisesCompleted
            );
            
            // 7. تحلیل پاسخ برای Adaptive Learning
            if (this.options.adaptiveLearning) {
                this._analyzeResponsePattern(exercise, userAnswer, evaluation);
            }
            
            // 8. اطلاع‌رسانی
            this._emitEvent('exercise:completed', {
                lessonKey,
                exerciseId,
                exercise,
                evaluation,
                score,
                progress: progressData
            });
            
            console.log(`[LessonManager] تمرین تکمیل شد: ${lessonKey}_${exerciseId} - امتیاز: ${score}`);
            
            return {
                success: true,
                evaluation,
                score,
                progress: progressData,
                nextExercise: this._suggestNextExercise(lesson, exerciseId, evaluation)
            };
            
        } catch (error) {
            console.error(`[LessonManager] خطا در تکمیل تمرین ${lessonKey}_${exerciseId}:`, error);
            
            this.analytics.errors.push({
                type: 'exercise_error',
                lessonKey,
                exerciseId,
                error: error.message,
                timestamp: new Date().toISOString()
            });
            
            throw error;
        }
    }
    
    async completeLesson(lessonKey, finalScore, options = {}) {
        console.log(`[LessonManager] تکمیل درس: ${lessonKey}`);
        
        try {
            // 1. دریافت درس
            const [language, level, lessonId] = lessonKey.split('_');
            const lesson = await this.getLesson(language, level, lessonId);
            
            // 2. ذخیره نمره نهایی
            await this.state.completeLesson(lessonKey, finalScore, options.timeSpent || 0);
            
            // 3. محاسبه و ذخیره آمار
            const lessonStats = await this._calculateLessonStatistics(lessonKey);
            
            // 4. پیشنهاد درس بعدی
            const nextLesson = await this._recommendNextLesson(language, level, lessonId, finalScore);
            
            // 5. اعطای نشان و دستاورد
            const achievements = await this._awardAchievements(lessonKey, finalScore, lessonStats);
            
            // 6. به‌روزرسانی مدل Adaptive Learning
            if (this.options.adaptiveLearning) {
                await this._updateAdaptiveModel(lessonKey, finalScore, lessonStats);
            }
            
            // 7. اطلاع‌رسانی
            this._emitEvent('lesson:completed', {
                lessonKey,
                lesson,
                finalScore,
                stats: lessonStats,
                nextLesson,
                achievements,
                timestamp: new Date().toISOString()
            });
            
            console.log(`[LessonManager] درس تکمیل شد: ${lessonKey} - نمره: ${finalScore}`);
            
            return {
                success: true,
                lessonKey,
                finalScore,
                stats: lessonStats,
                nextLesson,
                achievements
            };
            
        } catch (error) {
            console.error(`[LessonManager] خطا در تکمیل درس ${lessonKey}:`, error);
            throw error;
        }
    }
    
    async getRecommendedLessons(userId, options = {}) {
        console.log(`[LessonManager] دریافت درس‌های پیشنهادی برای کاربر: ${userId}`);
        
        try {
            const {
                language = this.state.currentLanguage,
                level = this.state.currentLevel,
                count = 5,
                strategy = 'adaptive'
            } = options;
            
            let recommendations;
            
            switch (strategy) {
                case 'adaptive':
                    recommendations = await this._getAdaptiveRecommendations(userId, language, level, count);
                    break;
                    
                case 'popular':
                    recommendations = await this._getPopularLessons(language, level, count);
                    break;
                    
                case 'recent':
                    recommendations = await this._getRecentLessons(userId, language, level, count);
                    break;
                    
                case 'prerequisite':
                    recommendations = await this._getPrerequisiteBasedRecommendations(userId, language, level, count);
                    break;
                    
                default:
                    recommendations = await this._getDefaultRecommendations(language, level, count);
            }
            
            // فیلتر کردن درس‌های تکمیل شده
            const completedLessons = await this.state.getCompletedLessons(userId);
            const filteredRecommendations = recommendations.filter(
                rec => !completedLessons.has(rec.lessonKey)
            );
            
            // پیش‌بارگذاری درس‌های پیشنهادی
            if (this.options.prefetchEnabled && filteredRecommendations.length > 0) {
                this._prefetchLessons(filteredRecommendations.map(r => r.lessonKey));
            }
            
            console.log(`[LessonManager] ${filteredRecommendations.length} درس پیشنهادی یافت شد`);
            
            return {
                recommendations: filteredRecommendations,
                strategy,
                language,
                level,
                timestamp: new Date().toISOString()
            };
            
        } catch (error) {
            console.error(`[LessonManager] خطا در دریافت درس‌های پیشنهادی:`, error);
            
            // بازگشت به پیشنهادات پیش‌فرض در صورت خطا
            return this._getDefaultRecommendations(
                options.language || 'en',
                options.level || 'beginner',
                options.count || 5
            );
        }
    }
    
    async searchLessons(query, filters = {}) {
        console.log(`[LessonManager] جستجوی درس‌ها: "${query}"`);
        
        try {
            const {
                language,
                level,
                category,
                difficulty,
                duration,
                hasAudio,
                hasVideo,
                limit = 20,
                offset = 0
            } = filters;
            
            // جستجو در کش حافظه
            const memoryResults = this._searchInMemoryCache(query, filters);
            
            // جستجو در دیتابیس
            const dbResults = await this._searchInDatabase(query, filters);
            
            // ادغام نتایج
            const allResults = [...memoryResults, ...dbResults];
            
            // حذف موارد تکراری
            const uniqueResults = this._deduplicateResults(allResults);
            
            // مرتب‌سازی بر اساس مرتبط‌بودن
            const sortedResults = this._sortSearchResults(uniqueResults, query, filters);
            
            // برش‌دهی بر اساس limit و offset
            const paginatedResults = sortedResults.slice(offset, offset + limit);
            
            // بارگذاری جزئیات درس‌های یافت شده
            const lessonsWithDetails = await Promise.all(
                paginatedResults.map(async result => {
                    try {
                        const lesson = await this.getLesson(
                            result.language,
                            result.level,
                            result.lessonId,
                            { forceReload: false }
                        );
                        return {
                            ...result,
                            lesson: this._stripLessonForSearch(lesson)
                        };
                    } catch (error) {
                        return result;
                    }
                })
            );
            
            console.log(`[LessonManager] جستجو کامل شد: ${lessonsWithDetails.length} نتیجه`);
            
            return {
                query,
                filters,
                results: lessonsWithDetails,
                total: sortedResults.length,
                limit,
                offset,
                hasMore: offset + limit < sortedResults.length
            };
            
        } catch (error) {
            console.error(`[LessonManager] خطا در جستجوی درس‌ها:`, error);
            throw error;
        }
    }
    
    async getLessonStatistics(lessonKey) {
        return this._calculateLessonStatistics(lessonKey);
    }
    
    async getUserProgress(userId) {
        try {
            const progress = await this.db.query('user_progress', {
                index: 'by_user',
                range: IDBKeyRange.only(userId),
                limit: 1000
            });
            
            const groupedProgress = this._groupProgressByLesson(progress);
            
            return {
                userId,
                totalLessons: Object.keys(groupedProgress).length,
                totalExercises: progress.length,
                averageScore: this._calculateAverageProgressScore(progress),
                byLesson: groupedProgress,
                lastUpdated: new Date().toISOString()
            };
            
        } catch (error) {
            console.error(`[LessonManager] خطا در دریافت پیشرفت کاربر:`, error);
            throw error;
        }
    }
    
    async clearCache(options = {}) {
        console.log('[LessonManager] پاک‌سازی کش...');
        
        const {
            memoryCache = true,
            dbCache = false,
            specificKeys = null
        } = options;
        
        let clearedCount = 0;
        
        // پاک‌سازی کش حافظه
        if (memoryCache) {
            if (specificKeys) {
                specificKeys.forEach(key => {
                    if (this.lessonsCache.delete(key)) clearedCount++;
                    if (this.exercisesCache.delete(key)) clearedCount++;
                    if (this.vocabularyCache.delete(key)) clearedCount++;
                });
            } else {
                clearedCount += this.lessonsCache.size;
                clearedCount += this.exercisesCache.size;
                clearedCount += this.vocabularyCache.size;
                
                this.lessonsCache.clear();
                this.exercisesCache.clear();
                this.vocabularyCache.clear();
                this.progressCache.clear();
            }
        }
        
        // پاک‌سازی کش دیتابیس
        if (dbCache) {
            try {
                await this.db.clearStore('lessons_cache');
                await this.db.clearStore('exercises_cache');
                console.log('[LessonManager] کش دیتابیس پاک شد');
            } catch (error) {
                console.warn('[LessonManager] خطا در پاک‌سازی کش دیتابیس:', error);
            }
        }
        
        console.log(`[LessonManager] پاک‌سازی کامل شد: ${clearedCount} آیتم پاک شد`);
        
        return { clearedCount, memoryCache, dbCache };
    }
    
    async exportProgress(userId, format = 'json') {
        console.log(`[LessonManager] صادر کردن پیشرفت کاربر: ${userId}`);
        
        try {
            // دریافت همه داده‌های مرتبط
            const [
                progress,
                completedLessons,
                statistics,
                achievements
            ] = await Promise.all([
                this.getUserProgress(userId),
                this.state.getCompletedLessons(userId),
                this.db.query('statistics', {
                    index: 'by_user',
                    range: IDBKeyRange.only(userId),
                    limit: 1000
                }),
                this._getUserAchievements(userId)
            ]);
            
            const exportData = {
                meta: {
                    exportedAt: new Date().toISOString(),
                    userId,
                    appVersion: '1.0.0',
                    exportVersion: '2.0'
                },
                user: {
                    id: userId,
                    language: this.state.currentLanguage,
                    level: this.state.currentLevel,
                    totalStudyTime: this.analytics.totalStudyTime
                },
                progress,
                completedLessons: Array.from(completedLessons),
                statistics,
                achievements,
                analytics: this.analytics
            };
            
            switch (format) {
                case 'json':
                    return JSON.stringify(exportData, null, 2);
                    
                case 'csv':
                    return this._convertProgressToCSV(exportData);
                    
                case 'html':
                    return this._convertProgressToHTML(exportData);
                    
                default:
                    return exportData;
            }
            
        } catch (error) {
            console.error(`[LessonManager] خطا در صادر کردن پیشرفت:`, error);
            throw error;
        }
    }
    
    getAnalytics() {
        return {
            ...this.analytics,
            cacheStats: {
                lessons: this.lessonsCache.size,
                exercises: this.exercisesCache.size,
                vocabulary: this.vocabularyCache.size
            },
            uptime: Date.now() - this.startTime,
            options: this.options
        };
    }
    
    // ==================== EVENT SYSTEM ====================
    
    on(event, handler) {
        this.events.addEventListener(event, handler);
        return () => this.events.removeEventListener(event, handler);
    }
    
    off(event, handler) {
        this.events.removeEventListener(event, handler);
    }
    
    // ==================== PRIVATE METHODS ====================
    
    async _loadCacheFromDB() {
        console.log('[LessonManager] بارگذاری کش از دیتابیس...');
        
        try {
            // بارگذاری درس‌های کش شده
            const cachedLessons = await this.db.query('lessons_cache', {
                limit: 100,
                filter: lesson => Date.now() - new Date(lesson.cachedAt).getTime() < this.options.cacheTTL
            });
            
            cachedLessons.forEach(lesson => {
                const key = `${lesson.language}_${lesson.level}_${lesson.id}`;
                this.lessonsCache.set(key, {
                    data: lesson,
                    timestamp: new Date(lesson.cachedAt).getTime(),
                    accessCount: lesson.accessCount || 0
                });
            });
            
            console.log(`[LessonManager] ${cachedLessons.length} درس از دیتابیس بارگذاری شد`);
            
        } catch (error) {
            console.warn('[LessonManager] خطا در بارگذاری کش از دیتابیس:', error);
        }
    }
    
    _startPrefetchScheduler() {
        console.log('[LessonManager] راه‌اندازی سیستم پیش‌بارگذاری');
        
        // زمان‌بند برای پیش‌بارگذاری هوشمند
        this.schedulers.set('prefetch', setInterval(() => {
            if (!this.isPrefetching && this.prefetchQueue.length > 0) {
                this._processPrefetchQueue();
            }
        }, 30000)); // هر 30 ثانیه
        
        // زمان‌بند برای پاک‌سازی کش قدیمی
        this.schedulers.set('cleanup', setInterval(() => {
            this._cleanupOldCache();
        }, 60 * 60 * 1000)); // هر 1 ساعت
    }
    
    _startAdaptiveEngine() {
        console.log('[LessonManager] راه‌اندازی موتور Adaptive Learning');
        
        // اینجا منطق Adaptive Learning پیاده‌سازی می‌شود
        // مانند تحلیل الگوهای خطای کاربر، تنظیم سطح دشواری، etc.
    }
    
    _setupEventListeners() {
        // گوش دادن به تغییرات state
        this.state.on('language_changed', async (data) => {
            console.log(`[LessonManager] زبان تغییر کرد به: ${data.to}`);
            
            // پیش‌بارگذاری درس‌های زبان جدید
            if (this.options.prefetchEnabled) {
                this._prefetchLanguageLessons(data.to, this.state.currentLevel);
            }
        });
        
        this.state.on('lesson_completed', async (data) => {
            // به‌روزرسانی مدل Adaptive Learning
            if (this.options.adaptiveLearning) {
                this._updateRecommendationModel(data);
            }
        });
        
        // گوش دادن به رویدادهای سیستم
        window.addEventListener('online', () => {
            console.log('[LessonManager] دستگاه آنلاین شد');
            this.options.offlineMode = false;
            
            // همگام‌سازی داده‌های آفلاین
            this._syncOfflineData();
        });
        
        window.addEventListener('offline', () => {
            console.log('[LessonManager] دستگاه آفلاین شد');
            this.options.offlineMode = true;
        });
    }
    
    async _loadLessonFromSource(language, level, lessonId, options) {
        // این متد بسته به منبع داده می‌تواند متفاوت باشد
        // فعلاً از فایل‌های JSON محلی بارگذاری می‌کند
        
        const sourcePath = options.sourcePath || 
                         `./data/lessons/${language}/${level}/${lessonId.toString().padStart(2, '0')}.json`;
        
        console.log(`[LessonManager] بارگذاری از مسیر: ${sourcePath}`);
        
        try {
            const response = await fetch(sourcePath);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const lessonData = await response.json();
            
            // اضافه کردن متادیتا
            return {
                ...lessonData,
                language,
                level,
                id: lessonId,
                source: 'remote',
                loadedAt: new Date().toISOString(),
                sourcePath
            };
            
        } catch (error) {
            console.error(`[LessonManager] خطا در بارگذاری از مسیر ${sourcePath}:`, error);
            throw error;
        }
    }
    
    async _getLessonFromDB(language, level, lessonId) {
        try {
            const lesson = await this.db.getLesson(language, level, lessonId);
            
            if (lesson) {
                return {
                    ...lesson,
                    source: 'db',
                    accessedFromDB: true
                };
            }
            
            return null;
            
        } catch (error) {
            console.debug(`[LessonManager] خطا در دریافت درس از دیتابیس:`, error);
            return null;
        }
    }
    
    async _saveLessonToDB(language, level, lessonId, lessonData) {
        try {
            await this.db.saveLesson({
                ...lessonData,
                language,
                level,
                id: lessonId,
                cachedAt: new Date().toISOString(),
                accessCount: (lessonData.accessCount || 0) + 1
            });
            
            console.log(`[LessonManager] درس در دیتابیس ذخیره شد: ${language}_${level}_${lessonId}`);
            
        } catch (error) {
            console.warn(`[LessonManager] خطا در ذخیره درس در دیتابیس:`, error);
        }
    }
    
    _updateMemoryCache(key, lessonData) {
        if (!this.options.cacheEnabled) return;
        
        this.lessonsCache.set(key, {
            data: lessonData,
            timestamp: Date.now(),
            accessCount: (this.lessonsCache.get(key)?.accessCount || 0) + 1
        });
        
        // محدود کردن اندازه کش
        if (this.lessonsCache.size > 100) {
            const oldestKey = this._findOldestCacheKey();
            if (oldestKey) {
                this.lessonsCache.delete(oldestKey);
            }
        }
    }
    
    _findOldestCacheKey() {
        let oldestKey = null;
        let oldestTime = Infinity;
        
        for (const [key, value] of this.lessonsCache.entries()) {
            if (value.timestamp < oldestTime) {
                oldestTime = value.timestamp;
                oldestKey = key;
            }
        }
        
        return oldestKey;
    }
    
    _enhanceLesson(lesson) {
        // اضافه کردن محاسبات و متادیتاهای پیشرفته
        
        const enhanced = {
            ...lesson,
            metadata: {
                ...lesson.metadata,
                estimatedTime: this._calculateLessonTime(lesson),
                difficultyScore: this._calculateDifficultyScore(lesson),
                interactivityScore: this._calculateInteractivityScore(lesson),
                prerequisites: this._extractPrerequisites(lesson),
                learningObjectives: this._extractLearningObjectives(lesson),
                keywords: this._extractKeywords(lesson),
                lastEnhanced: new Date().toISOString()
            },
            stats: {
                accessCount: (lesson.stats?.accessCount || 0) + 1,
                averageScore: lesson.stats?.averageScore || 0,
                completionRate: lesson.stats?.completionRate || 0,
                averageTime: lesson.stats?.averageTime || 0
            }
        };
        
        // افزودن navigation
        enhanced.navigation = {
            previous: this._findPreviousLesson(lesson),
            next: this._findNextLesson(lesson),
            related: this._findRelatedLessons(lesson)
        };
        
        return enhanced;
    }
    
    _validateLessonStructure(lesson) {
        const requiredFields = ['id', 'title', 'content', 'language', 'level'];
        const missingFields = requiredFields.filter(field => !lesson[field]);
        
        if (missingFields.length > 0) {
            throw new Error(`درس ساختار نامعتبر دارد. فیلدهای مفقود: ${missingFields.join(', ')}`);
        }
        
        // اعتبارسنجی انواع تمرین‌ها
        if (lesson.exercises && Array.isArray(lesson.exercises)) {
            lesson.exercises.forEach((exercise, index) => {
                if (!exercise.type || !exercise.question) {
                    console.warn(`تمرین ${index} ساختار نامعتبر دارد`);
                }
            });
        }
        
        return lesson;
    }
    
    _calculateLessonTime(lesson) {
        // محاسبه تخمین زمان بر اساس محتوا
        let totalMinutes = 0;
        
        if (lesson.content?.text) {
            const wordCount = lesson.content.text.split(' ').length;
            totalMinutes += Math.ceil(wordCount / 200); // 200 کلمه در دقیقه
        }
        
        if (lesson.exercises) {
            totalMinutes += lesson.exercises.length * 2; // 2 دقیقه برای هر تمرین
        }
        
        if (lesson.content?.audioDuration) {
            totalMinutes += Math.ceil(lesson.content.audioDuration / 60);
        }
        
        return Math.max(5, totalMinutes); // حداقل 5 دقیقه
    }
    
    async _getFallbackLesson(language, level, lessonId) {
        // درس‌های پشتیبان ساده برای حالت آفلاین
        const fallbackLessons = {
            'en_beginner_1': {
                id: 1,
                language: 'en',
                level: 'beginner',
                title: 'Basic Greetings',
                content: {
                    text: 'Hello! Welcome to the lesson. This is a basic greeting lesson.',
                    translation: 'سلام! به درس خوش آمدید. این یک درس سلام کردن پایه است.'
                },
                exercises: [
                    {
                        type: 'multiple_choice',
                        question: 'How do you say "Hello" in English?',
                        options: ['Goodbye', 'Hello', 'Thank you', 'Please'],
                        correctAnswer: 1
                    }
                ],
                source: 'fallback',
                isFallback: true
            }
        };
        
        const key = `${language}_${level}_${lessonId}`;
        return fallbackLessons[key] || null;
    }
    
    _prefetchRelatedLessons(language, level, lessonId, currentLesson) {
        if (!this.options.prefetchEnabled) return;
        
        // پیش‌بارگذاری درس بعدی
        const nextLessonId = parseInt(lessonId) + 1;
        const nextKey = `${language}_${level}_${nextLessonId}`;
        
        if (!this.lessonsCache.has(nextKey)) {
            this.prefetchQueue.push({
                language,
                level,
                lessonId: nextLessonId,
                priority: 'medium'
            });
        }
        
        // پیش‌بارگذاری درس‌های مرتبط
        if (currentLesson.metadata?.relatedLessons) {
            currentLesson.metadata.relatedLessons.forEach(related => {
                const relatedKey = `${related.language || language}_${related.level || level}_${related.id}`;
                if (!this.lessonsCache.has(relatedKey)) {
                    this.prefetchQueue.push({
                        language: related.language || language,
                        level: related.level || level,
                        lessonId: related.id,
                        priority: 'low'
                    });
                }
            });
        }
        
        // شروع پردازش صف اگر لازم باشد
        if (this.prefetchQueue.length > 0 && !this.isPrefetching) {
            setTimeout(() => this._processPrefetchQueue(), 1000);
        }
    }
    
    async _processPrefetchQueue() {
        if (this.isPrefetching || this.prefetchQueue.length === 0) return;
        
        this.isPrefetching = true;
        console.log(`[LessonManager] شروع پیش‌بارگذاری ${this.prefetchQueue.length} درس`);
        
        // مرتب‌سازی بر اساس اولویت
        this.prefetchQueue.sort((a, b) => {
            const priorityOrder = { high: 0, medium: 1, low: 2 };
            return priorityOrder[a.priority] - priorityOrder[b.priority];
        });
        
        // پیش‌بارگذاری همزمان 3 درس
        const batchSize = 3;
        const batch = this.prefetchQueue.splice(0, batchSize);
        
        try {
            await Promise.allSettled(
                batch.map(async (item, index) => {
                    // تاخیر تصاعدی برای جلوگیری از overload
                    await new Promise(resolve => 
                        setTimeout(resolve, index * 500)
                    );
                    
                    try {
                        await this.getLesson(
                            item.language,
                            item.level,
                            item.lessonId,
                            { 
                                forceReload: false,
                                silent: true,
                                priority: item.priority 
                            }
                        );
                        
                        console.log(`[LessonManager] درس پیش‌بارگذاری شد: ${item.language}_${item.level}_${item.lessonId}`);
                        
                    } catch (error) {
                        console.debug(`[LessonManager] خطا در پیش‌بارگذاری:`, error.message);
                    }
                })
            );
            
        } finally {
            this.isPrefetching = false;
            
            // ادامه پردازش اگر درس دیگری در صف باشد
            if (this.prefetchQueue.length > 0) {
                setTimeout(() => this._processPrefetchQueue(), 5000);
            }
        }
    }
    
    _cleanupOldCache() {
        if (!this.options.cacheEnabled) return;
        
        const now = Date.now();
        let deletedCount = 0;
        
        for (const [key, value] of this.lessonsCache.entries()) {
            if (now - value.timestamp > this.options.cacheTTL) {
                this.lessonsCache.delete(key);
                deletedCount++;
            }
        }
        
        if (deletedCount > 0) {
            console.log(`[LessonManager] ${deletedCount} آیتم قدیمی از کش حذف شد`);
        }
    }
    
    _recordAccess(type, key) {
        // ثبت دسترسی برای تحلیل
        console.debug(`[LessonManager] دسترسی ${type}: ${key}`);
    }
    
    _calculateEstimatedTime(lesson) {
        return lesson.metadata?.estimatedTime || this._calculateLessonTime(lesson);
    }
    
    async _checkPrerequisites(lesson) {
        const prerequisites = lesson.metadata?.prerequisites || [];
        const results = {
            required: prerequisites.length,
            met: 0,
            missing: []
        };
        
        for (const prereq of prerequisites) {
            try {
                const prereqKey = `${prereq.language || lesson.language}_${prereq.level || lesson.level}_${prereq.id}`;
                const isCompleted = await this.state.isLessonCompleted(prereqKey);
                
                if (isCompleted) {
                    results.met++;
                } else {
                    results.missing.push(prereqKey);
                }
            } catch (error) {
                results.missing.push(`Error checking: ${prereq.id}`);
            }
        }
        
        return results;
    }
    
    _findExercise(lesson, exerciseId) {
        if (!lesson.exercises || !Array.isArray(lesson.exercises)) {
            return null;
        }
        
        return lesson.exercises.find(ex => ex.id === exerciseId) || 
               lesson.exercises[exerciseId]; // اگر index باشد
    }
    
    async _evaluateAnswer(exercise, userAnswer, options) {
        // ارزیابی بر اساس نوع تمرین
        const evaluation = {
            exerciseId: exercise.id,
            exerciseType: exercise.type,
            userAnswer,
            isCorrect: false,
            score: 0,
            feedback: '',
            detailedFeedback: {},
            timestamp: new Date().toISOString()
        };
        
        switch (exercise.type) {
            case 'multiple_choice':
                evaluation.isCorrect = this._evaluateMultipleChoice(exercise, userAnswer);
                evaluation.feedback = evaluation.isCorrect 
                    ? 'Correct! Well done.' 
                    : `Incorrect. The correct answer is: ${exercise.options[exercise.correctAnswer]}`;
                break;
                
            case 'fill_blank':
                const fillResult = this._evaluateFillBlank(exercise, userAnswer);
                evaluation.isCorrect = fillResult.isCorrect;
                evaluation.feedback = fillResult.feedback;
                evaluation.detailedFeedback = fillResult.details;
                break;
                
            case 'matching':
                const matchResult = this._evaluateMatching(exercise, userAnswer);
                evaluation.isCorrect = matchResult.isCorrect;
                evaluation.feedback = matchResult.feedback;
                evaluation.score = matchResult.score;
                break;
                
            // انواع دیگر تمرین‌ها...
                
            default:
                evaluation.feedback = 'Exercise type not supported for auto-evaluation';
        }
        
        // اعمال tolerance برای پاسخ‌های نزدیک
        if (options.tolerance && !evaluation.isCorrect) {
            evaluation.isCorrect = this._checkWithTolerance(exercise, userAnswer, options.tolerance);
            if (evaluation.isCorrect) {
                evaluation.feedback = 'Accepted with tolerance.';
                evaluation.score = options.toleranceScore || 0.5;
            }
        }
        
        return evaluation;
    }
    
    _evaluateMultipleChoice(exercise, userAnswer) {
        return userAnswer === exercise.correctAnswer;
    }
    
    _evaluateFillBlank(exercise, userAnswer) {
        // پیاده‌سازی ارزیابی جای خالی
        const correctAnswers = Array.isArray(exercise.correctAnswer) 
            ? exercise.correctAnswer 
            : [exercise.correctAnswer];
        
        const normalizedUserAnswer = userAnswer.trim().toLowerCase();
        const normalizedCorrectAnswers = correctAnswers.map(a => a.trim().toLowerCase());
        
        const isCorrect = normalizedCorrectAnswers.includes(normalizedUserAnswer);
        
        return {
            isCorrect,
            feedback: isCorrect ? 'Correct!' : 'Try again.',
            details: {
                expected: correctAnswers,
                provided: userAnswer,
                normalized: normalizedUserAnswer
            }
        };
    }
    
    _evaluateMatching(exercise, userAnswer) {
        // پیاده‌سازی ارزیابی تطابق
        const pairs = exercise.pairs || [];
        const userPairs = userAnswer || [];
        
        let correctCount = 0;
        
        userPairs.forEach(userPair => {
            const correctPair = pairs.find(p => 
                p.left === userPair.left && p.right === userPair.right
            );
            if (correctPair) correctCount++;
        });
        
        const score = pairs.length > 0 ? correctCount / pairs.length : 0;
        const isCorrect = score >= (exercise.minScore || 0.8);
        
        return {
            isCorrect,
            score,
            feedback: `You matched ${correctCount} out of ${pairs.length} correctly.`
        };
    }
    
    _checkWithTolerance(exercise, userAnswer, tolerance) {
        // بررسی با tolerance (مثلاً برای اشتباهات تایپی)
        // این یک پیاده‌سازی ساده است
        if (!exercise.correctAnswer || typeof exercise.correctAnswer !== 'string') {
            return false;
        }
        
        const correct = exercise.correctAnswer.toLowerCase();
        const answer = userAnswer.toLowerCase();
        
        if (answer === correct) return true;
        
        // بررسی فاصله ویرایشی (Levenshtein distance)
        const distance = this._levenshteinDistance(correct, answer);
        const maxLength = Math.max(correct.length, answer.length);
        const similarity = 1 - (distance / maxLength);
        
        return similarity >= tolerance;
    }
    
    _levenshteinDistance(a, b) {
        // محاسبه فاصله ویرایشی
        const matrix = [];
        
        for (let i = 0; i <= b.length; i++) {
            matrix[i] = [i];
        }
        
        for (let j = 0; j <= a.length; j++) {
            matrix[0][j] = j;
        }
        
        for (let i = 1; i <= b.length; i++) {
            for (let j = 1; j <= a.length; j++) {
                if (b.charAt(i - 1) === a.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1,
                        matrix[i][j - 1] + 1,
                        matrix[i - 1][j] + 1
                    );
                }
            }
        }
        
        return matrix[b.length][a.length];
    }
    
    _calculateScore(exercise, evaluation, options) {
        let score = 0;
        
        if (evaluation.isCorrect) {
            score = exercise.points || 10;
            
            // اعمال bonus برای سرعت
            if (options.timeBonus && options.timeSpent) {
                const timeBonus = this._calculateTimeBonus(exercise, options.timeSpent);
                score += timeBonus;
            }
            
            // اعمال penalty برای تلاش‌های زیاد
            if (options.attempts && options.attempts > 1) {
                const attemptPenalty = (options.attempts - 1) * 2;
                score = Math.max(1, score - attemptPenalty);
            }
        } else if (evaluation.score) {
            score = evaluation.score * (exercise.points || 10);
        }
        
        return Math.round(score);
    }
    
    _calculateTimeBonus(exercise, timeSpent) {
        const expectedTime = exercise.estimatedTime || 60; // ثانیه
        const ratio = expectedTime / timeSpent;
        
        if (ratio >= 2) return 5;  // خیلی سریع
        if (ratio >= 1.5) return 3; // سریع
        if (ratio >= 1) return 1;   // نرمال
        
        return 0;
    }
    
    _analyzeResponsePattern(exercise, userAnswer, evaluation) {
        // تحلیل الگوی پاسخ برای Adaptive Learning
        const pattern = {
            exerciseId: exercise.id,
            exerciseType: exercise.type,
            userAnswer,
            isCorrect: evaluation.isCorrect,
            timeSpent: evaluation.timeSpent,
            attempts: evaluation.attempts,
            timestamp: new Date().toISOString(),
            metadata: {
                difficulty: exercise.difficulty,
                category: exercise.category
            }
        };
        
        // ذخیره برای تحلیل بعدی
        this._storeResponsePattern(pattern);
    }
    
    _storeResponsePattern(pattern) {
        // ذخیره الگوی پاسخ
        const key = `${pattern.exerciseType}_${pattern.exerciseId}`;
        const patterns = this.responsePatterns.get(key) || [];
        patterns.push(pattern);
        this.responsePatterns.set(key, patterns.slice(-100)); // آخرین 100 مورد
    }
    
    _suggestNextExercise(lesson, currentExerciseId, evaluation) {
        if (!lesson.exercises || !Array.isArray(lesson.exercises)) {
            return null;
        }
        
        const currentIndex = lesson.exercises.findIndex(ex => ex.id === currentExerciseId);
        
        if (currentIndex === -1 || currentIndex >= lesson.exercises.length - 1) {
            return null;
        }
        
        // اگر کاربر در تمرین فعلی مشکل داشت، تمرین مشابه پیشنهاد شود
        if (!evaluation.isCorrect && this.options.adaptiveLearning) {
            const similarExercises = lesson.exercises.filter((ex, index) => 
                index > currentIndex && 
                ex.type === lesson.exercises[currentIndex].type &&
                ex.difficulty === lesson.exercises[currentIndex].difficulty
            );
            
            if (similarExercises.length > 0) {
                return similarExercises[0];
            }
        }
        
        // در غیر این صورت تمرین بعدی
        return lesson.exercises[currentIndex + 1];
    }
    
    async _calculateLessonStatistics(lessonKey) {
        try {
            const [language, level, lessonId] = lessonKey.split('_');
            const progress = await this.db.query('user_progress', {
                index: 'by_lesson',
                range: IDBKeyRange.only(lessonKey),
                limit: 1000
            });
            
            if (progress.length === 0) {
                return {
                    lessonKey,
                    attempts: 0,
                    averageScore: 0,
                    completionRate: 0,
                    averageTime: 0,
                    lastAttempt: null
                };
            }
            
            const scores = progress.map(p => p.score || 0);
            const times = progress.map(p => p.timeSpent || 0);
            
            const averageScore = scores.reduce((sum, score) => sum + score, 0) / scores.length;
            const averageTime = times.reduce((sum, time) => sum + time, 0) / times.length;
            const completionRate = progress.filter(p => p.score >= 70).length / progress.length;
            
            const lastAttempt = progress.sort((a, b) => 
                new Date(b.completedAt) - new Date(a.completedAt)
            )[0];
            
            return {
                lessonKey,
                attempts: progress.length,
                averageScore: Math.round(averageScore * 10) / 10,
                completionRate: Math.round(completionRate * 100),
                averageTime: Math.round(averageTime),
                lastAttempt: lastAttempt?.completedAt,
                topScore: Math.max(...scores),
                lowScore: Math.min(...scores)
            };
            
        } catch (error) {
            console.error(`[LessonManager] خطا در محاسبه آمار درس ${lessonKey}:`, error);
            throw error;
        }
    }
    
    async _recommendNextLesson(language, level, currentLessonId, finalScore) {
        // منطق پیشنهاد درس بعدی
        const nextId = parseInt(currentLessonId) + 1;
        
        // بررسی اینکه آیا کاربر آماده درس بعدی است
        const isReady = finalScore >= 70;
        
        if (isReady) {
            return {
                language,
                level,
                id: nextId,
                reason: 'good_performance',
                confidence: 0.8
            };
        } else {
            // پیشنهاد تمرین بیشتر یا درس تکمیلی
            return {
                language,
                level,
                id: currentLessonId, // تکرار همان درس
                reason: 'needs_more_practice',
                confidence: 0.9
            };
        }
    }
    
    async _awardAchievements(lessonKey, finalScore, stats) {
        const achievements = [];
        
        // دستاورد نمره کامل
        if (finalScore >= 95) {
            achievements.push({
                id: 'perfect_score',
                title: 'Perfect Score!',
                description: `Scored 95% or higher on ${lessonKey}`,
                points: 50,
                icon: '🏆'
            });
        }
        
        // دستاورد تکمیل سریع
        if (stats.averageTime && stats.averageTime < 300) { // کمتر از 5 دقیقه
            achievements.push({
                id: 'fast_learner',
                title: 'Fast Learner',
                description: `Completed ${lessonKey} in under 5 minutes`,
                points: 25,
                icon: '⚡'
            });
        }
        
        // دستاورد اولین تکمیل
        if (stats.attempts === 1) {
            achievements.push({
                id: 'first_try',
                title: 'First Try!',
                description: `Completed ${lessonKey} on the first attempt`,
                points: 30,
                icon: '🎯'
            });
        }
        
        if (achievements.length > 0) {
            // ذخیره دستاوردها
            await this._saveAchievements(achievements);
            
            // اطلاع‌رسانی
            this._emitEvent('achievements:awarded', {
                lessonKey,
                achievements
            });
        }
        
        return achievements;
    }
    
    async _saveAchievements(achievements) {
        // ذخیره دستاوردها در دیتابیس
        try {
            await this.db.bulkInsert('achievements', achievements);
        } catch (error) {
            console.warn('[LessonManager] خطا در ذخیره دستاوردها:', error);
        }
    }
    
    async _updateAdaptiveModel(lessonKey, finalScore, stats) {
        // به‌روزرسانی مدل Adaptive Learning
        console.log(`[LessonManager] به‌روزرسانی مدل Adaptive برای: ${lessonKey}`);
        
        // اینجا منطق پیچیده Adaptive Learning پیاده‌سازی می‌شود
        // مانند به‌روزرسانی سطح دشواری، تنظیم مسیر یادگیری، etc.
    }
    
    async _getAdaptiveRecommendations(userId, language, level, count) {
        // پیشنهادات مبتنی بر Adaptive Learning
        // در این نسخه ساده، درس‌های بعدی در دنباله را برمی‌گرداند
        
        const recommendations = [];
        const completedLessons = await this.state.getCompletedLessons(userId);
        
        // پیدا کردن آخرین درس تکمیل شده
        let lastLessonId = 0;
        for (const lessonKey of completedLessons) {
            const [l, lev, id] = lessonKey.split('_');
            if (l === language && lev === level) {
                lastLessonId = Math.max(lastLessonId, parseInt(id));
            }
        }
        
        // پیشنهاد درس‌های بعدی
        for (let i = 1; i <= count; i++) {
            const nextId = lastLessonId + i;
            recommendations.push({
                lessonKey: `${language}_${level}_${nextId}`,
                language,
                level,
                id: nextId,
                reason: 'next_in_sequence',
                confidence: 0.7,
                estimatedDifficulty: 'medium'
            });
        }
        
        return recommendations;
    }
    
    async _getPopularLessons(language, level, count) {
        // درس‌های محبوب بر اساس آمار کلی
        // در این نسخه ساده، درس‌های اولیه را برمی‌گرداند
        
        const recommendations = [];
        
        for (let i = 1; i <= count; i++) {
            recommendations.push({
                lessonKey: `${language}_${level}_${i}`,
                language,
                level,
                id: i,
                reason: 'popular',
                confidence: 0.6,
                estimatedDifficulty: i <= 3 ? 'easy' : 'medium'
            });
        }
        
        return recommendations;
    }
    
    async _getRecentLessons(userId, language, level, count) {
        // درس‌های اخیراً دیده شده توسط کاربر
        const recommendations = [];
        
        try {
            const recentProgress = await this.db.query('user_progress', {
                index: 'by_user',
                range: IDBKeyRange.only(userId),
                limit: 20,
                filter: p => p.completedAt && 
                           new Date(p.completedAt) > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // 7 روز گذشته
            });
            
            // گروه‌بندی بر اساس درس
            const lessonMap = new Map();
            recentProgress.forEach(p => {
                if (!lessonMap.has(p.lessonId)) {
                    lessonMap.set(p.lessonId, {
                        lessonKey: p.lessonId,
                        lastAccessed: p.completedAt,
                        accessCount: 0
                    });
                }
                lessonMap.get(p.lessonId).accessCount++;
            });
            
            // مرتب‌سازی و انتخاب
            const sorted = Array.from(lessonMap.values())
                .sort((a, b) => new Date(b.lastAccessed) - new Date(a.lastAccessed))
                .slice(0, count);
            
            sorted.forEach(item => {
                const [l, lev, id] = item.lessonKey.split('_');
                recommendations.push({
                    lessonKey: item.lessonKey,
                    language: l,
                    level: lev,
                    id: parseInt(id),
                    reason: 'recently_accessed',
                    confidence: 0.8,
                    lastAccessed: item.lastAccessed
                });
            });
            
        } catch (error) {
            console.warn('[LessonManager] خطا در دریافت درس‌های اخیر:', error);
        }
        
        return recommendations;
    }
    
    async _getPrerequisiteBasedRecommendations(userId, language, level, count) {
        // پیشنهادات مبتنی بر پیش‌نیازها
        // این یک پیاده‌سازی ساده است
        return this._getDefaultRecommendations(language, level, count);
    }
    
    async _getDefaultRecommendations(language, level, count) {
        const recommendations = [];
        
        for (let i = 1; i <= count; i++) {
            recommendations.push({
                lessonKey: `${language}_${level}_${i}`,
                language,
                level,
                id: i,
                reason: 'default',
                confidence: 0.5,
                estimatedDifficulty: 'unknown'
            });
        }
        
        return recommendations;
    }
    
    async _prefetchLessons(lessonKeys) {
        if (!this.options.prefetchEnabled || lessonKeys.length === 0) {
            return;
        }
        
        console.log(`[LessonManager] پیش‌بارگذاری ${lessonKeys.length} درس`);
        
        lessonKeys.forEach(key => {
            if (!this.lessonsCache.has(key) && 
                !this.prefetchQueue.some(item => 
                    `${item.language}_${item.level}_${item.lessonId}` === key
                )) {
                
                const [language, level, lessonId] = key.split('_');
                this.prefetchQueue.push({
                    language,
                    level,
                    lessonId: parseInt(lessonId),
                    priority: 'low'
                });
            }
        });
        
        if (!this.isPrefetching) {
            setTimeout(() => this._processPrefetchQueue(), 2000);
        }
    }
    
    _searchInMemoryCache(query, filters) {
        const results = [];
        const normalizedQuery = query.toLowerCase().trim();
        
        if (!normalizedQuery) return results;
        
        for (const [key, cached] of this.lessonsCache.entries()) {
            const lesson = cached.data;
            
            // اعمال فیلترها
            if (filters.language && lesson.language !== filters.language) continue;
            if (filters.level && lesson.level !== filters.level) continue;
            
            // جستجو در متن
            const searchFields = [
                lesson.title,
                lesson.content?.text,
                lesson.metadata?.keywords?.join(' '),
                lesson.metadata?.learningObjectives?.join(' ')
            ].filter(Boolean);
            
            const matches = searchFields.some(field => 
                field.toLowerCase().includes(normalizedQuery)
            );
            
            if (matches) {
                results.push({
                    lessonKey: key,
                    language: lesson.language,
                    level: lesson.level,
                    id: lesson.id,
                    title: lesson.title,
                    relevance: this._calculateRelevance(lesson, normalizedQuery),
                    source: 'memory_cache'
                });
            }
        }
        
        return results;
    }
    
    async _searchInDatabase(query, filters) {
        // این متد نیاز به پیاده‌سازی جستجو در دیتابیس دارد
        // فعلاً خالی می‌گذاریم
        return [];
    }
    
    _deduplicateResults(results) {
        const seen = new Set();
        return results.filter(result => {
            const key = result.lessonKey;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }
    
    _sortSearchResults(results, query, filters) {
        const normalizedQuery = query.toLowerCase().trim();
        
        return results.sort((a, b) => {
            // اولویت‌بندی بر اساس مرتبط‌بودن
            if (a.relevance !== b.relevance) {
                return b.relevance - a.relevance;
            }
            
            // سپس بر اساس تازگی (اگر در کش باشد)
            if (a.source === 'memory_cache' && b.source !== 'memory_cache') {
                return -1;
            }
            
            // سپس بر اساس سطح (اگر فیلتر level نباشد)
            if (!filters.level) {
                const levelOrder = { beginner: 0, intermediate: 1, advanced: 2, expert: 3 };
                return levelOrder[a.level] - levelOrder[b.level];
            }
            
            // سپس بر اساس ID
            return a.id - b.id;
        });
    }
    
    _calculateRelevance(lesson, query) {
        let relevance = 0;
        const queryWords = query.split(' ');
        
        // جستجو در عنوان (بالاترین وزن)
        if (lesson.title.toLowerCase().includes(query)) {
            relevance += 10;
        }
        
        // جستجو در کلمات کلیدی
        if (lesson.metadata?.keywords) {
            const keywordMatches = lesson.metadata.keywords.filter(keyword =>
                queryWords.some(word => keyword.toLowerCase().includes(word))
            ).length;
            
            relevance += keywordMatches * 5;
        }
        
        // جستجو در محتوا
        if (lesson.content?.text?.toLowerCase().includes(query)) {
            relevance += 3;
        }
        
        // جستجو در اهداف یادگیری
        if (lesson.metadata?.learningObjectives) {
            const objectiveMatches = lesson.metadata.learningObjectives.filter(obj =>
                queryWords.some(word => obj.toLowerCase().includes(word))
            ).length;
            
            relevance += objectiveMatches * 2;
        }
        
        return relevance;
    }
    
    _stripLessonForSearch(lesson) {
        // برگرداندن نسخه خلاصه شده درس برای نتایج جستجو
        return {
            id: lesson.id,
            title: lesson.title,
            language: lesson.language,
            level: lesson.level,
            estimatedTime: lesson.metadata?.estimatedTime,
            difficulty: lesson.metadata?.difficultyScore,
            hasAudio: !!lesson.content?.audio,
            hasVideo: !!lesson.content?.video,
            exerciseCount: lesson.exercises?.length || 0
        };
    }
    
    _groupProgressByLesson(progress) {
        const grouped = {};
        
        progress.forEach(p => {
            if (!grouped[p.lessonId]) {
                grouped[p.lessonId] = {
                    lessonId: p.lessonId,
                    attempts: 0,
                    exercises: [],
                    scores: [],
                    averageScore: 0,
                    lastAttempt: null
                };
            }
            
            grouped[p.lessonId].attempts++;
            grouped[p.lessonId].exercises.push({
                exerciseId: p.exerciseId,
                score: p.score,
                completedAt: p.completedAt
            });
            grouped[p.lessonId].scores.push(p.score);
            grouped[p.lessonId].averageScore = 
                grouped[p.lessonId].scores.reduce((sum, s) => sum + s, 0) / 
                grouped[p.lessonId].scores.length;
            
            if (!grouped[p.lessonId].lastAttempt || 
                new Date(p.completedAt) > new Date(grouped[p.lessonId].lastAttempt)) {
                grouped[p.lessonId].lastAttempt = p.completedAt;
            }
        });
        
        return grouped;
    }
    
    _calculateAverageProgressScore(progress) {
        if (progress.length === 0) return 0;
        
        const total = progress.reduce((sum, p) => sum + (p.score || 0), 0);
        return Math.round((total / progress.length) * 10) / 10;
    }
    
    async _getUserAchievements(userId) {
        try {
            return await this.db.query('achievements', {
                index: 'by_user',
                range: IDBKeyRange.only(userId),
                limit: 50
            });
        } catch (error) {
            console.warn('[LessonManager] خطا در دریافت دستاوردهای کاربر:', error);
            return [];
        }
    }
    
    _convertProgressToCSV(data) {
        const rows = [];
        
        // هدر
        rows.push('Category,Field,Value');
        
        // اطلاعات کاربر
        rows.push(`User,ID,${data.user.id}`);
        rows.push(`User,Language,${data.user.language}`);
        rows.push(`User,Level,${data.user.level}`);
        rows.push(`User,Total Study Time,${data.user.totalStudyTime}`);
        
        // پیشرفت
        Object.entries(data.progress.byLesson).forEach(([lessonId, lessonData]) => {
            rows.push(`Progress,${lessonId} Attempts,${lessonData.attempts}`);
            rows.push(`Progress,${lessonId} Average Score,${lessonData.averageScore}`);
        });
        
        // درس‌های تکمیل شده
        data.completedLessons.forEach(lessonKey => {
            rows.push(`Completed Lessons,${lessonKey},Yes`);
        });
        
        return rows.join('\n');
    }
    
    _convertProgressToHTML(data) {
        return `
            <!DOCTYPE html>
            <html>
            <head>
                <title>HyperLang Progress Report</title>
                <style>
                    body { font-family: Arial, sans-serif; margin: 20px; }
                    h1 { color: #1a237e; }
                    .section { margin: 20px 0; padding: 15px; border: 1px solid #ddd; border-radius: 5px; }
                    .stat { display: inline-block; margin: 10px 20px 10px 0; }
                    .stat-value { font-size: 24px; font-weight: bold; color: #1a237e; }
                    .stat-label { font-size: 14px; color: #666; }
                    table { width: 100%; border-collapse: collapse; margin: 10px 0; }
                    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
                    th { background-color: #f2f2f2; }
                </style>
            </head>
            <body>
                <h1>📊 HyperLang Progress Report</h1>
                
                <div class="section">
                    <h2>User Information</h2>
                    <div class="stat">
                        <div class="stat-value">${data.user.id}</div>
                        <div class="stat-label">User ID</div>
                    </div>
                    <div class="stat">
                        <div class="stat-value">${data.user.language}</div>
                        <div class="stat-label">Current Language</div>
                    </div>
                    <div class="stat">
                        <div class="stat-value">${data.user.level}</div>
                        <div class="stat-label">Current Level</div>
                    </div>
                    <div class="stat">
                        <div class="stat-value">${data.user.totalStudyTime}m</div>
                        <div class="stat-label">Total Study Time</div>
                    </div>
                </div>
                
                <div class="section">
                    <h2>Progress Overview</h2>
                    <div class="stat">
                        <div class="stat-value">${data.progress.totalLessons}</div>
                        <div class="stat-label">Lessons Started</div>
                    </div>
                    <div class="stat">
                        <div class="stat-value">${data.progress.totalExercises}</div>
                        <div class="stat-label">Exercises Completed</div>
                    </div>
                    <div class="stat">
                        <div class="stat-value">${data.progress.averageScore}%</div>
                        <div class="stat-label">Average Score</div>
                    </div>
                </div>
                
                <div class="section">
                    <h2>Completed Lessons (${data.completedLessons.length})</h2>
                    <table>
                        <tr>
                            <th>Lesson Key</th>
                            <th>Language</th>
                            <th>Level</th>
                        </tr>
                        ${data.completedLessons.map(lessonKey => {
                            const [lang, level, id] = lessonKey.split('_');
                            return `
                                <tr>
                                    <td>${id}</td>
                                    <td>${lang}</td>
                                    <td>${level}</td>
                                </tr>
                            `;
                        }).join('')}
                    </table>
                </div>
                
                <div class="section">
                    <h2>Export Information</h2>
                    <p><strong>Exported At:</strong> ${data.meta.exportedAt}</p>
                    <p><strong>App Version:</strong> ${data.meta.appVersion}</p>
                </div>
            </body>
            </html>
        `;
    }
    
    async _syncOfflineData() {
        // همگام‌سازی داده‌های آفلاین با سرور
        console.log('[LessonManager] شروع همگام‌سازی داده‌های آفلاین...');
        
        // اینجا منطق همگام‌سازی پیاده‌سازی می‌شود
        // مانند ارسال پیشرفت ذخیره شده، دریافت به‌روزرسانی‌ها، etc.
        
        console.log('[LessonManager] همگام‌سازی کامل شد');
    }
    
    _findPreviousLesson(lesson) {
        // پیدا کردن درس قبلی در دنباله
        const prevId = parseInt(lesson.id) - 1;
        if (prevId < 1) return null;
        
        return {
            language: lesson.language,
            level: lesson.level,
            id: prevId
        };
    }
    
    _findNextLesson(lesson) {
        // پیدا کردن درس بعدی در دنباله
        const nextId = parseInt(lesson.id) + 1;
        
        return {
            language: lesson.language,
            level: lesson.level,
            id: nextId
        };
    }
    
    _findRelatedLessons(lesson) {
        // پیدا کردن درس‌های مرتبط
        const related = [];
        
        // درس‌های هم‌سطح در زبان‌های دیگر
        if (lesson.language === 'en') {
            related.push({
                language: 'fa',
                level: lesson.level,
                id: lesson.id,
                relation: 'translation'
            });
        }
        
        // درس‌های مشابه در سطح‌های مختلف
        if (lesson.level !== 'expert') {
            const nextLevel = {
                beginner: 'intermediate',
                intermediate: 'advanced',
                advanced: 'expert'
            }[lesson.level];
            
            if (nextLevel) {
                related.push({
                    language: lesson.language,
                    level: nextLevel,
                    id: 1, // اولین درس در سطح بعدی
                    relation: 'next_level'
                });
            }
        }
        
        return related;
    }
    
    _calculateDifficultyScore(lesson) {
        // محاسبه امتیاز دشواری درس
        let score = 0;
        
        // بر اساس تعداد تمرین‌ها
        if (lesson.exercises) {
            score += lesson.exercises.length * 5;
        }
        
        // بر اساس طول محتوا
        if (lesson.content?.text) {
            const wordCount = lesson.content.text.split(' ').length;
            score += Math.min(wordCount / 100, 30); // حداکثر 30 امتیاز
        }
        
        // بر اساس نوع تمرین‌ها
        if (lesson.exercises) {
            const difficultTypes = ['speech_recognition', 'translation', 'writing'];
            const difficultCount = lesson.exercises.filter(ex => 
                difficultTypes.includes(ex.type)
            ).length;
            
            score += difficultCount * 15;
        }
        
        // نرمال‌سازی به مقیاس 0-100
        return Math.min(Math.round(score), 100);
    }
    
    _calculateInteractivityScore(lesson) {
        // محاسبه امتیاز تعاملی بودن
        let score = 0;
        
        if (lesson.content?.audio) score += 20;
        if (lesson.content?.video) score += 30;
        if (lesson.content?.interactive) score += 40;
        
        if (lesson.exercises) {
            const interactiveTypes = ['speech_recognition', 'matching', 'sequencing', 'interactive'];
            const interactiveCount = lesson.exercises.filter(ex => 
                interactiveTypes.includes(ex.type)
            ).length;
            
            score += interactiveCount * 10;
        }
        
        return Math.min(score, 100);
    }
    
    _extractPrerequisites(lesson) {
        // استخراج پیش‌نیازها از محتوای درس
        const prerequisites = [];
        
        // این یک پیاده‌سازی ساده است
        if (lesson.id > 1) {
            prerequisites.push({
                language: lesson.language,
                level: lesson.level,
                id: lesson.id - 1,
                reason: 'previous_lesson'
            });
        }
        
        if (lesson.metadata?.prerequisites) {
            prerequisites.push(...lesson.metadata.prerequisites);
        }
        
        return prerequisites;
    }
    
    _extractLearningObjectives(lesson) {
        // استخراج اهداف یادگیری
        if (lesson.metadata?.learningObjectives && 
            Array.isArray(lesson.metadata.learningObjectives)) {
            return lesson.metadata.learningObjectives;
        }
        
        // استخراج از محتوا
        const objectives = [];
        
        if (lesson.content?.text) {
            // جستجوی جملات حاوی "learn", "will be able to", etc.
            const sentences = lesson.content.text.split(/[.!?]+/);
            
            sentences.forEach(sentence => {
                const trimmed = sentence.trim();
                if (trimmed.length > 10 && 
                    (trimmed.toLowerCase().includes('learn') ||
                     trimmed.toLowerCase().includes('understand') ||
                     trimmed.toLowerCase().includes('able to'))) {
                    objectives.push(trimmed);
                }
            });
        }
        
        return objectives.length > 0 ? objectives : ['Master the content of this lesson'];
    }
    
    _extractKeywords(lesson) {
        // استخراج کلمات کلیدی
        const keywords = new Set();
        
        // از عنوان
        if (lesson.title) {
            lesson.title.split(' ').forEach(word => {
                if (word.length > 3) keywords.add(word.toLowerCase());
            });
        }
        
        // از محتوا (کلمات تکرارشونده)
        if (lesson.content?.text) {
            const words = lesson.content.text.toLowerCase().split(/\W+/);
            const wordCount = {};
            
            words.forEach(word => {
                if (word.length > 4) {
                    wordCount[word] = (wordCount[word] || 0) + 1;
                }
            });
            
            // انتخاب کلمات با تکرار بالا
            Object.entries(wordCount)
                .filter(([_, count]) => count >= 3)
                .slice(0, 10)
                .forEach(([word]) => keywords.add(word));
        }
        
        // از متادیتا
        if (lesson.metadata?.keywords) {
            lesson.metadata.keywords.forEach(keyword => keywords.add(keyword.toLowerCase()));
        }
        
        return Array.from(keywords).slice(0, 15);
    }
    
    _emitEvent(eventName, detail = {}) {
        const event = new CustomEvent(eventName, { detail });
        this.events.dispatchEvent(event);
    }
}

// Export برای استفاده جهانی
if (typeof window !== 'undefined') {
    window.HyperLessonManager = HyperLessonManager;
    window.LessonManager = HyperLessonManager; // نام مستعار برای سازگاری
}

console.log('[LessonManager] ماژول مدیریت درس بارگذاری شد');
