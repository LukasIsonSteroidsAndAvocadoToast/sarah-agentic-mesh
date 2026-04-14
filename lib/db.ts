import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prismaMesh?: PrismaClient;
};

export const prisma =
  globalForPrisma.prismaMesh ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prismaMesh = prisma;
}
