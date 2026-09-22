let language: 'de' | 'en' = 'en';
export function setNativeLanguage(value: 'de' | 'en'): void { language = value; }
export function nativeText(german: string, english: string): string { return language === 'de' ? german : english; }
