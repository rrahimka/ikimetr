# ADR-001 — Modular Monolith First

## Decision
MVP uses one modular backend application with separate worker processes instead of multiple independently deployed microservices.

## Reason
Lower DevOps cost, easier transactions, simpler debugging and lower AI-agent context complexity while preserving clean module boundaries.

## Consequence
Modules must not bypass public domain interfaces arbitrarily. High-load modules may be extracted later without changing product semantics.
