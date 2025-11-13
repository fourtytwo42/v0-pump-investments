import { PrismaClient } from "@prisma/client"

declare global {
  // eslint-disable-next-line no-var -- allow prisma to be cached in development
  var prisma: PrismaClient | undefined
}

export const prisma =
  global.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  })

if (process.env.NODE_ENV !== "production") {
  global.prisma = prisma
}
