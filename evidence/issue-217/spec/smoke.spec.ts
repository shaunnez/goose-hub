import { test } from '@playwright/test';

const BEFORE_HTML = `<!doctype html>
<html><head><title>Evidence smoke — before</title>
<style>
  body { font-family: system-ui, sans-serif; background: #0b0d12; color: #e5e7eb; margin: 0; padding: 48px; }
  h1 { font-size: 32px; margin: 0 0 16px; }
  p  { font-size: 16px; color: #9ca3af; max-width: 540px; line-height: 1.5; }
  button { margin-top: 24px; padding: 10px 18px; font-size: 14px; background: #2563eb; color: white;
           border: 0; border-radius: 6px; cursor: pointer; }
  button:hover { background: #1d4ed8; }
</style></head>
<body>
  <h1>Evidence pipeline smoke</h1>
  <p>This is the <strong>before</strong> state. The button below adds a green confirmation banner
     to demonstrate a UI state change captured by Playwright.</p>
  <button id="add">Add confirmation banner</button>
  <script>
    document.getElementById('add').onclick = () => {
      const b = document.createElement('div');
      b.id = 'banner';
      b.textContent = '✅ Banner added — this is the after state.';
      Object.assign(b.style, {
        marginTop: '24px', padding: '14px 18px', borderRadius: '6px',
        background: '#065f46', color: '#d1fae5', fontWeight: '600',
      });
      document.body.appendChild(b);
    };
  </script>
</body></html>`;

test('evidence pipeline smoke', async ({ page }) => {
  await page.setContent(BEFORE_HTML);
  await page.screenshot({ path: 'e2e-smoke/output/before.png', fullPage: true });

  await page.getByRole('button', { name: 'Add confirmation banner' }).click();
  await page.locator('#banner').waitFor();
  await page.screenshot({ path: 'e2e-smoke/output/after.png', fullPage: true });
});
