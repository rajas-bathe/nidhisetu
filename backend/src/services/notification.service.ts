import type { NotificationItem, NotificationReadResult, NotificationsResponse } from "@sih26265/contracts";
import { prisma } from "../db/client.js";

export interface CreateNotificationInput {
  userId?: number | null;
  institutionId?: number | null;
  title: string;
  body?: string | null;
  linkPath?: string | null;
}

/**
 * In-app notifications only. Rows start as delivery PENDING (in-app write);
 * the app never claims an email was sent because no email provider exists.
 */
export async function createNotification(input: CreateNotificationInput): Promise<void> {
  await prisma.notification.create({
    data: {
      userId: input.userId ?? undefined,
      institutionId: input.institutionId ?? undefined,
      title: input.title,
      body: input.body ?? undefined,
      linkPath: input.linkPath ?? undefined,
      deliveryStatus: "PENDING",
    },
    select: { id: true },
  });
}

export async function createNotifications(inputs: CreateNotificationInput[]): Promise<void> {
  if (inputs.length === 0) return;
  await prisma.notification.createMany({
    data: inputs.map((input) => ({
      userId: input.userId ?? null,
      institutionId: input.institutionId ?? null,
      title: input.title,
      body: input.body ?? null,
      linkPath: input.linkPath ?? null,
      deliveryStatus: "PENDING" as const,
    })),
  });
}

/** The viewer's inbox: personal notifications plus institution-wide ones. */
export async function listNotifications(
  viewer: { id: number; institutionId: number | null },
  limit = 40,
): Promise<NotificationsResponse> {
  const where = {
    OR: [
      { userId: viewer.id },
      ...(viewer.institutionId != null ? [{ institutionId: viewer.institutionId, userId: null }] : []),
    ],
  };

  const [rows, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
    prisma.notification.count({ where: { ...where, readAt: null } }),
  ]);

  return {
    unreadCount,
    items: rows.map((row) => serializeNotification(row)),
  };
}

export async function markNotificationRead(
  viewer: { id: number; institutionId: number | null },
  notificationId: number,
): Promise<NotificationReadResult> {
  const row = await prisma.notification.findFirst({
    where: {
      id: notificationId,
      OR: [
        { userId: viewer.id },
        ...(viewer.institutionId != null ? [{ institutionId: viewer.institutionId, userId: null }] : []),
      ],
    },
    select: { id: true, readAt: true },
  });

  if (row == null) {
    // Nothing to mark outside the viewer's inbox; the bell simply re-syncs.
    await countUnreadSync(viewer);
  } else if (row.readAt == null) {
    await prisma.notification.update({
      where: { id: row.id },
      data: { readAt: new Date() },
      select: { id: true },
    });
  }

  return countUnreadSync(viewer);
}

export async function markAllNotificationsRead(
  viewer: { id: number; institutionId: number | null },
): Promise<NotificationReadResult> {
  await prisma.notification.updateMany({
    where: {
      readAt: null,
      OR: [
        { userId: viewer.id },
        ...(viewer.institutionId != null ? [{ institutionId: viewer.institutionId, userId: null }] : []),
      ],
    },
    data: { readAt: new Date() },
  });
  return countUnreadSync(viewer);
}

async function countUnreadSync(viewer: { id: number; institutionId: number | null }): Promise<NotificationReadResult> {
  const unreadCount = await prisma.notification.count({
    where: {
      readAt: null,
      OR: [
        { userId: viewer.id },
        ...(viewer.institutionId != null ? [{ institutionId: viewer.institutionId, userId: null }] : []),
      ],
    },
  });
  return { unreadCount };
}

export function serializeNotification(row: {
  id: number;
  title: string;
  body: string | null;
  linkPath: string | null;
  readAt: Date | null;
  createdAt: Date;
}): NotificationItem {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    linkPath: row.linkPath,
    readAt: row.readAt == null ? null : row.readAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}
