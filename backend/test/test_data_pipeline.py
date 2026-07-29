import gzip
import json
import pathlib
import sqlite3
import sys
import tempfile
import unittest


BACKEND_DIR = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR / "scripts"))

import build_dataset  # noqa: E402
import realsignal_acquire  # noqa: E402


class AcquisitionTests(unittest.TestCase):
    def test_decode_response_accepts_gzip_header_and_magic(self):
        body = gzip.compress(b'[{"id": 1}]')
        self.assertEqual(
            realsignal_acquire.decode_response(body, {"content-encoding": "gzip"}),
            b'[{"id": 1}]',
        )
        self.assertEqual(realsignal_acquire.decode_response(body, {}), b'[{"id": 1}]')

    def test_select_periods_is_filtered_and_sorted(self):
        manifest = {
            "periods": [
                {"id": "2026", "objectKey": "c"},
                {"id": "bad", "objectKey": "x"},
                {"id": "2024", "objectKey": "a"},
            ]
        }
        selected = realsignal_acquire.select_periods(manifest, {2024, 2026})
        self.assertEqual([item["year"] for item in selected], [2024, 2026])


class DatasetBuildTests(unittest.TestCase):
    def test_build_creates_normalized_release_with_provenance(self):
        with tempfile.TemporaryDirectory() as directory:
            private_dir = pathlib.Path(directory)
            records = [
                {
                    "name": "홍길동",
                    "org": "테스트기관",
                    "title": "위원",
                    "registeredDate": "2026-01-01T00:00:00Z",
                    "disclosureDate": "2026-02-01T00:00:00Z",
                    "assets": [
                        {
                            "type": "예금",
                            "subType": "예금",
                            "detail": "테스트은행",
                            "valuation": 1000,
                            "owner": "본인",
                        },
                        {
                            "type": "채무",
                            "detail": "대출",
                            "valuation": 300,
                            "owner": "본인",
                        },
                    ],
                }
            ]
            decoded = json.dumps(records, ensure_ascii=False).encode()
            decoded_sha = realsignal_acquire.sha256_bytes(decoded)
            decoded_path = (
                private_dir / "sources" / "realsignal" / "objects" / "decoded" / decoded_sha
            )
            decoded_path.parent.mkdir(parents=True)
            decoded_path.write_bytes(decoded)
            acquisition = {
                "runId": "test-run",
                "completedAt": "2026-07-27T00:00:00Z",
                "artifacts": [
                    {
                        "year": 2026,
                        "sourceUrl": "https://example.test/2026",
                        "objectKey": "api/v1/2026/test.json",
                        "rawSha256": "a" * 64,
                        "decodedSha256": decoded_sha,
                        "rawBytes": len(decoded),
                        "decodedBytes": len(decoded),
                        "decodedPath": str(decoded_path.relative_to(private_dir)),
                        "recordCount": 1,
                    }
                ],
            }
            lineage_path = private_dir / "lineage" / "latest-realsignal.json"
            lineage_path.parent.mkdir(parents=True)
            lineage_path.write_text(json.dumps(acquisition), "utf-8")

            summary = build_dataset.build(private_dir)
            self.assertEqual(summary["metrics"]["persons"], 1)
            self.assertEqual(summary["metrics"]["assets"], 2)
            database_path = private_dir / summary["database"]["privatePath"]
            with sqlite3.connect(database_path) as connection:
                row = connection.execute(
                    "SELECT gross_assets, liabilities, net_worth FROM disclosure"
                ).fetchone()
                self.assertEqual(row, (1000, 300, 700))
                source = connection.execute(
                    "SELECT source_system, source_url FROM source_artifact"
                ).fetchone()
                self.assertEqual(source, ("REALSIGNAL", "https://example.test/2026"))


if __name__ == "__main__":
    unittest.main()
