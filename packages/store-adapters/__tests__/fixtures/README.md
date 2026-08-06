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

## Dreamland (`dreamland-*.html`)

Built around a verbatim JSON-LD payload captured from a real product page; see
the #86 PR for which parts are genuine capture versus surrounding
reconstruction, and `legacy/README.md` for the superseded selector-era stubs.
