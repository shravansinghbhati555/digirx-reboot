import { test, expect } from '@playwright/test';

/**
 * Golden-path smoke: covers the routes the average operator hits during a
 * working day. We deliberately stop short of the full clinical flow
 * (encounter → prescription → bill → payment) until the FE has stable
 * `data-testid` hooks — those flows live behind multi-step modals whose
 * selectors are fragile against text changes.
 *
 * What this test DOES verify today:
 *   - Login lands on the dashboard.
 *   - Each top-level screen renders without runtime errors.
 *   - A new patient can be registered and appears in the list.
 *
 * What's still TODO (covered by hand in QA — see PR description):
 *   - Book TIME appointment, check-in, sign encounter, issue + pay bill.
 *   - Issue refund via credit note, then void parent bill.
 *
 * If `E2E_SKIP_GOLDEN=1`, the suite is skipped — useful when running unit
 * tests on a machine without docker-compose up.
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@digirx.local';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'Admin@123';

test.describe('golden path (smoke)', () => {
  test.skip(
    process.env.E2E_SKIP_GOLDEN === '1',
    'E2E_SKIP_GOLDEN=1 — skipping (no backend / docker-compose available)',
  );

  test.beforeEach(async ({ page }) => {
    // Hard-clear localStorage so a previous run's saved devContext doesn't
    // bypass the login flow we want to exercise.
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
  });

  test('login → dashboard → patients → register new patient', async ({ page }) => {
    // 1. Login
    await page.goto('/login');
    await expect(page).toHaveURL(/\/login/);

    // The login screen has multi-step UI; we accept any of the common labels
    // so a copy edit doesn't silently break this test.
    const emailInput = page.getByLabel(/email/i).first();
    const passwordInput = page.getByLabel(/password/i).first();
    await emailInput.fill(ADMIN_EMAIL);
    await passwordInput.fill(ADMIN_PASSWORD);
    await page.getByRole('button', { name: /sign in|log in|continue/i }).first().click();

    // 2. Land on dashboard (URL becomes `/`)
    await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });

    // 3. Navigate to each top-level screen and confirm it doesn't blow up.
    // We assert a heading or distinctive label per screen.
    const screens: Array<{ path: string; expect: RegExp }> = [
      { path: '/patients', expect: /patient/i },
      { path: '/appointments', expect: /appointment|schedule|calendar/i },
      { path: '/billing', expect: /bill|invoice/i },
      { path: '/reports', expect: /report|revenue/i },
      { path: '/notifications', expect: /notification|message/i },
      { path: '/settings', expect: /clinic|setting/i },
    ];
    for (const s of screens) {
      await page.goto(s.path);
      await expect(page.locator('body')).toContainText(s.expect, { timeout: 5_000 });
    }

    // 4. Register a new patient via the patients screen.
    await page.goto('/patients');
    const uniqueName = `Test Patient ${Date.now()}`;
    const uniquePhone = String(9000000000 + Math.floor(Math.random() * 100000000));

    await page.getByRole('button', { name: /\+?\s*new patient|register|add patient/i }).first().click();

    // Step 0 — basics. The wizard splits across steps; we fill what's
    // visible, click Next, repeat.
    const fullNameField = page.getByLabel(/full name/i);
    await expect(fullNameField).toBeVisible();
    await fullNameField.fill(uniqueName);

    // Optional gender pick — a 'Male' button if exposed.
    const malePick = page.getByRole('button', { name: /^male$/i }).first();
    if (await malePick.isVisible().catch(() => false)) {
      await malePick.click();
    }

    // Click Next / Continue.
    const nextBtn = page.getByRole('button', { name: /^next$|continue/i }).first();
    if (await nextBtn.isVisible().catch(() => false)) {
      await nextBtn.click();

      // Step 1 — phone.
      const phoneField = page.getByLabel(/phone/i).first();
      if (await phoneField.isVisible().catch(() => false)) {
        await phoneField.fill(uniquePhone);
      }

      // Skip through any remaining optional steps.
      for (let i = 0; i < 3; i++) {
        const next = page.getByRole('button', { name: /^next$|continue/i }).first();
        if (await next.isVisible().catch(() => false)) {
          await next.click();
        }
      }
    }

    // Submit — `Save patient`, `Register`, or `Create`.
    await page
      .getByRole('button', { name: /save patient|register|create patient|create$/i })
      .first()
      .click();

    // 5. The new patient should appear in the list.
    await expect(page.locator('body')).toContainText(uniqueName, { timeout: 10_000 });
  });
});
