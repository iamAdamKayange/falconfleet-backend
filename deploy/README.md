# Hetzner backend deployment

Use a reviewed release at /opt/falconfleet-backend. Install Node.js 24+ at /usr/bin/node and run npm ci in this directory. Preserve the previous release for rollback.

Create /etc/falconfleet/api.env using api.env.example and privately enter the real PostgreSQL URL and frontend HTTPS APP_ORIGIN. Do not commit or publish these values.

Run bash deploy/install-api.sh as root. It verifies production configuration and a PostgreSQL transaction, runs tests, installs/restarts the falconfleet-api systemd service and checks /v2/health on loopback port 4000. It does not install Node or change DNS, firewall, SSH or existing proxy configuration.

Bootstrap the initial administrator privately using the same database environment and ADMIN_EMAIL, ADMIN_NAME and ADMIN_PASSWORD. From the release directory run node --env-file=/etc/falconfleet/api.env src/bootstrap-admin.js with these admin values supplied privately through the environment. Unset ADMIN_PASSWORD afterwards.

Configure the HTTPS frontend proxy so /api/* maps to http://127.0.0.1:4000/v2/*. Alternatively, the frontend Next.js proxy uses API_INTERNAL_URL=http://127.0.0.1:4000. Keep port 4000 private. Verify login, MFA, logout and permissions over HTTPS before enabling real users.

For rollback, restore the previous release at /opt/falconfleet-backend and restart falconfleet-api. Review journalctl -u falconfleet-api if the health check fails. Database backups and restore rehearsal must be arranged separately.
