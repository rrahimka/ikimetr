# Ingestion Module

## Goal
Safely ingest external listing data through source-specific adapters into a common raw pipeline.

## Pipeline
SOURCE REGISTRY → ADAPTER → RAW LISTING → PAYLOAD HASH → VALIDATION → NORMALIZATION → DELTA DETECTION → OWNER INTELLIGENCE → DEDUPE → CORE.

## Rules
- One adapter per source.
- Prefer authorized/official data access modes.
- Every source stores acquisition constraints/status.
- Raw payload is retained sufficiently to reprocess errors.
- Unchanged payload should not trigger expensive downstream work.
- Source outage must not mass-mark records inactive.
- Each source has health state and kill switch.
