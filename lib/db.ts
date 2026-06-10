import "server-only";

import { PrismaNeon } from "@prisma/adapter-neon";

import { PrismaClient } from "@/lib/generated/prisma/client";

// Prisma 7 is Rust-free and connects through a driver adapter. We use the Neon
// serverless adapter against the POOLED connection (DATABASE_URL, the `-pooler`
// host) — the right choice for serverless/Fluid Compute where many short-lived
// invocations share Neon's connection pool. Migrations use the DIRECT url via
// prisma.config.ts; that is a separate concern from this runtime client.

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url || url.trim() === "") {
    throw new Error(
      "[lib/db] DATABASE_URL is not set. Add the POOLED Neon connection string " +
        "to .env locally (see .env.example) or to the deployment environment " +
        "(Vercel project settings).",
    );
  }
  return url;
}

const adapter = new PrismaNeon({ connectionString: requireDatabaseUrl() });

// Reuse a single client across hot-reloads in dev so we don't exhaust the pool
// with a new client per module reload. In production each instance gets one.
const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma: PrismaClient =
  globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
