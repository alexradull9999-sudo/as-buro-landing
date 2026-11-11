import {validPhone} from './quiz-core.mjs';
import {sendDirect} from './form-delivery.mjs';
import {prepareCaptcha, sendHosted} from './hosted-delivery.mjs';

const form = document.querySelector('#callback-form');
const phone = document.querySelector('#callback-phone');
const status = document.querySelector('#callback-send-status');
let submitting = false;
if (form.dataset.delivery === 'web3forms') prepareCaptcha(form, status);

phone.addEventListener('input', () => {
  phone.setCustomValidity('');
  phone.removeAttribute('aria-invalid');
});
phone.addEventListener('blur', () => {
  if (phone.value && !validPhone(phone.value)) {
    phone.setCustomValidity('Укажите телефон полностью: от 10 до 15 цифр.');
    phone.setAttribute('aria-invalid','true');
  }
});
form.addEventListener('submit', event => {
  if (submitting || form.elements._honey.value) {event.preventDefault();return;}
  phone.setCustomValidity(validPhone(phone.value) ? '' : 'Укажите телефон полностью: от 10 до 15 цифр.');
  if (!form.reportValidity()) {event.preventDefault();return;}
  submitting = true;
  form.setAttribute('aria-busy','true');
  if (form.dataset.delivery === 'web3forms') {
    event.preventDefault();
    void sendHosted(form, status).finally(() => {submitting = false;});
    return;
  }
  if (form.dataset.delivery === 'smtp') {
    event.preventDefault();
    void sendDirect(form, status).finally(() => {submitting = false;});
    return;
  }
  status.textContent = 'Переходим к проверке от спама для отправки заявки.';
  // The real native POST uses the same activated recipient and CAPTCHA as the quiz.
});
window.addEventListener('pageshow', () => {
  submitting = false;
  form.removeAttribute('aria-busy');
  status.textContent = '';
});
for (const key of ['utm_source','utm_medium','utm_campaign']) {
  const value = new URLSearchParams(location.search).get(key);
  if (value) form.elements[key].value = value.slice(0,150);
}
