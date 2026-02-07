/**
 * 📜 Interface User Profile Manager
 * قراردادهای انتزاعی مدیریت پروفایل کاربر - رعایت ISP (جداسازی رابط)
 */

// ==================== اینترفیس پایه پروفایل ====================
class BaseProfileInterface {
    /**
     * دریافت اطلاعات پایه کاربر
     * @returns {Promise<UserBasicInfo>}
     */
    async getBasicInfo() {
        throw new Error('Method not implemented');
    }

    /**
     * به‌روزرسانی اطلاعات پایه کاربر
     * @param {UserBasicInfo} basicInfo - اطلاعات جدید
     * @returns {Promise<boolean>}
     */
    async updateBasicInfo(basicInfo) {
        throw new Error('Method not implemented');
    }

    /**
     * آپلود تصویر پروفایل
     * @param {File|string} image - فایل تصویر یا URL
     * @returns {Promise<string>} - URL تصویر آپلود شده
     */
    async uploadProfileImage(image) {
        throw new Error('Method not implemented');
    }
}

// ==================== اینترفیس مدیریت زبان‌ها ====================
class LanguageProfileInterface {
    /**
     * دریافت لیست زبان‌های در حال یادگیری کاربر
     * @returns {Promise<UserLanguage[]>}
     */
    async getLearningLanguages() {
        throw new Error('Method not implemented');
    }

    /**
     * اضافه کردن زبان جدید برای یادگیری
     * @param {string} languageCode - کد زبان (en, fa, ...)
     * @param {string} level - سطح اولیه (beginner, intermediate, ...)
     * @returns {Promise<UserLanguage>}
     */
    async addLearningLanguage(languageCode, level) {
        throw new Error('Method not implemented');
    }

    /**
     * به‌روزرسانی سطح زبان
     * @param {string} languageCode - کد زبان
     * @param {string} newLevel - سطح جدید
     * @param {number} progress - پیشرفت (0-100)
     * @returns {Promise<boolean>}
     */
    async updateLanguageProgress(languageCode, newLevel, progress) {
        throw new Error('Method not implemented');
    }

    /**
     * دریافت زبان پیش‌فرض کاربر
     * @returns {Promise<string>} - کد زبان پیش‌فرض
     */
    async getDefaultLanguage() {
        throw new Error('Method not implemented');
    }

    /**
     * تنظیم زبان پیش‌فرض
     * @param {string} languageCode - کد زبان
     * @returns {Promise<boolean>}
     */
    async setDefaultLanguage(languageCode) {
        throw new Error('Method not implemented');
    }
}

// ==================== اینترفیس مدیریت اشتراک ====================
class SubscriptionInterface {
    /**
     * دریافت اطلاعات اشتراک کاربر
     * @returns {Promise<UserSubscription>}
     */
    async getSubscriptionInfo() {
        throw new Error('Method not implemented');
    }

    /**
     * بررسی وضعیت اشتراک فعال
     * @returns {Promise<boolean>}
     */
    async hasActiveSubscription() {
        throw new Error('Method not implemented');
    }

    /**
     * بررسی دسترسی به زبان خاص
     * @param {string} languageCode - کد زبان
     * @returns {Promise<boolean>}
     */
    async hasAccessToLanguage(languageCode) {
        throw new Error('Method not implemented');
    }

    /**
     * دریافت تاریخ انقضای اشتراک
     * @returns {Promise<Date|null>}
     */
    async getSubscriptionExpiry() {
        throw new Error('Method not implemented');
    }

    /**
     * دریافت نوع اشتراک (free, premium, business)
     * @returns {Promise<string>}
     */
    async getSubscriptionType() {
        throw new Error('Method not implemented');
    }
}

// ==================== اینترفیس تنظیمات کاربر ====================
class UserSettingsInterface {
    /**
     * دریافت تنظیمات کاربر
     * @returns {Promise<UserSettings>}
     */
    async getSettings() {
        throw new Error('Method not implemented');
    }

    /**
     * به‌روزرسانی تنظیمات
     * @param {Partial<UserSettings>} newSettings - تنظیمات جدید
     * @returns {Promise<boolean>}
     */
    async updateSettings(newSettings) {
        throw new Error('Method not implemented');
    }

    /**
     * دریافت تنظیمات اعلان‌ها
     * @returns {Promise<NotificationSettings>}
     */
    async getNotificationSettings() {
        throw new Error('Method not implemented');
    }

    /**
     * فعال/غیرفعال کردن نوع اعلان
     * @param {string} notificationType - نوع اعلان
     * @param {boolean} enabled - وضعیت
     * @returns {Promise<boolean>}
     */
    async toggleNotification(notificationType, enabled) {
        throw new Error('Method not implemented');
    }

    /**
     * تغییر تم برنامه
     * @param {string} theme - تم (light, dark, auto)
     * @returns {Promise<boolean>}
     */
    async changeTheme(theme) {
        throw new Error('Method not implemented');
    }
}

// ==================== اینترفیس آمار و گزارش ====================
class UserAnalyticsInterface {
    /**
     * دریافت آمار کلی کاربر
     * @returns {Promise<UserStats>}
     */
    async getStats() {
        throw new Error('Method not implemented');
    }

    /**
     * دریافت تاریخچه فعالیت
     * @param {Date} fromDate - از تاریخ
     * @param {Date} toDate - تا تاریخ
     * @returns {Promise<UserActivity[]>}
     */
    async getActivityHistory(fromDate, toDate) {
        throw new Error('Method not implemented');
    }

    /**
     * دریافت نقاط قوت کاربر
     * @returns {Promise<UserStrengths[]>}
     */
    async getStrengths() {
        throw new Error('Method not implemented');
    }

    /**
     * دریافت نقاط ضعف کاربر
     * @returns {Promise<UserWeaknesses[]>}
     */
    async getWeaknesses() {
        throw new Error('Method not implemented');
    }

    /**
     * دریافت گزارش هفتگی
     * @returns {Promise<WeeklyReport>}
     */
    async getWeeklyReport() {
        throw new Error('Method not implemented');
    }
}

// ==================== اینترفیس اصلی (ترکیب همه) ====================
class UserProfileManagerInterface extends BaseProfileInterface {
    constructor() {
        super();
        this.languageManager = null;
        this.subscriptionManager = null;
        this.settingsManager = null;
        this.analyticsManager = null;
    }

    /**
     * راه‌اندازی اولیه پروفایل کاربر
     * @param {string} userId - شناسه کاربر
     * @returns {Promise<boolean>}
     */
    async initialize(userId) {
        throw new Error('Method not implemented');
    }

    /**
     * همگام‌سازی با سرور
     * @param {boolean} force - اجبار به همگام‌سازی
     * @returns {Promise<boolean>}
     */
    async syncWithServer(force = false) {
        throw new Error('Method not implemented');
    }

    /**
     * پشتیبان‌گیری از پروفایل
     * @returns {Promise<string>} - کلید پشتیبان
     */
    async backupProfile() {
        throw new Error('Method not implemented');
    }

    /**
     * بازیابی پروفایل از پشتیبان
     * @param {string} backupKey - کلید پشتیبان
     * @returns {Promise<boolean>}
     */
    async restoreProfile(backupKey) {
        throw new Error('Method not implemented');
    }

    /**
     * حذف پروفایل
     * @param {string} reason - دلیل حذف
     * @returns {Promise<boolean>}
     */
    async deleteProfile(reason) {
        throw new Error('Method not implemented');
    }

    /**
     * دریافت خلاصه پروفایل
     * @returns {Promise<ProfileSummary>}
     */
    async getProfileSummary() {
        throw new Error('Method not implemented');
    }
}

// ==================== انواع داده‌ها (Type Definitions) ====================

/**
 * @typedef {Object} UserBasicInfo
 * @property {string} id - شناسه کاربر
 * @property {string} fullName - نام کامل
 * @property {string} email - ایمیل
 * @property {string} phone - تلفن
 * @property {string} profileImage - URL تصویر پروفایل
 * @property {string} country - کشور
 * @property {string} timezone - منطقه زمانی
 * @property {Date} joinDate - تاریخ عضویت
 * @property {Date} lastSeen - آخرین بازدید
 */

/**
 * @typedef {Object} UserLanguage
 * @property {string} code - کد زبان
 * @property {string} name - نام زبان
 * @property {string} level - سطح (A1, A2, B1, ...)
 * @property {number} progress - پیشرفت (0-100)
 * @property {number} streak - تعداد روز متوالی
 * @property {number} totalMinutes - مجموع دقیقه‌های یادگیری
 * @property {Date} startedAt - تاریخ شروع یادگیری
 * @property {Date} lastPracticed - آخرین تمرین
 */

/**
 * @typedef {Object} UserSubscription
 * @property {string} type - نوع اشتراک (free, monthly, yearly)
 * @property {Date} startDate - تاریخ شروع
 * @property {Date} expiryDate - تاریخ انقضا
 * @property {boolean} autoRenew - تمدید خودکار
 * @property {string} paymentMethod - روش پرداخت
 * @property {number} price - قیمت
 * @property {string} currency - واحد پول
 * @property {string[]} accessibleLanguages - زبان‌های قابل دسترسی
 */

/**
 * @typedef {Object} UserSettings
 * @property {NotificationSettings} notifications - تنظیمات اعلان‌ها
 * @property {string} theme - تم
 * @property {string} fontSize - اندازه فونت
 * @property {boolean} soundEffects - افکت‌های صوتی
 * @property {boolean} animations - انیمیشن‌ها
 * @property {string} studyReminder - زمان یادآوری مطالعه
 * @property {number} dailyGoal - هدف روزانه (دقیقه)
 * @property {boolean} dataSaver - حالت صرفه‌جویی دیتا
 * @property {string} interfaceLanguage - زبان رابط کاربری
 */

/**
 * @typedef {Object} NotificationSettings
 * @property {boolean} lessonReminders - یادآوری درس
 * @property {boolean} streakReminders - یادآوری استریک
 * @property {boolean} achievementAlerts - هشدار دستاوردها
 * @property {boolean} promotionalEmails - ایمیل‌های تبلیغاتی
 * @property {boolean} weeklyReports - گزارش هفتگی
 */

/**
 * @typedef {Object} UserStats
 * @property {number} totalLessons - مجموع درس‌ها
 * @property {number} totalExercises - مجموع تمرین‌ها
 * @property {number} totalMinutes - مجموع دقیقه‌ها
 * @property {number} currentStreak - استریک فعلی
 * @property {number} longestStreak - طولانی‌ترین استریک
 * @property {number} accuracy - دقت کلی
 * @property {number} level - سطح کلی
 * @property {number} xp - امتیاز تجربه
 * @property {number} rank - رتبه
 */

/**
 * @typedef {Object} UserActivity
 * @property {Date} date - تاریخ
 * @property {string} type - نوع فعالیت
 * @property {string} description - توضیح
 * @property {number} duration - مدت زمان (دقیقه)
 * @property {number} earnedXP - امتیاز کسب شده
 */

/**
 * @typedef {Object} UserStrengths
 * @property {string} skill - مهارت
 * @property {number} score - امتیاز
 * @property {number} improvement - میزان بهبود
 */

/**
 * @typedef {Object} UserWeaknesses
 * @property {string} skill - مهارت
 * @property {number} score - امتیاز
 * @property {string[]} recommendations - توصیه‌ها
 */

/**
 * @typedef {Object} WeeklyReport
 * @property {Date} weekStart - شروع هفته
 * @property {Date} weekEnd - پایان هفته
 * @property {number} lessonsCompleted - درس‌های تکمیل شده
 * @property {number} exercisesCompleted - تمرین‌های تکمیل شده
 * @property {number} totalMinutes - مجموع دقیقه‌ها
 * @property {number} accuracy - دقت
 * @property {number} streakDays - روزهای استریک
 * @property {string[]} achievements - دستاوردها
 * @property {UserStrengths[]} strengths - نقاط قوت
 * @property {UserWeaknesses[]} weaknesses - نقاط ضعف
 */

/**
 * @typedef {Object} ProfileSummary
 * @property {UserBasicInfo} basicInfo - اطلاعات پایه
 * @property {UserLanguage[]} languages - زبان‌ها
 * @property {UserSubscription} subscription - اشتراک
 * @property {UserStats} stats - آمار
 * @property {UserSettings} settings - تنظیمات
 */

// اکسپورت اینترفیس‌ها
export {
    BaseProfileInterface,
    LanguageProfileInterface,
    SubscriptionInterface,
    UserSettingsInterface,
    UserAnalyticsInterface,
    UserProfileManagerInterface
};
