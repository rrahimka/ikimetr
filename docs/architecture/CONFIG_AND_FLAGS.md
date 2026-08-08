# Configuration & Feature Flags

## Configurable business values
Avoid magic numbers for freshness windows, match thresholds, owner-confidence cutoffs, rate limits and notification thresholds. Keep them in a versioned configuration layer with safe defaults.

## Feature flags
Architecture should support controlled enablement such as:
- OWNER_FEED_SOURCE_X
- AI_OWNER_REVIEW
- AI_SEMANTIC_MATCHING
- INTERNAL_CHAT
- PUBLIC_LISTINGS

Flags are deployment/product controls, not substitutes for authorization.
