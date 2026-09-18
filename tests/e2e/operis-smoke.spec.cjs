const { test, expect } = require('@playwright/test');
const crypto = require('node:crypto');

const baseURL = process.env.OPERIS_BASE_URL || 'http://127.0.0.1:3001';

test('OPERIS first-run page and health endpoint are consistent', async ({ page, request }) => {
  const health = await request.get(`${baseURL}/api/health`);
  expect(health.ok()).toBeTruthy();
  const healthBody = await health.json();
  expect(healthBody.ok).toBe(true);
  expect(healthBody.version).toBe('6.3.63');

  const status = await request.get(`${baseURL}/api/auth/status`);
  expect(status.ok()).toBeTruthy();
  const statusBody = await status.json();
  expect(statusBody.hasUsers).toBe(false);

  await page.goto(baseURL, { waitUntil: 'networkidle' });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  await expect(page.getByText('İlk Kullanıcı Kurulumu')).toBeVisible();
  await expect(page.getByPlaceholder('balamir')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Yönetici Kullanıcıyı Oluştur' })).toBeVisible();

  const testPassword = `T${crypto.randomUUID()}aA1!`;
  const inputs = page.locator('form input');
  await inputs.nth(1).fill('CI Yönetici');
  await inputs.nth(2).fill('ci-admin@example.invalid');
  await inputs.nth(3).fill(testPassword);
  await inputs.nth(4).fill(testPassword);
  await page.getByRole('button', { name: 'Yönetici Kullanıcıyı Oluştur' }).click();

  await expect(page.getByRole('button', { name: 'Ayarlar', exact: true })).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: 'Ayarlar', exact: true }).click();
  await expect(page.getByText('Şirket ve Logo')).toBeVisible();
  await expect(page.getByText('Giriş Ekranı Hızlı Bağlantıları')).toBeVisible();
  expect(pageErrors).toEqual([]);
});
