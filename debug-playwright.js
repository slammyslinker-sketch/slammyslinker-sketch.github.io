const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: '/usr/bin/chromium',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const page = await browser.newPage({
    viewport: { width: 1920, height: 1080 }
  });
  
  console.log('Navigating to Realtor.com...');
  await page.goto('https://www.realtor.com/realestateandhomes-search/29710/beds-3-4/baths-2/price-300000-400000', {
    waitUntil: 'networkidle',
    timeout: 60000
  });
  
  console.log('Waiting for content...');
  await page.waitForTimeout(5000);
  
  // Get page HTML structure
  const html = await page.content();
  fs.writeFileSync('debug-page.html', html);
  console.log('Saved debug-page.html');
  
  // Take screenshot
  await page.screenshot({ path: 'debug-screenshot.png', fullPage: true });
  console.log('Saved debug-screenshot.png');
  
  // Try to find property cards with various selectors
  const results = await page.evaluate(() => {
    const info = {
      title: document.title,
      url: window.location.href,
      selectors: {}
    };
    
    // Test various selectors
    info.selectors.propertyCards = document.querySelectorAll('[data-testid="property-card"]').length;
    info.selectors.anyDataTestid = document.querySelectorAll('[data-testid]').length;
    info.selectors.allDivs = document.querySelectorAll('div').length;
    info.selectors.allLinks = document.querySelectorAll('a[href*="/realestateandhomes-detail/"]').length;
    
    // Look for any element with price
    const priceElements = Array.from(document.querySelectorAll('*')).filter(el => 
      el.textContent && el.textContent.match(/\$[\d,]+/)
    );
    info.selectors.priceElements = priceElements.slice(0, 5).map(el => ({
      tag: el.tagName,
      class: el.className?.substring(0, 50),
      text: el.textContent?.substring(0, 100)
    }));
    
    return info;
  });
  
  console.log('Page analysis:', JSON.stringify(results, null, 2));
  
  await browser.close();
})();
