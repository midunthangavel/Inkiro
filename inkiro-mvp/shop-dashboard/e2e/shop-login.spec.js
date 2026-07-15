import { test, expect } from '@playwright/test';

/**
 * End-to-end login flow against a LIVE backend + Supabase.
 *
 * Requires:
 *   - Backend running on :3000 (NODE_ENV=development so OTP returns in response)
 *   - Seeded shop user: phone 9876540002
 *
 * The dev OTP is auto-filled by the Login page, so we only have to click Verify.
 */
test.describe('Shop dashboard — authenticated login', () => {
  test('seeded shop owner logs in and reaches an authenticated view', async ({ page }) => {
    await page.goto('/');

    // Phone step
    await page.getByPlaceholder(/98765/).fill('9876540002');
    await page.getByRole('button', { name: /send otp/i }).click();

    // OTP step — dev_otp is auto-filled; just verify
    const verify = page.getByRole('button', { name: /^verify/i });
    await expect(verify).toBeVisible({ timeout: 10_000 });
    await expect(verify).toBeEnabled();
    await verify.click();

    // Seeded shop has a profile → we should land on the Dashboard.
    // If the shop profile was wiped, the app routes to RegisterShop instead.
    await expect(
      page.getByRole('heading', {
        name: /Incoming orders|Register your shop|Set up your shop/i,
      })
    ).toBeVisible({ timeout: 15_000 });
  });

  test('invalid phone length is rejected client-side', async ({ page }) => {
    await page.goto('/');
    await page.getByPlaceholder(/98765/).fill('12345');
    await page.getByRole('button', { name: /send otp/i }).click();

    await expect(page.getByText(/valid 10-digit phone/i)).toBeVisible();
    // Still on the phone step — no OTP boxes
    await expect(page.getByRole('button', { name: /^verify/i })).toHaveCount(0);
  });
});
