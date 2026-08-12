# AI Cost System Handoff Checkpoint

Status: Phase 3G.4 complete and verified at checkpoint `e8b7a35`. The next phase has not started.

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
- **Phase 3G.4 — End-to-End AI Execution Integration:** AiExecutor wires CostRouter → ExecutionCoordinator → LocalInvoker/CheapCloudInvoker without changing component behavior. It calls routing and execution at most once, executes only LOCAL or CHEAP_CLOUD decisions, and provides no retry, fallback, or provider reselection.

## Current green baseline

Fresh WSL-native verification on 2026-08-12 at checkpoint `e8b7a35`:

- `pnpm lint` — PASS.
- `pnpm typecheck` — PASS.
- `pnpm test:unit` — PASS.
- `pnpm test:integration` — 3/3 PASS.
- `pnpm build` — PASS, including packages, API, worker, and Next.js web.

The first integration attempt failed only because local PostgreSQL and Redis were not running. Docker Desktop WSL integration was restored without reinstalling Docker; the existing PostGIS and Redis containers then reported healthy, and the unchanged integration suite passed 3/3. Vitest workers remain capped at 4 (`maxWorkers: 4`) for WSL stability.

## Current workspace

- Git checkpoint: `e8b7a35` on `main`, also preserved as `checkpoint/phase-3g4`.
- Local and remote `main` were confirmed synchronized before verification.
- The local `.env` was created from `.env.example`; env files remain gitignored.
- PostgreSQL/PostGIS and Redis run through the existing Docker Compose definition and bind only to `127.0.0.1`.
- No production code changed during verification.

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

- Ollama `0.32.7`, Windows endpoint `http://127.0.0.1:11434`; reachable from WSL through localhost only.
- Model `qwen2.5-coder:7b`, digest `dae161e27b0e90dd1856c8bb3209201fd6736d8eb66298e75ed87571486f4364`, quantization `Q4_K_M`.
- Acceptance verdict: **LIMITED**, approximately **3.58 generated tokens/s** average. Classification, tiny TypeScript, and simple debugging tests passed.
- Approved role: short, low-risk, bounded tasks only. Current provider state: **DISABLED**.

## Next exact task

**Explicit AI execution enablement — design and approval only.** Phase 3G.4 is complete, but provider execution remains disabled by policy. The next phase must define the smallest fail-closed enablement boundary before any provider is enabled.

Required decisions for that separate design:

- preserve CostRouter as the sole routing authority;
- keep Local AI limited to short, low-risk, bounded tasks;
- keep Sensitive and Secret data prohibited from model context;
- keep Ollama localhost-only;
- require explicit configuration and verification evidence;
- introduce no retry, fallback, autonomous provider selection, or paid API call;
- do not implement Qwen or DeepSeek acceptance work in the same phase.

Do not start implementation automatically. First create and approve a dedicated design, then a task-by-task TDD plan.

## Security invariants

- Fail closed; localhost only; never expose Ollama to LAN.
- No secrets or arbitrary shell/tool execution; model output is untrusted.
- Secret never enters model context; Sensitive is prohibited for the initial Local AI rollout.
- No provider self-verification; verified cache reuse requires trusted verification evidence.
- ExecutionCoordinator must not bypass CostRouter; CostRouter remains the sole routing authority.
- No autonomous provider selection; RoutingDecision is the source of truth for execution.

## Recommended continuation order

Explicit enablement design/approval → explicit enablement implementation → Qwen adapter design → DeepSeek acceptance test → Verification/Fix Loop. Do not start any step automatically.
