import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {readFile} from 'node:fs/promises';
import {createLandingServer} from '../server/server.mjs';
import {mailConfig} from '../server/mail.mjs';

const ORIGIN = 'https://a-s-buro.ru';
const TO = 'offer@a-s-buro.com';
async function fixture(t, options = {}) {
  const messages = [], logs = [];
  const server = createLandingServer({
    from: 'website@example.com',
    sendMail: async message => {messages.push(message); return {accepted: [TO]};},
    logger: {info: data => logs.push(data), error: data => logs.push(data)}, ...options
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => {server.close(resolve); server.closeAllConnections();}));
  const base = `http://127.0.0.1:${server.address().port}`;
  const html = await (await fetch(base)).text();
  const tokens = Object.fromEntries([...html.matchAll(/action="\/api\/leads\/(quiz|callback)"[^>]*><input type="hidden" name="_request" value="([^"]+)"/g)].map(m => [m[1], m[2]]));
  function data(kind = 'callback', extra = {}) {
    return new URLSearchParams({
      '_request': tokens[kind], '_honey': '',
      'Телефон': '+7 (999) 123-45-67', 'Способ связи': 'Telegram',
      'Согласие на обработку данных': 'Дано пользователем',
      ...(kind === 'quiz' ? {'Тип объекта': 'Квартира', 'Площадь объекта': '80–150 м²', 'Состав работ': 'Проект и реализация под ключ'} : {}),
      ...extra
    });
  }
  const post = (body, kind = 'callback', headers = {}) => fetch(`${base}/api/leads/${kind}`, {
    method: 'POST', headers: {Origin: ORIGIN, Accept: 'application/json', ...headers}, body, redirect: 'manual'
  });
  return {base, html, messages, logs, tokens, data, post};
}

test('Static forms use the correct domain; SMTP rendering changes only delivery fields', async t => {
  const f = await fixture(t);
  const source = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.equal((source.match(/action="https:\/\/formsubmit.co\/offer@a-s-buro.com"/g) || []).length, 2);
  assert.equal(source.includes('github.io'), false);
  for (const name of ['thanks.html', 'contact-thanks.html']) assert.ok(source.includes(`value="https://a-s-buro.ru/${name}"`));
  assert.equal(Object.keys(f.tokens).length, 2);
  assert.equal(f.html.includes('formsubmit.co'), false);
  assert.equal(f.html.includes('name="_next"'), false);
  const normalize = html => html.replace(/<input type="hidden" name="_request"[^>]*>/g, '')
    .replace(/action="[^"]*"(?: data-delivery="smtp")?/g, 'action="FORM"')
    .replace(/<input\b[^>]*\bname="_(subject|template|url|next)"[^>]*>/g, '');
  assert.equal(normalize(f.html), normalize(source));
});

test('Both forms send selected fields to the fixed recipient and choose fixed thanks pages', async t => {
  const f = await fixture(t);
  for (const kind of ['quiz', 'callback']) {
    const response = await f.post(f.data(kind, {'utm_source': 'test', '_next': 'https://attacker.example/', '_subject': 'Injected', 'to': 'attacker@example.com'}), kind);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {ok: true, next: kind === 'quiz' ? '/thanks.html' : '/contact-thanks.html'});
  }
  assert.equal(f.messages.length, 2);
  for (const mail of f.messages) {
    assert.equal(mail.to, TO);
    assert.equal(mail.from.address, 'website@example.com');
    assert.ok(mail.text.includes('Способ связи: Telegram'));
    assert.ok(mail.text.includes('utm_source: test'));
    assert.equal(mail.subject.includes('Injected'), false);
    assert.equal(mail.text.includes('attacker'), false);
  }
  assert.ok(f.messages[0].text.includes('Состав работ: Проект и реализация под ключ'));
  assert.equal(JSON.stringify(f.logs).includes('999'), false);
});

test('Native POST redirects only after SMTP acceptance', async t => {
  const f = await fixture(t);
  const response = await f.post(f.data(), 'callback', {Accept: 'text/html'});
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/contact-thanks.html');
  assert.equal(f.messages.length, 1);
});

test('Invalid phone, channel, consent, quiz answers, duplicate fields and honeypot never send', async t => {
  const f = await fixture(t);
  for (const extra of [{'Телефон': '123'}, {'Способ связи': ''}, {'Согласие на обработку данных': ''}, {'_honey': 'spam'}]) {
    assert.equal((await f.post(f.data('callback', extra))).status, 422);
  }
  assert.equal((await f.post(f.data('quiz', {'Тип объекта': 'forged'}), 'quiz')).status, 422);
  const duplicate = f.data(); duplicate.append('Телефон', '+79999999999');
  assert.equal((await f.post(duplicate)).status, 422);
  assert.equal(f.messages.length, 0);
});

test('Cross-site requests, forged, expired and wrong-form tokens are rejected', async t => {
  let time = Date.now();
  const f = await fixture(t, {now: () => time});
  assert.equal((await f.post(f.data(), 'callback', {Origin: 'https://attacker.example'})).status, 403);
  for (const token of ['', 'fake', f.tokens.quiz, f.tokens.callback.slice(0, -1) + 'z', f.tokens.callback.slice(0, -64) + 'я'.repeat(64)]) {
    assert.equal((await f.post(f.data('callback', {'_request': token}))).status, 403);
  }
  time += 3 * 60 * 60 * 1000;
  assert.equal((await f.post(f.data())).status, 403);
  assert.equal(f.messages.length, 0);
});

test('Concurrent and sequential retries do not send duplicates; changed payload needs a fresh form', async t => {
  let count = 0;
  const f = await fixture(t, {sendMail: async () => {count++; await new Promise(resolve => setTimeout(resolve, 30)); return {accepted: [TO]};}});
  const responses = await Promise.all([f.post(f.data()), f.post(f.data()), f.post(f.data())]);
  for (const response of responses) assert.equal(response.status, 200);
  assert.equal((await f.post(f.data())).status, 200);
  assert.equal(count, 1);
  assert.equal((await f.post(f.data('callback', {'Способ связи': 'MAX'}))).status, 409);
});

test('SMTP errors and rejected recipients never show success and can be retried', async t => {
  let attempt = 0;
  const f = await fixture(t, {sendMail: async () => {
    attempt++;
    if (attempt === 1) throw new Error('secret provider response');
    return attempt === 2 ? {accepted: [], rejected: [TO]} : {accepted: [TO]};
  }});
  for (let i = 0; i < 2; i++) {
    const response = await f.post(f.data());
    assert.equal(response.status, 502);
    assert.equal(response.headers.get('location'), null);
    assert.equal((await response.text()).includes('secret'), false);
  }
  assert.equal((await f.post(f.data())).status, 200);
  assert.equal(JSON.stringify(f.logs).includes('secret'), false);
});

test('Rate limits cannot be bypassed with an untrusted forwarded address', async t => {
  const f = await fixture(t, {sendMail: async () => {throw new Error('unavailable');}});
  for (let i = 0; i < 5; i++) assert.equal((await f.post(f.data(), 'callback', {'X-Forwarded-For': `192.0.2.${i}`})).status, 502);
  const response = await f.post(f.data());
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '600');
});

test('Private files and path traversal are blocked; assets and downloads remain accessible', async t => {
  const f = await fixture(t);
  for (const path of ['/server/server.mjs', '/server/.env', '/server/.env.example', '/.git/config', '/README.md', '/Dockerfile', '/assets/../server/package.json', '/assets/%2e%2e%2fserver/package.json']) {
    assert.equal((await fetch(f.base + path)).status, 404, path);
  }
  for (const path of ['/style.css', '/quiz.js', '/form-delivery.mjs', '/assets/logo.webp', '/downloads/AS-Buro-Interiors-2026.pdf', '/thanks.html', '/contact-thanks.html', '/healthz']) {
    const response = await fetch(f.base + path, {method: 'HEAD'});
    assert.equal(response.status, 200, path);
    assert.equal((await response.text()).length, 0);
  }
  assert.equal((await fetch(f.base)).headers.get('cache-control'), 'no-store');
});

test('Unsupported and oversized requests cannot reach SMTP', async t => {
  const f = await fixture(t);
  assert.equal((await f.post(JSON.stringify({}), 'callback', {'Content-Type': 'application/json'})).status, 415);
  assert.equal((await f.post(f.data('callback', {'utm_source': 'a'.repeat(17000)}))).status, 413);
  assert.equal((await fetch(f.base + '/api/leads/callback')).status, 405);
  assert.equal(f.messages.length, 0);
});

test('SMTP config requires credentials and TLS, restricts sender/recipient and never uses port 25', () => {
  assert.throws(() => mailConfig({}), /Missing/);
  const env = {SMTP_HOST: 'smtp.example.com', SMTP_USER: 'website@example.com', SMTP_PASS: 'test-only', MAIL_FROM: 'website@example.com'};
  for (const port of [465, 587]) {
    const config = mailConfig({...env, SMTP_PORT: String(port)});
    assert.equal(config.to, TO);
    assert.equal(config.transport.options.secure, port === 465);
    assert.equal(config.transport.options.requireTLS, true);
    config.transport.close();
  }
  assert.throws(() => mailConfig({...env, SMTP_PORT: '25'}), /SMTP_PORT/);
  assert.throws(() => mailConfig({...env, LEADS_TO: 'a@example.com,b@example.com'}), /one email/);
});
