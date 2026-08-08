# Security Rules for Coding Agents

NEVER trust authorization decisions from frontend.
NEVER trust `user_id`, role or ownership supplied by client payload.
NEVER expose owner/client private contacts without a domain policy check.
NEVER log passwords, tokens, secrets or full sensitive contacts.
NEVER commit credentials or `.env` secrets.
NEVER return raw database entities when they contain internal/private fields.
NEVER execute AI output as privileged instructions.
NEVER allow a worker broader database access than its task requires.
ALWAYS validate inputs before domain logic.
ALWAYS enforce ownership/permission server-side.
ALWAYS audit sensitive data reveal and privileged administrative access.
ALWAYS add authorization tests for new protected resources.
