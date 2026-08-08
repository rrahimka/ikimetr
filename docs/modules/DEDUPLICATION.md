# Deduplication v1

## Principle
False merge is worse than an extra duplicate.

## Pipeline
Candidate generation → exact IDs/URLs → contact signals → structured attributes → geo → image hashes → text similarity → advanced analysis if needed.

## Outputs
- duplicate candidate with evidence;
- auto-merge only at conservative high confidence;
- moderation for uncertain cases;
- explicit reject state.

## Data preservation
Original Listings are never deleted because of canonical merging. Merge history must be retained.

## Architecture review addition
A `Listing Cluster` concept may be used as an intermediate grouping where similarity is high but physical-property identity is not yet certain.
