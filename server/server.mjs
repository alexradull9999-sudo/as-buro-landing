import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve, extname, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHmac, randomBytes, randomUUID, timingSafeEqual} from 'node:crypto';
import {validPhone, QUESTION_NAMES} from '../quiz-core.mjs';
import {mailConfig} from './mail.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const TOKEN_LIFE = 2 * 60 * 60 * 1000;
const BODY_LIMIT = 16384;
const ROUTES = {
  quiz: {next: '/thanks.html', subject: 'АС Бюро — новая заявка из квиза', source: 'Лендинг АС Бюро · квиз'},
  callback: {next: '/contact-thanks.html', subject: 'АС Бюро — заявка на обратную связь', source: 'Лендинг АС Бюро · форма обратной связи'}
};
const ANSWERS = {
  'Тип объекта': ['Квартира', 'Загородный дом', 'Пентхаус или апартаменты'],
  'Площадь объекта': ['До 80 м²', '80–150 м²', '150–300 м²', 'Более 300 м²'],
  'Состав работ': ['Дизайн-проект', 'Проект и авторский надзор', 'Проект и реализация под ключ', 'Нужен совет бюро']
};
const PUBLIC_FILES = new Set([
  'index.html', 'thanks.html', 'contact-thanks.html',
  'style.css', 'home.css', 'project-updates.css',
  'script.js', 'projects.js', 'portfolio.js', 'quiz.js', 'callback.js',
  'quiz-core.mjs', 'form-delivery.mjs'
]);
const MIME = {'.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.pdf': 'application/pdf'};
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const reject = (status, message) => { throw new HttpError(status, message); };
const clean = value => String(value || '').replace(/[\x00-\x1f\x7f]/g, ' ').trim();
const escape = value => value.replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

function validate(data, kind) {
  for (const key of new Set(data.keys())) {
    if (data.getAll(key).length !== 1) reject(422, 'Проверьте заполнение формы.');
  }
  if (data.get('_honey')) reject(422, 'Не удалось отправить форму. Обновите страницу.');
  const phone = clean(data.get('Телефон'));
  if (phone.length > 24 || !validPhone(phone)) reject(422, 'Укажите телефон полностью: от 10 до 15 цифр.');
  const channel = data.get('Способ связи');
  if (!['Telegram', 'WhatsApp', 'MAX'].includes(channel)) reject(422, 'Выберите способ связи.');
  if (data.get('Согласие на обработку данных') !== 'Дано пользователем') reject(422, 'Подтвердите согласие на обработку данных.');
  const fields = {'Источник': ROUTES[kind].source, 'Телефон': phone, 'Способ связи': channel, 'Согласие на обработку данных': 'Дано пользователем'};
  if (kind === 'quiz') for (const name of QUESTION_NAMES) {
    const answer = data.get(name);
    if (!ANSWERS[name].includes(answer)) reject(422, 'Ответьте на все три вопроса квиза.');
    fields[name] = answer;
  }
  for (const name of ['Кнопка обращения', 'utm_source', 'utm_medium', 'utm_campaign']) {
    const value = clean(data.get(name));
    if (value.length > 150) reject(422, 'Слишком длинное значение в форме. Обновите страницу.');
    if (value) fields[name] = value;
  }
  return fields;
}

async function readBody(req) {
  if (Number(req.headers['content-length']) > BODY_LIMIT) reject(413, 'Форма слишком большая.');
  let length = 0;
  const chunks = [];
  for await (const chunk of req) {
    length += chunk.length;
    if (length > BODY_LIMIT) reject(413, 'Форма слишком большая.');
    chunks.push(chunk);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

export function createLandingServer({sendMail, from, to = 'offer@a-s-buro.com', origin = 'https://a-s-buro.ru', secret = randomBytes(32).toString('hex'), trustProxyHops = 0, root = ROOT, now = Date.now, logger = console}) {
  const site = new URL(origin);
  if (!['http:', 'https:'].includes(site.protocol) || site.username || site.password || site.pathname !== '/' || site.search || site.hash) throw new Error('SITE_ORIGIN must be an origin without a path');
  if (!Number.isInteger(trustProxyHops) || trustProxyHops < 0 || trustProxyHops > 5) throw new Error('Invalid TRUST_PROXY_HOPS');
  if (secret.length < 32) throw new Error('FORM_SECRET must contain at least 32 characters');
  const deliveries = new Map();
  const limits = new Map();
  const digest = value => createHmac('sha256', secret).update(value).digest('hex');
  const token = kind => {
    const payload = `${now()}.${randomUUID()}.${kind}`;
    return `${payload}.${digest(payload)}`;
  };
  function verifyToken(value, kind) {
    if (typeof value !== 'string' || value.length > 180) reject(403, 'Обновите страницу и отправьте форму ещё раз.');
    const parts = value.split('.');
    const signature = parts.pop();
    const payload = parts.join('.');
    const expected = digest(payload);
    if (parts.length !== 3 || parts[2] !== kind || !/^\d+$/.test(parts[0]) || !/^[0-9a-f-]{36}$/.test(parts[1]) || now() - Number(parts[0]) < 0 || now() - Number(parts[0]) > TOKEN_LIFE || !/^[0-9a-f]{64}$/.test(signature || '') || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      reject(403, 'Обновите страницу и отправьте форму ещё раз.');
    }
    return parts[1];
  }
  function rateLimit(req) {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',').map(v => v.trim()).filter(Boolean);
    const address = trustProxyHops ? forwarded.at(-trustProxyHops) || req.socket.remoteAddress : req.socket.remoteAddress;
    const at = now();
    for (const [key, value] of limits) if (at >= value.until) limits.delete(key);
    for (const [key, maximum, duration] of [[digest(address || 'unknown'), 5, 600000], ['global', 100, 3600000]]) {
      const value = limits.get(key) || {count: 0, until: at + duration};
      if (value.count >= maximum || limits.size >= 10000) reject(429, 'Слишком много попыток. Попробуйте позже или позвоните: +7 (499) 674-06-71.');
      value.count++;
      limits.set(key, value);
    }
  }
  function reply(res, status, body, type = 'text/html; charset=utf-8', headers = {}, method = 'GET') {
    res.writeHead(status, {'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', ...headers});
    res.end(method === 'HEAD' ? undefined : body);
  }
  function errorReply(req, res, error) {
    const status = error.status || 500;
    const message = error.status ? error.message : 'Не удалось отправить заявку. Попробуйте позже или позвоните: +7 (499) 674-06-71.';
    const headers = status === 429 ? {'Retry-After': '600'} : {};
    if (req.headers.accept?.includes('application/json')) {
      reply(res, status, JSON.stringify({ok: false, error: message}), 'application/json; charset=utf-8', headers);
    } else {
      reply(res, status, `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Отправка заявки — АС Бюро</title><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/home.css"><body class="as"><main class="section"><div class="wrap"><h1>Не удалось отправить заявку</h1><p>${escape(message)}</p><p>Вернитесь назад в браузере, чтобы проверить данные, или <a href="/">откройте форму заново</a>.</p><a href="tel:+74996740671">+7 (499) 674-06-71</a></div></main></body></html>`, undefined, headers, req.method);
    }
  }
  async function submit(req, res, kind) {
    if (req.method !== 'POST') reject(405, 'Используйте форму на сайте.');
    let requestOrigin;
    try { requestOrigin = req.headers.origin || new URL(req.headers.referer).origin; } catch {}
    if (requestOrigin !== site.origin || req.headers['sec-fetch-site'] === 'cross-site') reject(403, 'Откройте форму на сайте АС Бюро.');
    if (req.headers['content-type']?.split(';')[0].trim() !== 'application/x-www-form-urlencoded') reject(415, 'Неподдерживаемый формат формы.');
    const data = await readBody(req);
    const fields = validate(data, kind);
    const id = verifyToken(data.get('_request'), kind);
    const fingerprint = digest(JSON.stringify(fields));
    for (const [key, record] of deliveries) if (now() - record.created > TOKEN_LIFE) deliveries.delete(key);
    let record = deliveries.get(id);
    if (record && record.fingerprint !== fingerprint) reject(409, 'Эта форма уже отправлена. Обновите страницу для новой заявки.');
    if (!record) {
      rateLimit(req);
      if (deliveries.size >= 10000) reject(503, 'Попробуйте отправить заявку позже.');
      record = {fingerprint, created: now()};
      // Store the promise before awaiting SMTP: simultaneous retries share one send.
      record.result = Promise.resolve().then(async () => {
        const result = await sendMail({
          from: {name: 'АС Бюро — сайт', address: from}, to,
          subject: ROUTES[kind].subject,
          messageId: `<${id}@${site.hostname}>`,
          text: [`Номер заявки: ${id}`, `Сайт: ${site.origin}/`, ...Object.entries(fields).map(([name, value]) => `${name}: ${value}`)].join('\n')
        });
        if (!result.accepted?.some(address => String(address).toLowerCase() === to.toLowerCase())) throw new Error('RECIPIENT_REJECTED');
        logger.info?.({event: 'lead_accepted', id, kind});
      }).catch(() => {
        deliveries.delete(id);
        logger.error?.({event: 'lead_delivery_failed', id, kind});
        throw new HttpError(502, 'Почтовый сервер не подтвердил приём заявки. Повторите попытку или позвоните: +7 (499) 674-06-71.');
      });
      deliveries.set(id, record);
    }
    await record.result;
    const next = ROUTES[kind].next;
    if (req.headers.accept?.includes('application/json')) reply(res, 200, JSON.stringify({ok: true, next}), 'application/json; charset=utf-8');
    else reply(res, 303, '', undefined, {Location: next});
  }
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://local');
      const kind = /^\/api\/leads\/(quiz|callback)$/.exec(url.pathname)?.[1];
      if (kind) return await submit(req, res, kind);
      if (!['GET', 'HEAD'].includes(req.method)) reject(405, 'Метод не поддерживается.');
      if (url.pathname === '/healthz') return reply(res, 200, '{"ok":true}', 'application/json', {}, req.method);
      const name = decodeURIComponent(url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
      const file = resolve(root, name);
      const asset = /^(assets|downloads)\//.test(name) && MIME[extname(name)] && !name.split('/').some(part => part.startsWith('.'));
      if (name.includes('\\') || name.includes('\0') || !file.startsWith(resolve(root) + sep) || !(PUBLIC_FILES.has(name) || asset)) reject(404, 'Страница не найдена.');
      let content;
      try { content = await readFile(file); } catch (error) {
        if (['ENOENT', 'EISDIR'].includes(error.code)) reject(404, 'Страница не найдена.');
        throw error;
      }
      if (name === 'index.html') {
        content = content.toString('utf8').replace(/<form\b[^>]*\bid="(quiz|callback)-form"[^>]*>/g, (tag, formKind) => tag.replace(/action="[^"]*"/, `action="/api/leads/${formKind}" data-delivery="smtp"`) + `<input type="hidden" name="_request" value="${token(formKind)}">`)
          .replace(/<input\b[^>]*\bname="_(subject|template|url|next)"[^>]*>/g, '');
      }
      reply(res, 200, content, MIME[extname(name)], {'Cache-Control': name.startsWith('assets/') || name.startsWith('downloads/') ? 'public, max-age=3600' : 'no-store'}, req.method);
    } catch (error) {
      if (!error.status) logger.error?.({event: 'request_failed'});
      if (!res.headersSent && !res.destroyed) errorReply(req, res, error);
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const {transport, from, to} = mailConfig();
    await transport.verify();
    const server = createLandingServer({
      sendMail: message => transport.sendMail(message), from, to,
      origin: process.env.SITE_ORIGIN || 'https://a-s-buro.ru',
      secret: process.env.FORM_SECRET || undefined,
      trustProxyHops: Number(process.env.TRUST_PROXY_HOPS || 0)
    });
    server.listen(Number(process.env.PORT || 8080), '0.0.0.0', () => console.log('Landing server ready'));
    for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
      server.close(() => {transport.close(); process.exit(0);});
      setTimeout(() => process.exit(1), 30000).unref();
    });
  } catch {
    console.error('Startup failed. Check SMTP and server configuration. No credentials are logged.');
    process.exitCode = 1;
  }
}
