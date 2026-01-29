class AppConfig {
    static VERSION = '1.0.0';
    static LANGUAGES = [
        {code: 'en', name: 'English', dir: 'ltr', flag: '🇺🇸'},
        {code: 'fa', name: 'فارسی', dir: 'rtl', flag: '🇮🇷'}
        // ... 10 زبان دیگر
    ];
    
    static API_BASE = 'https://api.yourserver.com/v1'; // برای آینده
    static OFFLINE_MODE = true;
    
    static getLanguage(code) {
        return this.LANGUAGES.find(lang => lang.code === code);
    }
    
    static validateConfig() {
        // اعتبارسنجی خودکار تنظیمات
        if(!this.OFFLINE_MODE && !this.API_BASE) {
            throw new Error('در حالت آنلاین، API_BASE ضروری است');
        }
        return true;
    }
}
