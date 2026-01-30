// ==================== CONFIGURATION ====================
export const CONFIG = {
    APP_NAME: 'HyperLang',
    VERSION: '1.0.0',
    DEBUG: true,
    
    // State Management
    STATE: {
        MAX_HISTORY: 10,
        AUTO_SAVE: true,
        VALIDATE_ON_CHANGE: false
    },
    
    // Database
    DATABASE: {
        NAME: 'HyperLangDB',
        VERSION: 1
    },
    
    // Routing
    ROUTER: {
        MODE: 'hash', // hash-based برای PWA
        BASE_URL: '/'
    }
};

console.log('[Config] ✅ Configuration loaded');
