#!/usr/bin/env bash
set -euo pipefail

PIPELINE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LEGACY_SNAPSHOT="${KWHALE_LEGACY_SNAPSHOT:-$PIPELINE_DIR/../assets/kwhale_data.json}"

python3 "$PIPELINE_DIR/scripts/realsignal_acquire.py" \
  --legacy-snapshot "$LEGACY_SNAPSHOT" \
  "$@"

python3 "$PIPELINE_DIR/scripts/build_dataset.py"
python3 "$PIPELINE_DIR/scripts/dataset_audit.py"
node "$PIPELINE_DIR/scripts/semantic_quality_audit.js"
if [[ -n "${KWHALE_REALSIGNAL_RECENT:-}" ]]; then
  KWHALE_COMPARE_STRICT=1 node "$PIPELINE_DIR/scripts/compare_realsignal_recent.js" \
    "$KWHALE_REALSIGNAL_RECENT"
fi
python3 -m unittest discover -s "$PIPELINE_DIR/test" -p 'test_*.py'
