// fix.js - رفع مشکل نمایش درس ۴
async function fixLesson4() {
  try {
    const response = await fetch('english_lesson_4.json');
    const data = await response.json();
    
    console.log('✅ درس ۴ پیدا شد:', data.metadata.title);
    
    // اضافه کردن درس ۴ به صفحه
    const container = document.getElementById('lessonsContainer');
    if (container) {
      const vocabWords = data.content.vocabulary?.words || [];
      const vocabPreview = vocabWords.slice(0, 3).map(word => 
        `<div style="display:flex; justify-content:space-between; padding:5px 0;">
          <span style="color:#4CAF50">${word.english}</span>
          <span style="color:#FFC107">${word.farsi}</span>
        </div>`
      ).join('');
      
      const lessonHTML = `
        <div class="lesson-card animate" style="animation-delay: 0.4s">
          <h3>📘 ${data.metadata.title}</h3>
          <p class="subtitle">${data.metadata.subtitle}</p>
          <div class="objectives">
            ${data.metadata.learning_objectives.map(obj => 
              `<span class="objective">${obj}</span>`
            ).join('')}
          </div>
          ${vocabWords.length > 0 ? `
            <div class="vocabulary-preview">
              <h4>📝 واژگان:</h4>
              ${vocabPreview}
            </div>
          ` : ''}
        </div>
      `;
      
      container.innerHTML += lessonHTML;
      
      // آپدیت آمار
      document.getElementById('lessons-count').textContent = '4';
      document.getElementById('active-lessons').textContent = '۴ درس فعال';
      
      alert('✅ درس ۴ با موفقیت اضافه شد!');
    }
  } catch (error) {
    console.error('❌ خطا در بارگذاری درس ۴:', error);
    alert('❌ خطا در نمایش درس ۴');
  }
}

// اجرای خودکار
fixLesson4();
