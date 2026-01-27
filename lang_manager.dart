import 'dart:convert';
import 'dart:io' show Platform;
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:lang_master/core/app_config.dart';

/// 🌍 **Enterprise Language Manager**
/// مدیریت کامل ۱۴ زبان با قابلیت‌های پیشرفته
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
  final List<VoidCallback> _listeners = [];
  
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
    
    if (savedLang != null && _isLanguageSupported(savedLang)) {
      _currentLanguage = savedLang;
    } else {
      _currentLanguage = AppConfig.defaultLanguage;
      await prefs.setString('app_language', _currentLanguage);
    }
  }
  
  Future<void> _loadCoreTranslations() async {
    // بارگذاری ترجمه‌های پایه برای ۱۴ زبان
    final List<Map<String, dynamic>> supportedLangs = AppConfig.supportedLanguages;
    
    for (final lang in supportedLangs) {
      if (lang['code'] != null) {
        await _loadLanguageFile(lang['code']!);
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
      if (kDebugMode) {
        print('⚠️ Failed to load language $languageCode: $e');
      }
      _translations[languageCode] = {};
    }
  }
  
  Future<void> _loadRemoteTranslations() async {
    try {
      // TODO: Load updated translations from server
    } catch (e) {
      // Silent fail - use local translations
    }
  }
  
  Future<void> _autoDetectLanguage() async {
    final String systemLang;
    
    if (Platform.isAndroid || Platform.isIOS) {
      final locale = WidgetsBinding.instance.platformDispatcher.locale;
      systemLang = locale.languageCode;
    } else {
      systemLang = 'en';
    }
    
    // بررسی پشتیبانی از زبان سیستم
    if (_isLanguageSupported(systemLang)) {
      await changeLanguage(systemLang, notify: false);
    }
    
    // بررسی گونه‌های منطقه‌ای
    final String regionalLang;
    if (systemLang == 'ar') {
      regionalLang = 'ar-iq'; // عربی عراقی
    } else if (systemLang == 'pt') {
      regionalLang = 'pt-br'; // پرتغالی برزیلی
    } else {
      regionalLang = systemLang;
    }
    
    if (_isLanguageSupported(regionalLang)) {
      await changeLanguage(regionalLang, notify: false);
    }
  }
  
  bool _isRegionalVariantSupported(String langCode) {
    return _translations.containsKey(langCode);
  }
  
  // ==================== [PUBLIC API] ====================
  
  /// تغییر زبان برنامه
  Future<void> changeLanguage(
    String languageCode, {
    bool savePreference = true,
    bool notify = true,
  }) async {
    if (!_isLanguageSupported(languageCode)) {
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
    
    // بارگذاری منابع اضافی
    _loadAdditionalResources(languageCode);
  }
  
  /// بررسی پشتیبانی زبان
  bool _isLanguageSupported(String code) {
    final List<Map<String, dynamic>> langs = AppConfig.supportedLanguages;
    return langs.any((lang) => lang['code'] == code);
  }
  
  /// دریافت ترجمه متن
  String translate(
    String key, {
    Map<String, String>? params,
    String? defaultValue,
  }) {
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
    String pluralKey = key;
    
    if (count == 0 && _hasTranslation('${key}_zero')) {
      pluralKey = '${key}_zero';
    } else if (count == 1 && _hasTranslation('${key}_singular')) {
      pluralKey = '${key}_singular';
    } else if (count > 1 && _hasTranslation('${key}_plural')) {
      pluralKey = '${key}_plural';
    }
    
    final baseTranslation = translate(pluralKey, defaultValue: key);
    return baseTranslation.replaceAll('{{count}}', count.toString());
  }
  
  bool _hasTranslation(String key) {
    return _translations[_currentLanguage]?.containsKey(key) == true ||
           _translations[AppConfig.defaultLanguage]?.containsKey(key) == true;
  }
  
  /// فرمت‌بندی اعداد بر اساس زبان
  String formatNumber(num value) {
    final String langCode = _currentLanguage.split('-').first;
    
    switch (langCode) {
      case 'fa': // فارسی
        final persianDigits = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
        return value.toString().replaceAllMapped(
          RegExp(r'\d'),
          (match) => persianDigits[int.parse(match.group(0)!)],
        );
      case 'ar': // عربی (عراقی)
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
    final String langCode = _currentLanguage.split('-').first;
    
    switch (langCode) {
      case 'fa':
        return _formatPersianDate(date, format);
      case 'ar':
        return _formatArabicDate(date, format);
      default:
        return _formatGregorianDate(date, format);
    }
  }
  
  String _formatPersianDate(DateTime date, String format) {
    // TODO: تبدیل به تاریخ شمسی
    return date.toString();
  }
  
  String _formatArabicDate(DateTime date, String format) {
    // TODO: تبدیل به تاریخ هجری قمری
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
      'ar-iq': ['كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران', 'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول'],
      'de': ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'],
      'tr': ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'],
      'ru': ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'],
      'fr': ['janv', 'févr', 'mars', 'avr', 'mai', 'juin', 'juil', 'août', 'sept', 'oct', 'nov', 'déc'],
      'es': ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'],
      'pt-br': ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'],
      'it': ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'],
      'nl': ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'],
      'sv': ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'],
    };
    
    return monthNames[_currentLanguage]?[month - 1] ?? month.toString();
  }
  
  String _getWeekdayName(int weekday) {
    final Map<String, List<String>> weekdayNames = {
      'en': ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
      'fa': ['دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه', 'یکشنبه'],
      'ar-iq': ['الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت', 'الأحد'],
      'de': ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'],
      'tr': ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'],
      'ru': ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'],
      'fr': ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'],
      'es': ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'],
      'pt-br': ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'],
      'it': ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'],
      'nl': ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'],
      'sv': ['mån', 'tis', 'ons', 'tor', 'fre', 'lör', 'sön'],
    };
    
    return weekdayNames[_currentLanguage]?[weekday - 1] ?? '';
  }
  
  // ==================== [TEXT DIRECTION] ====================
  
  void _updateTextDirection() {
    final List<String> rtlLanguages = ['ar-iq', 'fa'];
    _currentDirection = rtlLanguages.contains(_currentLanguage)
        ? TextDirection.rtl
        : TextDirection.ltr;
  }
  
  TextDirection get textDirection => _currentDirection;
  
  bool get isRTL => _currentDirection == TextDirection.rtl;
  
  AlignmentGeometry get startAlignment => isRTL ? Alignment.centerRight : Alignment.centerLeft;
  AlignmentGeometry get endAlignment => isRTL ? Alignment.centerLeft : Alignment.centerRight;
  
  // ==================== [LANGUAGE INFO] ====================
  
  /// دریافت اطلاعات زبان فعلی
  Map<String, dynamic>? get currentLanguageInfo {
    final List<Map<String, dynamic>> langs = AppConfig.supportedLanguages;
    return langs.firstWhere(
      (lang) => lang['code'] == _currentLanguage,
      orElse: () => <String, dynamic>{},
    );
  }
  
  /// دریافت لیست زبان‌های فعال
  List<Map<String, dynamic>> get availableLanguages {
    return AppConfig.supportedLanguages;
  }
  
  /// دریافت درصد یادگیری هر زبان
  Future<Map<String, double>> getLanguageProgress() async {
    final Map<String, double> progress = {};
    
    for (final lang in availableLanguages) {
      progress[lang['code'] ?? 'unknown'] = 0.0;
    }
    
    return progress;
  }
  
  /// بررسی پشتیبانی از ویژگی‌های زبان
  bool supportsFeature(String languageCode, String feature) {
    const Map<String, List<String>> featureSupport = {
      'speech_synthesis': ['en', 'fa', 'es', 'fr', 'de', 'it', 'pt-br', 'ru', 'ar-iq', 'tr'],
      'voice_recognition': ['en', 'fa', 'es', 'fr', 'de', 'it', 'ru'],
      'handwriting': ['ar-iq', 'fa', 'ru', 'tr'],
      'grammar_check': ['en', 'de', 'fr', 'es', 'it', 'ru'],
    };
    
    return featureSupport[feature]?.contains(languageCode) ?? false;
  }
  
  // ==================== [RESOURCE MANAGEMENT] ====================
  
  Future<void> _loadAdditionalResources(String languageCode) async {
    final String langCode = languageCode.split('-').first;
    
    if (langCode == 'fa' || langCode == 'ar') {
      await _loadRTLFonts();
    }
    
    await _preloadAudioResources(languageCode);
    
    if (_shouldPreloadContent(languageCode)) {
      await _preloadLanguageContent(languageCode);
    }
  }
  
  Future<void> _loadRTLFonts() async {
    // TODO: Load RTL fonts
  }
  
  Future<void> _preloadAudioResources(String languageCode) async {
    // TODO: Preload audio
  }
  
  Future<void> _preloadLanguageContent(String languageCode) async {
    // TODO: Preload lessons
  }
  
  bool _shouldPreloadContent(String languageCode) {
    return languageCode == _currentLanguage;
  }
  
  // ==================== [EVENT SYSTEM] ====================
  
  void addListener(VoidCallback listener) {
    _listeners.add(listener);
  }
  
  void removeListener(VoidCallback listener) {
    _listeners.remove(listener);
  }
  
  void _notifyListeners() {
    for (final listener in _listeners) {
      listener();
    }
  }
  
  // ==================== [UTILITIES] ====================
  
  bool _hasInternetConnection() {
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
      'available_languages': availableLanguages.map((lang) => lang['code']).toList(),
      'listeners_count': _listeners.length,
    };
  }
  
  /// پاک‌سازی کش ترجمه‌ها
  void clearCache() {
    _translations.clear();
  }
  
  /// افزودن ترجمه‌های سفارشی
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
  
  /// دریافت کد زبان ساده‌شده (بدون منطقه)
  String get simpleLanguageCode {
    return _currentLanguage.split('-').first;
  }
}
