import { createApp } from "./app.js";
import { config } from "./config/env.js";
import { logger } from "./logger.js";
import { prisma } from "./db/client.js";

function main(): void {
  const app = createApp();
  const server = app.listen(config.port, () => {
    logger.info(`SIH26265 API listening on port ${config.port} (env: ${config.nodeEnv})`);
  });

  const shutdown = (signal: string) => {
    logger.info(`Received ${signal}; shutting down.`);
    server.close(async () => {
      await prisma.$disconnect();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("unhandledRejection", (reason) => {
    logger.error({ err: reason }, "unhandled_rejection");
  });
  process.on("uncaughtException", (err) => {
    logger.error({ err }, "uncaught_exception");
    process.exit(1);
  });
}

main();
