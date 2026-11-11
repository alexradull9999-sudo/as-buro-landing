import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hostedPayload, sendHosted} from '../hosted-delivery.mjs';
const KEY = '00000000-0000-4000-8000-000000000001';
function data(extra = {}) {return new URLSearchParams({access_key: KEY, 'h-captcha-response': 'mock-token', 'Телефон': '+7 (499) 674-06-71', 'Способ связи': 'Telegram', 'Согласие на обработку данных': 'Дано пользователем', ...extra});}
function fixture(id = 'callback-form') {
  const button = {disabled: false}, status = {textContent: ''}, navigations = [];
  const form = {id, querySelector: () => button, removeAttribute: () => {}};
  const options = {formData: () => data(), resetCaptcha: () => {}, navigate: path => navigations.push(path)};
  return {form, button, status, options, navigations};
}
test('Payload fixes the subject and website, preserves selected fields and excludes redirect/header injection', () => {
  const p = hostedPayload('quiz-form', data({'Тип объекта': 'Квартира', 'Площадь объекта': '80–150 м²', 'Состав работ': 'Дизайн-проект', utm_source: 'test', redirect: 'https://attacker.example', subject: 'injected', replyto: 'attacker@example.com'}));
  assert.equal(p['Телефон'], '+7 (499) 674-06-71');
  assert.equal(p['Тип объекта'], 'Квартира');
  assert.equal(p['Сайт'], 'https://a-s-buro.ru/');
  assert.equal(p.utm_source, 'test');
  assert.match(p.message, /Тип объекта: Квартира/);
  assert.match(p.message, /Телефон: \+7 \(499\) 674-06-71/);
  assert.equal(p.redirect, undefined); assert.equal(p.replyto, undefined);
  assert.equal(p.subject, 'АС Бюро — новая заявка из квиза');
});
test('Missing recipient key, CAPTCHA, honeypot and unknown form cannot reach the provider', () => {
  for (const extra of [{access_key: 'PENDING_OWNER_VERIFICATION'}, {'h-captcha-response': ''}, {_honey: 'bot'}, {botcheck: 'on'}]) assert.throws(() => hostedPayload('callback-form', data(extra)));
  assert.throws(() => hostedPayload('unknown', data()));
});
test('Only a confirmed success redirects, for each fixed form destination', async () => {
  for (const [id, path] of [['callback-form', '/contact-thanks.html'], ['quiz-form', '/thanks.html']]) {
    const f = fixture(id);
    await sendHosted(f.form, f.status, {...f.options, request: async (url, options) => {
      assert.equal(url, 'https://api.web3forms.com/submit');
      assert.equal(options.credentials, 'omit');
      assert.equal(JSON.parse(options.body).access_key, KEY);
      return {ok: true, status: 200, json: async () => ({success: true, redirect: 'https://attacker.example'})};
    }});
    assert.deepEqual(f.navigations, [path]); assert.equal(f.button.disabled, false);
  }
});
test('500 HTML, rejected/false successes, malformed JSON and network failure never show success and allow a retry', async () => {
  const cases = [
    async () => ({ok: false, status: 500}),
    async () => ({ok: true, status: 200, json: async () => ({success: false})}),
    async () => ({ok: true, status: 200, json: async () => ({success: 'false'})}),
    async () => ({ok: true, status: 200, json: async () => {throw new Error('invalid JSON');}}),
    async () => {throw new TypeError('network');}
  ];
  for (const request of cases) {
    const f = fixture();
    await sendHosted(f.form, f.status, {...f.options, request});
    assert.deepEqual(f.navigations, []); assert.equal(f.button.disabled, false);
    assert.match(f.status.textContent, /Нет подтверждения отправки/);
    await sendHosted(f.form, f.status, {...f.options, request: async () => ({ok: true, status: 200, json: async () => ({success: true})})});
    assert.deepEqual(f.navigations, ['/contact-thanks.html']);
  }
});
test('Timeout releases the form and does not automatically retry or clear input', async () => {
  const f = fixture(); let calls = 0;
  await sendHosted(f.form, f.status, {...f.options, timeout: 5, request: async (url, {signal}) => {
    calls++;
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
  }});
  assert.equal(calls, 1); assert.equal(f.button.disabled, false);
  assert.deepEqual(f.navigations, []); assert.match(f.status.textContent, /Данные сохранены в форме/);
});
test('Repeated clicks share one in-flight attempt and rate limits display a useful error', async () => {
  const f = fixture(); let calls = 0, finish;
  const options = {...f.options, request: async () => {calls++; return new Promise(resolve => {finish = resolve;});}};
  const first = sendHosted(f.form, f.status, options);
  await sendHosted(f.form, f.status, options);
  assert.equal(calls, 1);
  finish({ok: false, status: 429}); await first;
  assert.match(f.status.textContent, /временно ограничил/);
});
