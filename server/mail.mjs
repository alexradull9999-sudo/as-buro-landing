import nodemailer from 'nodemailer';

export function mailConfig(env = process.env) {
  for (const key of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM']) {
    if (!env[key]?.trim()) throw new Error(`Missing ${key}`);
  }
  const port = Number(env.SMTP_PORT || 465);
  if (![465, 587].includes(port)) throw new Error('SMTP_PORT must be 465 or 587');
  const from = env.MAIL_FROM.trim();
  const to = (env.LEADS_TO || 'offer@a-s-buro.com').trim();
  for (const address of [from, to]) {
    if (!/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(address)) {
      throw new Error('MAIL_FROM and LEADS_TO must each contain one email address');
    }
  }
  return {
    from, to,
    transport: nodemailer.createTransport({
      host: env.SMTP_HOST.trim(), port, secure: port === 465, requireTLS: true,
      auth: {user: env.SMTP_USER.trim(), pass: env.SMTP_PASS},
      tls: {minVersion: 'TLSv1.2'},
      connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000,
      disableFileAccess: true, disableUrlAccess: true,
      logger: false, debug: false
    })
  };
}
