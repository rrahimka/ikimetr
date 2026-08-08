# Security Architecture

## Threat priorities
1. Account takeover
2. IDOR/BOLA / authorization bypass
3. Mass scraping of owner/client data
4. Malicious or fake realtor accounts
5. Admin/internal misuse
6. File upload abuse
7. SSRF via external-source tooling
8. Secret leakage
9. Prompt injection / unsafe AI tool use
10. Data loss / failed recovery

## Required controls
- server-side authorization for every protected resource;
- ownership/resource policy checks;
- strong session controls and session revocation;
- rate limiting by endpoint category;
- protected contact-access module;
- audit logging for sensitive access;
- separate security events;
- secrets outside repository;
- secure upload validation;
- outbound URL restrictions for ingestion;
- least-privilege workers and admin roles;
- backups + restore drills;
- dependency/security checks in CI;
- sanitised application logs.

## AI security
AI output is untrusted. It cannot directly execute SQL, reveal contacts, change roles, modify ownership or perform destructive admin actions. External listing text is data, never instructions.

## Admin
Admin is not omnipotent by default. Privileged access to private content should be reason-bound and auditable.

## Contact data
Owner/client contacts are treated as high-value sensitive data. UI hiding is insufficient; unauthorized data must never be included in API response payloads.
