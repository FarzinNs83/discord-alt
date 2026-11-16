#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")/.."
source ./patogh-setup.sh

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
ENV_FILE="$work/.env"
NGINX_CONF="$work/patogh.conf"
DS_STREAM_CONF="$work/relay.conf"
SNI_ROUTES_DIR="$work/routes"
SNI_MAP="$SNI_ROUTES_DIR/patogh.map"
TLS_DIR="$work/tls"
APP_PORT=3080
VOICE=1

parse_args --domain 192.0.2.42 --https-port 8443
load_settings
resolve_domain
mkdir -p "$TLS_DIR/$DOMAIN" "$SNI_ROUTES_DIR"
touch "$DS_STREAM_CONF" "$SNI_MAP"
MSYS2_ARG_CONV_EXCL='/CN=' openssl req -new -x509 -newkey rsa:2048 -nodes -days 2 -subj "/CN=$DOMAIN" \
  -addext "subjectAltName=IP:$DOMAIN" -keyout "$TLS_DIR/$DOMAIN/privkey.pem" \
  -out "$TLS_DIR/$DOMAIN/fullchain.pem" >/dev/null 2>&1
cert_valid
render_nginx https
grep -Eq '^    listen 8443 ssl[ ;]' "$NGINX_CONF"
if grep -Eq 'listen (\[::\]:)?(80|443)[ ;]' "$NGINX_CONF"; then
  printf 'Custom HTTPS configuration claimed a standard web port.\n' >&2
  exit 1
fi
[[ ! -e $SNI_MAP ]]
[[ $(public_host) == 192.0.2.42:8443 ]]
[[ $(firewall_ports) == $'8443/tcp\n3478/udp\n7881/tcp\n7882/udp' ]]
(
  port_in_use() { [[ $1 == 80 || $1 == 443 ]]; }
  precheck_ports
)
write_env
grep -Fxq 'LIVEKIT_URL=wss://192.0.2.42:8443/livekit' "$ENV_FILE"
HTTPS_PORT="" TLS_DIR="" DOMAIN=""
load_settings
resolve_domain
[[ $(public_host) == 192.0.2.42:8443 ]]
cert_valid

HTTPS_PORT=443 DOMAIN=chat.example.com
render_nginx https
grep -Fxq '    listen 80;' "$NGINX_CONF"
grep -Eq '^    listen 127\.0\.0\.1:10446 ssl[ ;]' "$NGINX_CONF"
grep -Fxq '"chat.example.com" 127.0.0.1:10446;' "$SNI_MAP"
rm "$DS_STREAM_CONF"
render_nginx https
grep -Eq '^    listen 443 ssl[ ;]' "$NGINX_CONF"
[[ $(public_host) == chat.example.com && ! -e $SNI_MAP ]]
printf 'Patogh web-port checks passed.\n'
