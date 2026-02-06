/**
 * @file modules/lesson-engine/lesson-engine.js
 * @desc موتور اصلی آموزش - مدیریت دروس، تمرین‌ها و پیشرفت کاربر
 * @implements ILessonEngine (قرارداد انتزاعی)
 */

/**
 * @interface ILessonEngine
 * @desc قرارداد انتزاعی برای موتور آموزش
 */
class ILessonEngine {
  /**
   * @method loadCourse
   * @param {string} courseId - شناسه دوره
   * @param {string} languageCode - کد زبان
   * @returns {Promise<Course>}
   */
  async loadCourse(courseId, languageCode) {
    throw new Error('Method not implemented');
  }

  /**
   * @method startLesson
   * @param {string} lessonId - شناسه درس
   * @param {string} userId - شناسه کاربر
   * @returns {Promise<LessonSession>}
   */
  async startLesson(lessonId, userId) {
    throw new Error('Method not implemented');
  }

  /**
   * @method submitExercise
   * @param {ExerciseSubmission} submission - پاسخ تمرین
   * @returns {Promise<ExerciseResult>}
   */
  async submitExercise(submission) {
    throw new Error('Method not implemented');
  }

  /**
   * @method getProgress
   * @param {string} userId - شناسه کاربر
   * @param {string} courseId - شناسه دوره
   * @returns {Promise<UserProgress>}
   */
  async getProgress(userId, courseId) {
    throw new Error('Method not implemented');
  }
}

/**
 * @class LessonEngine
 * @implements ILessonEngine
 * @desc پیاده‌سازی موتور آموزش با قابلیت‌های کامل
 */
class LessonEngine {
  /**
   * @constructor
   * @param {Object} dependencies - وابستگی‌های تزریق‌شده
   * @param {IDatabase} dependencies.database - اینترفیس دیتابیس
   * @param {IEventBus} dependencies.eventBus - اینترفیس سیستم رویداد
   * @param {IProgressTracker} dependencies.progressTracker - اینترفیس ردیابی پیشرفت
   */
  constructor({ database, eventBus, progressTracker }) {
    // وارونگی وابستگی (DIP): وابستگی به انتزاع‌ها
    if (!database || !eventBus || !progressTracker) {
      throw new Error('All dependencies are required');
    }

    this._database = database;
    this._eventBus = eventBus;
    this._progressTracker = progressTracker;
    this._activeSessions = new Map();

    // تک‌وظیفگی (SRP): فقط مدیریت درس
    console.log('LessonEngine initialized with dependency injection');
  }

  /**
   * @method loadCourse
   * @param {string} courseId - شناسه دوره
   * @param {string} languageCode - کد زبان
   * @returns {Promise<Course>}
   * @desc بارگذاری دوره آموزشی از دیتابیس
   */
  async loadCourse(courseId, languageCode) {
    try {
      // DRY: استفاده از کوئری‌بیلدر موجود در دیتابیس
      const course = await this._database.query('courses')
        .where('id', '=', courseId)
        .andWhere('language', '=', languageCode)
        .with('lessons')
        .with('exercises')
        .first();

      if (!course) {
        throw new Error(`Course ${courseId} not found for language ${languageCode}`);
      }

      // KISS: ساختار ساده بازگشتی
      return {
        id: course.id,
        title: course.title,
        description: course.description,
        totalLessons: course.lessons?.length || 0,
        estimatedHours: course.estimatedHours,
        lessons: course.lessons.map(lesson => this._mapLesson(lesson))
      };
    } catch (error) {
      // قابل تست بودن: خطاها به وضوح تعریف شده
      this._eventBus.publish('lesson-engine.error', {
        action: 'loadCourse',
        courseId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * @method startLesson
   * @param {string} lessonId - شناسه درس
   * @param {string} userId - شناسه کاربر
   * @returns {Promise<LessonSession>}
   * @desc شروع یک جلسه درس جدید
   */
  async startLesson(lessonId, userId) {
    // YAGNI: فقط نیازمندی‌های فعلی پیاده‌سازی شده
    const lesson = await this._getLessonById(lessonId);
    
    const session = {
      id: `session_${Date.now()}_${lessonId}`,
      lessonId,
      userId,
      startTime: new Date(),
      status: 'active',
      currentExerciseIndex: 0,
      completedExercises: [],
      score: 0
    };

    // جداسازی رابط (ISP): استفاده از رابط‌های خاص
    await this._progressTracker.startSession(session.id, userId, lessonId);
    this._activeSessions.set(session.id, session);

    // باز-بسته (OCP): رویداد برای توسعه‌پذیری
    this._eventBus.publish('lesson.started', {
      sessionId: session.id,
      lessonId,
      userId,
      timestamp: new Date()
    });

    return session;
  }

  /**
   * @method submitExercise
   * @param {ExerciseSubmission} submission - پاسخ تمرین
   * @returns {Promise<ExerciseResult>}
   * @desc ارسال پاسخ تمرین و دریافت نتیجه
   */
  async submitExercise(submission) {
    const { sessionId, exerciseId, answers, timeSpent } = submission;
    const session = this._activeSessions.get(sessionId);

    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const exercise = await this._getExerciseById(exerciseId);
    const result = this._evaluateExercise(exercise, answers);

    // جایگزینی لیسکوف (LSP): زیرکلاس‌های progressTracker قابل جایگزینی
    await this._progressTracker.recordExerciseResult({
      sessionId,
      exerciseId,
      isCorrect: result.isCorrect,
      score: result.score,
      timeSpent
    });

    session.completedExercises.push(exerciseId);
    session.score += result.score;

    if (this._isLessonCompleted(session)) {
      await this._completeLesson(session);
    }

    // قابل تست بودن: خروجی قابل پیش‌بینی
    return {
      isCorrect: result.isCorrect,
      score: result.score,
      feedback: result.feedback,
      correctAnswers: result.correctAnswers,
      nextExerciseId: await this._getNextExerciseId(session)
    };
  }

  /**
   * @method getProgress
   * @param {string} userId - شناسه کاربر
   * @param {string} courseId - شناسه دوره
   * @returns {Promise<UserProgress>}
   * @desc دریافت پیشرفت کاربر در یک دوره
   */
  async getProgress(userId, courseId) {
    // تک‌وظیفگی: این متد فقط داده‌ها را جمع‌آوری می‌کند
    const progress = await this._progressTracker.getUserProgress(userId, courseId);
    const course = await this.loadCourse(courseId, 'en'); // زبان پیش‌فرض

    return {
      userId,
      courseId,
      completedLessons: progress.completedLessons,
      totalLessons: course.totalLessons,
      overallScore: progress.overallScore,
      timeSpent: progress.timeSpent,
      lastActive: progress.lastActive,
      completionPercentage: Math.round(
        (progress.completedLessons / course.totalLessons) * 100
      )
    };
  }

  // ==================== متدهای خصوصی ====================

  /**
   * @private
   * @method _getLessonById
   * @param {string} lessonId
   * @returns {Promise<Lesson>}
   */
  async _getLessonById(lessonId) {
    const lesson = await this._database.query('lessons')
      .where('id', '=', lessonId)
      .with('exercises')
      .first();

    if (!lesson) {
      throw new Error(`Lesson ${lessonId} not found`);
    }

    return lesson;
  }

  /**
   * @private
   * @method _getExerciseById
   * @param {string} exerciseId
   * @returns {Promise<Exercise>}
   */
  async _getExerciseById(exerciseId) {
    const exercise = await this._database.query('exercises')
      .where('id', '=', exerciseId)
      .first();

    if (!exercise) {
      throw new Error(`Exercise ${exerciseId} not found`);
    }

    return exercise;
  }

  /**
   * @private
   * @method _evaluateExercise
   * @param {Exercise} exercise
   * @param {any[]} answers
   * @returns {ExerciseResult}
   */
  _evaluateExercise(exercise, answers) {
    // KISS: منطق ساده ارزیابی (قابل توسعه)
    const correctAnswers = exercise.correctAnswers;
    const isCorrect = JSON.stringify(answers.sort()) === JSON.stringify(correctAnswers.sort());

    return {
      isCorrect,
      score: isCorrect ? exercise.points : 0,
      feedback: isCorrect ? 'عالی! درست جواب دادید.' : 'اشکال نداره، دوباره تلاش کنید.',
      correctAnswers
    };
  }

  /**
   * @private
   * @method _isLessonCompleted
   * @param {LessonSession} session
   * @returns {boolean}
   */
  _isLessonCompleted(session) {
    const lesson = this._getLessonById(session.lessonId);
    return session.completedExercises.length >= (lesson?.exercises?.length || 0);
  }

  /**
   * @private
   * @method _completeLesson
   * @param {LessonSession} session
   */
  async _completeLesson(session) {
    session.status = 'completed';
    session.endTime = new Date();

    await this._progressTracker.completeLesson(
      session.userId,
      session.lessonId,
      session.score,
      session.startTime,
      session.endTime
    );

    this._activeSessions.delete(session.id);

    this._eventBus.publish('lesson.completed', {
      sessionId: session.id,
      lessonId: session.lessonId,
      userId: session.userId,
      score: session.score,
      duration: session.endTime - session.startTime
    });
  }

  /**
   * @private
   * @method _getNextExerciseId
   * @param {LessonSession} session
   * @returns {Promise<string|null>}
   */
  async _getNextExerciseId(session) {
    const lesson = await this._getLessonById(session.lessonId);
    const exercises = lesson.exercises || [];
    
    if (session.currentExerciseIndex < exercises.length - 1) {
      session.currentExerciseIndex++;
      return exercises[session.currentExerciseIndex].id;
    }
    
    return null;
  }

  /**
   * @private
   * @method _mapLesson
   * @param {any} lessonData
   * @returns {Lesson}
   */
  _mapLesson(lessonData) {
    return {
      id: lessonData.id,
      title: lessonData.title,
      order: lessonData.order,
      difficulty: lessonData.difficulty,
      duration: lessonData.duration,
      exerciseCount: lessonData.exercises?.length || 0
    };
  }
}

// ==================== تایپ‌ها (برای مستندات) ====================

/**
 * @typedef {Object} Course
 * @property {string} id
 * @property {string} title
 * @property {string} description
 * @property {number} totalLessons
 * @property {number} estimatedHours
 * @property {Lesson[]} lessons
 */

/**
 * @typedef {Object} Lesson
 * @property {string} id
 * @property {string} title
 * @property {number} order
 * @property {'beginner'|'intermediate'|'advanced'} difficulty
 * @property {number} duration
 * @property {number} exerciseCount
 */

/**
 * @typedef {Object} LessonSession
 * @property {string} id
 * @property {string} lessonId
 * @property {string} userId
 * @property {Date} startTime
 * @property {Date} [endTime]
 * @property {'active'|'completed'|'abandoned'} status
 * @property {number} currentExerciseIndex
 * @property {string[]} completedExercises
 * @property {number} score
 */

/**
 * @typedef {Object} ExerciseSubmission
 * @property {string} sessionId
 * @property {string} exerciseId
 * @property {any[]} answers
 * @property {number} timeSpent
 */

/**
 * @typedef {Object} ExerciseResult
 * @property {boolean} isCorrect
 * @property {number} score
 * @property {string} feedback
 * @property {any[]} correctAnswers
 * @property {string|null} nextExerciseId
 */

/**
 * @typedef {Object} UserProgress
 * @property {string} userId
 * @property {string} courseId
 * @property {number} completedLessons
 * @property {number} totalLessons
 * @property {number} overallScore
 * @property {number} timeSpent
 * @property {Date} lastActive
 * @property {number} completionPercentage
 */

export { ILessonEngine, LessonEngine };
