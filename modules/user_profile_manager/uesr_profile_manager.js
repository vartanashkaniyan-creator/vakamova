/**
 * 👤 User Profile Manager Implementation
 * پیاده‌سازی مدیریت پروفایل کاربر با رعایت کامل اصول SOLID
 */

import {
    UserProfileManagerInterface
} from './user_profile_interface.js';

class UserProfileManager extends UserProfileManagerInterface {
    /**
     * سازنده با تزریق وابستگی‌های انتزاعی - رعایت DIP
     * @param {Object} dependencies - وابستگی‌های تزریق شده
     */
    constructor(dependencies) {
        super();
        
        // تزریق وابستگی‌های انتزاعی
        this.userRepository = dependencies.userRepository;        // ریپازیتوری کاربر
        this.apiClient = dependencies.apiClient;                  // کلاینت API
        this.storageService = dependencies.storageService;        // سرویس ذخیره‌سازی
        this.logger = dependencies.logger || console;             // لاگر
        this.eventBus = dependencies.eventBus;                    // سیستم رویداد
        
        // ماژول‌های داخلی
        this.languageManager = new LanguageManager(this);
        this.subscriptionManager = new SubscriptionManager(this);
        this.settingsManager = new SettingsManager(this);
        this.analyticsManager = new AnalyticsManager(this);
        
        // وضعیت داخلی
        this.currentUserId = null;
        this.cache = new Map();
        this.isSyncing = false;
        this.syncQueue = [];
        
        this.logger.info('User Profile Manager initialized');
    }
    
    // ==================== متدهای اصلی ====================
    
    /**
     * راه‌اندازی اولیه پروفایل کاربر - رعایت SRP
     * @param {string} userId - شناسه کاربر
     * @returns {Promise<boolean>}
     */
    async initialize(userId) {
        try {
            this.currentUserId = userId;
            
            // بارگذاری داده‌های محلی
            await this.loadLocalProfile();
            
            // همگام‌سازی اولیه با سرور
            await this.syncWithServer(false);
            
            // انتشار رویداد
            this.eventBus?.publish('profile:initialized', { userId });
            
            this.logger.info(`Profile initialized for user: ${userId}`);
            return true;
            
        } catch (error) {
            this.logger.error('Failed to initialize profile:', error);
            throw error;
        }
    }
    
    /**
     * دریافت اطلاعات پایه کاربر - رعایت SRP
     * @returns {Promise<UserBasicInfo>}
     */
    async getBasicInfo() {
        try {
            // بررسی کش
            const cacheKey = `basic_${this.currentUserId}`;
            if (this.cache.has(cacheKey)) {
                return this.cache.get(cacheKey);
            }
            
            const basicInfo = await this.userRepository.getBasicInfo(this.currentUserId);
            
            // ذخیره در کش (5 دقیقه)
            this.cache.set(cacheKey, basicInfo, 5 * 60 * 1000);
            
            return basicInfo;
        } catch (error) {
            this.logger.error('Failed to get basic info:', error);
            throw error;
        }
    }
    
    /**
     * به‌روزرسانی اطلاعات پایه کاربر - رعایت SRP
     * @param {UserBasicInfo} basicInfo - اطلاعات جدید
     * @returns {Promise<boolean>}
     */
    async updateBasicInfo(basicInfo) {
        try {
            // اعتبارسنجی داده‌ها
            this.validateBasicInfo(basicInfo);
            
            // ذخیره محلی
            await this.userRepository.updateBasicInfo(this.currentUserId, basicInfo);
            
            // پاک کردن کش
            this.clearCache('basic');
            
            // اضافه به صف همگام‌سازی
            this.addToSyncQueue({
                type: 'update_basic_info',
                data: basicInfo,
                timestamp: Date.now()
            });
            
            // انتشار رویداد
            this.eventBus?.publish('profile:basic_info_updated', {
                userId: this.currentUserId,
                basicInfo
            });
            
            this.logger.info('Basic info updated successfully');
            return true;
            
        } catch (error) {
            this.logger.error('Failed to update basic info:', error);
            throw error;
        }
    }
    
    /**
     * آپلود تصویر پروفایل - رعایت SRP
     * @param {File|string} image - فایل تصویر یا URL
     * @returns {Promise<string>}
     */
    async uploadProfileImage(image) {
        try {
            let imageUrl;
            
            if (image instanceof File) {
                // آپلود فایل جدید
                const formData = new FormData();
                formData.append('image', image);
                formData.append('userId', this.currentUserId);
                
                const response = await this.apiClient.post('/profile/image', formData, {
                    headers: { 'Content-Type': 'multipart/form-data' }
                });
                
                imageUrl = response.imageUrl;
                
            } else if (typeof image === 'string') {
                // URL مستقیم
                imageUrl = image;
            } else {
                throw new Error('Invalid image format');
            }
            
            // به‌روزرسانی پروفایل محلی
            await this.userRepository.updateProfileImage(this.currentUserId, imageUrl);
            
            // پاک کردن کش
            this.clearCache('basic');
            
            this.logger.info('Profile image uploaded');
            return imageUrl;
            
        } catch (error) {
            this.logger.error('Failed to upload profile image:', error);
            throw error;
        }
    }
    
    /**
     * همگام‌سازی با سرور - رعایت SRP
     * @param {boolean} force - اجبار به همگام‌سازی
     * @returns {Promise<boolean>}
     */
    async syncWithServer(force = false) {
        if (this.isSyncing && !force) {
            this.logger.warn('Sync already in progress');
            return false;
        }
        
        this.isSyncing = true;
        
        try {
            // بررسی اتصال
            if (!navigator.onLine) {
                this.logger.warn('Device is offline, skipping sync');
                return false;
            }
            
            // همگام‌سازی دوطرفه
            await this.performTwoWaySync();
            
            // پردازش صف همگام‌سازی
            await this.processSyncQueue();
            
            // انتشار رویداد
            this.eventBus?.publish('profile:synced', {
                userId: this.currentUserId,
                timestamp: Date.now()
            });
            
            this.logger.info('Profile synced successfully');
            return true;
            
        } catch (error) {
            this.logger.error('Sync failed:', error);
            throw error;
        } finally {
            this.isSyncing = false;
        }
    }
    
    /**
     * دریافت خلاصه پروفایل - رعایت SRP
     * @returns {Promise<ProfileSummary>}
     */
    async getProfileSummary() {
        try {
            const [
                basicInfo,
                languages,
                subscription,
                stats,
                settings
            ] = await Promise.all([
                this.getBasicInfo(),
                this.languageManager.getLearningLanguages(),
                this.subscriptionManager.getSubscriptionInfo(),
                this.analyticsManager.getStats(),
                this.settingsManager.getSettings()
            ]);
            
            return {
                basicInfo,
                languages,
                subscription,
                stats,
                settings,
                lastSynced: new Date().toISOString()
            };
        } catch (error) {
            this.logger.error('Failed to get profile summary:', error);
            throw error;
        }
    }
    
    // ==================== متدهای پیاده‌سازی اینترفیس ====================
    
    async getLearningLanguages() {
        return this.languageManager.getLearningLanguages();
    }
    
    async addLearningLanguage(languageCode, level) {
        return this.languageManager.addLearningLanguage(languageCode, level);
    }
    
    async updateLanguageProgress(languageCode, newLevel, progress) {
        return this.languageManager.updateLanguageProgress(languageCode, newLevel, progress);
    }
    
    async getDefaultLanguage() {
        return this.languageManager.getDefaultLanguage();
    }
    
    async setDefaultLanguage(languageCode) {
        return this.languageManager.setDefaultLanguage(languageCode);
    }
    
    async getSubscriptionInfo() {
        return this.subscriptionManager.getSubscriptionInfo();
    }
    
    async hasActiveSubscription() {
        return this.subscriptionManager.hasActiveSubscription();
    }
    
    async hasAccessToLanguage(languageCode) {
        return this.subscriptionManager.hasAccessToLanguage(languageCode);
    }
    
    async getSubscriptionExpiry() {
        return this.subscriptionManager.getSubscriptionExpiry();
    }
    
    async getSubscriptionType() {
        return this.subscriptionManager.getSubscriptionType();
    }
    
    async getSettings() {
        return this.settingsManager.getSettings();
    }
    
    async updateSettings(newSettings) {
        return this.settingsManager.updateSettings(newSettings);
    }
    
    async getNotificationSettings() {
        return this.settingsManager.getNotificationSettings();
    }
    
    async toggleNotification(notificationType, enabled) {
        return this.settingsManager.toggleNotification(notificationType, enabled);
    }
    
    async changeTheme(theme) {
        return this.settingsManager.changeTheme(theme);
    }
    
    async getStats() {
        return this.analyticsManager.getStats();
    }
    
    async getActivityHistory(fromDate, toDate) {
        return this.analyticsManager.getActivityHistory(fromDate, toDate);
    }
    
    async getStrengths() {
        return this.analyticsManager.getStrengths();
    }
    
    async getWeaknesses() {
        return this.analyticsManager.getWeaknesses();
    }
    
    async getWeeklyReport() {
        return this.analyticsManager.getWeeklyReport();
    }
    
    async backupProfile() {
        return this.performBackup();
    }
    
    async restoreProfile(backupKey) {
        return this.performRestore(backupKey);
    }
    
    async deleteProfile(reason) {
        return this.performDeletion(reason);
    }
    
    // ==================== متدهای کمکی خصوصی ====================
    
    /**
     * بارگذاری پروفایل از ذخیره‌سازی محلی
     */
    async loadLocalProfile() {
        try {
            const profileData = await this.storageService.get(`profile_${this.currentUserId}`);
            
            if (profileData) {
                // بازگردانی داده‌ها
                await this.userRepository.restore(profileData);
                this.logger.debug('Profile loaded from local storage');
            } else {
                // ایجاد پروفایل جدید
                await this.createDefaultProfile();
            }
        } catch (error) {
            this.logger.error('Failed to load local profile:', error);
            // ادامه با پروفایل پیش‌فرض
            await this.createDefaultProfile();
        }
    }
    
    /**
     * ایجاد پروفایل پیش‌فرض
     */
    async createDefaultProfile() {
        const defaultProfile = {
            basicInfo: {
                id: this.currentUserId,
                fullName: 'کاربر جدید',
                email: '',
                profileImage: 'https://api.dicebear.com/7.x/avataaars/svg?seed=vakamova',
                country: 'IR',
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                joinDate: new Date().toISOString(),
                lastSeen: new Date().toISOString()
            },
            languages: [{
                code: 'en',
                name: 'English',
                level: 'beginner',
                progress: 0,
                streak: 0,
                totalMinutes: 0,
                startedAt: new Date().toISOString()
            }],
            settings: {
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
            },
            subscription: {
                type: 'free',
                startDate: new Date().toISOString(),
                expiryDate: null,
                autoRenew: false,
                accessibleLanguages: ['en']
            }
        };
        
        await this.userRepository.save(this.currentUserId, defaultProfile);
        this.logger.info('Default profile created');
    }
    
    /**
     * اعتبارسنجی اطلاعات پایه
     */
    validateBasicInfo(basicInfo) {
        const required = ['fullName', 'email'];
        
        required.forEach(field => {
            if (!basicInfo[field] || basicInfo[field].trim() === '') {
                throw new Error(`Required field missing: ${field}`);
            }
        });
        
        // اعتبارسنجی ایمیل
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(basicInfo.email)) {
            throw new Error('Invalid email format');
        }
    }
    
    /**
     * همگام‌سازی دوطرفه
     */
    async performTwoWaySync() {
        try {
            // دریافت از سرور
            const serverProfile = await this.apiClient.get(`/profile/${this.currentUserId}`);
            
            // دریافت از محلی
            const localProfile = await this.userRepository.getFullProfile(this.currentUserId);
            
            // الگوریتم همگام‌سازی (Last Write Wins با برچسب زمانی)
            const mergedProfile = this.mergeProfiles(localProfile, serverProfile);
            
            // ذخیره محلی
            await this.userRepository.save(this.currentUserId, mergedProfile);
            
            // آپدیت سرور (در صف جداگانه)
            this.addToSyncQueue({
                type: 'full_sync',
                data: mergedProfile,
                timestamp: Date.now()
            });
            
        } catch (error) {
            if (error.status === 404) {
                // کاربر در سرور وجود ندارد، ایجاد کن
                await this.createProfileOnServer();
            } else {
                throw error;
            }
        }
    }
    
    /**
     * ادغام پروفایل‌ها
     */
    mergeProfiles(local, server) {
        // مقایسه بر اساس timestamp
        const localTimestamp = new Date(local.lastModified || 0).getTime();
        const serverTimestamp = new Date(server.lastModified || 0).getTime();
        
        if (serverTimestamp > localTimestamp) {
            // سرور جدیدتر است
            return {
                ...local,
                ...server,
                lastModified: server.lastModified,
                syncStatus: 'server_win'
            };
        } else {
            // محلی جدیدتر است
            return {
                ...server,
                ...local,
                lastModified: local.lastModified,
                syncStatus: 'local_win'
            };
        }
    }
    
    /**
     * ایجاد پروفایل در سرور
     */
    async createProfileOnServer() {
        const localProfile = await this.userRepository.getFullProfile(this.currentUserId);
        
        await this.apiClient.post('/profile', {
            userId: this.currentUserId,
            profile: localProfile
        });
        
        this.logger.info('Profile created on server');
    }
    
    /**
     * پردازش صف همگام‌سازی
     */
    async processSyncQueue() {
        if (this.syncQueue.length === 0) return;
        
        this.logger.info(`Processing sync queue: ${this.syncQueue.length} items`);
        
        while (this.syncQueue.length > 0) {
            const item = this.syncQueue.shift();
            
            try {
                switch (item.type) {
                    case 'update_basic_info':
                        await this.apiClient.put(
                            `/profile/${this.currentUserId}/basic`,
                            item.data
                        );
                        break;
                        
                    case 'full_sync':
                        await this.apiClient.put(
                            `/profile/${this.currentUserId}`,
                            item.data
                        );
                        break;
                        
                    case 'update_language':
                        await this.apiClient.post(
                            `/profile/${this.currentUserId}/languages`,
                            item.data
                        );
                        break;
                }
                
                this.logger.debug(`Sync item processed: ${item.type}`);
                
            } catch (error) {
                this.logger.error(`Failed to sync item ${item.type}:`, error);
                
                // اگر خطای موقت است، دوباره به صف اضافه کن
                if (this.isTransientError(error)) {
                    this.syncQueue.unshift(item);
                    await this.delay(5000); // 5 ثانیه تاخیر
                    break;
                }
            }
        }
    }
    
    /**
     * اضافه به صف همگام‌سازی
     */
    addToSyncQueue(item) {
        this.syncQueue.push(item);
        
        // اگر صف بزرگ است، همگام‌سازی فوری
        if (this.syncQueue.length >= 10) {
            this.syncWithServer(true);
        }
    }
    
    /**
     * پشتیبان‌گیری
     */
    async performBackup() {
        const profile = await this.userRepository.getFullProfile(this.currentUserId);
        const backupData = JSON.stringify(profile);
        const backupKey = `backup_${this.currentUserId}_${Date.now()}`;
        
        await this.storageService.set(backupKey, backupData);
        
        this.logger.info(`Profile backup created: ${backupKey}`);
        return backupKey;
    }
    
    /**
     * بازیابی
     */
    async performRestore(backupKey) {
        const backupData = await this.storageService.get(backupKey);
        
        if (!backupData) {
            throw new Error('Backup not found');
        }
        
        const profile = JSON.parse(backupData);
        await this.userRepository.save(this.currentUserId, profile);
        
        // پاک کردن کش
        this.clearCache('all');
        
        this.logger.info(`Profile restored from: ${backupKey}`);
        return true;
    }
    
    /**
     * حذف پروفایل
     */
    async performDeletion(reason) {
        // لاگ دلیل حذف
        this.logger.warn(`Profile deletion requested: ${reason}`, {
            userId: this.currentUserId,
            timestamp: new Date().toISOString()
        });
        
        // حذف از سرور
        await this.apiClient.delete(`/profile/${this.currentUserId}`, {
            reason: reason
        });
        
        // حذف محلی
        await this.userRepository.delete(this.currentUserId);
        
        // پاک کردن کش
        this.cache.clear();
        
        this.logger.info('Profile deleted successfully');
        return true;
    }
    
    /**
     * پاک کردن کش
     */
    clearCache(type = 'all') {
        if (type === 'all') {
            this.cache.clear();
        } else {
            for (const key of this.cache.keys()) {
                if (key.startsWith(type)) {
                    this.cache.delete(key);
                }
            }
        }
    }
    
    /**
     * بررسی خطای موقت
     */
    isTransientError(error) {
        const transientStatuses = [408, 429, 500, 502, 503, 504];
        const transientMessages = ['timeout', 'network', 'connection'];
        
        return transientStatuses.includes(error.status) ||
               transientMessages.some(msg => error.message.toLowerCase().includes(msg));
    }
    
    /**
     * تاخیر
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// ==================== کلاس‌های داخلی (رعایت SRP) ====================

class LanguageManager {
    constructor(profileManager) {
        this.profileManager = profileManager;
        this.userRepository = profileManager.userRepository;
        this.logger = profileManager.logger;
    }
    
    async getLearningLanguages() {
        return this.userRepository.getLanguages(this.profileManager.currentUserId);
    }
    
    async addLearningLanguage(languageCode, level) {
        const language = {
            code: languageCode,
            name: this.getLanguageName(languageCode),
            level: level || 'beginner',
            progress: 0,
            streak: 0,
            totalMinutes: 0,
            startedAt: new Date().toISOString(),
            lastPracticed: new Date().toISOString()
        };
        
        await this.userRepository.addLanguage(
            this.profileManager.currentUserId,
            language
        );
        
        this.logger.info(`Language added: ${languageCode}`);
        return language;
    }
    
    async updateLanguageProgress(languageCode, newLevel, progress) {
        await this.userRepository.updateLanguageProgress(
            this.profileManager.currentUserId,
            languageCode,
            newLevel,
            progress
        );
        
        // اضافه به صف همگام‌سازی
        this.profileManager.addToSyncQueue({
            type: 'update_language',
            data: { languageCode, newLevel, progress },
            timestamp: Date.now()
        });
        
        this.logger.info(`Language progress updated: ${languageCode} → ${newLevel} (${progress}%)`);
        return true;
    }
    
    async getDefaultLanguage() {
        const settings = await this.userRepository.getSettings(this.profileManager.currentUserId);
        return settings.interfaceLanguage || 'fa';
    }
    
    async setDefaultLanguage(languageCode) {
        await this.userRepository.updateSettings(
            this.profileManager.currentUserId,
            { interfaceLanguage: languageCode }
        );
        
        this.logger.info(`Default language set to: ${languageCode}`);
        return true;
    }
    
    getLanguageName(code) {
        const languages = {
            'en': 'English',
            'fa': 'فارسی',
            'es': 'Español',
            'fr': 'Français',
            'de': 'Deutsch',
            'zh': '中文',
            'ar': 'العربية',
            'ru': 'Русский',
            'ja': '日本語',
            'ko': '한국어'
        };
        
        return languages[code] || code;
    }
}

class SubscriptionManager {
    constructor(profileManager) {
        this.profileManager = profileManager;
        this.userRepository = profileManager.userRepository;
        this.logger = profileManager.logger;
    }
    
    async getSubscriptionInfo() {
        return this.userRepository.getSubscription(this.profileManager.currentUserId);
    }
    
    async hasActiveSubscription() {
        const subscription = await this.getSubscriptionInfo();
        
        if (!subscription || subscription.type === 'free') {
            return false;
        }
        
        if (!subscription.expiryDate) {
            return true; // اشتراک دائمی
        }
        
        const expiry = new Date(subscription.expiryDate);
        return expiry > new Date();
    }
    
    async hasAccessToLanguage(languageCode) {
        const subscription = await this.getSubscriptionInfo();
        
        // کاربران پرمیوم به همه زبان‌ها دسترسی دارند
        if (subscription.type === 'premium' || subscription.type === 'business') {
            return true;
        }
        
        // کاربران رایگان فقط به ۳ زبان اول دسترسی دارند
        const accessibleLangs = subscription.accessibleLanguages || ['en'];
        return accessibleLangs.includes(languageCode);
    }
    
    async getSubscriptionExpiry() {
        const subscription = await this.getSubscriptionInfo();
        return subscription.expiryDate ? new Date(subscription.expiryDate) : null;
    }
    
    async getSubscriptionType() {
        const subscription = await this.getSubscriptionInfo();
        return subscription.type || 'free';
    }
}

class SettingsManager {
    constructor(profileManager) {
        this.profileManager = profileManager;
        this.userRepository = profileManager.userRepository;
        this.logger = profileManager.logger;
    }
    
    async getSettings() {
        return this.userRepository.getSettings(this.profileManager.currentUserId);
    }
    
    async updateSettings(newSettings) {
        await this.userRepository.updateSettings(
            this.profileManager.currentUserId,
            newSettings
        );
        
        // پاک کردن کش تنظیمات
        this.profileManager.clearCache('settings');
        
        // انتشار رویداد
        this.profileManager.eventBus?.publish('settings:updated', {
            userId: this.profileManager.currentUserId,
            settings: newSettings
        });
        
        this.logger.info('Settings updated');
        return true;
    }
    
    async getNotificationSettings() {
        const settings = await this.getSettings();
        return settings.notifications || {};
    }
    
    async toggleNotification(notificationType, enabled) {
        const settings = await this.getSettings();
        
        const updatedNotifications = {
            ...settings.notifications,
            [notificationType]: enabled
        };
        
        return this.updateSettings({
            notifications: updatedNotifications
        });
    }
    
    async changeTheme(theme) {
        if (!['light', 'dark', 'auto'].includes(theme)) {
            throw new Error('Invalid theme');
        }
        
        return this.updateSettings({ theme });
    }
}

class AnalyticsManager {
    constructor(profileManager) {
        this.profileManager = profileManager;
        this.userRepository = profileManager.userRepository;
        this.logger = profileManager.logger;
    }
    
    async getStats() {
        const activities = await this.userRepository.getActivities(
            this.profileManager.currentUserId
        );
        
        // محاسبه آمار
        const totalMinutes = activities.reduce((sum, act) => sum + (act.duration || 0), 0);
        const totalExercises = activities.filter(a => a.type === 'exercise').length;
        const totalLessons = activities.filter(a => a.type === 'lesson').length;
        
        // محاسبه دقت
        const exercises = activities.filter(a => a.type === 'exercise');
        const correctExercises = exercises.filter(e => e.correct).length;
        const accuracy = exercises.length > 0 ? 
            Math.round((correctExercises / exercises.length) * 100) : 0;
        
        // محاسبه streak
        const streak = this.calculateCurrentStreak(activities);
        const longestStreak = this.calculateLongestStreak(activities);
        
        // محاسبه XP
        const xp = activities.reduce((sum, act) => sum + (act.earnedXP || 0), 0);
        
        // محاسبه سطح
        const level = Math.floor(xp / 1000) + 1;
        
        return {
            totalLessons,
            totalExercises,
            totalMinutes,
            currentStreak: streak,
            longestStreak,
            accuracy,
            level,
            xp,
            rank: this.calculateRank(xp)
        };
    }
    
    async getActivityHistory(fromDate, toDate) {
        const activities = await this.userRepository.getActivities(
            this.profileManager.currentUserId,
            fromDate,
            toDate
        );
        
        return activities.sort((a, b) => 
            new Date(b.date) - new Date(a.date)
        );
    }
    
    async getStrengths() {
        const activities = await this.userRepository.getActivities(
            this.profileManager.currentUserId,
            new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // 30 روز گذشته
        );
        
        // تحلیل نقاط قوت
        const strengths = [];
        const skillMap = new Map();
        
        activities.forEach(activity => {
            if (activity.skills) {
                activity.skills.forEach(skill => {
                    if (!skillMap.has(skill)) {
                        skillMap.set(skill, { correct: 0, total: 0 });
                    }
                    
                    const stats = skillMap.get(skill);
                    stats.total++;
                    
                    if (activity.correct) {
                        stats.correct++;
                    }
                });
            }
        });
        
        // تبدیل به آرایه
        for (const [skill, stats] of skillMap) {
            if (stats.total >= 5) { // حداقل ۵ فعالیت
                const score = Math.round((stats.correct / stats.total) * 100);
                
                if (score >= 80) { // نقطه قوت
                    strengths.push({
                        skill,
                        score,
                        improvement: this.calculateImprovement(skill, activities),
                        sampleSize: stats.total
                    });
                }
            }
        }
        
        return strengths.sort((a, b) => b.score - a.score);
    }
    
    async getWeaknesses() {
        const activities = await this.userRepository.getActivities(
            this.profileManager.currentUserId,
            new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
        );
        
        const weaknesses = [];
        const skillMap = new Map();
        
        activities.forEach(activity => {
            if (activity.skills) {
                activity.skills.forEach(skill => {
                    if (!skillMap.has(skill)) {
                        skillMap.set(skill, { correct: 0, total: 0 });
                    }
                    
                    const stats = skillMap.get(skill);
                    stats.total++;
                    
                    if (activity.correct) {
                        stats.correct++;
                    }
                });
            }
        });
        
        for (const [skill, stats] of skillMap) {
            if (stats.total >= 3) { // حداقل ۳ فعالیت
                const score = Math.round((stats.correct / stats.total) * 100);
                
                if (score <= 60) { // نقطه ضعف
                    weaknesses.push({
                        skill,
                        score,
                        recommendations: this.generateRecommendations(skill, score),
                        practiceCount: stats.total
                    });
                }
            }
        }
        
        return weaknesses.sort((a, b) => a.score - b.score);
    }
    
    async getWeeklyReport() {
        const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const activities = await this.getActivityHistory(oneWeekAgo, new Date());
        
        const strengths = await this.getStrengths();
        const weaknesses = await this.getWeaknesses();
        
        // آمار هفتگی
        const weeklyStats = activities.reduce((stats, activity) => {
            stats.lessonsCompleted += activity.type === 'lesson' ? 1 : 0;
            stats.exercisesCompleted += activity.type === 'exercise' ? 1 : 0;
            stats.totalMinutes += activity.duration || 0;
            stats.totalXP += activity.earnedXP || 0;
            
            if (activity.correct) {
                stats.correctExercises++;
            }
            
            return stats;
        }, {
            lessonsCompleted: 0,
            exercisesCompleted: 0,
            totalMinutes: 0,
            totalXP: 0,
            correctExercises: 0
        });
        
        // محاسبه دقت
        const accuracy = weeklyStats.exercisesCompleted > 0 ?
            Math.round((weeklyStats.correctExercises / weeklyStats.exercisesCompleted) * 100) : 0;
        
        // محاسبه streak هفتگی
        const streakDays = this.calculateStreakDays(activities);
        
        // جمع‌آوری دستاوردها
        const achievements = this.extractAchievements(activities);
        
        return {
            weekStart: oneWeekAgo,
            weekEnd: new Date(),
            lessonsCompleted: weeklyStats.lessonsCompleted,
            exercisesCompleted: weeklyStats.exercisesCompleted,
            totalMinutes: weeklyStats.totalMinutes,
            accuracy,
            streakDays,
            achievements,
            strengths: strengths.slice(0, 3), // ۳ نقطه قوت برتر
            weaknesses: weaknesses.slice(0, 3), // ۳ نقطه ضعف برتر
            totalXP: weeklyStats.totalXP
        };
    }
    
    // ==================== متدهای کمکی تحلیلی ====================
    
    calculateCurrentStreak(activities) {
        let streak = 0;
        const today = new Date().toDateString();
        const dates = new Set(
            activities.map(a => new Date(a.date).toDateString())
        );
        
        // بررسی از امروز به عقب
        let currentDate = new Date();
        
        while (true) {
            const dateStr = currentDate.toDateString();
            
            if (dates.has(dateStr)) {
                streak++;
                currentDate.setDate(currentDate.getDate() - 1);
            } else {
                break;
            }
        }
        
        return streak;
    }
    
    calculateLongestStreak(activities) {
        const dates = Array.from(new Set(
            activities.map(a => new Date(a.date).toDateString())
        )).sort();
        
        let longestStreak = 0;
        let currentStreak = 1;
        
        for (let i = 1; i < dates.length; i++) {
            const prevDate = new Date(dates[i - 1]);
            const currDate = new Date(dates[i]);
            const diffDays = Math.floor((currDate - prevDate) / (1000 * 60 * 60 * 24));
            
            if (diffDays === 1) {
                currentStreak++;
            } else {
                longestStreak = Math.max(longestStreak, currentStreak);
                currentStreak = 1;
            }
        }
        
        return Math.max(longestStreak, currentStreak);
    }
    
    calculateStreakDays(activities) {
        const dates = new Set(
            activities.map(a => new Date(a.date).toDateString())
        );
        
        return dates.size;
    }
    
    calculateRank(xp) {
        const ranks = [
            { minXP: 0, rank: 'Newbie' },
            { minXP: 1000, rank: 'Beginner' },
            { minXP: 5000, rank: 'Intermediate' },
            { minXP: 15000, rank: 'Advanced' },
            { minXP: 30000, rank: 'Expert' },
            { minXP: 50000, rank: 'Master' },
            { minXP: 100000, rank: 'Grand Master' }
        ];
        
        for (let i = ranks.length - 1; i >= 0; i--) {
            if (xp >= ranks[i].minXP) {
                return ranks[i].rank;
            }
        }
        
        return 'Newbie';
    }
    
    calculateImprovement(skill, activities) {
        const sortedActivities = activities
            .filter(a => a.skills && a.skills.includes(skill))
            .sort((a, b) => new Date(a.date) - new Date(b.date));
        
        if (sortedActivities.length < 2) return 0;
        
        const firstHalf = sortedActivities.slice(0, Math.floor(sortedActivities.length / 2));
        const secondHalf = sortedActivities.slice(Math.floor(sortedActivities.length / 2));
        
        const firstAccuracy = firstHalf.filter(a => a.correct).length / firstHalf.length * 100;
        const secondAccuracy = secondHalf.filter(a => a.correct).length / secondHalf.length * 100;
        
        return Math.round(secondAccuracy - firstAccuracy);
    }
    
    generateRecommendations(skill, score) {
        const recommendations = [];
        
        if (score < 40) {
            recommendations.push(
                'تمرین‌های مبتدی این مهارت را تکرار کنید',
                'ویدیوهای آموزشی مرتبط را تماشا کنید'
            );
        } else if (score < 60) {
            recommendations.push(
                'تمرین‌های متوسط این مهارت را انجام دهید',
                'از فلش‌کارت‌ها برای تقویت استفاده کنید'
            );
        } else {
            recommendations.push(
                'تمرین‌های پیشرفته را امتحان کنید',
                'در مکالمه واقعی این مهارت را تمرین کنید'
            );
        }
        
        recommendations.push(
            'هر روز حداقل ۱۵ دقیقه تمرین کنید',
            'اشتباهات خود را یادداشت و مرور کنید'
        );
        
        return recommendations;
    }
    
    extractAchievements(activities) {
        const achievements = [];
        
        // بررسی دستاوردها
        const totalMinutes = activities.reduce((sum, a) => sum + (a.duration || 0), 0);
        const perfectDays = this.countPerfectDays(activities);
        const streak = this.calculateCurrentStreak(activities);
        
        if (totalMinutes >= 7 * 60) { // ۷ ساعت در هفته
            achievements.push('Dedicated Learner');
        }
        
        if (perfectDays >= 3) { // ۳ روز کامل
            achievements.push('Consistent Performer');
        }
        
        if (streak >= 7) { // استریک ۷ روزه
            achievements.push('Week Warrior');
        }
        
        // دستاوردهای مهارتی
        const skillAchievements = this.checkSkillAchievements(activities);
        achievements.push(...skillAchievements);
        
        return achievements;
    }
    
    countPerfectDays(activities) {
        const dailyStats = new Map();
        
        activities.forEach(activity => {
            const dateStr = new Date(activity.date).toDateString();
            
            if (!dailyStats.has(dateStr)) {
                dailyStats.set(dateStr, {
                    exercises: 0,
                    correct: 0
                });
            }
            
            const stats = dailyStats.get(dateStr);
            
            if (activity.type === 'exercise') {
                stats.exercises++;
                if (activity.correct) {
                    stats.correct++;
                }
            }
        });
        
        let perfectDays = 0;
        
        for (const [, stats] of dailyStats) {
            if (stats.exercises >= 5 && stats.correct === stats.exercises) {
                perfectDays++;
            }
        }
        
        return perfectDays;
    }
    
    checkSkillAchievements(activities) {
        const skillCount = new Map();
        const achievements = [];
        
        activities.forEach(activity => {
            if (activity.skills) {
                activity.skills.forEach(skill => {
                    skillCount.set(skill, (skillCount.get(skill) || 0) + 1);
                });
            }
        });
        
        for (const [skill, count] of skillCount) {
            if (count >= 50) {
                achievements.push(`${skill} Expert`);
            } else if (count >= 20) {
                achievements.push(`${skill} Intermediate`);
            }
        }
        
        return achievements;
    }
}

export default UserProfileManager;
