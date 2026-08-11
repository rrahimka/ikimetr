# AI Cost Router Dry-Run Design

**Status:** Approved

**Scope:** Phase 3D only. This design adds a deterministic `PolicyEvaluator`
and a separate dry-run coordinator to `@ikimetr/ai-cost-system`. It selects a
route or a fail-closed terminal decision, but it cannot invoke a model,
provider, network endpoint, shell command, PromptBuilder, or Verification/Fix
Loop.

## Constraints

- Preserve all existing Phase 1/3A/3B/3C work in the current dirty workspace.
- Modify only `config/ai-cost`, `packages/ai-cost-system`, and the Phase 3D
  design/plan documents.
- Do not add dependencies, credentials, real endpoints, models, pricing,
  provider adapters, databases, Redis, or frameworks.
- Keep every bootstrap provider `enabled: false`.
- Never persist or accept raw prompts, logs, source, env values, secrets, or raw
  PII at the routing boundary.
- Do not reserve budget or create an invocation attempt in dry-run routing.

## Chosen structure

The implementation has two layers:

1. `PolicyEvaluator` contains pure, synchronous policy rules and deterministic
   reason-code mappings.
2. `CostRouter` is a finite dry-run coordinator. It obtains validated cache,
   ledger, pricing, and budget evidence, feeds it to the evaluator, and appends
   a minimal audit event. It has no provider-call interface.

This separation keeps policy tests independent from filesystem I/O while still
testing real integration with the Phase 3B/3C components.

## Strict contracts

### Task routing request

`TaskRoutingRequest` is a strict Zod object with bounded identifiers and hashes:

- `task_id`, `task_type`, `purpose`, `risk_class`, and `data_class`;
- `requested_capability`;
- `task_spec_hash`, ordered `input_hashes`, `current_diff_hash`, and
  `error_fingerprint`;
- `verification_profile`;
- unique `allowed_routes` and `max_route`;
- `approval_context`, which may request scopes but cannot claim approval;
- `manual_primary_agent`, which is metadata only and never approval.

Risk classes are `low`, `standard`, `high`, and `security-critical`.
Capabilities are predefined identifiers split into deterministic and
AI-eligible sets. Unknown values and unknown object fields are rejected.

### Routing decision

`RoutingDecision` is a strict immutable object containing:

- `decision`: `CACHE`, `DETERMINISTIC`, `LOCAL`, `CHEAP_CLOUD`, `STRONG`,
  `APPROVAL_REQUIRED`, or `STOP`;
- selected `route` and nullable `provider_candidate`;
- fixed `reason_code` and fixed `reason_summary`;
- normalized cache, budget, pricing, data-policy, and approval status;
- `escalation_allowed`, `config_hash`, `request_hash`, and
  `transition_trace`;
- `decision_hash`.

The request and decision hashes use SHA-256 over deterministic canonical JSON.
`decision_hash` covers the complete decision except itself. Timestamps and
audit event IDs are not part of it, so unchanged request, config, and effective
state produce the same hash.

## Provider policy configuration

The existing strict provider schema gains exactly two required fields:

- `allowedRiskClasses`;
- `allowedCapabilities`.

Both use the shared predefined enums, reject duplicates and unknown values,
and are immutable in the loaded config snapshot. An empty list denies all;
there is no wildcard. Provider-specific permissions are read only from these
allowlists and the existing `allowedDataClasses` field. The router never
expands a provider's configured permissions.

## Finite state machine

The only state order is:

```text
CACHE -> DETERMINISTIC -> LOCAL -> CHEAP_CLOUD -> STRONG -> FINAL
```

The coordinator uses bounded iteration over this fixed sequence. There is no
recursion. Every visited, skipped, or failed stage adds a machine-readable
transition record. A higher route can be considered only after every lower
route has a recorded unavailable, disallowed, or insufficient reason.

### Cache

Cache candidates contain complete Phase 3C compatibility contexts and are
checked only through `VerifiedCacheRuntime.lookupVerified()`.

- A compatible verified hit returns `CACHE`.
- A miss or ordinary compatibility invalidation continues.
- Quarantine, invalid provenance/evidence, audit failure, or invalid storage
  returns `STOP`.
- Secret data never enters persistent cache lookup.

### Deterministic

Exact comparison, hashing, formatting, schema/config validation, deterministic
verification-result interpretation, exact SQL/regex/file lookup, Serena
navigation, and exact deduplication return `DETERMINISTIC`. No AI route is
evaluated for these capabilities.

### Provider routes

Provider candidates are considered only in the order stored in `router.json`.
For each candidate, the coordinator checks:

1. route is present in `allowed_routes` and at or below `max_route`;
2. provider is enabled and has a configured model/limits;
3. latest validated ledger health is eligible;
4. data class, risk class, and capability are allowlisted;
5. pricing is usable;
6. read-only budget quote allows the candidate;
7. effective ledger approval allows it when required.

No health event means `unknown`, never healthy. Existing `timeout` and
`malformed` health events normalize to a degraded/unavailable result without
removing their replay compatibility. An unavailable preferred provider may
fall back to the next configured provider. Unknown/stale pricing may fall back
within the same route only when another configured provider has known pricing;
if none does, cloud routing stops. Budget exhaustion is terminal and cannot be
bypassed by changing provider or escalating.

Missing approval returns `APPROVAL_REQUIRED`; a denial or revocation returns
`STOP`. Effective approvals come only from the latest validated
`ApprovalEvent` for the task and scope. `manual_primary_agent` does not grant a
route, provider, secondary-model, or budget approval.

## Escalation and repetition

Local or cheap-cloud insufficiency must be supported by validated prior attempt
and verification evidence from the ledger. A repeated request/error/diff
fingerprint without new evidence returns `STOP`. A stronger tier cannot be
selected merely because it exists or because the current manual coordinator is
Codex or Claude.

Secret data, invalid config or ledger, unresolved cache quarantine, exhausted
budget, missing approved provider, a route above `max_route`, and policy
contradictions are fail-closed terminal conditions.

## Read-only budget preflight

`BudgetController.quote()` reuses the same provider, pricing, replay-readiness,
crash-reservation, discrepancy-circuit, and numeric limit evaluation as
`reserve()`. It derives a candidate reservation in memory but does not append a
`BudgetReservation`, mutate derived state, or authorize a future call.

A quote is advisory only. Any future invocation phase must still call
`reserve()` inside its serialized critical section immediately before an
automatic provider call.

## Ledger integration

The ledger union gains a strict `RoutingDecisionEvent`. It stores only:

- task/request/decision/config hashes;
- decision, route, provider candidate, reason code;
- normalized policy statuses and transition-trace hash.

It contains no raw content. Budget replay ignores it, so it cannot affect
counters and repeated dry-runs remain deterministic. Append failure returns an
unaudited fail-closed `STOP`; it never triggers a retry, provider call, or
recursive audit attempt.

## Errors and recovery

- Invalid task requests are rejected before any cache, budget, or ledger write.
- Invalid config produces `STOP` and prevents coordinator initialization.
- Invalid or partial ledger produces `STOP`; no record is skipped or repaired.
- Cache quarantine produces `STOP` and remains subject to Phase 3C recovery
  rules.
- Budget/pricing errors map to fixed reason codes without exposing raw error
  messages in decisions or the ledger.
- All returned decisions are deeply immutable.

## Test strategy

TDD covers strict request/decision validation; allowed and denied provider
risk/capability combinations; config-hash sensitivity; verified cache hit,
miss, invalidation, and quarantine; every deterministic capability; local,
DeepSeek/Qwen fallback, and strong-route selection; disabled and unknown-health
providers; pricing and budget denial; approvals and manual-primary isolation;
repeated fingerprints; deterministic decisions; bounded transitions; and audit
append failure.

Integration tests use real temporary config, ledger, cache storage, and the
existing trusted verification fixture. They assert that no
`BudgetReservation`, invocation attempt, provider call, network call, or shell
execution occurs.

Full verification runs from a temporary WSL-native copy using only the existing
loopback-only integration infrastructure. Temporary services and verification
copies are cleaned up without touching user volumes or the Windows workspace.

## Self-review

- **Duplication:** Provider permissions remain in config; the evaluator owns
  generic policy only. Existing canonicalization, snapshot, cache, pricing,
  ledger, and budget code are reused.
- **Security:** All external state is strict and replay-validated. Secret data,
  unknown health, missing approval, audit failure, and corrupted state fail
  closed.
- **Budget integrity:** Quote shares reservation validation but cannot mutate or
  reserve. A later phase cannot treat it as authorization.
- **Determinism:** Fixed iteration order, canonical hashes, injected time, and
  ledger-derived state avoid randomness and recursion.
- **Token overhead:** Decisions and audit events contain hashes, enums, and a
  short bounded trace rather than prompts or logs.
- **YAGNI:** No generic rules engine, provider abstraction, command runner,
  router DSL, gateway, recovery UI, or verification loop is introduced.
