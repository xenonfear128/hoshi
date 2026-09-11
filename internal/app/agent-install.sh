#!/bin/sh
set -eu
# Hoshi monitoring agent. Requires root (directly or explicitly authorized sudo).
[ "$(id -u)" = 0 ] || { echo 'root or authorized sudo is required'; exit 1; }
[ "$(uname -s)" = Linux ] || { echo 'Linux is required'; exit 1; }
command -v systemctl >/dev/null
[ -d /run/systemd/system ] || { echo 'systemd is required'; exit 1; }
case "$(uname -m)" in
 x86_64) arch=amd64; expected=__AMD64_SHA__ ;;
 aarch64|arm64) arch=arm64; expected=__ARM64_SHA__ ;;
 *) echo 'unsupported architecture'; exit 1 ;;
esac
source_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
mode=${1:-install}
unit=/etc/systemd/system/hoshi-agent.service
for path in /var/lib/hoshi-agent /usr/local/lib/hoshi-agent "$unit" /var/lib/hoshi-agent/config.json /var/lib/hoshi-agent/config.json.buffer /usr/local/lib/hoshi-agent/hoshi-agent.new; do
 [ ! -L "$path" ] || { echo 'unsafe installation path'; exit 1; }
done
fragment=$(systemctl show hoshi-agent.service --property=FragmentPath --value)
if [ -n "$fragment" ]; then
 [ "$fragment" = "$unit" ] && grep -qx '# Managed by Hoshi' "$unit" || { echo 'existing service is not managed by Hoshi'; exit 1; }
fi
if [ "$mode" = uninstall ]; then
 if [ -n "$fragment" ]; then
  systemctl stop hoshi-agent.service
  systemctl disable hoshi-agent.service
 fi
 rm -f /etc/systemd/system/hoshi-agent.service /usr/local/lib/hoshi-agent/hoshi-agent
 systemctl daemon-reload
 rm -f /var/lib/hoshi-agent/config.json /var/lib/hoshi-agent/config.json.buffer
 rmdir /var/lib/hoshi-agent /usr/local/lib/hoshi-agent 2>/dev/null || true
 echo 'agent files and service removed'
 exit 0
fi
case "$mode" in install|upgrade) ;; *) echo 'invalid installation mode'; exit 1 ;; esac
[ ! -L /var/lib/hoshi-agent ] && [ ! -L /usr/local/lib/hoshi-agent ] || { echo 'unsafe installation directory'; exit 1; }
if [ "$mode" = install ] && [ -e /var/lib/hoshi-agent/config.json ]; then
 echo 'existing agent configuration: use upgrade or uninstall before rebinding'
 exit 1
fi
binary="$source_dir/hoshi-agent-linux-$arch"
if [ ! -f "$binary" ]; then
 command -v curl >/dev/null
 curl --fail --silent --show-error --proto '=https' --tlsv1.2 '__ORIGIN__/api/agent/releases/hoshi-agent-linux-'"$arch" -o "$binary"
fi
actual=$(sha256sum "$binary")
actual=${actual%% *}
[ "$actual" = "$expected" ] || { echo 'agent checksum mismatch'; exit 1; }
if ! id hoshi-agent >/dev/null 2>&1; then
 useradd --system --user-group --home-dir /var/lib/hoshi-agent --shell /usr/sbin/nologin hoshi-agent
fi
[ "$(id -u hoshi-agent)" != 0 ] || { echo 'unsafe service user'; exit 1; }
install -d -m 0755 -o root -g root /usr/local/lib/hoshi-agent
install -d -m 0700 -o hoshi-agent -g hoshi-agent /var/lib/hoshi-agent
if [ "$mode" = install ]; then
 [ -f "$source_dir/config.json" ] || { echo 'put the downloaded private config.json beside this script'; exit 1; }
 install -m 0600 -o hoshi-agent -g hoshi-agent "$source_dir/config.json" /var/lib/hoshi-agent/config.json
fi
[ -f /var/lib/hoshi-agent/config.json ] || { echo 'agent config is missing'; exit 1; }
# Stop before swapping a binary; restart keeps its existing registration.
systemctl stop hoshi-agent.service 2>/dev/null || true
install -m 0755 -o root -g root "$binary" /usr/local/lib/hoshi-agent/hoshi-agent.new
mv /usr/local/lib/hoshi-agent/hoshi-agent.new /usr/local/lib/hoshi-agent/hoshi-agent
cat > /etc/systemd/system/hoshi-agent.service <<'UNIT'
# Managed by Hoshi
[Unit]
Description=Hoshi monitoring agent
Wants=network-online.target
After=network-online.target
[Service]
Type=simple
User=hoshi-agent
Group=hoshi-agent
WorkingDirectory=/var/lib/hoshi-agent
ExecStart=/usr/local/lib/hoshi-agent/hoshi-agent --config /var/lib/hoshi-agent/config.json
Restart=on-failure
RestartSec=10
UMask=0077
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/var/lib/hoshi-agent
CapabilityBoundingSet=CAP_NET_RAW
AmbientCapabilities=CAP_NET_RAW
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6 AF_NETLINK
LockPersonality=true
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now hoshi-agent.service
systemctl is-active --quiet hoshi-agent.service
echo 'service started; waiting for authenticated report'
