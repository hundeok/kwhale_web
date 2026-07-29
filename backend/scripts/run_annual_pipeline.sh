#!/usr/bin/env bash
set -euo pipefail

PIPELINE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_YEAR="${1:-$(date +%Y)}"
MANIFEST_PATH="${KWH_MANIFEST_PATH:-$PIPELINE_DIR/config/disclosures.json}"

if [[ ! -f "$MANIFEST_PATH" ]]; then
  echo "공식 문서 manifest가 없습니다: $MANIFEST_PATH" >&2
  echo "config/disclosures.example.json을 복사하고 전자관보의 공식 문서 URL을 등록하세요." >&2
  exit 2
fi

python3 "$PIPELINE_DIR/scripts/official_ingest.py" \
  --manifest "$MANIFEST_PATH" \
  --year "$TARGET_YEAR" \
  --raw-dir "$PIPELINE_DIR/data/raw"

node "$PIPELINE_DIR/scripts/quality_report.js" \
  --db "$PIPELINE_DIR/prisma/kwhale_prod.db" \
  --output "$PIPELINE_DIR/data/quality/latest.json"

node "$PIPELINE_DIR/scripts/semantic_quality_audit.js"
if [[ -n "${KWHALE_REALSIGNAL_RECENT:-}" ]]; then
  KWHALE_COMPARE_STRICT=1 node "$PIPELINE_DIR/scripts/compare_realsignal_recent.js" \
    "$KWHALE_REALSIGNAL_RECENT"
fi
