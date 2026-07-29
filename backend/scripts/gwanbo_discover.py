#!/usr/bin/env python3
"""Discover official-property disclosure entries in the Korean Gazette."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import pathlib
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

ROOT = pathlib.Path(__file__).resolve().parents[1]
BASE = "https://www.gwanbo.go.kr"
SEARCH_PAGE = f"{BASE}/user/search/searchThema.do?tabType=1"
BASE_INFO_API = f"{BASE}/user/search/getThemeBaseInfo.do"
SEARCH_API = f"{BASE}/SearchRestApi.jsp"
USER_AGENT = "KWhaleDataPipeline/2.1 (+official-public-data-research)"


def post(url: str, payload: dict) -> dict:
    request = urllib.request.Request(
        url,
        data=urllib.parse.urlencode(payload).encode(),
        headers={
            "User-Agent": USER_AGENT,
            "Referer": SEARCH_PAGE,
            "Accept": "application/json, text/javascript, */*; q=0.01",
            "X-Requested-With": "XMLHttpRequest",
        },
    )
    with urllib.request.urlopen(request, timeout=90) as response:
        return json.loads(response.read())


def query_api(query: str, page: int, size: int) -> dict:
    return post(
        SEARCH_API,
        {
            "mode": "theme",
            "index": "gwanbo",
            "query": query,
            "pQuery_tmp": "",
            "pageNo": page,
            "listSize": size,
            "sort": "",
        },
    )


def stable_id(record: dict) -> str:
    source = record.get("search_key") or (
        f"{record.get('stored_ebook_no')}|{record.get('stored_toc_seq')}"
    )
    return hashlib.sha256(str(source).encode()).hexdigest()


def normalize(record: dict) -> dict:
    viewer_path = record.get("stored_field_url") or ""
    pdf_path = record.get("stored_pdf_file_path") or ""
    return {
        "id": stable_id(record),
        "year": int(record.get("stored_field_year")),
        "publishedAt": "-".join(
            [
                record.get("stored_field_year", ""),
                record.get("stored_field_month", ""),
                record.get("stored_field_day", ""),
            ]
        ),
        "title": record.get("stored_field_subject"),
        "gazetteNumber": record.get("stored_ebook_no"),
        "gazetteType": record.get("stored_field_keyword"),
        "category": record.get("stored_category_name"),
        "page": record.get("stored_page"),
        "fileSize": record.get("stored_file_size"),
        "sourceSite": "GWANBO",
        "sourceUrl": urllib.parse.urljoin(BASE, viewer_path),
        "officialPdfPath": pdf_path,
        "retrievalKind": "GWANBO_VIEWER_DOCUMENT",
        "raw": record,
    }


def discover_year(year: int, delay: float) -> list[dict]:
    info = post(BASE_INFO_API, {"tabType": "1"})
    theme = info["themeQuery"]
    subject = f"unstored_field_subject:({theme})"
    year_query = f"{subject} AND unstored_field_subject:({year})"
    overview = query_api(
        f"{year_query} AND keyword_category_order:(@@ORDER_NUM)", 1, 1
    )
    categories = [
        (str(item["category_order"]), int(item["count"]))
        for item in overview.get("data", [])
        if int(item.get("count") or 0) > 0
    ]
    output: list[dict] = []
    for category_order, count in categories:
        query = f"{year_query} AND keyword_category_order:({category_order})"
        for page in range(1, math.ceil(count / 100) + 1):
            response = query_api(query, page, 100)
            for category in response.get("data", []):
                output.extend(category.get("list") or [])
            time.sleep(max(delay, 0.2))
    unique = {stable_id(record): record for record in output}
    return [normalize(record) for record in unique.values()]


def write_atomic(path: pathlib.Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".part")
    temp.write_bytes(data)
    temp.replace(path)


def main() -> int:
    parser = argparse.ArgumentParser(description="전자관보 재산공개 연도별 자동 발견")
    parser.add_argument("--year", type=int, action="append", required=True)
    parser.add_argument(
        "--output-dir", type=pathlib.Path, default=ROOT / "data" / "discovery"
    )
    parser.add_argument("--delay", type=float, default=0.3)
    args = parser.parse_args()
    summary = {}
    for year in sorted(set(args.year)):
        records = discover_year(year, args.delay)
        payload = {
            "schemaVersion": "2.1.0",
            "source": "Korean Gazette official-property disclosure theme",
            "sourceUrl": SEARCH_PAGE,
            "scope": [
                "Government Ethics Committee",
                "Supreme Court Ethics Committee",
                "National Election Commission Ethics Committee",
            ],
            "discoveredAt": datetime.now(timezone.utc).isoformat(),
            "year": year,
            "totalCount": len(records),
            "records": records,
        }
        path = args.output_dir / f"gwanbo-{year}.json"
        write_atomic(path, json.dumps(payload, ensure_ascii=False, indent=2).encode())
        by_category = {}
        for record in records:
            by_category[record["category"]] = by_category.get(record["category"], 0) + 1
        summary[str(year)] = {
            "records": len(records),
            "categories": by_category,
            "path": str(path),
        }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
