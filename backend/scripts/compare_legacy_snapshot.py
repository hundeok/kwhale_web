#!/usr/bin/env python3
"""Compare the saved 2025-era export with the current immutable release."""

from __future__ import annotations

import hashlib
import json
import sqlite3
import re
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
PRIVATE = BACKEND / "private-data"


def canonical_hash(value: object) -> str:
    payload = json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode()
    return hashlib.sha256(payload).hexdigest()


def text_key(value: object) -> str:
    return re.sub(r"\s+", "", str(value or ""))


def date_key(value: object) -> str:
    raw = str(value or "")
    if not raw:
        return ""
    parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    if raw.endswith("Z"):
        parsed += timedelta(hours=9)
    return parsed.date().isoformat()


def main() -> None:
    pointer = json.loads((PRIVATE / "releases/latest-release.json").read_text())
    audit = json.loads(
        (
            PRIVATE
            / "releases"
            / pointer["releaseId"]
            / "audit.json"
        ).read_text(encoding="utf-8")
    )
    legacy_info = audit["legacySnapshot"]
    legacy = json.loads(
        (PRIVATE / legacy_info["privatePath"]).read_text(encoding="utf-8")
    )
    yearly = legacy.get("yearlyData", {})

    legacy_hashes: set[str] = set()
    legacy_keys: Counter[tuple[str, str, str, str]] = Counter()
    legacy_years: Counter[str] = Counter()
    legacy_assets: Counter[str] = Counter()
    for year, records in yearly.items():
        legacy_years[str(year)] += len(records)
        for record in records:
            legacy_hashes.add(canonical_hash(record))
            legacy_keys[
                (
                    text_key(record.get("name")),
                    text_key(record.get("org")),
                    date_key(record.get("registeredDate")),
                    date_key(record.get("disclosureDate")),
                )
            ] += 1
            legacy_assets[str(year)] += len(record.get("assets") or [])

    connection = sqlite3.connect(PRIVATE / pointer["database"])
    current_hashes = {
        row[0] for row in connection.execute("SELECT source_record_hash FROM disclosure")
    }
    current_keys = Counter(
        (
            text_key(name),
            text_key(org),
            date_key(registered),
            date_key(disclosed),
        )
        for name, org, registered, disclosed in connection.execute(
            """
            SELECT name_at_disclosure, organization_at_disclosure,
                   registered_at, disclosed_at
            FROM disclosure
            """
        )
    )
    identity_date_matches = sum(
        min(count, current_keys.get(key, 0)) for key, count in legacy_keys.items()
    )
    current_years = {
        str(year): count
        for year, count in connection.execute(
            "SELECT period_year, COUNT(*) FROM disclosure GROUP BY period_year"
        )
    }
    current_assets = {
        str(year): count
        for year, count in connection.execute(
            """
            SELECT d.period_year, COUNT(*)
            FROM asset a JOIN disclosure d ON d.id = a.disclosure_id
            GROUP BY d.period_year
            """
        )
    }

    report = {
        "schemaVersion": "1.0",
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "legacy": {
            "sha256": legacy_info["sha256"],
            "exportedAt": legacy.get("metadata", {}).get("exportDate"),
            "recordsByYear": dict(sorted(legacy_years.items())),
            "assetsByYear": dict(sorted(legacy_assets.items())),
            "records": sum(legacy_years.values()),
            "assets": sum(legacy_assets.values()),
        },
        "current": {
            "releaseId": pointer["releaseId"],
            "databaseSha256": pointer["databaseSha256"],
            "recordsByYear": current_years,
            "assetsByYear": current_assets,
            "records": sum(current_years.values()),
            "assets": sum(current_assets.values()),
        },
        "lineage": {
            "exactLegacyRecordsRetained": len(legacy_hashes & current_hashes),
            "legacyRecordsMissingByExactHash": len(legacy_hashes - current_hashes),
            "currentRecordsAddedBeyondLegacy": len(current_hashes - legacy_hashes),
            "identityDateMatches": identity_date_matches,
            "identityDateMatchRate": round(
                identity_date_matches / max(sum(legacy_years.values()), 1), 6
            ),
            "note": (
                "Exact hashes compare differently shaped exports. "
                "Identity/date matching is the migration continuity indicator."
            ),
        },
    }
    destination = PRIVATE / "lineage/legacy-comparison.json"
    destination.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
