import { PrismaClient } from "@prisma/client";
import { config } from "../config/env.js";

/** The per-transaction handle passed into interactive transactions. */
export type PrismaTransactionClient = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

const globalForPrisma = globalThis as unknown as { prismaClient?: PrismaClient };

export const prisma =
  globalForPrisma.prismaClient ??
  new PrismaClient({
    datasources: { db: { url: config.databaseUrl } },
  });

if (!config.isProduction) {
  globalForPrisma.prismaClient = prisma;
}
