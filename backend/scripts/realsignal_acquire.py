#!/usr/bin/env python3
"""Acquire and preserve public RealSignal dataset objects with full provenance.

Raw responses live below backend/private-data and are intentionally excluded
from Git and the web root. Every run writes an immutable acquisition manifest.
The script never overwrites a content-addressed object.
"""

from __future__ import annotations

import argparse
import datetime as dt
import gzip
import hashlib
import json
import os
import pathlib
import shutil
import sys
import tempfile
import urllib.error
import urllib.request
from typing import Any


SCRIPT_DIR = pathlib.Path(__file__).resolve().parent
BACKEND_DIR = SCRIPT_DIR.parent
DEFAULT_PRIVATE_DIR = BACKEND_DIR / "private-data"
DEFAULT_MANIFEST_URL = "https://cdn.real-signal.org/api/v1/manifest.json"
USER_AGENT = "KWhaleDataLineage/1.0 (+private archival and verification)"


def utc_now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def iso_z(value: dt.datetime) -> str:
    return value.astimezone(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(file_path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with file_path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def atomic_write(file_path: pathlib.Path, value: bytes) -> None:
    file_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=file_path.parent, delete=False) as temp:
        temp.write(value)
        temp.flush()
        os.fsync(temp.fileno())
        temp_path = pathlib.Path(temp.name)
    temp_path.replace(file_path)


def write_json(file_path: pathlib.Path, value: Any) -> None:
    atomic_write(
        file_path,
        (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8"),
    )


def fetch(url: str, timeout: int) -> tuple[bytes, dict[str, str], int]:
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/json",
            "Accept-Encoding": "gzip",
            "User-Agent": USER_AGENT,
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        body = response.read()
        headers = {key.lower(): value for key, value in response.headers.items()}
        return body, headers, response.status


def decode_response(body: bytes, headers: dict[str, str]) -> bytes:
    encoded = headers.get("content-encoding", "").lower() == "gzip"
    has_magic = body[:2] == b"\x1f\x8b"
    return gzip.decompress(body) if encoded or has_magic else body


def select_periods(manifest: dict[str, Any], requested: set[int] | None) -> list[dict[str, Any]]:
    periods = []
    for period in manifest.get("periods", []):
        try:
            year = int(period["id"])
        except (KeyError, TypeError, ValueError):
            continue
        if requested is None or year in requested:
            periods.append({**period, "year": year})
    periods.sort(key=lambda item: item["year"])
    return periods


def preserve_legacy_snapshot(source: pathlib.Path, private_dir: pathlib.Path) -> dict[str, Any]:
    if not source.is_file():
        raise FileNotFoundError(f"Legacy snapshot does not exist: {source}")
    digest = sha256_file(source)
    destination = private_dir / "snapshots" / "legacy" / digest / source.name
    destination.parent.mkdir(parents=True, exist_ok=True)
    if not destination.exists():
        with source.open("rb") as input_file, tempfile.NamedTemporaryFile(
            dir=destination.parent, delete=False
        ) as output_file:
            shutil.copyfileobj(input_file, output_file, 1024 * 1024)
            output_file.flush()
            os.fsync(output_file.fileno())
            temp_path = pathlib.Path(output_file.name)
        if sha256_file(temp_path) != digest:
            temp_path.unlink(missing_ok=True)
            raise RuntimeError("Legacy snapshot checksum changed while copying")
        temp_path.replace(destination)
    stat = destination.stat()
    return {
        "kind": "legacy-kwhale-snapshot",
        "sha256": digest,
        "bytes": stat.st_size,
        "sourcePath": str(source),
        "privatePath": str(destination.relative_to(private_dir)),
    }


def acquire(args: argparse.Namespace) -> dict[str, Any]:
    private_dir = args.private_dir.resolve()
    started_at = utc_now()

    manifest_body, manifest_headers, manifest_status = fetch(args.manifest_url, args.timeout)
    manifest_decoded = decode_response(manifest_body, manifest_headers)
    manifest = json.loads(manifest_decoded)
    periods = select_periods(manifest, set(args.year) if args.year else None)
    if not periods:
        raise RuntimeError("No matching yearly objects were found in the source manifest")

    source_manifest_sha = sha256_bytes(manifest_decoded)
    source_manifest_path = (
        private_dir / "sources" / "realsignal" / "manifests" / f"{source_manifest_sha}.json"
    )
    if not source_manifest_path.exists():
        atomic_write(source_manifest_path, manifest_decoded)

    artifacts = []
    for period in periods:
        object_key = period["objectKey"]
        object_url = f"https://cdn.real-signal.org/{object_key}"
        body, headers, status = fetch(object_url, args.timeout)
        decoded = decode_response(body, headers)
        payload = json.loads(decoded)
        if not isinstance(payload, list):
            raise RuntimeError(f"Expected a JSON array for {period['year']}: {object_url}")
        expected_count = period.get("count")
        if expected_count is not None and len(payload) != expected_count:
            raise RuntimeError(
                f"Count mismatch for {period['year']}: expected {expected_count}, got {len(payload)}"
            )
        expected_bytes = period.get("bytes")
        if expected_bytes is not None and len(decoded) != expected_bytes:
            raise RuntimeError(
                f"Decoded size mismatch for {period['year']}: "
                f"expected {expected_bytes}, got {len(decoded)}"
            )

        raw_sha = sha256_bytes(body)
        decoded_sha = sha256_bytes(decoded)
        object_root = private_dir / "sources" / "realsignal" / "objects"
        raw_path = object_root / "raw" / raw_sha
        decoded_path = object_root / "decoded" / decoded_sha
        if not raw_path.exists():
            atomic_write(raw_path, body)
        if not decoded_path.exists():
            atomic_write(decoded_path, decoded)

        artifacts.append(
            {
                "year": period["year"],
                "sourceUrl": object_url,
                "objectKey": object_key,
                "sourceManifestHash": period.get("hash"),
                "httpStatus": status,
                "responseHeaders": {
                    key: headers[key]
                    for key in (
                        "content-type",
                        "content-encoding",
                        "content-length",
                        "etag",
                        "last-modified",
                    )
                    if key in headers
                },
                "rawSha256": raw_sha,
                "rawBytes": len(body),
                "rawPath": str(raw_path.relative_to(private_dir)),
                "decodedSha256": decoded_sha,
                "decodedBytes": len(decoded),
                "decodedPath": str(decoded_path.relative_to(private_dir)),
                "recordCount": len(payload),
                "validation": {
                    "jsonArray": True,
                    "manifestCount": True,
                    "manifestDecodedBytes": True,
                },
            }
        )
        print(
            f"{period['year']}: {len(payload):,} records, "
            f"{len(body):,} raw bytes, sha256={decoded_sha[:12]}…"
        )

    run_id = started_at.strftime("%Y%m%dT%H%M%S.%fZ")
    result = {
        "schemaVersion": "1.0",
        "runId": run_id,
        "dataset": "realsignal-public-disclosures",
        "startedAt": iso_z(started_at),
        "completedAt": iso_z(utc_now()),
        "sourceManifest": {
            "url": args.manifest_url,
            "httpStatus": manifest_status,
            "sha256": source_manifest_sha,
            "generatedAt": manifest.get("generatedAt"),
            "latestDisclosureDate": manifest.get("latestDisclosureDate"),
            "privatePath": str(source_manifest_path.relative_to(private_dir)),
        },
        "artifacts": artifacts,
    }
    if args.legacy_snapshot:
        result["legacySnapshot"] = preserve_legacy_snapshot(
            args.legacy_snapshot.resolve(), private_dir
        )

    run_path = private_dir / "lineage" / "acquisitions" / f"{run_id}.json"
    write_json(run_path, result)
    write_json(private_dir / "lineage" / "latest-realsignal.json", result)
    print(f"Acquisition manifest: {run_path}")
    return result


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--year", type=int, action="append", help="Year to acquire; repeatable")
    parser.add_argument("--manifest-url", default=DEFAULT_MANIFEST_URL)
    parser.add_argument("--private-dir", type=pathlib.Path, default=DEFAULT_PRIVATE_DIR)
    parser.add_argument("--legacy-snapshot", type=pathlib.Path)
    parser.add_argument("--timeout", type=int, default=120)
    return parser.parse_args()


def main() -> int:
    try:
        acquire(parse_args())
        return 0
    except (OSError, ValueError, urllib.error.URLError, RuntimeError) as error:
        print(f"acquisition failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
