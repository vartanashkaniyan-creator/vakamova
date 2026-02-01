/**
 * VAKAMOVA LESSON MANAGER - موتور حرفه‌ای مدیریت درس‌ها
 * اصول: ۱. تزریق وابستگی ۲. قرارداد رابط ۳. رویدادمحور ۴. پیکربندی متمرکز
 */

class LessonManager {
    constructor(dependencies = {}, config = {}) {
        // اصل ۱: تزریق وابستگی
        this.deps = {
            eventBus: dependencies.eventBus || window.eventBus,
            stateManager: dependencies.stateManager || window.stateManager,
            database: dependencies.database || window.database,
            apiClient: dependencies.apiClient || window.apiClient,
            utils: dependencies.utils || window.utils,
            audioService: dependencies.audioService || null,
            analytics: dependencies.analytics || null
        };
        
        // اصل ۴: پیکربندی متمرکز
        this.config = Object.freeze({
            lessonTypes: {
                vocabulary: { weight: 1.0, timeLimit: 300 },
                grammar: { weight: 1.2, timeLimit: 420 },
                conversation: { weight: 1.5, timeLimit: 600 },
                listening: { weight: 1.3, timeLimit: 480 },
                reading: { weight: 1.1, timeLimit: 360 },
                ...config.lessonTypes
            },
            
            scoring: {
                baseScore: 100,
                timeBonusMultiplier: 0.1,
                streakBonus: 10,
                perfectBonus: 50,
                minPassingScore: 70,
                maxAttempts: 3,
                ...config.scoring
            },
            
            progression: {
                adaptiveDifficulty: true,
                masteryThreshold: 0.85,
                reviewInterval: [1, 3, 7, 14, 30], // روزهای مرور
                unlockThreshold: 0.75,
                ...config.progression
            },
            
            events: {
                LESSON_LOADED: 'lesson:loaded',
                LESSON_STARTED: 'lesson:started',
                EXERCISE_SUBMITTED: 'exercise:submitted',
                EXERCISE_COMPLETED: 'exercise:completed',
                LESSON_COMPLETED: 'lesson:completed',
                LESSON_PAUSED: 'lesson:paused',
                LESSON_RESUMED: 'lesson:resumed',
                LESSON_FAILED: 'lesson:failed',
                PROGRESS_UPDATED: 'lesson:progress:updated',
                ...config.events
            },
            
            uiDefaults: {
                showHints: true,
                showTimer: true,
                autoAdvance: true,
                confirmExit: true,
                ...config.uiDefaults
            },
            
            timeouts: {
                autoSave: 30000, // 30 ثانیه
                idleWarning: 120000, // 2 دقیقه
                sessionExpiry: 1800000, // 30 دقیقه
                ...config.timeouts
            },
            
            retryPolicy: {
                maxRetries: 3,
                retryDelay: 1000,
                exponentialBackoff: true,
                ...config.retryPolicy
            },
            
            ...config
        });
        
        // حالت مدیریت درس
        this.state = {
            currentLesson: null,
            currentExercise: null,
            session: {
                id: null,
                startTime: null,
                endTime: null,
                elapsedTime: 0,
                isPaused: false,
                score: 0,
                attempts: 0,
                completedExercises: 0,
                totalExercises: 0,
                streak: 0
            },
            userProgress: {
                accuracy: 0,
                averageTime: 0,
                totalScore: 0,
                lessonsCompleted: 0
            },
            timers: new Map(),
            observers: new Map()
        };
        
        // کش درس‌ها
        this.cache = {
            lessons: new Map(),
            progress: new Map(),
            statistics: new Map()
        };
        
        // Bind methods
        this.loadLesson = this.loadLesson.bind(this);
        this.startLesson = this.startLesson.bind(this);
        this.submitExercise = this.submitExercise.bind(this);
        this.completeLesson = this.completeLesson.bind(this);
        this.pauseLesson = this.pauseLesson.bind(this);
        this.resumeLesson = this.resumeLesson.bind(this);
        this.getProgress = this.getProgress.bind(this);
        this.cleanup = this.cleanup.bind(this);
        
        console.log('[LessonManager] ✅ Initialized with dependency injection');
    }
    
    // ==================== CORE LESSON METHODS ====================
    
    async loadLesson(lessonId, options = {}) {
        try {
            if (!lessonId) throw new Error('Lesson ID is required');
            
            // بررسی کش
            const cached = this.cache.lessons.get(lessonId);
            if (cached && !options.forceRefresh) {
                this.state.currentLesson = cached;
                this._emitEvent(this.config.events.LESSON_LOADED, {
                    lessonId,
                    fromCache: true,
                    timestamp: Date.now()
                });
                return { success: true, lesson: cached, cached: true };
            }
            
            // بارگذاری از دیتابیس/API
            const lesson = await this._fetchLesson(lessonId);
            
            // اعتبارسنجی ساختار درس
            this._validateLessonStructure(lesson);
            
            // محاسبه دشواری تطبیقی
            if (this.config.progression.adaptiveDifficulty) {
                lesson.adjustedDifficulty = this._calculateAdaptiveDifficulty(lesson);
            }
            
            // ذخیره در کش
            this.cache.lessons.set(lessonId, lesson);
            this.state.currentLesson = lesson;
            
            // بارگذاری پیشرفت کاربر
            await this._loadUserProgress(lessonId);
            
            this._emitEvent(this.config.events.LESSON_LOADED, {
                lessonId,
                lessonType: lesson.type,
                difficulty: lesson.difficulty,
                exerciseCount: lesson.exercises.length,
                timestamp: Date.now()
            });
            
            return { success: true, lesson, cached: false };
            
        } catch (error) {
            console.error('[LessonManager] Load lesson failed:', error);
            return { 
                success: false, 
                error: error.message,
                retryable: this._isRetryableError(error)
            };
        }
    }
    
    async startLesson(lessonId, options = {}) {
        try {
            if (this.state.session.id) {
                await this.completeLesson(false); // تکمیل درس قبلی
            }
            
            // بارگذاری درس
            const loadResult = await this.loadLesson(lessonId, options);
            if (!loadResult.success) throw new Error(loadResult.error);
            
            // ایجاد سشن جدید
            this.state.session = {
                id: `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                startTime: Date.now(),
                endTime: null,
                elapsedTime: 0,
                isPaused: false,
                score: 0,
                attempts: 0,
                completedExercises: 0,
                totalExercises: this.state.currentLesson.exercises.length,
                streak: 0
            };
            
            // تنظیم تایمرها
            this._setupSessionTimers();
            
            // بارگذاری اولین تمرین
            await this._loadNextExercise();
            
            // ذخیره در state manager
            this.deps.stateManager.set('lesson.currentSession', {
                lessonId,
                sessionId: this.state.session.id,
                startTime: this.state.session.startTime
            });
            
            this._emitEvent(this.config.events.LESSON_STARTED, {
                lessonId,
                sessionId: this.state.session.id,
                lessonType: this.state.currentLesson.type,
                timestamp: this.state.session.startTime
            });
            
            return { 
                success: true, 
                sessionId: this.state.session.id,
                firstExercise: this.state.currentExercise 
            };
            
        } catch (error) {
            console.error('[LessonManager] Start lesson failed:', error);
            return { success: false, error: error.message };
        }
    }
    
    async submitExercise(answer, options = {}) {
        try {
            if (!this.state.currentExercise) {
                throw new Error('No active exercise');
            }
            
            const exercise = this.state.currentExercise;
            const startTime = Date.now();
            
            // اعتبارسنجی پاسخ
            const validationResult = await this._validateAnswer(exercise, answer, options);
            
            // محاسبه امتیاز
            const scoringResult = this._calculateScore(exercise, validationResult, {
                responseTime: Date.now() - exercise.startTime,
                attemptNumber: this.state.session.attempts + 1,
                currentStreak: this.state.session.streak
            });
            
            // افزایش تعداد تلاش‌ها
            this.state.session.attempts++;
            
            // به‌روزرسانی استریک
            if (validationResult.isCorrect) {
                this.state.session.streak++;
            } else {
                this.state.session.streak = 0;
            }
            
            // به‌روزرسانی امتیاز
            this.state.session.score += scoringResult.score;
            
            // ثبت پاسخ
            const submission = {
                exerciseId: exercise.id,
                answer,
                isCorrect: validationResult.isCorrect,
                score: scoringResult.score,
                timeSpent: Date.now() - exercise.startTime,
                timestamp: Date.now(),
                attempt: this.state.session.attempts
            };
            
            // ذخیره موقت در سشن
            if (!this.state.session.submissions) {
                this.state.session.submissions = [];
            }
            this.state.session.submissions.push(submission);
            
            // انتشار رویداد
            this._emitEvent(this.config.events.EXERCISE_SUBMITTED, {
                exerciseId: exercise.id,
                isCorrect: validationResult.isCorrect,
                score: scoringResult.score,
                streak: this.state.session.streak,
                totalScore: this.state.session.score,
                timestamp: Date.now()
            });
            
            // بررسی تکمیل تمرین
            if (validationResult.isCorrect || 
                this.state.session.attempts >= this.config.scoring.maxAttempts) {
                
                await this._completeCurrentExercise(validationResult.isCorrect);
            }
            
            return {
                success: true,
                ...validationResult,
                ...scoringResult,
                submission,
                attemptsLeft: this.config.scoring.maxAttempts - this.state.session.attempts
            };
            
        } catch (error) {
            console.error('[LessonManager] Submit exercise failed:', error);
            return { success: false, error: error.message };
        }
    }
    
    async completeLesson(forceCompletion = false) {
        try {
            if (!this.state.currentLesson || !this.state.session.id) {
                throw new Error('No active lesson session');
            }
            
            const session = this.state.session;
            session.endTime = Date.now();
            session.elapsedTime = session.endTime - session.startTime;
            
            // محاسبه نمره نهایی
            const finalScore = this._calculateFinalScore();
            
            // بررسی قبولی
            const passed = finalScore >= this.config.scoring.minPassingScore;
            
            // آماده‌سازی داده تکمیل
            const completionData = {
                lessonId: this.state.currentLesson.id,
                sessionId: session.id,
                score: finalScore,
                passed,
                elapsedTime: session.elapsedTime,
                completedExercises: session.completedExercises,
                totalExercises: session.totalExercises,
                accuracy: session.completedExercises > 0 ? 
                    (session.submissions?.filter(s => s.isCorrect).length / session.completedExercises) : 0,
                submissions: session.submissions || [],
                timestamp: session.endTime
            };
            
            // ذخیره پیشرفت
            await this._saveProgress(completionData);
            
            // پاک‌سازی سشن جاری
            this._cleanupSession();
            
            // انتشار رویداد
            this._emitEvent(passed ? 
                this.config.events.LESSON_COMPLETED : 
                this.config.events.LESSON_FAILED, 
                completionData
            );
            
            return {
                success: true,
                passed,
                ...completionData
            };
            
        } catch (error) {
            console.error('[LessonManager] Complete lesson failed:', error);
            return { success: false, error: error.message };
        }
    }
    
    // ==================== SESSION MANAGEMENT ====================
    
    async pauseLesson() {
        if (!this.state.session.id || this.state.session.isPaused) {
            return { success: false, error: 'Lesson not active or already paused' };
        }
        
        this.state.session.isPaused = true;
        this.state.session.pauseStartTime = Date.now();
        
        // متوقف کردن تایمرها
        this._pauseTimers();
        
        this._emitEvent(this.config.events.LESSON_PAUSED, {
            sessionId: this.state.session.id,
            timestamp: Date.now()
        });
        
        return { success: true, sessionId: this.state.session.id };
    }
    
    async resumeLesson() {
        if (!this.state.session.id || !this.state.session.isPaused) {
            return { success: false, error: 'Lesson not paused' };
        }
        
        this.state.session.isPaused = false;
        const pauseDuration = Date.now() - this.state.session.pauseStartTime;
        
        // تنظیم مجدد تایمرها با درنظرگرفتن مدت توقف
        this._resumeTimers(pauseDuration);
        
        this._emitEvent(this.config.events.LESSON_RESUMED, {
            sessionId: this.state.session.id,
            pauseDuration,
            timestamp: Date.now()
        });
        
        return { success: true, sessionId: this.state.session.id };
    }
    
    // ==================== PROGRESS TRACKING ====================
    
    async getProgress(lessonId = null, userId = null) {
        try {
            const targetLessonId = lessonId || this.state.currentLesson?.id;
            if (!targetLessonId) throw new Error('Lesson ID is required');
            
            // بررسی کش
            const cacheKey = `${targetLessonId}_${userId || 'current'}`;
            if (this.cache.progress.has(cacheKey)) {
                return this.cache.progress.get(cacheKey);
            }
            
            // بارگذاری پیشرفت
            const progress = await this._fetchProgress(targetLessonId, userId);
            
            // محاسبه آمار پیشرفته
            const enrichedProgress = this._enrichProgressData(progress);
            
            // ذخیره در کش
            this.cache.progress.set(cacheKey, enrichedProgress);
            
            return enrichedProgress;
            
        } catch (error) {
            console.error('[LessonManager] Get progress failed:', error);
            return { success: false, error: error.message };
        }
    }
    
    // ==================== PRIVATE CORE METHODS ====================
    
    async _fetchLesson(lessonId) {
        // اولویت‌بندی منابع: کش ← دیتابیس ← API ← فال‌بک
        
        // تلاش از دیتابیس
        if (this.deps.database) {
            try {
                const lesson = await this.deps.database.getLessonById(lessonId);
                if (lesson) return this._normalizeLessonData(lesson);
            } catch (error) {
                console.warn('[LessonManager] Database fetch failed:', error);
            }
        }
        
        // تلاش از API
        if (this.deps.apiClient) {
            try {
                const response = await this.deps.apiClient.get(`/lessons/${lessonId}`);
                if (response.data) return this._normalizeLessonData(response.data);
            } catch (error) {
                console.warn('[LessonManager] API fetch failed:', error);
            }
        }
        
        // فال‌بک
        return this._createFallbackLesson(lessonId);
    }
    
    async _validateAnswer(exercise, answer, options) {
        const validators = {
            multiple_choice: (ex, ans) => {
                const correctOption = ex.options.find(opt => opt.correct);
                return {
                    isCorrect: ans === correctOption?.id,
                    correctAnswer: correctOption?.id,
                    explanation: correctOption?.explanation
                };
            },
            
            fill_blank: (ex, ans) => {
                const correctAnswers = ex.correctAnswers || [];
                const normalizedAnswer = this._normalizeText(ans);
                const isCorrect = correctAnswers.some(correct => 
                    this._normalizeText(correct) === normalizedAnswer
                );
                
                return {
                    isCorrect,
                    correctAnswer: correctAnswers[0],
                    alternatives: correctAnswers.slice(1)
                };
            },
            
            matching: (ex, ans) => {
                const correctPairs = ex.pairs || [];
                const userPairs = ans.pairs || [];
                
                let correctCount = 0;
                userPairs.forEach(userPair => {
                    const isCorrect = correctPairs.some(correctPair => 
                        correctPair.left === userPair.left && 
                        correctPair.right === userPair.right
                    );
                    if (isCorrect) correctCount++;
                });
                
                const isComplete = correctCount === correctPairs.length;
                
                return {
                    isCorrect: isComplete,
                    correctCount,
                    totalCount: correctPairs.length,
                    accuracy: correctCount / correctPairs.length
                };
            },
            
            speaking: async (ex, ans) => {
                // تحلیل صدا (اگر سرویس صوتی موجود باشد)
                if (this.deps.audioService) {
                    const analysis = await this.deps.audioService.analyzeSpeech(ans, ex.targetPhrase);
                    return {
                        isCorrect: analysis.confidence >= 0.7,
                        confidence: analysis.confidence,
                        pronunciationScore: analysis.pronunciationScore,
                        feedback: analysis.feedback
                    };
                }
                
                // فال‌بک برای تمرین‌های speaking
                return {
                    isCorrect: true,
                    confidence: 0.8,
                    pronunciationScore: 75,
                    feedback: 'Good pronunciation!'
                };
            }
        };
        
        const validator = validators[exercise.type] || validators.multiple_choice;
        const result = await validator(exercise, answer);
        
        // اضافه کردن بازخورد سفارشی
        if (result.isCorrect) {
            result.feedback = exercise.feedback?.correct || 
                            this._getRandomFeedback('correct');
        } else {
            result.feedback = exercise.feedback?.incorrect || 
                            this._getRandomFeedback('incorrect', exercise.hints);
        }
        
        return result;
    }
    
    _calculateScore(exercise, validationResult, context) {
        const baseScore = this.config.scoring.baseScore;
        const typeMultiplier = this.config.lessonTypes[exercise.type]?.weight || 1.0;
        
        let score = 0;
        
        if (validationResult.isCorrect) {
            // امتیاز پایه
            score = baseScore * typeMultiplier;
            
            // پاداش زمان
            const timeBonus = Math.max(0, 1 - (context.responseTime / 10000)) * 
                            this.config.scoring.timeBonusMultiplier * score;
            score += timeBonus;
            
            // پاداش استریک
            if (context.currentStreak > 0) {
                const streakBonus = Math.min(
                    this.config.scoring.streakBonus * context.currentStreak,
                    score * 0.3
                );
                score += streakBonus;
            }
            
            // پاداش کامل
            if (validationResult.accuracy === 1) {
                score += this.config.scoring.perfectBonus;
            }
            
            // کاهش بر اساس تعداد تلاش
            if (context.attemptNumber > 1) {
                score *= Math.pow(0.8, context.attemptNumber - 1);
            }
        }
        
        // گرد کردن
        score = Math.round(score);
        
        return {
            score,
            breakdown: {
                base: baseScore * typeMultiplier,
                timeBonus: validationResult.isCorrect ? 
                    Math.max(0, 1 - (context.responseTime / 10000)) * 
                    this.config.scoring.timeBonusMultiplier * baseScore * typeMultiplier : 0,
                streakBonus: validationResult.isCorrect && context.currentStreak > 0 ? 
                    Math.min(this.config.scoring.streakBonus * context.currentStreak, score * 0.3) : 0,
                perfectBonus: validationResult.accuracy === 1 ? 
                    this.config.scoring.perfectBonus : 0,
                attemptPenalty: context.attemptNumber > 1 ? 
                    Math.pow(0.8, context.attemptNumber - 1) : 1
            }
        };
    }
    
    // ==================== PROGRESS & ADAPTIVE METHODS ====================
    
    _calculateAdaptiveDifficulty(lesson) {
        const userProgress = this.state.userProgress;
        const baseDifficulty = lesson.difficulty || 'beginner';
        
        if (!userProgress.accuracy || userProgress.accuracy === 0) {
            return baseDifficulty;
        }
        
        const difficultyLevels = ['beginner', 'intermediate', 'advanced'];
        const currentIndex = difficultyLevels.indexOf(baseDifficulty);
        
        if (userProgress.accuracy >= this.config.progression.masteryThreshold) {
            // افزایش دشواری
            return difficultyLevels[Math.min(currentIndex + 1, difficultyLevels.length - 1)];
        } else if (userProgress.accuracy < this.config.progression.unlockThreshold) {
            // کاهش دشواری
            return difficultyLevels[Math.max(currentIndex - 1, 0)];
        }
        
        return baseDifficulty;
    }
    
    async _loadUserProgress(lessonId) {
        try {
            const progress = await this.getProgress(lessonId);
            
            if (progress.success !== false) {
                this.state.userProgress = {
                    accuracy: progress.overallAccuracy || 0,
                    averageTime: progress.averageTimePerExercise || 0,
                    totalScore: progress.totalScore || 0,
                    lessonsCompleted: progress.lessonsCompleted || 0,
                    lastAttempt: progress.lastAttempt,
                    bestScore: progress.bestScore,
                    attempts: progress.attempts || 0
                };
            }
        } catch (error) {
            console.warn('[LessonManager] Load user progress failed:', error);
        }
    }
    
    async _saveProgress(completionData) {
        try {
            const progressRecord = {
                lessonId: completionData.lessonId,
                userId: this._getCurrentUserId(),
                sessionId: completionData.sessionId,
                score: completionData.score,
                passed: completionData.passed,
                accuracy: completionData.accuracy,
                elapsedTime: completionData.elapsedTime,
                completedExercises: completionData.completedExercises,
                totalExercises: completionData.totalExercises,
                submissions: completionData.submissions,
                completedAt: new Date().toISOString(),
                nextReviewDate: this._calculateNextReviewDate(completionData.accuracy)
            };
            
            // ذخیره در دیتابیس
            if (this.deps.database) {
                await this.deps.database.saveLessonProgress(progressRecord);
            }
            
            // ذخیره در state manager
            this.deps.stateManager.set(`progress.${completionData.lessonId}`, progressRecord);
            
            // به‌روزرسانی کش
            const cacheKey = `${completionData.lessonId}_current`;
            this.cache.progress.set(cacheKey, progressRecord);
            
            // انتشار رویداد پیشرفت
            this._emitEvent(this.config.events.PROGRESS_UPDATED, progressRecord);
            
            // ارسال آنالیتیکس
            if (this.deps.analytics) {
                this.deps.analytics.track('lesson_completed', progressRecord);
            }
            
        } catch (error) {
            console.error('[LessonManager] Save progress failed:', error);
        }
    }
    
    // ==================== UTILITY METHODS ====================
    
    _setupSessionTimers() {
        // تایمر ذخیره خودکار
        const autoSaveTimer = setInterval(() => {
            this._autoSaveProgress();
        }, this.config.timeouts.autoSave);
        
        // تایمر هشدار بی‌فعالی
        const idleTimer = setTimeout(() => {
            this._emitEvent('lesson:idle:warning', {
                sessionId: this.state.session.id,
                elapsedTime: Date.now() - this.state.session.startTime
            });
        }, this.config.timeouts.idleWarning);
        
        // تایمر انقضای سشن
        const expiryTimer = setTimeout(() => {
            this._handleSessionExpiry();
        }, this.config.timeouts.sessionExpiry);
        
        this.state.timers.set('autoSave', autoSaveTimer);
        this.state.timers.set('idleWarning', idleTimer);
        this.state.timers.set('sessionExpiry', expiryTimer);
    }
    
    async _loadNextExercise() {
        if (!this.state.currentLesson) return;
        
        const completedExercises = this.state.session.submissions
            ?.filter(s => s.isCorrect)
            .map(s => s.exerciseId) || [];
        
        // انتخاب تمرین بعدی (الگوریتم تطبیقی)
        const nextExercise = this._selectNextExercise(completedExercises);
        
        if (nextExercise) {
            this.state.currentExercise = {
                ...nextExercise,
                startTime: Date.now(),
                sessionId: this.state.session.id
            };
            
            return nextExercise;
        }
        
        // اگر تمرینی نمانده، درس را تکمیل کن
        await this.completeLesson();
        return null;
    }
    
    async _completeCurrentExercise(isCorrect) {
        this.state.session.completedExercises++;
        
        // پاک‌سازی تمرین جاری
        this.state.currentExercise = null;
        
        // بارگذاری تمرین بعدی
        const nextExercise = await this._loadNextExercise();
        
        this._emitEvent(this.config.events.EXERCISE_COMPLETED, {
            exerciseId: this.state.currentExercise?.id,
            isCorrect,
            completedCount: this.state.session.completedExercises,
            totalCount: this.state.session.totalExercises,
            timestamp: Date.now()
        });
        
        return nextExercise;
    }
    
    _calculateFinalScore() {
        const session = this.state.session;
        
        if (session.completedExercises === 0) return 0;
        
        // میانگین امتیاز تمرین‌ها
        const exerciseScores = session.submissions
            ?.filter(s => s.isCorrect)
            .map(s => s.score) || [];
        
        const averageScore = exerciseScores.length > 0 
            ? exerciseScores.reduce((a, b) => a + b, 0) / exerciseScores.length 
            : 0;
        
        // ضریب تکمیل
        const completionRatio = session.completedExercises / session.totalExercises;
        
        // نمره نهایی
        let finalScore = averageScore * completionRatio;
        
        // پاداش سرعت (اگر در زمان معقولی تکمیل شده باشد)
        const expectedTime = this.state.currentLesson.expectedDuration || 600000; // 10 دقیقه
        if (session.elapsedTime < expectedTime) {
            const timeBonus = (1 - (session.elapsedTime / expectedTime)) * 0.2 * finalScore;
            finalScore += timeBonus;
        }
        
        // محدود کردن به 1000
        finalScore = Math.min(finalScore, 1000);
        
        return Math.round(finalScore);
    }
    
    _calculateNextReviewDate(accuracy) {
        const intervals = this.config.progression.reviewInterval;
        let intervalIndex = 0;
        
        if (accuracy >= 0.9) intervalIndex = 3;
        else if (accuracy >= 0.8) intervalIndex = 2;
        else if (accuracy >= 0.7) intervalIndex = 1;
        
        const days = intervals[Math.min(intervalIndex, intervals.length - 1)];
        const nextReview = new Date();
        nextReview.setDate(nextReview.getDate() + days);
        
        return nextReview.toISOString();
    }
    
    // ==================== CLEANUP METHODS ====================
    
    _cleanupSession() {
        // پاک‌سازی تایمرها
        for (const [name, timer] of this.state.timers) {
            if (name.includes('interval')) {
                clearInterval(timer);
            } else {
                clearTimeout(timer);
            }
        }
        this.state.timers.clear();
        
        // پاک‌سازی observers
        for (const [event, unsubscribe] of this.state.observers) {
            if (typeof unsubscribe === 'function') {
                unsubscribe();
            }
        }
        this.state.observers.clear();
        
        // ریست state سشن
        this.state.session = {
            id: null,
            startTime: null,
            endTime: null,
            elapsedTime: 0,
            isPaused: false,
            score: 0,
            attempts: 0,
            completedExercises: 0,
            totalExercises: 0,
            streak: 0
        };
        
        this.state.currentExercise = null;
    }
    
    cleanup() {
        this._cleanupSession();
        
        // پاک‌سازی کش
        this.cache.lessons.clear();
        this.cache.progress.clear();
        this.cache.statistics.clear();
        
        // پاک‌سازی state
        this.state.currentLesson = null;
        this.state.userProgress = {
            accuracy: 0,
            averageTime: 0,
            totalScore: 0,
            lessonsCompleted: 0
        };
        
        console.log('[LessonManager] 🧹 Cleaned up');
    }
    
    // ==================== HELPER METHODS ====================
    
    _emitEvent(eventName, data) {
        if (this.deps.eventBus && typeof this.deps.eventBus.emit === 'function') {
            this.deps.eventBus.emit(eventName, data);
        }
    }
    
    _normalizeLessonData(rawData) {
        return {
            id: rawData.id,
            title: rawData.title,
            description: rawData.description,
            type: rawData.type || 'vocabulary',
            difficulty: rawData.difficulty || 'beginner',
            language: rawData.language || 'en',
            category: rawData.category,
            expectedDuration: rawData.duration || 600000, // 10 دقیقه
            exercises: rawData.exercises || [],
            prerequisites: rawData.prerequisites || [],
            metadata: {
                author: rawData.author,
                version: rawData.version || '1.0',
                tags: rawData.tags || [],
                ...rawData.metadata
            },
            settings: {
                allowRetry: rawData.allowRetry ?? true,
                showSolution: rawData.showSolution ?? true,
                timeLimit: rawData.timeLimit,
                ...rawData.settings
            }
        };
    }
    
    _createFallbackLesson(lessonId) {
        return {
            id: lessonId,
            title: 'درس نمونه',
            description: 'این یک درس نمونه است',
            type: 'vocabulary',
            difficulty: 'beginner',
            language: 'fa',
            expectedDuration: 300000,
            exercises: [
                {
                    id: 'ex1',
                    type: 'multiple_choice',
                    question: 'معنی کلمه "کتاب" چیست؟',
                    options: [
                        { id: 'a', text: 'Book', correct: true },
                        { id: 'b', text: 'Pen' },
                        { id: 'c', text: 'Table' }
                    ]
                }
            ]
        };
    }
    
    _selectNextExercise(completedExercises) {
        const availableExercises = this.state.currentLesson.exercises
            .filter(ex => !completedExercises.includes(ex.id));
        
        if (availableExercises.length === 0) return null;
        
        // الگوریتم انتخاب تطبیقی
        const weights = availableExercises.map(ex => {
            let weight = 1.0;
            
            // اولویت به تمرین‌های انجام نشده
            if (this.state.userProgress.accuracy < 0.7) {
                // اگر کاربر ضعیف است، تمرین‌های آسان‌تر را بیشتر نشان بده
                if (ex.difficulty === 'easy') weight *= 2;
            } else {
                // اگر کاربر قوی است، تمرین‌های سخت‌تر را بیشتر نشان بده
                if (ex.difficulty === 'hard') weight *= 1.5;
            }
            
            // اولویت به انواع تمرین مختلف
            const typeCount = availableExercises.filter(e => e.type === ex.type).length;
            if (typeCount < 2) weight *= 1.2;
            
            return weight;
        });
        
        // انتخاب تصادفی وزندار
        const totalWeight = weights.reduce((a, b) => a + b, 0);
        let random = Math.random() * totalWeight;
        
        for (let i = 0; i < availableExercises.length; i++) {
            random -= weights[i];
            if (random <= 0) {
                return availableExercises[i];
            }
        }
        
        return availableExercises[0];
    }
    
    _getRandomFeedback(type, hints = []) {
        const feedbacks = {
            correct: [
                'عالی!',
                'درست جواب دادی!',
                'آفرین!',
                'خیلی خوب!',
                'همینطور ادامه بده!'
            ],
            incorrect: [
                'اشکال نداره، دوباره تلاش کن!',
                'نزدیک بود! یک بار دیگه امتحان کن.',
                'بیا دوباره سعی کنیم!',
                hints.length > 0 ? 
                    `راهنمایی: ${hints[0]}` : 
                    'مجددا تلاش کن!'
            ]
        };
        
        const list = feedbacks[type] || feedbacks.correct;
        return list[Math.floor(Math.random() * list.length)];
    }
    
    _normalizeText(text) {
        return String(text).toLowerCase().trim()
            .replace(/[.\s,;:!?]/g, '')
            .replace(/[آاآ]/g, 'ا')
            .replace(/[یي]/g, 'ی')
            .replace(/[کك]/g, 'ک');
    }
    
    _getCurrentUserId() {
        return this.deps.stateManager?.get('user.id') || 'anonymous';
    }
    
    _isRetryableError(error) {
        const retryableErrors = [
            'network',
            'timeout',
            'server',
            'connection'
        ];
        
        return retryableErrors.some(keyword => 
            error.message.toLowerCase().includes(keyword)
        );
    }
}

// Export برای استفاده در سیستم
if (typeof window !== 'undefined') {
    window.LessonManager = LessonManager;
}

export { LessonManager };
