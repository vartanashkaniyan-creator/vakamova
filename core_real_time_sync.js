/**
 * HyperLang - Real-Time Synchronization System
 * Version: 1.0.0
 * Principles: Dependency Injection + Event-Driven + Interface Contract
 */

import { CONFIG } from './core_config.js';
import { context } from './core_context_provider.js';
import { eventBus } from './core_event_bus.js';

// Real-Time Sync Contract Interface
export const REALTIME_CONTRACT = {
    connection: {
        id: 'string',
        status: 'string', // 'connected', 'connecting', 'disconnected', 'error'
        transport: 'string', // 'websocket', 'polling', 'sse'
        latency: 'number?',
        lastPing: 'number?'
    },
    message: {
        id: 'string',
        type: 'string',
        payload: 'object?',
        timestamp: 'number',
        source: 'string?'
    },
    subscription: {
        id: 'string',
        channel: 'string',
        callback: 'function',
        unsubscribe: 'function'
    }
};

export class RealTimeSync {
    constructor(options = {}) {
        // Dependency Injection
        this.config = context.get('config')?.API || CONFIG.API;
        this.logger = context.get('logger');
        this.eventBus = context.get('eventBus') || eventBus;
        
        // Configuration
        this.options = {
            endpoint: options.endpoint || this.config.WS_ENDPOINT || 'wss://api.hyperlang.com/ws',
            reconnectAttempts: options.reconnectAttempts || 5,
            reconnectDelay: options.reconnectDelay || 3000,
            heartbeatInterval: options.heartbeatInterval || 30000,
            connectionTimeout: options.connectionTimeout || 10000,
            autoConnect: options.autoConnect ?? true,
            transports: options.transports || ['websocket', 'polling', 'sse'],
            debug: options.debug ?? CONFIG.APP.DEBUG,
            ...options
        };
        
        // Connection State
        this.connection = {
            id: null,
            status: 'disconnected',
            transport: null,
            latency: null,
            lastPing: null,
            lastMessage: null,
            reconnectCount: 0
        };
        
        // Internal State
        this.socket = null;
        this.subscriptions = new Map();
        this.messageQueue = [];
        this.heartbeatInterval = null;
        this.reconnectTimeout = null;
        this.messageCallbacks = new Map();
        this.channelSubscriptions = new Map();
        
        // Metrics
        this.metrics = {
            messagesSent: 0,
            messagesReceived: 0,
            connectionTime: 0,
            lastConnected: null,
            errors: []
        };
        
        // Setup
        this.setupEventListeners();
        
        if (this.options.autoConnect) {
            this.connect();
        }
        
        // Register with context
        context.register('realTimeSync', {
            factory: () => this,
            dependencies: ['config', 'logger', 'eventBus'],
            lifecycle: 'singleton'
        });
        
        this.logger?.log('RealTimeSync initialized');
    }
    
    // ==================== CONNECTION MANAGEMENT ====================
    
    async connect() {
        if (this.connection.status === 'connected' || this.connection.status === 'connecting') {
            return false;
        }
        
        this.updateStatus('connecting');
        
        try {
            // Try different transports in order
            for (const transport of this.options.transports) {
                try {
                    await this.connectWithTransport(transport);
                    if (this.connection.status === 'connected') {
                        break;
                    }
                } catch (error) {
                    this.logger?.warn(`Failed to connect with ${transport}:`, error);
                }
            }
            
            if (this.connection.status !== 'connected') {
                throw new Error('All connection attempts failed');
            }
            
            return true;
        } catch (error) {
            this.updateStatus('error', error.message);
            this.scheduleReconnect();
            throw error;
        }
    }
    
    async connectWithTransport(transport) {
        switch (transport) {
            case 'websocket':
                return await this.connectWebSocket();
            case 'sse':
                return await this.connectSSE();
            case 'polling':
                return await this.connectPolling();
            default:
                throw new Error(`Unsupported transport: ${transport}`);
        }
    }
    
    async connectWebSocket() {
        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                reject(new Error('WebSocket connection timeout'));
            }, this.options.connectionTimeout);
            
            try {
                this.socket = new WebSocket(this.options.endpoint);
                
                this.socket.onopen = () => {
                    clearTimeout(timeoutId);
                    this.onWebSocketOpen();
                    resolve();
                };
                
                this.socket.onmessage = (event) => {
                    this.onWebSocketMessage(event);
                };
                
                this.socket.onerror = (error) => {
                    clearTimeout(timeoutId);
                    this.onWebSocketError(error);
                    reject(error);
                };
                
                this.socket.onclose = (event) => {
                    clearTimeout(timeoutId);
                    this.onWebSocketClose(event);
                };
            } catch (error) {
                clearTimeout(timeoutId);
                reject(error);
            }
        });
    }
    
    async connectSSE() {
        // Server-Sent Events implementation
        this.logger?.log('SSE transport not yet implemented');
        throw new Error('SSE not implemented');
    }
    
    async connectPolling() {
        // Long-polling implementation
        this.logger?.log('Polling transport not yet implemented');
        throw new Error('Polling not implemented');
    }
    
    disconnect(reason = 'manual') {
        this.updateStatus('disconnecting');
        
        // Clear intervals
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
        
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }
        
        // Close WebSocket
        if (this.socket) {
            this.socket.close(1000, reason);
            this.socket = null;
        }
        
        this.updateStatus('disconnected');
        
        this.eventBus.emit('realtime:disconnected', {
            reason,
            timestamp: Date.now(),
            connection: { ...this.connection }
        });
        
        return true;
    }
    
    // ==================== MESSAGE HANDLING ====================
    
    send(type, payload = {}, options = {}) {
        if (this.connection.status !== 'connected') {
            if (options.queueIfOffline !== false) {
                this.queueMessage(type, payload, options);
                return { queued: true, messageId: this.generateId() };
            }
            throw new Error('Not connected to real-time server');
        }
        
        const message = {
            id: this.generateId(),
            type,
            payload,
            timestamp: Date.now(),
            metadata: {
                source: 'client',
                priority: options.priority || 'normal',
                requiresAck: options.requiresAck || false,
                ...options.metadata
            }
        };
        
        // Validate message against contract
        this.validateMessage(message);
        
        // Send based on transport
        switch (this.connection.transport) {
            case 'websocket':
                this.sendWebSocket(message);
                break;
            case 'sse':
            case 'polling':
                // Implement for other transports
                break;
        }
        
        this.metrics.messagesSent++;
        
        this.eventBus.emit('realtime:message_sent', {
            messageId: message.id,
            type,
            timestamp: Date.now()
        });
        
        // Wait for acknowledgment if required
        if (options.requiresAck) {
            return this.waitForAck(message.id, options.ackTimeout || 5000);
        }
        
        return { sent: true, messageId: message.id };
    }
    
    sendWebSocket(message) {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            throw new Error('WebSocket not ready');
        }
        
        this.socket.send(JSON.stringify(message));
    }
    
    queueMessage(type, payload, options) {
        const message = {
            id: this.generateId(),
            type,
            payload,
            timestamp: Date.now(),
            metadata: {
                ...options,
                queuedAt: Date.now(),
                attempts: 0
            }
        };
        
        this.messageQueue.push(message);
        
        this.eventBus.emit('realtime:message_queued', {
            messageId: message.id,
            type,
            queueSize: this.messageQueue.length,
            timestamp: Date.now()
        });
        
        return message.id;
    }
    
    processMessageQueue() {
        if (this.connection.status !== 'connected' || this.messageQueue.length === 0) {
            return;
        }
        
        const successful = [];
        const failed = [];
        
        for (const message of [...this.messageQueue]) {
            try {
                this.send(message.type, message.payload, {
                    ...message.metadata,
                    queueIfOffline: false
                });
                
                successful.push(message.id);
                this.messageQueue = this.messageQueue.filter(m => m.id !== message.id);
            } catch (error) {
                message.metadata.attempts++;
                
                if (message.metadata.attempts >= 3) {
                    failed.push({ id: message.id, error: error.message });
                    this.messageQueue = this.messageQueue.filter(m => m.id !== message.id);
                }
            }
        }
        
        if (successful.length > 0 || failed.length > 0) {
            this.eventBus.emit('realtime:queue_processed', {
                successful: successful.length,
                failed: failed.length,
                remaining: this.messageQueue.length,
                timestamp: Date.now()
            });
        }
    }
    
    // ==================== SUBSCRIPTION SYSTEM ====================
    
    subscribe(channel, callback) {
        const subscriptionId = this.generateId();
        
        if (!this.channelSubscriptions.has(channel)) {
            this.channelSubscriptions.set(channel, new Map());
        }
        
        const channelSubs = this.channelSubscriptions.get(channel);
        channelSubs.set(subscriptionId, callback);
        
        // Subscribe on server if connected
        if (this.connection.status === 'connected') {
            this.send('subscribe', { channel }, { priority: 'high' });
        }
        
        this.eventBus.emit('realtime:subscribed', {
            channel,
            subscriptionId,
            timestamp: Date.now()
        });
        
        return {
            id: subscriptionId,
            channel,
            unsubscribe: () => this.unsubscribe(channel, subscriptionId)
        };
    }
    
    unsubscribe(channel, subscriptionId) {
        const channelSubs = this.channelSubscriptions.get(channel);
        if (!channelSubs) return false;
        
        const removed = channelSubs.delete(subscriptionId);
        
        if (channelSubs.size === 0) {
            this.channelSubscriptions.delete(channel);
            
            // Unsubscribe from server if connected
            if (this.connection.status === 'connected') {
                this.send('unsubscribe', { channel }, { priority: 'high' });
            }
        }
        
        if (removed) {
            this.eventBus.emit('realtime:unsubscribed', {
                channel,
                subscriptionId,
                timestamp: Date.now()
            });
        }
        
        return removed;
    }
    
    // ==================== EVENT HANDLERS ====================
    
    onWebSocketOpen() {
        this.connection.id = this.generateId();
        this.connection.transport = 'websocket';
        this.connection.lastPing = Date.now();
        this.connection.reconnectCount = 0;
        
        this.updateStatus('connected');
        
        // Start heartbeat
        this.startHeartbeat();
        
        // Process queued messages
        this.processMessageQueue();
        
        // Resubscribe to channels
        this.resubscribeChannels();
        
        this.eventBus.emit('realtime:connected', {
            connection: { ...this.connection },
            timestamp: Date.now()
        });
        
        this.logger?.log('WebSocket connected');
    }
    
    onWebSocketMessage(event) {
        try {
            const message = JSON.parse(event.data);
            
            // Validate message
            this.validateMessage(message);
            
            this.metrics.messagesReceived++;
            this.connection.lastMessage = Date.now();
            
            // Update latency if ping response
            if (message.type === 'pong') {
                this.updateLatency(message.payload?.timestamp);
            }
            
            // Route message
            this.routeMessage(message);
            
            this.eventBus.emit('realtime:message_received', {
                messageId: message.id,
                type: message.type,
                timestamp: Date.now()
            });
            
        } catch (error) {
            this.logger?.error('Failed to process WebSocket message:', error);
            this.metrics.errors.push({
                type: 'message_parse',
                error: error.message,
                timestamp: Date.now()
            });
        }
    }
    
    onWebSocketError(error) {
        this.logger?.error('WebSocket error:', error);
        
        this.metrics.errors.push({
            type: 'websocket_error',
            error: error.message || 'Unknown WebSocket error',
            timestamp: Date.now()
        });
        
        this.eventBus.emit('realtime:error', {
            type: 'websocket',
            error: error.message,
            timestamp: Date.now()
        });
    }
    
    onWebSocketClose(event) {
        this.logger?.log(`WebSocket closed: ${event.code} ${event.reason}`);
        
        this.updateStatus('disconnected');
        
        // Stop heartbeat
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
        
        this.eventBus.emit('realtime:closed', {
            code: event.code,
            reason: event.reason,
            wasClean: event.wasClean,
            timestamp: Date.now()
        });
        
        // Schedule reconnect if not clean close
        if (!event.wasClean && event.code !== 1000) {
            this.scheduleReconnect();
        }
    }
    
    // ==================== MESSAGE ROUTING ====================
    
    routeMessage(message) {
        const { type, payload, metadata } = message;
        
        // 1. Check for direct callbacks
        if (this.messageCallbacks.has(type)) {
            const callback = this.messageCallbacks.get(type);
            try {
                callback(payload, metadata);
            } catch (error) {
                this.logger?.error(`Callback error for ${type}:`, error);
            }
        }
        
        // 2. Check for channel subscriptions
        if (type === 'channel_message' && payload?.channel) {
            this.routeChannelMessage(payload.channel, payload.message, metadata);
        }
        
        // 3. Emit to event bus
        this.eventBus.emit(`realtime:${type}`, { payload, metadata, timestamp: Date.now() });
        
        // 4. Global handler
        this.eventBus.emit('realtime:message', {
            type,
            payload,
            metadata,
            timestamp: Date.now()
        });
    }
    
    routeChannelMessage(channel, message, metadata) {
        const channelSubs = this.channelSubscriptions.get(channel);
        if (!channelSubs) return;
        
        for (const callback of channelSubs.values()) {
            try {
                callback(message, metadata);
            } catch (error) {
                this.logger?.error(`Channel callback error for ${channel}:`, error);
            }
        }
    }
    
    // ==================== HEARTBEAT AND CONNECTION HEALTH ====================
    
    startHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }
        
        this.heartbeatInterval = setInterval(() => {
            this.sendHeartbeat();
        }, this.options.heartbeatInterval);
    }
    
    sendHeartbeat() {
        if (this.connection.status !== 'connected') return;
        
        const pingTime = Date.now();
        
        this.send('ping', { timestamp: pingTime }, {
            priority: 'high',
            requiresAck: true,
            ackTimeout: 10000
        }).then(() => {
            // Pong received, latency already updated
        }).catch(error => {
            this.logger?.warn('Heartbeat failed:', error);
            this.checkConnectionHealth();
        });
    }
    
    updateLatency(pingTime) {
        if (!pingTime) return;
        
        const now = Date.now();
        this.connection.latency = now - pingTime;
        this.connection.lastPing = now;
        
        // Emit latency update
        this.eventBus.emit('realtime:latency_update', {
            latency: this.connection.latency,
            timestamp: Date.now()
        });
    }
    
    checkConnectionHealth() {
        const now = Date.now();
        const timeSinceLastMessage = now - (this.connection.lastMessage || now);
        const timeSinceLastPing = now - (this.connection.lastPing || now);
        
        if (timeSinceLastMessage > 60000 || timeSinceLastPing > 45000) {
            this.logger?.warn('Connection appears stale, reconnecting...');
            this.disconnect('stale_connection');
            this.scheduleReconnect();
        }
    }
    
    // ==================== RECONNECTION LOGIC ====================
    
    scheduleReconnect() {
        if (this.reconnectTimeout || this.connection.status === 'connecting') {
            return;
        }
        
        this.connection.reconnectCount++;
        
        if (this.connection.reconnectCount > this.options.reconnectAttempts) {
            this.logger?.error('Max reconnection attempts reached');
            this.eventBus.emit('realtime:reconnect_failed', {
                attempts: this.connection.reconnectCount,
                timestamp: Date.now()
            });
            return;
        }
        
        const delay = this.calculateReconnectDelay();
        
        this.reconnectTimeout = setTimeout(() => {
            this.reconnectTimeout = null;
            this.connect().catch(error => {
                this.logger?.error('Reconnect failed:', error);
                this.scheduleReconnect();
            });
        }, delay);
        
        this.eventBus.emit('realtime:reconnect_scheduled', {
            attempt: this.connection.reconnectCount,
            delay,
            timestamp: Date.now()
        });
    }
    
    calculateReconnectDelay() {
        // Exponential backoff with jitter
        const baseDelay = this.options.reconnectDelay;
        const maxDelay = 30000; // 30 seconds
        const exponent = Math.min(this.connection.reconnectCount, 5);
        const delay = Math.min(baseDelay * Math.pow(2, exponent), maxDelay);
        
        // Add jitter (±20%)
        const jitter = delay * 0.2;
        return delay + (Math.random() * jitter * 2 - jitter);
    }
    
    // ==================== UTILITY METHODS ====================
    
    updateStatus(status, error = null) {
        const oldStatus = this.connection.status;
        this.connection.status = status;
        
        if (error) {
            this.connection.lastError = {
                message: error,
                timestamp: Date.now()
            };
        }
        
        this.eventBus.emit('realtime:status_changed', {
            oldStatus,
            newStatus: status,
            error,
            timestamp: Date.now(),
            connection: { ...this.connection }
        });
        
        // Also emit to global event bus
        this.eventBus.emit('realtime:connection_update', {
            status,
            connection: { ...this.connection }
        });
    }
    
    generateId() {
        return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    
    resubscribeChannels() {
        if (this.channelSubscriptions.size === 0) return;
        
        for (const [channel] of this.channelSubscriptions) {
            this.send('subscribe', { channel }, { priority: 'high' });
        }
        
        this.logger?.log(`Resubscribed to ${this.channelSubscriptions.size} channels`);
    }
    
    // ==================== VALIDATION ====================
    
    validateMessage(message) {
        if (!message || typeof message !== 'object') {
            throw new Error('Message must be an object');
        }
        
        const required = ['id', 'type', 'timestamp'];
        const missing = required.filter(field => !message[field]);
        
        if (missing.length > 0) {
            throw new Error(`Message missing required fields: ${missing.join(', ')}`);
        }
        
        if (typeof message.type !== 'string') {
            throw new Error('Message type must be a string');
        }
        
        if (typeof message.timestamp !== 'number') {
            throw new Error('Message timestamp must be a number');
        }
        
        return true;
    }
    
    // ==================== ACKNOWLEDGMENT SYSTEM ====================
    
    waitForAck(messageId, timeout = 5000) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                cleanup();
                reject(new Error(`Acknowledgment timeout for message ${messageId}`));
            }, timeout);
            
            const cleanup = () => {
                clearTimeout(timer);
                this.messageCallbacks.delete(`ack_${messageId}`);
            };
            
            this.messageCallbacks.set(`ack_${messageId}`, (payload) => {
                cleanup();
                resolve({ acknowledged: true, payload });
            });
            
            // Also listen for ack events
            const unsubscribe = this.eventBus.once(`realtime:ack_${messageId}`, (event) => {
                cleanup();
                resolve({ acknowledged: true, payload: event.payload });
            });
            
            // Ensure cleanup on promise settlement
            Promise.resolve().then(() => {}).catch(() => {}).finally(() => {
                // Cleanup will be called by timer or callback
            });
        });
    }
    
    // ==================== METRICS AND DIAGNOSTICS ====================
    
    getMetrics() {
        return {
            ...this.metrics,
            connection: { ...this.connection },
            subscriptions: this.channelSubscriptions.size,
            queuedMessages: this.messageQueue.length,
            uptime: this.metrics.lastConnected 
                ? Date.now() - this.metrics.lastConnected 
                : 0
        };
    }
    
    getDiagnostics() {
        const now = Date.now();
        const isHealthy = this.connection.status === 'connected';
        const timeSinceLastMessage = now - (this.connection.lastMessage || now);
        const timeSinceLastPing = now - (this.connection.lastPing || now);
        
        return {
            healthy: isHealthy,
            status: this.connection.status,
            transport: this.connection.transport,
            latency: this.connection.latency,
            timeSinceLastMessage,
            timeSinceLastPing,
            reconnectAttempts: this.connection.reconnectCount,
            subscriptions: this.channelSubscriptions.size,
            queuedMessages: this.messageQueue.length,
            errors: this.metrics.errors.length
        };
    }
    
    // ==================== CONTRACT VALIDATION ====================
    
    validateContract() {
        const errors = [];
        
        // Check required methods
        const requiredMethods = ['connect', 'disconnect', 'send', 'subscribe', 'unsubscribe'];
        requiredMethods.forEach(method => {
            if (typeof this[method] !== 'function') {
                errors.push(`Missing required method: ${method}`);
            }
        });
        
        // Validate current connection against contract
        if (this.connection) {
            for (const [key, type] of Object.entries(REALTIME_CONTRACT.connection)) {
                if (!key.endsWith('?') && this.connection[key] === undefined) {
                    errors.push(`Connection missing required field: ${key}`);
                }
            }
        }
        
        return {
            valid: errors.length === 0,
            errors,
            contract: REALTIME_CONTRACT,
            timestamp: new Date().toISOString()
        };
    }
    
    // ==================== EVENT BUS INTEGRATION ====================
    
    setupEventListeners() {
        // Listen for application events that require real-time updates
        this.eventBus.on('user:authenticated', () => {
            if (this.connection.status === 'disconnected') {
                this.connect();
            }
        });
        
        this.eventBus.on('user:logged_out', () => {
            this.disconnect('user_logged_out');
        });
        
        this.eventBus.on('network:online', () => {
            if (this.connection.status === 'disconnected') {
                this.connect();
            }
        });
        
        this.eventBus.on('network:offline', () => {
            this.disconnect('network_offline');
        });
        
        // Forward real-time events to global event bus
        const forwardEvents = [
            'connected', 'disconnected', 'message', 'error', 'status_changed'
        ];
        
        forwardEvents.forEach(event => {
            this.eventBus.on(`realtime:${event}`, (data) => {
                this.eventBus.emit(`system:realtime_${event}`, data);
            });
        });
    }
    
    // ==================== LIFECYCLE ====================
    
    destroy() {
        this.disconnect('destroyed');
        
        // Clear all intervals and timeouts
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }
        
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
        }
        
        // Clear all subscriptions
        this.channelSubscriptions.clear();
        this.messageCallbacks.clear();
        this.messageQueue = [];
        
        // Remove from context
        context.remove('realTimeSync');
        
        this.logger?.log('RealTimeSync destroyed');
    }
}

// Singleton instance
export const realTimeSync = new RealTimeSync();

// Register with context
context.registerSingleton('realTimeSync', realTimeSync);

// Export for global use
if (typeof window !== 'undefined') {
    window.realTimeSync = realTimeSync;
}

export default realTimeSync;
