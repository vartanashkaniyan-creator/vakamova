// ==================== CONTRACTS & VALIDATION ====================
export const Contracts = {
    // قرارداد State Manager
    STATE_MANAGER: {
        requiredMethods: ['getState', 'setState', 'subscribe', 'reset'],
        requiredProperties: ['state', 'history'],
        description: 'State Management Service'
    },
    
    // قرارداد Database
    DATABASE: {
        requiredMethods: ['get', 'set', 'delete', 'getAll'],
        description: 'Database Service'
    },
    
    // قرارداد Router
    ROUTER: {
        requiredMethods: ['navigate', 'getCurrentRoute', 'onRouteChange'],
        description: 'Routing Service'
    }
};

// تابع اعتبارسنجی قرارداد
export function validateContract(service, contractName) {
    const contract = Contracts[contractName];
    if (!contract) {
        throw new Error(`Contract not found: ${contractName}`);
    }
    
    const errors = [];
    
    // بررسی متدهای ضروری
    if (contract.requiredMethods) {
        contract.requiredMethods.forEach(method => {
            if (typeof service[method] !== 'function') {
                errors.push(`Missing required method: ${method}`);
            }
        });
    }
    
    // بررسی خصوصیات ضروری
    if (contract.requiredProperties) {
        contract.requiredProperties.forEach(prop => {
            if (!(prop in service)) {
                errors.push(`Missing required property: ${prop}`);
            }
        });
    }
    
    return {
        isValid: errors.length === 0,
        errors,
        contractName,
        timestamp: new Date().toISOString()
    };
}

// تابع ساده‌تر برای اعتبارسنجی سریع
export function quickValidate(service, requiredMethods = []) {
    for (const method of requiredMethods) {
        if (typeof service[method] !== 'function') {
            return { valid: false, missing: method };
        }
    }
    return { valid: true };
}

console.log('[Contracts] ✅ Contract system initialized');
