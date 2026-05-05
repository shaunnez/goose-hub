  import { test } from '@playwright/test'; 
  test.use({ video: 'on' });                                                                                       
  test('video test', async ({ page }) => {
    await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });                                                 
    await page.screenshot({ path: '/tmp/step-1.png' });                                                                          
  });    