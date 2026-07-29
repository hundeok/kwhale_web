#!/usr/bin/env python3
"""Download discovered Gazette disclosure PDFs with hashes and resume support."""

from __future__ import annotations

import argparse
import hashlib
import http.cookiejar
import json
import pathlib
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

ROOT = pathlib.Path(__file__).resolve().parents[1]
BASE = "https://www.gwanbo.go.kr"
LANDING = f"{BASE}/user/search/searchThema.do?tabType=1"
DOWNLOAD = f"{BASE}/user/common/ofcttCntntDownload.do"
USER_AGENT = "KWhaleDataPipeline/2.1 (+official-public-data-research)"


def content_id_of(raw: dict) -> str:
    path = str(raw.get("stored_file_default_path") or "").strip("/")
    if path:
        parts = path.split("/")
        if len(parts) >= 2:
            return parts[-2]
    query = urllib.parse.parse_qs(
        urllib.parse.urlparse(str(raw.get("stored_field_url") or "")).query
    )
    values = query.get("contentId") or []
    if not values:
        raise RuntimeError("전자관보 contentId가 없습니다.")
    return values[0]


class Downloader:
    def __init__(self):
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar())
        )
        self.open(LANDING)

    def open(self, url: str, data: dict | None = None, referer: str = LANDING):
        request = urllib.request.Request(
            url,
            data=urllib.parse.urlencode(data).encode() if data else None,
            headers={"User-Agent": USER_AGENT, "Referer": referer},
        )
        return self.opener.open(request, timeout=180)

    def download(self, record: dict) -> bytes:
        raw = record["raw"]
        content_id = content_id_of(raw)
        toc_id = raw["stored_toc_seq"]
        viewer = (
            f"{BASE}/ezpdf/customLayout.jsp?"
            + urllib.parse.urlencode(
                {"contentId": content_id, "tocId": toc_id, "isTocOrder": "N"}
            )
        )
        with self.open(viewer):
            pass
        with self.open(DOWNLOAD, {"cntnt_seq_no": toc_id}, referer=viewer) as response:
            data = response.read()
        if not data.startswith(b"%PDF-"):
            raise RuntimeError(f"PDF가 아닌 응답: {record['title']} ({len(data)} bytes)")
        return data


def write_atomic(path: pathlib.Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".part")
    temp.write_bytes(data)
    temp.replace(path)


def main() -> int:
    parser = argparse.ArgumentParser(description="전자관보 재산공개 PDF 원문 다운로드")
    parser.add_argument("--year", type=int, action="append", required=True)
    parser.add_argument(
        "--discovery-dir", type=pathlib.Path, default=ROOT / "data" / "discovery"
    )
    parser.add_argument("--raw-dir", type=pathlib.Path, default=ROOT / "data" / "raw")
    parser.add_argument("--delay", type=float, default=0.3)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    downloader = Downloader()
    summary = {}
    for year in sorted(set(args.year)):
        manifest = json.loads(
            (args.discovery_dir / f"gwanbo-{year}.json").read_text(encoding="utf-8")
        )
        documents = args.raw_dir / str(year) / "documents"
        metadata_dir = args.raw_dir / str(year) / "metadata"
        downloaded = skipped = failures = total_bytes = 0
        errors = []
        for record in manifest["records"]:
            toc_id = record["raw"]["stored_toc_seq"]
            metadata_path = metadata_dir / f"gwanbo-{toc_id}.json"
            if metadata_path.exists() and not args.force:
                metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
                local_path = ROOT / metadata["localPath"]
                if local_path.exists():
                    skipped += 1
                    total_bytes += int(metadata["byteSize"])
                    continue
            try:
                data = downloader.download(record)
                digest = hashlib.sha256(data).hexdigest()
                file_path = documents / f"{toc_id}-{digest[:12]}.pdf"
                write_atomic(file_path, data)
                metadata = {
                    **{key: value for key, value in record.items() if key != "raw"},
                    "gazetteContentId": content_id_of(record["raw"]),
                    "gazetteTocId": toc_id,
                    "sha256": digest,
                    "byteSize": len(data),
                    "localPath": str(file_path.resolve().relative_to(ROOT)),
                    "downloadedAt": datetime.now(timezone.utc).isoformat(),
                    "pipelineVersion": "2.1.0",
                }
                write_atomic(
                    metadata_path,
                    json.dumps(metadata, ensure_ascii=False, indent=2).encode(),
                )
                downloaded += 1
                total_bytes += len(data)
            except Exception as error:  # keep the batch resumable
                failures += 1
                errors.append({"id": record["id"], "title": record["title"], "error": str(error)})
            time.sleep(max(args.delay, 0.2))
        summary[str(year)] = {
            "records": len(manifest["records"]),
            "downloaded": downloaded,
            "skipped": skipped,
            "failures": failures,
            "bytes": total_bytes,
            "errors": errors,
        }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 1 if any(item["failures"] for item in summary.values()) else 0


if __name__ == "__main__":
    raise SystemExit(main())
