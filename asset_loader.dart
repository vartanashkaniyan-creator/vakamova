
import 'dart:async';
import 'dart:io';
import 'package:flutter/services.dart';
import 'package:path_provider/path_provider.dart';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:lang_master/core/app_config.dart';
import 'package:lang_master/data/db.dart';
import 'package:lang_master/data/api_client.dart';

/// 📦 **Enterprise Asset Loader**
/// مدیریت هوشمند دانلود، کش و به‌روزرسانی فایل‌های آفلاین
class AssetLoader {
  // Singleton
  static final AssetLoader _instance = AssetLoader._internal();
  factory AssetLoader() => _instance;
  AssetLoader._internal();

  // Cache management
  final Map<String, CachedAsset> _memoryCache = {};
  final Map<String, List<Completer<Uint8List>>> _pendingRequests = {};
  
  // Download management
  final Map<String, DownloadTask> _activeDownloads = {};
  final List<DownloadTask> _downloadQueue = [];
  
  // Directories
  Directory? _assetsDir;
  Directory? _audioDir;
  Directory? _imagesDir;
  Directory? _dataDir;
  
  // ==================== [INITIALIZATION] ====================
  
  Future<void> initialize() async {
    await _initDirectories();
    await _cleanupOldCache();
    await _verifyExistingAssets();
    
    // Preload essential assets
    unawaited(_preloadCoreAssets());
  }
  
  Future<void> _initDirectories() async {
    final appDir = await getApplicationDocumentsDirectory();
    
    _assetsDir = Directory('${appDir.path}/assets');
    _audioDir = Directory('${_assetsDir!.path}/audio');
    _imagesDir = Directory('${_assetsDir!.path}/images');
    _dataDir = Directory('${_assetsDir!.path}/data');
    
    for (final dir in [_assetsDir, _audioDir, _imagesDir, _dataDir]) {
      if (!await dir!.exists()) {
        await dir.create(recursive: true);
      }
    }
  }
  
  // ==================== [ASSET LOADING] ====================
  
  /// بارگذاری asset از کش یا دانلود
  Future<Uint8List> loadAsset(
    String assetPath, {
    AssetSource source = AssetSource.auto,
    bool cacheInMemory = true,
    int? maxSize,
  }) async {
    // Check memory cache first
    if (cacheInMemory && _memoryCache.containsKey(assetPath)) {
      final cached = _memoryCache[assetPath]!;
      if (!cached.isExpired) {
        return cached.data;
      }
    }
    
    // Check if already being loaded
    if (_pendingRequests.containsKey(assetPath)) {
      final completer = Completer<Uint8List>();
      _pendingRequests[assetPath]!.add(completer);
      return completer.future;
    }
    
    _pendingRequests[assetPath] = [];
    
    try {
      Uint8List data;
      
      switch (source) {
        case AssetSource.local:
          data = await _loadFromLocal(assetPath);
          break;
        
        case AssetSource.bundle:
          data = await _loadFromBundle(assetPath);
          break;
        
        case AssetSource.network:
          data = await _loadFromNetwork(assetPath);
          break;
        
        case AssetSource.auto:
          data = await _loadAuto(assetPath);
          break;
      }
      
      // Validate size
      if (maxSize != null && data.length > maxSize) {
        throw Exception('Asset exceeds maximum size: ${data.length} > $maxSize');
      }
      
      // Cache in memory
      if (cacheInMemory) {
        _memoryCache[assetPath] = CachedAsset(
          data: data,
          cachedAt: DateTime.now(),
          expiry: Duration(hours: 24),
        );
      }
      
      // Notify pending requests
      for (final completer in _pendingRequests[assetPath]!) {
        completer.complete(data);
      }
      
      _pendingRequests.remove(assetPath);
      return data;
      
    } catch (e) {
      // Notify pending requests of failure
      for (final completer in _pendingRequests[assetPath]!) {
        completer.completeError(e);
      }
      
      _pendingRequests.remove(assetPath);
      rethrow;
    }
  }
  
  /// بارگذاری خودکار (اولویت‌بندی شده)
  Future<Uint8List> _loadAuto(String assetPath) async {
    // 1. Try local storage
    try {
      return await _loadFromLocal(assetPath);
    } catch (_) {}
    
    // 2. Try bundle
    try {
      return await _loadFromBundle(assetPath);
    } catch (_) {}
    
    // 3. Try network (if online)
    if (await _isOnline()) {
      return await _loadFromNetwork(assetPath);
    }
    
    throw Exception('Asset not available: $assetPath');
  }
  
  Future<Uint8List> _loadFromLocal(String assetPath) async {
    final file = await _getLocalFile(assetPath);
    
    if (!await file.exists()) {
      throw Exception('Local file not found: $assetPath');
    }
    
    final data = await file.readAsBytes();
    
    // Verify file integrity
    if (!await _verifyFileIntegrity(file, data)) {
      await file.delete();
      throw Exception('File integrity check failed: $assetPath');
    }
    
    return data;
  }
  
  Future<Uint8List> _loadFromBundle(String assetPath) async {
    try {
      return await rootBundle.load(assetPath).then((byteData) => byteData.buffer.asUint8List());
    } catch (e) {
      throw Exception('Bundle asset not found: $assetPath');
    }
  }
  
  Future<Uint8List> _loadFromNetwork(String assetPath) async {
    if (!await _isOnline()) {
      throw Exception('No internet connection');
    }
    
    final api = ApiClient();
    final response = await api.download(
      '${AppConfig.apiBaseUrl}/assets/$assetPath',
      (await _getLocalFile(assetPath)).path,
    );
    
    if (!response.success) {
      throw Exception('Download failed: ${response.error}');
    }
    
    // Load from local storage after download
    return await _loadFromLocal(assetPath);
  }
  
  // ==================== [ASSET MANAGEMENT] ====================
  
  /// پیش‌بارگذاری assetهای ضروری
  Future<void> preloadAssets(List<String> assetPaths) async {
    for (final path in assetPaths) {
      unawaited(loadAsset(path, cacheInMemory: true));
    }
  }
  
  /// بررسی موجود بودن asset
  Future<AssetAvailability> checkAvailability(String assetPath) async {
    // Check memory cache
    if (_memoryCache.containsKey(assetPath)) {
      return AssetAvailability.cached;
    }
    
    // Check local storage
    final localFile = await _getLocalFile(assetPath);
    if (await localFile.exists()) {
      return AssetAvailability.local;
    }
    
    // Check bundle
    try {
      await rootBundle.load(assetPath);
      return AssetAvailability.bundle;
    } catch (_) {}
    
    // Check network
    if (await _isOnline()) {
      return AssetAvailability.remote;
    }
    
    return AssetAvailability.unavailable;
  }
  
  /// دریافت اطلاعات asset
  Future<AssetInfo> getAssetInfo(String assetPath) async {
    final availability = await checkAvailability(assetPath);
    final localFile = await _getLocalFile(assetPath);
    
    int size = 0;
    DateTime? modified;
    
    if (await localFile.exists()) {
      size = await localFile.length();
      modified = await localFile.lastModified();
    }
    
    return AssetInfo(
      path: assetPath,
      availability: availability,
      size: size,
      modified: modified,
      isCached: _memoryCache.containsKey(assetPath),
    );
  }
  
  /// حذف asset از کش
  Future<void> clearAsset(String assetPath, {bool deleteFile = false}) async {
    // Clear from memory cache
    _memoryCache.remove(assetPath);
    
    // Delete local file
    if (deleteFile) {
      final file = await _getLocalFile(assetPath);
      if (await file.exists()) {
        await file.delete();
      }
    }
    
    // Clear from database cache
    final db = AppDatabase();
    await db.secureDelete('cache',
      where: 'key LIKE ?',
      whereArgs: ['asset_${assetPath.replaceAll('/', '_')}_%'],
    );
  }
  
  // ==================== [DOWNLOAD MANAGEMENT] ====================
  
  /// دانلود asset با مدیریت پیشرفته
  Future<DownloadResult> downloadAsset(
    String assetPath, {
    DownloadPriority priority = DownloadPriority.normal,
    ProgressCallback? onProgress,
    bool force = false,
  }) async {
    // Check if already exists
    if (!force) {
      final availability = await checkAvailability(assetPath);
      if (availability == AssetAvailability.local) {
        return DownloadResult(
          success: true,
          path: (await _getLocalFile(assetPath)).path,
          wasCached: true,
        );
      }
    }
    
    // Check if already downloading
    if (_activeDownloads.containsKey(assetPath)) {
      return DownloadResult(
        success: false,
        error: 'Already downloading',
      );
    }
    
    // Create download task
    final task = DownloadTask(
      assetPath: assetPath,
      priority: priority,
      onProgress: onProgress,
    );
    
    // Add to queue or start immediately
    if (_activeDownloads.length >= 3) { // Max concurrent downloads
      _downloadQueue.add(task);
      _downloadQueue.sort((a, b) => b.priority.index - a.priority.index);
      
      return DownloadResult(
        success: true,
        queued: true,
        queuePosition: _downloadQueue.indexOf(task) + 1,
      );
    } else {
      return await _executeDownload(task);
    }
  }
  
  Future<DownloadResult> _executeDownload(DownloadTask task) async {
    _activeDownloads[task.assetPath] = task;
    
    try {
      final api = ApiClient();
      final localFile = await _getLocalFile(task.assetPath);
      
      final response = await api.download(
        '${AppConfig.apiBaseUrl}/assets/${task.assetPath}',
        localFile.path,
        onProgress: task.onProgress,
        cancelToken: task.cancelToken,
      );
      
      _activeDownloads.remove(task.assetPath);
      _startNextDownload();
      
      if (response.success) {
        return DownloadResult(
          success: true,
          path: localFile.path,
          size: await localFile.length(),
        );
      } else {
        return DownloadResult.fromApiResponse(response);
      }
    } catch (e) {
      _activeDownloads.remove(task.assetPath);
      _startNextDownload();
      
      return DownloadResult(
        success: false,
        error: e.toString(),
      );
    }
  }
  
  void _startNextDownload() {
    if (_downloadQueue.isNotEmpty) {
      final nextTask = _downloadQueue.removeAt(0);
      unawaited(_executeDownload(nextTask));
    }
  }
  
  /// لغو دانلود
  void cancelDownload(String assetPath) {
    if (_activeDownloads.containsKey(assetPath)) {
      _activeDownloads[assetPath]!.cancelToken?.cancel();
      _activeDownloads.remove(assetPath);
    }
    
    // Remove from queue
    _downloadQueue.removeWhere((task) => task.assetPath == assetPath);
    
    _startNextDownload();
  }
  
  /// دریافت وضعیت دانلود
  DownloadStatus getDownloadStatus(String assetPath) {
    if (_activeDownloads.containsKey(assetPath)) {
      return DownloadStatus.downloading;
    }
    
    if (_downloadQueue.any((task) => task.assetPath == assetPath)) {
      return DownloadStatus.queued;
    }
    
    return DownloadStatus.none;
  }
  
  // ==================== [BATCH OPERATIONS] ====================
  
  /// دانلود همه assetهای یک زبان
  Future<BatchDownloadResult> downloadLanguageAssets(
    String languageCode, {
    AssetType type = AssetType.all,
  }) async {
    final List<String> assets = await _getLanguageAssets(languageCode, type);
    
    int successCount = 0;
    int failCount = 0;
    final List<DownloadResult> results = [];
    
    for (final asset in assets) {
      final result = await downloadAsset(asset, priority: DownloadPriority.low);
      results.add(result);
      
      if (result.success) {
        successCount++;
      } else {
        failCount++;
      }
    }
    
    return BatchDownloadResult(
      total: assets.length,
      success: successCount,
      failed: failCount,
      results: results,
    );
  }
  
  Future<List<String>> _getLanguageAssets(String languageCode, AssetType type) async {
    // TODO: Get from server or configuration
    return [
      'audio/$languageCode/basic.mp3',
      'images/$languageCode/alphabet.png',
      'data/$languageCode/lessons.json',
    ];
  }
  
  /// محاسبه حجم فایل‌های یک زبان
  Future<int> calculateLanguageSize(String languageCode) async {
    int totalSize = 0;
    
    final assets = await _getLanguageAssets(languageCode, AssetType.all);
    
    for (final asset in assets) {
      final info = await getAssetInfo(asset);
      totalSize += info.size;
    }
    
    return totalSize;
  }
  
  /// حذف همه فایل‌های یک زبان
  Future<void> clearLanguageAssets(String languageCode) async {
    final assets = await _getLanguageAssets(languageCode, AssetType.all);
    
    for (final asset in assets) {
      await clearAsset(asset, deleteFile: true);
    }
    
    // Clear from database
    final db = AppDatabase();
    await db.secureDelete('cache',
      where: 'key LIKE ?',
      whereArgs: ['%$languageCode%'],
    );
  }
  
  // ==================== [MAINTENANCE] ====================
  
  Future<void> _cleanupOldCache() async {
    final cacheDir = _assetsDir;
    if (cacheDir == null) return;
    
    final now = DateTime.now();
    final files = await cacheDir.list().toList();
    
    for (final file in files) {
      if (file is File) {
        final stat = await file.stat();
        final age = now.difference(stat.modified);
        
        // Delete files older than 30 days
        if (age.inDays > 30) {
          await file.delete();
        }
      }
    }
    
    // Clear old memory cache
    _memoryCache.removeWhere((key, value) => value.isExpired);
  }
  
  Future<void> _verifyExistingAssets() async {
    // Verify integrity of important assets
    final importantAssets = [
      'templates/vocabulary.json',
      'templates/quiz.json',
      'languages/en.json',
      'languages/fa.json',
    ];
    
    for (final asset in importantAssets) {
      try {
        await loadAsset(asset, source: AssetSource.local);
      } catch (_) {
        // Re-download if corrupted
        unawaited(downloadAsset(asset, priority: DownloadPriority.high));
      }
    }
  }
  
  Future<void> _preloadCoreAssets() async {
    final coreAssets = [
      'templates/vocabulary.json',
      'templates/quiz.json',
      'templates/conversation.json',
      'config/app_config.json',
    ];
    
    await preloadAssets(coreAssets);
  }
  
  Future<bool> _verifyFileIntegrity(File file, Uint8List data) async {
    // Simple checksum verification
    if (data.isEmpty) return false;
    
    // TODO: Implement proper checksum (CRC32 or MD5)
    return data.length > 0;
  }
  
  // ==================== [UTILITIES] ====================
  
  Future<File> _getLocalFile(String assetPath) async {
    final fileName = assetPath.replaceAll('/', '_');
    final dir = _getDirectoryForType(assetPath);
    return File('${dir!.path}/$fileName');
  }
  
  Directory? _getDirectoryForType(String assetPath) {
    if (assetPath.startsWith('audio/')) return _audioDir;
    if (assetPath.startsWith('images/')) return _imagesDir;
    if (assetPath.startsWith('data/')) return _dataDir;
    return _assetsDir;
  }
  
  Future<bool> _isOnline() async {
    final connectivity = Connectivity();
    final result = await connectivity.checkConnectivity();
    return result != ConnectivityResult.none;
  }
  
  // ==================== [PUBLIC API] ====================
  
  Future<int> getCacheSize() async {
    if (_assetsDir == null) return 0;
    
    int totalSize = 0;
    final files = await _assetsDir!.list(recursive: true).toList();
    
    for (final file in files) {
      if (file is File) {
        totalSize += await file.length();
      }
    }
    
    return totalSize;
  }
  
  Future<void> clearAllCache() async {
    // Clear memory cache
    _memoryCache.clear();
    
    // Clear local files
    if (_assetsDir != null && await _assetsDir!.exists()) {
      await _assetsDir!.delete(recursive: true);
      await _initDirectories();
    }
    
    // Clear database cache
    final db = AppDatabase();
    await db.secureDelete('cache');
  }
  
  Map<String, dynamic> getStatus() {
    return {
      'memory_cache_size': _memoryCache.length,
      'active_downloads': _activeDownloads.length,
      'download_queue': _downloadQueue.length,
      'pending_requests': _pendingRequests.length,
    };
  }
}

// ==================== [SUPPORTING CLASSES] ====================

enum AssetSource {
  local,    // Local storage
  bundle,   // App bundle
  network,  // Download from server
  auto,     // Auto-select best source
}

enum AssetAvailability {
  cached,     // In memory cache
  local,      // In local storage
  bundle,     // In app bundle
  remote,     // Available on server
  unavailable,// Not available
}

enum AssetType {
  audio,
  image,
  data,
  all,
}

enum DownloadPriority {
  low,
  normal,
  high,
}

enum DownloadStatus {
  none,
  queued,
  downloading,
  completed,
  failed,
}

class AssetInfo {
  final String path;
  final AssetAvailability availability;
  final int size;
  final DateTime? modified;
  final bool isCached;
  
  AssetInfo({
    required this.path,
    required this.availability,
    required this.size,
    this.modified,
    required this.isCached,
  });
}

class CachedAsset {
  final Uint8List data;
  final DateTime cachedAt;
  final Duration expiry;
  
  CachedAsset({
    required this.data,
    required this.cachedAt,
    this.expiry = const Duration(hours: 1),
  });
  
  bool get isExpired => DateTime.now().difference(cachedAt) > expiry;
}

class DownloadTask {
  final String assetPath;
  final DownloadPriority priority;
  final ProgressCallback? onProgress;
  final CancelToken? cancelToken = CancelToken();
  final DateTime createdAt = DateTime.now();
  
  DownloadTask({
    required this.assetPath,
    required this.priority,
    this.onProgress,
  });
}

class DownloadResult {
  final bool success;
  final String? path;
  final int? size;
  final String? error;
  final bool wasCached;
  final bool queued;
  final int? queuePosition;
  
  DownloadResult({
    required this.success,
    this.path,
    this.size,
    this.error,
    this.wasCached = false,
    this.queued = false,
    this.queuePosition,
  });
  
  factory DownloadResult.fromApiResponse(ApiResponse response) {
    return DownloadResult(
      success: response.success,
      error: response.error,
    );
  }
}

class BatchDownloadResult {
  final int total;
  final int success;
  final int failed;
  final List<DownloadResult> results;
  
  BatchDownloadResult({
    required this.total,
    required this.success,
    required this.failed,
    required this.results,
  });
}

typedef ProgressCallback = void Function(int received, int total);
