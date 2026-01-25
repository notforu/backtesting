const { chromium } = require('playwright');

async function testUI() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  // Collect console messages
  const consoleLogs = [];
  page.on('console', msg => {
    consoleLogs.push({
      type: msg.type(),
      text: msg.text()
    });
  });
  
  // Collect network errors
  const networkErrors = [];
  page.on('response', response => {
    if (response.status() >= 400) {
      networkErrors.push({
        url: response.url(),
        status: response.status(),
        statusText: response.statusText()
      });
    }
  });
  
  try {
    console.log('Navigating to http://localhost:5173...');
    await page.goto('http://localhost:5173', { waitUntil: 'networkidle', timeout: 10000 });
    
    // Wait a bit for any delayed rendering
    await page.waitForTimeout(2000);
    
    // Take initial screenshot
    console.log('Taking initial screenshot...');
    await page.screenshot({ path: '/workspace/screenshot-initial.png', fullPage: true });
    
    // Get page title
    const title = await page.title();
    console.log('Page title:', title);
    
    // Check for visible error messages (case insensitive)
    const errorText = await page.content();
    const hasError = errorText.toLowerCase().includes('error') || 
                     errorText.toLowerCase().includes('failed') || 
                     errorText.toLowerCase().includes('500');
    console.log('Page contains error keywords:', hasError);
    
    // Try to find the strategy dropdown
    const dropdown = page.locator('select').first();
    const dropdownCount = await dropdown.count();
    console.log('Found', dropdownCount, 'select elements');
    
    if (dropdownCount > 0) {
      console.log('Strategy dropdown found');
      await dropdown.screenshot({ path: '/workspace/screenshot-dropdown.png' });
    }
    
    // Print console logs
    console.log('\n=== Browser Console Logs ===');
    consoleLogs.forEach(log => {
      console.log(`[${log.type}]`, log.text);
    });
    
    // Print network errors
    console.log('\n=== Network Errors ===');
    networkErrors.forEach(err => {
      console.log(`${err.status} ${err.statusText}: ${err.url}`);
    });
    
    // Take final screenshot
    await page.screenshot({ path: '/workspace/screenshot-final.png', fullPage: true });
    console.log('\nScreenshots saved to:');
    console.log('  /workspace/screenshot-initial.png');
    console.log('  /workspace/screenshot-final.png');
    
  } catch (error) {
    console.error('Error during test:', error.message);
    await page.screenshot({ path: '/workspace/screenshot-error.png', fullPage: true });
  } finally {
    await browser.close();
  }
}

testUI();
