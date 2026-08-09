# Adapter fixtures

Provenance matters here more than in most test suites: the two worst bugs this
project has shipped (#86, #88) both survived a green test suite because the
fixtures encoded what the author *assumed* the store returned rather than what
it actually returns. Record where each fixture came from.

## Shopify (`shopify-*.json`)

Verbatim captures from live `/products/{handle}.js` responses, taken 2026-08-06.
Only reformatting (pretty-printing) was applied — no field was added, removed,
or edited.

| Fixture | Source | Captured state |
|---|---|---|
| `shopify-instock.json` | `tcgreus.nl` — Pokémon TCG Storm Emeralda Japanse Booster Box | `available: true`, single variant, price `18495` |
| `shopify-outofstock.json` | `tcgreus.nl` — One Piece ST35 Starter Deck Rood/zwart Sabo | `available: false`, single variant, price `1495` |
| `shopify-multivariant.json` | `cardstore.nl` — MTG Marvel Super Heroes Collector Commander Deck | 4 variants, genuinely mixed availability `[true, true, true, false]` |

Two properties of this endpoint the fixtures exist to pin, both of which the
pre-#88 handwritten fixtures got wrong:

1. **`available` is present on `.js` and absent on `.json`.** The
   `/products/{handle}.json` detail endpoint omits it entirely (verified on
   `tcgreus.nl`, `pkmwinkel.nl` and `cardstore.nl`). Reading it from there
   yielded `undefined`, which collapsed to `inStock: false` for every product
   on every store.
2. **Prices are integer minor units.** `18495` means €184.95. The `.json`
   endpoint uses decimal strings (`"184.95"`) instead, so a fixture copied from
   the wrong endpoint produces prices off by 100x.

The pre-#88 fixtures are **not** kept under `legacy/`. That directory exists to
preserve a real prior *store* response as a negative regression test; those
files were never real captures, just an incorrect assumption written as JSON.
Keeping them would preserve the misconception rather than a regression. The
regression is pinned directly in `shopify-generic.test.ts` instead, by a test
that feeds a `.json`-shaped payload (no `available` field) to the adapter and
asserts an `ERROR:` result.

## WooCommerce (`woocommerce-*.html`)

Captured from `tcgfanz.nl` (a real WooCommerce storefront) on 2026-08-09. In
each file the `application/ld+json` block and the price/stock paragraphs are
verbatim; the product wrapper, title and summary container reproduce the real
element and class structure, with the surrounding ~200-250KB of theme markup,
scripts and reviews removed.

| Fixture | Source | Captured state |
|---|---|---|
| `woocommerce-instock.html` | Eevee #135 (Twilight Masquerade) | `InStock`, `instock` wrapper class, €2,00, variable product |
| `woocommerce-outofstock.html` | Suicune Pokémon Center Fit Knuffel | `OutOfStock`, `outofstock` wrapper class + `<p class="stock out-of-stock">Uitverkocht</p>`, €24,99 |
| `woocommerce-nojsonld-*.html` | Same two pages, JSON-LD stripped | Stands in for a store with structured data disabled — exercises the `SELECTORS` fallback |

Two things these captures pinned that a handwritten fixture would have missed,
both found by capturing before writing the adapter rather than after:

1. **WooCommerce nests price under `offers[].priceSpecification[]`**, not on the
   offer itself. `parseProductJsonLd` read only `offer.price` and returned
   `price: null` for every WooCommerce product while availability parsed fine —
   the same shape of silent wrongness as #88, just in a non-load-bearing field.
2. **There is no `itemprop="price"` anywhere on the page**, and the price block
   carries a theme-specific class (`p.price.nasa-single-product-price`). The
   selector fallback reads the rendered `.woocommerce-Price-amount` text and its
   currency symbol instead, and parses `€ 24,99` comma-decimal formatting.

Only `nojsonld` variants are derived rather than captured, and they are derived
by deletion only — no markup was added or edited.

## Dreamland (`dreamland-*.html`)

Built around a verbatim JSON-LD payload captured from a real product page; see
the #86 PR for which parts are genuine capture versus surrounding
reconstruction, and `legacy/README.md` for the superseded selector-era stubs.
