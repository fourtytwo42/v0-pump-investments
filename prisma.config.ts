import "dotenv/config"
import { defineConfig } from "prisma/config"

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Generation and static checks do not require a live database.
    url: process.env.DATABASE_URL ?? "postgresql://localhost:5432/pump_investments",
  },
})
