# falconfleet-backend

FalconFleet Express API with PostgreSQL persistence, nine roles, tenant and assignment checks, cookie sessions, TOTP MFA and recipient-specific notifications.

## Local setup

Requires Node.js 22.9 or newer; Node.js 24 is recommended.

```sh
npm ci
cp .env.example .env
npm run dev
```

For synthetic local accounts, leave DATABASE_URL empty and set DEMO_MODE=true. Production requires PostgreSQL, NODE_ENV=production and an HTTPS APP_ORIGIN. Never commit .env. The API listens on 127.0.0.1:4000 and exposes /v2 routes; place an HTTPS reverse proxy in front of it.

```sh
npm test
npm run bootstrap
npm start
```

Bootstrap requires ADMIN_EMAIL, ADMIN_NAME and ADMIN_PASSWORD in the private server environment. Set a strong unique password. Privileged production accounts must enroll in MFA.

## Notifications

Notifications are scoped to recipient, active role and school. Supports list, read/unread, mark all read and deletion. Boarding notifications go only to linked guardians and permitted staff. SMS and push delivery are not connected.

## Hetzner

See deploy/README.md for the standalone backend deployment procedure. Frontend repository: https://github.com/iamAdamKayange/falconfleet-frontend

The database currently stores an atomic JSONB aggregate for pilot use. Hardware ingestion, password/MFA recovery, guardian verification and relational/RLS migrations remain release work.
