# Release Evidence Register

**Rule:** Unexecuted checks MUST remain `NOT TESTED` or `BLOCKED`. Never mark a check `PASS` without recorded command output in this environment.

## Environment
- Workspace: Google AI Studio sandbox (Node.js `v22.23.2`)
- Cloud SQL Instance: `ai-studio-77df7681` (`asia-south1`, project `iir-creations`)
- Auth: Firebase OAuth (`iir-creations`, `firebase-applet-config.json`)

## Executed Checks Log (Combined Clinic + Pharmacy ERP — Clinic Writes + Pharmacy Phase 2)

| Check / Test ID | Scope | Status | Command / Fixture | Recorded Outcome |
|---|---|---|---|---|
| Schema Push & Exclusion Constraint (47 Tables) | 17 clinic + 30 platform/pharmacy/POS/till tables, composite `(tenant_id, id)` FKs, `btree_gist` exclusion `appointments_no_resource_overlap_excl` | `VERIFIED_LOCAL` | `cloudsql.UpdateSchema` + `cloudsql.ExecuteSql` | All 47 tables & `appointments_no_resource_overlap_excl` verified live in PostgreSQL |
| TypeScript Typecheck | Full frontend + backend + domain + DB schema + tests | `VERIFIED_LOCAL` | `tsc --noEmit` (`lint_applet`) | Exited 0, zero type errors |
| Production Bundle Build | Vite SPA build | `VERIFIED_LOCAL` | `vite build` (`compile_applet`) | Exited 0, compiled cleanly |
| Combined Vitest Suite (17 Tests) | Clinic T01 isolation (8/8) + Phase 1 Modular/Inventory (6/6) + Clinic Write Slice & Pharmacy Phase 2 POS/Till/FEFO/Cart-Hash/Returns (3/3) | `VERIFIED_LOCAL` | `npx vitest run --no-file-parallelism` | 3 test files passed, 17/17 tests passed against live Cloud SQL PostgreSQL (69.53s) |
| Live HTTP Smoke Check (Port 3000) | `/`, `/api/v1/health`, `/api/v1/session/context`, `/api/v1/clinic/people`, `/api/v1/pharmacy/pos/sales`, invalid JWT rejection | `VERIFIED_LOCAL` | `curl` against restarted port 3000 server | `/` `200`; `/api/v1/health` `200`; protected endpoints & invalid JWT returned `401 UNAUTHENTICATED` cleanly |
| Interactive Browser Walkthrough (Google Sign-In + UI Flows) | Real Firebase Google sign-in + React click-through on `TodayBoardPage`, `HomeAssistantPage`, `PharmacyPosPage` | `NOT TESTED` | Pending interactive authenticated browser session | Code compiled & dev server restarted with `auth.ts` RS256/ADC fix; browser E2E pending user click-through |
| Phase 4–6 & Clinical Bridge | Combined non-double-counting revenue reports (`U16`, `P17`), stocktake (`P15`), Clinical EHR handoff (`U08–U10`, `U24`), Load/PITR/Hardware (`U20–U23`, `P21–P26`) | `NOT TESTED` / `BLOCKED` | Pending subsequent phases, clinical module & human/device validation | — |
