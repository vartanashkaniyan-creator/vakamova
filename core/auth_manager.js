// core/auth-manager.js
import IAuthManager from './auth-manager-interface.js';
import EventBus from './event-bus.js';
import StateManager from './state-manager.js';

export default class AuthManager extends IAuthManager {
  constructor(stateManager, sessionManager) {
    super();
    this.stateManager = stateManager;
    this.sessionManager = sessionManager;
    this.eventBus = new EventBus();
    this.initState();
  }

  initState() {
    this.stateManager.setState({
      auth: {
        user: null,
        isAuthenticated: false,
        permissions: []
      }
    });
  }

  async register(userData) {
    // اعتبارسنجی و ثبت‌نام
    const newUser = { id: Date.now(), ...userData };
    this.stateManager.setState({ 
      auth: { user: newUser, isAuthenticated: true, permissions: ['user'] }
    });
    this.eventBus.publish('auth:registered', newUser);
    return newUser;
  }

  async login(credentials) {
    // شبیه‌سازی لاگین
    const user = { id: 1, email: credentials.email, permissions: ['user', 'premium'] };
    this.stateManager.setState({
      auth: { user, isAuthenticated: true, permissions: user.permissions }
    });
    this.sessionManager.startSession(user);
    this.eventBus.publish('auth:loggedIn', user);
    return user;
  }

  async logout() {
    const user = this.getCurrentUser();
    this.stateManager.setState({
      auth: { user: null, isAuthenticated: false, permissions: [] }
    });
    this.sessionManager.endSession();
    this.eventBus.publish('auth:loggedOut', user);
  }

  async getCurrentUser() {
    return this.stateManager.getState()?.auth?.user;
  }

  async isAuthenticated() {
    return this.stateManager.getState()?.auth?.isAuthenticated || false;
  }

  async hasPermission(permission) {
    const permissions = this.stateManager.getState()?.auth?.permissions || [];
    return permissions.includes(permission);
  }
}
