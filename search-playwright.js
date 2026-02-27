#!/usr/bin/env node
/**
 * House Hunter - Realtor.com scraper using Playwright
 * More reliable than Puppeteer for anti-bot protection
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const CONFIG = {
  zips: ['29710', '29745', '29720', '29730'],
  priceMin: 300000,
  priceMax: 400000,
  bedsMin: 3,
  bedsMax: 4,
  bathsMin: 2,
  sqftMin: 1800,
  sqftMax: 2200,
  repoPath: '/home/mihr/.openclaw/workspace/willy-site',
  listingsFile: 'listings.json'
};

// Load existing listings
function loadExistingListings() {
  try {
    const data = fs.readFileSync(path.join(CONFIG.repoPath, CONFIG.listingsFile), 'utf8');
    const parsed = JSON.parse(data);
    return new Set(parsed.listings.map(l => l.id));
  } catch {
    return new Set();
  }
}

// Save listings
function saveListings(listings) {
  const existingIds = loadExistingListings();
  
  listings.forEach(l => {
    l.isNew = !existingIds.has(l.id);
  });
  
  const data = {
    lastUpdated: new Date().toISOString(),
    lastChecked: new Date().toISOString(),
    searchCriteria: {
      zips: CONFIG.zips,
      priceMin: CONFIG.priceMin,
      priceMax: CONFIG.priceMax,
      bedsMin: CONFIG.bedsMin,
      bedsMax: CONFIG.bedsMax,
      bathsMin: CONFIG.bathsMin,
      sqftMin: CONFIG.sqftMin,
      sqftMax: CONFIG.sqftMax
    },
    listings: listings
  };
  
  fs.writeFileSync(path.join(CONFIG.repoPath, CONFIG.listingsFile), JSON.stringify(data, null, 2));
  console.log(`Saved ${listings.length} listings (${listings.filter(l => l.isNew).length} new)`);
}

// Scrape Realtor.com for one ZIP
async function scrapeZip(browser, zip, onProgress) {
  const listings = [];
  let page = null;
  
  try {
    onProgress(`Loading Realtor.com for ZIP ${zip}...`);
    page = await browser.newPage({
      viewport: { width: 1920, height: 1080 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    
    // Block unnecessary resources
    await page.route('**/*', (route) => {
      const type = route.request().resourceType();
      if (type === 'image' || type === 'media' || type === 'font') {
        route.abort();
      } else {
        route.continue();
      }
    });
    
    // Build search URL
    const url = `https://www.realtor.com/realestateandhomes-search/${zip}/beds-${CONFIG.bedsMin}-${CONFIG.bedsMax}/baths-${CONFIG.bathsMin}/price-${CONFIG.priceMin}-${CONFIG.priceMax}`;
    
    onProgress(`Navigating to ${url}...`);
    const response = await page.goto(url, { 
      waitUntil: 'domcontentloaded', 
      timeout: 60000 
    });
    
    if (response.status() === 404 || response.status() === 403) {
      console.log(`  ⚠️ Got ${response.status()} for ZIP ${zip} - anti-bot protection`);
      return listings;
    }
    
    onProgress('Waiting for page to settle...');
    await page.waitForTimeout(5000);
    
    onProgress('Extracting listings...');
    
    // Extract listings using Playwright's evaluate
    const items = await page.evaluate((zipCode) => {
      const results = [];
      
      // Current Realtor.com selectors based on browser inspection
      const cards = document.querySelectorAll('[data-testid="property-card"], [class*="property-card"]');
      
      cards.forEach((card, index) => {
        try {
          // Try multiple selector patterns
          const linkEl = card.querySelector('a[href*="/realestateandhomes-detail/"]');
          const priceEl = card.querySelector('[data-testid="price"]');
          const bedsEl = card.querySelector('[data-testid*="bed"]');
          const bathsEl = card.querySelector('[data-testid*="bath"]');
          const sqftEl = card.querySelector('[data-testid*="sqft"]');
          const addressEl = card.querySelector('[data-testid="address"]');
          
          if (linkEl) {
            const url = linkEl.href;
            const id = `${zipCode}-${index.toString().padStart(3, '0')}`;
            
            results.push({
              id: id,
              address: addressEl ? addressEl.textContent.trim() : 'Address not shown',
              city: 'Unknown',
              state: 'SC',
              zip: zipCode,
              price: priceEl ? priceEl.textContent.trim() : 'Price not shown',
              beds: bedsEl ? parseInt(bedsEl.textContent) || 3 : 3,
              baths: bathsEl ? parseFloat(bathsEl.textContent) || 2 : 2,
              sqft: sqftEl ? parseInt(sqftEl.textContent.replace(/[^0-9]/g, '')) || 2000 : 2000,
              status: 'For Sale',
              url: url,
              image: null,
              isNew: true,
              hoa: null,
              notes: ''
            });
          }
        } catch (e) {}
      });
      
      return results;
    }, zip);
    
    listings.push(...items);
    onProgress(`Found ${items.length} listings in ZIP ${zip}`);
    
  } catch (e) {
    console.log(`  Error scraping ZIP ${zip}:`, e.message);
  } finally {
    if (page) await page.close();
  }
  
  return listings;
}

// Git push
function gitPush(message) {
  try {
    process.chdir(CONFIG.repoPath);
    
    const status = execSync('git status --porcelain', { encoding: 'utf8' });
    if (!status.trim()) {
      console.log('No changes to push');
      return;
    }
    
    execSync('git add listings.json');
    execSync(`git commit -m "${message}"`);
    execSync('git pull --no-rebase origin main');
    execSync('git push origin main');
    console.log('Pushed to GitHub');
  } catch (error) {
    console.error('Git error:', error.message);
  }
}

// Main
async function main() {
  console.log('🏠 House Hunt - Realtor.com Scraper (Playwright)');
  console.log('=================================================');
  console.log(`Time: ${new Date().toISOString()}\n`);
  
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      executablePath: '/usr/bin/chromium',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1920,1080'
      ]
    });
    
    const allListings = [];
    
    for (const zip of CONFIG.zips) {
      const onProgress = (msg) => console.log(`  ${msg}`);
      const listings = await scrapeZip(browser, zip, onProgress);
      allListings.push(...listings);
      
      // Delay between ZIPs
      if (zip !== CONFIG.zips[CONFIG.zips.length - 1]) {
        await new Promise(r => setTimeout(r, 3000));
      }
    }
    
    console.log(`\nTotal listings found: ${allListings.length}`);
    
    if (allListings.length > 0) {
      saveListings(allListings);
      gitPush(`Update listings: ${new Date().toLocaleString()}`);
    } else {
      // Update timestamp even if no listings
      const data = JSON.parse(fs.readFileSync(path.join(CONFIG.repoPath, CONFIG.listingsFile), 'utf8'));
      data.lastChecked = new Date().toISOString();
      fs.writeFileSync(path.join(CONFIG.repoPath, CONFIG.listingsFile), JSON.stringify(data, null, 2));
      gitPush('Update check timestamp (no new listings)');
    }
    
  } catch (err) {
    console.error('Fatal error:', err);
    process.exit(1);
  } finally {
    if (browser) await browser.close();
  }
  
  console.log('\nDone.');
}

main();
