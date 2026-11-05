#!/usr/bin/env bash
# Deploy Sirko backend di VPS (pm2). Jalankan dari folder proyek:
#   bash scripts/update.sh            # tarik commit terbaru branch main lalu deploy
#   FORCE=1 bash scripts/update.sh    # deploy ulang walau tak ada commit baru
#
# Urutan: cek folder bersih → backup DB → git pull (ff-only) → npm ci (bila lock
# berubah) → migrasi → reload pm2 (stop→start bila ecosystem berubah) → health check.
# Gagal health check → cetak perintah rollback ke commit sebelumnya.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BRANCH="${BRANCH:-main}"
PM2_NAME="${PM2_NAME:-sirko-hono}"
KEEP_BACKUPS="${KEEP_BACKUPS:-15}"
cd "$APP_DIR"

export NVM_DIR="${NVM_DIR:-/root/.nvm}"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null

log() { printf '\n\033[1;34m▶ %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

env_get() { grep -E "^$1=" .env | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"; }

[ -f .env ] || die ".env tidak ditemukan di $APP_DIR"
PORT="$(env_get PORT)"; PORT="${PORT:-3000}"
DB_URL="$(env_get DATABASE_URL)"

log "Cek folder kerja"
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  git status --short --untracked-files=no
  die "Ada perubahan lokal pada file ter-track. Server = mirror: jangan edit di sini. Bereskan dulu."
fi

PREV="$(git rev-parse HEAD)"
git fetch --quiet origin "$BRANCH"
NEXT="$(git rev-parse "origin/$BRANCH")"
if [ "$PREV" = "$NEXT" ] && [ "${FORCE:-0}" != "1" ]; then
  echo "Sudah versi terbaru ($(git log -1 --format='%h %s')). FORCE=1 untuk deploy ulang."
  exit 0
fi
echo "Dari $(git log -1 --format='%h %s' "$PREV")"
echo "Ke   $(git log -1 --format='%h %s' "$NEXT")"

log "Backup database"
mkdir -p backups
STAMP="$(date +%Y%m%d-%H%M%S)"
DUMP="backups/db-$STAMP-pre-update-${PREV:0:7}.sql.gz"
pg_dump --clean --if-exists --no-owner --no-privileges "$DB_URL" | gzip > "$DUMP"
echo "→ $DUMP ($(du -h "$DUMP" | cut -f1))"
# Simpan N backup update terbaru saja.
ls -1t backups/db-*-pre-update-*.sql.gz 2>/dev/null | tail -n +"$((KEEP_BACKUPS + 1))" | xargs -r rm -f

log "Tarik kode ($BRANCH)"
git merge --ff-only --quiet "origin/$BRANCH" || die "Tidak bisa fast-forward (riwayat bercabang). Jangan commit di server."

changed() { [ "$PREV" != "$(git rev-parse HEAD)" ] && ! git diff --quiet "$PREV" HEAD -- "$@"; }

if [ ! -d node_modules ] || changed package-lock.json package.json; then
  log "Install dependensi (npm ci)"
  npm ci --no-audit --no-fund
else
  echo "Dependensi tak berubah — lewati npm ci."
fi

log "Migrasi database"
npm run --silent migrate

log "Restart aplikasi"
if changed ecosystem.config.cjs || ! pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
  # reload tak menerapkan perubahan ecosystem (interpreter/args/env) → stop→start.
  pm2 delete "$PM2_NAME" >/dev/null 2>&1 || true
  pm2 start ecosystem.config.cjs --only "$PM2_NAME"
else
  pm2 reload "$PM2_NAME"
fi
pm2 save >/dev/null

log "Health check"
for i in $(seq 1 20); do
  if curl -fsS -m 5 "http://127.0.0.1:$PORT/v1/health" 2>/dev/null | grep -q '"db":"ok"'; then
    echo "✓ Sehat: $(curl -fsS -m 5 "http://127.0.0.1:$PORT/v1/health")"
    echo "✓ Versi jalan: $(git log -1 --format='%h %s')"
    exit 0
  fi
  sleep 2
done

printf '\n\033[1;31m✗ Health check GAGAL.\033[0m Log: pm2 logs %s --lines 80 --nostream\n' "$PM2_NAME"
cat <<EOF
Rollback kode:
  cd $APP_DIR && git reset --hard $PREV && pm2 reload $PM2_NAME
Rollback database (hanya bila migrasi merusak data):
  gunzip -c $APP_DIR/$DUMP | psql "\$DATABASE_URL"
EOF
exit 1
