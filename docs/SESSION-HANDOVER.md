# VEIL — Session Handover

_Last updated: end of Session 1 (2026-06-10)._

VEIL is a **consent + rights protocol for synthetic likeness**. It is
**license-only by construction**: this codebase governs WHO may use a licensed
likeness, for WHAT, WHERE, WHEN, and under what terms — it must **never** contain
or enable generation. API-first: the enforcement core is a clean service; the
registry UI will be its first client.

`~/projects/veil-reference` is read-only Powder-era pattern reference (brand
assets only — do not copy code from it).

---

## Status at handover

| Area | State |
| --- | --- |
| Scaffold (Next 16 / React 19 / App Router / TS) | ✅ committed |
| Prisma 7 schema + migration 1 (applied to Neon) | ✅ committed + deployed |
| Enforcement core (service layer) | ✅ committed, 37/37 tests green |
| API routes | ❌ not started |
| Registry UI | ❌ not started |
| Runtime PrismaClient consumed by an app surface | ❌ only `lib/db.ts` exists |

Commits this session (all on `origin/main`):

1. `chore: scaffold Next.js app, pnpm/corepack toolchain, and brand assets`
2. `feat(db): modality-agnostic Prisma schema and initial migration`
3. `feat(enforcement): grant lifecycle + default-deny scope evaluation`

---

## Run it

```bash
corepack pnpm install          # corepack pnpm exclusively; pnpm@11.5.1 pinned

npx tsc --noEmit               # typecheck gate (run before every commit)
npx vitest run                 # full enforcement test sweep — 37 tests, all passing
```

`npx vitest run` exercises the enforcement core against the **real Neon dev DB**
(see "Tests" below). Expect ~40s wall time (network latency), 37 tests.

Database / migrations:

```bash
npx prisma migrate status      # should report "Database schema is up to date!"
npx prisma migrate deploy      # apply pending migrations (prod-gated in build)
```

---

## Environment

`.env` (gitignored; see `.env.example` for the documented shape):

- `DATABASE_URL` — Neon **pooled** (`-pooler` host). Used by the runtime client
  (`lib/db.ts`) via the Neon driver adapter.
- `DIRECT_URL` — Neon **direct/unpooled**. Used by the Prisma CLI for migrations
  (bound in `prisma.config.ts`).

Both are required. Missing either now fails fast with an actionable message
(naming the var + where to set it) rather than a cryptic build/CLI error.

> Note: the Neon credentials were shared in plaintext during setup — **rotate the
> Neon password** when convenient.

---

## Architecture notes (Prisma 7 specifics that bite)

- Generator is **`prisma-client`** (Rust-free), output `lib/generated/prisma`
  (gitignored, regenerated on install/build). Import from
  `@/lib/generated/prisma/client` — **not** `@prisma/client`. `client.ts`
  re-exports all enums.
- The `datasource` block holds **only** `provider`. Connection URLs live in
  `prisma.config.ts` (CLI) and the driver adapter (runtime).
- Runtime requires a **driver adapter**: `lib/db.ts` uses `@prisma/adapter-neon`
  over the pooled URL, as a `server-only` dev-global singleton.
- `prisma migrate diff` flag is `--to-schema` (not `--to-schema-datamodel`).
- `tsconfig` target is **ES2020** (bigint literals for `priceMicros`).

---

## Enforcement core (`lib/enforcement/`)

Service layer only — no UI, no routes. **Default-deny throughout**; a scope
decision is never a bare boolean. Public API via `lib/enforcement/index.ts`:

- `issueGrant(input)` → validates all scope fields coherent, creates **DRAFT**.
  Activation is a separate call.
- `activateGrant(grantId, actor)` → runs the exclusivity conflict check, then
  DRAFT→ACTIVE.
- `evaluateScope(check)` → `{ allowed, grantId?, reasons: DenyReason[],
  hardExclusions? }`. ALLOW cites the grant; DENY enumerates the **complete** set
  of failed conditions. `hardExclusions` surfaced verbatim (uninterpreted in v1).
  Audited on every call (ALLOW + DENY).
- `revokeGrant(grantId, reason, actor)` → idempotent (re-revoke = no-op +
  `GRANT_REVOKE_NOOP`).
- `supersedeGrant(oldId, newInput)` → pointer-only; old row never mutated, then
  evaluates DENY `SUPERSEDED`.

**Exclusivity** (decided this session): EXCLUSIVE and SOLE share identical
conflict mechanics in v1 — two overlapping grants conflict unless **both** are
NON_EXCLUSIVE; SOLE's holder-self-use reservation has no schema representation
yet (recorded as intent). The check is **symmetric**: activating any grant is
refused if it overlaps an existing ACTIVE EXCLUSIVE/SOLE grant.

---

## Tests

`vitest` against the **real Neon dev DB** (not mocked — the logic *is* query
logic: array containment, the `supersededBy` check, the overlap join). Config:
`fileParallelism: false`, each test truncates + seeds, `server-only` aliased to a
no-op stub, `.env` loaded via `dotenv/config`.

Coverage: every DENY reason individually; open-grant + unverified-licensee deny;
supersession invalidation; exclusivity refusal in both directions plus
no-false-positive cases; audit rows asserted on all paths.

Leftover test rows persist in `neondb` between runs (cleared by each test's
`beforeEach`). Proper isolation (per-test schema/branch) is a TODO.

---

## Suggested next steps

1. **API routes** over the enforcement core (issue/activate/evaluate/revoke/
   supersede) — the core is route-agnostic and ready to wrap.
2. **Test isolation** — move off the shared dev DB (dedicated test branch or
   per-run schema) before the suite grows.
3. **Registry UI** as the first API client.
4. Rotate the Neon password.

Conventions, commit style (Conventional Commits, **no AI attribution**), and the
full decision history are in the repo and in the agent memory index.
