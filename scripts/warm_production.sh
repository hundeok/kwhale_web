#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${KWHALE_PRODUCTION_URL:-https://kwhaleweb.vercel.app}"
EXPECTED_COMMIT="${EXPECTED_COMMIT:-}"
MAX_ATTEMPTS="${MAX_ATTEMPTS:-30}"

for ((attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1)); do
  health="$(curl -fsS --max-time 30 "$BASE_URL/api/health" 2>/dev/null || true)"
  commit="$(printf %s "$health" | node -e '
    let input = "";
    process.stdin.on("data", (chunk) => input += chunk);
    process.stdin.on("end", () => {
      try { process.stdout.write(JSON.parse(input).data?.deploymentCommit || ""); }
      catch { process.stdout.write(""); }
    });
  ')"
  if [[ -n "$health" && ( -z "$EXPECTED_COMMIT" || "$commit" == "${EXPECTED_COMMIT:0:12}" ) ]]; then
    break
  fi
  if [[ "$attempt" -eq "$MAX_ATTEMPTS" ]]; then
    echo "Production deployment did not become ready for cache warming." >&2
    exit 1
  fi
  sleep 5
done

endpoints=(
  "/api/meta/years"
  "/api/meta/methodology"
  "/api/dashboard?year=recent"
  "/api/officials?year=recent&limit=30"
  "/api/rankings/yield?year=recent&limit=30"
  "/api/rankings/profit?year=recent&limit=30"
  "/api/map?year=recent&limit=75000"
  "/api/stats/stocks?year=recent&class=all"
  "/api/stats/crypto?year=recent"
  "/api/stats/crypto/people?year=recent&limit=100"
  "/api/analysis/new-assets?year=recent&limit=30"
  "/api/analysis/real-estate-regions?year=recent"
  "/api/analysis/real-estate-assets?year=recent&limit=50"
  "/api/alpha-engine?year=recent"
)

for endpoint in "${endpoints[@]}"; do
  curl -fsS --max-time 120 --retry 2 "$BASE_URL$endpoint" -o /dev/null
  echo "Warmed $endpoint"
done
