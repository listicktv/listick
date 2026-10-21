import crypto from 'node:crypto';

// Loaded before any test (node --import): the settings the app reads at import time. Tests wipe their database, so they only
// run against one whose name ends in _test.
const url = process.env.DATABASE_URL || '';
if (!/\/[\w-]+_test(\?|$)/.test(url)) throw new Error('tests need DATABASE_URL pointing at a database whose name ends in _test');
process.env.BETTER_AUTH_SECRET ||= crypto.randomBytes(32).toString('base64');
process.env.BETTER_AUTH_URL ||= 'http://localhost:3000';
process.env.APP_ORIGIN = 'http://localhost:3000';
process.env.TMDB_ACCESS_TOKEN = 'test';
// email on, so new accounts confirm their address (Resend itself is answered by a fixture)
process.env.RESEND_API_KEY = 'test';
process.env.MAIL_FROM = 'Listick <test@example.com>';
for (const k of ['LISTICK_CONTACT', 'LISTICK_WEATHER', 'TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET', 'MAL_CLIENT_ID', 'OMDB_API_KEY']) delete process.env[k];
