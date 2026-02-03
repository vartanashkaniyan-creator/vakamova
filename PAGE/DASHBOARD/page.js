g/**
 * 📊 Dashboard Page - صفحه اصلی داشبورد کاربر (Vakamova)
 * اصول: تزریق وابستگی، قرارداد رابط، رویدادمحور، پیکربندی متمرکز
 * مسیر: pages/dashboard/page.js
 */

class DashboardPage {
    constructor(services = {}) {
        // ==================== تزریق وابستگی ====================
        this.eventBus = services.eventBus || window.eventBus;
        this.stateManager = services.stateManager || window.stateManager;
        this.authManager = services.authManager || window.auth_manager;
        this.lessonEngine = services.lessonEngine || window.lesson_engine;
        this.router = services.router || window.router;
        
        this._validateServices();
        
        // ==================== پیکربندی متمرکز ====================
        this.config = Object.freeze({
            refreshInterval: services.config?.refreshInterval || 45000,
            maxActivities: services.config?.maxActivities || 10,
            chartAnimation: services.config?.chartAnimation || true,
            language: services.config?.language || 'fa',
            modules: services.config?.modules || [
                'stats', 'recent_lessons', 'daily_goal', 
                'streak', 'leaderboard', 'quick_actions'
            ],
            colors: {
                primary: '#1a237e',
                secondary: '#311b92',
                success: '#4caf50',
                warning: '#ff9800',
                danger: '#f44336',
                ...services.config?.colors
            },
            ...services.config
        });
        
        // ==================== وضعیت داخلی ====================
        this.container = null;
        this.isMounted = false;
        this.components = new Map();
        this.subscriptions = new Map();
        this.data = {
            user: null,
            stats: null,
            lessons: [],
            activities: [],
            goals: {},
            leaderboard: []
        };
        
        // ==================== رویدادهای استاندارد (قرارداد رابط) ====================
        this.EVENTS = {
            DASHBOARD_LOADED: 'dashboard:loaded',
            DASHBOARD_UPDATED: 'dashboard:updated',
            MODULE_SELECTED: 'dashboard:module:selected',
            QUICK_ACTION_TRIGGERED: 'dashboard:quick_action:triggered',
            ERROR: 'dashboard:error'
        };
        
        // ==================== راه‌اندازی اولیه ====================
        this._initialize();
        
        console.log('[Dashboard] ✅ صفحه با پیکربندی:', this.config);
    }
    
    // ==================== قرارداد رابط عمومی ====================
    
    async init(containerId = 'app-content') {
        try {
            if (this.isMounted) {
                console.warn('[Dashboard] قبلاً mount شده است');
                return this;
            }
            
            // بررسی احراز هویت
            if (!await this._checkAuthentication()) {
                this.eventBus.emit(this.EVENTS.ERROR, {
                    type: 'auth_required',
                    message: 'نیاز به ورود به سیستم'
                });
                return this;
            }
            
            // یافتن کانتینر
            this.container = document.getElementById(containerId);
            if (!this.container) {
                throw new Error(`کانتینر #${containerId} یافت نشد`);
            }
            
            // بارگذاری داده‌ها
            await this._loadAllData();
            
            // رندر داشبورد
            this._render();
            
            // راه‌اندازی سیستم‌های جانبی
            this._setupEventListeners();
            this._setupAutoRefresh();
            this._setupRealTimeUpdates();
            
            this.isMounted = true;
            
            // انتشار رویداد موفقیت‌آمیز
            this.eventBus.emit(this.EVENTS.DASHBOARD_LOADED, {
                user: this.data.user,
                stats: this.data.stats,
                timestamp: new Date().toISOString()
            });
            
            console.log('[Dashboard] 🎯 صفحه در', containerId, 'مونت شد');
            return this;
            
        } catch (error) {
            this._handleError(error, 'init');
            throw error;
        }
    }
    
    async refresh(force = false) {
        if (!this.isMounted) return;
        
        try {
            // نشانگر بارگذاری
            this._showLoading();
            
            // بارگذاری مجدد داده‌ها
            await this._loadAllData(force);
            
            // به‌روزرسانی UI
            this._updateDashboard();
            
            // انتشار رویداد
            this.eventBus.emit(this.EVENTS.DASHBOARD_UPDATED, {
                type: force ? 'force_refresh' : 'auto_refresh',
                timestamp: new Date().toISOString(),
                data: this.data
            });
            
        } catch (error) {
            this._handleError(error, 'refresh');
        } finally {
            this._hideLoading();
        }
    }
    
    destroy() {
        // توقف intervalها
        this._cleanupIntervals();
        
        // لغو اشتراک‌ها
        this._unsubscribeAll();
        
        // تخریب کامپوننت‌ها
        this.components.forEach(comp => {
            if (comp.destroy) comp.destroy();
        });
        this.components.clear();
        
        // پاک‌سازی DOM
        if (this.container && this.isMounted) {
            this.container.innerHTML = '';
            this.container = null;
        }
        
        this.isMounted = false;
        console.log('[Dashboard] 🧹 صفحه destroy شد');
    }
    
    getData() {
        return { ...this.data };
    }
    
    getModule(moduleName) {
        return this.components.get(moduleName);
    }
    
    // ==================== متدهای اصلی داخلی ====================
    
    _validateServices() {
        const requiredServices = [
            { name: 'eventBus', instance: this.eventBus },
            { name: 'stateManager', instance: this.stateManager },
            { name: 'authManager', instance: this.authManager }
        ];
        
        requiredServices.forEach(service => {
            if (!service.instance) {
                throw new Error(`سرویس ${service.name} ارائه نشده است`);
            }
        });
    }
    
    _initialize() {
        // تنظیم state پیش‌فرض
        this.stateManager.set('dashboard.initialized', false);
        this.stateManager.set('dashboard.lastUpdate', null);
        
        // ثبت در context provider (اگر موجود باشد)
        if (window.context && window.context.register) {
            window.context.register('dashboard', this);
        }
    }
    
    async _checkAuthentication() {
        try {
            const isAuthenticated = await this.authManager.isAuthenticated();
            
            if (!isAuthenticated) {
                // هدایت به صفحه ورود
                if (this.router && this.router.navigateTo) {
                    this.router.navigateTo('/login');
                } else {
                    window.location.hash = '#/login';
                }
                return false;
            }
            
            return true;
        } catch (error) {
            console.error('[Dashboard] خطا در بررسی احراز هویت:', error);
            return false;
        }
    }
    
    async _loadAllData(force = false) {
        try {
            // بارگذاری موازی داده‌ها
            const [
                userData,
                statsData,
                lessonsData,
                activitiesData,
                goalsData,
                leaderboardData
            ] = await Promise.allSettled([
                this._loadUserData(force),
                this._loadStatsData(force),
                this._loadRecentLessons(force),
                this._loadRecentActivities(force),
                this._loadDailyGoals(force),
                this._loadLeaderboard(force)
            ]);
            
            // به‌روزرسانی داده‌ها
            this.data = {
                user: userData.status === 'fulfilled' ? userData.value : this.data.user,
                stats: statsData.status === 'fulfilled' ? statsData.value : this.data.stats,
                lessons: lessonsData.status === 'fulfilled' ? lessonsData.value : this.data.lessons,
                activities: activitiesData.status === 'fulfilled' ? activitiesData.value : this.data.activities,
                goals: goalsData.status === 'fulfilled' ? goalsData.value : this.data.goals,
                leaderboard: leaderboardData.status === 'fulfilled' ? leaderboardData.value : this.data.leaderboard,
                lastUpdated: new Date().toISOString()
            };
            
            // به‌روزرسانی state manager
            this.stateManager.set('dashboard.data', this.data);
            this.stateManager.set('dashboard.lastUpdate', this.data.lastUpdated);
            this.stateManager.set('dashboard.initialized', true);
            
            console.log('[Dashboard] داده‌ها با موفقیت بارگذاری شدند');
            
        } catch (error) {
            throw new Error(`خطا در بارگذاری داده‌ها: ${error.message}`);
        }
    }
    
    async _loadUserData(force = false) {
        // اول از state manager بررسی کن
        const cached = this.stateManager.get('user.profile');
        if (cached && !force) {
            return cached;
        }
        
        // در غیر این صورت از auth manager بگیر
        const user = await this.authManager.getCurrentUser();
        
        if (user) {
            this.stateManager.set('user.profile', user);
        }
        
        return user || {
            id: 'guest',
            name: 'کاربر مهمان',
            email: '',
            avatar: null,
            level: 'beginner',
            joinDate: new Date().toISOString()
        };
    }
    
    async _loadStatsData(force = false) {
        const cached = this.stateManager.get('user.stats');
        if (cached && !force) {
            return cached;
        }
        
        // شبیه‌سازی دریافت آمار
        return new Promise(resolve => {
            setTimeout(() => {
                const stats = {
                    totalLessons: Math.floor(Math.random() * 100) + 20,
                    completedLessons: Math.floor(Math.random() * 80) + 10,
                    totalMinutes: Math.floor(Math.random() * 5000) + 1000,
                    todayMinutes: Math.floor(Math.random() * 120) + 10,
                    accuracy: Math.floor(Math.random() * 30) + 70,
                    streak: Math.floor(Math.random() * 30) + 1,
                    rank: 'شاگرد نمونه',
                    level: 'intermediate',
                    levelProgress: Math.floor(Math.random() * 100)
                };
                
                this.stateManager.set('user.stats', stats);
                resolve(stats);
            }, 300);
        });
    }
    
    async _loadRecentLessons(force = false) {
        if (!this.lessonEngine) return [];
        
        try {
            const lessons = await this.lessonEngine.getRecentLessons(5);
            return lessons || [];
        } catch (error) {
            console.warn('[Dashboard] خطا در دریافت درس‌های اخیر:', error);
            return [];
        }
    }
    
    async _loadRecentActivities(force = false) {
        // شبیه‌سازی فعالیت‌های اخیر
        const activities = [
            { id: 1, type: 'lesson_completed', title: 'درس مکالمه انگلیسی', time: '۲ ساعت پیش', score: 95 },
            { id: 2, type: 'quiz_passed', title: 'آزمون واژگان', time: '۵ ساعت پیش', score: 88 },
            { id: 3, type: 'streak_extended', title: '۱۲ روز متوالی', time: 'دیروز', score: null },
            { id: 4, type: 'level_up', title: 'ارتقاء به سطح متوسط', time: '۲ روز پیش', score: null },
            { id: 5, type: 'badge_earned', title: 'نشان مطالعه سریع', time: '۳ روز پیش', score: null }
        ];
        
        return activities.slice(0, this.config.maxActivities);
    }
    
    async _loadDailyGoals(force = false) {
        return {
            targetMinutes: 30,
            completedMinutes: Math.floor(Math.random() * 35),
            targetLessons: 3,
            completedLessons: Math.floor(Math.random() * 4),
            weeklyTarget: 150,
            weeklyCompleted: Math.floor(Math.random() * 160)
        };
    }
    
    async _loadLeaderboard(force = false) {
        // شبیه‌سازی جدول رده‌بندی
        return [
            { rank: 1, name: 'علی محمدی', score: 2450, isCurrentUser: false },
            { rank: 2, name: 'سارا احمدی', score: 2180, isCurrentUser: false },
            { rank: 3, name: 'محمد حسینی', score: 1950, isCurrentUser: true },
            { rank: 4, name: 'فاطمه کریمی', score: 1820, isCurrentUser: false },
            { rank: 5, name: 'رضا نجفی', score: 1750, isCurrentUser: false }
        ];
    }
    
    // ==================== رندرینگ ====================
    
    _render() {
        if (!this.container) return;
        
        const { user, stats } = this.data;
        
        this.container.innerHTML = `
            <div class="dashboard-container" style="${this._getContainerStyles()}">
                <!-- هدر داشبورد -->
                <header class="dashboard-header">
                    <div class="user-welcome">
                        <div class="user-avatar" style="${this._getAvatarStyles()}">
                            ${user.name.charAt(0)}
                        </div>
                        <div class="user-info">
                            <h1 class="welcome-text">سلام ${user.name} 👋</h1>
                            <p class="user-subtitle">
                                <span class="user-level">سطح ${user.level}</span>
                                <span class="user-rank">${stats.rank}</span>
                            </p>
                        </div>
                    </div>
                    <div class="header-actions">
                        <button class="header-btn refresh-btn" data-action="refresh">
                            🔄 به‌روزرسانی
                        </button>
                        <button class="header-btn settings-btn" data-action="settings">
                            ⚙️ تنظیمات
                        </button>
                    </div>
                </header>
                
                <!-- شبکه ماژول‌ها -->
                <div class="dashboard-grid">
                    ${this._renderModule('stats', '📊 آمار کلی')}
                    ${this._renderModule('daily_goal', '🎯 هدف روزانه')}
                    ${this._renderModule('recent_lessons', '📚 درس‌های اخیر')}
                    ${this._renderModule('streak', '🔥 روزهای متوالی')}
                    ${this._renderModule('leaderboard', '🏆 جدول رده‌بندی')}
                    ${this._renderModule('quick_actions', '⚡ اقدامات سریع')}
                </div>
                
                <!-- فید فعالیت‌ها -->
                <section class="activities-section">
                    <h2 class="section-title">📝 فعالیت‌های اخیر</h2>
                    <div class="activities-list" id="activities-list">
                        ${this._renderActivities()}
                    </div>
                </section>
                
                <!-- نشانگر بارگذاری -->
                <div class="dashboard-loader" id="dashboard-loader" style="display: none;">
                    <div class="loader-spinner"></div>
                    <p>در حال به‌روزرسانی...</p>
                </div>
            </div>
        `;
        
        // پر کردن ماژول‌ها با داده‌های واقعی
        this._populateModules();
        
        // اضافه کردن event listeners
        this._attachEventListeners();
    }
    
    _renderModule(moduleId, title) {
        const moduleConfig = {
            stats: { cols: 2, rows: 1, color: this.config.colors.primary },
            daily_goal: { cols: 1, rows: 1, color: this.config.colors.success },
            recent_lessons: { cols: 1, rows: 2, color: this.config.colors.secondary },
            streak: { cols: 1, rows: 1, color: this.config.colors.warning },
            leaderboard: { cols: 1, rows: 2, color: this.config.colors.primary },
            quick_actions: { cols: 1, rows: 1, color: this.config.colors.secondary }
        };
        
        const config = moduleConfig[moduleId] || { cols: 1, rows: 1, color: this.config.colors.primary };
        
        return `
            <div class="dashboard-module" 
                 data-module="${moduleId}"
                 style="grid-column: span ${config.cols}; grid-row: span ${config.rows};">
                <div class="module-header">
                    <h3 class="module-title">${title}</h3>
                    <button class="module-more" data-module="${moduleId}">
                        ⋮
                    </button>
                </div>
                <div class="module-content" id="module-${moduleId}">
                    <div class="module-loading">
                        <div class="loading-spinner"></div>
                    </div>
                </div>
            </div>
        `;
    }
    
    _populateModules() {
        // ماژول آمار کلی
        this._renderStatsModule();
        
        // ماژول هدف روزانه
        this._renderDailyGoalModule();
        
        // ماژول درس‌های اخیر
        this._renderRecentLessonsModule();
        
        // ماژول روزهای متوالی
        this._renderStreakModule();
        
        // ماژول جدول رده‌بندی
        this._renderLeaderboardModule();
        
        // ماژول اقدامات سریع
        this._renderQuickActionsModule();
    }
    
    _renderStatsModule() {
        const module = document.getElementById('module-stats');
        if (!module || !this.data.stats) return;
        
        const { stats } = this.data;
        
        module.innerHTML = `
            <div class="stats-grid">
                <div class="stat-item">
                    <div class="stat-value">${stats.completedLessons}</div>
                    <div class="stat-label">درس تکمیل‌شده</div>
                    <div class="stat-total">از ${stats.totalLessons}</div>
                </div>
                <div class="stat-item">
                    <div class="stat-value">${stats.todayMinutes}</div>
                    <div class="stat-label">دقیقه امروز</div>
                    <div class="stat-total">هدف: ۳۰ دقیقه</div>
                </div>
                <div class="stat-item">
                    <div class="stat-value">${stats.accuracy}%</div>
                    <div class="stat-label">میانگین دقت</div>
                    <div class="stat-trend ${stats.accuracy > 75 ? 'up' : 'down'}">
                        ${stats.accuracy > 75 ? '↑' : '↓'} ۲%
                    </div>
                </div>
                <div class="stat-item">
                    <div class="stat-value">${stats.streak}</div>
                    <div class="stat-label">روز متوالی</div>
                    <div class="stat-total">رکورد: ۴۵ روز</div>
                </div>
            </div>
            <div class="level-progress">
                <div class="progress-label">
                    <span>پیشرفت سطح</span>
                    <span>${stats.levelProgress}%</span>
                </div>
                <div class="progress-bar">
                    <div class="progress-fill" style="width: ${stats.levelProgress}%"></div>
                </div>
            </div>
        `;
    }
    
    _renderDailyGoalModule() {
        const module = document.getElementById('module-daily_goal');
        if (!module || !this.data.goals) return;
        
        const { goals } = this.data;
        const minutesPercent = Math.min(100, (goals.completedMinutes / goals.targetMinutes) * 100);
        const lessonsPercent = Math.min(100, (goals.completedLessons / goals.targetLessons) * 100);
        
        module.innerHTML = `
            <div class="goal-container">
                <div class="goal-item">
                    <div class="goal-icon">⏱️</div>
                    <div class="goal-details">
                        <div class="goal-title">دقیقه مطالعه</div>
                        <div class="goal-progress">
                            <div class="progress-bar">
                                <div class="progress-fill" style="width: ${minutesPercent}%"></div>
                            </div>
                            <div class="goal-numbers">
                                ${goals.completedMinutes} از ${goals.targetMinutes}
                            </div>
                        </div>
                    </div>
                </div>
                <div class="goal-item">
                    <div class="goal-icon">📚</div>
                    <div class="goal-details">
                        <div class="goal-title">تعداد درس‌ها</div>
                        <div class="goal-progress">
                            <div class="progress-bar">
                                <div class="progress-fill" style="width: ${lessonsPercent}%"></div>
                            </div>
                            <div class="goal-numbers">
                                ${goals.completedLessons} از ${goals.targetLessons}
                            </div>
                        </div>
                    </div>
                </div>
                <div class="goal-motivation">
                    ${minutesPercent >= 100 ? '🎉 عالی! امروزت رو قورت دادی!' :
                      minutesPercent >= 75 ? '🔥 داری نزدیک می‌شی!' :
                      '💪 ادامه بده، می‌تونی انجامش بدی!'}
                </div>
            </div>
        `;
    }
    
    _renderRecentLessonsModule() {
        const module = document.getElementById('module-recent_lessons');
        if (!module || !this.data.lessons || this.data.lessons.length === 0) return;
        
        const lessonsHTML = this.data.lessons.slice(0, 3).map(lesson => `
            <div class="lesson-item" data-lesson-id="${lesson.id}">
                <div class="lesson-icon">${lesson.language === 'en' ? '🇬🇧' : '🇮🇷'}</div>
                <div class="lesson-details">
                    <div class="lesson-title">${lesson.title}</div>
                    <div class="lesson-meta">
                        <span class="lesson-level">${lesson.level}</span>
                        <span class="lesson-progress">${lesson.progress || 0}%</span>
                    </div>
                </div>
                <button class="lesson-resume" data-lesson-id="${lesson.id}">
                    ادامه
                </button>
            </div>
        `).join('');
        
        module.innerHTML = lessonsHTML || `
            <div class="empty-state">
                <div class="empty-icon">📚</div>
                <p>هنوز درسی شروع نکرده‌اید</p>
                <button class="empty-action" data-action="start_learning">
                    شروع اولین درس
                </button>
            </div>
        `;
    }
    
    _renderStreakModule() {
        const module = document.getElementById('module-streak');
        if (!module || !this.data.stats) return;
        
        const { streak } = this.data.stats;
        const flameSize = streak < 7 ? 'small' : streak < 30 ? 'medium' : 'large';
        
        module.innerHTML = `
            <div class="streak-container">
                <div class="streak-visual ${flameSize}">
                    🔥
                    <div class="streak-count">${streak}</div>
                </div>
                <div class="streak-info">
                    <div class="streak-title">روز متوالی یادگیری</div>
                    <div class="streak-message">
                        ${streak >= 30 ? '🔥 افسانه‌ای! رکوردشکنی ادامه دار!' :
                          streak >= 7 ? '🚀 عالی! یک هفته کامل!' :
                          '💪 خوبه! ادامه بده تا هفته رو کامل کنی!'}
                    </div>
                    <div class="streak-next">
                        ${streak === 7 ? '🎁 فردا جایزه هفتگی می‌گیری!' :
                          `فقط ${7 - (streak % 7)} روز دیگه تا جایزه هفتگی`}
                    </div>
                </div>
            </div>
        `;
    }
    
    _renderLeaderboardModule() {
        const module = document.getElementById('module-leaderboard');
        if (!module || !this.data.leaderboard) return;
        
        const leaderboardHTML = this.data.leaderboard.map(user => `
            <div class="leaderboard-item ${user.isCurrentUser ? 'current-user' : ''}">
                <div class="leaderboard-rank">${user.rank}</div>
                <div class="leaderboard-avatar">
                    ${user.name.charAt(0)}
                </div>
                <div class="leaderboard-details">
                    <div class="leaderboard-name">${user.name}</div>
                    <div class="leaderboard-score">${user.score} امتیاز</div>
                </div>
                ${user.rank <= 3 ? 
                    `<div class="leaderboard-medal">${user.rank === 1 ? '🥇' : user.rank === 2 ? '🥈' : '🥉'}</div>` : 
                    ''}
            </div>
        `).join('');
        
        module.innerHTML = leaderboardHTML;
    }
    
    _renderQuickActionsModule() {
        const module = document.getElementById('module-quick_actions');
        if (!module) return;
        
        module.innerHTML = `
            <div class="quick-actions-grid">
                <button class="quick-action" data-action="practice">
                    <div class="action-icon">💪</div>
                    <div class="action-label">تمرین سریع</div>
                </button>
                <button class="quick-action" data-action="review">
                    <div class="action-icon">🔄</div>
                    <div class="action-label">مرور واژگان</div>
                </button>
                <button class="quick-action" data-action="challenge">
                    <div class="action-icon">⚡</div>
                    <div class="action-label">چالش روزانه</div>
                </button>
                <button class="quick-action" data-action="new_lesson">
                    <div class="action-icon">📖</div>
                    <div class="action-label">درس جدید</div>
                </button>
            </div>
        `;
    }
    
    _renderActivities() {
        if (!this.data.activities || this.data.activities.length === 0) {
            return '<div class="empty-activities">هنوز فعالیتی ثبت نشده است</div>';
        }
        
        return this.data.activities.map(activity => `
            <div class="activity-item" data-activity-id="${activity.id}">
                <div class="activity-icon">
                    ${activity.type === 'lesson_completed' ? '✅' :
                      activity.type === 'quiz_passed' ? '📝' :
                      activity.type === 'streak_extended' ? '🔥' :
                      activity.type === 'level_up' ? '⬆️' : '🏅'}
                </div>
                <div class="activity-details">
                    <div class="activity-title">${activity.title}</div>
                    <div class="activity-time">${activity.time}</div>
                </div>
                ${activity.score !== null ? 
                    `<div class="activity-score">${activity.score}%</div>` : 
                    ''}
            </div>
        `).join('');
    }
    
    _updateDashboard() {
        // به‌روزرسانی هر ماژول
        this._renderStatsModule();
        this._renderDailyGoalModule();
        this._renderRecentLessonsModule();
        this._renderStreakModule();
        this._renderLeaderboardModule();
        this._renderActivities();
        
        // به‌روزرسانی timestamp
        const timestampEl = this.container.querySelector('.last-updated');
        if (timestampEl) {
            timestampEl.textContent = new Date().toLocaleTimeString('fa-IR');
        }
    }
    
    // ==================== سیستم‌های جانبی ====================
    
    _setupEventListeners() {
        // گوش دادن به رویدادهای state manager
        const stateUnsub = this.stateManager.subscribe('user.stats', (newStats) => {
            if (newStats && this.isMounted) {
                this.data.stats = newStats;
                this._renderStatsModule();
            }
        });
        this.subscriptions.set('state:stats', stateUnsub);
        
        // گوش دادن به رویدادهای auth
        const authUnsub = this.eventBus.on('auth:user:updated', (user) => {
            if (user && this.isMounted) {
                this.data.user = user;
                this._updateUserInfo();
            }
        });
        this.subscriptions.set('auth:user', authUnsub);
        
        // گوش دادن به رویدادهای lesson
        const lessonUnsub = this.eventBus.on('lesson:completed', (lesson) => {
            if (lesson && this.isMounted) {
                this.refresh(true).catch(console.error);
            }
        });
        this.subscriptions.set('lesson:completed', lessonUnsub);
    }
    
    _setupAutoRefresh() {
        if (this.config.refreshInterval > 0) {
            this.refreshInterval = setInterval(() => {
                if (document.visibilityState === 'visible' && this.isMounted) {
                    this.refresh().catch(console.error);
                }
            }, this.config.refreshInterval);
            
            console.log(`[Dashboard] به‌روزرسانی خودکار هر ${this.config.refreshInterval/1000} ثانیه`);
        }
    }
    
    _setupRealTimeUpdates() {
        // شبیه‌سازی به‌روزرسانی‌های real-time
        this.realTimeInterval = setInterval(() => {
            if (!this.isMounted) return;
            
            // به‌روزرسانی زمان‌ها
            this._updateActivityTimes();
            
            // به‌روزرسانی آماری تصادفی
            if (Math.random() > 0.7) {
                this._simulateLiveUpdate();
            }
        }, 10000); // هر ۱۰ ثانیه
    }
    
    _updateActivityTimes() {
        const timeElements = this.container?.querySelectorAll('.activity-time');
        if (!timeElements) return;
        
        // اینجا می‌توانید زمان‌ها را به‌روز کنید
        // برای نمونه، فعلاً کاری نمی‌کنیم
    }
    
    _simulateLiveUpdate() {
        // شبیه‌سازی به‌روزرسانی زنده
        if (this.data.stats) {
            const newMinutes = this.data.stats.todayMinutes + Math.floor(Math.random() * 3);
            this.data.stats.todayMinutes = newMinutes;
            this._renderStatsModule();
            
            this.eventBus.emit('dashboard:live_update', {
                type: 'minutes_updated',
                value: newMinutes
            });
        }
    }
    
    _attachEventListeners() {
        // دکمه به‌روزرسانی
        const refreshBtn = this.container?.querySelector('.refresh-btn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => this.refresh(true));
        }
        
        // دکمه تنظیمات
        const settingsBtn = this.container?.querySelector('.settings-btn');
        if (settingsBtn) {
            settingsBtn.addEventListener('click', () => {
                this.eventBus.emit(this.EVENTS.QUICK_ACTION_TRIGGERED, {
                    action: 'settings',
                    timestamp: new Date().toISOString()
                });
            });
        }
        
        // دکمه‌های اقدامات سریع
        const quickActions = this.container?.querySelectorAll('.quick-action');
        quickActions?.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const action = e.currentTarget.dataset.action;
                this._handleQuickAction(action);
            });
        });
        
        // دکمه ادامه درس
        const resumeBtns = this.container?.querySelectorAll('.lesson-resume');
        resumeBtns?.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const lessonId = e.currentTarget.dataset.lessonId;
                this._navigateToLesson(lessonId);
            });
        });
        
        // دکمه شروع یادگیری
        const startBtn = this.container?.querySelector('.empty-action');
        if (startBtn) {
            startBtn.addEventListener('click', () => {
                this.eventBus.emit(this.EVENTS.QUICK_ACTION_TRIGGERED, {
                    action: 'start_learning',
                    timestamp: new Date().toISOString()
                });
            });
        }
    }
    
    _handleQuickAction(action) {
        const actionHandlers = {
            practice: () => {
                if (this.router) {
                    this.router.navigateTo('/practice');
                } else {
                    window.location.hash = '#/practice';
                }
            },
            review: () => {
                this.eventBus.emit('vocabulary:review:requested');
            },
            challenge: () => {
                this.eventBus.emit('challenge:daily:start');
            },
            new_lesson: () => {
                if (this.router) {
                    this.router.navigateTo('/lessons/new');
                } else {
                    window.location.hash = '#/lessons/new';
                }
            }
        };
        
        if (actionHandlers[action]) {
            actionHandlers[action]();
            
            this.eventBus.emit(this.EVENTS.QUICK_ACTION_TRIGGERED, {
                action,
                timestamp: new Date().toISOString()
            });
        }
    }
    
    _navigateToLesson(lessonId) {
        if (this.router) {
            this.router.navigateTo(`/lesson/${lessonId}`);
        } else {
            window.location.hash = `#/lesson/${lessonId}`;
        }
        
        this.eventBus.emit(this.EVENTS.MODULE_SELECTED, {
            module: 'lesson',
            lessonId,
            timestamp: new Date().toISOString()
        });
    }
    
    _updateUserInfo() {
        const welcomeEl = this.container?.querySelector('.welcome-text');
        const levelEl = this.container?.querySelector('.user-level');
        
        if (welcomeEl && this.data.user) {
            welcomeEl.textContent = `سلام ${this.data.user.name} 👋`;
        }
        
        if (levelEl && this.data.user) {
            levelEl.textContent = `سطح ${this.data.user.level}`;
        }
    }
    
    _showLoading() {
        const loader = document.getElementById('dashboard-loader');
        if (loader) {
            loader.style.display = 'flex';
        }
    }
    
    _hideLoading() {
        const loader = document.getElementById('dashboard-loader');
        if (loader) {
            loader.style.display = 'none';
        }
    }
    
    _cleanupIntervals() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }
        
        if (this.realTimeInterval) {
            clearInterval(this.realTimeInterval);
            this.realTimeInterval = null;
        }
    }
    
    _unsubscribeAll() {
        this.subscriptions.forEach(unsubscribe => {
            if (typeof unsubscribe === 'function') {
                unsubscribe();
            }
        });
        this.subscriptions.clear();
    }
    
    // ==================== ابزارهای استایل ====================
    
    _getContainerStyles() {
        return `
            max-width: 1400px;
            margin: 0 auto;
            padding: 20px;
            font-family: 'Vazirmatn', sans-serif;
        `;
    }
    
    _getAvatarStyles() {
        return `
            width: 60px;
            height: 60px;
            border-radius: 50%;
            background: linear-gradient(135deg, ${this.config.colors.primary}, ${this.config.colors.secondary});
            color: white;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 1.5rem;
            font-weight: bold;
        `;
    }
    
    // ==================== مدیریت خطا ====================
    
    _handleError(error, context) {
        const errorEvent = {
            type: 'dashboard_error',
            context,
            message: error.message,
            timestamp: new Date().toISOString(),
            stack: error.stack
        };
        
        console.error(`[Dashboard] خطا در ${context}:`, error);
        
        // انتشار رویداد خطا
        this.eventBus.emit(this.EVENTS.ERROR, errorEvent);
        
        // نمایش خطا در UI اگر mount شده
        if (this.isMounted && this.container) {
            const errorDiv = document.createElement('div');
            errorDiv.className = 'dashboard-error';
            errorDiv.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                left: 20px;
                background: rgba(244, 67, 54, 0.9);
                color: white;
                padding: 15px;
                border-radius: 10px;
                z-index: 1000;
                text-align: center;
                backdrop-filter: blur(10px);
                border: 1px solid #f44336;
            `;
            
            errorDiv.innerHTML = `
                <strong>⚠️ خطا در داشبورد</strong>
                <p style="margin: 8px 0; font-size: 0.9rem;">${error.message}</p>
                <button onclick="this.parentElement.remove()" style="
                    background: white;
                    color: #f44336;
                    border: none;
                    padding: 5px 15px;
                    border-radius: 5px;
                    cursor: pointer;
                    margin-top: 5px;
                ">
                    بستن
                </button>
            `;
            
            document.body.appendChild(errorDiv);
            
            // حذف خودکار بعد از 10 ثانیه
            setTimeout(() => {
                if (errorDiv.parentElement) {
                    errorDiv.remove();
                }
            }, 10000);
        }
    }
}

// ==================== Factory Function ====================
function createDashboardPage(config = {}) {
    return new DashboardPage(config);
}

// ==================== Export استاندارد ====================
export { DashboardPage, createDashboardPage };

// ==================== Global Registration ====================
if (typeof window !== 'undefined') {
    window.DashboardPage = DashboardPage;
    window.createDashboardPage = createDashboardPage;
}

console.log('[DashboardPage] ✅ ماژول بارگذاری شد - آماده استفاده');
