PRAGMA foreign_keys = ON;

CREATE TABLE dataset_release (
  id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL,
  source_run_id TEXT NOT NULL,
  built_at TEXT NOT NULL,
  minimum_year INTEGER NOT NULL,
  maximum_year INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('BUILDING', 'VALIDATED', 'REJECTED'))
);

CREATE TABLE source_artifact (
  id TEXT PRIMARY KEY,
  release_id TEXT NOT NULL REFERENCES dataset_release(id),
  source_system TEXT NOT NULL,
  source_year INTEGER,
  source_url TEXT NOT NULL,
  source_object_key TEXT,
  collected_at TEXT NOT NULL,
  raw_sha256 TEXT NOT NULL,
  decoded_sha256 TEXT NOT NULL,
  raw_bytes INTEGER NOT NULL,
  decoded_bytes INTEGER NOT NULL,
  record_count INTEGER NOT NULL,
  UNIQUE(release_id, decoded_sha256)
);

CREATE TABLE person (
  id TEXT PRIMARY KEY,
  canonical_name TEXT NOT NULL,
  latest_organization TEXT NOT NULL,
  latest_title TEXT NOT NULL,
  identity_key TEXT NOT NULL UNIQUE,
  identity_method TEXT NOT NULL,
  identity_confidence REAL NOT NULL,
  first_seen_year INTEGER NOT NULL,
  last_seen_year INTEGER NOT NULL
);

CREATE TABLE disclosure (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES person(id),
  source_artifact_id TEXT NOT NULL REFERENCES source_artifact(id),
  source_record_index INTEGER NOT NULL,
  source_record_hash TEXT NOT NULL,
  period_year INTEGER NOT NULL,
  registered_at TEXT,
  disclosed_at TEXT,
  name_at_disclosure TEXT NOT NULL,
  organization_at_disclosure TEXT NOT NULL,
  title_at_disclosure TEXT NOT NULL,
  gross_assets INTEGER NOT NULL,
  liabilities INTEGER NOT NULL,
  net_worth INTEGER NOT NULL,
  asset_count INTEGER NOT NULL,
  UNIQUE(source_artifact_id, source_record_index)
);

CREATE TABLE asset (
  id TEXT PRIMARY KEY,
  disclosure_id TEXT NOT NULL REFERENCES disclosure(id) ON DELETE CASCADE,
  source_asset_index INTEGER NOT NULL,
  owner TEXT,
  category TEXT NOT NULL,
  subcategory TEXT,
  detail TEXT NOT NULL,
  valuation INTEGER NOT NULL,
  difference INTEGER,
  address TEXT,
  latitude REAL,
  longitude REAL,
  raw_json TEXT NOT NULL,
  asset_fingerprint TEXT NOT NULL,
  UNIQUE(disclosure_id, source_asset_index)
);

CREATE TABLE dataset_metric (
  release_id TEXT NOT NULL REFERENCES dataset_release(id),
  metric_key TEXT NOT NULL,
  metric_value TEXT NOT NULL,
  PRIMARY KEY(release_id, metric_key)
);

CREATE INDEX person_name_idx ON person(canonical_name);
CREATE INDEX person_org_idx ON person(latest_organization);
CREATE INDEX disclosure_period_idx ON disclosure(period_year);
CREATE INDEX disclosure_person_date_idx ON disclosure(person_id, registered_at, disclosed_at);
CREATE INDEX disclosure_record_hash_idx ON disclosure(source_record_hash);
CREATE INDEX asset_category_idx ON asset(category);
CREATE INDEX asset_owner_idx ON asset(owner);
CREATE INDEX asset_valuation_idx ON asset(valuation);
CREATE INDEX asset_fingerprint_idx ON asset(asset_fingerprint);
