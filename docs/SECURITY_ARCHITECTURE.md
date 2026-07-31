# Security Architecture

## Core Controls
- Keep environment variables and secrets out of source control.
- Validate and sanitize all external input.
- Apply least-privilege access patterns to services and integrations.

## Recommended Practices
- Use server-side secrets management.
- Enforce authentication and authorization at the boundary.
- Review dependencies and keep them current.
- Log security-relevant events without exposing sensitive data.
