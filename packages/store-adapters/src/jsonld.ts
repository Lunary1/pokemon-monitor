import type { CheerioAPI } from 'cheerio';

/**
 * schema.org availability values we recognise. Anything else — including a
 * missing value — is treated as unparseable rather than guessed at, so a
 * parse failure can never masquerade as "out of stock".
 */
const IN_STOCK_VALUES = new Set([
  'http://schema.org/InStock',
  'https://schema.org/InStock',
  'InStock',
  'http://schema.org/LimitedAvailability',
  'https://schema.org/LimitedAvailability',
  'LimitedAvailability',
  'http://schema.org/PreOrder',
  'https://schema.org/PreOrder',
  'PreOrder',
]);

const OUT_OF_STOCK_VALUES = new Set([
  'http://schema.org/OutOfStock',
  'https://schema.org/OutOfStock',
  'OutOfStock',
  'http://schema.org/SoldOut',
  'https://schema.org/SoldOut',
  'SoldOut',
  'http://schema.org/Discontinued',
  'https://schema.org/Discontinued',
  'Discontinued',
]);

export class JsonLdParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JsonLdParseError';
  }
}

export interface JsonLdProduct {
  name?: string;
  inStock: boolean;
  price: number | null;
  currency: string;
  /** The raw schema.org availability URL, kept for the StockResult. */
  availability: string;
}

interface RawOffer {
  price?: string | number;
  priceCurrency?: string;
  availability?: string;
}

interface RawProduct {
  '@type'?: string | string[];
  name?: string;
  offers?: RawOffer | RawOffer[];
}

function hasProductType(node: unknown): node is RawProduct {
  if (typeof node !== 'object' || node === null) return false;
  const type = (node as RawProduct)['@type'];
  return Array.isArray(type) ? type.includes('Product') : type === 'Product';
}

/** Walk a parsed JSON-LD document (object, array, or @graph) for a Product node. */
function findProductNode(parsed: unknown): RawProduct | null {
  if (Array.isArray(parsed)) {
    for (const entry of parsed) {
      const found = findProductNode(entry);
      if (found) return found;
    }
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) return null;
  if (hasProductType(parsed)) return parsed;

  const graph = (parsed as { '@graph'?: unknown })['@graph'];
  return graph === undefined ? null : findProductNode(graph);
}

/**
 * Extract stock and price from a page's JSON-LD Product markup.
 *
 * Throws JsonLdParseError whenever the data can't be read with confidence.
 * That is deliberate: the previous selector-based implementation collapsed a
 * parse failure into `inStock: false`, making a broken adapter look exactly
 * like a sold-out product (see #86). Callers turn this throw into an
 * `ERROR:`-prefixed StockResult, which is loud and visible.
 */
export function parseProductJsonLd($: CheerioAPI): JsonLdProduct {
  const blocks = $('script[type="application/ld+json"]');
  if (blocks.length === 0) {
    throw new JsonLdParseError('no application/ld+json block found on page');
  }

  let product: RawProduct | null = null;
  for (const el of blocks.toArray()) {
    const raw = $(el).contents().text();
    if (!raw.trim()) continue;
    try {
      const found = findProductNode(JSON.parse(raw));
      if (found) {
        product = found;
        break;
      }
    } catch {
      // A malformed block is not fatal on its own — a page may carry several
      // and only one needs to be a readable Product.
    }
  }

  if (!product) {
    throw new JsonLdParseError('no JSON-LD node with @type Product found');
  }

  const offer = Array.isArray(product.offers) ? product.offers[0] : product.offers;
  if (!offer) {
    throw new JsonLdParseError('Product JSON-LD has no offers');
  }

  const availability = offer.availability;
  if (!availability) {
    throw new JsonLdParseError('Product offer has no availability');
  }

  let inStock: boolean;
  if (IN_STOCK_VALUES.has(availability)) {
    inStock = true;
  } else if (OUT_OF_STOCK_VALUES.has(availability)) {
    inStock = false;
  } else {
    throw new JsonLdParseError(`unrecognised availability value: ${availability}`);
  }

  const parsedPrice =
    offer.price === undefined ? NaN : parseFloat(String(offer.price));

  return {
    name: product.name,
    inStock,
    price: Number.isNaN(parsedPrice) ? null : parsedPrice,
    currency: offer.priceCurrency ?? 'EUR',
    availability,
  };
}
