
import 'dart:convert';
import 'dart:math';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:local_auth/local_auth.dart';
import 'package:lang_master/core/app_config.dart';
import 'package:lang_master/data/db.dart';
import 'package:lang_master/data/api_client.dart';

/// 🔐 **Enterprise Authentication Service**
/// سیستم کامل احراز هویت با امنیت چندلایه
class AuthService {
  // Singleton
  static final AuthService _instance = AuthService._internal();
  factory AuthService() => _instance;
  AuthService._internal();

  // Secure Storage
  final FlutterSecureStorage _secureStorage = const FlutterSecureStorage();
  final LocalAuthentication _localAuth = LocalAuthentication();
  
  // State
  User? _currentUser;
  String? _accessToken;
  DateTime? _tokenExpiry;
  String? _refreshToken;
  
  // Listeners for auth state changes
  final List<Function(AuthState)> _authListeners = [];
  
  // Login attempts tracking
  final Map<String, LoginAttempt> _loginAttempts = {};
  
  // ==================== [AUTH STATE] ====================
  
  enum AuthState {
    unknown,
    unauthenticated,
    guest,
    authenticated,
    expired,
    locked,
  }
  
  AuthState get currentState {
    if (_currentUser == null) return AuthState.unauthenticated;
    if (_currentUser!.isGuest) return AuthState.guest;
    if (_isTokenExpired()) return AuthState.expired;
    if (_isAccountLocked()) return AuthState.locked;
    return AuthState.authenticated;
  }
  
  User? get currentUser => _currentUser;
  bool get isAuthenticated => currentState == AuthState.authenticated;
  bool get isGuest => currentState == AuthState.guest;
  
  // ==================== [INITIALIZATION] ====================
  
  Future<void> initialize() async {
    await _loadStoredCredentials();
    await _validateExistingSession();
    await _cleanupExpiredAttempts();
    
    // Setup periodic token refresh
    _setupTokenRefresh();
  }
  
  Future<void> _loadStoredCredentials() async {
    try {
      // Load tokens from secure storage
      _accessToken = await _secureStorage.read(key: 'access_token');
      _refreshToken = await _secureStorage.read(key: 'refresh_token');
      
      final expiryStr = await _secureStorage.read(key: 'token_expiry');
      if (expiryStr != null) {
        _tokenExpiry = DateTime.parse(expiryStr);
      }
      
      // Load user data
      final userJson = await _secureStorage.read(key: 'user_data');
      if (userJson != null) {
        _currentUser = User.fromJson(jsonDecode(userJson));
      }
    } catch (e) {
      print('⚠️ Failed to load stored credentials: $e');
      await _clearStoredCredentials();
    }
  }
  
  Future<void> _validateExistingSession() async {
    if (_accessToken == null || _currentUser == null) return;
    
    if (_isTokenExpired()) {
      if (_refreshToken != null) {
        await _refreshAccessToken();
      } else {
        await logout();
      }
    } else {
      // Verify token with server
      final isValid = await _verifyTokenWithServer();
      if (!isValid) {
        await logout();
      }
    }
  }
  
  // ==================== [LOGIN METHODS] ====================
  
  /// ورود با ایمیل/رمزعبور
  Future<LoginResult> loginWithEmail({
    required String email,
    required String password,
    bool rememberMe = false,
    bool requireBiometric = false,
  }) async {
    // Check if account is locked
    if (_isAccountLockedForEmail(email)) {
      return LoginResult(
        success: false,
        error: 'Account is locked. Try again later.',
        remainingAttempts: 0,
      );
    }
    
    // Validate input
    final validationError = _validateLoginInput(email, password);
    if (validationError != null) {
      return LoginResult(success: false, error: validationError);
    }
    
    try {
      // API call
      final response = await ApiClient().post('/auth/login', {
        'email': email,
        'password': password,
        'device_id': await _getDeviceId(),
        'platform': Platform.operatingSystem,
      });
      
      if (!response.success) {
        _recordFailedAttempt(email);
        return LoginResult.fromApiResponse(response);
      }
      
      // Parse tokens
      await _handleLoginResponse(response.data, rememberMe);
      
      // Load user data
      await _loadUserData();
      
      // Biometric authentication if required
      if (requireBiometric && await _isBiometricAvailable()) {
        final bioResult = await _authenticateWithBiometric();
        if (!bioResult) {
          await logout();
          return LoginResult(
            success: false,
            error: 'Biometric authentication failed',
          );
        }
      }
      
      // Clear failed attempts
      _clearFailedAttempts(email);
      
      // Notify listeners
      _notifyAuthStateChange();
      
      return LoginResult(success: true, user: _currentUser);
      
    } catch (e) {
      _recordFailedAttempt(email);
      return LoginResult(
        success: false,
        error: 'Login failed: ${e.toString()}',
      );
    }
  }
  
  /// ورود با شماره تلفن
  Future<LoginResult> loginWithPhone({
    required String phoneNumber,
    required String otp,
    bool rememberMe = false,
  }) async {
    // TODO: Implement phone OTP verification
    return LoginResult(success: false, error: 'Not implemented');
  }
  
  /// ورود مهمان
  Future<LoginResult> loginAsGuest() async {
    try {
      // Generate guest user
      _currentUser = User.guest(
        id: 'guest_${DateTime.now().millisecondsSinceEpoch}',
        deviceId: await _getDeviceId(),
      );
      
      // Generate temporary token
      _accessToken = _generateGuestToken();
      _tokenExpiry = DateTime.now().add(Duration(days: 7));
      
      // Save to secure storage
      await _secureStorage.write(
        key: 'user_data',
        value: jsonEncode(_currentUser!.toJson()),
      );
      
      // Notify listeners
      _notifyAuthStateChange();
      
      return LoginResult(success: true, user: _currentUser);
    } catch (e) {
      return LoginResult(
        success: false,
        error: 'Guest login failed: ${e.toString()}',
      );
    }
  }
  
  /// ورود با سرویس‌های شخص ثالث
  Future<LoginResult> loginWithProvider(AuthProvider provider) async {
    // TODO: Implement Google, Apple, etc. login
    return LoginResult(success: false, error: 'Not implemented');
  }
  
  // ==================== [REGISTRATION] ====================
  
  /// ثبت‌نام کاربر جدید
  Future<RegistrationResult> register({
    required String email,
    required String password,
    String? fullName,
    String? phoneNumber,
    String? referralCode,
  }) async {
    // Validate input
    final validationError = _validateRegistrationInput(email, password, fullName);
    if (validationError != null) {
      return RegistrationResult(success: false, error: validationError);
    }
    
    try {
      // API call
      final response = await ApiClient().post('/auth/register', {
        'email': email,
        'password': password,
        'full_name': fullName,
        'phone': phoneNumber,
        'referral_code': referralCode,
        'device_id': await _getDeviceId(),
        'platform': Platform.operatingSystem,
        'language': AppConfig.defaultLanguage,
      });
      
      if (!response.success) {
        return RegistrationResult.fromApiResponse(response);
      }
      
      // Auto-login after registration
      await _handleLoginResponse(response.data, true);
      await _loadUserData();
      
      _notifyAuthStateChange();
      
      return RegistrationResult(
        success: true,
        user: _currentUser,
        message: 'Registration successful',
      );
      
    } catch (e) {
      return RegistrationResult(
        success: false,
        error: 'Registration failed: ${e.toString()}',
      );
    }
  }
  
  // ==================== [LOGOUT] ====================
  
  /// خروج از حساب کاربری
  Future<void> logout({bool fromAllDevices = false}) async {
    if (isGuest) {
      await _clearGuestData();
    } else if (_accessToken != null) {
      try {
        // Notify server
        await ApiClient().post('/auth/logout', {
          'from_all_devices': fromAllDevices,
        });
      } catch (e) {
        // Silent fail - continue with local logout
      }
    }
    
    // Clear local data
    await _clearStoredCredentials();
    
    // Reset state
    _currentUser = null;
    _accessToken = null;
    _tokenExpiry = null;
    _refreshToken = null;
    
    // Notify listeners
    _notifyAuthStateChange();
  }
  
  Future<void> _clearGuestData() async {
    await _secureStorage.delete(key: 'user_data');
    // TODO: Clear guest-specific data from database
  }
  
  // ==================== [TOKEN MANAGEMENT] ====================
  
  Future<void> _handleLoginResponse(
    Map<String, dynamic> response,
    bool rememberMe,
  ) async {
    _accessToken = response['access_token'];
    _refreshToken = response['refresh_token'];
    
    final expiresIn = response['expires_in'] ?? 3600;
    _tokenExpiry = DateTime.now().add(Duration(seconds: expiresIn));
    
    // Store credentials
    if (rememberMe) {
      await _secureStorage.write(
        key: 'access_token',
        value: _accessToken,
      );
      await _secureStorage.write(
        key: 'refresh_token',
        value: _refreshToken,
      );
      await _secureStorage.write(
        key: 'token_expiry',
        value: _tokenExpiry!.toIso8601String(),
      );
    }
  }
  
  Future<bool> _refreshAccessToken() async {
    if (_refreshToken == null) return false;
    
    try {
      final response = await ApiClient().post('/auth/refresh', {
        'refresh_token': _refreshToken,
        'device_id': await _getDeviceId(),
      });
      
      if (!response.success) {
        return false;
      }
      
      await _handleLoginResponse(response.data, true);
      _notifyAuthStateChange();
      
      return true;
    } catch (e) {
      return false;
    }
  }
  
  Future<bool> _verifyTokenWithServer() async {
    if (_accessToken == null) return false;
    
    try {
      final response = await ApiClient().get(
        '/auth/verify',
        headers: {'Authorization': 'Bearer $_accessToken'},
      );
      
      return response.success;
    } catch (e) {
      return false;
    }
  }
  
  bool _isTokenExpired() {
    if (_tokenExpiry == null) return true;
    return DateTime.now().isAfter(_tokenExpiry!);
  }
  
  String _generateGuestToken() {
    final random = Random.secure();
    final values = List<int>.generate(32, (i) => random.nextInt(256));
    return base64UrlEncode(values);
  }
  
  // ==================== [USER DATA] ====================
  
  Future<void> _loadUserData() async {
    if (_accessToken == null) return;
    
    try {
      final response = await ApiClient().get(
        '/users/me',
        headers: {'Authorization': 'Bearer $_accessToken'},
      );
      
      if (response.success) {
        _currentUser = User.fromJson(response.data);
        
        // Store in secure storage
        await _secureStorage.write(
          key: 'user_data',
          value: jsonEncode(_currentUser!.toJson()),
        );
      }
    } catch (e) {
      print('Failed to load user data: $e');
    }
  }
  
  Future<void> updateUserProfile(Map<String, dynamic> updates) async {
    if (!isAuthenticated) return;
    
    try {
      final response = await ApiClient().put(
        '/users/me',
        updates,
        headers: {'Authorization': 'Bearer $_accessToken'},
      );
      
      if (response.success) {
        await _loadUserData(); // Reload updated data
        _notifyAuthStateChange();
      }
    } catch (e) {
      print('Failed to update profile: $e');
    }
  }
  
  Future<void> changePassword({
    required String oldPassword,
    required String newPassword,
  }) async {
    if (!isAuthenticated) return;
    
    try {
      final response = await ApiClient().post('/auth/change-password', {
        'old_password': oldPassword,
        'new_password': newPassword,
      }, headers: {'Authorization': 'Bearer $_accessToken'});
      
      if (!response.success) {
        throw Exception(response.error ?? 'Password change failed');
      }
    } catch (e) {
      rethrow;
    }
  }
  
  Future<void> requestPasswordReset(String email) async {
    try {
      await ApiClient().post('/auth/forgot-password', {
        'email': email,
      });
    } catch (e) {
      // Silent fail for security
    }
  }
  
  // ==================== [SECURITY] ====================
  
  void _recordFailedAttempt(String identifier) {
    if (!_loginAttempts.containsKey(identifier)) {
      _loginAttempts[identifier] = LoginAttempt();
    }
    
    final attempt = _loginAttempts[identifier]!;
    attempt.count++;
    attempt.lastAttempt = DateTime.now();
    
    // Lock account if too many attempts
    if (attempt.count >= AppConfig.maxLoginAttempts) {
      attempt.lockedUntil = DateTime.now().add(Duration(minutes: 30));
    }
  }
  
  void _clearFailedAttempts(String identifier) {
    _loginAttempts.remove(identifier);
  }
  
  Future<void> _cleanupExpiredAttempts() async {
    final now = DateTime.now();
    _loginAttempts.removeWhere((key, attempt) {
      if (attempt.lockedUntil != null && attempt.lockedUntil!.isBefore(now)) {
        return true;
      }
      // Remove attempts older than 24 hours
      if (attempt.lastAttempt.isBefore(now.subtract(Duration(hours: 24)))) {
        return true;
      }
      return false;
    });
  }
  
  bool _isAccountLockedForEmail(String email) {
    final attempt = _loginAttempts[email];
    if (attempt?.lockedUntil == null) return false;
    return DateTime.now().isBefore(attempt!.lockedUntil!);
  }
  
  bool _isAccountLocked() {
    if (_currentUser == null) return false;
    return _isAccountLockedForEmail(_currentUser!.email ?? '');
  }
  
  int getRemainingAttempts(String identifier) {
    final attempt = _loginAttempts[identifier];
    if (attempt == null) return AppConfig.maxLoginAttempts;
    return AppConfig.maxLoginAttempts - attempt.count;
  }
  
  // ==================== [BIOMETRIC AUTH] ====================
  
  Future<bool> _isBiometricAvailable() async {
    try {
      return await _localAuth.canCheckBiometrics;
    } catch (e) {
      return false;
    }
  }
  
  Future<bool> _authenticateWithBiometric() async {
    try {
      return await _localAuth.authenticate(
        localizedReason: 'Authenticate to access your account',
        options: const AuthenticationOptions(
          biometricOnly: true,
          stickyAuth: true,
        ),
      );
    } catch (e) {
      return false;
    }
  }
  
  Future<void> enableBiometricAuth() async {
    if (!await _isBiometricAvailable()) {
      throw Exception('Biometric authentication not available');
    }
    
    final authenticated = await _authenticateWithBiometric();
    if (!authenticated) {
      throw Exception('Biometric authentication failed');
    }
    
    // Store biometric preference
    await _secureStorage.write(
      key: 'biometric_enabled',
      value: 'true',
    );
  }
  
  Future<void> disableBiometricAuth() async {
    await _secureStorage.delete(key: 'biometric_enabled');
  }
  
  Future<bool> isBiometricEnabled() async {
    final enabled = await _secureStorage.read(key: 'biometric_enabled');
    return enabled == 'true';
  }
  
  // ==================== [DEVICE MANAGEMENT] ====================
  
  Future<String> _getDeviceId() async {
    String? deviceId = await _secureStorage.read(key: 'device_id');
    
    if (deviceId == null) {
      deviceId = 'device_${DateTime.now().millisecondsSinceEpoch}_${Random().nextInt(9999)}';
      await _secureStorage.write(key: 'device_id', value: deviceId);
    }
    
    return deviceId;
  }
  
  Future<List<Map<String, dynamic>>> getActiveSessions() async {
    if (!isAuthenticated) return [];
    
    try {
      final response = await ApiClient().get(
        '/auth/sessions',
        headers: {'Authorization': 'Bearer $_accessToken'},
      );
      
      if (response.success) {
        return List<Map<String, dynamic>>.from(response.data['sessions'] ?? []);
      }
    } catch (e) {
      // Silent fail
    }
    
    return [];
  }
  
  Future<void> terminateSession(String sessionId) async {
    if (!isAuthenticated) return;
    
    await ApiClient().delete(
      '/auth/sessions/$sessionId',
      headers: {'Authorization': 'Bearer $_accessToken'},
    );
  }
  
  // ==================== [UTILITIES] ====================
  
  String? _validateLoginInput(String email, String password) {
    if (email.isEmpty || password.isEmpty) {
      return 'Email and password are required';
    }
    
    if (!_isValidEmail(email)) {
      return 'Please enter a valid email address';
    }
    
    if (password.length < 6) {
      return 'Password must be at least 6 characters';
    }
    
    return null;
  }
  
  String? _validateRegistrationInput(String email, String password, String? fullName) {
    final loginError = _validateLoginInput(email, password);
    if (loginError != null) return loginError;
    
    if (fullName != null && fullName.trim().isEmpty) {
      return 'Full name is required';
    }
    
    return null;
  }
  
  bool _isValidEmail(String email) {
    return RegExp(r'^[^@]+@[^@]+\.[^@]+').hasMatch(email);
  }
  
  Future<void> _clearStoredCredentials() async {
    await _secureStorage.delete(key: 'access_token');
    await _secureStorage.delete(key: 'refresh_token');
    await _secureStorage.delete(key: 'token_expiry');
    await _secureStorage.delete(key: 'user_data');
  }
  
  void _setupTokenRefresh() {
    // Setup periodic token refresh every 5 minutes
    Future.delayed(Duration(minutes: 5), () async {
      if (_isTokenExpired() && _refreshToken != null) {
        await _refreshAccessToken();
      }
      _setupTokenRefresh(); // Reschedule
    });
  }
  
  // ==================== [EVENT SYSTEM] ====================
  
  void addAuthListener(Function(AuthState) listener) {
    _authListeners.add(listener);
  }
  
  void removeAuthListener(Function(AuthState) listener) {
    _authListeners.remove(listener);
  }
  
  void _notifyAuthStateChange() {
    final state = currentState;
    for (final listener in _authListeners) {
      listener(state);
    }
  }
  
  // ==================== [PUBLIC API] ====================
  
  Map<String, dynamic> getAuthHeaders() {
    if (_accessToken == null) return {};
    return {'Authorization': 'Bearer $_accessToken'};
  }
  
  Future<String?> getAccessToken() async {
    if (_isTokenExpired() && _refreshToken != null) {
      await _refreshAccessToken();
    }
    return _accessToken;
  }
  
  Map<String, dynamic> getStatus() {
    return {
      'state': currentState.toString(),
      'user_id': _currentUser?.id,
      'is_guest': isGuest,
      'token_expires_in': _tokenExpiry?.difference(DateTime.now()).inSeconds,
      'failed_attempts': _loginAttempts.length,
      'biometric_enabled': _isBiometricEnabled(),
    };
  }
}

// ==================== [SUPPORTING CLASSES] ====================

class User {
  final String id;
  final String? email;
  final String? phone;
  final String? fullName;
  final String? avatarUrl;
  final int level;
  final int xp;
  final int streakDays;
  final String? subscriptionType;
  final DateTime? subscriptionExpiry;
  final DateTime lastLogin;
  final DateTime createdAt;
  final bool isGuest;
  final Map<String, dynamic>? settings;
  final Map<String, dynamic>? metadata;
  
  User({
    required this.id,
    this.email,
    this.phone,
    this.fullName,
    this.avatarUrl,
    this.level = 1,
    this.xp = 0,
    this.streakDays = 0,
    this.subscriptionType,
    this.subscriptionExpiry,
    required this.lastLogin,
    required this.createdAt,
    this.isGuest = false,
    this.settings,
    this.metadata,
  });
  
  factory User.fromJson(Map<String, dynamic> json) {
    return User(
      id: json['id'],
      email: json['email'],
      phone: json['phone'],
      fullName: json['full_name'],
      avatarUrl: json['avatar_url'],
      level: json['level'] ?? 1,
      xp: json['xp'] ?? 0,
      streakDays: json['streak_days'] ?? 0,
      subscriptionType: json['subscription_type'],
      subscriptionExpiry: json['subscription_expiry'] != null
          ? DateTime.parse(json['subscription_expiry'])
          : null,
      lastLogin: DateTime.parse(json['last_login']),
      createdAt: DateTime.parse(json['created_at']),
      isGuest: json['is_guest'] == true,
      settings: json['settings'] != null
          ? Map<String, dynamic>.from(json['settings'])
          : null,
      metadata: json['metadata'] != null
          ? Map<String, dynamic>.from(json['metadata'])
          : null,
    );
  }
  
  factory User.guest({required String id, required String deviceId}) {
    return User(
      id: id,
      isGuest: true,
      lastLogin: DateTime.now(),
      createdAt: DateTime.now(),
      settings: {
        'device_id': deviceId,
        'language': AppConfig.defaultLanguage,
      },
    );
  }
  
  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'email': email,
      'phone': phone,
      'full_name': fullName,
      'avatar_url': avatarUrl,
      'level': level,
      'xp': xp,
      'streak_days': streakDays,
      'subscription_type': subscriptionType,
      'subscription_expiry': subscriptionExpiry?.toIso8601String(),
      'last_login': lastLogin.toIso8601String(),
      'created_at': createdAt.toIso8601String(),
      'is_guest': isGuest,
      'settings': settings,
      'metadata': metadata,
    };
  }
  
  bool get hasSubscription {
    if (subscriptionExpiry == null) return false;
    return DateTime.now().isBefore(subscriptionExpiry!);
  }
}

class LoginResult {
  final bool success;
  final User? user;
  final String? error;
  final int? remainingAttempts;
  
  LoginResult({
    required this.success,
    this.user,
    this.error,
    this.remainingAttempts,
  });
  
  factory LoginResult.fromApiResponse(ApiResponse response) {
    return LoginResult(
      success: response.success,
      error: response.error,
    );
  }
}

class RegistrationResult {
  final bool success;
  final User? user;
  final String? message;
  final String? error;
  
  RegistrationResult({
    required this.success,
    this.user,
    this.message,
    this.error,
  });
  
  factory RegistrationResult.fromApiResponse(ApiResponse response) {
    return RegistrationResult(
      success: response.success,
      error: response.error,
    );
  }
}

class LoginAttempt {
  int count = 0;
  DateTime lastAttempt = DateTime.now();
  DateTime? lockedUntil;
}

enum AuthProvider {
  google,
  apple,
  facebook,
  twitter,
}
