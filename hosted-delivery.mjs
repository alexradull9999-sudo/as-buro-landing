const ENDPOINT = 'https://api.web3forms.com/submit';
const ROUTES = {
  'quiz-form': {subject: 'АС Бюро — новая заявка из квиза', next: '/thanks.html'},
  'callback-form': {subject: 'АС Бюро — заявка на обратную связь', next: '/contact-thanks.html'}
};
const FIELDS = ['Источник', 'Телефон', 'Способ связи', 'Согласие на обработку данных', 'Тип объекта', 'Площадь объекта', 'Состав работ', 'Кнопка обращения', 'utm_source', 'utm_medium', 'utm_campaign'];
export const DELIVERY_TIMEOUT = 20000;
const pending = new WeakSet();
const widgets = new WeakMap();
let captchaReady;

export function hostedPayload(formId, data) {
  if (!ROUTES[formId]) throw new Error('Unknown form');
  const accessKey = data.get('access_key');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(accessKey || '')) throw new Error('unconfigured');
  if (data.get('_honey') || data.get('botcheck')) throw new Error('spam');
  const captcha = data.get('h-captcha-response');
  if (!captcha) throw new Error('captcha');
  const payload = {access_key: accessKey, subject: ROUTES[formId].subject, from_name: 'АС Бюро', 'Сайт': 'https://a-s-buro.ru/', 'h-captcha-response': captcha};
  for (const name of FIELDS) {
    const value = data.get(name);
    if (typeof value === 'string' && value) payload[name] = value;
  }
  payload.message = FIELDS.filter(name => payload[name]).map(name => `${name}: ${payload[name]}`).join('\n');
  return payload;
}

export function prepareCaptcha(form, status) {
  if (!captchaReady) captchaReady = new Promise((resolve, reject) => {
    if (window.hcaptcha) {resolve(window.hcaptcha); return;}
    window.asBuroCaptchaReady = () => resolve(window.hcaptcha);
    const script = document.createElement('script');
    script.src = 'https://js.hcaptcha.com/1/api.js?onload=asBuroCaptchaReady&render=explicit&hl=ru&recaptchacompat=off';
    script.async = true;
    script.onerror = () => reject(new Error('captcha-unavailable'));
    document.head.append(script);
  });
  void captchaReady.then(api => {
    if (widgets.has(form)) return;
    widgets.set(form, api.render(form.querySelector('[data-delivery-captcha]'), {
      sitekey: '50b2fe65-b00b-4b9e-ad62-3ba471098be2', theme: 'dark', size: 'compact'
    }));
  }).catch(() => {status.textContent = 'Не загрузилась проверка от спама. Обновите страницу или позвоните: +7 (499) 674-06-71.';});
}

export async function sendHosted(form, status, {
  request = fetch, navigate = url => window.location.assign(url),
  formData = () => new FormData(form), timeout = DELIVERY_TIMEOUT,
  resetCaptcha = () => {
    if (widgets.has(form) && window.hcaptcha) window.hcaptcha.reset(widgets.get(form));
  }
} = {}) {
  if (pending.has(form)) return;
  pending.add(form);
  const button = form.querySelector('[type="submit"]');
  let timer;
  let attempted = false;
  try {
    const payload = hostedPayload(form.id, formData());
    button.disabled = true;
    status.textContent = 'Отправляем заявку…';
    const controller = new AbortController();
    timer = setTimeout(() => controller.abort(), timeout);
    attempted = true;
    const response = await request(ENDPOINT, {
      method: 'POST', credentials: 'omit', signal: controller.signal,
      headers: {'Content-Type': 'application/json', Accept: 'application/json'},
      body: JSON.stringify(payload)
    });
    if (response.status === 429) throw new Error('rate-limit');
    if (!response.ok) throw new Error('provider');
    const result = await response.json();
    if (result.success !== true) throw new Error('provider');
    navigate(ROUTES[form.id].next);
  } catch (error) {
    status.textContent = error.message === 'captcha'
      ? 'Подтвердите, что вы не робот, и отправьте заявку ещё раз.'
      : error.message === 'unconfigured'
        ? 'Отправка ещё не подключена. Свяжитесь с бюро: +7 (499) 674-06-71.'
        : error.message === 'rate-limit'
          ? 'Сервис временно ограничил отправку. Попробуйте позже или позвоните: +7 (499) 674-06-71.'
          : 'Нет подтверждения отправки. Данные сохранены в форме. Повторите попытку или позвоните: +7 (499) 674-06-71.';
    // Keep contacts in the current form only; never log, persist or automatically retry.
    if (attempted) resetCaptcha();
  } finally {
    clearTimeout(timer);
    button.disabled = false;
    form.removeAttribute('aria-busy');
    pending.delete(form);
  }
}
