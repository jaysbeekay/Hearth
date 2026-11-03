// Prisma config for the Docker image's migration step only (see
// docker-entrypoint.sh). The root prisma.config.ts is for development and
// loads .env through dotenv; in the container the environment is already set,
// and the CLI lives in /opt/migrate rather than the app's node_modules.
//
// Paths are absolute because Prisma resolves them relative to this file, which
// sits in /opt/migrate, not /app. docker-entrypoint.sh passes DATABASE_URL as
// an absolute file: URL for the same reason.
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "/app/prisma/schema.prisma",
  migrations: {
    path: "/app/prisma/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
