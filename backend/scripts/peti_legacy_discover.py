#!/usr/bin/env python3
"""Discover PETI's legacy disclosure list (2022-08 through 2023-12)."""

from __future__ import annotations

import argparse
import hashlib
import http.cookiejar
import json
import pathlib
import re
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

ROOT = pathlib.Path(__file__).resolve().parents[1]
BASE = "https://www.peti.go.kr"
PAGE = f"{BASE}/peOptpListOptp.do"
LIST_API = f"{BASE}/peoptp/getListPeOptp.do"
FILE_API = f"{BASE}/peoptp/selectListActnRstAtfl.do"
PREVIEW_API = f"{BASE}/kupload/raonkhandlerPreView.do"
USER_AGENT = "KWhaleDataPipeline/2.1 (+official-public-data-research)"


class Client:
    def __init__(self, delay: float):
        self.delay = max(delay, 0.2)
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar())
        )
        self.csrf = ""

    def post(self, url: str, data: dict | None = None) -> bytes:
        request = urllib.request.Request(
            url,
            data=urllib.parse.urlencode(data).encode() if data else None,
            headers={
                "User-Agent": USER_AGENT,
                "Referer": PAGE,
                "X-Requested-With": "XMLHttpRequest",
                "Accept": "application/json, text/javascript, */*; q=0.01",
            },
        )
        with self.opener.open(request, timeout=90) as response:
            return response.read()

    def initialize(self) -> None:
        html = self.post(PAGE).decode("utf-8", errors="replace")
        match = re.search(
            r'id=["\']csrfToken["\'][^>]*value=["\']([^"\']+)', html, re.I
        )
        if not match:
            raise RuntimeError("PETI 이전공개 페이지의 CSRF 토큰을 찾지 못했습니다.")
        self.csrf = match.group(1)

    def discover(self, year: int, page_size: int = 100) -> list[dict]:
        if not self.csrf:
            self.initialize()
        first, total = 1, None
        records: list[dict] = []
        while total is None or first <= total:
            payload = {
                "firstCount": first,
                "lastCount": first + page_size - 1,
                "fromOptpDt": f"{year}-01-01",
                "toOptpDt": f"{year}-12-31",
                "ornm": "",
                "csrfToken": self.csrf,
            }
            result = json.loads(self.post(LIST_API, payload))
            page = result.get("list") or []
            total = int(result.get("totalCount") or len(page))
            records.extend(page)
            if not page:
                break
            first += page_size
            time.sleep(self.delay)
        return records

    def attachments(self, registration_number: str) -> list[dict]:
        result = json.loads(
            self.post(
                FILE_API,
                {"rgsNo": registration_number, "csrfToken": self.csrf},
            )
        )
        time.sleep(self.delay)
        return result.get("result") or []


def record_id(year: int, item: dict) -> str:
    raw = f"{year}|{item.get('rgsNo')}|{item.get('optpDt')}|{item.get('optpTl')}"
    return hashlib.sha256(raw.encode()).hexdigest()


def write_atomic(path: pathlib.Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".part")
    temp.write_bytes(data)
    temp.replace(path)


def main() -> int:
    parser = argparse.ArgumentParser(description="PETI 이전공개 목록 자동 발견")
    parser.add_argument("--year", type=int, action="append", required=True)
    parser.add_argument(
        "--output-dir", type=pathlib.Path, default=ROOT / "data" / "discovery"
    )
    parser.add_argument("--delay", type=float, default=0.3)
    parser.add_argument("--skip-attachments", action="store_true")
    args = parser.parse_args()

    client = Client(args.delay)
    client.initialize()
    summary = {}
    for year in sorted(set(args.year)):
        items = client.discover(year)
        records = []
        attachment_count = 0
        for item in items:
            files = (
                []
                if args.skip_attachments or not item.get("flData")
                else client.attachments(str(item["rgsNo"]))
            )
            attachment_count += len(files)
            records.append(
                {
                    "id": record_id(year, item),
                    "year": year,
                    "publishedAt": item.get("optpDt"),
                    "committee": item.get("ornm"),
                    "title": item.get("optpTl"),
                    "registrationNumber": item.get("rgsNo"),
                    "sourceSite": "PETI_LEGACY",
                    "sourceUrl": PAGE,
                    "retrievalKind": "RAONK_PREVIEW_TOKEN",
                    "previewEndpoint": PREVIEW_API,
                    "attachments": files,
                    "raw": item,
                }
            )
        payload = {
            "schemaVersion": "2.1.0",
            "source": "PETI legacy disclosure list",
            "sourceUrl": PAGE,
            "officialCoverage": "2022-08 through 2023-12",
            "discoveredAt": datetime.now(timezone.utc).isoformat(),
            "year": year,
            "totalCount": len(records),
            "records": records,
        }
        path = args.output_dir / f"peti-legacy-{year}.json"
        write_atomic(path, json.dumps(payload, ensure_ascii=False, indent=2).encode())
        summary[str(year)] = {
            "records": len(records),
            "attachments": attachment_count,
            "path": str(path),
        }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
