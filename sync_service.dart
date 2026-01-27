
import 'dart:async';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:lang_master/core/app_config.dart';
import 'package:lang_master/data/db.dart';
import 'package:lang_master/data/api_client.dart';
import 'package:lang_master/data/auth_service.dart';

/// 🔄 **Enterprise Sync Service**
/// همگام‌سازی هوشمند داده‌ها با قابلیت کار آفلاین
class SyncService {
  // Singleton
  static final SyncService _instance = SyncService._internal();
  factory SyncService() => _instance;
  SyncService._internal();

  // Connectivity
  final Connectivity _connectivity = Connectivity();
  StreamSubscription? _connectivitySubscription;
  
  // Sync state
  bool _isSyncing = false;
  DateTime _lastSyncTime = DateTime.now();
  int _pendingSyncCount = 0;
  
  // Sync queues
  final List<SyncJob> _pendingJobs = [];
  final Map<String, SyncJob> _activeJobs = {};
  
  // Listeners
  final List<Function(SyncEvent)> _syncListeners = [];
  
  // Conflict resolution
  ConflictResolutionStrategy _conflictStrategy = ConflictResolutionStrategy.serverWins;
  
  // ==================== [INITIALIZATION] ====================
  
  Future<void> initialize() async {
    await _loadPendingJobs();
    _setupConnectivityListener();
    _startPeriodicSync();
    
    // Auto-sync on app start if online
    if (await _isOnline()) {
      unawaited(syncAll());
    }
  }
  
  Future<void> dispose() async {
    _connectivitySubscription?.cancel();
    await _savePendingJobs();
  }
  
  // ==================== [SYNC ENGINE] ====================
  
  /// همگام‌سازی کامل همه داده‌ها
  Future<SyncResult> syncAll() async {
    if (_isSyncing) {
      return SyncResult(
        success: false,
        error: 'Another sync is in progress',
      );
    }
    
    _isSyncing = true;
    _notifyListeners(SyncEvent.started);
    
    try {
      if (!await _isOnline()) {
        return SyncResult(
          success: false,
          error: 'No internet connection',
          pendingItems: _pendingJobs.length,
        );
      }
      
      // Execute sync jobs in order
      final results = await Future.wait([
        _syncUserProgress(),
        _syncLessons(),
        _syncVocabulary(),
        _syncSettings(),
        _syncAchievements(),
      ]);
      
      // Process pending jobs
      await _processPendingJobs();
      
      // Update last sync time
      _lastSyncTime = DateTime.now();
      
      final successCount = results.where((r) => r.success).length;
      
      _notifyListeners(SyncEvent.completed);
      
      return SyncResult(
        success: successCount > 0,
        syncedItems: successCount,
        pendingItems: _pendingJobs.length,
        lastSyncTime: _lastSyncTime,
      );
      
    } catch (e) {
      _notifyListeners(SyncEvent.failed);
      return SyncResult(
        success: false,
        error: e.toString(),
        pendingItems: _pendingJobs.length,
      );
    } finally {
      _isSyncing = false;
    }
  }
  
  /// همگام‌سازی انتخابی
  Future<SyncResult> syncResource(SyncResource resource) async {
    _notifyListeners(SyncEvent.started);
    
    try {
      if (!await _isOnline()) {
        _queueJob(SyncJob(resource: resource));
        return SyncResult(
          success: false,
          error: 'Queued for offline sync',
          pendingItems: _pendingJobs.length,
        );
      }
      
      SyncResult result;
      
      switch (resource) {
        case SyncResource.progress:
          result = await _syncUserProgress();
          break;
        case SyncResource.lessons:
          result = await _syncLessons();
          break;
        case SyncResource.vocabulary:
          result = await _syncVocabulary();
          break;
        case SyncResource.settings:
          result = await _syncSettings();
          break;
        case SyncResource.achievements:
          result = await _syncAchievements();
          break;
        case SyncResource.payments:
          result = await _syncPayments();
          break;
      }
      
      _lastSyncTime = DateTime.now();
      _notifyListeners(SyncEvent.completed);
      
      return result;
      
    } catch (e) {
      _notifyListeners(SyncEvent.failed);
      return SyncResult(
        success: false,
        error: e.toString(),
      );
    }
  }
  
  // ==================== [RESOURCE SYNC METHODS] ====================
  
  Future<SyncResult> _syncUserProgress() async {
    final db = AppDatabase();
    final api = ApiClient();
    
    try {
      // Get local progress changes
      final localProgress = await db.secureQuery('progress', 
        where: 'sync_status = ?',
        whereArgs: ['pending'],
      );
      
      if (localProgress.isEmpty) {
        return SyncResult(success: true, syncedItems: 0);
      }
      
      // Upload to server
      final response = await api.post('/sync/progress', {
        'progress': localProgress,
        'device_id': await _getDeviceId(),
      });
      
      if (!response.success) {
        return SyncResult.fromApiResponse(response);
      }
      
      // Mark as synced
      for (final progress in localProgress) {
        await db.secureUpdate('progress', {
          'sync_status': 'synced',
          'last_sync': DateTime.now().millisecondsSinceEpoch,
        }, where: 'id = ?', whereArgs: [progress['id']]);
      }
      
      return SyncResult(
        success: true,
        syncedItems: localProgress.length,
      );
      
    } catch (e) {
      return SyncResult(
        success: false,
        error: 'Progress sync failed: $e',
      );
    }
  }
  
  Future<SyncResult> _syncLessons() async {
    final api = ApiClient();
    
    try {
      // Pull updated lessons from server
      final response = await api.get('/sync/lessons', queryParams: {
        'last_sync': _lastSyncTime.millisecondsSinceEpoch,
        'languages': AppConfig().currentLanguage,
      });
      
      if (!response.success) {
        return SyncResult.fromApiResponse(response);
      }
      
      final List<dynamic> serverLessons = response.data['lessons'] ?? [];
      final db = AppDatabase();
      
      int updatedCount = 0;
      
      for (final lessonData in serverLessons) {
        // Check for conflicts
        final localLesson = await db.secureQuery('lessons',
          where: 'id = ?',
          whereArgs: [lessonData['id']],
        );
        
        if (localLesson.isEmpty) {
          // Insert new lesson
          await db.secureInsert('lessons', lessonData);
          updatedCount++;
        } else {
          // Update existing lesson
          await _resolveConflict(localLesson.first, lessonData, 'lessons');
          updatedCount++;
        }
      }
      
      return SyncResult(
        success: true,
        syncedItems: updatedCount,
      );
      
    } catch (e) {
      return SyncResult(
        success: false,
        error: 'Lessons sync failed: $e',
      );
    }
  }
  
  Future<SyncResult> _syncVocabulary() async {
    // Similar implementation to lessons sync
    return SyncResult(success: true, syncedItems: 0);
  }
  
  Future<SyncResult> _syncSettings() async {
    final auth = AuthService();
    final api = ApiClient();
    
    try {
      if (!auth.isAuthenticated) {
        return SyncResult(success: true, syncedItems: 0);
      }
      
      // Get local settings changes
      final localSettings = await _getLocalSettingsChanges();
      
      if (localSettings.isNotEmpty) {
        await api.put('/users/me/settings', localSettings);
      }
      
      // Pull server settings
      final response = await api.get('/users/me/settings');
      
      if (response.success && response.data != null) {
        await _applyServerSettings(response.data);
      }
      
      return SyncResult(
        success: true,
        syncedItems: localSettings.length,
      );
      
    } catch (e) {
      return SyncResult(
        success: false,
        error: 'Settings sync failed: $e',
      );
    }
  }
  
  Future<SyncResult> _syncAchievements() async {
    // Sync user achievements
    return SyncResult(success: true, syncedItems: 0);
  }
  
  Future<SyncResult> _syncPayments() async {
    // Sync payment history and subscriptions
    return SyncResult(success: true, syncedItems: 0);
  }
  
  // ==================== [CONFLICT RESOLUTION] ====================
  
  Future<void> _resolveConflict(
    Map<String, dynamic> localData,
    Map<String, dynamic> serverData,
    String table,
  ) async {
    final db = AppDatabase();
    
    switch (_conflictStrategy) {
      case ConflictResolutionStrategy.serverWins:
        await db.secureUpdate(table, serverData,
          where: 'id = ?',
          whereArgs: [localData['id']],
        );
        break;
        
      case ConflictResolutionStrategy.clientWins:
        // Keep local data, but update sync status
        await db.secureUpdate(table, {
          ...localData,
          'sync_status': 'conflict_resolved',
          'last_sync': DateTime.now().millisecondsSinceEpoch,
        }, where: 'id = ?', whereArgs: [localData['id']]);
        break;
        
      case ConflictResolutionStrategy.merge:
        final mergedData = _mergeData(localData, serverData);
        await db.secureUpdate(table, mergedData,
          where: 'id = ?',
          whereArgs: [localData['id']],
        );
        break;
        
      case ConflictResolutionStrategy.manual:
        // Queue for manual resolution
        _queueJob(SyncJob(
          resource: SyncResource.manualConflict,
          data: {
            'table': table,
            'local': localData,
            'server': serverData,
          },
        ));
        break;
    }
  }
  
  Map<String, dynamic> _mergeData(
    Map<String, dynamic> local,
    Map<String, dynamic> server,
  ) {
    final merged = Map<String, dynamic>.from(local);
    
    server.forEach((key, value) {
      if (key == 'updated_at') {
        // Keep the most recent update
        final localTime = local[key] ?? 0;
        final serverTime = value ?? 0;
        merged[key] = serverTime > localTime ? serverTime : localTime;
      } else if (!_isSystemField(key)) {
        // Prefer server data for non-system fields
        merged[key] = value;
      }
    });
    
    return merged;
  }
  
  bool _isSystemField(String field) {
    const systemFields = {'id', 'created_at', 'sync_status', 'last_sync'};
    return systemFields.contains(field);
  }
  
  // ==================== [OFFLINE QUEUE] ====================
  
  void _queueJob(SyncJob job) {
    _pendingJobs.add(job);
    _pendingSyncCount = _pendingJobs.length;
    
    _notifyListeners(SyncEvent.queued);
    _savePendingJobs();
  }
  
  Future<void> _processPendingJobs() async {
    if (!await _isOnline() || _pendingJobs.isEmpty) return;
    
    for (final job in List.from(_pendingJobs)) {
      try {
        await _executeJob(job);
        _pendingJobs.remove(job);
      } catch (e) {
        job.attempts++;
        job.lastError = e.toString();
        
        if (job.attempts >= 3) {
          _pendingJobs.remove(job);
          _notifyListeners(SyncEvent.failed);
        }
      }
    }
    
    _pendingSyncCount = _pendingJobs.length;
    await _savePendingJobs();
  }
  
  Future<void> _executeJob(SyncJob job) async {
    _activeJobs[job.id] = job;
    
    switch (job.resource) {
      case SyncResource.progress:
        await _syncUserProgress();
        break;
      case SyncResource.lessons:
        await _syncLessons();
        break;
      // Handle other resources...
    }
    
    _activeJobs.remove(job.id);
  }
  
  Future<void> _loadPendingJobs() async {
    // Load from database
    final db = AppDatabase();
    final jobs = await db.secureQuery('sync_queue',
      where: 'status = ?',
      whereArgs: ['pending'],
    );
    
    _pendingJobs.clear();
    for (final jobData in jobs) {
      _pendingJobs.add(SyncJob.fromJson(jobData));
    }
    
    _pendingSyncCount = _pendingJobs.length;
  }
  
  Future<void> _savePendingJobs() async {
    final db = AppDatabase();
    
    await db.secureDelete('sync_queue',
      where: 'status = ?',
      whereArgs: ['pending'],
    );
    
    for (final job in _pendingJobs) {
      await db.secureInsert('sync_queue', job.toJson());
    }
  }
  
  // ==================== [CONNECTIVITY] ====================
  
  void _setupConnectivityListener() {
    _connectivitySubscription = _connectivity.onConnectivityChanged.listen(
      (result) async {
        if (result != ConnectivityResult.none) {
          // Auto-sync when coming back online
          await _processPendingJobs();
          await syncAll();
        }
      },
    );
  }
  
  Future<bool> _isOnline() async {
    final result = await _connectivity.checkConnectivity();
    return result != ConnectivityResult.none;
  }
  
  // ==================== [PERIODIC SYNC] ====================
  
  void _startPeriodicSync() {
    // Sync every 15 minutes when app is active
    Timer.periodic(Duration(minutes: 15), (timer) async {
      if (await _isOnline() && !_isSyncing) {
        unawaited(syncAll());
      }
    });
  }
  
  // ==================== [UTILITIES] ====================
  
  Future<String> _getDeviceId() async {
    // Same as in AuthService
    return 'device_placeholder';
  }
  
  Future<Map<String, dynamic>> _getLocalSettingsChanges() async {
    // Get settings that have changed locally
    return {};
  }
  
  Future<void> _applyServerSettings(Map<String, dynamic> settings) async {
    // Apply server settings to local storage
  }
  
  // ==================== [EVENT SYSTEM] ====================
  
  void addSyncListener(Function(SyncEvent) listener) {
    _syncListeners.add(listener);
  }
  
  void removeSyncListener(Function(SyncEvent) listener) {
    _syncListeners.remove(listener);
  }
  
  void _notifyListeners(SyncEvent event) {
    for (final listener in _syncListeners) {
      listener(event);
    }
  }
  
  // ==================== [PUBLIC API] ====================
  
  bool get isSyncing => _isSyncing;
  int get pendingSyncCount => _pendingSyncCount;
  DateTime get lastSyncTime => _lastSyncTime;
  
  void setConflictStrategy(ConflictResolutionStrategy strategy) {
    _conflictStrategy = strategy;
  }
  
  Future<void> forceSync() async {
    await syncAll();
  }
  
  Future<void> clearPendingSyncs() async {
    _pendingJobs.clear();
    _pendingSyncCount = 0;
    
    final db = AppDatabase();
    await db.secureDelete('sync_queue');
    
    _notifyListeners(SyncEvent.cleared);
  }
  
  Map<String, dynamic> getStatus() {
    return {
      'is_syncing': _isSyncing,
      'pending_jobs': _pendingJobs.length,
      'active_jobs': _activeJobs.length,
      'last_sync': _lastSyncTime.toIso8601String(),
      'strategy': _conflictStrategy.toString(),
    };
  }
}

// ==================== [SUPPORTING CLASSES] ====================

enum SyncResource {
  progress,
  lessons,
  vocabulary,
  settings,
  achievements,
  payments,
  manualConflict,
}

enum SyncEvent {
  started,
  completed,
  failed,
  queued,
  cleared,
}

class SyncResult {
  final bool success;
  final int? syncedItems;
  final int? pendingItems;
  final String? error;
  final DateTime? lastSyncTime;
  
  SyncResult({
    required this.success,
    this.syncedItems = 0,
    this.pendingItems = 0,
    this.error,
    this.lastSyncTime,
  });
  
  factory SyncResult.fromApiResponse(ApiResponse response) {
    return SyncResult(
      success: response.success,
      error: response.error,
    );
  }
}

class SyncJob {
  final String id;
  final SyncResource resource;
  final Map<String, dynamic> data;
  final DateTime createdAt;
  int attempts;
  String? lastError;
  
  SyncJob({
    String? id,
    required this.resource,
    this.data = const {},
    DateTime? createdAt,
    this.attempts = 0,
    this.lastError,
  }) : id = id ?? DateTime.now().microsecondsSinceEpoch.toString(),
       createdAt = createdAt ?? DateTime.now();
  
  factory SyncJob.fromJson(Map<String, dynamic> json) {
    return SyncJob(
      id: json['id'],
      resource: SyncResource.values.firstWhere(
        (e) => e.toString() == json['resource'],
        orElse: () => SyncResource.progress,
      ),
      data: Map<String, dynamic>.from(json['data'] ?? {}),
      createdAt: DateTime.parse(json['created_at']),
      attempts: json['attempts'] ?? 0,
      lastError: json['last_error'],
    );
  }
  
  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'resource': resource.toString(),
      'data': data,
      'created_at': createdAt.toIso8601String(),
      'attempts': attempts,
      'last_error': lastError,
      'status': 'pending',
    };
  }
}

enum ConflictResolutionStrategy {
  serverWins,
  clientWins,
  merge,
  manual,
}

// Helper function
void unawaited(Future<void> future) {
  future.then((_) {}).catchError((_) {});
}
