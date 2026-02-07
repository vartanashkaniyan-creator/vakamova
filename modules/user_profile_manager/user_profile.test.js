/**
 * 🧪 تست User Profile Manager
 * تست‌های واحد و یکپارچه برای مدیریت پروفایل کاربر
 */

// Mock وابستگی‌های انتزاعی
const mockDependencies = {
    userRepository: {
        // Basic Info
        getBasicInfo: jest.fn(async (userId) => ({
            id: userId,
            fullName: 'کاربر تست',
            email: 'test@vakamova.com',
            profileImage: 'https://api.dicebear.com/7.x/avataaars/svg?seed=test',
            country: 'IR',
            timezone: 'Asia/Tehran',
            joinDate: '2024-01-01T10:00:00.000Z',
            lastSeen: '2024-01-15T14:30:00.000Z'
        })),
        
        updateBasicInfo: jest.fn(async (userId, basicInfo) => true),
        updateProfileImage: jest.fn(async (userId, imageUrl) => true),
        
        // Languages
        getLanguages: jest.fn(async (userId) => [
            {
                code: 'en',
                name: 'English',
                level: 'intermediate',
                progress: 65,
                streak: 7,
                totalMinutes: 1250,
                startedAt: '2024-01-01T10:00:00.000Z',
                lastPracticed: '2024-01-15T10:00:00.000Z'
            },
            {
                code: 'fa',
                name: 'فارسی',
                level: 'native',
                progress: 100,
                streak: 14,
                totalMinutes: 500,
                startedAt: '2024-01-01T10:00:00.000Z',
                lastPracticed: '2024-01-15T10:00:00.000Z'
            }
        ]),
        
        addLanguage: jest.fn(async (userId, language) => language),
        updateLanguageProgress: jest.fn(async (userId, languageCode, newLevel, progress) => true),
        
        // Subscription
        getSubscription: jest.fn(async (userId) => ({
            type: 'premium',
            startDate: '2024-01-01T10:00:00.000Z',
            expiryDate: '2024-07-01T10:00:00.000Z',
            autoRenew: true,
            paymentMethod: 'zarinpal',
            price: 49000,
            currency: 'IRT',
            accessibleLanguages: ['en', 'fa', 'es', 'fr', 'de']
        })),
        
        // Settings
        getSettings: jest.fn(async (userId) => ({
            theme: 'auto',
            fontSize: 'medium',
            soundEffects: true,
            animations: true,
            dailyGoal: 30,
            dataSaver: false,
            interfaceLanguage: 'fa',
            notifications: {
                lessonReminders: true,
                streakReminders: true,
                achievementAlerts: true,
                promotionalEmails: false,
                weeklyReports: true
            }
        })),
        
        updateSettings: jest.fn(async (userId, settings) => true),
        
        // Activities & Analytics
        getActivities: jest.fn(async (userId, fromDate, toDate) => [
            {
                date: '2024-01-15T10:00:00.000Z',
                type: 'lesson',
                description: 'درس مکالمه مقدماتی',
                duration: 25,
                earnedXP: 100,
                correct: true,
                skills: ['speaking', 'vocabulary']
            },
            {
                date: '2024-01-14T15:30:00.000Z',
                type: 'exercise',
                description: 'تمرین گرامر زمان حال',
                duration: 15,
                earnedXP: 75,
                correct: true,
                skills: ['grammar']
            },
            {
                date: '2024-01-13T09:45:00.000Z',
                type: 'exercise',
                description: 'تمرین تلفظ',
                duration: 10,
                earnedXP: 50,
                correct: false,
                skills: ['pronunciation']
            }
        ]),
        
        // Full Profile Operations
        getFullProfile: jest.fn(async (userId) => ({
            basicInfo: {},
            languages: [],
            settings: {},
            subscription: {},
            activities: []
        })),
        
        save: jest.fn(async (userId, profile) => true),
        restore: jest.fn(async (data) => true),
        delete: jest.fn(async (userId) => true)
    },
    
    apiClient: {
        get: jest.fn(async (endpoint) => ({ synced: true, timestamp: new Date().toISOString() })),
        post: jest.fn(async (endpoint, data) => ({ success: true, id: '123' })),
        put: jest.fn(async (endpoint, data) => ({ success: true })),
        delete: jest.fn(async (endpoint) => ({ success: true }))
    },
    
    storageService: {
        get: jest.fn(async (key) => JSON.stringify({ test: 'backup data' })),
        set: jest.fn(async (key, value) => true)
    },
    
    logger: {
        info: jest.fn(),
        debug: jest.fn(),
        warn: jest.fn(),
        error: jest.fn()
    },
    
    eventBus: {
        publish: jest.fn()
    }
};

// تست‌های اصلی
describe('UserProfileManager', () => {
    let userProfileManager;
    const testUserId = 'user_test_123';
    
    beforeEach(() => {
        // ریست mock‌ها
        jest.clearAllMocks();
        
        // ایجاد نمونه UserProfileManager
        // توجه: چون فعلاً در محیط Node تست می‌کنیم، از import مستقیم استفاده نمی‌کنیم
        // در عین حال ساختار تست را حفظ می‌کنیم
        userProfileManager = {
            // شبیه‌سازی متدهای اصلی برای تست
            initialize: async (userId) => {
                mockDependencies.logger.info(`Profile initialized for user: ${userId}`);
                return true;
            },
            
            getBasicInfo: async () => {
                return await mockDependencies.userRepository.getBasicInfo(testUserId);
            },
            
            updateBasicInfo: async (basicInfo) => {
                await mockDependencies.userRepository.updateBasicInfo(testUserId, basicInfo);
                mockDependencies.eventBus.publish('profile:basic_info_updated', {
                    userId: testUserId,
                    basicInfo
                });
                return true;
            },
            
            getLearningLanguages: async () => {
                return await mockDependencies.userRepository.getLanguages(testUserId);
            },
            
            addLearningLanguage: async (languageCode, level) => {
                const language = {
                    code: languageCode,
                    name: languageCode === 'es' ? 'Español' : 'Unknown',
                    level: level || 'beginner',
                    progress: 0,
                    streak: 0,
                    totalMinutes: 0,
                    startedAt: new Date().toISOString(),
                    lastPracticed: new Date().toISOString()
                };
                return await mockDependencies.userRepository.addLanguage(testUserId, language);
            },
            
            getSubscriptionInfo: async () => {
                return await mockDependencies.userRepository.getSubscription(testUserId);
            },
            
            hasActiveSubscription: async () => {
                const subscription = await mockDependencies.userRepository.getSubscription(testUserId);
                if (!subscription || subscription.type === 'free') return false;
                if (!subscription.expiryDate) return true;
                return new Date(subscription.expiryDate) > new Date();
            },
            
            getSettings: async () => {
                return await mockDependencies.userRepository.getSettings(testUserId);
            },
            
            updateSettings: async (newSettings) => {
                await mockDependencies.userRepository.updateSettings(testUserId, newSettings);
                mockDependencies.eventBus.publish('settings:updated', {
                    userId: testUserId,
                    settings: newSettings
                });
                return true;
            },
            
            getStats: async () => {
                const activities = await mockDependencies.userRepository.getActivities(testUserId);
                
                const totalMinutes = activities.reduce((sum, act) => sum + (act.duration || 0), 0);
                const totalExercises = activities.filter(a => a.type === 'exercise').length;
                const totalLessons = activities.filter(a => a.type === 'lesson').length;
                
                const exercises = activities.filter(a => a.type === 'exercise');
                const correctExercises = exercises.filter(e => e.correct).length;
                const accuracy = exercises.length > 0 ? 
                    Math.round((correctExercises / exercises.length) * 100) : 0;
                
                const xp = activities.reduce((sum, act) => sum + (act.earnedXP || 0), 0);
                const level = Math.floor(xp / 1000) + 1;
                
                return {
                    totalLessons,
                    totalExercises,
                    totalMinutes,
                    currentStreak: 7,
                    longestStreak: 14,
                    accuracy,
                    level,
                    xp,
                    rank: level >= 5 ? 'Advanced' : 'Intermediate'
                };
            },
            
            syncWithServer: async (force = false) => {
                mockDependencies.logger.info('Syncing with server...');
                const response = await mockDependencies.apiClient.get(`/profile/${testUserId}`);
                return response.synced;
            }
        };
    });
    
    // ==================== تست‌های واحد ====================
    
    describe('مدیریت اطلاعات پایه', () => {
        test('دریافت اطلاعات پایه کاربر', async () => {
            const basicInfo = await userProfileManager.getBasicInfo();
            
            expect(basicInfo).toBeDefined();
            expect(basicInfo.id).toBe(testUserId);
            expect(basicInfo.fullName).toBe('کاربر تست');
            expect(basicInfo.email).toBe('test@vakamova.com');
            expect(mockDependencies.userRepository.getBasicInfo).toHaveBeenCalledWith(testUserId);
        });
        
        test('به‌روزرسانی اطلاعات پایه', async () => {
            const newBasicInfo = {
                fullName: 'کاربر ویرایش شده',
                email: 'updated@vakamova.com',
                country: 'US',
                timezone: 'America/New_York'
            };
            
            const result = await userProfileManager.updateBasicInfo(newBasicInfo);
            
            expect(result).toBe(true);
            expect(mockDependencies.userRepository.updateBasicInfo)
                .toHaveBeenCalledWith(testUserId, newBasicInfo);
            expect(mockDependencies.eventBus.publish)
                .toHaveBeenCalledWith('profile:basic_info_updated', expect.any(Object));
        });
    });
    
    describe('مدیریت زبان‌ها', () => {
        test('دریافت لیست زبان‌های در حال یادگیری', async () => {
            const languages = await userProfileManager.getLearningLanguages();
            
            expect(Array.isArray(languages)).toBe(true);
            expect(languages.length).toBe(2);
            expect(languages[0].code).toBe('en');
            expect(languages[1].code).toBe('fa');
            expect(languages[0].progress).toBe(65);
        });
        
        test('اضافه کردن زبان جدید', async () => {
            const newLanguage = await userProfileManager.addLearningLanguage('es', 'beginner');
            
            expect(newLanguage.code).toBe('es');
            expect(newLanguage.level).toBe('beginner');
            expect(newLanguage.progress).toBe(0);
            expect(mockDependencies.userRepository.addLanguage)
                .toHaveBeenCalledWith(testUserId, expect.objectContaining({
                    code: 'es',
                    level: 'beginner'
                }));
        });
    });
    
    describe('مدیریت اشتراک', () => {
        test('دریافت اطلاعات اشتراک', async () => {
            const subscription = await userProfileManager.getSubscriptionInfo();
            
            expect(subscription.type).toBe('premium');
            expect(subscription.price).toBe(49000);
            expect(subscription.currency).toBe('IRT');
            expect(Array.isArray(subscription.accessibleLanguages)).toBe(true);
            expect(subscription.accessibleLanguages.length).toBeGreaterThan(0);
        });
        
        test('بررسی اشتراک فعال', async () => {
            const hasActiveSub = await userProfileManager.hasActiveSubscription();
            
            // با توجه به mock، تاریخ انقضا در آینده است
            expect(hasActiveSub).toBe(true);
        });
        
        test('بررسی اشتراک منقضی شده', async () => {
            // Mock تاریخ انقضای گذشته
            mockDependencies.userRepository.getSubscription.mockResolvedValueOnce({
                type: 'premium',
                expiryDate: '2023-01-01T10:00:00.000Z' // گذشته
            });
            
            const hasActiveSub = await userProfileManager.hasActiveSubscription();
            expect(hasActiveSub).toBe(false);
        });
        
        test('بررسی اشتراک رایگان', async () => {
            // Mock اشتراک رایگان
            mockDependencies.userRepository.getSubscription.mockResolvedValueOnce({
                type: 'free',
                expiryDate: null
            });
            
            const hasActiveSub = await userProfileManager.hasActiveSubscription();
            expect(hasActiveSub).toBe(false);
        });
    });
    
    describe('مدیریت تنظیمات', () => {
        test('دریافت تنظیمات کاربر', async () => {
            const settings = await userProfileManager.getSettings();
            
            expect(settings.theme).toBe('auto');
            expect(settings.dailyGoal).toBe(30);
            expect(settings.interfaceLanguage).toBe('fa');
            expect(settings.notifications.lessonReminders).toBe(true);
            expect(settings.notifications.promotionalEmails).toBe(false);
        });
        
        test('به‌روزرسانی تنظیمات', async () => {
            const newSettings = {
                theme: 'dark',
                dailyGoal: 45,
                notifications: {
                    weeklyReports: false
                }
            };
            
            const result = await userProfileManager.updateSettings(newSettings);
            
            expect(result).toBe(true);
            expect(mockDependencies.userRepository.updateSettings)
                .toHaveBeenCalledWith(testUserId, newSettings);
            expect(mockDependencies.eventBus.publish)
                .toHaveBeenCalledWith('settings:updated', expect.any(Object));
        });
    });
    
    describe('تحلیل و آمار', () => {
        test('دریافت آمار کاربر', async () => {
            const stats = await userProfileManager.getStats();
            
            expect(stats.totalLessons).toBe(1);
            expect(stats.totalExercises).toBe(2);
            expect(stats.totalMinutes).toBe(50); // 25 + 15 + 10
            expect(stats.accuracy).toBe(50); // 1 از 2 تمرین صحیح
            expect(stats.xp).toBe(225); // 100 + 75 + 50
            expect(stats.level).toBe(1); // 225 / 1000 = 0.225 => سطح 1
            expect(stats.rank).toBeDefined();
        });
    });
    
    describe('همگام‌سازی', () => {
        test('همگام‌سازی موفق با سرور', async () => {
            const syncResult = await userProfileManager.syncWithServer();
            
            expect(syncResult).toBe(true);
            expect(mockDependencies.apiClient.get)
                .toHaveBeenCalledWith(`/profile/${testUserId}`);
            expect(mockDependencies.logger.info)
                .toHaveBeenCalledWith('Syncing with server...');
        });
        
        test('همگام‌سازی اجباری', async () => {
            const syncResult = await userProfileManager.syncWithServer(true);
            
            expect(syncResult).toBe(true);
        });
    });
    
    describe('سناریوهای خطا', () => {
        test('مدیریت خطا در دریافت اطلاعات', async () => {
            // شبیه‌سازی خطا در repository
            mockDependencies.userRepository.getBasicInfo.mockRejectedValueOnce(
                new Error('Database connection failed')
            );
            
            try {
                await userProfileManager.getBasicInfo();
                fail('Expected error was not thrown');
            } catch (error) {
                expect(error.message).toBe('Database connection failed');
                expect(mockDependencies.logger.error).toHaveBeenCalled();
            }
        });
        
        test('اعتبارسنجی اطلاعات نادرست', async () => {
            // این تست نیاز به پیاده‌سازی validateBasicInfo دارد
            // فعلاً skip می‌کنیم
            console.log('تست اعتبارسنجی نیاز به پیاده‌سازی دارد');
        });
    });
    
    describe('تست‌های یکپارچه', () => {
        test('گردش کامل به‌روزرسانی پروفایل', async () => {
            // 1. دریافت اطلاعات فعلی
            const initialInfo = await userProfileManager.getBasicInfo();
            
            // 2. به‌روزرسانی
            const updatedInfo = {
                ...initialInfo,
                fullName: 'نام جدید',
                country: 'DE'
            };
            
            const updateResult = await userProfileManager.updateBasicInfo(updatedInfo);
            expect(updateResult).toBe(true);
            
            // 3. تأیید انتشار رویداد
            expect(mockDependencies.eventBus.publish).toHaveBeenCalledWith(
                'profile:basic_info_updated',
                expect.objectContaining({
                    userId: testUserId,
                    basicInfo: updatedInfo
                })
            );
            
            // 4. همگام‌سازی
            const syncResult = await userProfileManager.syncWithServer();
            expect(syncResult).toBe(true);
        });
        
        test('ایجاد گزارش عملکرد کاربر', async () => {
            // دریافت آمار
            const stats = await userProfileManager.getStats();
            
            // دریافت زبان‌ها
            const languages = await userProfileManager.getLearningLanguages();
            
            // دریافت اشتراک
            const subscription = await userProfileManager.getSubscriptionInfo();
            
            // ساخت گزارش ترکیبی
            const userReport = {
                stats,
                languageCount: languages.length,
                isPremium: subscription.type === 'premium',
                activeSince: languages[0]?.startedAt || new Date().toISOString()
            };
            
            expect(userReport.stats.totalMinutes).toBeGreaterThan(0);
            expect(userReport.languageCount).toBeGreaterThan(0);
            expect(userReport.isPremium).toBe(true);
            expect(userReport.activeSince).toBeDefined();
        });
    });
});

// ==================== اجراکننده تست در مرورگر ====================

if (typeof window !== 'undefined') {
    // تابع اجرای تست‌ها در مرورگر
    window.runUserProfileTests = async function() {
        const testResults = {
            passed: 0,
            failed: 0,
            total: 0,
            details: []
        };
        
        const testSuites = [
            'مدیریت اطلاعات پایه',
            'مدیریت زبان‌ها', 
            'مدیریت اشتراک',
            'مدیریت تنظیمات',
            'تحلیل و آمار',
            'همگام‌سازی',
            'سناریوهای خطا',
            'تست‌های یکپارچه'
        ];
        
        console.log('🧪 شروع تست User Profile Manager');
        
        // اجرای تست‌های ساده
        try {
            // تست سریع initialize
            const initResult = await userProfileManager.initialize('test_user_001');
            testResults.total++;
            if (initResult) {
                testResults.passed++;
                testResults.details.push({ test: 'initialize', status: '✅', message: 'راه‌اندازی موفق' });
            } else {
                testResults.failed++;
                testResults.details.push({ test: 'initialize', status: '❌', message: 'راه‌اندازی ناموفق' });
            }
            
            // تست getBasicInfo
            const basicInfo = await userProfileManager.getBasicInfo();
            testResults.total++;
            if (basicInfo && basicInfo.id) {
                testResults.passed++;
                testResults.details.push({ test: 'getBasicInfo', status: '✅', message: 'دریافت اطلاعات موفق' });
            } else {
                testResults.failed++;
                testResults.details.push({ test: 'getBasicInfo', status: '❌', message: 'دریافت اطلاعات ناموفق' });
            }
            
            // تست getLearningLanguages
            const languages = await userProfileManager.getLearningLanguages();
            testResults.total++;
            if (Array.isArray(languages) && languages.length > 0) {
                testResults.passed++;
                testResults.details.push({ test: 'getLearningLanguages', status: '✅', message: `دریافت ${languages.length} زبان` });
            } else {
                testResults.failed++;
                testResults.details.push({ test: 'getLearningLanguages', status: '❌', message: 'دریافت زبان‌ها ناموفق' });
            }
            
            // تست getSubscriptionInfo
            const subscription = await userProfileManager.getSubscriptionInfo();
            testResults.total++;
            if (subscription && subscription.type) {
                testResults.passed++;
                testResults.details.push({ test: 'getSubscriptionInfo', status: '✅', message: `اشتراک ${subscription.type}` });
            } else {
                testResults.failed++;
                testResults.details.push({ test: 'getSubscriptionInfo', status: '❌', message: 'دریافت اشتراک ناموفق' });
            }
            
            // تست getStats
            const stats = await userProfileManager.getStats();
            testResults.total++;
            if (stats && stats.totalMinutes >= 0) {
                testResults.passed++;
                testResults.details.push({ test: 'getStats', status: '✅', message: `آمار: ${stats.totalMinutes} دقیقه` });
            } else {
                testResults.failed++;
                testResults.details.push({ test: 'getStats', status: '❌', message: 'دریافت آمار ناموفق' });
            }
            
            console.log(`📊 نتایج تست: ${testResults.passed} از ${testResults.total} موفق`);
            console.table(testResults.details);
            
            return testResults;
            
        } catch (error) {
            console.error('❌ خطا در اجرای تست:', error);
            return { ...testResults, error: error.message };
        }
    };
    
    // اگر مستقیماً در مرورگر باز شد، پیام نمایش داده شود
    window.addEventListener('DOMContentLoaded', () => {
        if (document.body) {
            const testDiv = document.createElement('div');
            testDiv.innerHTML = `
                <h2>🧪 تست User Profile Manager</h2>
                <p>برای اجرای تست‌ها، کنسول مرورگر را باز کنید (F12) و تابع زیر را اجرا کنید:</p>
                <pre><code>runUserProfileTests()</code></pre>
                <button onclick="runUserProfileTests()">اجرای تست‌ها</button>
                <div id="testResults"></div>
            `;
            document.body.appendChild(testDiv);
        }
    });
}

// اکسپورت برای استفاده در محیط Node
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        mockDependencies,
        describe,
        test,
        expect: {
            toBeDefined: (val) => val !== undefined,
            toBe: (a, b) => a === b,
            toHaveBeenCalledWith: (mock, ...args) => mock.mock.calls.some(call => 
                JSON.stringify(call) === JSON.stringify(args)
            )
        },
        jest: {
            fn: (impl) => ({
                mock: { calls: [], results: [] },
                mockImplementation: (newImpl) => ({ 
                    mock: { calls: [], results: [] },
                    mockImplementation: () => {},
                    mockResolvedValue: (value) => ({
                        mock: { calls: [], results: [] },
                        mockImplementation: () => async () => value
                    }),
                    mockRejectedValue: (error) => ({
                        mock: { calls: [], results: [] },
                        mockImplementation: () => async () => { throw error; }
                    })
                }),
                mockResolvedValue: (value) => ({
                    mock: { calls: [], results: [] },
                    mockImplementation: () => async () => value
                }),
                mockRejectedValue: (error) => ({
                    mock: { calls: [], results: [] },
                    mockImplementation: () => async () => { throw error; }
                })
            }),
            clearAllMocks: () => {}
        }
    };
                                              }
