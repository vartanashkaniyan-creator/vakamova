
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:lang_master/core/app_config.dart';

/// 🌍 **Enterprise Language Manager**
/// مدیریت کامل ۱۲ زبان با قابلیت‌های پیشرفته
class LanguageManager {
  // Singleton
  static final LanguageManager _instance = LanguageManager._internal();
  factory LanguageManager() => _instance;
  LanguageManager._internal();

  // کش ترجمه‌ها
  final Map<String, Map<String, String>> _translations = {};
  
  // زبان فعلی
  String _currentLanguage = AppConfig.defaultLanguage;
  
  // جهت متن
  TextDirection _currentDirection = TextDirection.ltr;
  
  // سیستم رویداد برای تغییر زبان
  final List<Function()> _listeners = [];
  
  // ==================== [INITIALIZATION] ====================
  
  /// مقداردهی اولیه سیستم زبان
  Future<void> initialize() async {
    await _loadSavedLanguage();
    await _loadCoreTranslations();
    _updateTextDirection();
    
    if (AppConfig._autoDetectLanguage) {
      await _autoDetectLanguage();
    }
  }
  
  Future<void> _loadSavedLanguage() async {
    final prefs = await SharedPreferences.getInstance();
    final savedLang = prefs.getString('app_language');
    
    if (savedLang != null && AppConfig.isLanguageSupported(savedLang)) {
      _currentLanguage = savedLang;
    } else {
      _currentLanguage = AppConfig.defaultLanguage;
      await prefs.setString('app_language', _currentLanguage);
    }
  }
  
  Future<void> _loadCoreTranslations() async {
    // بارگذاری ترجمه‌های پایه برای هر زبان
    for (final langConfig in AppConfig.supportedLanguages) {
      if (langConfig.enabled) {
        await _loadLanguageFile(langConfig.code);
      }
    }
    
    // بارگذاری ترجمه‌های پویا از سرور
    if (_hasInternetConnection()) {
      await _loadRemoteTranslations();
    }
  }
  
  Future<void> _loadLanguageFile(String languageCode) async {
    try {
      final jsonStr = await rootBundle.loadString(
        'assets/languages/$languageCode.json',
      );
      
      final Map<String, dynamic> data = jsonDecode(jsonStr);
      final Map<String, String> translations = {};
      
      data.forEach((key, value) {
        if (value is String) {
          translations[key] = value;
        }
      });
      
      _translations[languageCode] = translations;
    } catch (e) {
      print('⚠️ Failed to load language $languageCode: $e');
      _translations[languageCode] = {};
    }
  }
  
  Future<void> _loadRemoteTranslations() async {
    // TODO: Load updated translations from server
    try {
      // final response = await ApiClient().get('/translations/${_currentLanguage}');
      // if (response.success) {
      //   _mergeTranslations(_currentLanguage, response.data);
      // }
    } catch (e) {
      // Silent fail - use local translations
    }
  }
  
  Future<void> _autoDetectLanguage() async {
    final locale = PlatformDispatcher.instance.locale;
    final systemLang = locale.languageCode;
    
    // بررسی پشتیبانی از زبان سیستم
    if (AppConfig.isLanguageSupported(systemLang)) {
      await changeLanguage(systemLang, notify: false);
    }
    
    // بررسی تنظیمات منطقه‌ای
    final countryCode = locale.countryCode;
    if (countryCode != null) {
      // برای زبان‌هایی که گونه‌های منطقه‌ای دارند
      final regionalLang = '$systemLang-$countryCode';
      if (_isRegionalVariantSupported(regionalLang)) {
        await changeLanguage(regionalLang, notify: false);
      }
    }
  }
  
  bool _isRegionalVariantSupported(String langCode) {
    // بررسی گونه‌های منطقه‌ای مانند en-US, pt-BR
    return _translations.containsKey(langCode);
  }
  
  // ==================== [PUBLIC API] ====================
  
  /// تغییر زبان برنامه
  Future<void> changeLanguage(
    String languageCode, {
    bool savePreference = true,
    bool notify = true,
  }) async {
    if (!AppConfig.isLanguageSupported(languageCode)) {
      throw Exception('Language $languageCode is not supported');
    }
    
    // بارگذاری ترجمه‌ها اگر موجود نیستند
    if (!_translations.containsKey(languageCode)) {
      await _loadLanguageFile(languageCode);
    }
    
    // به‌روزرسانی زبان فعلی
    _currentLanguage = languageCode;
    _updateTextDirection();
    
    // ذخیره در تنظیمات
    if (savePreference) {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('app_language', languageCode);
    }
    
    // اطلاع‌رسانی به listeners
    if (notify) {
      _notifyListeners();
    }
    
    // بارگذاری ترجمه‌های اضافی برای زبان جدید
    _loadAdditionalResources(languageCode);
  }
  
  /// دریافت ترجمه متن
  String translate(
    String key, {
    Map<String, String>? params,
    String? defaultValue,
  }) {
    // جستجو در زبان فعلی
    String? translation = _translations[_currentLanguage]?[key];
    
    // Fallback به زبان پیش‌فرض
    if (translation == null) {
      translation = _translations[AppConfig.defaultLanguage]?[key];
    }
    
    // Fallback به خود کلید
    if (translation == null) {
      translation = defaultValue ?? key;
    }
    
    // جایگزینی پارامترها
    if (params != null) {
      params.forEach((paramKey, value) {
        translation = translation!.replaceAll('{{$paramKey}}', value);
      });
    }
    
    return translation;
  }
  
  /// ترجمه با pluralization
  String translatePlural(
    String key,
    int count, {
    Map<String, String>? params,
  }) {
    // کلیدهای plural مانند: 'item' -> 'item_singular', 'item_plural', 'item_zero'
    String pluralKey = key;
    
    if (count == 0 && _hasTranslation('${key}_zero')) {
      pluralKey = '${key}_zero';
    } else if (count == 1 && _hasTranslation('${key}_singular')) {
      pluralKey = '${key}_singular';
    } else if (count > 1 && _hasTranslation('${key}_plural')) {
      pluralKey = '${key}_plural';
    } else if (count > 10 && _hasTranslation('${key}_many')) {
      pluralKey = '${key}_many';
    }
    
    final baseTranslation = translate(pluralKey, defaultValue: key);
    
    // جایگزینی شمارش
    return baseTranslation.replaceAll('{{count}}', count.toString());
  }
  
  bool _hasTranslation(String key) {
    return _translations[_currentLanguage]?.containsKey(key) == true ||
           _translations[AppConfig.defaultLanguage]?.containsKey(key) == true;
  }
  
  /// فرمت‌بندی اعداد بر اساس زبان
  String formatNumber(num value) {
    switch (_currentLanguage) {
      case 'fa': // فارسی - فرمت فارسی
        final persianDigits = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
        return value.toString().replaceAllMapped(
          RegExp(r'\d'),
          (match) => persianDigits[int.parse(match.group(0)!)],
        );
      case 'ar': // عربی - فرمت عربی
        final arabicDigits = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
        return value.toString().replaceAllMapped(
          RegExp(r'\d'),
          (match) => arabicDigits[int.parse(match.group(0)!)],
        );
      default:
        return value.toString();
    }
  }
  
  /// فرمت‌بندی تاریخ بر اساس زبان
  String formatDate(DateTime date, {String format = 'medium'}) {
    // TODO: Implement locale-aware date formatting
    switch (_currentLanguage) {
      case 'fa':
        return _formatPersianDate(date, format);
      case 'ar':
        return _formatArabicDate(date, format);
      default:
        return _formatGregorianDate(date, format);
    }
  }
  
  String _formatPersianDate(DateTime date, String format) {
    // تبدیل به تاریخ شمسی
    // TODO: Implement Persian (Jalali) calendar
    return date.toString();
  }
  
  String _formatArabicDate(DateTime date, String format) {
    // TODO: Implement Hijri calendar for Arabic
    return date.toString();
  }
  
  String _formatGregorianDate(DateTime date, String format) {
    final Map<String, String> formats = {
      'short': '${date.day}/${date.month}/${date.year}',
      'medium': '${date.day} ${_getMonthName(date.month)} ${date.year}',
      'long': '${_getWeekdayName(date.weekday)}, ${date.day} ${_getMonthName(date.month)} ${date.year}',
    };
    
    return formats[format] ?? date.toString();
  }
  
  String _getMonthName(int month) {
    final Map<String, List<String>> monthNames = {
      'en': ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
      'fa': ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'],
      'ar': ['محرم', 'صفر', 'ربيع الأول', 'ربيع الآخر', 'جمادى الأولى', 'جمادى الآخرة', 'رجب', 'شعبان', 'رمضان', 'شوال', 'ذو القعدة', 'ذو الحجة'],
    };
    
    return monthNames[_currentLanguage]?[month - 1] ?? month.toString();
  }
  
  String _getWeekdayName(int weekday) {
    final Map<String, List<String>> weekdayNames = {
      'en': ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
      'fa': ['دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه', 'یکشنبه'],
      'ar': ['الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت', 'الأحد'],
    };
    
    return weekdayNames[_currentLanguage]?[weekday - 1] ?? '';
  }
  
  // ==================== [TEXT DIRECTION] ====================
  
  void _updateTextDirection() {
    final langConfig = AppConfig.getLanguageConfig(_currentLanguage);
    _currentDirection = (langConfig?.rtl == true || AppConfig._forceRTL)
        ? TextDirection.rtl
        : TextDirection.ltr;
  }
  
  TextDirection get textDirection => _currentDirection;
  
  bool get isRTL => _currentDirection == TextDirection.rtl;
  
  AlignmentGeometry get startAlignment => isRTL ? Alignment.centerRight : Alignment.centerLeft;
  AlignmentGeometry get endAlignment => isRTL ? Alignment.centerLeft : Alignment.centerRight;
  
  // ==================== [LANGUAGE INFO] ====================
  
  /// دریافت اطلاعات زبان فعلی
  LanguageConfig? get currentLanguageConfig {
    return AppConfig.getLanguageConfig(_currentLanguage);
  }
  
  /// دریافت لیست زبان‌های فعال
  List<LanguageConfig> get availableLanguages {
    return AppConfig.supportedLanguages
        .where((lang) => lang.enabled)
        .toList();
  }
  
  /// دریافت درصد یادگیری هر زبان
  Future<Map<String, double>> getLanguageProgress() async {
    final Map<String, double> progress = {};
    
    for (final lang in availableLanguages) {
      // TODO: Fetch from database
      progress[lang.code] = 0.0;
    }
    
    return progress;
  }
  
  /// بررسی پشتیبانی از ویژگی‌های زبان
  bool supportsFeature(String languageCode, String feature) {
    const featureSupport = {
      'speech_synthesis': ['en', 'fa', 'es', 'fr', 'de', 'it', 'pt', 'ru'],
      'voice_recognition': ['en', 'fa', 'es', 'fr', 'de'],
      'handwriting': ['zh', 'ja', 'ko', 'ar', 'fa'],
      'grammar_check': ['en', 'es', 'fr', 'de'],
    };
    
    return featureSupport[feature]?.contains(languageCode) ?? false;
  }
  
  // ==================== [RESOURCE MANAGEMENT] ====================
  
  Future<void> _loadAdditionalResources(String languageCode) async {
    // بارگذاری فونت‌های خاص زبان
    if (languageCode == 'fa' || languageCode == 'ar') {
      await _loadRTLFonts();
    }
    
    // بارگذاری فایل‌های صوتی پایه
    await _preloadAudioResources(languageCode);
    
    // بارگذاری محتوای آفلاین اولویت‌دار
    if (_shouldPreloadContent(languageCode)) {
      await _preloadLanguageContent(languageCode);
    }
  }
  
  Future<void> _loadRTLFonts() async {
    // TODO: Load RTL fonts if not already loaded
  }
  
  Future<void> _preloadAudioResources(String languageCode) async {
    // Preload common audio files for better UX
  }
  
  Future<void> _preloadLanguageContent(String languageCode) async {
    // Preload first 5 lessons for instant access
  }
  
  bool _shouldPreloadContent(String languageCode) {
    // Preload if language is selected or user has progress in it
    return languageCode == _currentLanguage;
  }
  
  // ==================== [EVENT SYSTEM] ====================
  
  void addListener(Function() listener) {
    _listeners.add(listener);
  }
  
  void removeListener(Function() listener) {
    _listeners.remove(listener);
  }
  
  void _notifyListeners() {
    for (final listener in _listeners) {
      listener();
    }
  }
  
  // ==================== [UTILITIES] ====================
  
  bool _hasInternetConnection() {
    // TODO: Check connectivity
    return true;
  }
  
  void _mergeTranslations(String languageCode, Map<String, dynamic> newTranslations) {
    if (!_translations.containsKey(languageCode)) {
      _translations[languageCode] = {};
    }
    
    newTranslations.forEach((key, value) {
      if (value is String) {
        _translations[languageCode]![key] = value;
      }
    });
  }
  
  // ==================== [DEBUG & MAINTENANCE] ====================
  
  /// دریافت وضعیت سیستم زبان
  Map<String, dynamic> getStatus() {
    return {
      'current_language': _currentLanguage,
      'text_direction': isRTL ? 'RTL' : 'LTR',
      'translations_loaded': _translations.length,
      'available_languages': availableLanguages.map((lang) => lang.code).toList(),
      'listeners_count': _listeners.length,
    };
  }
  
  /// پاک‌سازی کش ترجمه‌ها
  void clearCache() {
    _translations.clear();
  }
  
  /// افزودن ترجمه‌های سفارشی (برای تست یا توسعه)
  void addCustomTranslations(String languageCode, Map<String, String> translations) {
    if (!_translations.containsKey(languageCode)) {
      _translations[languageCode] = {};
    }
    
    _translations[languageCode]!.addAll(translations);
  }
  
  /// ریست به حالت پیش‌فرض
  Future<void> reset() async {
    _currentLanguage = AppConfig.defaultLanguage;
    _updateTextDirection();
    
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('app_language');
    
    _notifyListeners();
  }
}

/// 🎯 استفاده آسان در کل برنامه:
/// 
/// ```dart
/// Text(LanguageManager().translate('welcome_message')),
/// Text(LanguageManager().translatePlural('items', 5)),
/// Text(LanguageManager().formatNumber(1234)),
/// ```
