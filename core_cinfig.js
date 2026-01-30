/**
 * HyperLang - Centralized Configuration
 * Version: 1.0.0
 * Principle: Centralized Configuration
 */

export const CONFIG = {
    // Application
    APP: {
        NAME: 'HyperLang',
        VERSION: '1.0.0-alpha',
        ENV: process.env.NODE_ENV || 'development',
        DEBUG: localStorage.getItem('hyperlang_debug') === 'true'
    },
    
    // State Management
    STATE: {
        MAX_HISTORY: 50,
        AUTO_SAVE_INTERVAL: 30000, // 30 seconds
        ENCRYPT_SENSITIVE: true,
        VALIDATE_ON_CHANGE: true
    },
    
    // Database
    DATABASE: {
        NAME: 'HyperLangDB',
        VERSION: 3,
        TIMEOUT: 10000,
        MAX_CONNECTIONS: 3,
        BACKUP_INTERVAL: 3600000 // 1 hour
    },
    
    // Router
    ROUTER: {
        MODE: 'hash', // 'hash' or 'history'
        BASE: '/',
        NOT_FOUND_REDIRECT: '/home',
        TRANSITION_DURATION: 300
    },
    
    // Authentication
    AUTH: {
        TOKEN_KEY: 'hyperlang_token',
        SESSION_TIMEOUT: 1800000, // 30 minutes
        REFRESH_THRESHOLD: 300000, // 5 minutes
        PASSWORD_MIN_LENGTH: 6
    },
    
    // API
    API: {
        BASE_URL: process.env.API_URL || 'https://api.hyperlang.com/v1',
        TIMEOUT: 30000,
        RETRY_ATTEMPTS: 3,
        CACHE_TTL: 300000 // 5 minutes
    },
    
    // Events
    EVENTS: {
        MAX_LISTENERS: 20,
        LOG_EVENTS: CONFIG.APP.DEBUG,
        PERSIST_EVENTS: false
    },
    
    // Feature Flags
    FEATURES: {
        OFFLINE_MODE: true,
        PWA: true,
        ANALYTICS: true,
        NOTIFICATIONS: true,
        VOICE_RECOGNITION: false // Coming soon
    },
    
    // UI
    UI: {
        THEME: 'dark', // 'dark', 'light', 'auto'
        LANGUAGE: 'fa',
        ANIMATIONS: true,
        REDUCED_MOTION: false
    }
};

// Freeze configuration to prevent accidental changes
Object.freeze(CONFIG);
Object.keys(CONFIG).forEach(key => Object.freeze(CONFIG[key]));

// Configuration manager with validation
export class ConfigManager {
    static get(path, defaultValue = null) {
        return path.split('.').reduce((obj, key) => 
            obj && obj[key] !== undefined ? obj[key] : defaultValue, CONFIG);
    }
    
    static setUserConfig(key, value) {
        const userConfig = JSON.parse(localStorage.getItem('hyperlang_user_config') || '{}');
        userConfig[key] = value;
        localStorage.setItem('hyperlang_user_config', JSON.stringify(userConfig));
        return true;
    }
    
    static getUserConfig(key, defaultValue = null) {
        const userConfig = JSON.parse(localStorage.getItem('hyperlang_user_config') || '{}');
        return userConfig[key] !== undefined ? userConfig[key] : defaultValue;
    }
    
    static validate() {
        const errors = [];
        
        // Validate required configuration
        if (!CONFIG.APP.NAME) errors.push('APP.NAME is required');
        if (!CONFIG.DATABASE.NAME) errors.push('DATABASE.NAME is required');
        if (CONFIG.AUTH.SESSION_TIMEOUT < 60000) {
            errors.push('AUTH.SESSION_TIMEOUT must be at least 60000ms');
        }
        
        return {
            valid: errors.length === 0,
            errors,
            timestamp: new Date().toISOString()
        };
    }
}

export default CONFIG;
