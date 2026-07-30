#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PUBLIC_DB="$ROOT_DIR/backend/public-data/kwhale-public.sqlite"
SOURCE_DB="$ROOT_DIR/backend/private-data/releases/latest/kwhale.sqlite"
VERCEL_ENVIRONMENTS="production,preview"

for command_name in sqlite3 turso npx git; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Missing required command: $command_name" >&2
    exit 1
  fi
done

cd "$ROOT_DIR"

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Refusing data release from a dirty worktree. Commit changes first." >&2
  exit 1
fi

git fetch origin main --quiet
if [[ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]]; then
  echo "Local HEAD must match origin/main before a production data release." >&2
  exit 1
fi

(
  cd backend
  npm run data:build-public
)

release_id="$(sqlite3 "$SOURCE_DB" 'SELECT id FROM dataset_release LIMIT 1;')"
if [[ -z "$release_id" ]]; then
  echo "Dataset release id is missing." >&2
  exit 1
fi

database_name="kwhale-public-${release_id:0:12}"

if ! turso db show "$database_name" >/dev/null 2>&1; then
  turso db create "$database_name" \
    --from-file "$PUBLIC_DB" \
    --group default \
    --wait
fi

database_url="$(turso db show "$database_name" --url)"
remote_counts="$(turso db shell "$database_name" \
  "SELECT (SELECT COUNT(*) FROM person) || '|' ||
          (SELECT COUNT(*) FROM disclosure) || '|' ||
          (SELECT COUNT(*) FROM asset) || '|' ||
          (SELECT COUNT(*) FROM asset WHERE raw_json <> '');" \
  | tail -n 1 | tr -d '[:space:]')"
local_counts="$(sqlite3 "$PUBLIC_DB" \
  "SELECT (SELECT COUNT(*) FROM person) || '|' ||
          (SELECT COUNT(*) FROM disclosure) || '|' ||
          (SELECT COUNT(*) FROM asset) || '|' ||
          (SELECT COUNT(*) FROM asset WHERE raw_json <> '');")"

if [[ "$remote_counts" != "$local_counts" || "$remote_counts" != *"|0" ]]; then
  echo "Remote projection verification failed." >&2
  echo "local=$local_counts remote=$remote_counts" >&2
  exit 1
fi

printf %s "$database_url" |
  npx vercel env add TURSO_DATABASE_URL \
    production,preview,development --force --no-sensitive --yes

turso db tokens create "$database_name" |
  npx vercel env add TURSO_AUTH_TOKEN \
    "$VERCEL_ENVIRONMENTS" --force --sensitive --yes

npx vercel --prod --yes
EXPECTED_COMMIT="$(git rev-parse HEAD)" bash scripts/warm_production.sh

echo "Production data release completed."
echo "database=$database_name"
echo "release=$release_id"
