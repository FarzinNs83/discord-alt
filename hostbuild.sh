#!/usr/bin/env bash
# ============================================================
#  hostbuild.sh -- Patogh as one zip for a cPanel / DirectAdmin host
#                  ("Setup Node.js App", Linux x64), in dist-host/
#
#  Usage:
#    ./hostbuild.sh
#
#  Options: --help
# ============================================================
set -Eeuo pipefail

case "${1:-}" in
  "") ;;
  -h | --help)
    printf '%s\n' "hostbuild.sh -- build dist-host/patogh-host.zip for a shared Node.js host." \
      "Upload it, extract it in the app root and set the startup file to app.js." "" "Usage:" "  ./hostbuild.sh"
    exit 0
    ;;
  *)
    printf '[x] Unknown option: %s (try --help).\n' "$1" >&2
    exit 1
    ;;
esac

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_DIR="$REPO_ROOT/dist-host"
STAGE="$OUT_DIR/patogh"
ZIP="$OUT_DIR/patogh-host.zip"

cd "$REPO_ROOT"
echo "[+] Building the web frontend..."
npm run build -w @patogh/web

echo "[+] Staging $STAGE"
rm -rf "$OUT_DIR"
mkdir -p "$STAGE/packages/web" "$STAGE/data/uploads"
cp package.json package-lock.json tsconfig.base.json .env.example "$STAGE/"
cp -r packages/web/package.json packages/web/dist "$STAGE/packages/web/"
for pkg in shared server; do
  mkdir -p "$STAGE/packages/$pkg"
  tar -C "packages/$pkg" --exclude=node_modules --exclude=dist --exclude='*.test.ts' -cf - . | tar -C "$STAGE/packages/$pkg" -xf -
done

# Passenger loads this with require(): it runs the TypeScript server through tsx, as the Docker CMD does.
cat > "$STAGE/app.js" <<'EOF'
require('tsx/esm/api').register();
import('./packages/server/src/index.ts').catch((err) => {
  console.error(err);
  process.exit(1);
});
EOF

echo "[+] Installing Linux x64 production dependencies..."
cd "$STAGE"
# The flags pick the Linux binaries of sharp and esbuild even when this runs on Windows or macOS.
# --ignore-scripts for the same reason as the Dockerfile: better-sqlite3 ships its prebuilt binary.
npm ci --omit=dev --ignore-scripts -w @patogh/server --os=linux --cpu=x64 --libc=glibc
# Workspace links are junctions with absolute paths on Windows; a zip needs real files.
rm -rf node_modules/@patogh node_modules/.bin
mkdir -p node_modules/@patogh
cp -r packages/shared node_modules/@patogh/shared

for f in node_modules/better-sqlite3/prebuilds/linux-x64.node node_modules/@img/sharp-linux-x64 node_modules/@esbuild/linux-x64; do
  [ -e "$f" ] || { echo "[x] missing $f: the Linux dependencies did not install" >&2; exit 1; }
done

echo "[+] Zipping..."
cd "$OUT_DIR"
if command -v zip >/dev/null 2>&1; then
  (cd "$STAGE" && zip -qr "$ZIP" .)
else
  # Windows: its bsdtar writes zip files.
  (cd "$STAGE" && "$SYSTEMROOT/System32/tar.exe" -a -cf "$(cygpath -w "$ZIP")" .)
fi
echo "[+] Done: $ZIP ($(du -h "$ZIP" | cut -f1))"
