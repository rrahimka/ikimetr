# Matching Engine v1

## Goal
Rank Listings against Requests with explainable deterministic scoring.

## Pipeline
1. Eligibility filters
2. Candidate generation
3. Hard constraints
4. Weighted scoring
5. Negative/exclusion rules
6. Save/update Match
7. Notify only when materially useful

## Principles
- Start without LLM semantic matching.
- Unknown values are not treated as negative values.
- Score is not a probability of deal success.
- Store reasons and algorithm version.
- Recalculate on meaningful Request/Listing changes.
- Same Request+Listing updates existing Match.

## Future
Semantic text/AI layer may supplement deterministic scoring after beta evidence justifies it.
