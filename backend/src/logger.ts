import pino from "pino";
import { config } from "./config/env.js";

export const logger = pino({
  level: config.logLevel,
  base: { service: "sih26265-backend" },
  ...(config.logPretty
    ? { transport: { target: "pino-pretty", options: { singleLine: true } } }
    : {}),
  redact: {
    paths: [
      "req.headers.cookie",
      "req.headers.authorization",
      "password",
      "passwordHash",
      "*.password",
      "*.passwordHash",
    ],
    censor: "[redacted]",
  },
});
