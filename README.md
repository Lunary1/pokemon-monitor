# Pokemon Monitor

Personal-use Pokemon TCG stock monitor for EU stores.

This project tracks selected Pokemon TCG product pages, records stock and price
checks, and sends alerts when monitored products come back in stock. The initial
target is a small private monitor for Belgian and EU stores, starting with a
TypeScript/Node.js worker, PostgreSQL storage, and a simple dashboard later.

## Phase 1

- Set up a npm monorepo with database, store adapter, and monitor worker packages.
- Implement a Dreamland stock adapter using lightweight HTTP fetching and HTML parsing.
- Persist stock checks and stock transition events in PostgreSQL.

## Database

`packages/db` owns the Prisma schema, migrations, and a `PrismaClient` singleton
(`@pokemon-monitor/db`) built on the `@prisma/adapter-pg` driver adapter. All
commands below run from the repo root and load `DATABASE_URL` from the root `.env`:

- `npm run db:migrate` — apply migrations locally (creates a new migration if the
  schema changed).
- `npm run db:generate` — regenerate the Prisma Client into `packages/db/generated/`.
- `npm run db:seed --workspace @pokemon-monitor/db` — seed a few demo rows.
- `npm run db:verify --workspace @pokemon-monitor/db` — connect and read once,
  printing a clear success/failure result.

To point `DATABASE_URL` at a Prisma Postgres database instead of local Docker
Postgres, run `npx prisma postgres link --database <ID>` from `packages/db`
with your own Prisma account — this is a one-time manual step per developer and
must never be run in CI or committed anywhere (see `.env.example`).

Prisma Client is server-only: import `@pokemon-monitor/db` from route handlers,
server components, and scripts, never from a `"use client"` component.

## Intended Use

This is for personal monitoring only. It should respect store rate limits,
robots.txt, and avoid automated checkout or CAPTCHA bypass workflows.
