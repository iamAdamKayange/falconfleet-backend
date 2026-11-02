import { createIdentityStore } from '../src/identity-store.js';

if (process.env.NODE_ENV !== 'production') throw Error('NODE_ENV must be production');
if (!process.env.DATABASE_URL) throw Error('DATABASE_URL is required');
const origin = new URL(process.env.APP_ORIGIN || '');
if (origin.protocol !== 'https:' || origin.origin !== process.env.APP_ORIGIN)
  throw Error('APP_ORIGIN must be an HTTPS origin without a trailing slash or path');
if (process.env.DEMO_MODE === 'true') throw Error('Disable DEMO_MODE for production');
const port = Number(process.env.PORT || 4000);
if (port !== 4000) throw Error('Deployment proxy and health checks require PORT=4000');
const store = createIdentityStore(process.env.DATABASE_URL);
try {
  await store.init();
  await store.transaction(() => true);
  console.log('Production configuration and PostgreSQL transaction verified.');
} finally {
  await store.close();
}

