# Dependency Bill of Materials & Governance

Aligned with v4 §78. Only installed packages present in `package.json` and `bun.lock` are listed.

| Package | Declared Version | Purpose | Licence | Owner / Notes |
|---|---|---|---|---|
| `react`, `react-dom` | `^19.0.1` | SPA UI runtime | MIT | Frontend |
| `react-router-dom` | `^7.18.5` | Screen routing & deep links | MIT | Frontend |
| `@tanstack/react-query` | `^5.108.0` | Tenant/branch-keyed server query cache & invalidation | MIT | Frontend |
| `i18next`, `react-i18next` | `^27.1.5` / `^18.0.2` | Reviewed Sinhala (`si-LK`) & English (`en-LK`) UI message catalogues | MIT | Frontend / Language |
| `lucide-react` | `^0.546.0` | Affordance-only UI icons paired with text labels | ISC | Frontend |
| `motion` | `^12.23.24` | Reduced-motion-safe settling transitions | MIT | Frontend |
| `express` | `^4.21.2` | Backend HTTP API server & Vite dev middleware | MIT | Backend (ADR-011) |
| `firebase` | `^13.4.0` | Client Google Sign-In & ID token retrieval | Apache-2.0 | Identity |
| `firebase-admin` | `^14.5.1` | Server-side Firebase ID token verification | Apache-2.0 | Identity / Security |
| `drizzle-orm`, `drizzle-kit` | `^0.45.4` / `^0.31.11` | Type-safe PostgreSQL queries & schema management | Apache-2.0 | Backend / DB |
| `pg`, `@types/pg` | `^8.23.1` | PostgreSQL Object-Method connection pool | MIT | Backend / DB |
| `zod` | `^4.6.7` | Trusted request/response/tool boundary validation | MIT | Backend / Contracts |
| `@google/genai` | `^3.4.0` | Server-side Gemini AI / speech adapter SDK | Apache-2.0 | AI Adapters |
| `dotenv` | `^17.2.3` | Local environment loading | BSD-2-Clause | Runtime |
| `vitest` | `^5.1.0` | Unit, tenant-isolation, and PostgreSQL integration test runner | MIT | QA / Engineering |
| `tailwindcss`, `@tailwindcss/vite` | `^4.3.3` | Utility CSS styling | MIT | Frontend |
| `tsx`, `typescript`, `vite` | `^4.21.0` / `^7.0.2` / `^8.3.0` | TypeScript compilation, runtime, and bundler | MIT / Apache-2.0 | Build |
