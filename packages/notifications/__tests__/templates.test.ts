import { describe, expect, test } from 'vitest';
import { buildPriceDropPayload, buildRestockPayload } from '../src/templates';

const occurredAt = new Date('2026-01-01T12:00:00.000Z');

const product = {
  name: 'Scarlet & Violet Booster Box',
  url: 'https://www.toychamp.be/pokemon-sv-booster-box',
  imageUrl: null,
  storeName: 'ToyChamp',
};

function fieldValue(fields: { name: string; value: string }[], name: string) {
  return fields.find((field) => field.name === name)?.value;
}

describe('buildRestockPayload', () => {
  test('builds a restock embed with price, store, and product link', () => {
    const payload = buildRestockPayload(product, 54.99, occurredAt);
    const embed = payload.embeds[0];

    expect(embed.title).toContain('Back in Stock');
    expect(embed.url).toBe(product.url);
    expect(embed.description).toContain(product.name);
    expect(fieldValue(embed.fields, 'Store')).toBe('ToyChamp');
    expect(fieldValue(embed.fields, 'Price')).toContain('54.99');
  });

  test('renders an em dash when the price is unknown', () => {
    const payload = buildRestockPayload(product, null, occurredAt);

    expect(fieldValue(payload.embeds[0].fields, 'Price')).toBe('—');
  });

  test('includes a thumbnail only when the product has an image', () => {
    expect(buildRestockPayload(product, 10, occurredAt).embeds[0].thumbnail).toBeUndefined();

    const withImage = buildRestockPayload(
      { ...product, imageUrl: 'https://cdn.example/img.jpg' },
      10,
      occurredAt,
    );
    expect(withImage.embeds[0].thumbnail).toEqual({ url: 'https://cdn.example/img.jpg' });
  });

  test('formats Detected as a Discord relative timestamp', () => {
    const payload = buildRestockPayload(product, 10, occurredAt);

    expect(fieldValue(payload.embeds[0].fields, 'Detected')).toBe(
      `<t:${Math.floor(occurredAt.getTime() / 1000)}:R>`,
    );
  });
});

describe('buildPriceDropPayload', () => {
  test('shows the was/now prices and the drop percentage', () => {
    const payload = buildPriceDropPayload(product, 49.99, 39.99, occurredAt);
    const fields = payload.embeds[0].fields;

    expect(payload.embeds[0].title).toContain('Price Drop');
    expect(fieldValue(fields, 'Was')).toContain('49.99');
    expect(fieldValue(fields, 'Now')).toContain('39.99');
    expect(fieldValue(fields, 'Drop')).toBe('-20%');
  });

  test('omits the drop percentage when a price is unknown', () => {
    const payload = buildPriceDropPayload(product, null, 39.99, occurredAt);

    expect(fieldValue(payload.embeds[0].fields, 'Drop')).toBeUndefined();
  });

  test('omits the drop percentage rather than dividing by zero', () => {
    const payload = buildPriceDropPayload(product, 0, 0, occurredAt);

    expect(fieldValue(payload.embeds[0].fields, 'Drop')).toBeUndefined();
  });

  test('omits the drop percentage when the price went up', () => {
    const payload = buildPriceDropPayload(product, 10, 20, occurredAt);

    expect(fieldValue(payload.embeds[0].fields, 'Drop')).toBeUndefined();
  });
});
