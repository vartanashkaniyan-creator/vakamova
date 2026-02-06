/**
 * 🧪 تست Exercise Manager - نسخه مستقل (بدون import)
 */

// Mock وابستگی‌ها
const mockDependencies = {
    exerciseRepository: {
        save: async (exercise) => ({ ...exercise, id: 'test_id' }),
        findById: async (id) => ({ id, type: 'multipleChoice' }),
        saveEvaluation: async () => {}
    },
    evaluationService: {
        evaluate: async () => ({
            isCorrect: true,
            feedback: 'Good job!'
        })
    },
    scoringStrategy: {
        calculate: () => 100
    },
    logger: {
        info: () => {},
        error: () => {}
    }
};

// تست‌ها
async function runTests() {
    console.log('🔬 شروع تست Exercise Manager...');
    
    try {
        // تست 1: ایجاد نمونه
        const manager = new ExerciseManager(mockDependencies);
        console.log('✅ نمونه‌سازی موفقیت‌آمیز');
        
        // تست 2: ایجاد تمرین
        const config = {
            lessonId: 'lesson_1',
            difficulty: 'easy',
            question: 'What is 2+2?',
            options: ['3', '4', '5'],
            correctAnswer: '4'
        };
        
        const exercise = await manager.createExercise('multipleChoice', config);
        console.log('✅ ایجاد تمرین موفقیت‌آمیز:', exercise.id);
        
        // تست 3: ارزیابی پاسخ
        const evaluation = await manager.evaluateAnswer('ex_1', '4');
        console.log('✅ ارزیابی موفقیت‌آمیز:', evaluation);
        
        // تست 4: دریافت نکات
        const tips = await manager.getExerciseTips('ex_1');
        console.log('✅ دریافت نکات موفقیت‌آمیز:', tips.length, 'نکته');
        
        console.log('🎉 تمام تست‌ها با موفقیت گذشتند!');
        return true;
    } catch (error) {
        console.error('❌ خطا در تست:', error.message);
        return false;
    }
}

// اگر در مرورگر اجرا می‌شود
if (typeof window !== 'undefined') {
    window.runExerciseManagerTests = runTests;
}

// اگر در Node.js اجرا می‌شود
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { runTests };
}
