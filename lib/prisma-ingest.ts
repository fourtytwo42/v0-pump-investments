import { createPrismaClient } from "@/lib/prisma-client"

export const prisma = createPrismaClient("ingester")
