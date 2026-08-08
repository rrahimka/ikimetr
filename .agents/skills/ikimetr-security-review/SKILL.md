---
name: ikimetr-security-review
description: Reviews IkiMetr changes for authorization, privacy, sensitive contacts, API security, ingestion risks, secrets, admin privileges, file uploads, auditability, and AI safety.
---

# IkiMetr Security Review

Use this skill for any security-sensitive task and before approving security-critical changes.

Default behavior: review first, do not rewrite unrelated code automatically.

## Security principles

IkiMetr follows:

- privacy by default;
- server-side authorization;
- least privilege;
- explicit ownership checks;
- sensitive contact protection;
- auditability;
- rules before AI;
- external data is untrusted;
- frontend is untrusted.

## Authorization review

For every sensitive endpoint or operation verify:

1. Is the user authenticated?
2. Is the role checked server-side?
3. Is resource ownership checked?
4. Is resource-level authorization checked?
5. Can changing an ID expose another user's resource?
6. Is there IDOR/BOLA risk?
7. Is any frontend-supplied user_id, role, owner_id, agency_id or permission trusted incorrectly?

Never treat frontend state as the security boundary.

## Sensitive data review

Pay special attention to:

- owner phone numbers;
- client phone numbers;
- email addresses;
- private realtor notes;
- conversations;
- verification data;
- uploaded documents;
- audit/security records.

Unauthorized users must never receive raw sensitive values in API responses.

Hiding data in CSS or UI code is not access control.

## Owner contact access

Any owner contact reveal must consider:

- explicit permission/policy;
- rate limiting;
- anti-enumeration;
- anti-bulk extraction;
- audit logging;
- account risk;
- valid business justification.

Sensitive contact access should pass through a controlled contact-access boundary.

## Client privacy

A realtor must not automatically receive another realtor's client identity or phone number merely because a Match exists.

Matching and contact disclosure are separate business decisions.

## API security

Review for:

- input validation;
- authorization;
- ownership;
- mass assignment;
- injection;
- direct exposure of internal database models;
- pagination abuse;
- rate limiting;
- predictable object enumeration;
- excessive data responses.

## File security

Review uploads for:

- size limits;
- MIME validation;
- actual file-content validation;
- extension mismatch;
- executable content;
- unsafe filenames;
- metadata leakage;
- public/private storage rules;
- signed URL exposure.

## Ingestion and external content security

External URLs and payloads are untrusted.

Review for:

- SSRF;
- localhost/private-network access;
- arbitrary redirects;
- oversized responses;
- malformed payloads;
- malicious HTML/content;
- adapter isolation;
- scraper credentials;
- cross-source poisoning.

Scrapers must not have unrestricted access to core private data.

## AI security

AI must never directly:

- grant permissions;
- reveal contacts;
- change roles;
- execute arbitrary SQL;
- delete accounts;
- alter ownership;
- perform privileged administrative actions.

Treat AI output as untrusted input and validate it with deterministic application rules.

Review prompt-injection exposure when external listings, messages, files or web content are supplied to an AI model.

## Secrets

Never allow:

- API keys in Git;
- credentials in frontend bundles;
- secrets in logs;
- production passwords in task specs;
- tokens in screenshots or documentation.

Use environment/secrets management.

## Logging and audit

Normal logs must not contain unnecessary personal or secret data.

Sensitive actions should generate audit events when required.

Keep these concepts separate:

- application logs;
- product analytics;
- security events;
- audit events.

## Admin security

Admin routes require explicit permissions.

Do not assume a route is secure because it starts with `/admin`.

Review:

- privilege escalation;
- bulk export;
- private-data access;
- destructive actions;
- impersonation;
- audit trails.

## Database review

For schema and migration changes check:

- ownership relationships;
- foreign keys;
- uniqueness;
- destructive operations;
- accidental public visibility;
- raw PII exposure;
- rollback/migration risk.

## Security output format

Return:

SECURITY REVIEW:

RISK:
LOW | MEDIUM | HIGH | CRITICAL

FINDINGS:
- finding
- finding

AUTHORIZATION:
PASS | FAIL | N/A

PRIVACY:
PASS | FAIL | N/A

DATA EXPOSURE:
PASS | FAIL | N/A

INPUT VALIDATION:
PASS | FAIL | N/A

RATE LIMIT / ABUSE:
PASS | FAIL | N/A

AUDIT:
PASS | FAIL | N/A

AI SECURITY:
PASS | FAIL | N/A

REQUIRED FIXES:
- fix
- fix

VERDICT:
APPROVE | APPROVE WITH FIXES | BLOCK

A security-critical task is not complete while required fixes remain unresolved.