#!/usr/bin/env bash
# Run after extracting the reviewed release to /opt/falconfleet-backend and npm ci.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo 'Run as root.' >&2; exit 1; }
cd /opt/falconfleet-backend
command -v node >/dev/null
command -v curl >/dev/null
command -v runuser >/dev/null
/usr/bin/node -e 'const [major,minor]=process.versions.node.split(".").map(Number); process.exit(major>22 || (major===22 && minor>=9) ? 0 : 1)' || { echo 'Node 22.9+ required at /usr/bin/node.' >&2; exit 1; }
[[ -f src/secure-server.js && -d node_modules ]] || { echo 'Extract release and run npm ci first.' >&2; exit 1; }
[[ -f /etc/falconfleet/api.env ]] || { echo 'Create /etc/falconfleet/api.env from deploy/api.env.example first.' >&2; exit 1; }
id falconfleet >/dev/null 2>&1 || useradd --system --home-dir /opt/falconfleet-backend --shell /usr/sbin/nologin falconfleet
chown root:falconfleet /etc/falconfleet /etc/falconfleet/api.env
chmod 0750 /etc/falconfleet
chmod 0640 /etc/falconfleet/api.env
api_port=$(/usr/bin/node --env-file=/etc/falconfleet/api.env --input-type=module -e '
  const port=Number(process.env.PORT || 4000);
  if(!Number.isInteger(port) || port<1024 || port>65535) throw Error("PORT must be an integer from 1024 to 65535");
  console.log(port);
')
# Do not replace or stop an unrelated listener on this host.
command -v ss >/dev/null
if [[ -n $(ss -H -ltn "sport = :$api_port") ]] && ! systemctl is-active --quiet falconfleet-api; then
  echo "Port $api_port is occupied. Choose a free PORT in /etc/falconfleet/api.env." >&2
  exit 1
fi
# Validate as the service user without printing credentials or sourcing shell code.
npm test
runuser -u falconfleet -- /usr/bin/node --env-file=/etc/falconfleet/api.env src/migrate.js
runuser -u falconfleet -- /usr/bin/node --env-file=/etc/falconfleet/api.env deploy/check-production.mjs
runuser -u falconfleet -- /usr/bin/node --env-file=/etc/falconfleet/api.env deploy/provision.mjs
install -m 0644 deploy/falconfleet-api.service /etc/systemd/system/falconfleet-api.service
systemctl daemon-reload
systemctl enable falconfleet-api
systemctl restart falconfleet-api
for attempt in {1..20}; do
  if curl --fail --silent --max-time 5 "http://127.0.0.1:$api_port/v2/health" | /usr/bin/node --input-type=module -e '
    let text=""; for await (const chunk of process.stdin) text+=chunk;
    const health=JSON.parse(text); if(health.status!=="ok" || health.storage!=="postgres") process.exit(1);
  '; then
    echo "API healthy on 127.0.0.1:$api_port with PostgreSQL. Configure the reviewed HTTPS proxy for this port next."
    exit 0
  fi
  sleep 1
done
echo 'Health check failed. Inspect journalctl -u falconfleet-api; restore the previous release if needed.' >&2
exit 1

