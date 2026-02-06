/**
 * 🎯 Exercise Manager Implementation
 * پیاده‌سازی مدیریت تمرین‌ها با رعایت اصول SOLID
 */

import ExerciseManagerInterface from './exercise-manager-interface.js';

class ExerciseManager extends ExerciseManagerInterface {
    /**
     * سازنده با تزریق وابستگی‌ها - رعایت DIP
     * @param {Object} dependencies - وابستگی‌های تزریق شده
     */
    constructor(dependencies) {
        super();
        this.exerciseRepository = dependencies.exerciseRepository; // انتزاعی
        this.evaluationService = dependencies.evaluationService; // انتزاعی
        this.scoringStrategy = dependencies.scoringStrategy; // استراتژی امتیازدهی
        this.logger = dependencies.logger || console;
        
        // ثبت انواع تمرین‌ها - رعایت OCP (قابل گسترش)
        this.exerciseTypes = new Map();
        this.registerDefaultTypes();
    }

    /**
     * ثبت نوع تمرین جدید - رعایت OCP
     * @param {string} type - نوع تمرین
     * @param {ExerciseTypeHandler} handler - هندلر مخصوص
     */
    registerExerciseType(type, handler) {
        if (this.exerciseTypes.has(type)) {
            throw new Error(`Exercise type '${type}' already registered`);
        }
        this.exerciseTypes.set(type, handler);
        this.logger.info(`Exercise type '${type}' registered`);
    }

    /**
     * ثبت انواع پیش‌فرض
     */
    registerDefaultTypes() {
        // انواع تمرین‌های پیش‌فرض
        const types = {
            multipleChoice: this.createMultipleChoice.bind(this),
            fillBlank: this.createFillBlank.bind(this),
            matching: this.createMatching.bind(this),
            pronunciation: this.createPronunciation.bind(this)
        };

        Object.entries(types).forEach(([type, handler]) => {
            this.registerExerciseType(type, handler);
        });
    }

    /**
     * ایجاد تمرین جدید - رعایت SRP
     * @param {string} type - نوع تمرین
     * @param {Object} config - تنظیمات
     * @returns {Promise<Exercise>}
     */
    async createExercise(type, config) {
        try {
            if (!this.exerciseTypes.has(type)) {
                throw new Error(`Unknown exercise type: ${type}`);
            }

            // اعتبارسنجی پیکربندی
            this.validateConfig(config);

            // ایجاد تمرین با هندلر مخصوص
            const handler = this.exerciseTypes.get(type);
            const exercise = await handler(config);

            // ذخیره در ریپازیتوری
            const savedExercise = await this.exerciseRepository.save(exercise);
            
            this.logger.info(`Exercise created: ${savedExercise.id}`, {
                type,
                lessonId: config.lessonId
            });

            return savedExercise;
        } catch (error) {
            this.logger.error('Failed to create exercise:', error);
            throw error;
        }
    }

    /**
     * ارزیابی پاسخ - رعایت SRP
     * @param {string} exerciseId - شناسه تمرین
     * @param {any} userAnswer - پاسخ کاربر
     * @returns {Promise<EvaluationResult>}
     */
    async evaluateAnswer(exerciseId, userAnswer) {
        try {
            // دریافت تمرین از ریپازیتوری
            const exercise = await this.exerciseRepository.findById(exerciseId);
            if (!exercise) {
                throw new Error(`Exercise not found: ${exerciseId}`);
            }

            // اعتبارسنجی پاسخ
            this.validateAnswer(userAnswer);

            // ارزیابی با سرویس مخصوص
            const evaluation = await this.evaluationService.evaluate(
                exercise,
                userAnswer
            );

            // محاسبه امتیاز
            evaluation.score = this.scoringStrategy.calculate(
                exercise,
                evaluation
            );

            // ثبت تاریخچه
            await this.exerciseRepository.saveEvaluation(
                exerciseId,
                userAnswer,
                evaluation
            );

            this.logger.info(`Answer evaluated: ${exerciseId}`, {
                score: evaluation.score,
                correct: evaluation.isCorrect
            });

            return evaluation;
        } catch (error) {
            this.logger.error('Failed to evaluate answer:', error);
            throw error;
        }
    }

    /**
     * دریافت نکات آموزشی - رعایت SRP
     * @param {string} exerciseId - شناسه تمرین
     * @returns {Promise<string[]>}
     */
    async getExerciseTips(exerciseId) {
        try {
            const exercise = await this.exerciseRepository.findById(exerciseId);
            if (!exercise) {
                throw new Error(`Exercise not found: ${exerciseId}`);
            }

            // تولید نکات بر اساس نوع تمرین
            const tips = this.generateTips(exercise);
            
            // فیلتر کردن نکات تکراری و مرتب‌سازی
            return [...new Set(tips)].sort();
        } catch (error) {
            this.logger.error('Failed to get exercise tips:', error);
            return []; // نکات پیش‌فرض
        }
    }

    /**
     * محاسبه امتیاز - رعایت SRP
     * @param {string} exerciseId - شناسه تمرین
     * @param {EvaluationResult} evaluation - نتیجه ارزیابی
     * @returns {number}
     */
    calculateScore(exerciseId, evaluation) {
        return this.scoringStrategy.calculate(exerciseId, evaluation);
    }

    // ========== متدهای کمکی خصوصی ==========

    /**
     * اعتبارسنجی پیکربندی تمرین - رعایت DRY
     */
    validateConfig(config) {
        const required = ['lessonId', 'difficulty'];
        required.forEach(field => {
            if (!config[field]) {
                throw new Error(`Missing required config field: ${field}`);
            }
        });
    }

    /**
     * اعتبارسنجی پاسخ کاربر
     */
    validateAnswer(answer) {
        if (answer === null || answer === undefined) {
            throw new Error('Answer cannot be empty');
        }
    }

    /**
     * تولید نکات آموزشی
     */
    generateTips(exercise) {
        const tips = [];
        
        // نکات عمومی
        tips.push('دقت کنید به زمان پاسخ‌دهی');
        tips.push('قبل از پاسخ دادن، تمام گزینه‌ها را بررسی کنید');
        
        // نکات خاص نوع تمرین
        switch (exercise.type) {
            case 'multipleChoice':
                tips.push('گزینه‌های مشابه را حذف کنید');
                tips.push('حدس هوشمندانه بزنید اگر مطمئن نیستید');
                break;
            case 'fillBlank':
                tips.push('گرامر جمله را بررسی کنید');
                tips.push('حروف تعریف را فراموش نکنید');
                break;
            case 'matching':
                tips.push('ابتدا موارد واضح را وصل کنید');
                tips.push('از فرآیند حذف استفاده کنید');
                break;
        }

        return tips;
    }

    // ========== هندلرهای انواع تمرین ==========

    async createMultipleChoice(config) {
        return {
            type: 'multipleChoice',
            id: this.generateId(),
            question: config.question,
            options: config.options || [],
            correctAnswer: config.correctAnswer,
            explanation: config.explanation,
            difficulty: config.difficulty,
            lessonId: config.lessonId,
            createdAt: new Date().toISOString()
        };
    }

    async createFillBlank(config) {
        return {
            type: 'fillBlank',
            id: this.generateId(),
            sentence: config.sentence,
            blanks: config.blanks || [],
            correctAnswers: config.correctAnswers,
            hints: config.hints || [],
            difficulty: config.difficulty,
            lessonId: config.lessonId,
            createdAt: new Date().toISOString()
        };
    }

    async createMatching(config) {
        return {
            type: 'matching',
            id: this.generateId(),
            leftItems: config.leftItems || [],
            rightItems: config.rightItems || [],
            correctPairs: config.correctPairs || [],
            difficulty: config.difficulty,
            lessonId: config.lessonId,
            createdAt: new Date().toISOString()
        };
    }

    async createPronunciation(config) {
        return {
            type: 'pronunciation',
            id: this.generateId(),
            word: config.word,
            audioUrl: config.audioUrl,
            phonetic: config.phonetic,
            userRecording: null,
            difficulty: config.difficulty,
            lessonId: config.lessonId,
            createdAt: new Date().toISOString()
        };
    }

    /**
     * تولید شناسه یکتا
     */
    generateId() {
        return `ex_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
}

export default ExerciseManager;
