
// ==================== page_home.js ====================
// HyperLang - صفحه اصلی (Professional Enterprise Version)
// وابستگی‌ها: CORE_state.js, CORE_db.js, CORE_router.js, MODULES_auth.js

import AppState from './CORE_state.js';
import Database from './CORE_db.js';
import Router from './CORE_router.js';
import Auth from './MODULES_auth.js';

class HomePage {
    constructor() {
        // ثبت در سیستم رویداد
        this.eventId = null;
        this.isMounted = false;
        
        // عناصر DOM
        this.elements = {
            container: null,
            userSection: null,
            statsSection: null,
            lessonsSection: null,
            loadingIndicator: null,
            errorDisplay: null
        };
        
        // داده‌های صفحه
        this.pageData = {
            user: null,
            stats: null,
            recentLessons: [],
            dailyGoal: { target: 30, completed: 0 }
        };
        
        // تنظیمات
        this.config = {
            maxRecentLessons: 5,
            refreshInterval: 30000, // 30 ثانیه
            animationSpeed: 300
        };
        
        // Bind methods
        this.init = this.init.bind(this);
        this.render = this.render.bind(this);
        this.updateUserData = this.updateUserData.bind(this);
        this.handleLessonClick = this.handleLessonClick.bind(this);
        this.handleLogout = this.handleLogout.bind(this);
        this.cleanup = this.cleanup.bind(this);
    }
    
    // ==================== INITIALIZATION ====================
    async init(containerId = 'app-content') {
        try {
            // 1. بررسی احراز هویت
            if (!Auth.isAuthenticated()) {
                Router.navigateTo('/login');
                return false;
            }
            
            // 2. ذخیره کانتینر
            this.elements.container = document.getElementById(containerId);
            if (!this.elements.container) {
                throw new Error(`Container #${containerId} not found`);
            }
            
            // 3. دریافت داده‌های اولیه
            await this.loadInitialData();
            
            // 4. رندر اولیه
            this.render();
            
            // 5. ثبت Event Listeners
            this.registerEventListeners();
            
            // 6. راه‌اندازی Auto-refresh
            this.setupAutoRefresh();
            
            // 7. ثبت در سیستم رویداد برای تغییرات وضعیت
            this.eventId = AppState.subscribe('user:updated', this.updateUserData);
            
            this.isMounted = true;
            console.log('[HomePage] ✅ Initialized successfully');
            
            // گزارش تحلیل
            this.trackPageView();
            
            return true;
            
        } catch (error) {
            console.error('[HomePage] ❌ Initialization failed:', error);
            this.showError(error.message);
            return false;
        }
    }
    
    // ==================== DATA MANAGEMENT ====================
    async loadInitialData() {
        // نمایش loading
        this.showLoading();
        
        try {
            // دریافت داده به صورت موازی
            const [userData, userStats, lessons] = await Promise.all([
                this.fetchUserData(),
                this.fetchUserStats(),
                this.fetchRecentLessons()
            ]);
            
            // به‌روزرسانی داده‌های صفحه
            this.pageData = {
                user: userData,
                stats: userStats,
                recentLessons: lessons.slice(0, this.config.maxRecentLessons),
                dailyGoal: {
                    target: userData.dailyGoal || 30,
                    completed: userStats.todayMinutes || 0
                }
            };
            
            // به‌روزرسانی State
            AppState.update({ 
                currentUser: userData,
                homeDataLoaded: true 
            });
            
        } catch (error) {
            console.error('[HomePage] Data loading error:', error);
            throw new Error(`Failed to load data: ${error.message}`);
        } finally {
            this.hideLoading();
        }
    }
    
    async fetchUserData() {
        const userId = AppState.getCurrentUserId();
        if (!userId) throw new Error('User not authenticated');
        
        const user = await Database.getUserById(userId);
        if (!user) throw new Error('User data not found');
        
        return {
            id: user.id,
            name: user.displayName || user.email.split('@')[0],
            email: user.email,
            avatar: user.avatar || this.generateDefaultAvatar(user.id),
            level: user.level || 'beginner',
            streak: user.streakDays || 0,
            joinDate: user.createdAt,
            settings: user.settings || {}
        };
    }
    
    async fetchUserStats() {
        const userId = AppState.getCurrentUserId();
        const stats = await Database.getUserStats(userId);
        
        return {
            totalLessons: stats?.totalLessons || 0,
            completedLessons: stats?.completedLessons || 0,
            totalMinutes: stats?.totalMinutes || 0,
            todayMinutes: stats?.todayMinutes || 0,
            accuracy: stats?.accuracy || 0,
            rank: stats?.rank || 'Newbie',
            nextMilestone: stats?.nextMilestone || 10
        };
    }
    
    async fetchRecentLessons() {
        const userId = AppState.getCurrentUserId();
        const progress = await Database.getUserProgress(userId);
        
        // دریافت درس‌های اخیراً باز شده یا در حال انجام
        const recent = progress
            .filter(p => p.lastAccessed)
            .sort((a, b) => new Date(b.lastAccessed) - new Date(a.lastAccessed))
            .slice(0, 10);
        
        // دریافت جزئیات هر درس
        const lessonPromises = recent.map(async (progressItem) => {
            const lesson = await Database.getLessonById(progressItem.lessonId);
            return {
                id: lesson.id,
                title: lesson.title,
                language: lesson.language,
                level: lesson.level,
                duration: lesson.duration,
                progress: progressItem.progress || 0,
                lastAccessed: progressItem.lastAccessed,
                thumbnail: lesson.thumbnail || this.generateLessonThumbnail(lesson.id)
            };
        });
        
        return await Promise.all(lessonPromises);
    }
    
    // ==================== RENDERING ====================
    render() {
        if (!this.elements.container || !this.pageData.user) return;
        
        this.elements.container.innerHTML = this.generateHTML();
        this.cacheDOMElements();
        
        // انیمیشن ظاهر شدن
        setTimeout(() => {
            this.elements.container.style.opacity = 1;
        }, 50);
    }
    
    generateHTML() {
        const { user, stats, recentLessons, dailyGoal } = this.pageData;
        const progressPercent = Math.min(100, (dailyGoal.completed / dailyGoal.target) * 100);
        
        return `
            <div class="home-page" style="opacity: 0; transition: opacity 0.3s ease;">
                <!-- HEADER -->
                <header class="home-header">
                    <div class="user-welcome">
                        <img src="${user.avatar}" alt="${user.name}" class="user-avatar">
                        <div class="user-info">
                            <h1 class="welcome-text">سلام ${user.name}!</h1>
                            <p class="user-level">
                                <span class="level-badge">سطح ${user.level}</span>
                                <span class="streak">🔥 ${user.streak} روز متوالی</span>
                            </p>
                        </div>
                    </div>
                    <button class="logout-btn" aria-label="خروج">
                        <i class="icon-logout"></i>
                    </button>
                </header>
                
                <!-- STATS CARDS -->
                <section class="stats-section">
                    <div class="stat-card primary">
                        <h3>درس‌های امروز</h3>
                        <p class="stat-value">${stats.todayMinutes} دقیقه</p>
                        <div class="progress-bar">
                            <div class="progress-fill" style="width: ${progressPercent}%"></div>
                        </div>
                        <p class="stat-sub">${dailyGoal.completed} از ${dailyGoal.target} دقیقه هدف</p>
                    </div>
                    
                    <div class="stat-card">
                        <h3>درصد دقت</h3>
                        <p class="stat-value">${stats.accuracy}%</p>
                        <p class="stat-sub">پاسخ‌های صحیح</p>
                    </div>
                    
                    <div class="stat-card">
                        <h3>رتبه شما</h3>
                        <p class="stat-value">${stats.rank}</p>
                        <p class="stat-sub">${stats.nextMilestone} دقیقه تا سطح بعدی</p>
                    </div>
                </section>
                
                <!-- RECENT LESSONS -->
                <section class="lessons-section">
                    <div class="section-header">
                        <h2>ادامه یادگیری</h2>
                        <a href="/library" class="view-all">مشاهده همه</a>
                    </div>
                    
                    <div class="lessons-grid">
                        ${recentLessons.length > 0 
                            ? recentLessons.map(lesson => this.generateLessonCard(lesson)).join('')
                            : `<div class="empty-state">
                                <p>هنوز درسی شروع نکرده‌اید!</p>
                                <button class="btn-primary" id="start-learning">شروع اولین درس</button>
                               </div>`
                        }
                    </div>
                </section>
                
                <!-- QUICK ACTIONS -->
                <section class="quick-actions">
                    <button class="action-btn" data-action="practice">
                        <i class="icon-practice"></i>
                        <span>تمرین سریع</span>
                    </button>
                    <button class="action-btn" data-action="review">
                        <i class="icon-review"></i>
                        <span>مرور واژگان</span>
                    </button>
                    <button class="action-btn" data-action="challenge">
                        <i class="icon-challenge"></i>
                        <span>چالش روزانه</span>
                    </button>
                </section>
                
                <!-- LOADING INDICATOR -->
                <div class="loading-indicator" id="home-loading" style="display: none;">
                    <div class="spinner"></div>
                    <p>در حال دریافت داده‌ها...</p>
                </div>
                
                <!-- ERROR DISPLAY -->
                <div class="error-display" id="home-error" style="display: none;"></div>
            </div>
        `;
    }
    
    generateLessonCard(lesson) {
        const progressWidth = lesson.progress * 100;
        
        return `
            <div class="lesson-card" data-lesson-id="${lesson.id}">
                <div class="lesson-thumbnail">
                    <img src="${lesson.thumbnail}" alt="${lesson.title}">
                    <span class="language-tag">${lesson.language}</span>
                </div>
                <div class="lesson-info">
                    <h3 class="lesson-title">${lesson.title}</h3>
                    <div class="lesson-meta">
                        <span class="level">${lesson.level}</span>
                        <span class="duration">⏱️ ${lesson.duration} دقیقه</span>
                    </div>
                    <div class="lesson-progress">
                        <div class="progress-bar">
                            <div class="progress-fill" style="width: ${progressWidth}%"></div>
                        </div>
                        <span class="progress-text">${Math.round(lesson.progress * 100)}% کامل</span>
                    </div>
                    <button class="resume-btn" data-lesson-id="${lesson.id}">
                        ${lesson.progress > 0 ? 'ادامه' : 'شروع'}
                    </button>
                </div>
            </div>
        `;
    }
    
    // ==================== EVENT HANDLING ====================
    registerEventListeners() {
        // Logout
        const logoutBtn = this.elements.container?.querySelector('.logout-btn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', this.handleLogout);
        }
        
        // Lesson clicks
        const resumeBtns = this.elements.container?.querySelectorAll('.resume-btn');
        resumeBtns?.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const lessonId = e.target.dataset.lessonId;
                this.handleLessonClick(lessonId);
            });
        });
        
        // Quick actions
        const actionBtns = this.elements.container?.querySelectorAll('.action-btn');
        actionBtns?.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const action = e.target.closest('.action-btn').dataset.action;
                this.handleQuickAction(action);
            });
        });
        
        // Start learning button
        const startBtn = this.elements.container?.querySelector('#start-learning');
        if (startBtn) {
            startBtn.addEventListener('click', () => Router.navigateTo('/library'));
        }
        
        // Window events
        window.addEventListener('online', this.handleOnlineStatus.bind(this));
        window.addEventListener('offline', this.handleOnlineStatus.bind(this));
    }
    
    handleLessonClick(lessonId) {
        if (!lessonId) return;
        
        // ثبت تحلیل
        this.trackEvent('lesson_selected', { lessonId });
        
        // ناوبری به صفحه درس
        Router.navigateTo(`/lesson/${lessonId}`);
    }
    
    handleLogout() {
        if (confirm('آیا مطمئن هستید که می‌خواهید خارج شوید؟')) {
            Auth.logout()
                .then(() => {
                    Router.navigateTo('/login');
                })
                .catch(error => {
                    console.error('Logout failed:', error);
                    this.showError('خطا در خروج از سیستم');
                });
        }
    }
    
    handleQuickAction(action) {
        const actions = {
            practice: () => Router.navigateTo('/practice'),
            review: () => Router.navigateTo('/review'),
            challenge: () => Router.navigateTo('/challenge')
        };
        
        if (actions[action]) {
            this.trackEvent('quick_action', { action });
            actions[action]();
        }
    }
    
    handleOnlineStatus() {
        const isOnline = navigator.onLine;
        const statusEl = document.createElement('div');
        statusEl.className = `network-status ${isOnline ? 'online' : 'offline'}`;
        statusEl.textContent = isOnline ? 'اتصال اینترنت برقرار است' : 'شما آفلاین هستید';
        
        // نمایش موقت وضعیت شبکه
        document.body.appendChild(statusEl);
        setTimeout(() => statusEl.remove(), 3000);
    }
    
    // ==================== UTILITY METHODS ====================
    cacheDOMElements() {
        this.elements.userSection = this.elements.container.querySelector('.user-welcome');
        this.elements.statsSection = this.elements.container.querySelector('.stats-section');
        this.elements.lessonsSection = this.elements.container.querySelector('.lessons-section');
        this.elements.loadingIndicator = this.elements.container.querySelector('#home-loading');
        this.elements.errorDisplay = this.elements.container.querySelector('#home-error');
    }
    
    showLoading() {
        if (this.elements.loadingIndicator) {
            this.elements.loadingIndicator.style.display = 'flex';
        }
    }
    
    hideLoading() {
        if (this.elements.loadingIndicator) {
            this.elements.loadingIndicator.style.display = 'none';
        }
    }
    
    showError(message) {
        if (this.elements.errorDisplay) {
            this.elements.errorDisplay.textContent = message;
            this.elements.errorDisplay.style.display = 'block';
            
            // پنهان کردن خودکار بعد از 5 ثانیه
            setTimeout(() => {
                this.elements.errorDisplay.style.display = 'none';
            }, 5000);
        }
    }
    
    updateUserData(eventData) {
        if (eventData?.user) {
            this.pageData.user = { ...this.pageData.user, ...eventData.user };
            this.updateUserDisplay();
        }
    }
    
    updateUserDisplay() {
        if (!this.elements.userSection || !this.pageData.user) return;
        
        const nameEl = this.elements.userSection.querySelector('.welcome-text');
        const avatarEl = this.elements.userSection.querySelector('.user-avatar');
        const streakEl = this.elements.userSection.querySelector('.streak');
        
        if (nameEl) nameEl.textContent = `سلام ${this.pageData.user.name}!`;
        if (avatarEl) avatarEl.src = this.pageData.user.avatar;
        if (streakEl) streakEl.textContent = `🔥 ${this.pageData.user.streak} روز متوالی`;
    }
    
    setupAutoRefresh() {
        // Refresh data every 30 seconds
        this.refreshInterval = setInterval(() => {
            if (document.visibilityState === 'visible') {
                this.loadInitialData().then(() => this.render());
            }
        }, this.config.refreshInterval);
    }
    
    generateDefaultAvatar(userId) {
        // ایجاد آواتار بر اساس ID کاربر
        const colors = ['#1a237e', '#3949ab', '#00b0ff', '#2962ff'];
        const colorIndex = parseInt(userId, 16) % colors.length;
        return `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="${colors[colorIndex]}"/><text x="50" y="60" font-size="40" text-anchor="middle" fill="white">${this.pageData.user?.name?.charAt(0) || 'U'}</text></svg>`;
    }
    
    generateLessonThumbnail(lessonId) {
        // ایجاد تصویر ساده برای درس
        const languages = {
            en: '#1976d2', fa: '#d32f2f', ar: '#388e3c', 
            tr: '#7b1fa2', de: '#f57c00', es: '#0288d1'
        };
        const lang = lessonId.substring(0, 2);
        const color = languages[lang] || '#607d8b';
        
        return `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 120"><rect width="200" height="120" fill="${color}" opacity="0.8"/><text x="100" y="70" font-size="24" text-anchor="middle" fill="white">${lang.toUpperCase()}</text></svg>`;
    }
    
    // ==================== ANALYTICS ====================
    trackPageView() {
        if (typeof window.trackAnalytics === 'function') {
            window.trackAnalytics('page_view', {
                page: 'home',
                userId: this.pageData.user?.id,
                timestamp: new Date().toISOString()
            });
        }
    }
    
    trackEvent(eventName, properties = {}) {
        if (typeof window.trackAnalytics === 'function') {
            window.trackAnalytics(eventName, {
                ...properties,
                page: 'home',
                userId: this.pageData.user?.id
            });
        }
    }
    
    // ==================== CLEANUP ====================
    cleanup() {
        if (!this.isMounted) return;
        
        // حذف event listeners
        const logoutBtn = this.elements.container?.querySelector('.logout-btn');
        if (logoutBtn) {
            logoutBtn.removeEventListener('click', this.handleLogout);
        }
        
        // توقف auto-refresh
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
        }
        
        // لغو اشتراک از state
        if (this.eventId) {
            AppState.unsubscribe(this.eventId);
        }
        
        // حذف رویدادهای window
        window.removeEventListener('online', this.handleOnlineStatus);
        window.removeEventListener('offline', this.handleOnlineStatus);
        
        // پاکسازی DOM
        if (this.elements.container) {
            this.elements.container.innerHTML = '';
        }
        
        this.isMounted = false;
        console.log('[HomePage] 🧹 Cleaned up');
    }
}

// ایجاد Singleton instance
const HomePageInstance = new HomePage();

// Export برای استفاده در Router
export default HomePageInstance;

// Auto-initialization اگر مستقیماً لود شود
if (import.meta.url === document.currentScript?.src) {
    document.addEventListener('DOMContentLoaded', () => {
        HomePageInstance.init();
    });
                                 }
