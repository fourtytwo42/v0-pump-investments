#!/usr/bin/env bash
set -Eeuo pipefail

CONTROL_REPO="${PUMP_CONTROL_REPO:-/home/hendo420/pumpInvestments/v0-pump-investments}"
RELEASE_ROOT="/home/hendo420/pumpInvestments/releases"
CURRENT_LINK="/home/hendo420/pumpInvestments/current"
SHARED_ROOT="/var/lib/pump-investments"
TARGET_REF="${1:-origin/main}"
CSP_SOAK_SECONDS="${CSP_SOAK_SECONDS:-300}"
CANDIDATE_PORT=3002
CUTOVER_COMPLETE=0
PREVIOUS_RELEASE="$CONTROL_REPO"
CANDIDATE_PID=""
SUDO_KEEPALIVE_PID=""

say() { printf '\n[v409-release] %s\n' "$*"; }
die() { printf '\n[v409-release] ERROR: %s\n' "$*" >&2; exit 1; }

cleanup_candidate() {
  if [[ -n "$CANDIDATE_PID" ]] && kill -0 "$CANDIDATE_PID" 2>/dev/null; then
    kill "$CANDIDATE_PID" 2>/dev/null || true
    wait "$CANDIDATE_PID" 2>/dev/null || true
  fi
}

cleanup_sudo_keepalive() {
  if [[ -n "$SUDO_KEEPALIVE_PID" ]]; then
    kill "$SUDO_KEEPALIVE_PID" 2>/dev/null || true
    wait "$SUDO_KEEPALIVE_PID" 2>/dev/null || true
  fi
}

restart_release() {
  local release_dir="$1"
  pm2 delete pump-investments-web pump-investments-ingest >/dev/null 2>&1 || true
  PUMP_LOG_DIR="$SHARED_ROOT/logs" pm2 start "$release_dir/ecosystem.config.cjs"
}

rollback() {
  local exit_code=$?
  cleanup_candidate
  cleanup_sudo_keepalive
  if [[ $exit_code -ne 0 && $CUTOVER_COMPLETE -eq 1 && -n "$PREVIOUS_RELEASE" && -d "$PREVIOUS_RELEASE" ]]; then
    say "Post-cutover verification failed; restoring $PREVIOUS_RELEASE"
    ln -sfn "$PREVIOUS_RELEASE" "${CURRENT_LINK}.rollback"
    mv -Tf "${CURRENT_LINK}.rollback" "$CURRENT_LINK"
    PUMP_LOG_DIR="$SHARED_ROOT/logs" APP_VERSION="$(node -p "require('$PREVIOUS_RELEASE/package.json').version")" \
      restart_release "$PREVIOUS_RELEASE" || true
    sudo cp "$PREVIOUS_RELEASE/deploy/nginx/security-enforced.conf" /etc/nginx/snippets/pump-investments-security.conf || true
    sudo nginx -t && sudo systemctl reload nginx || true
  fi
  exit "$exit_code"
}
trap rollback EXIT

[[ -d "$CONTROL_REPO/.git" ]] || die "Control repository not found: $CONTROL_REPO"
sudo -v
(while sleep 60; do sudo -n true || exit; done) &
SUDO_KEEPALIVE_PID=$!
git -C "$CONTROL_REPO" fetch --prune origin main
COMMIT="$(git -C "$CONTROL_REPO" rev-parse "$TARGET_REF^{commit}")"
RELEASE_DIR="$RELEASE_ROOT/$COMMIT"
[[ "$RELEASE_DIR" == "$RELEASE_ROOT/"* ]] || die "Resolved release path escaped release root"

mkdir -p "$RELEASE_ROOT" "$SHARED_ROOT/logs" "$SHARED_ROOT/spool/pending" \
  "$SHARED_ROOT/spool/dead-letter" "$SHARED_ROOT/images"
sudo install -d -o hendo420 -g hendo420 -m 750 "$SHARED_ROOT/support-attachments"
if [[ ! -f "$SHARED_ROOT/app.env" ]]; then
  [[ -f "$CONTROL_REPO/.env" ]] || die "No source .env exists for first immutable release"
  install -m 600 "$CONTROL_REPO/.env" "$SHARED_ROOT/app.env"
fi

upsert_env() {
  local key="$1" value="$2" file="$SHARED_ROOT/app.env"
  if grep -q "^${key}=" "$file"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >> "$file"
  fi
}
upsert_env INGEST_SPOOL_DIR "$SHARED_ROOT/spool"
upsert_env TOKEN_IMAGE_CACHE_DIR "$SHARED_ROOT/images"
upsert_env SUPPORT_ATTACHMENT_DIR "$SHARED_ROOT/support-attachments"
if ! grep -q '^SUPPORT_ADMIN_TOKEN=.' "$SHARED_ROOT/app.env"; then
  upsert_env SUPPORT_ADMIN_TOKEN "$(openssl rand -hex 32)"
fi
if ! grep -q '^SUPPORT_NETWORK_HASH_KEY=.' "$SHARED_ROOT/app.env"; then
  upsert_env SUPPORT_NETWORK_HASH_KEY "$(openssl rand -hex 32)"
fi
upsert_env DATABASE_WEB_STATEMENT_TIMEOUT_MS "5000"
upsert_env TOKEN_REVISION_COALESCING_ENABLED "true"
upsert_env TOKEN_QUERY_CACHE_ENABLED "true"
upsert_env TOKEN_BUYER_AGGREGATES_ENABLED "true"
upsert_env TOKEN_SHARED_ALERT_STREAM_ENABLED "true"

if [[ ! -d "$RELEASE_DIR" ]]; then
  say "Creating immutable release $COMMIT"
  mkdir "$RELEASE_DIR"
  git -C "$CONTROL_REPO" archive "$COMMIT" | tar -x -C "$RELEASE_DIR"
fi
ln -sfn "$SHARED_ROOT/app.env" "$RELEASE_DIR/.env"

cd "$RELEASE_DIR"
VERSION="$(node -p "require('./package.json').version")"
say "Validating v$VERSION at $COMMIT"
npm ci
npm run prisma:generate
npm test
RUN_POSTGRES_INTEGRATION_TESTS=true npm run test:integration
npm run typecheck
npm run lint
npm run build
npx prisma validate
npm audit --omit=dev --audit-level=high
npm run db:migrate
RUN_POSTGRES_INTEGRATION_TESTS=true npm run test:support-integration
npx playwright install --with-deps chromium firefox webkit

say "Starting candidate on port $CANDIDATE_PORT"
# The candidate is reachable only on loopback and has no Nginx trusted-LAN
# marker. Allow a loopback-hostname bypass only in this isolated browser-test
# process; the public cutover never receives this flag.
PORT="$CANDIDATE_PORT" APP_VERSION="$VERSION" SUPPORT_TURNSTILE_LOOPBACK_TEST_BYPASS="1" npm start > "$SHARED_ROOT/logs/candidate-$COMMIT.log" 2>&1 &
CANDIDATE_PID=$!
for _ in {1..60}; do
  curl -fsS "http://127.0.0.1:$CANDIDATE_PORT/api/health" >/dev/null && break
  sleep 1
done
curl -fsS "http://127.0.0.1:$CANDIDATE_PORT/api/health" >/dev/null || die "Candidate health check failed"
PLAYWRIGHT_BASE_URL="http://127.0.0.1:$CANDIDATE_PORT" npm run test:browser
cleanup_candidate
CANDIDATE_PID=""

say "Installing validated host configuration"
sudo install -d -m 755 /etc/nginx/snippets
sudo install -m 644 deploy/nginx/security-report-only.conf /etc/nginx/snippets/pump-investments-security.conf
sudo install -m 644 deploy/nginx/pump-investments.conf /etc/nginx/conf.d/pump-investments.conf
sudo install -m 644 deploy/logrotate/pump-investments /etc/logrotate.d/pump-investments
sudo install -m 644 deploy/cron/pump-investments-support /etc/cron.d/pump-investments-support
sudo nginx -t

if [[ -L "$CURRENT_LINK" ]]; then PREVIOUS_RELEASE="$(readlink -f "$CURRENT_LINK")"; fi
ln -sfn "$RELEASE_DIR" "${CURRENT_LINK}.next"
mv -Tf "${CURRENT_LINK}.next" "$CURRENT_LINK"
restart_release "$CURRENT_LINK"
pm2 save
sudo systemctl reload nginx
CUTOVER_COMPLETE=1

say "Verifying cutover"
for _ in {1..90}; do
  curl -fsS http://127.0.0.1:3000/api/health >/dev/null && break
  sleep 1
done
curl -fsS http://127.0.0.1:3000/api/health | tee "$SHARED_ROOT/logs/release-health-$COMMIT.json"
curl -fsS https://pump.investments/api/health >/dev/null
curl -fsSI https://pump.investments/ | grep -qi '^content-security-policy-report-only:' || die "Report-only CSP header missing"
curl -fsSI https://pump.investments/ | grep -qi '^strict-transport-security: max-age=31536000' || die "HSTS header missing or incorrect"
timeout 20 curl -fsSN -X POST http://127.0.0.1:3000/api/tokens/stream \
  -H 'content-type: application/json' --data '{"page":1,"pageSize":12,"timeRangeMinutes":10}' \
  > "$SHARED_ROOT/logs/release-sse-$COMMIT.txt" || true
grep -q '^event: snapshot$' "$SHARED_ROOT/logs/release-sse-$COMMIT.txt" || die "SSE snapshot verification failed"

CSP_LOG="$SHARED_ROOT/logs/web-error.log"
CSP_BEFORE="$(grep -c '\[csp-report\]' "$CSP_LOG" 2>/dev/null || true)"
say "CSP report-only soak for ${CSP_SOAK_SECONDS}s"
PLAYWRIGHT_BASE_URL="https://pump.investments" npm run test:browser
sleep "$CSP_SOAK_SECONDS"
CSP_AFTER="$(grep -c '\[csp-report\]' "$CSP_LOG" 2>/dev/null || true)"
[[ "$CSP_AFTER" == "$CSP_BEFORE" ]] || die "CSP violations were reported; policy remains report-only"
sudo install -m 644 deploy/nginx/security-enforced.conf /etc/nginx/snippets/pump-investments-security.conf
sudo nginx -t
sudo systemctl reload nginx
curl -fsSI https://pump.investments/ | grep -qi '^content-security-policy:' || die "Enforced CSP header missing"

say "Retaining the three newest immutable releases"
mapfile -t RELEASES < <(find "$RELEASE_ROOT" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -rn | cut -d' ' -f2-)
if (( ${#RELEASES[@]} > 3 )); then
  for old in "${RELEASES[@]:3}"; do
    resolved="$(readlink -f "$old")"
    [[ "$resolved" == "$RELEASE_ROOT/"* && "$resolved" != "$RELEASE_ROOT" ]] || die "Unsafe stale release path: $resolved"
    [[ "$resolved" != "$RELEASE_DIR" && "$resolved" != "$PREVIOUS_RELEASE" ]] || continue
    rm -rf -- "$resolved"
  done
fi

pm2 status
say "Release v$VERSION ($COMMIT) is live on LAN and pump.investments"
cleanup_sudo_keepalive
trap - EXIT
