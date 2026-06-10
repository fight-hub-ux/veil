#!/usr/bin/env node
/**
 * Run `prisma migrate deploy` ONLY on Vercel PRODUCTION builds.
 *
 * Vercel sets VERCEL_ENV to "production" | "preview" | "development" on every
 * build. Preview/branch builds (and local builds, where VERCEL_ENV is unset)
 * MUST NOT migrate the database — a preview build whose DATABASE_URL happens to
 * be bound to the prod Neon branch would otherwise apply migrations to
 * production. This guard makes that env-var binding non-load-bearing: even if a
 * non-production build points at prod, it will not migrate.
 *
 * `prisma generate` and `next build` still run on every build (see the `build`
 * script) — only `migrate deploy` is gated here.
 *
 * Node (not an inline shell `if`) so the guard is cross-platform and free of
 * package.json quote-escaping. `prisma` resolves via node_modules/.bin, which
 * the package-manager script context puts on PATH (inherited by this child).
 * execFileSync (no shell) — the command is a fixed literal with no interpolated
 * input, so there is no injection surface.
 */
import { execFileSync } from 'node:child_process';

const env = process.env.VERCEL_ENV ?? '(unset — local/non-Vercel)';

if (process.env.VERCEL_ENV === 'production') {
  console.log('[migrate-prod] VERCEL_ENV=production → running `prisma migrate deploy`');
  execFileSync('prisma', ['migrate', 'deploy'], { stdio: 'inherit' });
} else {
  console.log(`[migrate-prod] Skipping \`prisma migrate deploy\` (VERCEL_ENV=${env}) — only production builds migrate.`);
}
