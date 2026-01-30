export const STATE_SECURITY_CONTRACT = {
    name: 'state-security',
    version: '1.0.0',
    init: 'async function',
    encrypt: 'function',
    decrypt: 'function',
    rotateKey: 'async function'
};

export class StateSecurity {
    #cryptoKey = null;
    #eventBus;
    #config;
    #keyRotationInterval;

    constructor({ eventBus, config, logger }) {
        this.#eventBus = eventBus;
        this.#config = config;
        this.#logger = logger;
        this.#setupEventListeners();
    }

    async init() {
        await this.#loadOrCreateKey();
        this.#startKeyRotation();
        this.#eventBus.emit('security:initialized');
    }

    async encrypt(data) {
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encrypted = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv },
            this.#cryptoKey,
            new TextEncoder().encode(JSON.stringify(data))
        );
        return { iv: [...iv], data: [...new Uint8Array(encrypted)] };
    }

    async decrypt(encryptedData) {
        const decrypted = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: new Uint8Array(encryptedData.iv) },
            this.#cryptoKey,
            new Uint8Array(encryptedData.data)
        );
        return JSON.parse(new TextDecoder().decode(decrypted));
    }

    #setupEventListeners() {
        this.#eventBus.on('security:rotateKey', () => this.#rotateKey());
        this.#eventBus.on('security:backupKey', () => this.#backupKey());
    }
}
