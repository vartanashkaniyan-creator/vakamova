/**
 * ماژول عملیات هسته Auth - مسئول ثبت‌نام، ورود، خروج
 */

export class AuthCoreOperations {
    async register(userData, options) {
        const { database, config, operationId } = options;
        
        // بررسی تکراری نبودن ایمیل
        const existingUser = await database.query('users', { email: userData.email });
        if (existingUser.length > 0) {
            throw new Error('این ایمیل قبلاً ثبت شده است');
        }
        
        // ایجاد کاربر در دیتابیس
        const user = await database.create('users', {
            email: userData.email,
            name: userData.name || userData.email.split('@')[0],
            passwordHash: await this._hashPassword(userData.password),
            role: 'student',
            isVerified: !config.requireEmailVerification,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        });
        
        // ارسال ایمیل تایید
        if (config.requireEmailVerification) {
            await this._sendVerificationEmail(user);
        }
        
        return {
            success: true,
            user: this._sanitizeUser(user),
            requiresVerification: config.requireEmailVerification,
            operationId
        };
    }
    
    async login(credentials, options) {
        const { database, services, config } = options;
        
        // یافتن کاربر
        const users = await database.query('users', { email: credentials.email });
        if (users.length === 0) {
            throw new Error('ایمیل یا رمز عبور نادرست است');
        }
        
        const user = users[0];
        
        // تأیید رمز عبور
        const passwordValid = await this._verifyPassword(
            credentials.password, 
            user.passwordHash
        );
        
        if (!passwordValid) {
            throw new Error('ایمیل یا رمز عبور نادرست است');
        }
        
        // بررسی وضعیت حساب
        if (!user.isActive) {
            throw new Error('حساب کاربری غیرفعال است');
        }
        
        if (config.requireEmailVerification && !user.isVerified) {
            throw new Error('لطفاً ابتدا ایمیل خود را تایید کنید');
        }
        
        // تولید توکن‌ها
        const tokens = await this._generateTokens(user, config);
        
        // ایجاد session
        await services.sessionService.create({
            userId: user.id,
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            userAgent: options.userAgent,
            ip: options.ip
        });
        
        return {
            success: true,
            user: this._sanitizeUser(user),
            tokens,
            operationId: options.operationId
        };
    }
    
    async logout(options) {
        const { services, operationId } = options;
        
        // باطل کردن session
        await services.sessionService.clear();
        
        // باطل کردن توکن‌ها
        await services.tokenManager.invalidateAll();
        
        return {
            success: true,
            operationId,
            message: 'با موفقیت خارج شدید'
        };
    }
    
    async refreshToken(refreshToken, options) {
        const { services, config } = options;
        
        // اعتبارسنجی refresh token
        const isValid = await services.tokenManager.validate(refreshToken);
        if (!isValid) {
            throw new Error('Refresh token نامعتبر است');
        }
        
        // دریافت اطلاعات کاربر از توکن
        const payload = await services.tokenManager.decode(refreshToken);
        const user = await options.database.get('users', payload.userId);
        
        // تولید توکن‌های جدید
        const newTokens = await this._generateTokens(user, config);
        
        return {
            success: true,
            tokens: newTokens,
            operationId: options.operationId
        };
    }
    
    async verifySession(sessionId, options) {
        const { services, persistence } = options;
        
        if (!sessionId) {
            sessionId = await persistence.getCurrentSessionId();
        }
        
        const session = await services.sessionService.get(sessionId);
        
        if (!session) {
            return { valid: false, reason: 'SESSION_NOT_FOUND' };
        }
        
        if (session.expiresAt < Date.now()) {
            return { valid: false, reason: 'SESSION_EXPIRED' };
        }
        
        const tokenValid = await services.tokenManager.validate(session.accessToken);
        
        return {
            valid: tokenValid,
            user: session.user,
            sessionId
        };
    }
    
    // ==================== متدهای کمکی ====================
    
    async _hashPassword(password) {
        // استفاده از bcrypt یا argon2 در محیط واقعی
        const encoder = new TextEncoder();
        const data = encoder.encode(password);
        const hash = await crypto.subtle.digest('SHA-256', data);
        return Array.from(new Uint8Array(hash))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
    }
    
    async _verifyPassword(password, hash) {
        const newHash = await this._hashPassword(password);
        return newHash === hash;
    }
    
    async _generateTokens(user, config) {
        const accessToken = await this._generateAccessToken(user, config);
        const refreshToken = await this._generateRefreshToken(user, config);
        
        return {
            accessToken,
            refreshToken,
            expiresIn: config.tokenExpiry
        };
    }
    
    async _generateAccessToken(user, config) {
        // در محیط واقعی از JWT یا similar استفاده می‌شود
        const payload = {
            userId: user.id,
            email: user.email,
            role: user.role,
            exp: Math.floor(Date.now() / 1000) + config.tokenExpiry
        };
        
        return btoa(JSON.stringify(payload));
    }
    
    async _generateRefreshToken(user, config) {
        const payload = {
            userId: user.id,
            type: 'refresh',
            exp: Math.floor(Date.now() / 1000) + (config.tokenExpiry * 24) // 24 ساعت
        };
        
        return btoa(JSON.stringify(payload));
    }
    
    _sanitizeUser(user) {
        const sanitized = { ...user };
        delete sanitized.passwordHash;
        delete sanitized.resetToken;
        delete sanitized.verificationToken;
        return sanitized;
    }
    
    async _sendVerificationEmail(user) {
        // در محیط واقعی از سرویس ایمیل استفاده می‌شود
        console.log(`ایمیل تایید به ${user.email} ارسال شد`);
    }
              }
