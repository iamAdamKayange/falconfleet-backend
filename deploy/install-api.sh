#!/usr/bin/env bash
# Run after extracting the reviewed release to /opt/falconfleet-backend and npm ci.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo 'Run as root.' >&2; exit 1; }
cd /opt/falconfleet-backend
command -v node >/dev/null
command -v curl >/dev/null
command -v runuser >/dev/null
[[ $(node -p 'Number(process.versions.node.split(".")[0])') -ge 24 ]] || { echo 'Node 24+ required.' >&2; exit 1; }
[[ -f src/secure-server.js && -d node_modules ]] || { echo 'Extract release and run npm ci first.' >&2; exit 1; }
[[ -f /etc/falconfleet/api.env ]] || { echo 'Create /etc/falconfleet/api.env from deploy/api.env.example first.' >&2; exit 1; }
id falconfleet >/dev/null 2>&1 || useradd --system --home-dir /opt/falconfleet-backend --shell /usr/sbin/nologin falconfleet
chown root:falconfleet /etc/falconfleet /etc/falconfleet/api.env
chmod 0750 /etc/falconfleet
chmod 0640 /etc/falconfleet/api.env
# Validate as the service user without printing credentials or sourcing shell code.
runuser -u falconfleet -- /usr/bin/node --env-file=/etc/falconfleet/api.env deploy/check-production.mjs
npm test
install -m 0644 deploy/falconfleet-api.service /etc/systemd/system/falconfleet-api.service
systemctl daemon-reload
systemctl enable falconfleet-api
systemctl restart falconfleet-api
for attempt in {1..20}; do
  if curl --fail --silent http://127.0.0.1:4000/v2/health | /usr/bin/node --input-type=module -e '
    let text=""; for await (const chunk of process.stdin) text+=chunk;
    const health=JSON.parse(text); if(health.status!=="ok" || health.storage!=="postgres") process.exit(1);
  '; then
    echo 'API healthy on loopback with PostgreSQL. Configure the reviewed HTTPS proxy next.'
    exit 0
  fi
  sleep 1
done
echo 'Health check failed. Inspect journalctl -u falconfleet-api; restore the previous release if needed.' >&2
exit 1

