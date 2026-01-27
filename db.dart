import 'dart:async';
import 'package:sqflite/sqflite.dart';
import 'package:sqflite/sqlite_api.dart';
import 'package:path/path.dart';
import 'package:encrypt/encrypt.dart';
import 'package:lang_master/core/app_config.dart';

/// 🗄️ **Enterprise Database Manager**
/// دیتابیس امن با رمزنگاری سطح بالا
class AppDatabase {
  // Singleton pattern
  static final AppDatabase _instance = AppDatabase._internal();
  factory AppDatabase() => _instance;
  AppDatabase._internal();

  static Database? _database;
  static const String _databaseName = 'lang_master_v2.db';
  static const int _databaseVersion = 6;

  // Encryption
  late Encrypter _encrypter;
  late IV _iv;

  // ==================== [DATABASE INITIALIZATION] ====================
  
  /// مقداردهی اولیه دیتابیس با رمزنگاری
  Future<void> initialize() async {
    final encryptionKey = await _getOrCreateEncryptionKey();
    _encrypter = Encrypter(AES(Key.fromBase64(encryptionKey)));
    _iv = IV.fromLength(16);
    
    await _initDatabase();
    await _runMigrations();
  }

  Future<String> _getOrCreateEncryptionKey() async {
    final prefs = AppConfig().prefs;
    String? savedKey = prefs.getString('db_encryption_key');
    
    if (savedKey == null || savedKey.length != 44) {
      // Generate new key (32 bytes = 44 chars in base64)
      final key = Key.fromSecureRandom(32);
      savedKey = key.base64;
      await prefs.setString('db_encryption_key', savedKey);
    }
    
    return savedKey;
  }

  Future<Database> get database async {
    if (_database != null) return _database!;
    await initialize();
    return _database!;
  }

  Future<void> _initDatabase() async {
    final dbPath = await getDatabasesPath();
    final path = join(dbPath, _databaseName);
    
    _database = await openDatabase(
      path,
      version: _databaseVersion,
      onCreate: _onCreate,
      onConfigure: _onConfigure,
      onUpgrade: _onUpgrade,
      onDowngrade: _onDowngrade,
    );
  }

  Future<void> _onConfigure(Database db) async {
    await db.execute('PRAGMA foreign_keys = ON');
    await db.execute('PRAGMA journal_mode = WAL');
    await db.execute('PRAGMA synchronous = NORMAL');
    await db.execute('PRAGMA mmap_size = 268435456'); // 256MB
  }

  // ==================== [SCHEMA CREATION] ====================
  
  Future<void> _onCreate(Database db, int version) async {
    await db.transaction((txn) async {
      // Users Table
      await txn.execute('''
        CREATE TABLE users (
          id TEXT PRIMARY KEY,
          email TEXT UNIQUE,
          phone TEXT UNIQUE,
          username TEXT,
          full_name TEXT,
          avatar_url TEXT,
          level INTEGER DEFAULT 1,
          xp INTEGER DEFAULT 0,
          streak_days INTEGER DEFAULT 0,
          subscription_type TEXT,
          subscription_expiry INTEGER,
          last_login INTEGER,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          is_guest INTEGER DEFAULT 0,
          settings TEXT,
          metadata TEXT
        )
      ''');

      // Languages Table
      await txn.execute('''
        CREATE TABLE languages (
          code TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          flag TEXT,
          is_rtl INTEGER DEFAULT 0,
          is_enabled INTEGER DEFAULT 1,
          progress_percentage REAL DEFAULT 0,
          last_accessed INTEGER,
          lesson_count INTEGER DEFAULT 0,
          word_count INTEGER DEFAULT 0,
          audio_size INTEGER DEFAULT 0,
          version INTEGER DEFAULT 1
        )
      ''');

      // Templates Table
      await txn.execute('''
        CREATE TABLE templates (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          name TEXT NOT NULL,
          version INTEGER DEFAULT 1,
          ui_schema TEXT NOT NULL,
          data_schema TEXT NOT NULL,
          is_active INTEGER DEFAULT 1,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )
      ''');

      // Lessons Table (آفلاین + آنلاین)
      await txn.execute('''
        CREATE TABLE lessons (
          id TEXT PRIMARY KEY,
          language_code TEXT NOT NULL,
          level INTEGER NOT NULL,
          order_index INTEGER NOT NULL,
          title TEXT NOT NULL,
          description TEXT,
          difficulty TEXT,
          estimated_time INTEGER,
          template_id TEXT NOT NULL,
          content_data TEXT NOT NULL,
          audio_files TEXT,
          image_urls TEXT,
          is_downloaded INTEGER DEFAULT 0,
          download_size INTEGER,
          is_completed INTEGER DEFAULT 0,
          score REAL,
          attempts INTEGER DEFAULT 0,
          best_time INTEGER,
          last_attempted INTEGER,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          FOREIGN KEY (language_code) REFERENCES languages(code),
          FOREIGN KEY (template_id) REFERENCES templates(id),
          UNIQUE(language_code, level, order_index)
        )
      ''');

      // Progress Table
      await txn.execute('''
        CREATE TABLE progress (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          lesson_id TEXT NOT NULL,
          language_code TEXT NOT NULL,
          status TEXT DEFAULT 'pending',
          score REAL DEFAULT 0,
          time_spent INTEGER DEFAULT 0,
          correct_answers INTEGER DEFAULT 0,
          total_questions INTEGER DEFAULT 0,
          started_at INTEGER,
          completed_at INTEGER,
          metadata TEXT,
          sync_status TEXT DEFAULT 'pending',
          sync_attempts INTEGER DEFAULT 0,
          last_sync INTEGER,
          created_at INTEGER NOT NULL,
          FOREIGN KEY (user_id) REFERENCES users(id),
          FOREIGN KEY (lesson_id) REFERENCES lessons(id),
          FOREIGN KEY (language_code) REFERENCES languages(code)
        )
      ''');

      // Words/Vocabulary Table
      await txn.execute('''
        CREATE TABLE vocabulary (
          id TEXT PRIMARY KEY,
          language_code TEXT NOT NULL,
          word TEXT NOT NULL,
          translation TEXT NOT NULL,
          phonetic TEXT,
          audio_url TEXT,
          image_url TEXT,
          category TEXT,
          difficulty INTEGER DEFAULT 1,
          lesson_id TEXT,
          example_sentence TEXT,
          example_translation TEXT,
          last_reviewed INTEGER,
          next_review INTEGER,
          review_count INTEGER DEFAULT 0,
          mastery_level INTEGER DEFAULT 0,
          created_at INTEGER NOT NULL,
          FOREIGN KEY (language_code) REFERENCES languages(code),
          FOREIGN KEY (lesson_id) REFERENCES lessons(id)
        )
      ''');

      // Payments Table
      await txn.execute('''
        CREATE TABLE payments (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          gateway TEXT NOT NULL,
          transaction_id TEXT UNIQUE,
          amount REAL NOT NULL,
          currency TEXT NOT NULL,
          status TEXT NOT NULL,
          product_id TEXT NOT NULL,
          purchase_time INTEGER NOT NULL,
          expiry_time INTEGER,
          receipt_data TEXT,
          verification_status TEXT,
          verification_attempts INTEGER DEFAULT 0,
          last_verified INTEGER,
          created_at INTEGER NOT NULL,
          FOREIGN KEY (user_id) REFERENCES users(id)
        )
      ''');

      // Cache Table
      await txn.execute('''
        CREATE TABLE cache (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          expires_at INTEGER NOT NULL,
          created_at INTEGER NOT NULL
        )
      ''');

      // Indexes برای performance
      await txn.execute('CREATE INDEX idx_lessons_language ON lessons(language_code)');
      await txn.execute('CREATE INDEX idx_lessons_level ON lessons(level)');
      await txn.execute('CREATE INDEX idx_progress_user ON progress(user_id)');
      await txn.execute('CREATE INDEX idx_progress_lesson ON progress(lesson_id)');
      await txn.execute('CREATE INDEX idx_vocabulary_language ON vocabulary(language_code)');
      await txn.execute('CREATE INDEX idx_cache_expiry ON cache(expires_at)');
    });
  }

  // ==================== [MIGRATION SYSTEM] ====================
  
  final Map<int, Migration> _migrations = {
    2: _migrationV2,
    3: _migrationV3,
    4: _migrationV4,
    5: _migrationV5,
    6: _migrationV6,
  };

  static Future<void> _migrationV2(Database db) async {
    await db.execute('ALTER TABLE users ADD COLUMN timezone TEXT');
    await db.execute('ALTER TABLE users ADD COLUMN notification_enabled INTEGER DEFAULT 1');
  }

  static Future<void> _migrationV3(Database db) async {
    await db.execute('ALTER TABLE lessons ADD COLUMN prerequisites TEXT');
    await db.execute('ALTER TABLE lessons ADD COLUMN tags TEXT');
  }

  static Future<void> _migrationV4(Database db) async {
    await db.execute('''
      CREATE TABLE user_achievements (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        achievement_id TEXT NOT NULL,
        unlocked_at INTEGER NOT NULL,
        progress REAL DEFAULT 0,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    ''');
  }

  static Future<void> _migrationV5(Database db) async {
    await db.execute('ALTER TABLE progress ADD COLUMN device_id TEXT');
    await db.execute('ALTER TABLE progress ADD COLUMN app_version TEXT');
  }

  static Future<void> _migrationV6(Database db) async {
    await db.execute('ALTER TABLE vocabulary ADD COLUMN synonyms TEXT');
    await db.execute('ALTER TABLE vocabulary ADD COLUMN part_of_speech TEXT');
  }

  Future<void> _runMigrations() async {
    final db = await database;
    final currentVersion = await db.getVersion();
    
    for (int version = currentVersion + 1; version <= _databaseVersion; version++) {
      if (_migrations.containsKey(version)) {
        await db.transaction((txn) async {
          await _migrations[version]!(txn);
        });
      }
      await db.setVersion(version);
    }
  }

  Future<void> _onUpgrade(Database db, int oldVersion, int newVersion) async {
    for (int version = oldVersion + 1; version <= newVersion; version++) {
      if (_migrations.containsKey(version)) {
        await _migrations[version]!(db);
      }
    }
  }

  Future<void> _onDowngrade(Database db, int oldVersion, int newVersion) async {
    // لاگ کردن اما اجرا نکردن (برای امنیت)
    print('⚠️ Database downgrade attempted: $oldVersion -> $newVersion');
  }

  // ==================== [ENCRYPTION/DECRYPTION] ====================
  
  String _encryptData(String plainText) {
    try {
      final encrypted = _encrypter.encrypt(plainText, iv: _iv);
      return encrypted.base64;
    } catch (e) {
      print('Encryption error: $e');
      return plainText; // Fallback for critical data
    }
  }

  String _decryptData(String encryptedText) {
    try {
      final encrypted = Encrypted.fromBase64(encryptedText);
      return _encrypter.decrypt(encrypted, iv: _iv);
    } catch (e) {
      print('Decryption error: $e');
      return encryptedText; // Fallback
    }
  }

  // ==================== [CRUD OPERATIONS] ====================
  
  /// درج امن با رمزنگاری فیلدهای حساس
  Future<int> secureInsert(String table, Map<String, dynamic> data) async {
    final db = await database;
    
    // رمزنگاری فیلدهای حساس
    final encryptedData = Map<String, dynamic>.from(data);
    const sensitiveFields = ['settings', 'metadata', 'receipt_data', 'content_data'];
    
    for (final field in sensitiveFields) {
      if (encryptedData.containsKey(field) && encryptedData[field] != null) {
        encryptedData[field] = _encryptData(encryptedData[field].toString());
      }
    }
    
    encryptedData['created_at'] = DateTime.now().millisecondsSinceEpoch;
    encryptedData['updated_at'] = DateTime.now().millisecondsSinceEpoch;
    
    return await db.insert(table, encryptedData);
  }

  /// بازیابی با رمزگشایی خودکار
  Future<List<Map<String, dynamic>>> secureQuery(
    String table, {
    String? where,
    List<Object?>? whereArgs,
    String? orderBy,
    int? limit,
  }) async {
    final db = await database;
    final results = await db.query(
      table,
      where: where,
      whereArgs: whereArgs,
      orderBy: orderBy,
      limit: limit,
    );
    
    // رمزگشایی فیلدهای حساس
    return results.map((row) {
      final decryptedRow = Map<String, dynamic>.from(row);
      const sensitiveFields = ['settings', 'metadata', 'receipt_data', 'content_data'];
      
      for (final field in sensitiveFields) {
        if (decryptedRow.containsKey(field) && decryptedRow[field] != null) {
          decryptedRow[field] = _decryptData(decryptedRow[field].toString());
        }
      }
      
      return decryptedRow;
    }).toList();
  }

  // ==================== [SPECIALIZED METHODS] ====================
  
  /// دریافت پیشرفت کاربر در یک زبان
  Future<Map<String, dynamic>> getUserLanguageProgress(
    String userId,
    String languageCode,
  ) async {
    final db = await database;
    
    final result = await db.rawQuery('''
      SELECT 
        COUNT(DISTINCT l.id) as total_lessons,
        COUNT(DISTINCT p.lesson_id) as completed_lessons,
        AVG(p.score) as average_score,
        SUM(p.time_spent) as total_time_spent,
        MAX(p.completed_at) as last_completed
      FROM lessons l
      LEFT JOIN progress p ON l.id = p.lesson_id 
        AND p.user_id = ? 
        AND p.status = 'completed'
      WHERE l.language_code = ?
    ''', [userId, languageCode]);
    
    return result.first;
  }

  /// دریافت کلمات برای مرور (Spaced Repetition)
  Future<List<Map<String, dynamic>>> getWordsForReview(
    String userId,
    String languageCode,
    int limit,
  ) async {
    final db = await database;
    
    return await db.rawQuery('''
      SELECT v.*, 
        (julianday('now') - julianday(v.last_reviewed/1000, 'unixepoch')) as days_since_review
      FROM vocabulary v
      LEFT JOIN progress p ON v.lesson_id = p.lesson_id AND p.user_id = ?
      WHERE v.language_code = ?
        AND (v.next_review IS NULL OR v.next_review <= ?)
        AND (p.status = 'completed' OR v.lesson_id IS NULL)
      ORDER BY v.mastery_level ASC, days_since_review DESC
      LIMIT ?
    ''', [userId, languageCode, DateTime.now().millisecondsSinceEpoch, limit]);
  }

  /// پاک‌سازی کش قدیمی
  Future<int> cleanOldCache() async {
    final db = await database;
    return await db.delete(
      'cache',
      where: 'expires_at < ?',
      whereArgs: [DateTime.now().millisecondsSinceEpoch],
    );
  }

  /// تهیه‌پشتیبان از دیتابیس
  Future<String> backupDatabase() async {
    final dbPath = await getDatabasesPath();
    final sourcePath = join(dbPath, _databaseName);
    final backupPath = join(dbPath, '${_databaseName}.backup_${DateTime.now().millisecondsSinceEpoch}');
    
    await database; // Ensure DB is initialized
    await copyDatabase(sourcePath, backupPath);
    
    return backupPath;
  }

  /// بازسازی ایندکس‌ها برای بهینه‌سازی
  Future<void> optimizeDatabase() async {
    final db = await database;
    await db.execute('PRAGMA optimize');
    await db.execute('VACUUM');
  }

  // ==================== [MAINTENANCE] ====================
  
  Future<void> close() async {
    if (_database != null) {
      await _database!.close();
      _database = null;
    }
  }

  Future<void> deleteDatabase() async {
    await close();
    final dbPath = await getDatabasesPath();
    final path = join(dbPath, _databaseName);
    await deleteDatabase(path);
  }

  Future<int> getDatabaseSize() async {
    final dbPath = await getDatabasesPath();
    final path = join(dbPath, _databaseName);
    final file = File(path);
    
    if (await file.exists()) {
      return await file.length();
    }
    return 0;
  }
}

typedef Migration = Future<void> Function(Database db);
