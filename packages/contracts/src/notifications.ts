import { z } from "zod";
import { TimestampSchema } from "./common.js";

export const NotificationItemSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  body: z.string().nullable(),
  /** App route where the record opens, e.g. "/cases/12". */
  linkPath: z.string().nullable(),
  createdAt: TimestampSchema,
  readAt: TimestampSchema.nullable(),
});

export type NotificationItem = z.infer<typeof NotificationItemSchema>;

export const NotificationsResponseSchema = z.object({
  unreadCount: z.number().int(),
  items: z.array(NotificationItemSchema),
});

export type NotificationsResponse = z.infer<typeof NotificationsResponseSchema>;

export const NotificationReadResultSchema = z.object({
  unreadCount: z.number().int(),
});

export type NotificationReadResult = z.infer<typeof NotificationReadResultSchema>;
