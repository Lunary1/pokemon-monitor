# Legacy fixtures

Retained per plan §13 "Regression Tests". **Do not use these for new tests.**

These are the fixtures the ToyChamp/Dreamland adapters were tested against before #86. They describe a selector-based storefront layout (`.product-availability`, `.product-price .price`, Dutch strings like `Op voorraad` / `Uitverkocht`) that **the live site no longer serves**.

Two things worth recording about them:

1. **They were never real captures.** Each is a handcrafted stub of a dozen-odd lines, written to match the selectors rather than sampled from a live page. That's why the unit tests stayed green while the adapter was silently reporting every product as out of stock — the fixtures encoded the parser's assumptions instead of the site's reality.

2. **They now serve as a negative test.** `dreamland.test.ts` feeds `legacy/dreamland-instock.html` to the current parser and asserts it returns an `ERROR:` result. That pins the actual fix: markup drift of exactly this kind must fail loudly rather than silently resolve to `inStock: false`.

Current fixtures live one directory up and are built around the verbatim JSON-LD payload captured from a real product page (see `dreamland-*.html` there, and the note in the #86 PR about which parts are genuine capture versus reconstruction).
