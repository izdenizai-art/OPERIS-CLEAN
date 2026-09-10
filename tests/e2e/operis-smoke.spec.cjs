const { test, expect } = require('@playwright/test');

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
  await expect(page.getByText('İlk Kullanıcı Kurulumu')).toBeVisible();
  await expect(page.getByPlaceholder('balamir')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Yönetici Kullanıcıyı Oluştur' })).toBeVisible();
});
