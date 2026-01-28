import 'dart:convert';
import 'package:flutter/services.dart';
import 'package:flutter/material.dart';

class Lesson {
  final String lessonId;
  final String title;
  final String subtitle;
  final String language;
  final String targetLanguage;
  final String level;
  final int difficulty;
  final int estimatedTime;
  final String version;
  final List<String> prerequisites;
  final List<String> learningObjectives;
  final Map<String, dynamic> content;

  Lesson({
    required this.lessonId,
    required this.title,
    required this.subtitle,
    required this.language,
    required this.targetLanguage,
    required this.level,
    required this.difficulty,
    required this.estimatedTime,
    required this.version,
    required this.prerequisites,
    required this.learningObjectives,
    required this.content,
  });

  factory Lesson.fromJson(Map<String, dynamic> json) {
    return Lesson(
      lessonId: json['metadata']['lesson_id'],
      title: json['metadata']['title'],
      subtitle: json['metadata']['subtitle'],
      language: json['metadata']['language'],
      targetLanguage: json['metadata']['target_language'],
      level: json['metadata']['level'],
      difficulty: json['metadata']['difficulty'],
      estimatedTime: json['metadata']['estimated_time'],
      version: json['metadata']['version'],
      prerequisites: List<String>.from(json['metadata']['prerequisites'] ?? []),
      learningObjectives: List<String>.from(json['metadata']['learning_objectives']),
      content: json['content'],
    );
  }
}

Future<List<Lesson>> loadAllLessons() async {
  final lessons = <Lesson>[];
  
  // لیست مستقیم فایل‌های JSON (چون فایل‌ها در ریشه هستند)
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
      print('✅ درس بارگذاری شد: $fileName');
    } catch (e) {
      print('❌ خطا در بارگذاری $fileName: $e');
    }
  }
  
  print('📊 تعداد درس‌های بارگذاری شده: ${lessons.length}');
  return lessons;
}

class LessonScreen extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return FutureBuilder<List<Lesson>>(
      future: loadAllLessons(),
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return Center(child: CircularProgressIndicator());
        }
        
        if (snapshot.hasError) {
          return Center(child: Text('خطا در بارگذاری درس‌ها: ${snapshot.error}'));
        }
        
        final lessons = snapshot.data ?? [];
        
        return ListView.builder(
          itemCount: lessons.length,
          itemBuilder: (context, index) {
            final lesson = lessons[index];
            return Card(
              margin: EdgeInsets.all(8),
              child: ListTile(
                leading: CircleAvatar(
                  child: Text('${index + 1}'),
                ),
                title: Text(lesson.title),
                subtitle: Text(lesson.subtitle),
                trailing: Icon(Icons.arrow_forward),
                onTap: () {
                  // TODO: رفتن به صفحه جزییات درس
                },
              ),
            );
          },
        );
      },
    );
  }
}
