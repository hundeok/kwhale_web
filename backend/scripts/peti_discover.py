#!/usr/bin/env python3
"""Discover PETI disclosure records by year without guessing file URLs.

PETI exposes its integrated search through a CSRF-protected POST endpoint.
Annual Government Ethics Committee records carry a RAONK file token; other
records are rendered on demand from their registration management number.
Both kinds are preserved so a later browser/download worker can retrieve the
official document while retaining a reproducible discovery trail.
"""

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
BASE_URL = "https://www.peti.go.kr"
SEARCH_PAGE = f"{BASE_URL}/peOptpListVie.do"
SEARCH_API = f"{BASE_URL}/peoptp/getListOptpListVie.do"
DETAIL_PAGE = f"{BASE_URL}/peoptp/openPeOptpListVieDtlPop.do"
PDF_API = f"{BASE_URL}/peoptp/getOptpCatlPdf.do"
USER_AGENT = "KWhaleDataPipeline/2.1 (+official-public-data-research)"


class PetiClient:
    def __init__(self, delay: float = 0.5):
        self.delay = delay
        jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(jar)
        )
        self.csrf_token = ""

    def request(self, url: str, data: dict | None = None) -> bytes:
        encoded = urllib.parse.urlencode(data).encode() if data else None
        request = urllib.request.Request(
            url,
            data=encoded,
            headers={
                "User-Agent": USER_AGENT,
                "Referer": SEARCH_PAGE,
                "Accept": "application/json, text/javascript, */*; q=0.01",
                "X-Requested-With": "XMLHttpRequest",
            },
        )
        with self.opener.open(request, timeout=90) as response:
            return response.read()

    def initialize(self) -> None:
        html = self.request(SEARCH_PAGE).decode("utf-8", errors="replace")
        patterns = (
            r'id=["\']csrfToken["\'][^>]*value=["\']([^"\']+)',
            r'name=["\']csrfToken["\'][^>]*value=["\']([^"\']+)',
        )
        for pattern in patterns:
            match = re.search(pattern, html, re.IGNORECASE)
            if match:
                self.csrf_token = match.group(1)
                return
        raise RuntimeError("PETI 검색 페이지에서 CSRF 토큰을 찾지 못했습니다.")

    def search_year(self, year: int, page_size: int = 100) -> list[dict]:
        if not self.csrf_token:
            self.initialize()
        records: list[dict] = []
        first = 1
        total = None
        while total is None or first <= total:
            payload = {
                "fromOptpDt": f"{year}0101",
                "toOptpDt": f"{year}1231",
                "firstCount": first,
                "lastCount": first + page_size - 1,
                "orSeCd": "",
                "cmmtOrnm": "",
                "csrfToken": self.csrf_token,
            }
            response = json.loads(self.request(SEARCH_API, payload))
            page = response.get("result") or []
            total = int(response.get("totalCount") or len(page))
            records.extend(page)
            if not page:
                break
            first += page_size
            time.sleep(self.delay)
        return records


def stable_id(year: int, record: dict) -> str:
    identity = "|".join(
        str(record.get(key) or "")
        for key in ("rgsMno", "optpDt", "cmmtOrnm", "optpShpNm", "optpFlnm")
    )
    return hashlib.sha256(f"{year}|{identity}".encode()).hexdigest()


def normalize_record(year: int, record: dict) -> dict:
    published = str(record.get("optpDt") or "")
    direct_file = bool(record.get("optpFlnm"))
    normalized = {
        "id": stable_id(year, record),
        "year": year,
        "publishedAt": published,
        "committee": record.get("cmmtOrnm"),
        "disclosureType": record.get("optpShpNm"),
        "obligorCount": record.get("rgsDtrCnt"),
        "registrationIds": record.get("rgsMno"),
        "sourceSite": "PETI",
        "sourceUrl": SEARCH_PAGE,
        "detailEndpoint": DETAIL_PAGE,
        "pdfGenerationEndpoint": PDF_API,
        "retrievalKind": "RAONK_FILE_TOKEN" if direct_file else "GENERATED_PDF",
        "fileToken": record.get("optpFlnm"),
        "raw": record,
    }
    return normalized


def write_atomic(path: pathlib.Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".part")
    temporary.write_bytes(payload)
    temporary.replace(path)


def main() -> int:
    parser = argparse.ArgumentParser(description="PETI 연도별 재산공개 목록 자동 발견")
    parser.add_argument("--year", type=int, action="append", required=True)
    parser.add_argument(
        "--output-dir", type=pathlib.Path, default=ROOT / "data" / "discovery"
    )
    parser.add_argument("--delay", type=float, default=0.5)
    args = parser.parse_args()

    client = PetiClient(delay=max(args.delay, 0.2))
    client.initialize()
    summary = {}
    for year in sorted(set(args.year)):
        raw_records = client.search_year(year)
        records = [normalize_record(year, record) for record in raw_records]
        discovered_at = datetime.now(timezone.utc).isoformat()
        payload = {
            "schemaVersion": "2.1.0",
            "source": "PETI integrated disclosure search",
            "sourceUrl": SEARCH_PAGE,
            "discoveredAt": discovered_at,
            "year": year,
            "totalCount": len(records),
            "records": records,
        }
        path = args.output_dir / f"peti-{year}.json"
        write_atomic(path, json.dumps(payload, ensure_ascii=False, indent=2).encode())
        summary[str(year)] = {
            "records": len(records),
            "directFileTokens": sum(bool(item["fileToken"]) for item in records),
            "generatedPdfs": sum(
                item["retrievalKind"] == "GENERATED_PDF" for item in records
            ),
            "path": str(path),
        }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
