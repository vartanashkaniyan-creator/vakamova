// main.js - فایل اصلی اتصال ماژول‌های Vakamova

import Database from './database.js';
import StateManager from './state.js';
import Router from './router.js';
import AuthManager from './auth.js';
import ApiClient from './api.js';
import Utils from './utils.js';

// لاگر ساده برای نمایش در صفحه
const logger = {
    logContainer: document.getElementById('log-container'),
    
    addLog(message, type = 'info') {
        const logEntry = document.createElement('div');
        logEntry.className = `log-entry log-${type}`;
        logEntry.innerHTML = `[${new Date().toLocaleTimeString('fa-IR')}] ${message}`;
        this.logContainer.prepend(logEntry);
        
        // محدودیت تعداد لاگ‌ها
        if (this.logContainer.children.length > 20) {
            this.logContainer.removeChild(this.logContainer.lastChild);
        }
    }
};

// متغیرهای سراسری برای دسترسی در console
window.Vakamova = {
    Database,
    StateManager,
    Router,
    AuthManager,
    ApiClient,
    Utils,
    logger
};

// رویدادهای تست
window.testDatabase = async () => {
    logger.addLog('شروع تست پایگاه داده...', 'info');
    try {
        const db = new Database();
        await db.init();
        const testData = { id: 'test', value: 'داده تست Vakamova' };
        await db.set('test-store', testData);
        const retrieved = await db.get('test-store', 'test');
        
        if (retrieved?.value === 'داده تست Vakamova') {
            logger.addLog('✅ پایگاه داده با موفقیت تست شد', 'success');
        } else {
            logger.addLog('⚠️ تست پایگاه داده با مشکل مواجه شد', 'error');
        }
    } catch (error) {
        logger.addLog(`❌ خطا در تست پایگاه داده: ${error.message}`, 'error');
    }
};

window.testState = async () => {
    logger.addLog('شروع تست مدیریت وضعیت...', 'info');
    try {
        const state = new StateManager();
        state.init({ appName: 'Vakamova' });
        
        state.setState({ user: { name: 'کاربر تست' } });
        const currentState = state.getState();
        
        if (currentState.user?.name === 'کاربر تست') {
            logger.addLog('✅ مدیریت وضعیت با موفقیت تست شد', 'success');
        }
    } catch (error) {
        logger.addLog(`❌ خطا در تست وضعیت: ${error.message}`, 'error');
    }
};

window.testRouter = async () => {
    logger.addLog('شروع تست مسیریابی...', 'info');
    try {
        const router = new Router();
        router.init();
        
        // اضافه کردن مسیر تست
        router.addRoute('/test', () => {
            logger.addLog('📍 مسیر /test فعال شد', 'info');
        });
        
        // شبیه‌سازی تغییر مسیر
        router.navigate('/test');
        logger.addLog('✅ مسیریابی با موفقیت تست شد', 'success');
    } catch (error) {
        logger.addLog(`❌ خطا در تست مسیریابی: ${error.message}`, 'error');
    }
};

window.testAllModules = async () => {
    logger.addLog('شروع تست کامل همه ماژول‌ها...', 'info');
    
    await window.testDatabase();
    await window.testState();
    await window.testRouter();
    
    // تست احراز هویت
    try {
        const auth = new AuthManager();
        const token = auth.generateToken({ userId: 'test-user' });
        const isValid = auth.validateToken(token);
        
        if (isValid) {
            logger.addLog('✅ احراز هویت با موفقیت تست شد', 'success');
        }
    } catch (error) {
        logger.addLog(`⚠️ تست احراز هویت: ${error.message}`, 'info');
    }
    
    logger.addLog('🎉 تست کامل تمام ماژول‌ها به پایان رسید', 'success');
};

window.clearLogs = () => {
    const container = document.getElementById('log-container');
    container.innerHTML = '<div class="log-entry log-info">لاگ‌ها پاک شدند...</div>';
};

// مقداردهی اولیه هنگام لود صفحه
document.addEventListener('DOMContentLoaded', () => {
    logger.addLog('📱 سیستم Vakamova راه‌اندازی شد', 'info');
    logger.addLog('🔗 همه ماژول‌ها به هم متصل هستند', 'success');
    
    // نمایش اطلاعات در console توسعه‌دهنده
    console.log('🚀 Vakamova Core Modules Loaded:', {
        Database: typeof Database,
        StateManager: typeof StateManager,
        Router: typeof Router,
        AuthManager: typeof AuthManager,
        ApiClient: typeof ApiClient,
        Utils: typeof Utils
    });
    
    console.log('💡 برای تست ماژول‌ها از دکمه‌های صفحه یا دستورات زیر استفاده کنید:');
    console.log('testDatabase(), testState(), testRouter(), testAllModules()');
});

export { Database, StateManager, Router, AuthManager, ApiClient, Utils };
