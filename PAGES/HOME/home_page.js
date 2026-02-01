/**
 * VAKAMOVA HOME PAGE - صفحه اصلی داشبورد کاربر
 * اصول: تزریق وابستگی، قرارداد رابط، رویدادمحور، پیکربندی متمرکز
 * وابستگی‌های داخلی: auth_manager, state_manager, event_bus, router, config
 */

class HomePage {
    constructor(dependencies = {}) {
        // ==================== DEPENDENCY INJECTION ====================
        this._services = {
            auth: dependencies.auth || window.AuthManager,
            state: dependencies.state || window.StateManager,
            events: dependencies.events || window.eventBus,
            router: dependencies.router || window.Router,
            config: dependencies.config || window.Config,
            utils: dependencies.utils || window.Utils
        };
        
        this._validateDependencies();
        
        // ==================== CONFIGURATION CENTER ====================
        this._config = Object.freeze({
            elements: {
                container: 'app-container',
                loading: 'home-loading',
                error: 'home-error'
            },
            events: {
                LOADED: 'home:page:loaded',
                ERROR: 'home:page:error',
                NAVIGATE: 'home:navigate',
                DATA_CHANGED: 'home:data:changed'
            },
            limits: {
                recentLessons: 5,
                statsRefresh: 30000,
                cacheKey: 'home_page_data'
            },
            selectors: {
                lessonCard: '.lesson-card',
                quickAction: '.quick-action',
                logoutBtn: '.logout-btn',
                startLesson: '.start-lesson-btn'
            }
        });
        
        // ==================== INTERFACE CONTRACT ====================
        this.INTERFACE = Object.freeze({
            INIT: 'init',
            RENDER: 'render',
            UPDATE: 'update',
            CLEANUP: 'cleanup',
            REFRESH: 'refreshData',
            HANDLE_EVENT: 'handleEvent'
        });
        
        // ==================== EVENT-DRIVEN ARCHITECTURE ====================
        this._eventSubscriptions = new Map();
        this._isMounted = false;
        this._pageData = null;
        this._components = new Map();
        
        Object.seal(this);
    }
    
    // ==================== INTERFACE CONTRACT METHODS ====================
    
    async init(containerId = null) {
        try {
            // Verify authentication
            if (!await this._verifyAuthentication()) {
                return { success: false, reason: 'unauthenticated' };
            }
            
            // Set container
            this._container = document.getElementById(
                containerId || this._config.elements.container
            );
            
            if (!this._container) {
                throw new Error('Container element not found');
            }
            
            // Load initial data
            await this._loadInitialData();
            
            // Setup event system
            this._setupEventSystem();
            
            // Initial render
            this.render();
            
            // Emit loaded event
            this._services.events.emit(
                this._config.events.LOADED,
                { timestamp: Date.now(), userId: this._getUserId() }
            );
            
            this._isMounted = true;
            
            return { success: true, mounted: true };
            
        } catch (error) {
            this._handleError(error, 'init');
            return { success: false, error: error.message };
        }
    }
    
    render() {
        if (!this._container || !this._pageData) return;
        
        try {
            this._container.innerHTML = this._generateHTML();
            this._attachEventListeners();
            this._applyAnimations();
            
            // Update state
            this._services.state.set('ui.currentPage', 'home', {
                source: 'home_page',
                silent: true
            });
            
        } catch (error) {
            this._handleError(error, 'render');
        }
    }
    
    async update(dataUpdates = {}) {
        if (!this._isMounted) return;
        
        try {
            // Merge updates
            this._pageData = {
                ...this._pageData,
                ...dataUpdates,
                _updatedAt: Date.now()
            };
            
            // Update specific components
            if (dataUpdates.user) {
                this._updateUserSection();
            }
            
            if (dataUpdates.stats) {
                this._updateStatsSection();
            }
            
            if (dataUpdates.recentLessons) {
                this._updateLessonsSection();
            }
            
            // Emit data changed event
            this._services.events.emit(
                this._config.events.DATA_CHANGED,
                { updates: Object.keys(dataUpdates) }
            );
            
            return { success: true };
            
        } catch (error) {
            this._handleError(error, 'update');
            return { success: false, error: error.message };
        }
    }
    
    async refreshData(force = false) {
        try {
            this._showLoading();
            
            const freshData = await this._fetchHomeData();
            await this.update(freshData);
            
            return { success: true, data: freshData };
            
        } catch (error) {
            this._handleError(error, 'refreshData');
            return { success: false, error: error.message };
        } finally {
            this._hideLoading();
        }
    }
    
    handleEvent(eventType, eventData) {
        const eventHandlers = {
            'lesson:selected': this._handleLessonSelect.bind(this),
            'quick:action': this._handleQuickAction.bind(this),
            'user:logout': this._handleLogout.bind(this),
            'data:refresh': () => this.refreshData(true),
            'navigate:to': this._handleNavigation.bind(this)
        };
        
        if (eventHandlers[eventType]) {
            return eventHandlers[eventType](eventData);
        }
        
        // Forward unhandled events
        this._services.events.emit('home:event:forwarded', {
            originalEvent: eventType,
            data: eventData
        });
        
        return null;
    }
    
    cleanup() {
        if (!this._isMounted) return;
        
        // Remove event listeners
        this._removeEventListeners();
        
        // Unsubscribe from events
        this._cleanupEventSubscriptions();
        
        // Clear components
        this._components.clear();
        
        // Clear container
        if (this._container) {
            this._container.innerHTML = '';
        }
        
        this._isMounted = false;
        this._pageData = null;
        
        console.log('[HomePage] Cleanup completed');
    }
    
    // ==================== DATA MANAGEMENT ====================
    
    async _loadInitialData() {
        // Try cache first
        const cached = this._getCachedData();
        
        if (cached && !this._isCacheExpired(cached)) {
            this._pageData = cached.data;
            console.log('[HomePage] Using cached data');
            return;
        }
        
        // Fetch fresh data
        this._showLoading();
        
        try {
            const data = await this._fetchHomeData();
            this._pageData = data;
            
            // Cache the data
            this._cacheData(data);
            
        } catch (error) {
            throw new Error(`Failed to load home data: ${error.message}`);
        } finally {
            this._hideLoading();
        }
    }
    
    async _fetchHomeData() {
        const userId = this._getUserId();
        if (!userId) throw new Error('User ID not available');
        
        // Fetch data in parallel
        const [userData, userStats, recentLessons] = await Promise.all([
            this._fetchUserData(userId),
            this._fetchUserStats(userId),
            this._fetchRecentLessons(userId)
        ]);
        
        // Calculate derived data
        const dailyProgress = this._calculateDailyProgress(userStats);
        const learningStreak = this._calculateStreak(userData);
        const recommendedLesson = this._getRecommendedLesson(userData, recentLessons);
        
        return {
            user: {
                id: userData.id,
                name: userData.name,
                avatar: userData.avatar || this._generateAvatar(userData.name),
                level: userData.level || 'beginner',
                streak: learningStreak,
                joinDate: userData.createdAt
            },
            stats: {
                totalLessons: userStats.totalLessons || 0,
                completedLessons: userStats.completedLessons || 0,
                totalMinutes: userStats.totalMinutes || 0,
                todayMinutes: userStats.todayMinutes || 0,
                accuracy: userStats.accuracy || 0,
                rank: this._calculateRank(userStats.totalMinutes),
                nextMilestone: this._calculateNextMilestone(userStats.totalMinutes)
            },
            recentLessons: recentLessons.slice(0, this._config.limits.recentLessons),
            dailyGoal: {
                target: userData.dailyGoal || 30,
                completed: userStats.todayMinutes || 0,
                progress: dailyProgress
            },
            recommendations: {
                lesson: recommendedLesson,
                nextLevel: this._getNextLevelInfo(userData.level)
            },
            _fetchedAt: Date.now()
        };
    }
    
    // ==================== UI GENERATION ====================
    
    _generateHTML() {
        const { user, stats, recentLessons, dailyGoal, recommendations } = this._pageData;
        
        return `
            <div class="home-page" data-page="home" data-user-id="${user.id}">
                <!-- Header Section -->
                <header class="home-header">
                    ${this._generateHeaderHTML(user)}
                </header>
                
                <!-- Stats Dashboard -->
                <section class="stats-dashboard">
                    ${this._generateStatsHTML(stats, dailyGoal)}
                </section>
                
                <!-- Recent Lessons -->
                <section class="lessons-section">
                    ${this._generateLessonsHTML(recentLessons)}
                </section>
                
                <!-- Quick Actions -->
                <section class="quick-actions">
                    ${this._generateQuickActionsHTML()}
                </section>
                
                <!-- Recommendations -->
                <section class="recommendations">
                    ${this._generateRecommendationsHTML(recommendations)}
                </section>
                
                <!-- UI Utilities -->
                ${this._generateUtilityHTML()}
            </div>
        `;
    }
    
    _generateHeaderHTML(user) {
        return `
            <div class="user-profile">
                <img src="${user.avatar}" 
                     alt="${user.name}" 
                     class="user-avatar"
                     onerror="this.src='data:image/svg+xml,<svg>...</svg>'">
                <div class="user-info">
                    <h1 class="welcome-message">سلام ${user.name}!</h1>
                    <div class="user-meta">
                        <span class="user-level">سطح ${user.level}</span>
                        <span class="user-streak">🔥 ${user.streak} روز متوالی</span>
                    </div>
                </div>
                <button class="logout-btn" title="خروج">
                    <svg width="20" height="20"><path d="..."/></svg>
                </button>
            </div>
        `;
    }
    
    _generateStatsHTML(stats, dailyGoal) {
        const progressPercent = Math.min(100, (dailyGoal.completed / dailyGoal.target) * 100);
        
        return `
            <div class="stats-grid">
                <div class="stat-card primary">
                    <h3>📊 امروز</h3>
                    <div class="stat-value">${dailyGoal.completed} دقیقه</div>
                    <div class="progress-container">
                        <div class="progress-bar" role="progressbar">
                            <div class="progress-fill" style="width: ${progressPercent}%"></div>
                        </div>
                        <div class="progress-text">${progressPercent.toFixed(0)}% از هدف</div>
                    </div>
                </div>
                
                <div class="stat-card">
                    <h3>🎯 دقت</h3>
                    <div class="stat-value">${stats.accuracy}%</div>
                    <div class="stat-desc">پاسخ صحیح</div>
                </div>
                
                <div class="stat-card">
                    <h3>🏆 رتبه</h3>
                    <div class="stat-value">${stats.rank}</div>
                    <div class="stat-desc">${stats.nextMilestone} دقیقه تا بعدی</div>
                </div>
                
                <div class="stat-card">
                    <h3>📚 درس‌ها</h3>
                    <div class="stat-value">${stats.completedLessons}/${stats.totalLessons}</div>
                    <div class="stat-desc">تکمیل شده</div>
                </div>
            </div>
        `;
    }
    
    _generateLessonsHTML(lessons) {
        if (!lessons.length) {
            return `
                <div class="empty-state">
                    <div class="empty-icon">📚</div>
                    <h3>هنوز درسی شروع نکرده‌اید!</h3>
                    <p>با شروع اولین درس، مسیر یادگیری را آغاز کنید.</p>
                    <button class="start-lesson-btn">شروع اولین درس</button>
                </div>
            `;
        }
        
        return `
            <div class="section-header">
                <h2>ادامه یادگیری</h2>
                <a href="/lessons" class="view-all">مشاهده همه</a>
            </div>
            <div class="lessons-grid">
                ${lessons.map(lesson => this._generateLessonCardHTML(lesson)).join('')}
            </div>
        `;
    }
    
    _generateLessonCardHTML(lesson) {
        const progressPercent = (lesson.progress || 0) * 100;
        
        return `
            <div class="lesson-card" data-lesson-id="${lesson.id}" data-language="${lesson.language}">
                <div class="lesson-thumbnail">
                    <span class="language-badge">${lesson.language.toUpperCase()}</span>
                </div>
                <div class="lesson-content">
                    <h3 class="lesson-title">${lesson.title}</h3>
                    <div class="lesson-meta">
                        <span class="lesson-level">${lesson.level}</span>
                        <span class="lesson-duration">⏱️ ${lesson.duration} دقیقه</span>
                    </div>
                    <div class="lesson-progress">
                        <div class="progress-bar">
                            <div class="progress-fill" style="width: ${progressPercent}%"></div>
                        </div>
                        <span class="progress-text">${Math.round(progressPercent)}% کامل</span>
                    </div>
                    <button class="resume-lesson-btn" data-lesson-id="${lesson.id}">
                        ${lesson.progress > 0 ? 'ادامه' : 'شروع'}
                    </button>
                </div>
            </div>
        `;
    }
    
    _generateQuickActionsHTML() {
        const actions = [
            { id: 'practice', icon: '⚡', label: 'تمرین سریع' },
            { id: 'review', icon: '📖', label: 'مرور واژگان' },
            { id: 'challenge', icon: '🏆', label: 'چالش روزانه' },
            { id: 'goals', icon: '🎯', label: 'اهداف من' }
        ];
        
        return `
            <div class="actions-grid">
                ${actions.map(action => `
                    <button class="quick-action" data-action="${action.id}">
                        <span class="action-icon">${action.icon}</span>
                        <span class="action-label">${action.label}</span>
                    </button>
                `).join('')}
            </div>
        `;
    }
    
    _generateRecommendationsHTML(recommendations) {
        if (!recommendations.lesson) return '';
        
        return `
            <div class="recommendation-card">
                <div class="recommendation-header">
                    <h3>🚀 پیشنهاد ویژه</h3>
                    <span class="badge">برای شما</span>
                </div>
                <div class="recommendation-content">
                    <h4>${recommendations.lesson.title}</h4>
                    <p>${recommendations.lesson.description || 'مناسب برای سطح شما'}</p>
                    <button class="start-recommended-btn" data-lesson-id="${recommendations.lesson.id}">
                        شروع این درس
                    </button>
                </div>
            </div>
        `;
    }
    
    _generateUtilityHTML() {
        return `
            <div class="utility-overlay">
                <div class="loading-indicator" id="${this._config.elements.loading}">
                    <div class="spinner"></div>
                    <span>در حال بارگذاری...</span>
                </div>
                <div class="error-display" id="${this._config.elements.error}"></div>
            </div>
        `;
    }
    
    // ==================== EVENT HANDLING ====================
    
    _setupEventSystem() {
        // Subscribe to user events
        this._subscribeToEvent('auth:user:updated', (data) => {
            this.update({ user: data.user });
        });
        
        // Subscribe to lesson events
        this._subscribeToEvent('lesson:progress:updated', (data) => {
            this.refreshData(true);
        });
        
        // Subscribe to state changes
        this._subscribeToEvent('state:changed:ui', (data) => {
            if (data.path === 'ui.theme') {
                this._handleThemeChange(data.value);
            }
        });
        
        // Auto-refresh timer
        this._refreshTimer = setInterval(() => {
            if (document.visibilityState === 'visible') {
                this.refreshData();
            }
        }, this._config.limits.statsRefresh);
    }
    
    _attachEventListeners() {
        // Lesson card clicks
        this._delegateEvent(this._config.selectors.lessonCard, 'click', (e) => {
            const lessonId = e.target.closest('.lesson-card').dataset.lessonId;
            this._handleLessonSelect({ lessonId });
        });
        
        // Quick action clicks
        this._delegateEvent(this._config.selectors.quickAction, 'click', (e) => {
            const action = e.target.closest('.quick-action').dataset.action;
            this._handleQuickAction({ action });
        });
        
        // Logout button
        this._delegateEvent(this._config.selectors.logoutBtn, 'click', () => {
            this._handleLogout();
        });
        
        // Start lesson button
        this._delegateEvent(this._config.selectors.startLesson, 'click', () => {
            this._services.router.navigateTo('/lessons');
        });
    }
    
    _handleLessonSelect(data) {
        if (!data?.lessonId) return;
        
        this._services.events.emit('lesson:selected', {
            lessonId: data.lessonId,
            source: 'home_page',
            userId: this._getUserId()
        });
        
        // Navigate to lesson page
        this._services.router.navigateTo(`/lesson/${data.lessonId}`);
    }
    
    _handleQuickAction(data) {
        const actionHandlers = {
            practice: () => this._services.router.navigateTo('/practice'),
            review: () => this._services.router.navigateTo('/review'),
            challenge: () => this._services.router.navigateTo('/challenge'),
            goals: () => this._services.router.navigateTo('/goals')
        };
        
        if (actionHandlers[data.action]) {
            this._services.events.emit('quick:action:executed', {
                action: data.action,
                userId: this._getUserId()
            });
            
            actionHandlers[data.action]();
        }
    }
    
    async _handleLogout() {
        const confirmed = await this._showConfirmation(
            'آیا مطمئن هستید که می‌خواهید خارج شوید؟',
            'خروج از سیستم'
        );
        
        if (confirmed) {
            try {
                await this._services.auth.logout();
                this._services.events.emit('user:logged:out');
                this._services.router.navigateTo('/login');
            } catch (error) {
                this._showError('خطا در خروج از سیستم');
            }
        }
    }
    
    _handleNavigation(data) {
        if (data?.path) {
            this._services.router.navigateTo(data.path);
        }
    }
    
    // ==================== UTILITY METHODS ====================
    
    _validateDependencies() {
        const required = ['auth', 'state', 'events', 'router'];
        
        required.forEach(service => {
            if (!this._services[service]) {
                throw new Error(`Required service ${service} not provided`);
            }
        });
    }
    
    _subscribeToEvent(eventName, handler) {
        const unsubscribe = this._services.events.on(eventName, handler);
        this._eventSubscriptions.set(eventName, unsubscribe);
    }
    
    _delegateEvent(selector, eventType, handler) {
        const listener = (e) => {
            if (e.target.closest(selector)) {
                handler(e);
            }
        };
        
        this._container.addEventListener(eventType, listener);
        
        // Store for cleanup
        if (!this._components.has('event-listeners')) {
            this._components.set('event-listeners', []);
        }
        
        this._components.get('event-listeners').push({
            type: eventType,
            listener: listener
        });
    }
    
    _verifyAuthentication() {
        return this._services.auth.isAuthenticated();
    }
    
    _getUserId() {
        const userState = this._services.state.get('auth.user');
        return userState?.id || null;
    }
    
    _showLoading() {
        const loader = document.getElementById(this._config.elements.loading);
        if (loader) loader.style.display = 'flex';
    }
    
    _hideLoading() {
        const loader = document.getElementById(this._config.elements.loading);
        if (loader) loader.style.display = 'none';
    }
    
    _showError(message) {
        const errorEl = document.getElementById(this._config.elements.error);
        if (errorEl) {
            errorEl.textContent = message;
            errorEl.style.display = 'block';
            
            setTimeout(() => {
                errorEl.style.display = 'none';
            }, 5000);
        }
    }
    
    async _showConfirmation(message, title) {
        // Simple confirmation (can be enhanced with modal)
        return confirm(`${title}\n\n${message}`);
    }
    
    _handleError(error, context) {
        console.error(`[HomePage] Error in ${context}:`, error);
        
        this._services.events.emit(this._config.events.ERROR, {
            error: error.message,
            context: context,
            timestamp: Date.now()
        });
        
        this._showError(`خطا: ${error.message}`);
    }
    
    _getCachedData() {
        const cacheKey = `${this._config.limits.cacheKey}_${this._getUserId()}`;
        const cached = localStorage.getItem(cacheKey);
        
        if (!cached) return null;
        
        try {
            return JSON.parse(cached);
        } catch {
            return null;
        }
    }
    
    _cacheData(data) {
        const cacheKey = `${this._config.limits.cacheKey}_${this._getUserId()}`;
        const cacheData = {
            data: data,
            cachedAt: Date.now()
        };
        
        localStorage.setItem(cacheKey, JSON.stringify(cacheData));
    }
    
    _isCacheExpired(cache) {
        const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
        return Date.now() - cache.cachedAt > CACHE_TTL;
    }
    
    _generateAvatar(name) {
        const colors = ['#1a237e', '#3949ab', '#00b0ff', '#2962ff'];
        const colorIndex = (name?.length || 0) % colors.length;
        const initial = name ? name.charAt(0).toUpperCase() : 'U';
        
        return `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="50" fill="${colors[colorIndex]}"/>
            <text x="50" y="65" font-size="40" text-anchor="middle" fill="white">
                ${initial}
            </text>
        </svg>`;
    }
    
    _calculateDailyProgress(stats) {
        const goal = this._pageData?.user?.dailyGoal || 30;
        return Math.min(100, (stats.todayMinutes / goal) * 100);
    }
    
    _calculateStreak(userData) {
        // Implementation depends on your data structure
        return userData.streakDays || 0;
    }
    
    _calculateRank(totalMinutes) {
        const ranks = [
            { threshold: 0, name: 'تازه‌کار' },
            { threshold: 100, name: 'یادگیرنده' },
            { threshold: 500, name: 'دانش‌آموز' },
            { threshold: 1000, name: 'عالِم' },
            { threshold: 5000, name: 'استاد' }
        ];
        
        const rank = ranks.reverse().find(r => totalMinutes >= r.threshold) || ranks[0];
        return rank.name;
    }
    
    _calculateNextMilestone(totalMinutes) {
        const milestones = [100, 500, 1000, 5000, 10000];
        const next = milestones.find(m => m > totalMinutes);
        return next ? next - totalMinutes : 0;
    }
    
    _getRecommendedLesson(userData, recentLessons) {
        // Simple recommendation logic
        if (!recentLessons.length) return null;
        
        // Find uncompleted lessons
        const uncompleted = recentLessons.filter(l => l.progress < 0.8);
        
        if (uncompleted.length > 0) {
            return uncompleted[0];
        }
        
        return recentLessons[0];
    }
    
    _getNextLevelInfo(currentLevel) {
        const levels = {
            beginner: { next: 'intermediate', required: 10 },
            intermediate: { next: 'advanced', required: 50 },
            advanced: { next: 'expert', required: 100 }
        };
        
        return levels[currentLevel] || { next: 'advanced', required: 10 };
    }
    
    _updateUserSection() {
        const userSection = this._container.querySelector('.user-profile');
        if (userSection && this._pageData?.user) {
            // Update user info
            const welcomeMsg = userSection.querySelector('.welcome-message');
            if (welcomeMsg) {
                welcomeMsg.textContent = `سلام ${this._pageData.user.name}!`;
            }
            
            // Update streak
            const streakEl = userSection.querySelector('.user-streak');
            if (streakEl) {
                streakEl.textContent = `🔥 ${this._pageData.user.streak} روز متوالی`;
            }
        }
    }
    
    _updateStatsSection() {
        // Implementation for updating stats section
    }
    
    _updateLessonsSection() {
        // Implementation for updating lessons section
    }
    
    _applyAnimations() {
        // Apply entrance animations
        const elements = this._container.querySelectorAll('.lesson-card, .stat-card');
        elements.forEach((el, index) => {
            el.style.animationDelay = `${index * 0.1}s`;
            el.classList.add('animate-in');
        });
    }
    
    _removeEventListeners() {
        const listeners = this._components.get('event-listeners') || [];
        
        listeners.forEach(({ type, listener }) => {
            this._container.removeEventListener(type, listener);
        });
        
        this._components.delete('event-listeners');
    }
    
    _cleanupEventSubscriptions() {
        for (const unsubscribe of this._eventSubscriptions.values()) {
            if (typeof unsubscribe === 'function') {
                unsubscribe();
            }
        }
        
        this._eventSubscriptions.clear();
        
        if (this._refreshTimer) {
            clearInterval(this._refreshTimer);
            this._refreshTimer = null;
        }
    }
    
    _handleThemeChange(theme) {
        // Apply theme changes if needed
        document.documentElement.setAttribute('data-theme', theme);
    }
}

// ==================== EXPORT PATTERNS ====================

// Export class
export { HomePage };

// Singleton instance factory
let homePageInstance = null;

export function createHomePage(dependencies = {}) {
    if (!homePageInstance) {
        homePageInstance = new HomePage(dependencies);
    }
    return homePageInstance;
}

// Auto-initialize if loaded directly
if (import.meta.url === document.currentScript?.src) {
    document.addEventListener('DOMContentLoaded', async () => {
        try {
            const homePage = createHomePage();
            await homePage.init();
            console.log('[HomePage] Auto-initialized successfully');
        } catch (error) {
            console.error('[HomePage] Auto-initialization failed:', error);
        }
    });
                            }
