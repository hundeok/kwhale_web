#!/usr/bin/env python3
"""Audit the latest private dataset release and enforce publication gates."""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import pathlib
import sqlite3
import sys
from typing import Any


SCRIPT_DIR = pathlib.Path(__file__).resolve().parent
BACKEND_DIR = SCRIPT_DIR.parent
DEFAULT_PRIVATE_DIR = BACKEND_DIR / "private-data"


def load_json(path: pathlib.Path) -> dict[str, Any]:
    return json.loads(path.read_text("utf-8"))


def scalar(connection: sqlite3.Connection, sql: str) -> int:
    return int(connection.execute(sql).fetchone()[0])


def audit(private_dir: pathlib.Path) -> dict[str, Any]:
    pointer = load_json(private_dir / "releases" / "latest-release.json")
    database_path = private_dir / pointer["database"]
    release_manifest = load_json(private_dir / pointer["releaseManifest"])
    acquisition = load_json(private_dir / "lineage" / "latest-realsignal.json")
    database_sha = hashlib.sha256(database_path.read_bytes()).hexdigest()

    with sqlite3.connect(database_path) as connection:
        integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
        foreign_key_errors = connection.execute("PRAGMA foreign_key_check").fetchall()
        counts = {
            "persons": scalar(connection, "SELECT COUNT(*) FROM person"),
            "disclosures": scalar(connection, "SELECT COUNT(*) FROM disclosure"),
            "assets": scalar(connection, "SELECT COUNT(*) FROM asset"),
            "sourceArtifacts": scalar(connection, "SELECT COUNT(*) FROM source_artifact"),
        }
        year_rows = connection.execute(
            """
            SELECT period_year, COUNT(*), SUM(asset_count)
            FROM disclosure GROUP BY period_year ORDER BY period_year
            """
        ).fetchall()
        year_counts = {
            str(year): {"disclosures": disclosures, "assets": assets}
            for year, disclosures, assets in year_rows
        }
        connection.execute(
            """
            CREATE TEMP TABLE disclosure_asset_totals AS
            SELECT disclosure_id, COUNT(*) AS asset_rows,
                   SUM(CASE WHEN category <> '채무' THEN valuation ELSE 0 END) AS gross,
                   SUM(CASE WHEN category = '채무' THEN valuation ELSE 0 END) AS liabilities
            FROM asset GROUP BY disclosure_id
            """
        )
        issues = {
            "missingPersonNames": scalar(
                connection,
                "SELECT COUNT(*) FROM person WHERE TRIM(canonical_name) IN ('', '미상')",
            ),
            "missingOrganizations": scalar(
                connection,
                "SELECT COUNT(*) FROM person WHERE TRIM(latest_organization) IN ('', '미상')",
            ),
            "negativeValuations": scalar(
                connection, "SELECT COUNT(*) FROM asset WHERE valuation < 0"
            ),
            "invalidCoordinates": scalar(
                connection,
                """
                SELECT COUNT(*) FROM asset
                WHERE (latitude IS NOT NULL AND (latitude < -90 OR latitude > 90))
                   OR (longitude IS NOT NULL AND (longitude < -180 OR longitude > 180))
                """,
            ),
            "duplicateSourcePositions": scalar(
                connection,
                """
                SELECT COUNT(*) FROM (
                  SELECT source_artifact_id, source_record_index, COUNT(*) AS c
                  FROM disclosure
                  GROUP BY source_artifact_id, source_record_index HAVING c > 1
                )
                """,
            ),
            "orphanAssets": scalar(
                connection,
                """
                SELECT COUNT(*) FROM asset a
                LEFT JOIN disclosure d ON d.id = a.disclosure_id
                WHERE d.id IS NULL
                """,
            ),
            "sameYearIdentityCollisions": scalar(
                connection,
                """
                SELECT COUNT(*) FROM (
                  SELECT person_id, period_year, COUNT(*) AS c
                  FROM disclosure
                  GROUP BY person_id, period_year HAVING c > 1
                )
                """,
            ),
            "netWorthFormulaMismatches": scalar(
                connection,
                "SELECT COUNT(*) FROM disclosure WHERE net_worth <> gross_assets - liabilities",
            ),
            "assetCountMismatches": scalar(
                connection,
                """
                SELECT COUNT(*) FROM disclosure d
                JOIN disclosure_asset_totals a ON a.disclosure_id = d.id
                WHERE d.asset_count <> a.asset_rows
                """,
            ),
            "grossAssetSumMismatches": scalar(
                connection,
                """
                SELECT COUNT(*) FROM disclosure d
                JOIN disclosure_asset_totals a ON a.disclosure_id = d.id
                WHERE d.gross_assets <> a.gross
                """,
            ),
            "liabilitySumMismatches": scalar(
                connection,
                """
                SELECT COUNT(*) FROM disclosure d
                JOIN disclosure_asset_totals a ON a.disclosure_id = d.id
                WHERE d.liabilities <> a.liabilities
                """,
            ),
            "duplicateAssetRows": scalar(
                connection,
                """
                SELECT COUNT(*) FROM (
                  SELECT disclosure_id, category, COALESCE(subcategory, ''),
                         COALESCE(detail, ''), COALESCE(owner, ''), valuation, COUNT(*) AS c
                  FROM asset GROUP BY 1, 2, 3, 4, 5, 6 HAVING c > 1
                )
                """,
            ),
            "missingAssetDetails": scalar(
                connection,
                "SELECT COUNT(*) FROM asset WHERE TRIM(COALESCE(detail, '')) = ''",
            ),
        }
        identity_methods = {
            method: {"persons": count, "averageConfidence": round(confidence, 3)}
            for method, count, confidence in connection.execute(
                """
                SELECT identity_method, COUNT(*), AVG(identity_confidence)
                FROM person GROUP BY identity_method ORDER BY COUNT(*) DESC
                """
            )
        }

    expected_records = sum(item["recordCount"] for item in acquisition["artifacts"])
    expected_artifacts = len(acquisition["artifacts"])
    blocking_issue_keys = (
        "missingPersonNames",
        "negativeValuations",
        "invalidCoordinates",
        "duplicateSourcePositions",
        "orphanAssets",
        "sameYearIdentityCollisions",
        "netWorthFormulaMismatches",
        "assetCountMismatches",
        "grossAssetSumMismatches",
        "liabilitySumMismatches",
    )
    gates = {
        "databaseChecksumMatches": database_sha == pointer["databaseSha256"],
        "sqliteIntegrity": integrity == "ok",
        "foreignKeys": len(foreign_key_errors) == 0,
        "allSourceRecordsImported": counts["disclosures"] == expected_records,
        "allSourceArtifactsImported": counts["sourceArtifacts"] == expected_artifacts,
        "requiredYearsPresent": all(str(year) in year_counts for year in range(2022, 2027)),
        "noStructuralIssues": all(issues[key] == 0 for key in blocking_issue_keys),
    }
    report = {
        "schemaVersion": "1.0",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z"),
        "releaseId": pointer["releaseId"],
        "databaseSha256": database_sha,
        "counts": counts,
        "yearCounts": year_counts,
        "issues": issues,
        "warnings": {
            "missingOrganizations": issues["missingOrganizations"],
            "requiresOfficialSourceReview": True,
            "officialVerificationStatus": "PENDING_PER_RECORD",
            "duplicateAssetRows": issues["duplicateAssetRows"],
            "missingAssetDetails": issues["missingAssetDetails"],
        },
        "identityResolution": identity_methods,
        "gates": gates,
        "publishable": all(gates.values()),
        "legacySnapshot": acquisition.get("legacySnapshot"),
        "releaseMetrics": release_manifest["metrics"],
    }
    report_path = (
        private_dir
        / "releases"
        / pointer["releaseId"]
        / "audit.json"
    )
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", "utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return report


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--private-dir", type=pathlib.Path, default=DEFAULT_PRIVATE_DIR)
    return parser.parse_args()


if __name__ == "__main__":
    arguments = parse_args()
    result = audit(arguments.private_dir.resolve())
    sys.exit(0 if result["publishable"] else 2)
