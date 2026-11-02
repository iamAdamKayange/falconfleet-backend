# Hetzner backend deployment

Use a reviewed release at /opt/falconfleet-backend. Install Node.js 22.9+ at /usr/bin/node and run npm ci in this directory. Node.js 24 is recommended. Preserve the previous release for rollback.

Create /etc/falconfleet/api.env using api.env.example and privately enter the real PostgreSQL URL and frontend HTTPS APP_ORIGIN. Do not commit or publish these values. Keep an existing env file when updating the application. Set PORT=4001 if 4000 belongs to another app.

To configure Adam Kayange (adamkayange223@gmail.com) as the first Platform Admin plus eight demo roles, run `node deploy/configure-accounts.mjs` as root. It adds the account flags and generates separate random passwords directly in the private env file, retaining existing nonempty passwords. View them privately with `nano /etc/falconfleet/api.env`. Passwords must have 10–128 characters. Set `SEED_DEMO_ACCOUNTS=false` if demo accounts are not desired. This flag controls creation only; disable existing demo users through account management when retiring the demo.

Demo emails use `ROLE@demo.falconfleet.test`: school_admin, transport_officer, dispatcher, driver, maintenance_officer, finance_officer, guardian and auditor. Their passwords use the corresponding `DEMO_ROLE_PASSWORD` env keys in uppercase. These users belong to a separate FalconFleet Demo School and receive a welcome notification; no pupils or tracking events are inserted. School Admin still enrolls in MFA in production.

Run bash deploy/install-api.sh as root. It runs tests, automatically applies pending migrations, verifies a PostgreSQL transaction, provisions configured accounts, installs/restarts the falconfleet-api systemd service and checks /v2/health on the configured loopback PORT (default 4000). Migration or provisioning errors stop activation. The installer refuses an occupied port on first installation. It does not install Node or change DNS, firewall, SSH or existing proxy configuration.

Versioned migrations live in database/migrations and are recorded with checksums in falconfleet_migrations. They run under a PostgreSQL advisory lock; each file commits atomically and is skipped after success. API startup also applies pending migrations, so direct service restarts have the same schema protection. Never edit an already applied migration; add the next numbered SQL file without BEGIN/COMMIT. The legacy database/001_initial.sql is not part of the v2 migration sequence. Existing identity data is preserved.

Provisioning runs when BOOTSTRAP_ADMIN=true or SEED_DEMO_ACCOUNTS=true. Redeploys preserve existing account passwords, disabled status and MFA; changing env values does not reset accounts. After initial creation you can remove account password variables and set both flags false. The manual src/bootstrap-admin.js remains available as an alternative for a fresh database.

For an explicit reset of the configured Adam Kayange admin and all eight demo accounts, supply `ACCOUNT_PASSWORD` privately and run `node deploy/set-passwords.mjs` as root. This updates all nine hashes in PostgreSQL and all nine password values in the private env file. It revokes their sessions and preserves MFA and disabled status. Restart falconfleet-api afterwards to reload the environment and clear stale login throttles. The password is never stored in the repository or printed by the script. This command is manual and is not run by normal deployment.

Configure the HTTPS frontend proxy so /api/* maps to http://127.0.0.1:PORT/v2/*. Alternatively, the frontend Next.js proxy uses API_INTERNAL_URL=http://127.0.0.1:PORT. Replace PORT with the configured API port (e.g. 4001). Keep that port private. Verify login, MFA, logout and permissions over HTTPS before enabling real users.

For rollback, restore the previous release at /opt/falconfleet-backend and restart falconfleet-api. Review journalctl -u falconfleet-api if the health check fails. Database backups and restore rehearsal must be arranged separately.
