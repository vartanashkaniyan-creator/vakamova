/**
 * 🧪 تست Exercise Manager
 * تست‌های واحد با رعایت اصول تست‌پذیری
 */

import ExerciseManager from './exercise-manager.js';

// Mock وابستگی‌ها - رعایت DIP در تست
const mockDependencies = {
    exerciseRepository: {
        save: jest.fn(async (exercise) => ({ ...exercise, id: 'test_id' })),
        findById: jest.fn(async (id) => ({ id, type: 'multipleChoice' })),
        saveEvaluation: jest.fn(async () => {})
    },
    evaluationService: {
        evaluate: jest.fn(async () => ({
            isCorrect: true,
            feedback: 'Good job!'
        }))
    },
    scoringStrategy: {
        calculate: jest.fn(() => 100)
    },
    logger: {
        info: jest.fn(),
        error: jest.fn()
    }
};

describe('ExerciseManager', () => {
    let exerciseManager;

    beforeEach(() => {
        jest.clearAllMocks();
        exerciseManager = new ExerciseManager(mockDependencies);
    });

    test('should create exercise successfully', async () => {
        const config = {
            lessonId: 'lesson_1',
            difficulty: 'easy',
            question: 'What is 2+2?',
            options: ['3', '4', '5'],
            correctAnswer: '4'
        };

        const result = await exerciseManager.createExercise('multipleChoice', config);

        expect(result).toHaveProperty('id');
        expect(result.type).toBe('multipleChoice');
        expect(mockDependencies.exerciseRepository.save).toHaveBeenCalled();
    });

    test('should evaluate answer correctly', async () => {
        const evaluation = await exerciseManager.evaluateAnswer('ex_1', 'answer');

        expect(evaluation).toHaveProperty('isCorrect', true);
        expect(evaluation).toHaveProperty('score', 100);
        expect(mockDependencies.evaluationService.evaluate).toHaveBeenCalled();
    });

    test('should return exercise tips', async () => {
        const tips = await exerciseManager.getExerciseTips('ex_1');

        expect(Array.isArray(tips)).toBe(true);
        expect(tips.length).toBeGreaterThan(0);
    });

    test('should throw error for invalid exercise type', async () => {
        await expect(
            exerciseManager.createExercise('invalidType', {})
        ).rejects.toThrow('Unknown exercise type');
    });

    test('should register new exercise type', () => {
        const customHandler = () => ({ type: 'custom' });
        exerciseManager.registerExerciseType('customType', customHandler);

        expect(exerciseManager.exerciseTypes.has('customType')).toBe(true);
    });
});
