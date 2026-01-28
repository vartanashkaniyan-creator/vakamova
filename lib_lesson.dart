Future<List<Lesson>> loadAllLessons() async {
  final lessons = <Lesson>[];
  
  // لیست مستقیم فایل‌های JSON (چون پوشه‌ای نداریم)
  final lessonFiles = [
    'english_lesson_1.json',
    'english_lesson_2.json',
    'english_lesson_3.json',
  ];
  
  for (final fileName in lessonFiles) {
    try {
      final data = await rootBundle.loadString(fileName);
      final lesson = Lesson.fromJson(json.decode(data));
      lessons.add(lesson);
    } catch (e) {
      print('خطا در بارگذاری $fileName: $e');
    }
  }
  
  return lessons;
}
