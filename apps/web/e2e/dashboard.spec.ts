import { expect, test } from '@playwright/test';

test('user can navigate the dashboard and trigger a manual check', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/products$/);
  await expect(page.getByRole('heading', { name: 'Products' })).toBeVisible();

  const productCard = page.getByTestId('product-card').filter({ hasText: 'E2E Booster Box' });
  await expect(productCard.getByText('In stock', { exact: false })).toBeVisible();

  await page.getByRole('link', { name: 'Events' }).click();
  await expect(page).toHaveURL(/\/events$/);
  await expect(page.getByRole('heading', { name: 'Events' })).toBeVisible();

  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

  await page.getByRole('link', { name: 'Products' }).click();
  await expect(page).toHaveURL(/\/products$/);

  const checkButton = page.getByRole('button', { name: /check now/i });
  await expect(checkButton).toBeVisible();
  await checkButton.click();
  // The seeded product points at a non-live URL, so the adapter check itself
  // fails — this asserts the manual-trigger wiring works end to end, not
  // that stock scraping against a real store succeeds (that's out of scope
  // for a UI E2E test and would make the suite depend on a live third party).
  await expect(page.getByRole('button', { name: /failed — retry/i })).toBeVisible();
});
