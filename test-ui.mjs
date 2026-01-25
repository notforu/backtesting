import { chromium } from '@playwright/test';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  console.log('Navigating to http://localhost:5173...');
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
  
  console.log('Waiting for page to load...');
  await page.waitForTimeout(3000);
  
  // Take initial screenshot
  console.log('Taking initial screenshot...');
  await page.screenshot({ path: '/workspace/screenshot-initial.png', fullPage: true });
  
  // Check for error messages
  const errorElements = await page.locator('text=/error|failed|500/i').count();
  console.log('Error elements found: ' + errorElements);
  
  // Check if strategy dropdown exists
  const strategyDropdown = await page.locator('select').first();
  const dropdownCount = await page.locator('select').count();
  console.log('Strategy dropdown exists: ' + (dropdownCount > 0));
  
  // Check if history panel exists
  const historyPanel = await page.locator('text=/history|previous/i').count();
  console.log('History panel elements: ' + historyPanel);
  
  // Get network responses
  const responses = [];
  page.on('response', response => {
    const url = response.url();
    if (url.includes('/api/')) {
      responses.push(url + ' - Status: ' + response.status());
    }
  });
  
  // Wait a bit more to capture network requests
  await page.waitForTimeout(2000);
  
  console.log('\n=== API Responses ===');
  responses.forEach(resp => console.log(resp));
  
  // Take final screenshot
  console.log('\nTaking final screenshot...');
  await page.screenshot({ path: '/workspace/screenshot-final.png', fullPage: true });
  
  // Get page title
  const title = await page.title();
  console.log('Page title: ' + title);
  
  await browser.close();
  console.log('\nTest completed successfully!');
})();
