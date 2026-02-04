/**
 * لایه امنیتی Auth - مسئول اعتبارسنجی، permission checking، lockout
 */

export class AuthSecurityLayer {
    async validateRegistration(userData) {
        const errors = [];
        
        // اعتبارسنجی ایمیل
        if (!this._isValidEmail(userData.email)) {
            errors.push('ایمیل نامعتبر است');
        }
        
        // اعتبارسنجی رمز عبور
        if (!this._isStrongPassword(userData.password)) {
            errors.push('رمز عبور باید حداقل ۸ کاراکتر و شامل حروف بزرگ و کوچک و اعداد باشد');
        }
        
        return {
            valid: errors.length === 0,
            errors
        };
    }
    
    async validatePassword(password, config) {
        const errors = [];
        
        if (password.length < config.passwordMinLength) {
            errors.push(`رمز عبور باید حداقل ${config.passwordMinLength} کاراکتر باشد`);
        }
        
        if (config.passwordRequireUppercase && !/[A-Z]/.test(password)) {
            errors.push('رمز عبور باید شامل حروف بزرگ باشد');
        }
        
        if (config.passwordRequireNumbers && !/\d/.test(password)) {
            errors.push('رمز عبور باید شامل اعداد باشد');
        }
        
        return {
            valid: errors.length === 0,
            errors
        };
    }
    
    checkLoginLockout(email, loginAttemptsMap) {
        if (!loginAttemptsMap.has(email)) {
            return { locked: false };
        }
        
        const attempts = loginAttemptsMap.get(email);
        const now = Date.now();
        const recentAttempts = attempts.filter(time => now - time < 900000); // 15 دقیقه
        
        if (recentAttempts.length >= 5) {
            const oldest = Math.min(...recentAttempts);
            const remaining = Math.ceil((oldest + 900000 - now) / 1000);
            
            return {
                locked: true,
                remainingTime: remaining,
                attempts: recentAttempts.length
            };
        }
        
        return { locked: false };
    }
    
    recordFailedLogin(email, loginAttemptsMap) {
        if (!loginAttemptsMap.has(email)) {
            loginAttemptsMap.set(email, []);
        }
        
        const attempts = loginAttemptsMap.get(email);
        attempts.push(Date.now());
        
        // فقط ۱۰ تلاش آخر را نگه دار
        if (attempts.length > 10) {
            attempts.splice(0, attempts.length - 10);
        }
    }
    
    checkPermission(permission, context) {
        const { user } = context;
        
        if (!user || !user.role) {
            return false;
        }
        
        // نقش‌های سیستم
        const rolePermissions = {
            admin: ['*'],
            teacher: ['manage_lessons', 'view_reports', 'manage_students'],
            student: ['view_lessons', 'complete_exercises', 'view_progress'],
            guest: ['view_public_content']
        };
        
        const userPermissions = rolePermissions[user.role] || [];
        
        return userPermissions.includes('*') || userPermissions.includes(permission);
    }
    
    sanitizeUserResponse(user) {
        if (!user) return null;
        
        const sanitized = { ...user };
        
        // حذف فیلدهای حساس
        const sensitiveFields = [
            'passwordHash', 'salt', 'resetToken', 
            'verificationToken', 'creditCardInfo'
        ];
        
        sensitiveFields.forEach(field => {
            delete sanitized[field];
        });
        
        return sanitized;
    }
    
    // ==================== متدهای کمکی ====================
    
    _isValidEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }
    
    _isStrongPassword(password) {
        return password.length >= 8 &&
               /[A-Z]/.test(password) &&
               /[a-z]/.test(password) &&
               /\d/.test(password);
    }
    
    maskEmail(email) {
        if (!email || !email.includes('@')) return email;
        
        const [local, domain] = email.split('@');
        const masked = local.length > 2 
            ? `${local[0]}***${local[local.length - 1]}`
            : '***';
            
        return `${masked}@${domain}`;
    }
}
