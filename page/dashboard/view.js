/**
 * VAKAMOVA - DASHBOARD VIEW LAYER
 * اصل‌ها: ۱. تزریق وابستگی | ۲. قرارداد رابط | ۳. رویدادمحور | ۴. پیکربندی متمرکز
 * وابستگی داخلی: فقط event_bus.js + state_manager.js
 */

import { eventBus } from '../../core/event_bus.js';
import { stateManager } from '../../core/state_manager.js';

class DashboardView {
    // ============ [1] تزریق وابستگی (Dependency Injection) ============
    constructor(dependencies = {}) {
        this.deps = Object.freeze({
            eventBus: dependencies.eventBus || eventBus,
            stateManager: dependencies.stateManager || stateManager,
            config: dependencies.config || DashboardConfig,
            uiRenderer: dependencies.uiRenderer || new UIRenderer()
        });
        
        this.elements = null;
        this.unsubscribe = [];
        this.viewState = { isLoading: true };
        
        this._validateDependencies();
        this._bindMethods();
    }
    
    // ============ [2] قرارداد رابط (Interface Contract) ============
    async render(containerId = 'app-content') {
        try {
            this._validateContainer(containerId);
            
            await this._initializeView();
            this._renderTemplate(containerId);
            this._cacheDOMElements();
            this._setupEventListeners();
            this._setupDataSubscriptions();
            
            this.deps.eventBus.emit('dashboard:view:ready', {
                timestamp: Date.now(),
                containerId
            });
            
            return { success: true, view: this };
            
        } catch (error) {
            this.deps.eventBus.emit('dashboard:view:error', { error });
            throw new Error(`Dashboard render failed: ${error.message}`);
        }
    }
    
    update(data) {
        if (!this.elements) return;
        
        // هوشمند: فقط بخش‌های تغییرکرده را آپدیت کن
        const changes = this._calculateChanges(data);
        
        if (changes.user) this._updateUserSection(data.user);
        if (changes.stats) this._updateStatsSection(data.stats);
        if (changes.lessons) this._updateLessonsSection(data.recentLessons);
        if (changes.goals) this._updateGoalsSection(data.learningGoals);
        
        this.deps.eventBus.emit('dashboard:view:updated', { changes });
    }
    
    destroy() {
        // پاک‌سازی حرفه‌ای
        this._cleanupEventListeners();
        this._cleanupSubscriptions();
        this._cleanupDOM();
        
        this.elements = null;
        this.viewState = null;
        
        this.deps.eventBus.emit('dashboard:view:destroyed');
    }
    
    // ============ [3] رویدادمحور (Event-Driven) ============
    _setupDataSubscriptions() {
        // Subscribe به تغییرات State
        const stateUnsub = this.deps.stateManager.subscribe(
            'dashboard.data',
            (newData) => this.update(newData),
            { namespace: 'user' }
        );
        
        // Subscribe به رویدادهای سیستمی
        const eventUnsub1 = this.deps.eventBus.on(
            'user:session:updated',
            (data) => this._handleSessionUpdate(data)
        );
        
        const eventUnsub2 = this.deps.eventBus.on(
            'lesson:progress:changed',
            (data) => this._handleProgressUpdate(data)
        );
        
        this.unsubscribe.push(stateUnsub, eventUnsub1, eventUnsub2);
    }
    
    _handleSessionUpdate(sessionData) {
        this._updateUserSection(sessionData.user);
        this.deps.eventBus.emit('dashboard:session:reflected');
    }
    
    _handleProgressUpdate(progressData) {
        if (this.elements?.progressBars) {
            this._animateProgressUpdate(progressData);
        }
    }
    
    // ============ [4] پیکربندی متمرکز (Centralized Config) ============
    static get DashboardConfig() {
        return Object.freeze({
            selectors: {
                container: '#app-content',
                userSection: '.dashboard-user-section',
                statsGrid: '.dashboard-stats-grid',
                lessonsList: '.dashboard-lessons-list',
                goalsSection: '.dashboard-goals-section',
                loadingIndicator: '.dashboard-loading'
            },
            
            templates: {
                userCard: (user) => `
                    <div class="user-card" data-user-id="${user.id}">
                        <img src="${user.avatar || this.defaultAvatar}" 
                             alt="${user.name}" 
                             class="user-avatar"
                             onerror="this.src='${this.defaultAvatar}'">
                        <div class="user-info">
                            <h2 class="user-greeting">سلام ${user.name}!</h2>
                            <div class="user-meta">
                                <span class="user-level">سطح ${user.level}</span>
                                <span class="user-streak">🔥 ${user.streak} روز</span>
                            </div>
                        </div>
                    </div>
                `,
                
                statItem: (stat) => `
                    <div class="stat-card" data-stat-type="${stat.type}">
                        <div class="stat-icon">${stat.icon || '📊'}</div>
                        <div class="stat-content">
                            <div class="stat-value">${stat.value}</div>
                            <div class="stat-label">${stat.label}</div>
                            ${stat.progress ? `
                                <div class="stat-progress">
                                    <div class="progress-bar">
                                        <div class="progress-fill" 
                                             style="width: ${stat.progress}%">
                                        </div>
                                    </div>
                                </div>
                            ` : ''}
                        </div>
                    </div>
                `,
                
                lessonItem: (lesson) => `
                    <div class="lesson-card" data-lesson-id="${lesson.id}">
                        <div class="lesson-header">
                            <span class="lesson-language">${lesson.language}</span>
                            <span class="lesson-level">${lesson.level}</span>
                        </div>
                        <h3 class="lesson-title">${lesson.title}</h3>
                        <div class="lesson-progress">
                            <div class="progress-bar">
                                <div class="progress-fill" 
                                     style="width: ${lesson.progress || 0}%">
                                </div>
                            </div>
                            <span class="progress-text">${lesson.progress || 0}%</span>
                        </div>
                        <button class="lesson-action" 
                                data-action="${lesson.progress > 0 ? 'continue' : 'start'}"
                                data-lesson-id="${lesson.id}">
                            ${lesson.progress > 0 ? 'ادامه درس' : 'شروع یادگیری'}
                        </button>
                    </div>
                `
            },
            
            defaults: {
                defaultAvatar: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="45" fill="%230d7377"/><text x="50" y="65" font-size="36" text-anchor="middle" fill="white">👤</text></svg>',
                maxRecentLessons: 5,
                animationDuration: 300
            },
            
            events: {
                LESSON_SELECTED: 'dashboard:lesson:selected',
                GOAL_UPDATED: 'dashboard:goal:updated',
                STATS_EXPANDED: 'dashboard:stats:expanded',
                VIEW_READY: 'dashboard:view:ready'
            }
        });
    }
    
    // ============ IMPLEMENTATION DETAILS ============
    _validateDependencies() {
        const required = ['eventBus', 'stateManager'];
        required.forEach(dep => {
            if (!this.deps[dep]) {
                throw new Error(`Missing required dependency: ${dep}`);
            }
        });
    }
    
    _bindMethods() {
        this.render = this.render.bind(this);
        this.update = this.update.bind(this);
        this.destroy = this.destroy.bind(this);
        this._handleLessonClick = this._handleLessonClick.bind(this);
        this._handleGoalUpdate = this._handleGoalUpdate.bind(this);
    }
    
    _validateContainer(containerId) {
        if (!document.getElementById(containerId)) {
            throw new Error(`Container #${containerId} not found in DOM`);
        }
    }
    
    async _initializeView() {
        this.viewState.isLoading = true;
        
        // دریافت داده اولیه از State Manager
        const dashboardData = await this.deps.stateManager.get(
            'dashboard.data', 
            { namespace: 'user', defaultValue: this._getDefaultData() }
        );
        
        this.viewState.data = dashboardData;
        this.viewState.isLoading = false;
        
        this.deps.eventBus.emit('dashboard:data:loaded', {
            data: dashboardData,
            timestamp: Date.now()
        });
    }
    
    _renderTemplate(containerId) {
        const container = document.getElementById(containerId);
        const config = this.deps.config;
        
        container.innerHTML = `
            <section class="dashboard-view" data-view-ready="false">
                <!-- Loading State -->
                ${this.viewState.isLoading ? `
                    <div class="${config.selectors.loadingIndicator}">
                        <div class="loading-spinner"></div>
                        <p>در حال بارگذاری داشبورد...</p>
                    </div>
                ` : ''}
                
                <!-- User Section -->
                <div class="${config.selectors.userSection.slice(1)}">
                    ${config.templates.userCard(this.viewState.data?.user || {})}
                </div>
                
                <!-- Stats Grid -->
                <div class="${config.selectors.statsGrid.slice(1)}">
                    ${this._renderStatsGrid()}
                </div>
                
                <!-- Recent Lessons -->
                <div class="${config.selectors.lessonsList.slice(1)}">
                    <div class="section-header">
                        <h2>درس‌های اخیر</h2>
                        <button class="view-all" data-action="view-all-lessons">
                            مشاهده همه
                        </button>
                    </div>
                    <div class="lessons-container">
                        ${this._renderRecentLessons()}
                    </div>
                </div>
                
                <!-- Learning Goals -->
                <div class="${config.selectors.goalsSection.slice(1)}">
                    <h2>اهداف یادگیری</h2>
                    <div class="goals-container">
                        ${this._renderLearningGoals()}
                    </div>
                </div>
                
                <!-- Quick Actions -->
                <div class="quick-actions">
                    <button class="action-btn" data-action="quick-practice">
                        <span class="action-icon">⚡</span>
                        <span>تمرین سریع</span>
                    </button>
                    <button class="action-btn" data-action="vocab-review">
                        <span class="action-icon">📖</span>
                        <span>مرور واژگان</span>
                    </button>
                    <button class="action-btn" data-action="daily-challenge">
                        <span class="action-icon">🏆</span>
                        <span>چالش روزانه</span>
                    </button>
                </div>
            </section>
        `;
        
        // مارک آماده بودن
        setTimeout(() => {
            container.querySelector('.dashboard-view').setAttribute('data-view-ready', 'true');
        }, this.deps.config.defaults.animationDuration);
    }
    
    _renderStatsGrid() {
        const stats = this.viewState.data?.stats || [];
        const config = this.deps.config;
        
        if (!stats.length) {
            return `<div class="no-stats">آمار در حال محاسبه است...</div>`;
        }
        
        return stats.map(stat => config.templates.statItem(stat)).join('');
    }
    
    _renderRecentLessons() {
        const lessons = this.viewState.data?.recentLessons || [];
        const config = this.deps.config;
        const maxItems = config.defaults.maxRecentLessons;
        
        if (!lessons.length) {
            return `
                <div class="empty-lessons-state">
                    <p>هنوز درسی شروع نکرده‌اید!</p>
                    <button class="btn-primary" data-action="start-first-lesson">
                        شروع اولین درس
                    </button>
                </div>
            `;
        }
        
        return lessons
            .slice(0, maxItems)
            .map(lesson => config.templates.lessonItem(lesson))
            .join('');
    }
    
    _renderLearningGoals() {
        const goals = this.viewState.data?.learningGoals || [];
        
        return goals.map(goal => `
            <div class="goal-item" data-goal-id="${goal.id}">
                <div class="goal-info">
                    <h3 class="goal-title">${goal.title}</h3>
                    <p class="goal-description">${goal.description}</p>
                </div>
                <div class="goal-progress">
                    <div class="progress-circle" 
                         data-progress="${goal.progress || 0}">
                        <span class="progress-percent">${goal.progress || 0}%</span>
                    </div>
                    <button class="goal-edit" data-goal-id="${goal.id}">
                        تنظیم
                    </button>
                </div>
            </div>
        `).join('');
    }
    
    _cacheDOMElements() {
        const config = this.deps.config;
        
        this.elements = {
            container: document.querySelector('.dashboard-view'),
            userSection: document.querySelector(config.selectors.userSection),
            statsGrid: document.querySelector(config.selectors.statsGrid),
            lessonsList: document.querySelector(config.selectors.lessonsList),
            goalsSection: document.querySelector(config.selectors.goalsSection),
            loadingIndicator: document.querySelector(config.selectors.loadingIndicator),
            
            // Dynamic collections
            lessonCards: document.querySelectorAll('.lesson-card'),
            actionButtons: document.querySelectorAll('.action-btn'),
            goalItems: document.querySelectorAll('.goal-item')
        };
    }
    
    _setupEventListeners() {
        // Lesson interactions
        if (this.elements.lessonCards) {
            this.elements.lessonCards.forEach(card => {
                card.addEventListener('click', this._handleLessonClick);
            });
        }
        
        // Quick actions
        if (this.elements.actionButtons) {
            this.elements.actionButtons.forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const action = e.currentTarget.dataset.action;
                    this.deps.eventBus.emit('dashboard:action:triggered', { action });
                });
            });
        }
        
        // Goal management
        if (this.elements.goalItems) {
            this.elements.goalItems.forEach(goal => {
                goal.querySelector('.goal-edit').addEventListener(
                    'click', 
                    this._handleGoalUpdate
                );
            });
        }
        
        // Window events
        window.addEventListener('resize', this._handleResize.bind(this));
    }
    
    _handleLessonClick(event) {
        const lessonCard = event.target.closest('.lesson-card');
        if (!lessonCard) return;
        
        const lessonId = lessonCard.dataset.lessonId;
        const actionBtn = event.target.closest('.lesson-action');
        
        if (actionBtn) {
            const action = actionBtn.dataset.action;
            
            this.deps.eventBus.emit(this.deps.config.events.LESSON_SELECTED, {
                lessonId,
                action,
                timestamp: Date.now(),
                source: 'dashboard'
            });
        }
    }
    
    _handleGoalUpdate(event) {
        const goalId = event.currentTarget.dataset.goalId;
        
        this.deps.eventBus.emit(this.deps.config.events.GOAL_UPDATED, {
            goalId,
            timestamp: Date.now()
        });
    }
    
    _handleResize() {
        this.deps.eventBus.emit('dashboard:view:resized', {
            width: window.innerWidth,
            height: window.innerHeight
        });
    }
    
    _calculateChanges(newData) {
        const oldData = this.viewState.data || {};
        
        return {
            user: !this._isEqual(oldData.user, newData.user),
            stats: !this._isEqual(oldData.stats, newData.stats),
            lessons: !this._isEqual(oldData.recentLessons, newData.recentLessons),
            goals: !this._isEqual(oldData.learningGoals, newData.learningGoals)
        };
    }
    
    _updateUserSection(userData) {
        if (!this.elements.userSection || !userData) return;
        
        this.elements.userSection.innerHTML = 
            this.deps.config.templates.userCard(userData);
    }
    
    _updateStatsSection(statsData) {
        if (!this.elements.statsGrid || !statsData) return;
        
        this.elements.statsGrid.innerHTML = 
            statsData.map(stat => this.deps.config.templates.statItem(stat)).join('');
    }
    
    _updateLessonsSection(lessonsData) {
        if (!this.elements.lessonsList || !lessonsData) return;
        
        const lessonsContainer = this.elements.lessonsList.querySelector('.lessons-container');
        if (lessonsContainer) {
            lessonsContainer.innerHTML = this._renderRecentLessons();
            this._refreshLessonEventListeners();
        }
    }
    
    _updateGoalsSection(goalsData) {
        if (!this.elements.goalsSection || !goalsData) return;
        
        const goalsContainer = this.elements.goalsSection.querySelector('.goals-container');
        if (goalsContainer) {
            goalsContainer.innerHTML = this._renderLearningGoals();
            this._refreshGoalEventListeners();
        }
    }
    
    _refreshLessonEventListeners() {
        this.elements.lessonCards = document.querySelectorAll('.lesson-card');
        this.elements.lessonCards.forEach(card => {
            card.addEventListener('click', this._handleLessonClick);
        });
    }
    
    _refreshGoalEventListeners() {
        this.elements.goalItems = document.querySelectorAll('.goal-item');
        this.elements.goalItems.forEach(goal => {
            goal.querySelector('.goal-edit').addEventListener(
                'click', 
                this._handleGoalUpdate
            );
        });
    }
    
    _animateProgressUpdate(progressData) {
        // پیاده‌سازی انیمیشن به‌روزرسانی پیشرفت
        const progressElement = document.querySelector(
            `[data-lesson-id="${progressData.lessonId}"] .progress-fill`
        );
        
        if (progressElement) {
            progressElement.style.transition = `width ${this.deps.config.defaults.animationDuration}ms ease`;
            progressElement.style.width = `${progressData.newProgress}%`;
            
            // آپدیت متن
            const textElement = progressElement.parentElement.nextElementSibling;
            if (textElement && textElement.classList.contains('progress-text')) {
                textElement.textContent = `${progressData.newProgress}%`;
            }
        }
    }
    
    _cleanupEventListeners() {
        if (this.elements?.lessonCards) {
            this.elements.lessonCards.forEach(card => {
                card.removeEventListener('click', this._handleLessonClick);
            });
        }
        
        window.removeEventListener('resize', this._handleResize);
    }
    
    _cleanupSubscriptions() {
        this.unsubscribe.forEach(unsub => unsub());
        this.unsubscribe = [];
    }
    
    _cleanupDOM() {
        if (this.elements?.container) {
            this.elements.container.innerHTML = '';
        }
    }
    
    _getDefaultData() {
        return {
            user: {
                id: 'guest',
                name: 'کاربر مهمان',
                level: 'مبتدی',
                streak: 0,
                avatar: null
            },
            stats: [
                { type: 'lessons', value: 0, label: 'درس‌های کامل شده', icon: '📚' },
                { type: 'streak', value: 0, label: 'روز متوالی', icon: '🔥' },
                { type: 'accuracy', value: '0%', label: 'میانگین دقت', icon: '🎯' },
                { type: 'time', value: '۰ دقیقه', label: 'زمان مطالعه', icon: '⏱️' }
            ],
            recentLessons: [],
            learningGoals: [
                { 
                    id: 'goal_1', 
                    title: '۳۰ دقیقه مطالعه روزانه', 
                    description: 'هر روز حداقل ۳۰ دقیقه زمان بگذار',
                    progress: 0 
                }
            ]
        };
    }
    
    _isEqual(obj1, obj2) {
        return JSON.stringify(obj1) === JSON.stringify(obj2);
    }
}

// ============ UI RENDERER HELPER ============
class UIRenderer {
    constructor() {
        this.styles = this._getDefaultStyles();
    }
    
    _getDefaultStyles() {
        return `
            <style>
                .dashboard-view {
                    padding: 20px;
                    animation: fadeIn 0.5s ease;
                }
                
                .user-card {
                    display: flex;
                    align-items: center;
                    gap: 15px;
                    padding: 20px;
                    background: linear-gradient(135deg, #0d7377, #14ffec);
                    border-radius: 15px;
                    color: white;
                    margin-bottom: 25px;
                }
                
                .user-avatar {
                    width: 70px;
                    height: 70px;
                    border-radius: 50%;
                    border: 3px solid white;
                }
                
                .stat-card {
                    background: white;
                    padding: 20px;
                    border-radius: 12px;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.1);
                    transition: transform 0.3s ease;
                }
                
                .stat-card:hover {
                    transform: translateY(-5px);
                }
                
                .lesson-card {
                    border: 2px solid #e0e0e0;
                    border-radius: 12px;
                    padding: 18px;
                    transition: all 0.3s ease;
                }
                
                .lesson-card:hover {
                    border-color: #0d7377;
                    box-shadow: 0 6px 16px rgba(13, 115, 119, 0.15);
                }
                
                .progress-bar {
                    height: 8px;
                    background: #e0e0e0;
                    border-radius: 4px;
                    overflow: hidden;
                    margin: 10px 0;
                }
                
                .progress-fill {
                    height: 100%;
                    background: linear-gradient(90deg, #0d7377, #14ffec);
                    transition: width 0.5s ease;
                }
                
                @keyframes fadeIn {
                    from { opacity: 0; transform: translateY(10px); }
                    to { opacity: 1; transform: translateY(0); }
                }
            </style>
        `;
    }
}

// ============ EXPORT PATTERNS ============
export { DashboardView };

// Singleton instance (optional)
export const dashboardView = new DashboardView();

// Auto-initialize if in browser context
if (typeof window !== 'undefined' && !window.VakamovaDashboard) {
    window.VakamovaDashboard = dashboardView;
    console.log('[Dashboard] Auto-initialized global instance');
          }
