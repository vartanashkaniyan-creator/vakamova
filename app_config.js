
// ==================== APP CONFIGURATION ====================
// HyperLang Pro - Main Configuration File

const AppConfig = {
    // Application Metadata
    APP_NAME: 'HyperLang Pro',
    APP_VERSION: '1.0.0',
    APP_ENV: 'production',
    
    // Supported Languages
    LANGUAGES: [
        { code: 'en', name: 'English', nativeName: 'English', flag: '🇺🇸', direction: 'ltr' },
        { code: 'fa', name: 'Persian', nativeName: 'فارسی', flag: '🇮🇷', direction: 'rtl' }
    ],
    
    // Learning Levels
    LEVELS: [
        { id: 'beginner', name: 'مبتدی', order: 1, color: '#4CAF50' },
        { id: 'intermediate', name: 'متوسط', order: 2, color: '#2196F3' },
        { id: 'advanced', name: 'پیشرفته', order: 3, color: '#9C27B0' }
    ],
    
    // Lesson Categories
    CATEGORIES: [
        { id: 'conversation', name: 'مکالمه', icon: '💬' },
        { id: 'vocabulary', name: 'واژگان', icon: '📚' },
        { id: 'grammar', name: 'گرامر', icon: '🔤' },
        { id: 'pronunciation', name: 'تلفظ', icon: '🎤' }
    ],
    
    // Default Settings
    DEFAULT_SETTINGS: {
        language: 'en',
        level: 'beginner',
        theme: 'dark',
        notifications: true,
        autoplayAudio: true,
        fontSize: 'medium'
    },
    
    // API & Endpoints
    API: {
        BASE_URL: '',
        TIMEOUT: 30000,
        RETRY_ATTEMPTS: 3
    },
    
    // Feature Flags
    FEATURES: {
        OFFLINE_MODE: true,
        SPEECH_RECOGNITION: false,
        TEXT_TO_SPEECH: true,
        GAMIFICATION: true,
        SOCIAL_SHARING: false
    },
    
    // Validation Methods
    validateConfig() {
        if (!this.LANGUAGES || this.LANGUAGES.length === 0) {
            throw new Error('حداقل یک زبان باید تعریف شده باشد');
        }
        console.log('✅ تنظیمات برنامه اعتبارسنجی شد');
        return true;
    },
    
    // Helper Methods
    getLanguageByCode(code) {
        return this.LANGUAGES.find(lang => lang.code === code) || this.LANGUAGES[0];
    },
    
    getLevelById(id) {
        return this.LEVELS.find(level => level.id === id) || this.LEVELS[0];
    }
};

// Export for global use
if (typeof window !== 'undefined') {
    window.AppConfig = AppConfig;
}

console.log('✅ AppConfig loaded successfully');
