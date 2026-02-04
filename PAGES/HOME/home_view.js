/**
 * VAKAMOVA HOME VIEW - رندر حرفه‌ای صفحه اصلی
 * اصول: ۱. تزریق وابستگی ۲. قرارداد رابط ۳. رویدادمحور ۴. پیکربندی متمرکز
 */

import { LANGUAGE_FLAGS, LANGUAGE_NAMES, getAllLanguages } from '../../core/language_constants.js'; // ← خط جدید اضافه شد

class HomeView {
    constructor(dependencies = {}, config = {}) {
        // اصل ۱: تزریق وابستگی
        this.deps = {
            eventBus: dependencies.eventBus || window.eventBus,
            stateManager: dependencies.stateManager || window.stateManager,
            router: dependencies.router || window.router,
            utils: dependencies.utils || window.utils
        };
        
        // اصل ۴: پیکربندی متمرکز
        this.config = Object.freeze({
            containerId: config.containerId || 'app-content',
            animationSpeed: config.animationSpeed || 300,
            maxStatsCards: config.maxStatsCards || 3,
            recentLessonsLimit: config.recentLessonsLimit || 4,
            languagesToShow: config.languagesToShow || 6, // ← تنظیم جدید: تعداد زبان‌های قابل نمایش
            uiStrings: {
                welcome: 'خوش آمدید',
                dailyGoal: 'هدف روزانه',
                minutes: 'دقیقه',
                continueLearning: 'ادامه یادگیری',
                viewAll: 'مشاهده همه',
                startLesson: 'شروع درس',
                resumeLesson: 'ادامه درس',
                availableLanguages: 'زبان‌های موجود', // ← متن جدید
                seeAllLanguages: 'مشاهده همه زبان‌ها', // ← متن جدید
                ...config.uiStrings
            },
            selectors: {
                lessonGrid: '.lessons-grid',
                statsSection: '.stats-section',
                userWelcome: '.user-welcome',
                quickActions: '.quick-actions',
                languagesGrid: '.languages-grid' // ← سلکتور جدید
            },
            events: {
                LESSON_SELECTED: 'home:lesson:selected',
                QUICK_ACTION: 'home:quick:action',
                VIEW_CHANGED: 'home:view:changed',
                LANGUAGE_SELECTED: 'home:language:selected', // ← رویداد جدید
                ...config.events
            },
            ...config
        });
        
        // حالت داخلی
        this.state = {
            isRendered: false,
            currentUser: null,
            recentLessons: [],
            stats: {},
            availableLanguages: getAllLanguages(), // ← داده‌های زبان‌ها
            domElements: {}
        };
        
        // bind methods
        this.render = this.render.bind(this);
        this.update = this.update.bind(this);
        this.cleanup = this.cleanup.bind(this);
        this._handleLanguageSelect = this._handleLanguageSelect.bind(this); // ← متد جدید
        
        // ثبت درخواست‌های انیمیشن
        this.rafIds = new Set();
        
        console.log('[HomeView] ✅ Initialized with dependency injection');
    }
    
    // ==================== CORE RENDER METHOD ====================
    async render(initialData = {}) {
        if (this.state.isRendered) {
            console.warn('[HomeView] Already rendered, updating instead');
            return this.update(initialData);
        }
        
        try {
            const container = document.getElementById(this.config.containerId);
            if (!container) throw new Error(`Container #${this.config.containerId} not found`);
            
            // دریافت داده‌ها
            await this._loadData(initialData);
            
            // تولید HTML
            const html = this._generateHTML();
            
            // رندر اولیه
            container.innerHTML = html;
            container.style.opacity = '0';
            
            // کش کردن المان‌های DOM
            this._cacheDOMElements();
            
            // ثبت event listeners
            this._attachEventListeners();
            
            // انیمیشن ظاهر شدن
            this._animateEntry(container);
            
            // ثبت رویداد
            this.deps.eventBus.emit(this.config.events.VIEW_CHANGED, {
                view: 'home',
                timestamp: Date.now()
            });
            
            this.state.isRendered = true;
            console.log('[HomeView] ✅ Rendered successfully');
            
            return true;
            
        } catch (error) {
            console.error('[HomeView] ❌ Render failed:', error);
            this._showError(error.message);
            return false;
        }
    }
    
    // ==================== UPDATE METHOD ====================
    async update(newData = {}, options = {}) {
        if (!this.state.isRendered) return this.render(newData);
        
        const updateStart = performance.now();
        const changes = {};
        
        try {
            // شناسایی تغییرات
            if (newData.user && !this._isEqual(this.state.currentUser, newData.user)) {
                changes.user = true;
                this.state.currentUser = newData.user;
            }
            
            if (newData.recentLessons && !this._isEqual(this.state.recentLessons, newData.recentLessons)) {
                changes.lessons = true;
                this.state.recentLessons = newData.recentLessons;
            }
            
            if (newData.stats && !this._isEqual(this.state.stats, newData.stats)) {
                changes.stats = true;
                this.state.stats = newData.stats;
            }
            
            // اعمال بهینه‌سازی شده تغییرات
            await this._applyChanges(changes, options);
            
            const duration = performance.now() - updateStart;
            if (duration > 16) console.log(`[HomeView] Update took ${duration.toFixed(2)}ms`);
            
            return { success: true, changes };
            
        } catch (error) {
            console.error('[HomeView] Update error:', error);
            return { success: false, error: error.message };
        }
    }
    
    // ==================== DATA MANAGEMENT ====================
    async _loadData(initialData) {
        // تلفیق داده‌های اولیه با state manager
        const [user, lessons, stats] = await Promise.allSettled([
            initialData.user || this.deps.stateManager.get('user.current'),
            initialData.recentLessons || this.deps.stateManager.get('user.recentLessons'),
            initialData.stats || this.deps.stateManager.get('user.stats')
        ]);
        
        this.state.currentUser = user.status === 'fulfilled' ? user.value : null;
        this.state.recentLessons = lessons.status === 'fulfilled' ? 
            lessons.value.slice(0, this.config.recentLessonsLimit) : [];
        this.state.stats = stats.status === 'fulfilled' ? stats.value : {};
        
        // بررسی داده‌های ضروری
        if (!this.state.currentUser) {
            throw new Error('User data is required for home view');
        }
    }
    
    // ==================== HTML GENERATION ====================
    _generateHTML() {
        const { currentUser, recentLessons, stats, availableLanguages } = this.state;
        const { uiStrings } = this.config;
        
        // محاسبه زبان‌های قابل نمایش (تا ۶ زبان اول)
        const languagesToShow = availableLanguages.slice(0, this.config.languagesToShow);
        
        return `
            <div class="home-view" data-view="home">
                <!-- Header Section -->
                <header class="home-header">
                    <div class="user-welcome">
                        <div class="avatar-container">
                            <img src="${currentUser.avatar || this._generateDefaultAvatar(currentUser.name)}" 
                                 alt="${currentUser.name}" 
                                 class="user-avatar"
                                 onerror="this.src='data:image/svg+xml,<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 100 100\"><circle cx=\"50\" cy=\"50\" r=\"45\" fill=\"%23666\"/><text x=\"50\" y=\"60\" font-size=\"40\" text-anchor=\"middle\" fill=\"white\">${currentUser.name.charAt(0).toUpperCase()}</text></svg>'">
                            <div class="online-status ${currentUser.isOnline ? 'online' : 'offline'}"></div>
                        </div>
                        <div class="user-info">
                            <h1 class="welcome-title">${uiStrings.welcome}، <span class="user-name">${this._escapeHTML(currentUser.name)}</span>!</h1>
                            <div class="user-meta">
                                <span class="user-level">سطح ${this._escapeHTML(currentUser.level || 'مبتدی')}</span>
                                <span class="streak-count">🔥 ${currentUser.streak || 0} روز متوالی</span>
                            </div>
                        </div>
                    </div>
                    
                    <div class="header-actions">
                        <button class="icon-button notification-btn" aria-label="اعلان‌ها">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                                <path d="M12 22C13.1 22 14 21.1 14 20H10C10 21.1 10.9 22 12 22ZM18 16V11C18 7.93 16.37 5.36 13.5 4.68V4C13.5 3.17 12.83 2.5 12 2.5C11.17 2.5 10.5 3.17 10.5 4V4.68C7.64 5.36 6 7.92 6 11V16L4 18V19H20V18L18 16Z" fill="currentColor"/>
                            </svg>
                        </button>
                    </div>
                </header>
                
                <!-- Stats Cards -->
                <section class="stats-section">
                    ${this._generateStatsCards()}
                </section>
                
                <!-- Available Languages Section (بخش جدید) -->
                <section class="languages-section">
                    <div class="section-header">
                        <h2 class="section-title">${uiStrings.availableLanguages}</h2>
                        <button class="text-button view-all-btn" data-action="view-all-languages">
                            ${uiStrings.seeAllLanguages}
                        </button>
                    </div>
                    
                    <div class="languages-grid">
                        ${languagesToShow.map(lang => this._generateLanguageCard(lang)).join('')}
                    </div>
                </section>
                
                <!-- Quick Actions -->
                <section class="quick-actions-section">
                    <h2 class="section-title">دسترسی سریع</h2>
                    <div class="quick-actions-grid">
                        <button class="quick-action-btn" data-action="practice" aria-label="تمرین سریع">
                            <div class="action-icon">✍️</div>
                            <span class="action-label">تمرین سریع</span>
                        </button>
                        <button class="quick-action-btn" data-action="review" aria-label="مرور کلمات">
                            <div class="action-icon">📖</div>
                            <span class="action-label">مرور کلمات</span>
                        </button>
                        <button class="quick-action-btn" data-action="challenge" aria-label="چالش روزانه">
                            <div class="action-icon">🏆</div>
                            <span class="action-label">چالش روزانه</span>
                        </button>
                        <button class="quick-action-btn" data-action="library" aria-label="کتابخانه">
                            <div class="action-icon">📚</div>
                            <span class="action-label">کتابخانه</span>
                        </button>
                    </div>
                </section>
                
                <!-- Recent Lessons -->
                <section class="lessons-section">
                    <div class="section-header">
                        <h2 class="section-title">${uiStrings.continueLearning}</h2>
                        <button class="text-button view-all-btn" data-action="view-all-lessons">
                            ${uiStrings.viewAll}
                        </button>
                    </div>
                    
                    <div class="lessons-grid">
                        ${recentLessons.length > 0 
                            ? recentLessons.map(lesson => this._generateLessonCard(lesson)).join('')
                            : this._generateEmptyState()
                        }
                    </div>
                </section>
                
                <!-- Daily Goal Progress -->
                ${stats.dailyGoal ? this._generateDailyGoal(stats.dailyGoal) : ''}
                
                <!-- Loading Overlay (hidden by default) -->
                <div class="view-loading" style="display: none;">
                    <div class="loading-spinner"></div>
                </div>
                
                <!-- Error Display (hidden by default) -->
                <div class="view-error" style="display: none;"></div>
            </div>
        `;
    }
    
    // ==================== NEW METHOD: LANGUAGE CARD GENERATION ====================
    _generateLanguageCard(language) {
        return `
            <div class="language-card" data-language-code="${language.code}" role="button" tabindex="0">
                <div class="language-flag">${language.flag}</div>
                <div class="language-info">
                    <h3 class="language-name">${this._escapeHTML(language.name)}</h3>
                    <div class="language-progress">
                        <div class="progress-bar small" role="progressbar" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100">
                            <div class="progress-fill" style="width: 0%"></div>
                        </div>
                        <span class="progress-text">شروع کنید</span>
                    </div>
                </div>
                <button class="language-action-btn" data-language-code="${language.code}" aria-label="شروع یادگیری ${language.name}">
                    شروع
                </button>
            </div>
        `;
    }
    
    _generateStatsCards() {
        const { stats } = this.state;
        const cards = [
            {
                title: 'درس‌های تکمیل شده',
                value: stats.completedLessons || 0,
                icon: '✅',
                color: 'var(--color-success, #4CAF50)'
            },
            {
                title: 'دقیقه‌های مطالعه',
                value: stats.studyMinutes || 0,
                icon: '⏱️',
                color: 'var(--color-primary, #2196F3)'
            },
            {
                title: 'درصد پیشرفت',
                value: `${stats.progressPercent || 0}%`,
                icon: '📈',
                color: 'var(--color-warning, #FF9800)'
            }
        ];
        
        return cards.map(card => `
            <div class="stat-card" style="border-color: ${card.color}">
                <div class="stat-icon" style="color: ${card.color}">${card.icon}</div>
                <div class="stat-content">
                    <div class="stat-value">${card.value}</div>
                    <div class="stat-title">${card.title}</div>
                </div>
            </div>
        `).join('');
    }
    
    _generateLessonCard(lesson) {
        const progress = Math.min(100, (lesson.progress || 0) * 100);
        
        return `
            <div class="lesson-card" data-lesson-id="${lesson.id}" role="article">
                <div class="lesson-card-header">
                    <div class="lesson-thumbnail" style="background-color: ${this._getLanguageColor(lesson.language)}">
                        <span class="language-tag">${this._escapeHTML(lesson.language)}</span>
                        <span class="lesson-level">${this._escapeHTML(lesson.level)}</span>
                    </div>
                    <button class="lesson-menu-btn" aria-label="گزینه‌های درس">
                        ⋮
                    </button>
                </div>
                
                <div class="lesson-card-body">
                    <h3 class="lesson-title">${this._escapeHTML(lesson.title)}</h3>
                    <p class="lesson-description">${this._escapeHTML(lesson.description || '')}</p>
                    
                    <div class="lesson-meta">
                        <span class="meta-item duration">⏱️ ${lesson.duration || 0} دقیقه</span>
                        <span class="meta-item difficulty">⚡ ${this._getDifficultyText(lesson.difficulty)}</span>
                    </div>
                    
                    <div class="lesson-progress">
                        <div class="progress-bar" role="progressbar" aria-valuenow="${progress}" aria-valuemin="0" aria-valuemax="100">
                            <div class="progress-fill" style="width: ${progress}%"></div>
                        </div>
                        <span class="progress-text">${progress}% تکمیل</span>
                    </div>
                </div>
                
                <div class="lesson-card-footer">
                    <button class="btn btn-primary resume-btn" data-lesson-id="${lesson.id}">
                        ${lesson.progress > 0 ? this.config.uiStrings.resumeLesson : this.config.uiStrings.startLesson}
                    </button>
                </div>
            </div>
        `;
    }
    
    _generateDailyGoal(goal) {
        const progress = Math.min(100, (goal.completed / goal.target) * 100);
        
        return `
            <section class="daily-goal-section">
                <h2 class="section-title">${this.config.uiStrings.dailyGoal}</h2>
                <div class="goal-progress">
                    <div class="goal-stats">
                        <div class="goal-current">${goal.completed} ${this.config.uiStrings.minutes}</div>
                        <div class="goal-target">هدف: ${goal.target} ${this.config.uiStrings.minutes}</div>
                    </div>
                    <div class="goal-bar">
                        <div class="goal-fill" style="width: ${progress}%"></div>
                    </div>
                </div>
            </section>
        `;
    }
    
    _generateEmptyState() {
        return `
            <div class="empty-state">
                <div class="empty-state-icon">📚</div>
                <h3 class="empty-state-title">هنوز درسی شروع نکرده‌اید</h3>
                <p class="empty-state-description">با انتخاب یک درس، یادگیری را شروع کنید</p>
                <button class="btn btn-primary" data-action="browse-lessons">
                    جستجوی درس‌ها
                </button>
            </div>
        `;
    }
    
    // ==================== EVENT HANDLING (با افزوده‌های جدید) ====================
    _attachEventListeners() {
        if (!this.state.domElements.container) return;
        
        const container = this.state.domElements.container;
        
        // کلیک روی درس‌ها
        container.addEventListener('click', (e) => {
            const lessonBtn = e.target.closest('.resume-btn');
            if (lessonBtn) {
                const lessonId = lessonBtn.dataset.lessonId;
                this._handleLessonSelect(lessonId);
            }
            
            const lessonCard = e.target.closest('.lesson-card');
            if (lessonCard && !lessonBtn) {
                const lessonId = lessonCard.dataset.lessonId;
                this._handleLessonSelect(lessonId);
            }
            
            // کلیک روی زبان‌ها (افزوده جدید)
            const languageCard = e.target.closest('.language-card');
            if (languageCard) {
                const languageCode = languageCard.dataset.languageCode;
                this._handleLanguageSelect(languageCode);
            }
            
            // کلیک روی دکمه شروع زبان (افزوده جدید)
            const languageBtn = e.target.closest('.language-action-btn');
            if (languageBtn) {
                const languageCode = languageBtn.dataset.languageCode;
                e.stopPropagation();
                this._handleLanguageSelect(languageCode);
            }
        });
        
        // Quick Actions
        container.addEventListener('click', (e) => {
            const actionBtn = e.target.closest('.quick-action-btn');
            if (actionBtn) {
                const action = actionBtn.dataset.action;
                this._handleQuickAction(action);
            }
        });
        
        // View All Lessons
        const viewAllBtn = container.querySelector('.view-all-btn');
        if (viewAllBtn) {
            viewAllBtn.addEventListener('click', (e) => {
                const action = e.target.dataset.action;
                if (action === 'view-all-lessons') {
                    this._handleViewAllLessons();
                } else if (action === 'view-all-languages') {
                    this._handleViewAllLanguages();
                }
            });
        }
        
        // Browse Lessons (از empty state)
        const browseBtn = container.querySelector('[data-action="browse-lessons"]');
        if (browseBtn) {
            browseBtn.addEventListener('click', () => this._handleBrowseLessons());
        }
        
        // رویدادهای کیبورد
        document.addEventListener('keydown', this._handleKeydown.bind(this));
        
        // تغییر وضعیت آنلاین/آفلاین
        window.addEventListener('online', this._handleOnlineStatus.bind(this));
        window.addEventListener('offline', this._handleOnlineStatus.bind(this));
    }
    
    // ==================== NEW METHOD: HANDLE LANGUAGE SELECTION ====================
    _handleLanguageSelect(languageCode) {
        if (!languageCode) return;
        
        // پیدا کردن اطلاعات زبان
        const selectedLanguage = this.state.availableLanguages.find(
            lang => lang.code === languageCode
        );
        
        if (!selectedLanguage) return;
        
        // ارسال رویداد
        this.deps.eventBus.emit(this.config.events.LANGUAGE_SELECTED, {
            languageCode,
            languageName: selectedLanguage.name,
            timestamp: Date.now(),
            userId: this.state.currentUser?.id
        });
        
        // ناوبری به صفحه زبان (می‌تواند به لیست دروس آن زبان هدایت کند)
        if (this.deps.router) {
            this.deps.router.navigateTo(`/language/${languageCode}`);
        }
        
        console.log(`[HomeView] Language selected: ${selectedLanguage.name} (${languageCode})`);
    }
    
    _handleLessonSelect(lessonId) {
        if (!lessonId) return;
        
        this.deps.eventBus.emit(this.config.events.LESSON_SELECTED, {
            lessonId,
            timestamp: Date.now(),
            userId: this.state.currentUser?.id
        });
        
        // ناوبری به صفحه درس
        if (this.deps.router) {
            this.deps.router.navigateTo(`/lesson/${lessonId}`);
        }
    }
    
    _handleQuickAction(action) {
        const actionMap = {
            practice: () => this.deps.router?.navigateTo('/practice'),
            review: () => this.deps.router?.navigateTo('/review'),
            challenge: () => this.deps.router?.navigateTo('/challenge'),
            library: () => this.deps.router?.navigateTo('/library')
        };
        
        if (actionMap[action]) {
            this.deps.eventBus.emit(this.config.events.QUICK_ACTION, {
                action,
                timestamp: Date.now()
            });
            
            actionMap[action]();
        }
    }
    
    _handleViewAllLessons() {
        this.deps.router?.navigateTo('/lessons');
    }
    
    // ==================== NEW METHOD: HANDLE VIEW ALL LANGUAGES ====================
    _handleViewAllLanguages() {
        this.deps.router?.navigateTo('/languages');
    }
    
    _handleBrowseLessons() {
        this.deps.router?.navigateTo('/browse');
    }
    
    _handleKeydown(event) {
        // کلیدهای میانبر صفحه اصلی
        if (event.ctrlKey && event.key === 'h') {
            event.preventDefault();
            this.deps.router?.navigateTo('/home');
        }
    }
    
    _handleOnlineStatus() {
        const statusEl = this.state.domElements.container?.querySelector('.online-status');
        if (statusEl && this.state.currentUser) {
            this.state.currentUser.isOnline = navigator.onLine;
            statusEl.classList.toggle('online', navigator.onLine);
            statusEl.classList.toggle('offline', !navigator.onLine);
        }
    }
    
    // ==================== ANIMATION & EFFECTS ====================
    _animateEntry(container) {
        const rafId = requestAnimationFrame(() => {
            container.style.transition = `opacity ${this.config.animationSpeed}ms ease`;
            container.style.opacity = '1';
            
            // انیمیشن کارت‌ها با تأخیر (شامل کارت‌های زبان جدید)
            const cards = container.querySelectorAll('.stat-card, .lesson-card, .language-card');
            cards.forEach((card, index) => {
                card.style.opacity = '0';
                card.style.transform = 'translateY(20px)';
                
                setTimeout(() => {
                    card.style.transition = `opacity 300ms ease, transform 300ms ease`;
                    card.style.opacity = '1';
                    card.style.transform = 'translateY(0)';
                }, 100 + (index * 50));
            });
        });
        
        this.rafIds.add(rafId);
    }
    
    // ==================== OPTIMIZED UPDATES ====================
    async _applyChanges(changes, options) {
        if (!this.state.domElements.container) return;
        
        const container = this.state.domElements.container;
        const updatePromises = [];
        
        // به‌روزرسانی بخش کاربر
        if (changes.user && this.state.domElements.userWelcome) {
            updatePromises.push(this._updateUserSection());
        }
        
        // به‌روزرسانی آمار
        if (changes.stats && this.state.domElements.statsSection) {
            updatePromises.push(this._updateStatsSection());
        }
        
        // به‌روزرسانی درس‌ها
        if (changes.lessons && this.state.domElements.lessonsGrid) {
            updatePromises.push(this._updateLessonsGrid());
        }
        
        await Promise.allSettled(updatePromises);
        
        // انیمیشن به‌روزرسانی
        if (options.animate !== false) {
            this._animateUpdate();
        }
    }
    
    async _updateUserSection() {
        const userEl = this.state.domElements.userWelcome;
        if (!userEl || !this.state.currentUser) return;
        
        // به‌روزرسانی نام
        const nameEl = userEl.querySelector('.user-name');
        if (nameEl) nameEl.textContent = this.state.currentUser.name;
        
        // به‌روزرسانی سطح
        const levelEl = userEl.querySelector('.user-level');
        if (levelEl) levelEl.textContent = `سطح ${this.state.currentUser.level || 'مبتدی'}`;
        
        // به‌روزرسانی streak
        const streakEl = userEl.querySelector('.streak-count');
        if (streakEl) streakEl.textContent = `🔥 ${this.state.currentUser.streak || 0} روز متوالی`;
    }
    
    async _updateStatsSection() {
        const statsEl = this.state.domElements.statsSection;
        if (!statsEl) return;
        
        const newStatsHTML = this._generateStatsCards();
        if (statsEl.innerHTML !== newStatsHTML) {
            statsEl.innerHTML = newStatsHTML;
        }
    }
    
    async _updateLessonsGrid() {
        const gridEl = this.state.domElements.lessonsGrid;
        if (!gridEl) return;
        
        const newLessonsHTML = this.state.recentLessons.length > 0 
            ? this.state.recentLessons.map(lesson => this._generateLessonCard(lesson)).join('')
            : this._generateEmptyState();
        
        if (gridEl.innerHTML !== newLessonsHTML) {
            gridEl.innerHTML = newLessonsHTML;
        }
    }
    
    _animateUpdate() {
        const container = this.state.domElements.container;
        if (!container) return;
        
        container.style.setProperty('--update-highlight', '1');
        
        setTimeout(() => {
            container.style.setProperty('--update-highlight', '0');
        }, 1000);
    }
    
    // ==================== UTILITY METHODS ====================
    _cacheDOMElements() {
        const container = document.getElementById(this.config.containerId);
        if (!container) return;
        
        this.state.domElements = {
            container,
            userWelcome: container.querySelector(this.config.selectors.userWelcome),
            statsSection: container.querySelector(this.config.selectors.statsSection),
            lessonsGrid: container.querySelector(this.config.selectors.lessonGrid),
            quickActions: container.querySelector(this.config.selectors.quickActions),
            languagesGrid: container.querySelector(this.config.selectors.languagesGrid) // ← المان جدید
        };
    }
    
    _escapeHTML(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    _isEqual(obj1, obj2) {
        if (obj1 === obj2) return true;
        if (!obj1 || !obj2) return false;
        return JSON.stringify(obj1) === JSON.stringify(obj2);
    }
    
    _generateDefaultAvatar(name) {
        const colors = ['FF6B6B', '4ECDC4', '45B7D1', '96CEB4', 'FFEAA7'];
        const color = colors[name.length % colors.length];
        const initial = name.charAt(0).toUpperCase();
        
        return `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
            <rect width="100" height="100" fill="#${color}" rx="20"/>
            <text x="50" y="65" font-size="48" text-anchor="middle" fill="white" font-family="Arial">
                ${initial}
            </text>
        </svg>`;
    }
    
    _getLanguageColor(language) {
        const colorMap = {
            en: '#3498db', fa: '#e74c3c', 'ar-IQ': '#2ecc71',
            tr: '#9b59b6', de: '#e67e22', es: '#1abc9c',
            fr: '#e84393', ru: '#7f8c8d', 'pt-BR': '#c0392b',
            it: '#d35400', 'en-GB': '#27ae60', sv: '#8e44ad',
            nl: '#16a085'
        };
        return colorMap[language] || '#95a5a6';
    }
    
    _getDifficultyText(difficulty) {
        const levels = {
            beginner: 'آسان',
            intermediate: 'متوسط',
            advanced: 'سخت'
        };
        return levels[difficulty] || 'آسان';
    }
    
    _showError(message) {
        const errorEl = this.state.domElements.container?.querySelector('.view-error');
        if (errorEl) {
            errorEl.textContent = message;
            errorEl.style.display = 'block';
            
            setTimeout(() => {
                errorEl.style.display = 'none';
            }, 5000);
        }
    }
    
    // ==================== CLEANUP ====================
    cleanup() {
        // حذف event listeners
        const container = this.state.domElements.container;
        if (container) {
            container.replaceWith(container.cloneNode(false));
        }
        
        // لغو انیمیشن‌ها
        this.rafIds.forEach(id => cancelAnimationFrame(id));
        this.rafIds.clear();
        
        // حذف listeners رویدادهای global
        document.removeEventListener('keydown', this._handleKeydown);
        window.removeEventListener('online', this._handleOnlineStatus);
        window.removeEventListener('offline', this._handleOnlineStatus);
        
        // ریست حالت
        this.state.isRendered = false;
        this.state.domElements = {};
        
        console.log('[HomeView] 🧹 Cleaned up');
    }
}

// Export برای استفاده در ماژول سیستم
if (typeof window !== 'undefined') {
    window.HomeView = HomeView;
}

export { HomeView };
