# Owner Intelligence v1

## Goal
Estimate whether a listing is likely from an owner or professional intermediary.

## Signal families
- phone history;
- number of unique properties;
- geography/property diversity;
- text signals;
- behavior/frequency;
- cross-source activity;
- public account signals where permitted.

## Output classes
- HIGH_OWNER_CONFIDENCE
- UNCERTAIN
- HIGH_AGENT_CONFIDENCE

## Principles
- Do not use LLM as the primary classifier for every listing.
- AI may assist uncertain cases.
- Store evidence/signals and engine version.
- Do not present uncalibrated scores as exact probability.
- Precision is prioritized for Owner Feed quality.
