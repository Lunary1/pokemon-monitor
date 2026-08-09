import type { DiscordPayload } from './discord';

const USERNAME = 'PokéMonitor';
const FOOTER_TEXT = 'PokéMonitor • Personal use only';

/** Discord embed colours, per plan §12. */
const COLOR = {
  restock: 5763719, // green
  priceDrop: 16776960, // yellow
} as const;

export interface NotificationProduct {
  name: string;
  url: string;
  imageUrl?: string | null;
  storeName: string;
}

function formatPrice(price: number | null | undefined, currency = 'EUR'): string {
  if (price === null || price === undefined) return '—';
  return new Intl.NumberFormat('en-EU', { style: 'currency', currency }).format(price);
}

/** Discord renders `<t:unix:R>` as a live relative timestamp ("2 minutes ago"). */
function relativeTimestamp(at: Date): string {
  return `<t:${Math.floor(at.getTime() / 1000)}:R>`;
}

export function buildRestockPayload(
  product: NotificationProduct,
  currentPrice: number | null,
  occurredAt: Date,
): DiscordPayload {
  return {
    username: USERNAME,
    embeds: [
      {
        title: '🟢 Back in Stock!',
        description: `**${product.name}** is now available at ${product.storeName}`,
        url: product.url,
        color: COLOR.restock,
        fields: [
          { name: 'Price', value: formatPrice(currentPrice), inline: true },
          { name: 'Store', value: product.storeName, inline: true },
          { name: 'Detected', value: relativeTimestamp(occurredAt), inline: true },
        ],
        ...(product.imageUrl ? { thumbnail: { url: product.imageUrl } } : {}),
        footer: { text: FOOTER_TEXT },
      },
    ],
  };
}

export function buildPriceDropPayload(
  product: NotificationProduct,
  previousPrice: number | null,
  currentPrice: number | null,
  occurredAt: Date,
): DiscordPayload {
  const fields = [
    { name: 'Product', value: product.name, inline: false },
    { name: 'Was', value: formatPrice(previousPrice), inline: true },
    { name: 'Now', value: formatPrice(currentPrice), inline: true },
  ];

  // Only meaningful when both prices are known and the previous one is non-zero.
  if (
    previousPrice !== null &&
    currentPrice !== null &&
    previousPrice > 0 &&
    currentPrice <= previousPrice
  ) {
    const dropPercent = Math.round(((previousPrice - currentPrice) / previousPrice) * 100);
    fields.push({ name: 'Drop', value: `-${dropPercent}%`, inline: true });
  }

  fields.push({ name: 'Detected', value: relativeTimestamp(occurredAt), inline: true });

  return {
    username: USERNAME,
    embeds: [
      {
        title: '💰 Price Drop!',
        description: `**${product.name}** dropped in price at ${product.storeName}`,
        url: product.url,
        color: COLOR.priceDrop,
        fields,
        ...(product.imageUrl ? { thumbnail: { url: product.imageUrl } } : {}),
        footer: { text: FOOTER_TEXT },
      },
    ],
  };
}
