# Pokémon Product Monitor — Complete Project Plan

> **Personal-use monitoring and checkout-assistance tool**
> Target: EU/Belgian Pokémon TCG stores | Stack: TypeScript · Next.js · Playwright · PostgreSQL

---

## Table of Contents

1. [Scope Definition](#1-scope-definition)
2. [Architecture](#2-architecture)
3. [Tech Stack](#3-tech-stack)
4. [Core Features](#4-core-features)
5. [Monitoring Strategy](#5-monitoring-strategy)
6. [Store Adapter System](#6-store-adapter-system)
7. [Database Design](#7-database-design)
8. [MVP Roadmap](#8-mvp-roadmap)
9. [Development Workflow](#9-development-workflow)
10. [Playwright Usage](#10-playwright-usage)
11. [API Design](#11-api-design)
12. [Notification Design](#12-notification-design)
13. [Testing Strategy](#13-testing-strategy)
14. [Deployment Plan](#14-deployment-plan)
15. [Risks & Maintenance](#15-risks--maintenance)
16. [Feature Prioritization (MoSCoW)](#16-feature-prioritization-moscow)
17. [Final Recommendation](#17-final-recommendation)

---

## 1. Scope Definition

### MVP Inclusions

| Area | Included |
|---|---|
| Stock monitoring | Polling product URLs on a schedule |
| Alert delivery | Discord webhook notification on restock |
| Product tracking | Store product list with last-known stock status |
| Price tracking | Record price per check, detect drops |
| Restock history | Log every in→out and out→in transition |
| Store adapters | At least 2–3 EU stores (ToyChamp, Game Mania, Bol.com) |
| Dashboard | Read-only Next.js page showing product list + status |
| Manual trigger | Button/API endpoint to run a single check now |

### MVP Exclusions

- User authentication / multi-user support
- Mobile push notifications
- Price comparison between stores
- Wish list or "watch list" per user
- Webhook or Telegram integration (Phase 2+)

### Saved for Later

- Store adapter marketplace / plugin loading
- Email digests
- Telegram bot
- Price history charts
- Playwright-assisted cart prefill
- Public-facing API

### What Makes It Too Complex

- Multi-user accounts → adds auth, billing, data isolation
- Full checkout automation → legal grey area, high maintenance, fragile
- Distributed scraping → over-engineering for personal use
- Real-time WebSocket dashboard → unnecessary for a 1-person tool

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Next.js App                       │
│   /dashboard  (read-only)   /api/*  (REST handlers) │
└────────────────────┬────────────────────────────────┘
                     │ HTTP
┌────────────────────▼────────────────────────────────┐
│                  API Layer (tRPC or REST)             │
│  products · stores · checks · notifications · logs   │
└──────┬───────────────────────────┬──────────────────┘
       │                           │
┌──────▼──────┐           ┌────────▼────────┐
│  PostgreSQL  │           │  Monitor Worker │
│  (via Prisma)│           │  (Node cron /   │
│              │           │   BullMQ)       │
└─────────────┘           └────────┬────────┘
                                   │
                    ┌──────────────┼──────────────┐
                    │              │              │
             ┌──────▼──┐   ┌──────▼──┐   ┌──────▼──┐
             │ Adapter  │   │ Adapter  │   │ Adapter  │
             │ToyChamp  │   │GameMania │   │  Bol.com │
             └──────────┘   └──────────┘   └──────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │     Notification Service      │
                    │  Discord · Telegram · Email   │
                    └─────────────────────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │   Playwright Helper (opt.)    │
                    │  Open page · prefill form     │
                    └─────────────────────────────┘
```

### Component Responsibilities

**Next.js App** — Hosts both the dashboard UI and the API routes. Single deployment unit, low overhead for personal use.

**Monitor Worker** — A long-running Node.js process (or separate service) that polls product URLs on a schedule. Uses a simple job queue (BullMQ + Redis) or just `node-cron` without Redis for the simplest setup.

**Store Adapters** — One module per store. Responsible for fetching, parsing, and returning a normalized `StockResult`. The worker calls adapters; adapters know nothing about the database.

**Notification Service** — Receives events from the worker. Handles deduplication, cooldowns, and message formatting before dispatching.

**Playwright Helper** — An optional, manually-triggered module that opens a browser to a product page. Not part of the monitor loop.

---

## 3. Tech Stack

### Recommended Stack

| Layer | Choice | Why |
|---|---|---|
| Language | **TypeScript** everywhere | Single language, great DX, catches bugs early |
| Frontend + API | **Next.js 14 (App Router)** | Collocates UI and API, easy deployment, you probably know it |
| ORM | **Prisma** | Schema-first, migrations built-in, great TS types |
| Database | **PostgreSQL** (local Docker or Supabase) | Relational, solid JSON support, free tiers available |
| Queue | **node-cron** (MVP) → **BullMQ + Redis** (later) | Start simple; upgrade only if you need retries/concurrency |
| HTTP fetching | **got** or **undici** | Lightweight, no browser overhead for simple pages |
| HTML parsing | **cheerio** | Fast, jQuery-like API, no overhead |
| Browser automation | **Playwright** | You know it already; best for JS-rendered pages |
| Notifications | **Discord webhook** first | Zero infra, instant setup |
| Monorepo | **Turborepo** (optional) or flat pnpm workspace | Keeps packages organized without overengineering |
| Containerization | **Docker + Docker Compose** | Consistent local env, easy deploy |
| Hosting | **Railway** or **Fly.io** | Free tiers, Docker-native, simpler than AWS for personal use |
| Logging | **pino** | Structured JSON logs, low overhead |

### Why Not X

- **Puppeteer instead of Playwright** — Playwright has better multi-browser support, built-in network interception, and is actively maintained.
- **Prisma Studio instead of a custom dashboard** — Fine for debugging, but you'll want your own UI to see stock status at a glance.
- **Supabase Realtime** — Overkill for a 1-person tool; simple polling of your own API is fine.
- **Kafka/RabbitMQ** — Far too heavy; BullMQ + Redis is sufficient if you need a queue at all.

---

## 4. Core Features

### 4.1 Store Management

- CRUD for stores (name, base URL, adapter key, polling interval, enabled flag)
- Adapter configuration per store (CSS selectors, API keys if any, custom headers)
- Enable/disable individual stores without deleting

### 4.2 Product Management

- Add products by URL or by search term per store
- Assign a canonical product name (e.g. "Scarlet & Violet Booster Box")
- Tag products (set, type: single/ETB/booster box)
- Enable/disable product monitoring individually

### 4.3 Stock Monitoring

- Scheduled polling at configurable intervals (default: every 5 minutes per product)
- Stores raw result per check: in-stock boolean, price, timestamp
- Detects state transitions: `OUT_OF_STOCK → IN_STOCK` (restock event)
- Consecutive-failure detection before alerting on errors

### 4.4 Price Monitoring

- Records price at each check
- Fires an event when price drops by more than a configurable threshold (e.g. 5%)
- Stores price history; queryable via API

### 4.5 Restock Detection

- A "restock" is defined as: previous check = out of stock, current check = in stock
- Debounced: requires 2 consecutive in-stock results before triggering a notification (reduces false positives)
- Records restock events separately from raw check logs

### 4.6 Notification Rules

- Notify on: restock, price drop, adapter error (after N consecutive failures)
- Per-product cooldown (e.g. don't notify for the same product more than once per hour)
- Global on/off toggle

### 4.7 Checkout Helper / Page Opener

- Manual trigger only (button in dashboard or CLI command)
- Uses Playwright to open the product page in a visible browser window
- Optionally prefills shipping/billing form fields from a config file
- Does not auto-submit, does not auto-add to cart

### 4.8 Logs and Error Tracking

- Every check result is logged (product, store, status, price, HTTP status, duration)
- Adapter errors logged with stack trace
- Retention policy: keep last 30 days of check logs, keep all restock events

### 4.9 Admin Dashboard

- Product list with current stock status (color-coded), last checked time, current price
- Restock event log with timestamps
- Manual check button per product
- Store configuration editor
- Notification settings
- Log viewer (filterable by store / product / severity)

---

## 5. Monitoring Strategy

### Polling Intervals

| Store type | Recommended interval | Reason |
|---|---|---|
| High-traffic limited drops | 2–5 min | Short enough to be useful |
| Regular in-stock items | 10–15 min | Low priority, save bandwidth |
| Stores with public APIs | 5 min | APIs are cheaper to call |
| Sites that return 429 | Back off to 30 min | Respect their rate limits |

Default: **5-minute polling per product URL**. This is well within what any server can handle from a single client making one request every 5 minutes.

### Robots.txt

- On startup, fetch and parse `robots.txt` for each store's domain.
- Cache parsed rules; do not re-fetch more than once per day.
- If a product path is disallowed in `robots.txt`, skip that adapter and log a warning.
- Provide a config override per store: `ignoreRobotsTxt: false` (default false, meaning you always respect it).

### Rate Limit Handling

- Each adapter defines a `minIntervalMs` (minimum time between requests to that domain).
- A per-domain request throttle enforces this globally across all products on that store.
- On HTTP 429: exponential backoff starting at 1 minute, max 30 minutes, log the event.
- On HTTP 503 or connection error: retry after 5 minutes (3 attempts), then mark as degraded.

### Backoff Strategy

```
Attempt 1: immediate
Attempt 2: +1 min
Attempt 3: +5 min
Attempt 4: +15 min
→ Mark adapter as DEGRADED, notify via Discord, pause for 1 hour
→ Auto-resume next scheduled check
```

### Avoiding Unnecessary Requests

- Skip checks for products that are in-stock if you don't care about price changes (configurable).
- Skip checks for products already flagged as permanently discontinued.
- Batch multiple products on the same store into a single HTTP session when possible.

### Detecting Stock Changes

The adapter returns a normalized result:

```ts
interface StockResult {
  inStock: boolean;
  price: number | null;
  currency: string;
  rawText?: string;       // what the page said (for debugging)
  checkedAt: Date;
}
```

The worker compares with the last stored check. A change is `previousInStock !== currentInStock`.

### Handling False Positives

- Require 2 consecutive in-stock results before firing a restock notification.
- Require 3 consecutive out-of-stock results before firing an out-of-stock notification (avoid flapping alerts).
- Log every single check regardless of whether a notification fires.

### Using APIs When Available

- Bol.com: has a Partner API — use it if you have access; otherwise scrape the public product page.
- Shopify stores: `domain.com/products/{handle}.json` returns structured JSON — always prefer this over HTML scraping.
- WooCommerce stores: often expose `?add-to-cart=ID` and REST API at `/wp-json/wc/v3/` (requires auth, but product pages are public).
- Check for `__NEXT_DATA__`, `window.__INITIAL_STATE__`, or embedded JSON-LD on product pages before reaching for CSS selectors.

---

## 6. Store Adapter System

### TypeScript Interface

```ts
// packages/store-adapters/src/types.ts

export interface StockResult {
  inStock: boolean;
  price: number | null;
  currency: string;
  title?: string;         // product title as seen on page (for validation)
  availability?: string;  // raw availability string (e.g. "Op voorraad")
  rawHtml?: string;       // optional: raw snippet around the stock element
  checkedAt: Date;
}

export interface CheckOptions {
  timeoutMs?: number;      // default: 10_000
  userAgent?: string;      // default: set per adapter
}

export interface AdapterConfig {
  storeKey: string;        // unique key, e.g. "toychamp"
  storeName: string;       // "ToyChamp"
  baseUrl: string;         // "https://www.toychamp.be"
  productUrlPattern: string; // "https://www.toychamp.be/products/{slug}"
  minIntervalMs: number;   // minimum ms between requests to this domain
  defaultTimeoutMs: number;
  respectRobotsTxt: boolean;
  customHeaders?: Record<string, string>;
}

export interface StoreAdapter {
  config: AdapterConfig;

  /**
   * Normalize a raw product URL to the canonical form for this store.
   * Strips tracking params, ensures HTTPS, etc.
   */
  normalizeUrl(url: string): string;

  /**
   * Check stock and price for a single product URL.
   * Should NOT throw — return an error result instead.
   */
  checkProduct(url: string, options?: CheckOptions): Promise<StockResult>;

  /**
   * Optional: search the store for a product by keyword.
   * Returns candidate URLs.
   */
  searchProducts?(query: string): Promise<string[]>;

  /**
   * Return the add-to-cart URL or null if not supported / not allowed.
   */
  getAddToCartUrl?(productUrl: string): string | null;

  /**
   * Health check: fetch the store homepage and return true if reachable.
   */
  healthCheck(): Promise<boolean>;

  /**
   * Self-test: check a known in-stock product and a known out-of-stock product.
   * Used in regression tests.
   */
  selfTest?(): Promise<{ pass: boolean; notes: string }>;
}
```

### Example: ToyChamp Adapter

```ts
// packages/store-adapters/src/adapters/toychamp.ts

import * as cheerio from 'cheerio';
import got from 'got';
import type { StoreAdapter, AdapterConfig, StockResult, CheckOptions } from '../types';

export class ToyChampAdapter implements StoreAdapter {
  config: AdapterConfig = {
    storeKey: 'toychamp',
    storeName: 'ToyChamp',
    baseUrl: 'https://www.toychamp.be',
    productUrlPattern: 'https://www.toychamp.be/{path}',
    minIntervalMs: 10_000,        // 10s between requests
    defaultTimeoutMs: 12_000,
    respectRobotsTxt: true,
    customHeaders: {
      'Accept-Language': 'nl-BE,nl;q=0.9',
    },
  };

  normalizeUrl(url: string): string {
    const u = new URL(url);
    // Strip tracking params
    ['utm_source', 'utm_medium', 'utm_campaign', 'ref'].forEach(p => u.searchParams.delete(p));
    return u.toString();
  }

  async checkProduct(url: string, options?: CheckOptions): Promise<StockResult> {
    const checkedAt = new Date();
    try {
      const response = await got(url, {
        timeout: { request: options?.timeoutMs ?? this.config.defaultTimeoutMs },
        headers: {
          'User-Agent': options?.userAgent ?? 'Mozilla/5.0 (personal stock monitor)',
          ...this.config.customHeaders,
        },
        followRedirect: true,
      });

      const $ = cheerio.load(response.body);

      // ToyChamp typically shows a button or text for availability
      // Adjust selectors when the site updates
      const stockText = $('.product-availability, .stock-status, [data-stock]').first().text().trim();
      const priceText = $('.product-price .price, [data-price]').first().text().trim();

      const inStock = /op voorraad|in stock|beschikbaar/i.test(stockText)
        && !/niet beschikbaar|uitverkocht|out of stock/i.test(stockText);

      const price = parseFloat(priceText.replace(/[^0-9,]/g, '').replace(',', '.')) || null;

      return { inStock, price, currency: 'EUR', availability: stockText, checkedAt };
    } catch (err: any) {
      // Return a "failed" result rather than throwing
      return {
        inStock: false,
        price: null,
        currency: 'EUR',
        availability: `ERROR: ${err.message}`,
        checkedAt,
      };
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      await got(this.config.baseUrl, { timeout: { request: 5_000 } });
      return true;
    } catch {
      return false;
    }
  }

  getAddToCartUrl(_productUrl: string): string | null {
    return null; // Not supported in MVP
  }
}
```

### Shopify Adapter (Generic)

Shopify stores expose `products/{handle}.json` — use this over HTML scraping:

```ts
// packages/store-adapters/src/adapters/shopify-generic.ts

async checkProduct(url: string): Promise<StockResult> {
  const handle = extractShopifyHandle(url); // parse from URL
  const apiUrl = `${this.config.baseUrl}/products/${handle}.json`;
  const { body } = await got(apiUrl, { responseType: 'json' });
  const product = (body as any).product;
  const variant = product.variants[0]; // or find the right variant
  return {
    inStock: variant.available,
    price: parseFloat(variant.price),
    currency: 'EUR',
    title: product.title,
    checkedAt: new Date(),
  };
}
```

### Adapter Registry

```ts
// packages/store-adapters/src/index.ts

import { ToyChampAdapter } from './adapters/toychamp';
import { ShopifyGenericAdapter } from './adapters/shopify-generic';
import type { StoreAdapter } from './types';

const registry = new Map<string, StoreAdapter>([
  ['toychamp', new ToyChampAdapter()],
  ['shopify-generic', new ShopifyGenericAdapter()],
  // add more here
]);

export function getAdapter(storeKey: string): StoreAdapter {
  const adapter = registry.get(storeKey);
  if (!adapter) throw new Error(`No adapter found for store key: ${storeKey}`);
  return adapter;
}

export { registry };
```

---

## 7. Database Design

Using **Prisma** schema syntax (maps directly to PostgreSQL tables).

```prisma
// packages/db/prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ─── Stores ──────────────────────────────────────────────────────────────────

model Store {
  id              String    @id @default(cuid())
  key             String    @unique          // "toychamp", "shopify-generic"
  name            String                     // "ToyChamp"
  baseUrl         String
  adapterKey      String                     // references adapter registry
  enabled         Boolean   @default(true)
  pollingInterval Int       @default(300)    // seconds
  minIntervalMs   Int       @default(10000)  // enforced per-domain throttle
  customHeaders   Json?                      // stored as JSON object
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  products        Product[]
  adapterConfig   AdapterConfig?
}

model AdapterConfig {
  id        String  @id @default(cuid())
  storeId   String  @unique
  store     Store   @relation(fields: [storeId], references: [id], onDelete: Cascade)
  config    Json    // arbitrary adapter-specific config (selectors, API keys, etc.)
}

// ─── Products ─────────────────────────────────────────────────────────────────

model Product {
  id              String    @id @default(cuid())
  storeId         String
  store           Store     @relation(fields: [storeId], references: [id])
  name            String                          // "Scarlet & Violet Booster Box"
  url             String                          // canonical product URL
  imageUrl        String?
  tags            String[]  @default([])          // ["booster-box", "sv"]
  enabled         Boolean   @default(true)
  trackPrice      Boolean   @default(true)
  notifyOnRestock Boolean   @default(true)
  notifyOnDrop    Boolean   @default(false)
  priceDrop       Float?                          // threshold % for price drop notify
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  checks          StockCheck[]
  events          StockEvent[]
  notifications   Notification[]

  @@unique([storeId, url])
}

// ─── Stock Checks (raw log of every poll) ────────────────────────────────────

model StockCheck {
  id            String    @id @default(cuid())
  productId     String
  product       Product   @relation(fields: [productId], references: [id])
  inStock       Boolean
  price         Float?
  currency      String    @default("EUR")
  availability  String?   // raw text from page
  httpStatus    Int?
  durationMs    Int?
  error         String?
  checkedAt     DateTime  @default(now())

  @@index([productId, checkedAt(sort: Desc)])
}

// ─── Stock Events (transitions only) ─────────────────────────────────────────

model StockEvent {
  id            String          @id @default(cuid())
  productId     String
  product       Product         @relation(fields: [productId], references: [id])
  eventType     StockEventType  // RESTOCK, OUT_OF_STOCK, PRICE_DROP, PRICE_INCREASE
  previousPrice Float?
  currentPrice  Float?
  occurredAt    DateTime        @default(now())

  notifications Notification[]
}

enum StockEventType {
  RESTOCK
  OUT_OF_STOCK
  PRICE_DROP
  PRICE_INCREASE
  ADAPTER_ERROR
}

// ─── Notifications ────────────────────────────────────────────────────────────

model Notification {
  id          String             @id @default(cuid())
  productId   String?
  product     Product?           @relation(fields: [productId], references: [id])
  eventId     String?
  event       StockEvent?        @relation(fields: [eventId], references: [id])
  channel     NotificationChannel
  status      NotificationStatus @default(PENDING)
  payload     Json               // the message payload sent
  sentAt      DateTime?
  error       String?
  createdAt   DateTime           @default(now())
}

enum NotificationChannel {
  DISCORD
  TELEGRAM
  EMAIL
}

enum NotificationStatus {
  PENDING
  SENT
  FAILED
  SKIPPED          // deduplicated / cooldown
}

// ─── User Settings ────────────────────────────────────────────────────────────

model Setting {
  id                   String   @id @default(cuid())
  discordWebhookUrl    String?
  telegramBotToken     String?
  telegramChatId       String?
  emailAddress         String?
  notificationsEnabled Boolean  @default(true)
  defaultCooldownSecs  Int      @default(3600)  // 1 hour
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt
}

// ─── Error Log ────────────────────────────────────────────────────────────────

model ErrorLog {
  id          String   @id @default(cuid())
  source      String   // "worker", "adapter:toychamp", "notification"
  level       LogLevel @default(ERROR)
  message     String
  stack       String?
  context     Json?
  occurredAt  DateTime @default(now())
}

enum LogLevel {
  INFO
  WARN
  ERROR
}
```

---

## 8. MVP Roadmap

### Phase 1 — Basic Product Monitor (Week 1–2)

**Goal:** A Node.js script that polls one store and logs stock status to PostgreSQL.

| Item | Detail |
|---|---|
| Deliverables | Working ToyChamp adapter, Prisma schema, cron loop, console output |
| Difficulty | Low |
| Effort | ~8h |
| Dependencies | None |
| Risks | Selectors break; mitigate with `rawHtml` logging |

Tasks:
- Set up pnpm monorepo with `packages/db`, `packages/store-adapters`, `workers/monitor`
- Write Prisma schema and run first migration
- Implement ToyChamp adapter
- Write monitor worker that loops over enabled products and calls adapter
- Store every `StockCheck` row in the database
- Detect transitions and write `StockEvent` rows

---

### Phase 2 — Notifications (Week 2–3)

**Goal:** Discord webhook fires on restock.

| Item | Detail |
|---|---|
| Deliverables | `packages/notifications`, Discord integration, cooldown logic, deduplication |
| Difficulty | Low |
| Effort | ~6h |
| Dependencies | Phase 1 |
| Risks | Notification spam during testing; use a test webhook channel |

Tasks:
- Create `packages/notifications` with a `NotificationService` class
- Implement Discord webhook sender
- Add cooldown check (query last `Notification` for this product within cooldown window)
- Trigger notification from worker on `RESTOCK` event
- Save `Notification` row for every dispatch attempt

---

### Phase 3 — Dashboard (Week 3–4)

**Goal:** A Next.js page that shows all products and their current status.

| Item | Detail |
|---|---|
| Deliverables | `apps/web`, product list page, restock event log, basic settings page |
| Difficulty | Medium |
| Effort | ~12h |
| Dependencies | Phase 1, Phase 2 |
| Risks | UI scope creep; keep it read-only at first |

Tasks:
- Bootstrap `apps/web` with Next.js App Router
- API routes: `GET /api/products`, `GET /api/events`, `GET /api/settings`
- Product list component (status badge, last checked, price)
- Restock event timeline
- Settings form (Discord URL, cooldown, enable/disable)
- Manual check button (calls `POST /api/products/:id/check`)

---

### Phase 4 — Store Adapter Abstraction (Week 4–5)

**Goal:** A generic adapter system so adding a new store takes < 1 hour.

| Item | Detail |
|---|---|
| Deliverables | Adapter registry, ShopifyGeneric adapter, WooCommerce adapter, store config UI |
| Difficulty | Medium |
| Effort | ~10h |
| Dependencies | Phase 1 |
| Risks | Over-abstracting; keep adapters as simple classes, not a plugin system |

Tasks:
- Finalize `StoreAdapter` TypeScript interface
- Extract ToyChamp to use the interface
- Implement ShopifyGeneric adapter (JSON API first)
- Implement WooCommerce adapter (HTML fallback)
- Add `robots.txt` checker utility
- Store adapter config in `AdapterConfig` table; load on startup

---

### Phase 5 — Playwright-Assisted Flows (Week 5–6)

**Goal:** Manual-trigger browser flows (open page, prefill form).

| Item | Detail |
|---|---|
| Deliverables | `packages/playwright-helper`, "Open in browser" button in dashboard |
| Difficulty | Medium |
| Effort | ~8h |
| Dependencies | Phase 3 |
| Risks | Playwright version drift; pin the version |

Tasks:
- Create `packages/playwright-helper`
- Implement `openProductPage(url)` — headful browser, navigates to page
- Implement `prefillCheckoutForm(config)` — fills shipping fields from local config (no submit)
- Expose via API endpoint: `POST /api/playwright/open`
- Wire up button in dashboard

---

### Phase 6 — Hardening, Logs, Retries, Deployment (Week 6–8)

**Goal:** Production-ready for personal 24/7 use.

| Item | Detail |
|---|---|
| Deliverables | Docker Compose, error log UI, retry logic, health endpoint, Railway deploy |
| Difficulty | Medium |
| Effort | ~12h |
| Dependencies | All phases |
| Risks | Secrets in env files; use `.env.local` and Railway secrets |

Tasks:
- Add exponential backoff retry to monitor worker
- Implement `ErrorLog` writes from all error paths
- Add `/api/health` endpoint
- Build log viewer in dashboard
- Write `docker-compose.yml` for local dev (Next.js + PostgreSQL + Redis if needed)
- Write `Dockerfile` for production
- Deploy to Railway; configure environment variables
- Set up PostgreSQL automated backups (Railway or manual `pg_dump` cron)

---

## 9. Development Workflow

### Repository Structure

```
pokemon-monitor/
├── apps/
│   └── web/                    # Next.js app (dashboard + API routes)
│       ├── app/
│       │   ├── (dashboard)/
│       │   │   ├── page.tsx
│       │   │   ├── products/
│       │   │   ├── events/
│       │   │   ├── logs/
│       │   │   └── settings/
│       │   └── api/
│       │       ├── products/
│       │       ├── stores/
│       │       ├── events/
│       │       ├── notifications/
│       │       ├── playwright/
│       │       └── health/
│       └── components/
│           ├── ProductCard.tsx
│           ├── StatusBadge.tsx
│           └── EventTimeline.tsx
│
├── packages/
│   ├── db/                     # Prisma schema + generated client
│   │   ├── prisma/
│   │   │   └── schema.prisma
│   │   └── src/
│   │       └── index.ts        # re-exports PrismaClient
│   │
│   ├── store-adapters/         # One file per store
│   │   ├── src/
│   │   │   ├── types.ts
│   │   │   ├── index.ts        # adapter registry
│   │   │   └── adapters/
│   │   │       ├── toychamp.ts
│   │   │       ├── shopify-generic.ts
│   │   │       ├── woocommerce.ts
│   │   │       └── bol.ts
│   │   └── __tests__/
│   │       ├── toychamp.test.ts
│   │       └── shopify-generic.test.ts
│   │
│   ├── notifications/          # Notification dispatchers
│   │   └── src/
│   │       ├── index.ts
│   │       ├── discord.ts
│   │       ├── telegram.ts
│   │       └── templates.ts
│   │
│   ├── playwright-helper/      # Browser automation helpers
│   │   └── src/
│   │       ├── index.ts
│   │       ├── open-page.ts
│   │       └── prefill-form.ts
│   │
│   └── core/                   # Shared utilities
│       └── src/
│           ├── logger.ts       # pino setup
│           ├── robots.ts       # robots.txt checker
│           ├── throttle.ts     # per-domain request throttle
│           └── retry.ts        # exponential backoff utility
│
├── workers/
│   └── monitor/                # Long-running worker process
│       └── src/
│           ├── index.ts        # entry point, starts cron/queue
│           ├── job-runner.ts   # runs a single check for a product
│           └── scheduler.ts   # sets up polling schedule
│
├── docker-compose.yml
├── Dockerfile.web
├── Dockerfile.worker
├── .env.example
├── pnpm-workspace.yaml
└── turbo.json                  # optional, for Turborepo
```

### Naming Conventions

| Context | Convention | Example |
|---|---|---|
| Files | kebab-case | `shopify-generic.ts` |
| Classes | PascalCase | `ToyChampAdapter` |
| Functions | camelCase | `checkProduct()` |
| Database tables | snake_case (Prisma maps) | `stock_check` |
| Env variables | UPPER_SNAKE_CASE | `DISCORD_WEBHOOK_URL` |
| Adapter keys | kebab-case | `shopify-generic` |
| API routes | REST style | `/api/products/:id/checks` |

### Maintainability Guidelines

- **One adapter = one file.** No shared mutable state between adapters.
- **Adapters never import from `packages/db`.** They return data; workers persist it.
- **All selector strings in a `SELECTORS` constant at the top of the adapter file.** Easy to find and update when the site changes.
- **Every adapter has at least one unit test with a mocked HTML fixture.**
- **Never hardcode polling intervals in code.** Always read from the database `Store.pollingInterval`.

---

## 10. Playwright Usage

### Where Playwright Fits

| Use Case | Allowed | Notes |
|---|---|---|
| Opening a product page in a visible browser | ✅ | Manual trigger only |
| Prefilling a checkout form from saved config | ✅ | No auto-submit |
| Scraping a page that requires JavaScript rendering | ✅ | When `got` + `cheerio` won't work |
| Testing your own Next.js dashboard | ✅ | E2E tests, standard practice |

### Safe Helper Flow: Open Product Page

```ts
// packages/playwright-helper/src/open-page.ts

import { chromium } from 'playwright';

export async function openProductPage(url: string): Promise<void> {
  // headful: true — user sees the browser and stays in control
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  // Do not close the browser — the user takes over from here
  // Browser will close when the user closes the window
}
```

### Safe Helper Flow: Prefill Checkout Form

```ts
// packages/playwright-helper/src/prefill-form.ts

import { chromium } from 'playwright';
import type { CheckoutConfig } from './types';

export async function prefillCheckoutForm(
  cartUrl: string,
  config: CheckoutConfig,
): Promise<void> {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  await page.goto(cartUrl);

  // Wait for shipping form
  await page.waitForSelector('input[name="firstName"]', { timeout: 15_000 });

  // Fill fields — adjust selectors per store
  if (config.firstName) await page.fill('input[name="firstName"]', config.firstName);
  if (config.lastName)  await page.fill('input[name="lastName"]',  config.lastName);
  if (config.email)     await page.fill('input[name="email"]',     config.email);
  if (config.address1)  await page.fill('input[name="address1"]',  config.address1);
  if (config.city)      await page.fill('input[name="city"]',      config.city);
  if (config.zip)       await page.fill('input[name="zip"]',       config.zip);

  // INTENTIONALLY do not click submit — user reviews and submits manually
  console.log('Form prefilled. Please review and complete the checkout manually.');
}
```

### Safe Helper Flow: JS-Rendered Stock Check

Use Playwright **only** as a fallback when `got` returns unusable HTML (SPA-rendered stock status):

```ts
// Inside an adapter, as a fallback:
async checkWithPlaywright(url: string): Promise<StockResult> {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: 'networkidle' });
    const stockText = await page.textContent('.product-availability') ?? '';
    const priceText = await page.textContent('.product-price') ?? '';
    // ... parse and return
  } finally {
    await browser.close();
  }
}
```

> **Note:** Launching a browser for every stock check is expensive. Use this only when the HTML adapter consistently returns empty data, and consider caching the result for longer.

---

## 11. API Design

All routes live in `apps/web/app/api/`. Using Next.js Route Handlers (App Router).

### Products

```
GET    /api/products                    List all products with latest status
POST   /api/products                    Add a new product
GET    /api/products/:id                Get single product detail
PATCH  /api/products/:id                Update product settings
DELETE /api/products/:id                Delete product
GET    /api/products/:id/checks         Get stock check history (paginated)
GET    /api/products/:id/events         Get stock events for product
POST   /api/products/:id/check          Trigger a manual stock check (runs immediately)
```

### Stores

```
GET    /api/stores                      List all configured stores
POST   /api/stores                      Add a store
GET    /api/stores/:id                  Get store + adapter config
PATCH  /api/stores/:id                  Update store settings
DELETE /api/stores/:id                  Delete store (and its products)
POST   /api/stores/:id/health           Run health check on this store's adapter
```

### Events

```
GET    /api/events                      List all stock events (paginated, filterable)
GET    /api/events/:id                  Get single event detail
```

### Notifications

```
GET    /api/notifications               List sent/failed notifications
PATCH  /api/settings                    Update notification settings (webhook URL, cooldown)
POST   /api/notifications/test          Send a test Discord message
```

### Playwright Helpers

```
POST   /api/playwright/open             Open a URL in a visible browser { url }
POST   /api/playwright/prefill          Open cart + prefill form { cartUrl, config }
```

### System

```
GET    /api/health                      Returns worker status, DB connection, last check time
GET    /api/logs                        View error logs (paginated, filterable by source/level)
DELETE /api/logs                        Purge logs older than N days
```

### Example Request/Response

```jsonc
// POST /api/products
{
  "storeId": "clx123",
  "name": "Scarlet & Violet Booster Box",
  "url": "https://www.toychamp.be/pokemon-sv-booster-box",
  "tags": ["booster-box", "sv"],
  "notifyOnRestock": true,
  "trackPrice": true
}

// 201 Created
{
  "id": "clxabc",
  "storeId": "clx123",
  "name": "Scarlet & Violet Booster Box",
  "url": "https://www.toychamp.be/pokemon-sv-booster-box",
  "enabled": true,
  "latestCheck": null,
  "createdAt": "2025-01-01T00:00:00.000Z"
}
```

---

## 12. Notification Design

### Discord Webhook Message (Restock)

```jsonc
// POST https://discord.com/api/webhooks/{id}/{token}
{
  "username": "PokéMonitor",
  "avatar_url": "https://raw.githubusercontent.com/.../pokeball.png",
  "embeds": [{
    "title": "🟢 Back in Stock!",
    "description": "**Scarlet & Violet Booster Box** is now available at ToyChamp",
    "url": "https://www.toychamp.be/pokemon-sv-booster-box",
    "color": 5763719,
    "fields": [
      { "name": "Price",      "value": "€54.99", "inline": true },
      { "name": "Store",      "value": "ToyChamp", "inline": true },
      { "name": "Detected",   "value": "<t:1700000000:R>", "inline": true }
    ],
    "thumbnail": { "url": "https://cdn.toychamp.be/image.jpg" },
    "footer": { "text": "PokéMonitor • Personal use only" }
  }]
}
```

### Discord Message (Price Drop)

```jsonc
{
  "embeds": [{
    "title": "💰 Price Drop!",
    "color": 16776960,
    "fields": [
      { "name": "Product",    "value": "Elite Trainer Box SV", "inline": false },
      { "name": "Was",        "value": "€49.99", "inline": true },
      { "name": "Now",        "value": "€39.99", "inline": true },
      { "name": "Drop",       "value": "-20%", "inline": true }
    ]
  }]
}
```

### Notification Service Design

```ts
// packages/notifications/src/index.ts

interface NotificationEvent {
  type: 'RESTOCK' | 'PRICE_DROP' | 'OUT_OF_STOCK' | 'ADAPTER_ERROR';
  product?: Product;
  event?: StockEvent;
}

class NotificationService {
  async dispatch(evt: NotificationEvent): Promise<void> {
    // 1. Check if notifications are globally enabled
    // 2. Check cooldown for this product (query last Notification within cooldown window)
    // 3. Check deduplication (same event type + product within 5 minutes = skip)
    // 4. Build payload using template
    // 5. Send to configured channels
    // 6. Write Notification row with status
  }
}
```

### Cooldown Logic

```ts
const lastNotification = await db.notification.findFirst({
  where: {
    productId: product.id,
    status: 'SENT',
    createdAt: { gte: new Date(Date.now() - cooldownMs) },
  },
  orderBy: { createdAt: 'desc' },
});

if (lastNotification) {
  await db.notification.create({ data: { ...payload, status: 'SKIPPED' } });
  return; // Don't send
}
```

---

## 13. Testing Strategy

### Unit Tests — Store Adapters

Every adapter gets a fixture file: a snapshot of the product page HTML at a known state (in-stock and out-of-stock). Tests parse the fixture using the adapter's `checkProduct` logic.

```ts
// packages/store-adapters/__tests__/toychamp.test.ts

import { ToyChampAdapter } from '../src/adapters/toychamp';
import fs from 'fs';
import path from 'path';

// Intercept `got` using nock or vi.mock
vi.mock('got');

test('detects in-stock product', async () => {
  const html = fs.readFileSync(path.join(__dirname, 'fixtures/toychamp-instock.html'), 'utf-8');
  mockedGot.mockResolvedValue({ body: html, statusCode: 200 });

  const adapter = new ToyChampAdapter();
  const result = await adapter.checkProduct('https://www.toychamp.be/fake-product');

  expect(result.inStock).toBe(true);
  expect(result.price).toBeGreaterThan(0);
});

test('detects out-of-stock product', async () => {
  const html = fs.readFileSync(path.join(__dirname, 'fixtures/toychamp-outofstock.html'), 'utf-8');
  mockedGot.mockResolvedValue({ body: html, statusCode: 200 });

  const adapter = new ToyChampAdapter();
  const result = await adapter.checkProduct('https://www.toychamp.be/fake-product');

  expect(result.inStock).toBe(false);
});

test('returns error result on network failure without throwing', async () => {
  mockedGot.mockRejectedValue(new Error('Connection timeout'));

  const adapter = new ToyChampAdapter();
  const result = await adapter.checkProduct('https://www.toychamp.be/fake-product');

  expect(result.inStock).toBe(false);
  expect(result.availability).toContain('ERROR');
});
```

### Integration Tests — Backend

Test the full flow: create a product → trigger a check → verify the DB row.

```ts
// apps/web/__tests__/integration/product-check.test.ts

test('POST /api/products/:id/check stores a StockCheck row', async () => {
  const product = await createTestProduct(); // factory helper
  const res = await fetch(`/api/products/${product.id}/check`, { method: 'POST' });
  expect(res.status).toBe(200);

  const check = await db.stockCheck.findFirst({ where: { productId: product.id } });
  expect(check).not.toBeNull();
});
```

### E2E Tests — Dashboard (Playwright)

```ts
// apps/web/e2e/dashboard.spec.ts

test('product list shows status badges', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Scarlet & Violet Booster Box')).toBeVisible();
  await expect(page.getByRole('status')).toHaveCount(greaterThan(0));
});
```

### Regression Tests — Layout Changes

When a store updates their HTML and an adapter breaks:
1. Fetch the current live page, save as new fixture.
2. Update the selector constants in the adapter.
3. Re-run the unit tests — they should pass with the new fixture.
4. Keep the old fixture as a `legacy/` fixture with a comment explaining when the layout changed.

### Health Checks

- `/api/health` returns HTTP 200 with `{ worker: 'running', db: 'ok', lastCheck: '...' }`
- Use a lightweight uptime monitor (UptimeRobot free tier) to ping `/api/health` every 5 minutes
- Alert you via email/Telegram if the endpoint goes down

---

## 14. Deployment Plan

### Local Development

```yaml
# docker-compose.yml
version: '3.9'
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_USER: pokemon
      POSTGRES_PASSWORD: pokemon
      POSTGRES_DB: pokemon_monitor
    ports: ["5432:5432"]
    volumes: ["postgres_data:/var/lib/postgresql/data"]

  redis:           # Only needed if using BullMQ
    image: redis:7-alpine
    ports: ["6379:6379"]

  web:
    build: { context: ., dockerfile: Dockerfile.web }
    environment:
      DATABASE_URL: postgresql://pokemon:pokemon@db:5432/pokemon_monitor
    ports: ["3000:3000"]
    depends_on: [db]

  worker:
    build: { context: ., dockerfile: Dockerfile.worker }
    environment:
      DATABASE_URL: postgresql://pokemon:pokemon@db:5432/pokemon_monitor
    depends_on: [db]

volumes:
  postgres_data:
```

```bash
# Start everything locally
docker compose up -d
pnpm prisma migrate dev
```

### Environment Variables

```env
# .env.example
DATABASE_URL=postgresql://pokemon:pokemon@localhost:5432/pokemon_monitor
REDIS_URL=redis://localhost:6379        # optional
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
TELEGRAM_BOT_TOKEN=                    # optional
TELEGRAM_CHAT_ID=                      # optional
PLAYWRIGHT_ENABLED=true
LOG_LEVEL=info
POLL_INTERVAL_OVERRIDE=                # override all polling to N seconds (dev only)
```

### Production Deployment (Railway)

1. Push to GitHub
2. Create Railway project → Deploy from GitHub
3. Add PostgreSQL plugin → Railway injects `DATABASE_URL`
4. Deploy `web` service (Dockerfile.web) and `worker` service (Dockerfile.worker) as separate Railway services
5. Set all env variables in Railway dashboard (never in code)
6. Enable Railway's automatic deployments on push to `main`

**Estimated monthly cost (personal use):** Free tier or ~$5/month on Railway Hobby plan.

### Alternative: Fly.io

Similar to Railway. Use `fly.toml` for config. Slightly more control over regions.

### Backups

```bash
# Manual backup (add to cron or Railway scheduled task)
pg_dump $DATABASE_URL | gzip > backup_$(date +%Y%m%d).sql.gz
```

Railway Pro plan includes automated backups. For Hobby: run a weekly `pg_dump` script as a cron job.

---

## 15. Risks & Maintenance

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Store changes HTML layout | High | Medium | CSS selectors isolated per adapter; snapshot fixtures catch breaks; monitor adapter error count |
| False positives (fake restock) | Medium | Low | Require 2 consecutive in-stock results; debounce notifications |
| Notification spam | Medium | Low | Cooldown per product; deduplication; global disable toggle |
| Checkout flow fragility | High (if built) | Low | Keep checkout helper as manual-trigger only; it's an assistant, not an automator |
| Overengineering | High | High | MVP first; no plugin marketplace, no multi-user, no real-time WebSockets until you actually need them |
| Worker crashes silently | Medium | Medium | Health endpoint + UptimeRobot alert; pino structured logs with error level |
| Database grows unbounded | Low | Low | Log retention policy: delete `StockCheck` rows older than 30 days; keep `StockEvent` rows forever |

---

## 16. Feature Prioritization (MoSCoW)

### Must-Have (MVP)

- Stock polling for at least 2 stores
- Restock detection (state transition logic)
- Discord webhook notification on restock
- PostgreSQL storage of check history
- Simple product list dashboard (read-only)
- Manual check trigger

### Should-Have (Phase 2–4)

- Price tracking and price-drop notifications
- Store adapter abstraction with adapter registry
- Notification cooldowns and deduplication
- Log viewer in dashboard
- Store/product enable/disable toggles
- Shopify JSON API adapter

### Could-Have (Phase 5–6)

- Playwright page opener (manual trigger)
- Checkout form prefill helper
- Telegram notification channel
- Price history chart in dashboard
- robots.txt auto-parser
- Retry/backoff UI (show retry count in dashboard)
- Health check page

### Won't-Have

- Mobile app
- Browser extension

---

## 17. Final Recommendation

### The Simplest Useful MVP

A Node.js cron worker that polls 2–3 product URLs every 5 minutes, detects stock changes, and sends a Discord message when something comes back in stock. A minimal Next.js page shows the current status of all tracked products.

**That's it. Ship that first.**

---

### First 10 Development Tasks

```
1.  Init pnpm monorepo with packages/db, packages/store-adapters, workers/monitor
2.  Write Prisma schema (Store, Product, StockCheck, StockEvent) + first migration
3.  Implement ToyChampAdapter (got + cheerio, returns StockResult)
4.  Write unit test for ToyChampAdapter with HTML fixtures (in-stock + out-of-stock)
5.  Write monitor worker: cron loop → load products from DB → call adapter → save StockCheck
6.  Add StockEvent creation logic: detect RESTOCK transitions
7.  Implement packages/notifications with Discord webhook sender
8.  Wire notifications into worker: fire on RESTOCK with cooldown check
9.  Bootstrap apps/web (Next.js) with /api/products and a basic product list page
10. Add POST /api/products/:id/check for manual trigger + wire up button in dashboard
```

---

### Recommended Tech Stack (Final)

| Layer | Choice |
|---|---|
| Language | TypeScript |
| Frontend + API | Next.js 14 (App Router) |
| Database | PostgreSQL via Prisma |
| Fetching | got |
| HTML parsing | cheerio |
| Scheduling | node-cron (MVP) |
| Browser automation | Playwright (manual helper only) |
| Notifications | Discord webhook (primary) |
| Logging | pino |
| Containerization | Docker Compose (local) |
| Hosting | Railway |
| Testing | Vitest + Playwright |

---

### High-Level Timeline

| Week | Milestone |
|---|---|
| 1 | Monorepo setup + DB schema + ToyChamp adapter + unit tests |
| 2 | Monitor worker + restock detection + Discord notifications |
| 3 | Next.js dashboard (read-only) + manual trigger API |
| 4 | Adapter abstraction + Shopify adapter + WooCommerce adapter |
| 5 | Playwright helpers (open page + prefill) |
| 6 | Price tracking + price-drop notifications |
| 7 | Hardening: retries, error logs, log viewer in dashboard |
| 8 | Docker Compose + Railway deployment + health monitoring |

---

### What to Avoid Building Early

- ❌ A plugin system for adapters — simple class-per-file is enough for years
- ❌ A queue system (BullMQ/Redis) — `node-cron` is fine until you have 50+ products
- ❌ Authentication — it's your personal tool
- ❌ Real-time WebSockets — refresh a page instead
- ❌ Telegram/email notifications — Discord alone is sufficient for v1
- ❌ Playwright for every adapter — HTML scraping is faster and cheaper; use Playwright only as a last resort
- ❌ A "settings" database table before you've shipped the monitor — hardcode defaults first, extract later
- ❌ Price history charts before you have a week of price data

---

*Document version 1.0 — Generated for personal-use Pokémon monitor project*
