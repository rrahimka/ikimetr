# İkiMetr AI Cost Routing Policy

## Status and scope

This document defines the provider-neutral routing, caching, data-protection and
cost-control contract for İkiMetr AI agents. It supplements
[AGENTS.md](../../AGENTS.md). Provider-specific profiles may only narrow it:

- [Codex](../../.agents/provider-profiles/codex.md)
- [Claude](../../.agents/provider-profiles/claude.md)
- [Cheap Cloud AI](../../.agents/provider-profiles/cheap-cloud.md)
- [Local AI](../../.agents/provider-profiles/local-ai.md)

This is an instruction policy, not an AI Gateway, model router or runtime
implementation. Installing or configuring Ollama, another local runtime, cloud
providers or an AI Gateway requires a separate authorized task.

The keywords MUST, MUST NOT, SHOULD and MAY are normative.

## Routing order

Every task starts outside an AI model:

~~~text
Task specification / project documentation / validated cache
  -> Deterministic code and tools
  -> Local AI
  -> Cheap Cloud AI (DeepSeek/Qwen)
  -> Strong AI (Codex/Claude)
~~~

Serena, Context7, Playwright CLI, Sentry, compilers and tests are tools selected
inside the deterministic/tooling stage; they are not model-escalation levels.

Codex is currently the primary development coordinator. Claude is a specialist
strong-model reviewer by default, not a mandatory second implementation model.

## Decision matrix

| Work or question | First route | Required evidence | Escalate when |
| --- | --- | --- | --- |
| Exact transform, matching, deduplication or validation | Code, regex, hash, SQL or schema | Deterministic output/check | The requirement itself is ambiguous |
| Repository location, symbol or call relationship | Serena | Symbol location/references | Relevant code still cannot be identified |
| Current third-party API behavior | Local docs, then Context7 | Versioned primary documentation | Project architecture remains ambiguous |
| Existing behavior or regression | Tests, logs, compiler, diff | Reproduction and current output | Root cause remains unresolved |
| Browser-visible workflow | Lower test layers, then Playwright CLI | Repeatable command and assertions | Failure requires code/architecture analysis |
| Repetitive low-risk classification or summarization | Approved Local AI | Schema validation and sampled checks | Confidence is below the configured gate |
| Boilerplate, mechanical CRUD/DTO/tests/docs | Local AI, then DeepSeek/Qwen | Diff plus deterministic validation | Scope becomes cross-module or ambiguous |
| Architecture-sensitive integration or difficult bug | Codex | Spec, targeted context and tests | Independent high-risk review is justified |
| Security/privacy/threat-model review | Codex, optionally Claude | Threat rules, diff and test evidence | An independent specialist review is required |
| Production incident | Logs/Sentry, then Codex | Minimal incident evidence | Complex security or architecture review is required |

The route MUST stop at the first level that can produce a sufficiently validated
result. Passing to a more expensive level is not a quality ritual.

## No-AI rules

A model call is prohibited when any of the following is true:

1. Deterministic code, project documentation, a schema, SQL, a compiler, a test
   or an existing verified result answers the question adequately.
2. An unchanged request has a valid cache hit.
3. The same provider/model request fingerprint was already executed and there
   is no new evidence, changed input, revised hypothesis or prompt-template
   version.
4. The applicable call, token or monetary budget is missing or exhausted.
5. Input data is not permitted for the proposed provider or runtime.
6. The prompt would contain secrets, credentials, raw env values or unnecessary
   PII.
7. The requested output would be treated as authority for authentication,
   authorization, permissions, ownership, contact disclosure, security policy,
   destructive action or another privileged operation.
8. The purpose is only to compare models, rephrase an already accepted answer
   or obtain reassurance without new verification evidence.

A transport retry MAY reuse the same request only when there is evidence that
inference did not start and no billable result was produced. Record it as a
transport retry, not a new reasoning attempt.

## Tool routing rules

### Serena

Use Serena memories, symbol overview, symbol lookup, references and
implementations before broad source reads. Stop retrieving context once the
relevant boundary is known. Repository-wide reads require a recorded technical
reason.

### Context7

Use Context7 only for uncertain, current and version-specific external-library
behavior. Do not call it when the task specification, project documentation,
local types or installed source already answers the question. Cache documentation
results by library, version, question and source revision where permitted.

### Playwright CLI

Use Playwright CLI for repeatable user workflows after unit, integration and API
checks. Prefer focused assertions and compact machine-readable output. Do not
install Playwright or download browsers unless an authorized task requires it.

### Sentry

Use Sentry only for staging or production diagnostics. Retrieve the minimum
event fields needed; do not copy unrelated user data into prompts or reports.
Sentry evidence cannot define product requirements.

## Model levels

### Local AI

Local AI is the first model tier for low-risk work and may process only data
allowed by the data matrix. Its output MUST pass the same deterministic
validation as cloud output. A runtime is considered local only after a separate
task verifies isolation, persistence, telemetry, model provenance and resource
limits; installation alone is not sufficient.

Until such a runtime is approved, the Local AI tier is unavailable and routing
may proceed to Cheap Cloud only when that route and budget are allowed.

### Cheap Cloud AI

DeepSeek/Qwen-class providers are for well-specified, low-risk and mechanically
verifiable work. They MUST NOT be the sole reviewer for security, authorization,
privacy, schema design, destructive migrations or architecture changes.

### Strong AI

Codex handles core development coordination and architecture-sensitive
implementation. Claude is reserved for justified specialist review, difficult
debugging or high-risk independent analysis. Using both on ordinary work is
prohibited.

## Data and provider classification

Classify data before selecting a tool or model. Minimize data at every level.

| Class | Examples | Permitted processing |
| --- | --- | --- |
| Public | Published docs, public schemas, synthetic examples | Approved tools and providers within budget |
| Internal | Non-public code, architecture notes, test fixtures without PII | Deterministic tools; approved Local AI; approved cloud only when necessary and minimized |
| Sensitive | User/contact data, private notes, conversations, audit/security records, production identifiers | Deterministic tools by default; isolated approved Local AI only with explicit task need; cloud only with explicit authorization, minimization and redaction |
| Secret | Passwords, API keys, tokens, credentials, raw env values, private signing material | Never send to a model; never persist in AI cache or accounting logs |

Raw owner/client contact data MUST NOT be used merely to improve an AI answer.
Synthetic or redacted fixtures SHOULD replace production data. Provider approval
MUST consider retention, training use, telemetry, region and access controls.

Provider profiles may reduce access to a data class but may not expand it.

## Cache specification

### Eligibility

Cache only reusable, non-secret results whose inputs can be safely fingerprinted.
The cache entry MUST record its validation state. An unvalidated model output
MUST NOT be served as an accepted result.

Sensitive results require an explicitly approved encrypted local cache with
access control and retention limits. Secret data is never cacheable.

### Canonicalization and hashing

Use a stable canonical representation: normalized line endings, explicit UTF-8,
stable key ordering for structured data and documented whitespace handling.

Compute:

~~~text
prompt_template_hash = SHA-256(canonical prompt template + template version)

request_fingerprint = SHA-256(
  policy version
  + route class
  + provider and model revision
  + prompt_template_hash
  + canonical task input
  + ordered approved input-content hashes
  + dependency/document versions
  + relevant tool versions
)

result_hash = SHA-256(canonical result)
~~~

Do not place secret values in a hash preimage. Low-entropy secrets remain
guessable even when only their hash is stored.

### Entry metadata

Each entry records:

- request fingerprint and result hash;
- policy, prompt-template, provider and model versions;
- approved input hashes, never raw secret/PII inputs;
- creation time, expiry and validation status;
- validation commands/evidence;
- data class and access scope;
- failure type for a negative cache entry.

Use a single-flight lock or equivalent coordination so concurrent agents do not
issue the same model request.

### Invalidation

Invalidate an entry when any relevant task specification, policy version,
prompt template, input hash, dependency, documentation source, provider/model
revision, tool version, data permission or validation expectation changes.

Successful deterministic results MAY use a durable content-addressed cache.
Model results SHOULD have a risk-appropriate TTL. Failures and uncertain results
MUST use a shorter configurable TTL and must not suppress investigation after
new evidence appears.

## Confidence methodology

Model self-reported confidence is advisory only. Acceptance confidence MUST be
derived from evidence:

1. Hard gates: scope, data permission, schema validity and required security
   invariants. Failure rejects the result.
2. Deterministic evidence: lint, types, tests, executable reproduction, source
   citations and constraint checks.
3. Coverage: proportion of task requirements explicitly verified.
4. Ambiguity: unresolved assumptions, conflicting sources or missing inputs
   reduce confidence.
5. Risk class: higher-risk work requires stronger and independent evidence.

The orchestration configuration MUST provide configurable defaults for:

- accept_threshold_low_risk;
- escalate_threshold;
- human_review_threshold;
- risk-specific overrides.

These numeric thresholds are not finalized by this phase. If thresholds are
missing, no model result is auto-accepted. Authentication, authorization,
privacy, contact disclosure, destructive migrations and privileged AI actions
always require deterministic validation and Codex-level review regardless of
score; Claude or human review may also be required.

## Budget mechanism

Every task uses one budget class:

| Class | Models allowed |
| --- | --- |
| NONE | Deterministic tools only |
| LOCAL_ONLY | Deterministic tools and approved Local AI |
| CHEAP_ALLOWED | Previous levels plus approved DeepSeek/Qwen provider |
| STRONG_ALLOWED | Previous levels plus Codex and justified Claude review |
| INCIDENT_OVERRIDE | Explicitly approved emergency route with full accounting |

The budget source MUST define configurable defaults for each applicable route:

- maximum model calls and retries;
- maximum aggregate input and output tokens;
- maximum context files/bytes;
- maximum monetary cost and currency;
- maximum wall time or local compute allowance;
- who may approve an increase.

No numeric or monetary value in this phase is final. Limits come from
configurable defaults or a complete explicit task budget. Task-specific limits
MAY lower configured defaults; exceeding them requires the configured approval
and a recorded reason. If neither source exists, additional model calls are
disabled rather than unlimited.

Direct human selection of the primary agent authorizes that active session
within platform-enforced limits. It does not authorize secondary providers,
duplicate review calls or budget increases.

Stop before exceeding a hard limit. Do not split a request into smaller calls to
bypass accounting. Price calculation MUST record the pricing snapshot/version
used because provider prices change.

## Accounting contract

Record one minimal event per model attempt:

~~~text
task_id
timestamp
budget_class
route
provider
model_revision
purpose
data_class
request_fingerprint
cache_hit
input_tokens
output_tokens
estimated_cost_and_currency
pricing_version
latency
result_hash
validation_status
escalation_or_retry_reason
~~~

Local inference records tokens, latency and compute allowance even when monetary
cost is zero. Accounting MUST NOT contain full prompts, source files, secrets or
raw PII.

The final task report states the selected route, escalation reason if any, cache
reuse and the available token/cost totals. Do not claim exact cost when the
provider did not expose sufficient usage data; mark it as estimated or unknown.

## Escalation and approval

Escalate only when the current level is insufficient and evidence identifies
why. Valid reasons include unresolved ambiguity, failed deterministic
verification, cross-module architecture impact, security/privacy risk or a
difficult incident after a reproducible lower-cost attempt.

An escalation record MUST include:

- current result and validation evidence;
- the exact unresolved question;
- request fingerprint and relevant hashes;
- why the next level is expected to help;
- remaining budget and required approval.

Expensive-model escalation is prohibited for formatting, boilerplate, ordinary
documentation, reassurance, model comparison, unchanged retries or work already
validated at a cheaper level. Budget exhaustion stops the route unless an
authorized incident override applies.

Security-critical production work requires Codex-level review and may require a
Claude or human review, but that review receives a compact threat-focused packet,
not the whole repository.

## Governance

- [AGENTS.md](../../AGENTS.md) is the concise common contract.
- This document is the detailed provider-neutral policy.
- Provider profiles may specify role and narrower permissions only.
- Numeric budgets, confidence thresholds and approved-provider metadata belong
  to future configuration, not hard-coded policy prose.
- AI Gateway, cost-router runtime, provider setup and Local AI runtime setup are
  explicitly out of scope for this phase.
