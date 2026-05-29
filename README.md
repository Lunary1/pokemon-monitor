# Pokemon Monitor

Personal-use Pokemon TCG stock monitor for EU stores.

This project tracks selected Pokemon TCG product pages, records stock and price
checks, and sends alerts when monitored products come back in stock. The initial
target is a small private monitor for Belgian and EU stores, starting with a
TypeScript/Node.js worker, PostgreSQL storage, and a simple dashboard later.

## Phase 1

- Set up a pnpm monorepo with database, store adapter, and monitor worker packages.
- Implement a ToyChamp stock adapter using lightweight HTTP fetching and HTML parsing.
- Persist stock checks and stock transition events in PostgreSQL.

## Intended Use

This is for personal monitoring only. It should respect store rate limits,
robots.txt, and avoid automated checkout or CAPTCHA bypass workflows.
