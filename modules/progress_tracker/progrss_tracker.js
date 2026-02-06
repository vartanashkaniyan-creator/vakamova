/**
 * @file modules/progress-tracker/progress-tracker.js
 * @desc ردیابی پیشرفت کاربر - ثبت جلسات، نتایج تمرین‌ها و محاسبه آمار
 * @implements IProgressTracker (قرارداد انتزاعی)
 */

/**
 * @interface IProgressTracker
 * @desc قرارداد انتزاعی برای ردیابی پیشرفت کاربر
 */
class IProgressTracker {
    /**
     * @method startSession
     * @param {string} sessionId - شناسه جلسه
     * @param {string} userId - شناسه کاربر
     * @param {string} lessonId - شناسه درس
     * @returns {Promise<void>}
     */
    async startSession(sessionId, userId, lessonId) {
        throw new Error('Method not implemented');
    }

    /**
     * @method recordExerciseResult
     * @param {Object} data - داده‌های نتیجه تمرین
     * @param {string} data.sessionId - شناسه جلسه
     * @param {string} data.exerciseId - شناسه تمرین
     * @param {boolean} data.isCorrect - صحیح/غلط بودن پاسخ
     * @param {number} data.score - امتیاز کسب‌شده
     * @param {number} data.timeSpent - زمان صرف‌شده (ثانیه)
     * @returns {Promise<void>}
     */
    async recordExerciseResult(data) {
        throw new Error('Method not implemented');
    }

    /**
     * @method completeLesson
     * @param {string} userId - شناسه کاربر
     * @param {string} lessonId - شناسه درس
     * @param {number} score - امتیاز کل درس
     * @param {Date} startTime - زمان شروع درس
     * @param {Date} endTime - زمان پایان درس
     * @returns {Promise<void>}
     */
    async completeLesson(userId, lessonId, score, startTime, endTime) {
        throw new Error('Method not implemented');
    }

    /**
     * @method getUserProgress
     * @param {string} userId - شناسه کاربر
     * @param {string} courseId - شناسه دوره
     * @returns {Promise<UserProgressData>}
     */
    async getUserProgress(userId, courseId) {
        throw new Error('Method not implemented');
    }

    /**
     * @method getUserStats
     * @param {string} userId - شناسه کاربر
     * @returns {Promise<UserStats>}
     */
    async getUserStats(userId) {
        throw new Error('Method not implemented');
    }
}

/**
 * @class ProgressTracker
 * @implements IProgressTracker
 * @desc پیاده‌سازی ردیابی پیشرفت کاربر با ذخیره‌سازی در دیتابیس
 */
class ProgressTracker {
    /**
     * @constructor
     * @param {Object} dependencies - وابستگی‌های تزریق‌شده
     * @param {IDatabase} dependencies.database - اینترفیس دیتابیس
     * @param {IEventBus} dependencies.eventBus - اینترفیس سیستم رویداد
     */
    constructor({ database, eventBus }) {
        // وارونگی وابستگی (DIP): وابستگی به انتزاع‌ها
        if (!database || !eventBus) {
            throw new Error('Database and EventBus dependencies are required');
        }

        this._database = database;
        this._eventBus = eventBus;

        // تک‌وظیفگی (SRP): این کلاس فقط برای ردیابی پیشرفت است
        console.log('ProgressTracker initialized with dependency injection');
    }

    /**
     * @method startSession
     * @param {string} sessionId - شناسه جلسه
     * @param {string} userId - شناسه کاربر
     * @param {string} lessonId - شناسه درس
     * @returns {Promise<void>}
     * @desc شروع یک جلسه یادگیری جدید
     */
    async startSession(sessionId, userId, lessonId) {
        try {
            // DRY: استفاده از متد کمکی برای ذخیره‌سازی
            await this._saveSessionRecord({
                sessionId,
                userId,
                lessonId,
                startTime: new Date(),
                status: 'active'
            });

            // باز-بسته (OCP): انتشار رویداد برای توسعه‌پذیری
            this._eventBus.publish('progress.session_started', {
                sessionId,
                userId,
                lessonId,
                timestamp: new Date()
            });

        } catch (error) {
            this._eventBus.publish('progress.error', {
                action: 'startSession',
                error: error.message
            });
            throw error;
        }
    }

    /**
     * @method recordExerciseResult
     * @param {Object} data - داده‌های نتیجه تمرین
     * @returns {Promise<void>}
     * @desc ثبت نتیجه یک تمرین
     */
    async recordExerciseResult(data) {
        const { sessionId, exerciseId, isCorrect, score, timeSpent } = data;

        try {
            // ذخیره نتیجه تمرین
            await this._saveExerciseResult({
                sessionId,
                exerciseId,
                isCorrect,
                score,
                timeSpent,
                completedAt: new Date()
            });

            // محاسبه و ذخیره آمار لحظه‌ای
            await this._updateUserStats(data);

            // انتشار رویداد
            this._eventBus.publish('progress.exercise_completed', {
                sessionId,
                exerciseId,
                isCorrect,
                score,
                timeSpent
            });

        } catch (error) {
            this._eventBus.publish('progress.error', {
                action: 'recordExerciseResult',
                error: error.message
            });
            throw error;
        }
    }

    /**
     * @method completeLesson
     * @param {string} userId - شناسه کاربر
     * @param {string} lessonId - شناسه درس
     * @param {number} score - امتیاز کل درس
     * @param {Date} startTime - زمان شروع درس
     * @param {Date} endTime - زمان پایان درس
     * @returns {Promise<void>}
     * @desc تکمیل یک درس و ثبت نهایی نتایج
     */
    async completeLesson(userId, lessonId, score, startTime, endTime) {
        try {
            const duration = endTime - startTime; // مدت زمان به میلی‌ثانیه

            await this._saveCompletedLesson({
                userId,
                lessonId,
                score,
                startTime,
                endTime,
                duration,
                completedAt: new Date()
            });

            // KISS: منطق ساده به‌روزرسانی پیشرفت
            await this._updateCourseProgress(userId, lessonId);

            this._eventBus.publish('progress.lesson_completed', {
                userId,
                lessonId,
                score,
                duration
            });

        } catch (error) {
            this._eventBus.publish('progress.error', {
                action: 'completeLesson',
                error: error.message
            });
            throw error;
        }
    }

    /**
     * @method getUserProgress
     * @param {string} userId - شناسه کاربر
     * @param {string} courseId - شناسه دوره
     * @returns {Promise<UserProgressData>}
     * @desc دریافت پیشرفت کاربر در یک دوره خاص
     */
    async getUserProgress(userId, courseId) {
        try {
            // جمع‌آوری داده‌ها از منابع مختلف
            const [completedLessons, totalLessons, overallScore, timeSpent] = await Promise.all([
                this._getCompletedLessonsCount(userId, courseId),
                this._getTotalLessonsCount(courseId),
                this._getOverallScore(userId, courseId),
                this._getTotalTimeSpent(userId, courseId)
            ]);

            // YAGNI: فقط داده‌های مورد نیاز فعلی را محاسبه می‌کنیم
            return {
                userId,
                courseId,
                completedLessons,
                totalLessons,
                overallScore,
                timeSpent,
                lastActive: await this._getLastActiveTime(userId),
                completionPercentage: totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0,
                averageScore: completedLessons > 0 ? Math.round(overallScore / completedLessons) : 0
            };

        } catch (error) {
            this._eventBus.publish('progress.error', {
                action: 'getUserProgress',
                error: error.message
            });
            throw error;
        }
    }

    /**
     * @method getUserStats
     * @param {string} userId - شناسه کاربر
     * @returns {Promise<UserStats>}
     * @desc دریافت آمار کلی کاربر
     */
    async getUserStats(userId) {
        try {
            const [totalSessions, totalExercises, totalTime, streakDays] = await Promise.all([
                this._getTotalSessions(userId),
                this._getTotalExercises(userId),
                this._getTotalLearningTime(userId),
                this._getCurrentStreak(userId)
            ]);

            return {
                userId,
                totalSessions,
                totalExercises,
                totalTime,
                streakDays,
                averageAccuracy: await this._getAverageAccuracy(userId),
                favoriteLesson: await this._getFavoriteLesson(userId),
                lastActivity: await this._getLastActivity(userId)
            };

        } catch (error) {
            this._eventBus.publish('progress.error', {
                action: 'getUserStats',
                error: error.message
            });
            throw error;
        }
    }

    // ==================== متدهای خصوصی ====================

    /**
     * @private
     * @method _saveSessionRecord
     * @param {Object} sessionData - داده‌های جلسه
     */
    async _saveSessionRecord(sessionData) {
        await this._database.query('learning_sessions').insert(sessionData);
    }

    /**
     * @private
     * @method _saveExerciseResult
     * @param {Object} exerciseData - داده‌های تمرین
     */
    async _saveExerciseResult(exerciseData) {
        await this._database.query('exercise_results').insert(exerciseData);
    }

    /**
     * @private
     * @method _saveCompletedLesson
     * @param {Object} lessonData - داده‌های درس تکمیل‌شده
     */
    async _saveCompletedLesson(lessonData) {
        await this._database.query('completed_lessons').insert(lessonData);
    }

    /**
     * @private
     * @method _updateUserStats
     * @param {Object} exerciseData - داده‌های تمرین
     */
    async _updateUserStats(exerciseData) {
        // به‌روزرسانی آمار کاربر در یک تراکنش
        await this._database.transaction(async (tx) => {
            await tx.query('user_stats')
                .where('userId', '=', exerciseData.sessionId.split('_')[2]) // استخراج userId از sessionId
                .increment('totalExercises', 1)
                .increment('correctAnswers', exerciseData.isCorrect ? 1 : 0)
                .increment('totalTime', exerciseData.timeSpent);
        });
    }

    /**
     * @private
     * @method _updateCourseProgress
     * @param {string} userId - شناسه کاربر
     * @param {string} lessonId - شناسه درس
     */
    async _updateCourseProgress(userId, lessonId) {
        const courseId = lessonId.split('_')[0]; // فرض: courseId بخش اول lessonId است
        
        await this._database.query('course_progress')
            .where('userId', '=', userId)
            .andWhere('courseId', '=', courseId)
            .upsert({
                userId,
                courseId,
                lastLessonId: lessonId,
                updatedAt: new Date()
            });
    }

    /**
     * @private
     * @method _getCompletedLessonsCount
     * @param {string} userId - شناسه کاربر
     * @param {string} courseId - شناسه دوره
     * @returns {Promise<number>}
     */
    async _getCompletedLessonsCount(userId, courseId) {
        const result = await this._database.query('completed_lessons')
            .where('userId', '=', userId)
            .andWhere('lessonId', 'like', `${courseId}_%`)
            .count('id as count')
            .first();
        
        return result?.count || 0;
    }

    /**
     * @private
     * @method _getTotalLessonsCount
     * @param {string} courseId - شناسه دوره
     * @returns {Promise<number>}
     */
    async _getTotalLessonsCount(courseId) {
        const result = await this._database.query('lessons')
            .where('courseId', '=', courseId)
            .count('id as count')
            .first();
        
        return result?.count || 0;
    }

    /**
     * @private
     * @method _getOverallScore
     * @param {string} userId - شناسه کاربر
     * @param {string} courseId - شناسه دوره
     * @returns {Promise<number>}
     */
    async _getOverallScore(userId, courseId) {
        const result = await this._database.query('completed_lessons')
            .where('userId', '=', userId)
            .andWhere('lessonId', 'like', `${courseId}_%`)
            .sum('score as total')
            .first();
        
        return result?.total || 0;
    }

    /**
     * @private
     * @method _getTotalTimeSpent
     * @param {string} userId - شناسه کاربر
     * @param {string} courseId - شناسه دوره
     * @returns {Promise<number>}
     */
    async _getTotalTimeSpent(userId, courseId) {
        const result = await this._database.query('completed_lessons')
            .where('userId', '=', userId)
            .andWhere('lessonId', 'like', `${courseId}_%`)
            .sum('duration as total')
            .first();
        
        return result?.total || 0;
    }

    /**
     * @private
     * @method _getLastActiveTime
     * @param {string} userId - شناسه کاربر
     * @returns {Promise<Date>}
     */
    async _getLastActiveTime(userId) {
        const result = await this._database.query('learning_sessions')
            .where('userId', '=', userId)
            .orderBy('startTime', 'desc')
            .first();
        
        return result?.startTime || new Date();
    }

    /**
     * @private
     * @method _getTotalSessions
     * @param {string} userId - شناسه کاربر
     * @returns {Promise<number>}
     */
    async _getTotalSessions(userId) {
        const result = await this._database.query('learning_sessions')
            .where('userId', '=', userId)
            .count('id as count')
            .first();
        
        return result?.count || 0;
    }

    /**
     * @private
     * @method _getTotalExercises
     * @param {string} userId - شناسه کاربر
     * @returns {Promise<number>}
     */
    async _getTotalExercises(userId) {
        const result = await this._database.query('exercise_results')
            .join('learning_sessions', 'exercise_results.sessionId', 'learning_sessions.id')
            .where('learning_sessions.userId', '=', userId)
            .count('exercise_results.id as count')
            .first();
        
        return result?.count || 0;
    }

    /**
     * @private
     * @method _getTotalLearningTime
     * @param {string} userId - شناسه کاربر
     * @returns {Promise<number>}
     */
    async _getTotalLearningTime(userId) {
        const result = await this._database.query('completed_lessons')
            .where('userId', '=', userId)
            .sum('duration as total')
            .first();
        
        return result?.total || 0;
    }

    /**
     * @private
     * @method _getCurrentStreak
     * @param {string} userId - شناسه کاربر
     * @returns {Promise<number>}
     */
    async _getCurrentStreak(userId) {
        // پیاده‌سازی ساده streak (در نسخه واقعی پیچیده‌تر است)
        const result = await this._database.query('learning_sessions')
            .where('userId', '=', userId)
            .where('startTime', '>=', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)) // ۷ روز گذشته
            .countDistinct('DATE(startTime) as streak')
            .first();
        
        return result?.streak || 0;
    }

    /**
     * @private
     * @method _getAverageAccuracy
     * @param {string} userId - شناسه کاربر
     * @returns {Promise<number>}
     */
    async _getAverageAccuracy(userId) {
        const result = await this._database.query('exercise_results')
            .join('learning_sessions', 'exercise_results.sessionId', 'learning_sessions.id')
            .where('learning_sessions.userId', '=', userId)
            .avg('isCorrect as accuracy')
            .first();
        
        return result?.accuracy ? Math.round(result.accuracy * 100) : 0;
    }

    /**
     * @private
     * @method _getFavoriteLesson
     * @param {string} userId - شناسه کاربر
     * @returns {Promise<string>}
     */
    async _getFavoriteLesson(userId) {
        const result = await this._database.query('completed_lessons')
            .where('userId', '=', userId)
            .groupBy('lessonId')
            .orderBy('count', 'desc')
            .select('lessonId')
            .count('id as count')
            .first();
        
        return result?.lessonId || 'none';
    }

    /**
     * @private
     * @method _getLastActivity
     * @param {string} userId - شناسه کاربر
     * @returns {Promise<Object>}
     */
    async _getLastActivity(userId) {
        const result = await this._database.query('learning_sessions')
            .where('userId', '=', userId)
            .orderBy('startTime', 'desc')
            .first();
        
        return {
            lessonId: result?.lessonId,
            time: result?.startTime,
            duration: result?.duration
        };
    }
}

// ==================== تایپ‌ها (برای مستندات) ====================

/**
 * @typedef {Object} UserProgressData
 * @property {string} userId
 * @property {string} courseId
 * @property {number} completedLessons
 * @property {number} totalLessons
 * @property {number} overallScore
 * @property {number} timeSpent
 * @property {Date} lastActive
 * @property {number} completionPercentage
 * @property {number} averageScore
 */

/**
 * @typedef {Object} UserStats
 * @property {string} userId
 * @property {number} totalSessions
 * @property {number} totalExercises
 * @property {number} totalTime
 * @property {number} streakDays
 * @property {number} averageAccuracy
 * @property {string} favoriteLesson
 * @property {Object} lastActivity
 */

// ==================== Export ====================

export { IProgressTracker, ProgressTracker };
