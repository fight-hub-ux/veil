import "dotenv/config";
import { defineConfig, env } from "prisma/config";

// Prisma 7 configuration. The CLI uses `datasource.url` for migrations and
// introspection — for Neon that is the DIRECT (non-pooled) connection, so we
// bind it to DIRECT_URL. The application's runtime client connects through a
// driver adapter using the pooled DATABASE_URL (wired in the service layer).
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("DIRECT_URL"),
  },
});
