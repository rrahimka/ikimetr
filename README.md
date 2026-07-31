# IkiMetr

This repository now includes a structured application foundation with dedicated folders for components, features, services, hooks, types, utilities, and documentation.

## Project Structure
- app/ - Next.js application entry points.
- components/ - Shared UI components.
- features/ - Feature-level modules and domain logic.
- lib/ - Shared libraries and helpers.
- services/ - Application services and integrations.
- hooks/ - Shared hooks.
- types/ - Shared types and interfaces.
- utils/ - Utility functions.
- docs/ - Product and architecture documentation.

## Documentation
- [docs/MASTER_PRODUCT_DOCUMENT.md](docs/MASTER_PRODUCT_DOCUMENT.md)
- [docs/AI_ARCHITECTURE.md](docs/AI_ARCHITECTURE.md)
- [docs/SECURITY_ARCHITECTURE.md](docs/SECURITY_ARCHITECTURE.md)
- [docs/DATABASE_SCHEMA.md](docs/DATABASE_SCHEMA.md)
- [docs/ROADMAP.md](docs/ROADMAP.md)
- [docs/DECISIONS.md](docs/DECISIONS.md)
- [docs/UI_SYSTEM.md](docs/UI_SYSTEM.md)

## Getting Started
Run the development server:

```bash
npm run dev
```

Open http://localhost:3000 to view the application.

## Supabase Setup

This project is prepared for Supabase integration without creating auth or database tables yet.

1. Copy [.env.example](.env.example) to `.env.local`.
2. Add your Supabase project URL and anon key to the environment variables.
3. The database helpers are available in [lib/database/supabase.ts](lib/database/supabase.ts), [lib/database/server.ts](lib/database/server.ts), and [lib/database/client.ts](lib/database/client.ts).

The app remains buildable even before the Supabase values are configured.
