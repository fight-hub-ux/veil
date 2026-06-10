import "dotenv/config";
import { defineConfig } from "prisma/config";

// Fail fast with an actionable message when the migration connection string is
// missing. The Prisma CLI uses `datasource.url` for migrate/introspect — for
// Neon that is the DIRECT (non-pooled) URL, so we bind DIRECT_URL. Previously a
// missing var surfaced as a cryptic CLI/build error; this names the var, the
// file, and the fix.
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(
      `[prisma.config] Required environment variable ${name} is not set.\n` +
        `  Prisma migrations/introspection need it (Neon ${
          name === "DIRECT_URL" ? "direct/unpooled" : "pooled"
        } connection string).\n` +
        `  Set it in .env locally (see .env.example) or in the deployment env (Vercel project settings).`,
    );
  }
  return value;
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: requireEnv("DIRECT_URL"),
  },
});
