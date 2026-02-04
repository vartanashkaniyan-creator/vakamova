/**
 * VAKAMOVA - LANGUAGE CONSTANTS
 * مرکز ثابت‌های زبان‌ها و پرچم‌ها
 */

export const LANGUAGE_FLAGS = {
    // فارسی
    FA: '<span class="fi fi-ir" title="فارسی"></span>',
    
    // عربی عراقی
    AR_IQ: '<span class="fi fi-iq" title="عربی عراقی"></span>',
    
    // ترکی استانبولی
    TR: '<span class="fi fi-tr" title="ترکی استانبولی"></span>',
    
    // روسی
    RU: '<span class="fi fi-ru" title="روسی"></span>',
    
    // فرانسوی
    FR: '<span class="fi fi-fr" title="فرانسوی"></span>',
    
    // اسپانیایی
    ES: '<span class="fi fi-es" title="اسپانیایی"></span>',
    
    // پرتغالی برزیل
    PT_BR: '<span class="fi fi-br" title="پرتغالی برزیل"></span>',
    
    // ایتالیایی
    IT: '<span class="fi fi-it" title="ایتالیایی"></span>',
    
    // انگلیسی بریتانیا
    EN_GB: '<span class="fi fi-gb" title="انگلیسی بریتانیا"></span>',
    
    // آلمانی
    DE: '<span class="fi fi-de" title="آلمانی"></span>',
    
    // سوئدی
    SV: '<span class="fi fi-se" title="سوئدی"></span>',
    
    // هلندی
    NL: '<span class="fi fi-nl" title="هلندی"></span>'
};

export const LANGUAGE_NAMES = {
    FA: 'فارسی',
    AR_IQ: 'عربی (عراق)',
    TR: 'ترکی استانبولی',
    RU: 'روسی',
    FR: 'فرانسوی',
    ES: 'اسپانیایی',
    PT_BR: 'پرتغالی (برزیل)',
    IT: 'ایتالیایی',
    EN_GB: 'انگلیسی (بریتانیا)',
    DE: 'آلمانی',
    SV: 'سوئدی',
    NL: 'هلندی'
};

export const LANGUAGE_CODES = {
    FA: 'fa',
    AR_IQ: 'ar-IQ',
    TR: 'tr',
    RU: 'ru',
    FR: 'fr',
    ES: 'es',
    PT_BR: 'pt-BR',
    IT: 'it',
    EN_GB: 'en-GB',
    DE: 'de',
    SV: 'sv',
    NL: 'nl'
};

// تابع کمکی برای گرفتن پرچم بر اساس کد زبان
export function getFlagByCode(langCode) {
    const mapping = {
        'fa': LANGUAGE_FLAGS.FA,
        'ar-IQ': LANGUAGE_FLAGS.AR_IQ,
        'tr': LANGUAGE_FLAGS.TR,
        'ru': LANGUAGE_FLAGS.RU,
        'fr': LANGUAGE_FLAGS.FR,
        'es': LANGUAGE_FLAGS.ES,
        'pt-BR': LANGUAGE_FLAGS.PT_BR,
        'it': LANGUAGE_FLAGS.IT,
        'en-GB': LANGUAGE_FLAGS.EN_GB,
        'de': LANGUAGE_FLAGS.DE,
        'sv': LANGUAGE_FLAGS.SV,
        'nl': LANGUAGE_FLAGS.NL
    };
    
    return mapping[langCode] || LANGUAGE_FLAGS.FA; // پیش‌فرض فارسی
}

// تابع برای گرفتن تمام زبان‌ها به صورت آرایه
export function getAllLanguages() {
    return Object.keys(LANGUAGE_CODES).map(code => ({
        code: LANGUAGE_CODES[code],
        flag: LANGUAGE_FLAGS[code],
        name: LANGUAGE_NAMES[code],
        key: code
    }));
}

// CSS مورد نیاز برای پرچم‌ها (در صورت عدم دسترسی به CDN)
export const FLAG_STYLES = `
    .fi {
        background-size: contain;
        background-position: 50%;
        background-repeat: no-repeat;
        position: relative;
        display: inline-block;
        width: 1.33333333em;
        height: 1em;
        line-height: 1em;
        vertical-align: middle;
    }
    
    .fi:before {
        content: "\\00a0";
    }
    
    .fi-ir { background-image: url('/assets/images/flags/ir.svg'); }
    .fi-iq { background-image: url('/assets/images/flags/iq.svg'); }
    .fi-tr { background-image: url('/assets/images/flags/tr.svg'); }
    .fi-ru { background-image: url('/assets/images/flags/ru.svg'); }
    .fi-fr { background-image: url('/assets/images/flags/fr.svg'); }
    .fi-es { background-image: url('/assets/images/flags/es.svg'); }
    .fi-br { background-image: url('/assets/images/flags/br.svg'); }
    .fi-it { background-image: url('/assets/images/flags/it.svg'); }
    .fi-gb { background-image: url('/assets/images/flags/gb.svg'); }
    .fi-de { background-image: url('/assets/images/flags/de.svg'); }
    .fi-se { background-image: url('/assets/images/flags/se.svg'); }
    .fi-nl { background-image: url('/assets/images/flags/nl.svg'); }
`;
