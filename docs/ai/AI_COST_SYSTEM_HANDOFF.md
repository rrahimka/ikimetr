# AI Cost System Handoff Checkpoint

Status: Phase 3G.3 complete; Phase 3G.4 has not started. This checkpoint records the established state without rerunning the full verification suite.

## Completed phases

- **Phase 1 — AI policy foundation:** root agent instructions were consolidated; detailed cost-routing policy and provider-specific profiles were added. Codex remains the primary development coordinator.
- **Phase 3A — Config foundation:** five strict JSON configs, Zod validation, duplicate-key/secret rejection, deterministic canonical SHA-256 hashing, and immutable config snapshots are implemented.
- **Phase 3B — Deterministic core:** integer-micros pricing/accounting, persistent budgets, reservations, counters, retries, and settlements use deterministic replay of a validated append-only JSONL ledger as the only source of truth; cache-key and single-flight foundations are present.
- **Phase 3C — Verified cache:** immutable content-addressed entries combine metadata with minimized canonical payloads; verified reuse requires trusted evidence and compatibility. Sensitive persistence requires scoped approval plus an injected encryption/HMAC codec; Secret persistence is denied.
- **Phase 3D — Router dry-run:** strict routing contracts and a non-recursive `CACHE → DETERMINISTIC → LOCAL → CHEAP_CLOUD → STRONG → FINAL` evaluator/coordinator are implemented with config-order selection, read-only budget preflight, reason codes, and fail-closed audit handling. No provider calls exist.
- **Phase 3E — Prompt/context builder:** filesystem- and network-free context integrity, deterministic diff/error compaction, mandatory overflow policy, manifest hashing, and fixed-section prompt construction are implemented. Only preselected Serena excerpts with provenance/ranges/content hashes are accepted.
- **Phase 3F — Local AI adapter:** OllamaAdapter with exact model/digest pinning, health probe, bounded invoke, hard timeout, response-size limits, strict structured-output validation, and Budget/Ledger accounting integration. Zero monetary pricing with wall-time/token/call accounting.
- **Phase 3G.1 — TypeScript fixes:** Zod 4 compatibility, TypeScript strict-mode fixes, and Vitest 4 migration for DeepSeek adapter and tests.
- **Phase 3G.2 — Cheap Cloud Invocation Boundary:** CheapCloudInvoker validates CHEAP_CLOUD + deepseek authorization from an already-computed RoutingDecision and delegates exactly once to DeepSeekAdapter. No routing, no retry, no fallback, no provider reselection.
- **Phase 3G.3 — Execution Coordinator:** ExecutionCoordinator receives LocalInvoker and CheapCloudInvoker via constructor injection, validates all four authorization conditions (route, decision.decision, decision.route, provider_candidate) before dispatch, and returns invoker results unchanged. Unauthorized paths return denied with zero invoker calls.

## Current green baseline

Latest full WSL-native checkpoint after Phase 3G.3:

- `pnpm lint` — PASS.
- `pnpm typecheck` — PASS.
- `pnpm test:unit` — 363/363 PASS (31 files).
- `pnpm test:integration` — 3/3 PASS.
- `pnpm build` — PASS.

Vitest workers capped at 4 (`maxWorkers: 4`) for WSL stability. One health unit test has a per-test 10s timeout due to WSL Fastify inject latency.

## Current workspace

The workspace intentionally remains dirty and uncommitted. Existing tracked changes include `.gitignore`, `AGENTS.md`, `pnpm-lock.yaml`, and `vitest.config.ts`; important untracked areas include `.agents/provider-profiles/`, `.claude/skills/playwright-cli/`, `.playwright/`, `config/`, `docs/ai/`, `docs/superpowers/`, and `packages/ai-cost-system/`.

No reset, checkout, stash, clean, commit, or merge was performed. Preserve all Phase 1/3A–3F/3G work.

## Current architecture

- **Policy/config:** `AGENTS.md`, `docs/ai/AI_COST_ROUTING_POLICY.md`, provider profiles, and strict versioned configs under `config/ai-cost/`; canonical validation produces an immutable hashed snapshot.
- **Budget Controller:** fail-closed quote/preflight plus reserve/settle/release accounting; task/day/month and retry limits recover through UTC ledger replay.
- **Ledger/replay:** validated append-only JSONL is the sole persistent source of truth; serialized `O_APPEND` + fsync writes, deterministic replay, and crash-surviving active reservations prevent restart bypass.
- **Pricing:** integer micros per million tokens with BigInt calculations and overflow checks; unknown/stale automatic cloud pricing is denied.
- **Verified Cache:** immutable content-addressed revisions, integrity checksum, compatibility/evidence gates, quarantine, negative-cache support, and single-flight coordination.
- **Cost Router:** pure policy evaluator plus dry-run coordinator; fixed state machine, provider allowlists/order, validated health/approval evidence, and no network/model/shell execution.
- **Context/Prompt Builder:** filesystem-free core consuming only validated preselected excerpts; deterministic compaction, manifest/prompt hashes, fixed trusted/untrusted sections, and no arbitrary command channel.
- **Local AI:** OllamaAdapter with health probe, model pinning, bounded invoke, and LocalInvoker boundary enforcing LOCAL + local-ai authorization.
- **Cheap Cloud:** DeepSeekAdapter with HTTPS-only endpoint validation, schema enforcement, timeout, and CheapCloudInvoker boundary enforcing CHEAP_CLOUD + deepseek authorization.
- **Execution Coordinator:** Constructor-injected invoker dispatch; validates four-condition authorization before calling any invoker; no routing, retry, or fallback.

## Local AI exact state

- Ollama `0.32.6`, Windows endpoint `http://127.0.0.1:11434`; localhost only.
- Model `qwen2.5-coder:7b`, digest `dae161e27b0e90dd1856c8bb3209201fd6736d8eb66298e75ed87571486f4364`, quantization `Q4_K_M`.
- Acceptance verdict: **LIMITED**, approximately **3.58 generated tokens/s** average. Classification, tiny TypeScript, and simple debugging tests passed.
- Approved role: short, low-risk, bounded tasks only. Current provider state: **DISABLED**.

## Next exact task

**Phase 3G.4 — End-to-End AI Execution Integration.** Wire the existing CostRouter → ExecutionCoordinator → invokers into one controlled execution path. The router, coordinator, invokers, and adapters are already implemented and individually tested. This phase connects them without changing any component's internal behavior.

Design: [`docs/superpowers/specs/2026-08-10-phase-3g4-e2e-execution-integration-design.md`](../superpowers/specs/2026-08-10-phase-3g4-e2e-execution-integration-design.md)
Plan: [`docs/superpowers/plans/2026-08-10-phase-3g4-e2e-execution-integration.md`](../superpowers/plans/2026-08-10-phase-3g4-e2e-execution-integration.md)

## Security invariants

- Fail closed; localhost only; never expose Ollama to LAN.
- No secrets or arbitrary shell/tool execution; model output is untrusted.
- Secret never enters model context; Sensitive is prohibited for the initial Local AI rollout.
- No provider self-verification; verified cache reuse requires trusted verification evidence.
- ExecutionCoordinator must not bypass CostRouter; CostRouter remains the sole routing authority.
- No autonomous provider selection; RoutingDecision is the source of truth for execution.

## Recommended continuation order

Phase 3G.4 End-to-End Integration → explicit enablement → Qwen adapter → DeepSeek acceptance test → Verification/Fix Loop. Do not start any step automatically.
