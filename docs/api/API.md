# API Contract Principles

## Versioning
All public application endpoints live under `/api/v1`.

## Core resource groups
- `/auth/*`
- `/me`
- `/realtors/*`
- `/properties/*`
- `/my/properties/*`
- `/requests/*`
- `/matches/*`
- `/owner-properties/*`
- `/notifications/*`
- `/dashboard`
- `/admin/*`

## API rules
- Validate every payload using schemas.
- Authorize every protected resource server-side.
- Never expose internal/private DB fields accidentally.
- Use stable error codes, not raw stack traces.
- Attach request/correlation IDs.
- Heavy work is queued after the transactional business operation.
- For upload flows, prefer signed upload URLs when appropriate.

## Example request flow
`POST /api/v1/requests`
1. validate payload;
2. authenticate;
3. authorize realtor;
4. save Request in transaction;
5. create `REQUEST_CREATED`/outbox event where required;
6. enqueue matching job;
7. return `201` without waiting for heavy matching.
