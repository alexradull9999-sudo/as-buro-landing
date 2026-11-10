import {mailConfig} from './mail.mjs';

try {
  const {transport} = mailConfig();
  await transport.verify();
  transport.close();
  console.log('SMTP connection, TLS and authentication verified. No email was sent.');
} catch (error) {
  // Never print server responses, usernames, passwords or message contents.
  console.error('SMTP verification failed:', error.code || 'CONFIGURATION_ERROR');
  process.exitCode = 1;
}
