import { logger } from '@pokemon-monitor/core';
import { prisma, type StockEvent, type StockEventType } from '@pokemon-monitor/db';
import { sendDiscordWebhook, type DiscordPayload } from './discord';
import {
  buildPriceDropPayload,
  buildRestockPayload,
  type NotificationProduct,
} from './templates';

export { sendDiscordWebhook } from './discord';
export type { DiscordPayload, DiscordEmbed, DiscordSendResult } from './discord';
export { buildRestockPayload, buildPriceDropPayload } from './templates';
export type { NotificationProduct } from './templates';

/** Event types that actually notify. Everything else is recorded as SKIPPED. */
const NOTIFYING_EVENT_TYPES: StockEventType[] = ['RESTOCK', 'PRICE_DROP'];

/** Same product + same event type inside this window is treated as a duplicate. */
const DEDUP_WINDOW_MS = 5 * 60 * 1000;

export type DispatchOutcome = 'SENT' | 'FAILED' | 'SKIPPED';

export interface DispatchResult {
  outcome: DispatchOutcome;
  /** Why it was skipped, for logging and dashboard display. */
  reason?: string;
}

function toNotificationProduct(product: {
  name: string;
  url: string;
  imageUrl: string | null;
  store: { name: string };
}): NotificationProduct {
  return {
    name: product.name,
    url: product.url,
    imageUrl: product.imageUrl,
    storeName: product.store.name,
  };
}

function buildPayload(
  eventType: StockEventType,
  product: NotificationProduct,
  event: StockEvent,
): DiscordPayload {
  if (eventType === 'PRICE_DROP') {
    return buildPriceDropPayload(
      product,
      event.previousPrice,
      event.currentPrice,
      event.occurredAt,
    );
  }
  return buildRestockPayload(product, event.currentPrice, event.occurredAt);
}

/**
 * Turns a persisted StockEvent into a Discord notification, applying the
 * global toggle, deduplication, and per-product cooldown gates first.
 *
 * Every call writes exactly one Notification row recording what happened, and
 * never throws — a dead webhook must not take down the worker's check cycle.
 */
export async function dispatch(event: StockEvent): Promise<DispatchResult> {
  try {
    return await runDispatch(event);
  } catch (err) {
    // Last-resort guard: even a DB failure here must not propagate into the
    // worker loop. There may be no Notification row in this path, so log loudly.
    logger.error(
      { err, eventId: event.id, productId: event.productId },
      'notification dispatch failed unexpectedly',
    );
    return { outcome: 'FAILED', reason: 'unexpected dispatch error' };
  }
}

async function runDispatch(event: StockEvent): Promise<DispatchResult> {
  const product = await prisma.product.findUnique({
    where: { id: event.productId },
    include: { store: { select: { name: true } } },
  });

  if (!product) {
    return recordSkipped(event, {}, 'product not found');
  }

  const notificationProduct = toNotificationProduct(product);
  const payload = buildPayload(event.eventType, notificationProduct, event);
  const payloadJson = payload as unknown as object;

  const settings = await prisma.setting.findFirst();

  if (settings && !settings.notificationsEnabled) {
    return recordSkipped(event, payloadJson, 'notifications globally disabled');
  }

  if (!NOTIFYING_EVENT_TYPES.includes(event.eventType)) {
    return recordSkipped(event, payloadJson, `event type ${event.eventType} does not notify`);
  }

  const duplicate = await prisma.notification.findFirst({
    where: {
      productId: event.productId,
      status: 'SENT',
      createdAt: { gte: new Date(Date.now() - DEDUP_WINDOW_MS) },
      event: { eventType: event.eventType },
    },
    orderBy: { createdAt: 'desc' },
  });

  if (duplicate) {
    return recordSkipped(event, payloadJson, 'duplicate within dedup window');
  }

  const cooldownMs = (settings?.defaultCooldownSecs ?? 3600) * 1000;
  const withinCooldown = await prisma.notification.findFirst({
    where: {
      productId: event.productId,
      status: 'SENT',
      createdAt: { gte: new Date(Date.now() - cooldownMs) },
    },
    orderBy: { createdAt: 'desc' },
  });

  if (withinCooldown) {
    return recordSkipped(event, payloadJson, 'within cooldown window');
  }

  const webhookUrl = settings?.discordWebhookUrl ?? process.env.DISCORD_WEBHOOK_URL ?? null;
  if (!webhookUrl) {
    return recordSkipped(event, payloadJson, 'no Discord webhook configured');
  }

  const result = await sendDiscordWebhook(webhookUrl, payload);

  if (!result.ok) {
    await prisma.notification.create({
      data: {
        productId: event.productId,
        eventId: event.id,
        channel: 'DISCORD',
        status: 'FAILED',
        payload: payloadJson,
        error: result.error ?? 'unknown error',
      },
    });
    logger.warn(
      { eventId: event.id, productId: event.productId, error: result.error },
      'notification send failed',
    );
    return { outcome: 'FAILED', reason: result.error };
  }

  await prisma.notification.create({
    data: {
      productId: event.productId,
      eventId: event.id,
      channel: 'DISCORD',
      status: 'SENT',
      payload: payloadJson,
      sentAt: new Date(),
    },
  });

  logger.info(
    { eventId: event.id, productId: event.productId, eventType: event.eventType },
    'notification sent',
  );
  return { outcome: 'SENT' };
}

async function recordSkipped(
  event: StockEvent,
  payload: object,
  reason: string,
): Promise<DispatchResult> {
  await prisma.notification.create({
    data: {
      productId: event.productId,
      eventId: event.id,
      channel: 'DISCORD',
      status: 'SKIPPED',
      payload,
      error: reason,
    },
  });

  logger.info(
    { eventId: event.id, productId: event.productId, reason },
    'notification skipped',
  );
  return { outcome: 'SKIPPED', reason };
}
