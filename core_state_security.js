/**
 * State Security Module - AES-GCM 256-bit encryption with key management
 * Contract: STATE_SECURITY_CONTRACT
 */

export const STATE_SECURITY_CONTRACT = {
    name: 'state-security',
    version: '2.0.0',
    dependencies: ['eventBus', 'config', 'logger', 'storage'],
    init: 'async function',
    encrypt: 'async function',
    decrypt: 'async function',
    rotateKey: 'async function',
    backupKeys: 'async function',
    restoreKeys: 'async function',
    getKeyInfo: 'function',
    purgeSensitiveData: 'function',
    methods: [
        'encryptState',
        'decryptState',
        'encryptField',
        'decryptField',
        'hashData',
        'generateToken',
        'verifyIntegrity',
        'createSecureChannel'
    ]
};

export class StateSecurity {
    #eventBus;
    #config;
    #logger;
    #storage;
    #cryptoKey = null;
    #keyRotationInterval = null;
    #keyVersion = 1;
    #keyHistory = new Map();
    #keyBackupQueue = [];
    #encryptionAlgorithms = {
        'AES-GCM': { name: 'AES-GCM', length: 256, tagLength: 128 },
        'AES-CBC': { name: 'AES-CBC', length: 256 },
        'RSA-OAEP': { name: 'RSA-OAEP', hash: 'SHA-256' }
    };
    #performanceMetrics = {
        encryptTime: 0,
        decryptTime: 0,
        totalOperations: 0,
        failedOperations: 0
    };

    constructor({ eventBus, config, logger, storage }) {
        if (!eventBus || !config || !logger || !storage) {
            throw new Error('All dependencies required: eventBus, config, logger, storage');
        }
        
        this.#eventBus = eventBus;
        this.#config = config.get('security') || {};
        this.#logger = logger;
        this.#storage = storage;
        
        this.#setupEventListeners();
        this.#logger.info('StateSecurity initialized with DI', { 
            algorithm: this.#config.algorithm || 'AES-GCM',
            keyRotation: this.#config.keyRotation || '30d'
        });
    }

    async init() {
        try {
            await this.#loadOrGenerateKey();
            await this.#loadKeyHistory();
            this.#startKeyRotation();
            this.#startBackupService();
            this.#startHealthMonitor();
            
            this.#eventBus.emit('security:initialized', {
                version: this.#keyVersion,
                algorithm: this.#config.algorithm,
                timestamp: Date.now()
            });
            
            return { success: true, keyVersion: this.#keyVersion };
        } catch (error) {
            this.#logger.error('Failed to initialize StateSecurity', error);
            this.#eventBus.emit('security:initFailed', { error: error.message });
            throw error;
        }
    }

    async encryptState(state, options = {}) {
        const startTime = performance.now();
        const operationId = this.#generateOperationId();
        
        try {
            this.#validateState(state);
            this.#eventBus.emit('security:encryptStart', { 
                operationId, 
                stateSize: JSON.stringify(state).length 
            });

            const algorithm = options.algorithm || this.#config.algorithm || 'AES-GCM';
            const iv = crypto.getRandomValues(new Uint8Array(12));
            const additionalData = options.additionalData || new TextEncoder().encode('HyperLang');
            
            const encrypted = await crypto.subtle.encrypt(
                {
                    name: algorithm,
                    iv,
                    additionalData,
                    tagLength: 128
                },
                this.#cryptoKey,
                new TextEncoder().encode(JSON.stringify(state))
            );

            const result = {
                encrypted: Array.from(new Uint8Array(encrypted)),
                iv: Array.from(iv),
                algorithm,
                keyVersion: this.#keyVersion,
                timestamp: Date.now(),
                operationId,
                metadata: {
                    compressed: options.compress || false,
                    chunked: options.chunked || false,
                    originalSize: JSON.stringify(state).length
                }
            };

            if (options.includeHash) {
                result.hash = await this.#generateHash(state);
            }

            const endTime = performance.now();
            this.#performanceMetrics.encryptTime += endTime - startTime;
            this.#performanceMetrics.totalOperations++;
            
            this.#eventBus.emit('security:encryptComplete', {
                operationId,
                duration: endTime - startTime,
                size: result.encrypted.length,
                success: true
            });

            this.#logger.debug('State encrypted successfully', {
                operationId,
                duration: endTime - startTime,
                size: result.encrypted.length
            });

            return result;
        } catch (error) {
            this.#performanceMetrics.failedOperations++;
            this.#eventBus.emit('security:encryptFailed', {
                operationId,
                error: error.message,
                stateType: typeof state
            });
            this.#logger.error('Encryption failed', { operationId, error });
            throw new Error(`Encryption failed: ${error.message}`);
        }
    }

    async decryptState(encryptedData, options = {}) {
        const startTime = performance.now();
        const operationId = this.#generateOperationId();
        
        try {
            this.#validateEncryptedData(encryptedData);
            this.#eventBus.emit('security:decryptStart', { 
                operationId, 
                dataSize: encryptedData.encrypted.length 
            });

            const key = await this.#getDecryptionKey(encryptedData.keyVersion);
            const iv = new Uint8Array(encryptedData.iv);
            const algorithm = encryptedData.algorithm || 'AES-GCM';
            const additionalData = new TextEncoder().encode('HyperLang');

            const decrypted = await crypto.subtle.decrypt(
                {
                    name: algorithm,
                    iv,
                    additionalData,
                    tagLength: 128
                },
                key,
                new Uint8Array(encryptedData.encrypted)
            );

            const state = JSON.parse(new TextDecoder().decode(decrypted));
            
            if (encryptedData.hash) {
                const currentHash = await this.#generateHash(state);
                if (currentHash !== encryptedData.hash) {
                    throw new Error('Data integrity check failed');
                }
            }

            const endTime = performance.now();
            this.#performanceMetrics.decryptTime += endTime - startTime;
            this.#performanceMetrics.totalOperations++;
            
            this.#eventBus.emit('security:decryptComplete', {
                operationId,
                duration: endTime - startTime,
                success: true
            });

            this.#logger.debug('State decrypted successfully', {
                operationId,
                duration: endTime - startTime
            });

            return state;
        } catch (error) {
            this.#performanceMetrics.failedOperations++;
            this.#eventBus.emit('security:decryptFailed', {
                operationId,
                error: error.message,
                keyVersion: encryptedData.keyVersion
            });
            this.#logger.error('Decryption failed', { operationId, error });
            throw new Error(`Decryption failed: ${error.message}`);
        }
    }

    async rotateKey(force = false) {
        const currentTime = Date.now();
        const lastRotation = this.#keyHistory.get(this.#keyVersion)?.timestamp || 0;
        const rotationInterval = this.#parseRotationInterval(this.#config.keyRotation);
        
        if (!force && (currentTime - lastRotation) < rotationInterval) {
            this.#logger.debug('Key rotation not required yet');
            return false;
        }

        try {
            this.#eventBus.emit('security:keyRotationStart', {
                oldVersion: this.#keyVersion,
                reason: force ? 'forced' : 'scheduled'
            });

            const oldKey = this.#cryptoKey;
            const oldVersion = this.#keyVersion;
            
            await this.#generateNewKey();
            this.#keyVersion++;
            
            this.#keyHistory.set(oldVersion, {
                key: oldKey,
                timestamp: lastRotation,
                retiredAt: currentTime,
                usedFor: this.#performanceMetrics.totalOperations
            });

            await this.#backupKey(oldKey, oldVersion);
            await this.#cleanupOldKeys();
            
            this.#eventBus.emit('security:keyRotationComplete', {
                oldVersion,
                newVersion: this.#keyVersion,
                timestamp: currentTime
            });

            this.#logger.info('Key rotated successfully', {
                from: oldVersion,
                to: this.#keyVersion
            });

            return true;
        } catch (error) {
            this.#eventBus.emit('security:keyRotationFailed', {
                error: error.message,
                currentVersion: this.#keyVersion
            });
            this.#logger.error('Key rotation failed', error);
            throw error;
        }
    }

    async encryptField(data, fieldName, options = {}) {
        if (!data || typeof data !== 'object') {
            throw new Error('Data must be an object');
        }

        if (!fieldName || !data[fieldName]) {
            return data;
        }

        const fieldValue = data[fieldName];
        const encrypted = await this.encryptState({ value: fieldValue }, {
            algorithm: options.algorithm,
            compress: options.compress
        });

        return {
            ...data,
            [fieldName]: {
                encrypted: true,
                data: encrypted,
                field: fieldName,
                encryptedAt: Date.now()
            }
        };
    }

    async decryptField(data, fieldName) {
        if (!data || !data[fieldName] || !data[fieldName].encrypted) {
            return data;
        }

        const encryptedField = data[fieldName];
        const decrypted = await this.decryptState(encryptedField.data);
        
        return {
            ...data,
            [fieldName]: decrypted.value
        };
    }

    async hashData(data, algorithm = 'SHA-256') {
        const encoder = new TextEncoder();
        const dataBuffer = encoder.encode(JSON.stringify(data));
        const hashBuffer = await crypto.subtle.digest(algorithm, dataBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    async generateToken(payload, expiresIn = '7d') {
        const header = {
            alg: 'HS256',
            typ: 'JWT',
            kid: `key-${this.#keyVersion}`
        };

        const expiration = Date.now() + this.#parseTimeInterval(expiresIn);
        const tokenPayload = {
            ...payload,
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(expiration / 1000),
            iss: 'HyperLang-Security'
        };

        const unsignedToken = `${this.#base64UrlEncode(JSON.stringify(header))}.${this.#base64UrlEncode(JSON.stringify(tokenPayload))}`;
        const signature = await this.#signData(unsignedToken);
        
        return `${unsignedToken}.${this.#base64UrlEncode(signature)}`;
    }

    async verifyToken(token) {
        try {
            const [headerB64, payloadB64, signatureB64] = token.split('.');
            const header = JSON.parse(this.#base64UrlDecode(headerB64));
            const payload = JSON.parse(this.#base64UrlDecode(payloadB64));
            const signature = this.#base64UrlDecode(signatureB64);

            const unsignedToken = `${headerB64}.${payloadB64}`;
            const isValid = await this.#verifySignature(unsignedToken, signature, header.kid);

            if (!isValid) {
                throw new Error('Invalid signature');
            }

            if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
                throw new Error('Token expired');
            }

            return { valid: true, payload, header };
        } catch (error) {
            this.#eventBus.emit('security:tokenVerificationFailed', { error: error.message });
            return { valid: false, error: error.message };
        }
    }

    getMetrics() {
        return {
            ...this.#performanceMetrics,
            keyVersion: this.#keyVersion,
            keyHistorySize: this.#keyHistory.size,
            successRate: this.#performanceMetrics.totalOperations > 0 
                ? ((this.#performanceMetrics.totalOperations - this.#performanceMetrics.failedOperations) / this.#performanceMetrics.totalOperations) * 100
                : 100
        };
    }

    purgeSensitiveData() {
        this.#cryptoKey = null;
        this.#keyHistory.clear();
        this.#keyBackupQueue = [];
        
        crypto.subtle.generateKey = function() { throw new Error('Purged'); };
        
        this.#eventBus.emit('security:purged', { timestamp: Date.now() });
        this.#logger.warn('All sensitive data purged from memory');
    }

    async createSecureChannel(targetModule, options = {}) {
        const channelId = this.#generateChannelId();
        const sessionKey = await crypto.subtle.generateKey(
            { name: 'AES-GCM', length: 256 },
            true,
            ['encrypt', 'decrypt']
        );

        const channel = {
            id: channelId,
            sessionKey,
            target: targetModule,
            established: Date.now(),
            expiresAt: Date.now() + (options.timeout || 3600000),
            messageCount: 0,
            secure: true
        };

        this.#eventBus.emit('security:channelEstablished', channel);
        return channel;
    }

    // Private methods
    async #loadOrGenerateKey() {
        try {
            const storedKey = await this.#storage.get('crypto_key_v2');
            if (storedKey) {
                this.#cryptoKey = await crypto.subtle.importKey(
                    'jwk',
                    storedKey,
                    { name: 'AES-GCM', length: 256 },
                    true,
                    ['encrypt', 'decrypt']
                );
                this.#keyVersion = storedKey.version || 1;
                this.#logger.debug('Loaded existing crypto key', { version: this.#keyVersion });
            } else {
                await this.#generateNewKey();
                this.#logger.debug('Generated new crypto key');
            }
        } catch (error) {
            this.#logger.error('Failed to load/generate key', error);
            await this.#generateNewKey();
        }
    }

    async #generateNewKey() {
        this.#cryptoKey = await crypto.subtle.generateKey(
            { name: 'AES-GCM', length: 256 },
            true,
            ['encrypt', 'decrypt']
        );

        const exportedKey = await crypto.subtle.exportKey('jwk', this.#cryptoKey);
        exportedKey.version = this.#keyVersion;
        exportedKey.createdAt = Date.now();
        
        await this.#storage.set('crypto_key_v2', exportedKey);
        await this.#storage.set('crypto_key_backup', {
            ...exportedKey,
            backedUpAt: Date.now(),
            backedUpBy: 'auto'
        });
    }

    async #getDecryptionKey(version) {
        if (version === this.#keyVersion) {
            return this.#cryptoKey;
        }

        const oldKey = this.#keyHistory.get(version)?.key;
        if (oldKey) {
            return oldKey;
        }

        throw new Error(`Decryption key not found for version ${version}`);
    }

    #setupEventListeners() {
        this.#eventBus.on('security:rotateKey', (data) => this.rotateKey(data.force));
        this.#eventBus.on('security:purge', () => this.purgeSensitiveData());
        this.#eventBus.on('security:getMetrics', (data, callback) => {
            callback(this.getMetrics());
        });
        this.#eventBus.on('security:encryptRequest', async (data, callback) => {
            try {
                const result = await this.encryptState(data.state, data.options);
                callback({ success: true, result });
            } catch (error) {
                callback({ success: false, error: error.message });
            }
        });
    }

    #startKeyRotation() {
        if (this.#keyRotationInterval) {
            clearInterval(this.#keyRotationInterval);
        }

        const interval = this.#parseRotationInterval(this.#config.keyRotation || '30d');
        this.#keyRotationInterval = setInterval(() => {
            this.rotateKey(false).catch(error => {
                this.#logger.error('Automatic key rotation failed', error);
            });
        }, interval);

        this.#logger.debug('Key rotation scheduled', { interval });
    }

    #startBackupService() {
        setInterval(() => {
            this.#processBackupQueue().catch(error => {
                this.#logger.error('Backup service failed', error);
            });
        }, 3600000); // Every hour
    }

    #startHealthMonitor() {
        setInterval(() => {
            const metrics = this.getMetrics();
            if (metrics.failedOperations > 10) {
                this.#eventBus.emit('security:healthWarning', {
                    failedOperations: metrics.failedOperations,
                    successRate: metrics.successRate
                });
            }
        }, 300000); // Every 5 minutes
    }

    #generateOperationId() {
        return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    #generateChannelId() {
        return `channel-${Date.now()}-${crypto.getRandomValues(new Uint8Array(4)).join('')}`;
    }

    #validateState(state) {
        if (state === undefined || state === null) {
            throw new Error('State cannot be null or undefined');
        }
        
        try {
            JSON.stringify(state);
        } catch (error) {
            throw new Error(`State is not serializable: ${error.message}`);
        }
    }

    #validateEncryptedData(data) {
        if (!data || !data.encrypted || !data.iv) {
            throw new Error('Invalid encrypted data structure');
        }
        
        if (!Array.isArray(data.encrypted) || !Array.isArray(data.iv)) {
            throw new Error('Encrypted data must be arrays');
        }
        
        if (data.iv.length !== 12) {
            throw new Error('IV must be 12 bytes');
        }
    }

    async #generateHash(data) {
        return this.hashData(data, 'SHA-256');
    }

    async #signData(data) {
        const encoder = new TextEncoder();
        const dataBuffer = encoder.encode(data);
        return crypto.subtle.sign(
            { name: 'HMAC', hash: 'SHA-256' },
            this.#cryptoKey,
            dataBuffer
        );
    }

    async #verifySignature(data, signature, keyId) {
        const encoder = new TextEncoder();
        const dataBuffer = encoder.encode(data);
        const key = await this.#getDecryptionKey(parseInt(keyId.split('-')[1]));
        
        return crypto.subtle.verify(
            { name: 'HMAC', hash: 'SHA-256' },
            key,
            signature,
            dataBuffer
        );
    }

    #base64UrlEncode(str) {
        return btoa(str)
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=/g, '');
    }

    #base64UrlDecode(str) {
        str = str.replace(/-/g, '+').replace(/_/g, '/');
        while (str.length % 4) {
            str += '=';
        }
        return atob(str);
    }

    #parseRotationInterval(interval) {
        const match = interval.match(/^(\d+)([dhm])$/);
        if (!match) return 30 * 24 * 60 * 60 * 1000; // Default 30 days
        
        const [, value, unit] = match;
        const num = parseInt(value);
        
        switch (unit) {
            case 'd': return num * 24 * 60 * 60 * 1000;
            case 'h': return num * 60 * 60 * 1000;
            case 'm': return num * 60 * 1000;
            default: return 30 * 24 * 60 * 60 * 1000;
        }
    }

    #parseTimeInterval(interval) {
        const match = interval.match(/^(\d+)([dhm])$/);
        if (!match) return 7 * 24 * 60 * 60 * 1000; // Default 7 days
        
        const [, value, unit] = match;
        const num = parseInt(value);
        
        switch (unit) {
            case 'd': return num * 24 * 60 * 60 * 1000;
            case 'h': return num * 60 * 60 * 1000;
            case 'm': return num * 60 * 1000;
            default: return 7 * 24 * 60 * 60 * 1000;
        }
    }

    async #backupKey(key, version) {
        this.#keyBackupQueue.push({ key, version, timestamp: Date.now() });
    }

    async #processBackupQueue() {
        while (this.#keyBackupQueue.length > 0) {
            const backup = this.#keyBackupQueue.shift();
            try {
                const exported = await crypto.subtle.exportKey('jwk', backup.key);
                await this.#storage.set(`key_backup_${backup.version}`, {
                    key: exported,
                    version: backup.version,
                    backedUpAt: backup.timestamp
                });
            } catch (error) {
                this.#logger.error(`Failed to backup key ${backup.version}`, error);
            }
        }
    }

    async #loadKeyHistory() {
        const history = await this.#storage.get('key_history') || [];
        for (const item of history) {
            if (item.key && item.version) {
                const importedKey = await crypto.subtle.importKey(
                    'jwk',
                    item.key,
                    { name: 'AES-GCM', length: 256 },
                    false,
                    ['decrypt']
                );
                this.#keyHistory.set(item.version, {
                    key: importedKey,
                    timestamp: item.timestamp,
                    retiredAt: item.retiredAt
                });
            }
        }
    }

    async #cleanupOldKeys() {
        const maxHistory = this.#config.maxKeyHistory || 5;
        if (this.#keyHistory.size > maxHistory) {
            const versions = Array.from(this.#keyHistory.keys())
                .sort((a, b) => a - b);
            
            const toRemove = versions.slice(0, versions.length - maxHistory);
            for (const version of toRemove) {
                this.#keyHistory.delete(version);
                await this.#storage.remove(`key_backup_${version}`);
            }
            
            this.#logger.debug('Cleaned up old keys', { removed: toRemove.length });
        }
    }
}

// Factory function for Dependency Injection
export const createStateSecurity = (dependencies) => {
    return new StateSecurity(dependencies);
};

// Default export with validation
export default (dependencies) => {
    const required = ['eventBus', 'config', 'logger', 'storage'];
    const missing = required.filter(dep => !dependencies[dep]);
    
    if (missing.length > 0) {
        throw new Error(`Missing dependencies: ${missing.join(', ')}`);
    }
    
    return new StateSecurity(dependencies);
};
