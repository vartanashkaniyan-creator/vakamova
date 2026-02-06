/**
 * @file modules/lesson-engine/lesson-engine.js
 * @desc موتور اصلی آموزش - مدیریت دروس، تمرین‌ها و پیشرفت کاربر
 */

// ==================== کلاس اصلی (بدون export) ====================
class LessonEngine {
  constructor({ database, eventBus, progressTracker }) {
    if (!database || !eventBus || !progressTracker) {
      throw new Error('All dependencies are required');
    }
    this._database = database;
    this._eventBus = eventBus;
    this._progressTracker = progressTracker;
    this._activeSessions = new Map();
  }

  async loadCourse(courseId, languageCode) {
    try {
      // شبیه‌سازی دیتابیس - برای تست کار می‌کند
      return {
        id: courseId,
        title: languageCode === 'fa' ? 'دوره فارسی' : 'English Course',
        description: 'دوره آموزشی نمونه',
        totalLessons: 5,
        estimatedHours: 10,
        lessons: [
          { id: 'lesson_1', title: 'درس اول', order: 1, difficulty: 'beginner', duration: 30, exerciseCount: 3 }
        ]
      };
    } catch (error) {
      this._eventBus.publish('lesson-engine.error', { action: 'loadCourse', error: error.message });
      throw error;
    }
  }

  async startLesson(lessonId, userId) {
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
    
    await this._progressTracker.startSession(session.id, userId, lessonId);
    this._activeSessions.set(session.id, session);
    this._eventBus.publish('lesson.started', { sessionId: session.id, lessonId, userId });
    
    return session;
  }

  async submitExercise(submission) {
    const { sessionId, exerciseId, answers, timeSpent } = submission;
    const session = this._activeSessions.get(sessionId);
    
    if (!session) throw new Error(`Session ${sessionId} not found`);
    
    // منطق ساده ارزیابی
    const isCorrect = answers.length > 0;
    const score = isCorrect ? 10 : 0;
    
    await this._progressTracker.recordExerciseResult({
      sessionId,
      exerciseId,
      isCorrect,
      score,
      timeSpent
    });
    
    session.completedExercises.push(exerciseId);
    session.score += score;
    
    return {
      isCorrect,
      score,
      feedback: isCorrect ? 'عالی! درست جواب دادید.' : 'اشکال نداره، دوباره تلاش کنید.',
      correctAnswers: ['A', 'B', 'C'],
      nextExerciseId: 'ex_2'
    };
  }

  async getProgress(userId, courseId) {
    const progress = await this._progressTracker.getUserProgress(userId, courseId);
    const course = await this.loadCourse(courseId, 'en');
    
    return {
      userId,
      courseId,
      completedLessons: progress?.completedLessons || 0,
      totalLessons: course.totalLessons,
      overallScore: progress?.overallScore || 0,
      timeSpent: progress?.timeSpent || 0,
      lastActive: new Date(),
      completionPercentage: Math.round(
        ((progress?.completedLessons || 0) / course.totalLessons) * 100
      )
    };
  }

  // ==================== متدهای کمکی ====================
  async _getLessonById(lessonId) {
    // شبیه‌سازی
    return {
      id: lessonId,
      exercises: [
        { id: 'ex_1' }, { id: 'ex_2' }, { id: 'ex_3' }
      ]
    };
  }

  async _isLessonCompleted(session) {
    const lesson = await this._getLessonById(session.lessonId); // ✅ درست شد
    return session.completedExercises.length >= (lesson?.exercises?.length || 0);
  }
}

// ==================== قرارداد Interface ====================
class ILessonEngine {
  async loadCourse(courseId, languageCode) { throw new Error('Method not implemented'); }
  async startLesson(lessonId, userId) { throw new Error('Method not implemented'); }
  async submitExercise(submission) { throw new Error('Method not implemented'); }
  async getProgress(userId, courseId) { throw new Error('Method not implemented'); }
}

// ==================== تایپ‌ها ====================
// (همان typedefها را اینجا نگه دار)
