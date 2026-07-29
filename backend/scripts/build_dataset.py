#!/usr/bin/env python3
"""Build an immutable, normalized SQLite release from an acquisition manifest."""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import pathlib
import sqlite3
import tempfile
import re
from collections import Counter
from typing import Any


SCRIPT_DIR = pathlib.Path(__file__).resolve().parent
BACKEND_DIR = SCRIPT_DIR.parent
DEFAULT_PRIVATE_DIR = BACKEND_DIR / "private-data"
SCHEMA_PATH = BACKEND_DIR / "schema" / "dataset-v1.sql"
DEBT_CATEGORY = "채무"
SCHEMA_VERSION = "1.1"


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def digest(namespace: str, value: str) -> str:
    return hashlib.sha256(f"{namespace}|{value}".encode()).hexdigest()


def clean(value: Any, fallback: str = "") -> str:
    if value is None:
        return fallback
    # SQLite stores NUL bytes, but several drivers truncate text at the first
    # NUL when reading. Preserve the untouched value in raw_json/source hashes
    # and use a whitespace-normalized representation for queryable columns.
    sanitized = re.sub(r"[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]+", " ", str(value))
    return re.sub(r"\s+", " ", sanitized).strip()


def integer(value: Any) -> int:
    if value in (None, ""):
        return 0
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return 0


def person_identity(record: dict[str, Any]) -> str:
    # Organization is included to prevent same-name collisions. Title is not,
    # because it changes over time for the same person.
    return "|".join((clean(record.get("name")), clean(record.get("org"))))


def organization_key(value: Any) -> str:
    organization = re.sub(r"[\s·ㆍ()㈜주식회사]+", "", clean(value))
    council_match = re.findall(
        r"([가-힣]+(?:시|군|구))(?:의회|의회사무국|의회사무과|의회사무처)",
        organization,
    )
    if council_match:
        return f"지방의회:{council_match[-1]}"
    replacements = {
        "산업통상부": "산업통상자원부",
        "힌국국제교류재단": "한국국제교류재단",
        "의회사무국": "의회",
        "의회사무과": "의회",
        "의회사무처": "의회",
    }
    for source, target in replacements.items():
        organization = organization.replace(source, target)
    return organization


def identity_asset_fingerprints(record: dict[str, Any]) -> set[str]:
    result = set()
    for asset in record.get("assets") or []:
        category = clean(asset.get("type"))
        # Generic financial rows change text every year and are weak identity evidence.
        if category not in {"토지", "건물", "동산", "회원권", "채권"}:
            continue
        fields = (
            clean(asset.get("owner")),
            category,
            clean(asset.get("subType")),
            clean(asset.get("detail")),
        )
        result.add(digest("identity-asset-v1", "|".join(fields)))
    return result


def resolve_identity_keys(artifact_payloads: list[tuple[dict[str, Any], list[dict[str, Any]]]]):
    entries = []
    by_name: dict[str, list[int]] = {}
    for artifact, records in artifact_payloads:
        for record_index, record in enumerate(records):
            entry_index = len(entries)
            entry = {
                "artifactSha": artifact["decodedSha256"],
                "recordIndex": record_index,
                "name": clean(record.get("name"), "미상"),
                "periodYear": int(artifact["year"]),
                "organizationKey": organization_key(record.get("org")),
                "assetKeys": identity_asset_fingerprints(record),
            }
            entries.append(entry)
            by_name.setdefault(entry["name"], []).append(entry_index)

    parent = list(range(len(entries)))
    methods: dict[int, set[str]] = {index: set() for index in range(len(entries))}
    years: dict[int, set[int]] = {
        index: {entry["periodYear"]} for index, entry in enumerate(entries)
    }

    def find(index: int) -> int:
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    def union(left: int, right: int, method: str) -> bool:
        left_root, right_root = find(left), find(right)
        if left_root == right_root:
            methods[left_root].add(method)
            return True
        if years[left_root] & years[right_root]:
            return False
        parent[right_root] = left_root
        methods[left_root].update(methods.pop(right_root, set()))
        methods[left_root].add(method)
        years[left_root].update(years.pop(right_root))
        return True

    for indexes in by_name.values():
        for position, left in enumerate(indexes):
            for right in indexes[position + 1 :]:
                left_entry, right_entry = entries[left], entries[right]
                same_org = (
                    left_entry["organizationKey"]
                    and left_entry["organizationKey"] == right_entry["organizationKey"]
                )
                intersection = left_entry["assetKeys"] & right_entry["assetKeys"]
                minimum_assets = min(len(left_entry["assetKeys"]), len(right_entry["assetKeys"]))
                strong_asset_continuity = (
                    len(intersection) >= 2
                    and minimum_assets > 0
                    and len(intersection) / minimum_assets >= 0.25
                )
                if same_org and left_entry["periodYear"] != right_entry["periodYear"]:
                    union(left, right, "NORMALIZED_NAME_ORGANIZATION")
                elif strong_asset_continuity:
                    union(left, right, "ASSET_CONTINUITY")

    cluster_members: dict[int, list[int]] = {}
    for index in range(len(entries)):
        cluster_members.setdefault(find(index), []).append(index)
    resolved = {}
    for root, members in cluster_members.items():
        member = entries[members[0]]
        cluster_signature = "|".join(
            sorted(
                f"{entries[index]['organizationKey']}|{entries[index]['artifactSha']}|"
                f"{entries[index]['recordIndex']}"
                for index in members
            )
        )
        identity_key = f"{member['name']}|{digest('identity-cluster-v1', cluster_signature)[:24]}"
        method_set = methods.get(find(root), set())
        if "ASSET_CONTINUITY" in method_set:
            method = "NAME_ORG_AND_ASSET_CONTINUITY"
            confidence = 0.98
        elif "NORMALIZED_NAME_ORGANIZATION" in method_set:
            method = "NORMALIZED_NAME_ORGANIZATION"
            confidence = 0.94
        else:
            method = "SINGLE_SOURCE_IDENTITY"
            confidence = 0.85
        for index in members:
            entry = entries[index]
            resolved[(entry["artifactSha"], entry["recordIndex"])] = (
                identity_key,
                method,
                confidence,
            )
    return resolved


def asset_fingerprint(asset: dict[str, Any]) -> str:
    fields = (
        clean(asset.get("owner")),
        clean(asset.get("type")),
        clean(asset.get("subType")),
        clean(asset.get("detail")),
        str(integer(asset.get("valuation"))),
    )
    return digest("asset-fingerprint-v1", "|".join(fields))


def load_latest_manifest(private_dir: pathlib.Path) -> dict[str, Any]:
    manifest_path = private_dir / "lineage" / "latest-realsignal.json"
    if not manifest_path.is_file():
        raise FileNotFoundError(
            f"Acquisition manifest not found: {manifest_path}. Run data:acquire-realsignal first."
        )
    return json.loads(manifest_path.read_text("utf-8"))


def create_database(target: pathlib.Path) -> sqlite3.Connection:
    connection = sqlite3.connect(target)
    connection.execute("PRAGMA journal_mode = OFF")
    connection.execute("PRAGMA synchronous = FULL")
    connection.executescript(SCHEMA_PATH.read_text("utf-8"))
    return connection


def build(private_dir: pathlib.Path) -> dict[str, Any]:
    acquisition = load_latest_manifest(private_dir)
    release_id = digest(
        "dataset-release-v1",
        f"{acquisition['runId']}|schema:{SCHEMA_VERSION}|identity:asset-continuity-v3",
    )[:24]
    release_dir = private_dir / "releases" / release_id
    final_db = release_dir / "kwhale.sqlite"
    if final_db.exists():
        raise FileExistsError(f"Immutable release already exists: {final_db}")
    release_dir.mkdir(parents=True, exist_ok=True)

    with tempfile.NamedTemporaryFile(dir=release_dir, suffix=".sqlite", delete=False) as temp:
        temp_path = pathlib.Path(temp.name)

    db = create_database(temp_path)
    category_counts: Counter[str] = Counter()
    year_counts: Counter[int] = Counter()
    person_rows: dict[str, dict[str, Any]] = {}
    disclosure_count = 0
    asset_count = 0

    years = [int(item["year"]) for item in acquisition["artifacts"]]
    artifact_payloads = []
    for artifact in acquisition["artifacts"]:
        decoded_path = private_dir / artifact["decodedPath"]
        artifact_payloads.append((artifact, json.loads(decoded_path.read_text("utf-8"))))
    resolved_identities = resolve_identity_keys(artifact_payloads)
    built_at = dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")
    try:
        db.execute(
            "INSERT INTO dataset_release VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                release_id,
                SCHEMA_VERSION,
                acquisition["runId"],
                built_at,
                min(years),
                max(years),
                "BUILDING",
            ),
        )

        for artifact, records in artifact_payloads:
            artifact_id = digest(
                "source-artifact-v1",
                f"{acquisition['runId']}|{artifact['decodedSha256']}",
            )[:32]
            db.execute(
                """
                INSERT INTO source_artifact
                (id, release_id, source_system, source_year, source_url,
                 source_object_key, collected_at, raw_sha256, decoded_sha256,
                 raw_bytes, decoded_bytes, record_count)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    artifact_id,
                    release_id,
                    "REALSIGNAL",
                    artifact["year"],
                    artifact["sourceUrl"],
                    artifact["objectKey"],
                    acquisition["completedAt"],
                    artifact["rawSha256"],
                    artifact["decodedSha256"],
                    artifact["rawBytes"],
                    artifact["decodedBytes"],
                    artifact["recordCount"],
                ),
            )
            for record_index, record in enumerate(records):
                identity_key, identity_method, identity_confidence = resolved_identities[
                    (artifact["decodedSha256"], record_index)
                ]
                person_id = digest("person-v1", identity_key)[:32]
                title = clean(record.get("title"), "미상")
                organization = clean(record.get("org"), "미상")
                year = int(artifact["year"])
                existing = person_rows.get(person_id)
                if existing is None:
                    person_rows[person_id] = {
                        "id": person_id,
                        "name": clean(record.get("name"), "미상"),
                        "organization": organization,
                        "title": title,
                        "identity_key": identity_key,
                        "identity_method": identity_method,
                        "identity_confidence": identity_confidence,
                        "first_year": year,
                        "last_year": year,
                    }
                    db.execute(
                        """
                        INSERT INTO person
                        (id, canonical_name, latest_organization, latest_title,
                         identity_key, identity_method, identity_confidence,
                         first_seen_year, last_seen_year)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            person_id,
                            clean(record.get("name"), "미상"),
                            organization,
                            title,
                            identity_key,
                            identity_method,
                            identity_confidence,
                            year,
                            year,
                        ),
                    )
                else:
                    existing["first_year"] = min(existing["first_year"], year)
                    if year >= existing["last_year"]:
                        existing["last_year"] = year
                        existing["organization"] = organization
                        existing["title"] = title

                source_record_hash = digest("source-record-v1", canonical_json(record))
                disclosure_id = digest(
                    "disclosure-v1",
                    f"{artifact_id}|{record_index}|{source_record_hash}",
                )[:32]
                assets = record.get("assets") or []
                gross_assets = 0
                liabilities = 0
                for asset in assets:
                    value = integer(asset.get("valuation"))
                    if clean(asset.get("type")) == DEBT_CATEGORY:
                        liabilities += value
                    else:
                        gross_assets += value

                db.execute(
                    """
                    INSERT INTO disclosure
                    (id, person_id, source_artifact_id, source_record_index,
                     source_record_hash, period_year, registered_at, disclosed_at,
                     name_at_disclosure, organization_at_disclosure,
                     title_at_disclosure, gross_assets, liabilities, net_worth,
                     asset_count)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        disclosure_id,
                        person_id,
                        artifact_id,
                        record_index,
                        source_record_hash,
                        year,
                        record.get("registeredDate"),
                        record.get("disclosureDate"),
                        clean(record.get("name"), "미상"),
                        organization,
                        title,
                        gross_assets,
                        liabilities,
                        gross_assets - liabilities,
                        len(assets),
                    ),
                )
                disclosure_count += 1
                year_counts[year] += 1

                asset_rows = []
                for asset_index, asset in enumerate(assets):
                    category = clean(asset.get("type"), "기타")
                    category_counts[category] += 1
                    fingerprint = asset_fingerprint(asset)
                    asset_id = digest(
                        "asset-v1",
                        f"{disclosure_id}|{asset_index}|{fingerprint}",
                    )[:32]
                    asset_rows.append(
                        (
                            asset_id,
                            disclosure_id,
                            asset_index,
                            clean(asset.get("owner")) or None,
                            category,
                            clean(asset.get("subType")) or None,
                            clean(asset.get("detail")),
                            integer(asset.get("valuation")),
                            integer(asset.get("difference"))
                            if asset.get("difference") is not None
                            else None,
                            clean(asset.get("address")) or None,
                            asset.get("latitude"),
                            asset.get("longitude"),
                            canonical_json(asset),
                            fingerprint,
                        )
                    )
                db.executemany(
                    """
                    INSERT INTO asset
                    (id, disclosure_id, source_asset_index, owner, category,
                     subcategory, detail, valuation, difference, address,
                     latitude, longitude, raw_json, asset_fingerprint)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    asset_rows,
                )
                asset_count += len(asset_rows)

        db.executemany(
            """
            UPDATE person
            SET canonical_name = ?, latest_organization = ?, latest_title = ?,
                identity_key = ?, identity_method = ?, identity_confidence = ?,
                first_seen_year = ?, last_seen_year = ?
            WHERE id = ?
            """,
            [
                (
                    row["name"],
                    row["organization"],
                    row["title"],
                    row["identity_key"],
                    row["identity_method"],
                    row["identity_confidence"],
                    row["first_year"],
                    row["last_year"],
                    row["id"],
                )
                for row in person_rows.values()
            ],
        )
        metrics = {
            "persons": len(person_rows),
            "disclosures": disclosure_count,
            "assets": asset_count,
            "yearCounts": dict(sorted(year_counts.items())),
            "categoryCounts": dict(category_counts.most_common()),
        }
        db.executemany(
            "INSERT INTO dataset_metric VALUES (?, ?, ?)",
            [
                (release_id, key, canonical_json(value))
                for key, value in metrics.items()
            ],
        )
        db.execute(
            "UPDATE dataset_release SET status = 'VALIDATED' WHERE id = ?",
            (release_id,),
        )
        db.commit()
        integrity = db.execute("PRAGMA integrity_check").fetchone()[0]
        foreign_keys = db.execute("PRAGMA foreign_key_check").fetchall()
        if integrity != "ok" or foreign_keys:
            raise RuntimeError(
                f"Database validation failed: integrity={integrity}, foreignKeys={foreign_keys[:3]}"
            )
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

    temp_path.replace(final_db)
    db_sha256 = hashlib.sha256(final_db.read_bytes()).hexdigest()
    summary = {
        "schemaVersion": SCHEMA_VERSION,
        "releaseId": release_id,
        "builtAt": built_at,
        "sourceRunId": acquisition["runId"],
        "database": {
            "privatePath": str(final_db.relative_to(private_dir)),
            "sha256": db_sha256,
            "bytes": final_db.stat().st_size,
        },
        "metrics": metrics,
        "validation": {"sqliteIntegrity": "ok", "foreignKeys": "ok"},
    }
    summary_path = release_dir / "release.json"
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", "utf-8")

    latest_pointer = {
        "releaseId": release_id,
        "releaseManifest": str(summary_path.relative_to(private_dir)),
        "database": str(final_db.relative_to(private_dir)),
        "databaseSha256": db_sha256,
    }
    (private_dir / "releases" / "latest-release.json").write_text(
        json.dumps(latest_pointer, ensure_ascii=False, indent=2) + "\n",
        "utf-8",
    )
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return summary


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--private-dir", type=pathlib.Path, default=DEFAULT_PRIVATE_DIR)
    return parser.parse_args()


if __name__ == "__main__":
    arguments = parse_args()
    build(arguments.private_dir.resolve())
