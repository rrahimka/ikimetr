# Local AI Explicit Enablement Design

**Date:** 2026-08-12  
**Status:** Proposed for written-spec review  
**Depends on:** Phase 3G.4 checkpoint `e8b7a35`

## Goal

Enable the already-tested Windows Ollama runtime as İkiMetr's LOCAL execution
tier for short, low-risk, bounded tasks while preserving fail-closed routing,
localhost isolation, deterministic verification, and zero cloud spend.

This phase enables only provider `local-ai` with model
`qwen2.5-coder:7b`. It does not add another Qwen adapter: the local model is
invoked through the existing `OllamaAdapter`.

## Confirmed runtime

- Ollama version: `0.32.7`, running on Windows.
- WSL endpoint: `http://127.0.0.1:11434`.
- Model tag: `qwen2.5-coder:7b`.
- Exact digest:
  `dae161e27b0e90dd1856c8bb3209201fd6736d8eb66298e75ed87571486f4364`.
- Quantization: `Q4_K_M`.
- Context length reported by Ollama: 32,768 tokens.
- Acceptance status: **LIMITED**; suitable only for short, low-risk,
  mechanically verifiable work.
- Ollama remains bound to localhost. LAN exposure is prohibited.

The model's advertised context length is not the task allowance. İkiMetr uses
smaller limits to reduce latency, memory pressure, prompt-injection surface, and
unnecessary context disclosure.

## Approaches considered

1. **Configuration-first enablement (selected):** enable the existing,
   already-tested Ollama path through strict provider, budget, pricing, and
   health evidence. This has the smallest production-code surface and preserves
   the Phase 3G.4 boundaries.
2. **Add a second runtime feature-flag layer:** keep configuration enabled but
   introduce another application flag before AiExecutor. This adds duplicate
   state and can create disagreement between policy and runtime, so it is not
   selected.
3. **Enable local AI while adding cloud Qwen support:** this combines unrelated
   trust, credential, pricing, and network boundaries. It is rejected for this
   phase.

## Scope

### In scope

1. Fully configure and enable only `providers.local-ai`.
2. Configure a `LOCAL_ONLY` default budget with conservative finite limits.
3. Record a zero-cost, exact-model local pricing snapshot.
4. Require exact model and digest verification during runtime health checks.
5. Validate configuration and exercise one bounded local acceptance path.
6. Update the handoff with fresh evidence after the phase passes.

### Out of scope

- Enabling DeepSeek, cloud Qwen, Codex API, or Claude API.
- Adding a new provider or adapter.
- Changing CostRouter, AiExecutor, ExecutionCoordinator, invokers, ledger,
  cache, prompt builder, or routing contracts unless a failing contract test
  proves a narrowly scoped defect and a separate corrective exception is
  approved.
- Retry, fallback, provider reselection, streaming, background execution, or
  autonomous tool/shell execution.
- Sensitive or Secret data.
- Production user data, contact data, raw environment values, credentials, or
  PII.
- Automatic acceptance of model-produced code or decisions.
- Network exposure beyond localhost.
- Paid API calls.

## Configuration design

### Provider configuration

The `local-ai` entry in `config/ai-cost/providers.json` becomes:

| Field | Value |
| --- | --- |
| `enabled` | `true` |
| `role` | `local-first-pass` |
| `model` | `qwen2.5-coder:7b` |
| `invocationMode` | `automatic` |
| endpoint type | `ollama` |
| base URL source | `IKIMETR_LOCAL_AI_URL` |
| credential source | `null` |
| allowed data | `public`, `internal` |
| allowed risk | `low` only |
| capabilities | `routine-analysis`, `documentation`, `test-generation` |
| max input | 4,096 tokens |
| max output | 512 tokens |
| max calls/task | 1 |
| max cost/task | 0 AZN |
| timeout | 120,000 ms |
| retries | 0, no retry conditions, no backoff |

All other providers remain disabled and unchanged.

The endpoint value itself stays outside committed configuration:

```text
IKIMETR_LOCAL_AI_URL=http://127.0.0.1:11434
```

Runtime configuration must reject a non-loopback endpoint. The existing
OllamaAdapter must continue to verify the exact model and digest rather than
trusting only the model tag.

### Budget configuration

`config/ai-cost/budgets.json` changes from `NONE` to `LOCAL_ONLY` with
finite limits:

| Limit | Value |
| --- | ---: |
| per-task input | 4,096 tokens |
| per-task output | 512 tokens |
| per-task calls | 1 |
| per-task cost | 0 AZN |
| provider-task input | 4,096 tokens |
| provider-task output | 512 tokens |
| provider-task calls | 1 |
| provider-task cost | 0 AZN |
| provider-day calls | 20 |
| provider-day input | 40,960 tokens |
| provider-day output | 5,120 tokens |
| provider-day cost | 0 AZN |
| provider-month calls | 200 |
| provider-month input | 409,600 tokens |
| provider-month output | 51,200 tokens |
| provider-month cost | 0 AZN |
| cloud calls/task | `null` (not configured) |
| cloud day/month limits | `null` (not configured) |
| retry limits | 0 |
| local wall time/task | 120,000 ms |

Limits are hard ceilings, not usage targets. A missing or exhausted limit
returns STOP; the system must not escalate automatically.

### Pricing configuration

The local pricing snapshot becomes `known` for the exact
`qwen2.5-coder:7b` model with:

- currency `AZN`;
- input, output, cache-read, and cache-write rates all zero;
- a versioned effective/retrieved timestamp;
- source identifying the verified local runtime;
- no cloud pricing changes.

This represents zero provider charge, not zero compute use. Token count, wall
time, call count, and latency remain accounted.

## Execution flow

1. A task is classified before routing.
2. Deterministic tools and verified cache are checked first.
3. Only a request with:
   - budget class `LOCAL_ONLY`;
   - data class `public` or `internal`;
   - risk class `low`;
   - an allowed capability;
   - complete finite budget;
   - healthy exact model/digest evidence;
   may receive a LOCAL decision.
4. AiExecutor passes that unchanged decision to ExecutionCoordinator.
5. LocalInvoker authorizes `LOCAL + local-ai`.
6. OllamaAdapter invokes localhost with bounded parameters.
7. Output is treated as untrusted and accepted only after the task's
   deterministic validation.
8. Any failed gate, timeout, malformed response, digest mismatch, exhausted
   budget, or unavailable runtime stops the route. There is no retry or
   fallback.

## Security and privacy invariants

- `127.0.0.1` only; never `0.0.0.0`, a LAN address, tunnel, or public URL.
- No credentials are required by local Ollama and none are added.
- Secret data never enters prompts, hashes, cache payloads, logs, or accounting.
- Sensitive data remains prohibited for this rollout even though the general
  policy allows a future separately approved isolated-local case.
- Internal context must be minimized through the existing context builder.
- Model output cannot grant permissions, alter authorization, execute commands,
  change configuration, commit code, or mark its own result verified.
- Prompts and source files are not written to accounting logs.
- Exact digest mismatch disables the provider.
- Cloud providers remain disabled; cloud calls must remain zero.

## Failure handling

| Failure | Required result |
| --- | --- |
| Ollama unavailable | STOP; zero fallback calls |
| Endpoint not loopback | configuration/runtime rejection |
| Wrong model or digest | provider unhealthy; STOP |
| Input/output/call/wall-time limit exceeded | budget denial; STOP |
| Disallowed data/risk/capability | policy denial; STOP |
| Timeout or transport error | failed result; no retry |
| Invalid structured output | reject result; no retry |
| Deterministic verification fails | result not accepted; no automatic escalation |

## Testing strategy

All config and unit tests remain network-free. Add or update tests that prove:

1. A complete local provider configuration validates.
2. An enabled but incomplete local provider is rejected.
3. Every cloud provider remains disabled.
4. Default budget is `LOCAL_ONLY` and every applicable limit is finite.
5. Retry limits are zero; cloud budgets are unconfigured and the `LOCAL_ONLY` class cannot authorize cloud.
6. Public/internal + low-risk + allowed capability can route LOCAL when
   health evidence matches.
7. Sensitive, Secret, standard/high risk, and disallowed capabilities stop.
8. Wrong model/digest, unavailable health, or non-loopback endpoint stops.
9. AiExecutor calls the local path at most once.
10. Local failure produces no retry, fallback, or cloud call.
11. Accounting records tokens, latency, wall time, and zero monetary cost.
12. Existing full unit/integration/build baseline remains green.

One real local acceptance test is permitted only after all deterministic tests
pass. It must use a synthetic prompt, fixed output schema, no repository secret
or PII, exact model/digest pinning, and a hard timeout. No cloud acceptance test
belongs to this phase.

## Files expected to change

The implementation plan may authorize only the minimum set selected after
test discovery:

- `config/ai-cost/providers.json`
- `config/ai-cost/budgets.json`
- `config/ai-cost/pricing.json`
- relevant configuration/routing/acceptance tests
- `.env.example` only if the localhost variable is absent
- `docs/ai/AI_COST_SYSTEM_HANDOFF.md` after verification

Production TypeScript is not pre-authorized. Any need to change it is a stop
condition requiring evidence and a narrowly approved corrective exception.

## Definition of Done

- Only local-ai is enabled.
- The exact model and digest are pinned and verified.
- All applicable local limits are finite and fail closed.
- Cloud providers remain disabled and cloud budgets remain unconfigured; observed cloud calls stay zero.
- Sensitive and Secret data are rejected.
- No retry, fallback, provider reselection, tool execution, or paid call exists.
- Config validation, targeted tests, full lint, typecheck, unit tests,
  integration tests, build, secret scan, and scope check pass.
- A bounded synthetic localhost acceptance test passes.
- The handoff records commands, counts, runtime versions, exact digest, known
  limitations, and the next still-disabled phase.
