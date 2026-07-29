#!/usr/bin/env python3
"""Reproducible official-document downloader.

Discovery URLs must come from an official source manifest or a configured official
API response. The downloader never guesses document URLs. Every file is stored
under its disclosure year with a SHA-256 hash and immutable metadata.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import pathlib
import sqlite3
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone

ROOT = pathlib.Path(__file__).resolve().parents[1]
DEFAULT_RAW_DIR = ROOT / "data" / "raw"
USER_AGENT = "KWhaleDataPipeline/2.0 (+official-public-data-research)"
ALLOWED_HOSTS = {
    "gwanbo.go.kr", "www.gwanbo.go.kr", "open.gwanbo.go.kr",
    "peti.go.kr", "www.peti.go.kr"
}


def validate_official_url(url: str) -> None:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https" or parsed.hostname not in ALLOWED_HOSTS:
        raise ValueError(f"공식 허용 도메인이 아닌 URL입니다: {url}")


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def fetch(url: str, timeout: int = 90) -> tuple[bytes, str]:
    validate_official_url(url)
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        content_type = response.headers.get_content_type()
        return response.read(), content_type


def safe_filename(url: str, title: str, content_type: str) -> str:
    remote_name = pathlib.Path(urllib.parse.urlparse(url).path).name
    if remote_name and "." in remote_name:
        return remote_name
    extension = {
        "application/pdf": ".pdf",
        "application/zip": ".zip",
        "application/json": ".json",
        "text/html": ".html"
    }.get(content_type, ".bin")
    slug = "".join(char if char.isalnum() or char in "-_" else "_" for char in title)
    return f"{slug[:80]}{extension}"


def write_atomic(path: pathlib.Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".part")
    temporary.write_bytes(data)
    temporary.replace(path)


def download_document(document: dict, raw_dir: pathlib.Path, force: bool = False) -> dict:
    required = {"year", "publishedAt", "title", "sourceSite", "sourceUrl", "fileUrl"}
    missing = required.difference(document)
    if missing:
        raise ValueError(f"manifest 필드 누락: {sorted(missing)}")
    validate_official_url(document["sourceUrl"])
    validate_official_url(document["fileUrl"])

    year_dir = raw_dir / str(int(document["year"]))
    metadata_dir = year_dir / "metadata"
    data, content_type = fetch(document["fileUrl"])
    digest = sha256_bytes(data)
    file_name = safe_filename(document["fileUrl"], document["title"], content_type)
    destination = year_dir / "documents" / f"{digest[:12]}-{file_name}"
    if force or not destination.exists():
        write_atomic(destination, data)

    metadata = {
        **document,
        "contentType": content_type,
        "sha256": digest,
        "byteSize": len(data),
        "localPath": str(destination.relative_to(ROOT)),
        "downloadedAt": datetime.now(timezone.utc).isoformat(),
        "pipelineVersion": "2.0.0"
    }
    write_atomic(metadata_dir / f"{digest}.json", json.dumps(metadata, ensure_ascii=False, indent=2).encode())
    return metadata


def register_sqlite(db_path: pathlib.Path, records: list[dict]) -> None:
    connection = sqlite3.connect(db_path)
    try:
        connection.execute("PRAGMA foreign_keys=ON")
        for record in records:
            connection.execute(
                """
                INSERT OR IGNORE INTO Disclosure
                  (id, year, publishedAt, disclosureType, committee, title,
                   sourceUrl, sourceSite, documentHash, parserVersion,
                   ingestionStatus, ingestedAt, createdAt)
                VALUES
                  (lower(hex(randomblob(16))), ?, ?, ?, ?, ?, ?, ?, ?, ?,
                   'DOWNLOADED', ?, ?)
                """,
                (
                    record["year"], record["publishedAt"],
                    record.get("disclosureType", "UNKNOWN"), record.get("committee"),
                    record["title"], record["sourceUrl"], record["sourceSite"],
                    record["sha256"], record["pipelineVersion"],
                    record["downloadedAt"], record["downloadedAt"]
                )
            )
        connection.commit()
    finally:
        connection.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="공식 공직자 재산공개 원문 수집")
    parser.add_argument("--manifest", required=True, type=pathlib.Path)
    parser.add_argument("--year", type=int)
    parser.add_argument("--raw-dir", type=pathlib.Path, default=DEFAULT_RAW_DIR)
    parser.add_argument("--db", type=pathlib.Path)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    documents = manifest.get("documents", [])
    if args.year:
        documents = [item for item in documents if int(item["year"]) == args.year]
    if not documents:
        print("수집 대상 문서가 없습니다.", file=sys.stderr)
        return 2

    records = [download_document(item, args.raw_dir, args.force) for item in documents]
    if args.db:
        register_sqlite(args.db, records)
    print(json.dumps({"downloaded": len(records), "documents": records}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
