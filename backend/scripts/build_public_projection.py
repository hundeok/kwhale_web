#!/usr/bin/env python3
"""Build a sanitized, reproducible SQLite projection for the public API."""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path


TABLES = (
    "dataset_release",
    "source_artifact",
    "person",
    "disclosure",
    "asset",
    "dataset_metric",
)


def scalar(connection: sqlite3.Connection, sql: str):
    return connection.execute(sql).fetchone()[0]


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def snapshot(connection: sqlite3.Connection) -> dict:
    counts = {
        table: scalar(connection, f'SELECT COUNT(*) FROM "{table}"')
        for table in TABLES
    }
    totals = connection.execute(
        """
        SELECT COUNT(*), COALESCE(SUM(gross_assets), 0),
               COALESCE(SUM(liabilities), 0), COALESCE(SUM(net_worth), 0),
               COALESCE(SUM(asset_count), 0)
        FROM disclosure
        """
    ).fetchone()
    asset_totals = connection.execute(
        """
        SELECT COUNT(*), COALESCE(SUM(valuation), 0),
               COALESCE(SUM(CASE WHEN category = '채무' THEN valuation ELSE 0 END), 0),
               COALESCE(SUM(CASE WHEN category <> '채무' THEN valuation ELSE 0 END), 0)
        FROM asset
        """
    ).fetchone()
    return {
        "counts": counts,
        "disclosures": {
            "count": totals[0],
            "grossAssets": totals[1],
            "liabilities": totals[2],
            "netWorth": totals[3],
            "assetCount": totals[4],
        },
        "assets": {
            "count": asset_totals[0],
            "valuation": asset_totals[1],
            "liabilities": asset_totals[2],
            "grossAssets": asset_totals[3],
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--manifest", type=Path)
    args = parser.parse_args()

    source = args.source.resolve()
    output = args.output.resolve()
    manifest = (args.manifest or output.with_suffix(".manifest.json")).resolve()
    if not source.is_file():
        raise SystemExit(f"source database not found: {source}")
    if source == output:
        raise SystemExit("public projection must not overwrite the source database")

    output.parent.mkdir(parents=True, exist_ok=True)
    manifest.parent.mkdir(parents=True, exist_ok=True)
    output.unlink(missing_ok=True)

    source_db = sqlite3.connect(f"file:{source}?mode=ro", uri=True)
    source_db.execute("PRAGMA foreign_keys = ON")
    integrity = scalar(source_db, "PRAGMA integrity_check")
    if integrity != "ok":
        raise SystemExit(f"source integrity check failed: {integrity}")
    before = snapshot(source_db)

    public_db = sqlite3.connect(output)
    source_db.backup(public_db)
    source_db.close()

    public_db.execute("PRAGMA foreign_keys = ON")
    public_db.execute("BEGIN IMMEDIATE")
    # raw_json contains source payload fragments that the public API never reads.
    public_db.execute("UPDATE asset SET raw_json = '' WHERE raw_json <> ''")
    # Internal storage object keys are operational metadata, not public lineage.
    public_db.execute("UPDATE source_artifact SET source_object_key = NULL")
    public_db.commit()
    public_db.execute("VACUUM")
    public_db.execute("PRAGMA optimize")

    after = snapshot(public_db)
    if before != after:
        raise SystemExit(
            "projection reconciliation failed:\n"
            + json.dumps({"source": before, "public": after}, ensure_ascii=False, indent=2)
        )
    if scalar(public_db, "SELECT COUNT(*) FROM asset WHERE raw_json <> ''") != 0:
        raise SystemExit("raw_json sanitization failed")
    if scalar(
        public_db,
        "SELECT COUNT(*) FROM source_artifact WHERE source_object_key IS NOT NULL",
    ) != 0:
        raise SystemExit("source_object_key sanitization failed")
    if scalar(public_db, "PRAGMA integrity_check") != "ok":
        raise SystemExit("public projection integrity check failed")
    # Turso's file importer requires a SQLite database whose header is in WAL mode.
    journal_mode = scalar(public_db, "PRAGMA journal_mode = WAL")
    if str(journal_mode).lower() != "wal":
        raise SystemExit(f"failed to enable WAL mode: {journal_mode}")
    public_db.close()

    result = {
        "builtAt": datetime.now(timezone.utc).isoformat(),
        "sourceDatabase": str(source),
        "publicDatabase": str(output),
        "publicBytes": output.stat().st_size,
        "publicSha256": sha256(output),
        "journalMode": "wal",
        "sanitizedFields": ["asset.raw_json", "source_artifact.source_object_key"],
        "reconciliation": after,
    }
    manifest.write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
