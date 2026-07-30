import type { PrismaClient } from "@/generated/prisma/client"
import { createPrismaClient } from "@/lib/prisma-client"

declare global {
  var prisma: PrismaClient | undefined
}

export const prisma =
  global.prisma ??
  createPrismaClient("web")

if (process.env.NODE_ENV !== "production") {
  global.prisma = prisma
}
