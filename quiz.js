import {QUESTION_NAMES, validPhone, firstUnanswered, buildSummary} from './quiz-core.mjs';

const form = document.querySelector('#quiz-form');
const steps = [...form.querySelectorAll('[data-step]')];
const contact = document.querySelector('#quiz-contact');
const nav = form.querySelector('.quiz-navigation');
const next = document.querySelector('#quiz-next');
const back = document.querySelector('#quiz-back');
const phone = document.querySelector('#lead-phone');
const progress = document.querySelector('#quiz-progress');
const status = document.querySelector('#quiz-send-status');
let step = 0;
let submitting = false;

function values() {
  const data = new FormData(form);
  return Object.fromEntries(QUESTION_NAMES.map(name => [name, String(data.get(name) || '')]));
}
function render(focus = true) {
  steps.forEach((panel, i) => panel.hidden = i !== step);
  contact.hidden = step < 3;
  nav.hidden = false;
  back.hidden = step === 0;
  next.hidden = step === 3;
  const answered = values();
  next.disabled = !answered[QUESTION_NAMES[step]];
  next.replaceChildren(document.createTextNode(step === 2 ? 'К подарку и контактам ' : 'Далее '));
  const arrow = document.createElement('span'); arrow.textContent = '→'; arrow.setAttribute('aria-hidden','true');next.append(arrow);
  document.querySelector('#quiz-progress-label').textContent = step < 3 ? `Вопрос ${step + 1} из 3` : 'Все три вопроса пройдены';
  document.querySelector('#quiz-progress-value').textContent = `${step} / 3`;
  progress.setAttribute('aria-valuenow', String(step));
  progress.firstElementChild.style.width = `${step / 3 * 100}%`;
  document.querySelector('#quiz-answer-summary').textContent = buildSummary(answered);
  if (focus) {
    const title = step < 3 ? steps[step].querySelector('legend') : contact.querySelector('h3');
    title.focus({preventScroll:true});
    if (window.matchMedia('(max-width:760px)').matches) {
      title.scrollIntoView({block:'start',behavior:window.matchMedia('(prefers-reduced-motion:reduce)').matches?'instant':'smooth'});
    }
  }
}
form.addEventListener('change', event => {
  if (event.target.type === 'radio') {
    next.disabled = !values()[QUESTION_NAMES[step]];
    document.querySelector('#quiz-answer-summary').textContent = buildSummary(values());
  }
});
next.addEventListener('click', () => {
  if (!values()[QUESTION_NAMES[step]]) return;
  step = Math.min(3, step + 1); render();
});
back.addEventListener('click', () => { step = Math.max(0, step - 1); render(); });
form.addEventListener('keydown', event => {
  if (event.key === 'Enter' && step < 3) {event.preventDefault();if (!next.disabled) next.click();}
});
// Do not let required fields in a later step intercept question navigation.
form.addEventListener('invalid', event => {
  if (step < 3 && !QUESTION_NAMES.includes(event.target.name)) event.preventDefault();
}, true);
phone.addEventListener('input', () => {phone.setCustomValidity('');phone.removeAttribute('aria-invalid');});
phone.addEventListener('blur', () => {
  if (phone.value && !validPhone(phone.value)) {
    phone.setCustomValidity('Укажите телефон полностью: от 10 до 15 цифр.');
    phone.setAttribute('aria-invalid','true');
  }
});
form.addEventListener('submit', event => {
  if (submitting) {event.preventDefault();return;}
  const missing = firstUnanswered(values());
  if (missing !== -1) {event.preventDefault();step = missing;render();return;}
  if (step < 3) {event.preventDefault();step = 3;render();return;}
  phone.setCustomValidity(validPhone(phone.value) ? '' : 'Укажите телефон полностью: от 10 до 15 цифр.');
  if (!form.reportValidity()) {event.preventDefault();return;}
  if (form.elements._honey.value) {event.preventDefault();return;}
  submitting = true;
  form.setAttribute('aria-busy','true');
  status.textContent = 'Переходим к проверке от спама. После отправки откроется подборка.';
  // A regular POST keeps the provider's CAPTCHA. No optimistic delivery message.
});
window.addEventListener('pageshow', () => {submitting = false;form.removeAttribute('aria-busy');status.textContent='';});
for (const key of ['utm_source','utm_medium','utm_campaign']) {
  const value = new URLSearchParams(location.search).get(key);
  if (value) form.elements[key].value = value.slice(0,150);
}
render(false);
