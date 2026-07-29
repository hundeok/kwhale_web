#!/usr/bin/env python3
"""Build an auditable year/source coverage matrix."""

from __future__ import annotations

import argparse
import json
import pathlib
from datetime import datetime, timezone

ROOT = pathlib.Path(__file__).resolve().parents[1]


def count_manifest(path: pathlib.Path) -> int:
    if not path.exists():
        return 0
    return int(json.loads(path.read_text(encoding="utf-8")).get("totalCount") or 0)


def main() -> int:
    parser = argparse.ArgumentParser(description="공식 출처 연도별 커버리지 보고서")
    parser.add_argument("--from-year", type=int, default=2020)
    parser.add_argument("--to-year", type=int, default=2026)
    parser.add_argument("--data-dir", type=pathlib.Path, default=ROOT / "data")
    args = parser.parse_args()
    rows = []
    for year in range(args.from_year, args.to_year + 1):
        discovery = args.data_dir / "discovery"
        raw = args.data_dir / "raw" / str(year)
        gwanbo_found = count_manifest(discovery / f"gwanbo-{year}.json")
        gwanbo_downloaded = len(list((raw / "metadata").glob("gwanbo-*.json")))
        rows.append(
            {
                "year": year,
                "gwanboDiscovered": gwanbo_found,
                "gwanboDownloaded": gwanbo_downloaded,
                "gwanboComplete": gwanbo_found > 0 and gwanbo_found == gwanbo_downloaded,
                "petiCurrentDiscovered": count_manifest(
                    discovery / f"peti-{year}.json"
                ),
                "petiLegacyDiscovered": count_manifest(
                    discovery / f"peti-legacy-{year}.json"
                ),
            }
        )
    report = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "scopeNote": {
            "gwanbo": "정부·대법원·중앙선거관리위원회 관보 게재분",
            "petiLegacy": "2022-08~2023-12 PETI 이전공개",
            "petiCurrent": "2024년 이후 PETI 통합검색 전체 위원회",
        },
        "years": rows,
        "gates": {
            "gwanboAllYearsComplete": all(row["gwanboComplete"] for row in rows),
            "petiCurrentFilesDownloaded": False,
            "petiLegacyFilesDownloaded": False,
            "allInstitutionsParsedAndLoaded": False,
        },
    }
    output = args.data_dir / "quality" / "source-coverage.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
