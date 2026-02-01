/**
 * VAKAMOVA LESSON SERVICE - مدیریت داده و منطق درس‌ها
 * اصول: ۱. تزریق وابستگی ۲. قرارداد رابط ۳. رویدادمحور ۴. پیکربندی متمرکز
 */

class LessonService {
    constructor(dependencies = {}, config = {}) {
        // اصل ۱: تزریق وابستگی
        this.deps = {
            eventBus: dependencies.eventBus || window.eventBus,
            stateManager: dependencies.stateManager || window.stateManager,
            authManager: dependencies.authManager || window.authManager,
            apiClient: dependencies.apiClient || window.apiClient,
            db: dependencies.db || window.database
        };
        
        // اصل ۴: پیکربندی متمرکز
        this.config = Object.freeze({
            cacheTTL: config.cacheTTL || 300000,
            maxRetries: config.maxRetries || 3,
            syncInterval: config.syncInterval || 30000,
            lessonTypes: config.lessonTypes || ['vocabulary', 'grammar', 'conversation', 'listening'],
            difficultyLevels: config.difficultyLevels || ['beginner', 'intermediate', 'advanced'],
            apiEndpoints: {
                lessons: '/api/lessons',
                progress: '/api/progress',
                exercises: '/api/exercises',
                ...config.apiEndpoints
            },
            events: {
                LESSON_LOADED: 'lesson:loaded',
                LESSON_COMPLETED: 'lesson:completed',
                PROGRESS_UPDATED: 'lesson:progress:updated',
                SYNC_STARTED: 'lesson:sync:started',
                SYNC_COMPLETED: 'lesson:sync:completed',
                ...config.events
            },
            ...config
        });
        
        this.cache = new Map();
        this.syncQueue = [];
        this.isSyncing = false;
        this.activeLessons = new Map();
        
        this._init();
    }
    
    // ==================== CORE METHODS ====================
    
    async loadLesson(lessonId, options = {}) {
        const cacheKey = `lesson_${lessonId}`;
        
        // بررسی کش
        if (!options.forceRefresh) {
            const cached = this._getFromCache(cacheKey);
            if (cached) return cached;
        }
        
        try {
            this.deps.eventBus.emit(this.config.events.LESSON_LOADED, { 
                lessonId, 
                status: 'loading' 
            });
            
            // بارگیری از منابع مختلف
            const [lessonData, userProgress] = await Promise.all([
                this._fetchLessonData(lessonId),
                this._fetchUserProgress(lessonId)
            ]);
            
            // ترکیب داده‌ها
            const enrichedLesson = this._enrichLessonData(lessonData, userProgress);
            
            // ذخیره در کش
            this._addToCache(cacheKey, enrichedLesson);
            
            // ذخیره در state
            this.deps.stateManager.set(`lessons.active.${lessonId}`, enrichedLesson);
            
            // ثبت در درس‌های فعال
            this.activeLessons.set(lessonId, {
                data: enrichedLesson,
                lastAccessed: Date.now()
            });
            
            this.deps.eventBus.emit(this.config.events.LESSON_LOADED, { 
                lessonId, 
                status: 'loaded',
                data: enrichedLesson 
            });
            
            return enrichedLesson;
            
        } catch (error) {
            this.deps.eventBus.emit(this.config.events.LESSON_LOADED, { 
                lessonId, 
                status: 'error',
                error: error.message 
            });
            throw error;
        }
    }
    
    async submitExercise(lessonId, exerciseId, answers, options = {}) {
        const submissionId = `sub_${Date.now()}`;
        
        try {
            // اعتبارسنجی اولیه
            this._validateSubmission(lessonId, exerciseId, answers);
            
            // ارزیابی پاسخ
            const evaluation = await this._evaluateAnswers(lessonId, exerciseId, answers);
            
            // ذخیره موقت
            const submission = {
                id: submissionId,
                lessonId,
                exerciseId,
                answers,
                evaluation,
                timestamp: Date.now(),
                status: 'submitted'
            };
            
            this.deps.stateManager.set(`submissions.${submissionId}`, submission);
            
            // به‌روزرسانی پیشرفت
            await this._updateProgress(lessonId, evaluation);
            
            // افزودن به صف همگام‌سازی
            if (navigator.onLine) {
                this._addToSyncQueue(submission);
                this._startSync();
            }
            
            return evaluation;
            
        } catch (error) {
            this.deps.eventBus.emit('lesson:exercise:error', {
                lessonId,
                exerciseId,
                error: error.message
            });
            throw error;
        }
    }
    
    async getNextLesson(currentLessonId, options = {}) {
        const currentLesson = await this.loadLesson(currentLessonId);
        const userLevel = this.deps.stateManager.get('user.level') || 'beginner';
        const language = options.language || this.deps.stateManager.get('user.language') || 'en';
        
        // الگوریتم توصیه‌گر هوشمند
        const nextLesson = await this._findNextLesson({
            currentLesson,
            userLevel,
            language,
            preferredType: options.preferredType,
            difficultyBoost: options.difficultyBoost || 0
        });
        
        return nextLesson;
    }
    
    // ==================== PROGRESS MANAGEMENT ====================
    
    async getUserProgress(language = null, options = {}) {
        const userId = this.deps.authManager.getCurrentUserId();
        if (!userId) throw new Error('User not authenticated');
        
        const cacheKey = `progress_${userId}_${language || 'all'}`;
        
        if (!options.forceRefresh) {
            const cached = this._getFromCache(cacheKey);
            if (cached) return cached;
        }
        
        try {
            let progressData;
            
            if (navigator.onLine && !options.offlineOnly) {
                progressData = await this.deps.apiClient.get(
                    this.config.apiEndpoints.progress,
                    { params: { userId, language } }
                );
            } else {
                progressData = await this.deps.db.getUserProgress(userId, language);
            }
            
            // محاسبه آمار پیشرفته
            const enrichedProgress = this._calculateProgressMetrics(progressData);
            
            this._addToCache(cacheKey, enrichedProgress, 60000); // 1 minute cache
            
            return enrichedProgress;
            
        } catch (error) {
            console.warn('[LessonService] Progress fetch failed, using fallback:', error);
            return this._getFallbackProgress(userId, language);
        }
    }
    
    // ==================== SYNC SYSTEM ====================
    
    async _startSync() {
        if (this.isSyncing || this.syncQueue.length === 0) return;
        
        this.isSyncing = true;
        this.deps.eventBus.emit(this.config.events.SYNC_STARTED, {
            queueSize: this.syncQueue.length
        });
        
        try {
            while (this.syncQueue.length > 0) {
                const submission = this.syncQueue.shift();
                
                await this._syncToServer(submission);
                
                // حذف از state پس از همگام‌سازی موفق
                this.deps.stateManager.delete(`submissions.${submission.id}`);
            }
            
            this.deps.eventBus.emit(this.config.events.SYNC_COMPLETED, {
                success: true,
                syncedCount: this.syncQueue.length
            });
            
        } catch (error) {
            this.deps.eventBus.emit(this.config.events.SYNC_COMPLETED, {
                success: false,
                error: error.message
            });
        } finally {
            this.isSyncing = false;
        }
    }
    
    // ==================== UTILITY METHODS ====================
    
    _init() {
        // Event listeners
        this.deps.eventBus.on('network:online', () => this._startSync());
        this.deps.eventBus.on('auth:logout', () => this.cleanup());
        
        // Periodic sync
        setInterval(() => this._startSync(), this.config.syncInterval);
        
        // Cleanup old cache
        setInterval(() => this._cleanupCache(), 60000);
    }
    
    _validateSubmission(lessonId, exerciseId, answers) {
        if (!lessonId || !exerciseId) {
            throw new Error('Lesson ID and Exercise ID are required');
        }
        
        if (!answers || typeof answers !== 'object') {
            throw new Error('Answers must be an object');
        }
        
        // بررسی وجود درس فعال
        if (!this.activeLessons.has(lessonId)) {
            throw new Error('Lesson not loaded');
        }
    }
    
    _getFromCache(key) {
        const cached = this.cache.get(key);
        if (!cached) return null;
        
        if (Date.now() - cached.timestamp > cached.ttl) {
            this.cache.delete(key);
            return null;
        }
        
        return cached.data;
    }
    
    _addToCache(key, data, ttl = this.config.cacheTTL) {
        this.cache.set(key, {
            data,
            timestamp: Date.now(),
            ttl
        });
    }
    
    _cleanupCache() {
        const now = Date.now();
        for (const [key, value] of this.cache.entries()) {
            if (now - value.timestamp > value.ttl) {
                this.cache.delete(key);
            }
        }
    }
    
    cleanup() {
        this.cache.clear();
        this.syncQueue = [];
        this.activeLessons.clear();
        this.isSyncing = false;
    }
}

// Export
if (typeof window !== 'undefined') {
    window.LessonService = LessonService;
}

export { LessonService };
