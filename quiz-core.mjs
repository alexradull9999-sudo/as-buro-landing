export const QUESTION_NAMES = ['Тип объекта', 'Площадь объекта', 'Состав работ'];

export function validPhone(value) {
  const phone = String(value).trim();
  if (!/^\+?[\d\s().-]+$/.test(phone)) return false;
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15 && !/^(\d)\1+$/.test(digits);
}

export function firstUnanswered(values) {
  return QUESTION_NAMES.findIndex(name => !values[name]);
}

export function buildSummary(values) {
  return QUESTION_NAMES.map(name => values[name]).filter(Boolean).join(' · ');
}
