const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// Security: Validate and sanitize inputs
function sanitizeInput(input, type) {
  if (type === 'zip') {
    // Only allow 5-digit ZIP codes
    const cleaned = input.replace(/\D/g, '').slice(0, 5);
    if (!/^\d{5}$/.test(cleaned)) {
      throw new Error('Invalid ZIP code format');
    }
    return cleaned;
  }
  
  if (type === 'search') {
    // Only allow alphanumeric, spaces, and basic punctuation
    // Block any HTML/script tags or special characters
    const cleaned = input
      .replace(/[<>\"'\`;${}]/g, '')  // Remove dangerous chars
      .replace(/[\x00-\x1F\x7F]/g, '') // Remove control characters
      .trim()
      .slice(0, 100); // Max 100 chars
    
    if (cleaned.length < 2) {
      throw new Error('Search term too short');
    }
    
    // Check for suspicious patterns
    const suspicious = /(javascript:|data:|vbscript:|on\w+\s*=)/i;
    if (suspicious.test(cleaned)) {
      throw new Error('Potentially malicious input detected');
    }
    
    return cleaned;
  }
  
  throw new Error('Unknown input type');
}

async function scrapeReverb(page, searchTerm) {
  const listings = [];
  try {
    const url = `https://reverb.com/marketplace?query=${encodeURIComponent(searchTerm)}&condition=used`;
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    
    // Wait for listings to load
    await page.waitForSelector('[data-testid="grid-tile"]', { timeout: 10000 });
    
    const items = await page.$$eval('[data-testid="grid-tile"]', tiles => 
      tiles.slice(0, 10).map(tile => {
        const titleEl = tile.querySelector('h4 a, .grid-card__title a');
        const priceEl = tile.querySelector('.price-display, .grid-card__price');
        const imgEl = tile.querySelector('img');
        const linkEl = tile.querySelector('a[href^="/p/"]');
        
        return {
          title: titleEl?.textContent?.trim() || 'Unknown',
          price: priceEl?.textContent?.trim() || 'Price not shown',
          image: imgEl?.src || null,
          url: linkEl ? `https://reverb.com${linkEl.getAttribute('href')}` : null,
          source: 'Reverb',
          condition: 'Used',
          location: 'Ships nationwide'
        };
      })
    );
    
    listings.push(...items.filter(i => i.title !== 'Unknown'));
  } catch (e) {
    console.log('Reverb scrape error:', e.message);
  }
  return listings;
}

async function scrapeEbay(page, searchTerm, zipCode) {
  const listings = [];
  try {
    // Category 619 = Musical Instruments
    const url = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(searchTerm)}&_sacat=619&_stpos=${zipCode}&_localPickup=1`;
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    
    const items = await page.$$eval('.s-item', items => 
      items.slice(1, 11).map(item => { // Skip first (usually promo)
        const titleEl = item.querySelector('.s-item__title span');
        const priceEl = item.querySelector('.s-item__price');
        const imgEl = item.querySelector('.s-item__image-img');
        const linkEl = item.querySelector('.s-item__link');
        const locationEl = item.querySelector('.s-item__itemLocation');
        
        return {
          title: titleEl?.textContent?.trim() || 'Unknown',
          price: priceEl?.textContent?.trim() || 'Price not shown',
          image: imgEl?.src || null,
          url: linkEl?.href || null,
          source: 'eBay',
          condition: 'Varies',
          location: locationEl?.textContent?.trim() || zipCode
        };
      })
    );
    
    listings.push(...items.filter(i => i.title !== 'Unknown' && !i.title.includes('Shop on eBay')));
  } catch (e) {
    console.log('eBay scrape error:', e.message);
  }
  return listings;
}

async function scrapeMusicGoRound(page, searchTerm) {
  const listings = [];
  try {
    const url = `https://www.musicgoround.com/search?q=${encodeURIComponent(searchTerm)}`;
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    
    const items = await page.$$eval('.product-item', items => 
      items.slice(0, 10).map(item => {
        const titleEl = item.querySelector('.product-title, h3');
        const priceEl = item.querySelector('.price, .product-price');
        const imgEl = item.querySelector('img');
        const linkEl = item.querySelector('a');
        
        return {
          title: titleEl?.textContent?.trim() || 'Unknown',
          price: priceEl?.textContent?.trim() || 'Price not shown',
          image: imgEl?.src || null,
          url: linkEl ? `https://www.musicgoround.com${linkEl.getAttribute('href')}` : null,
          source: 'MusicGoRound',
          condition: 'Used',
          location: 'Local store'
        };
      })
    );
    
    listings.push(...items.filter(i => i.title !== 'Unknown'));
  } catch (e) {
    console.log('MusicGoRound scrape error:', e.message);
  }
  return listings;
}

async function scrapeGuitarCenter(page, searchTerm) {
  const listings = [];
  try {
    const url = `https://www.guitarcenter.com/search?Ntt=${encodeURIComponent(searchTerm)}&Ns=r`;
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    
    const items = await page.$$eval('.product-item', items => 
      items.slice(0, 10).map(item => {
        const titleEl = item.querySelector('.product-title, h3 a');
        const priceEl = item.querySelector('.price, .product-price');
        const imgEl = item.querySelector('img');
        const linkEl = item.querySelector('a');
        
        return {
          title: titleEl?.textContent?.trim() || 'Unknown',
          price: priceEl?.textContent?.trim() || 'Price not shown',
          image: imgEl?.src || null,
          url: linkEl?.href || null,
          source: 'Guitar Center',
          condition: 'Used/New',
          location: 'Ships/Store pickup'
        };
      })
    );
    
    listings.push(...items.filter(i => i.title !== 'Unknown'));
  } catch (e) {
    console.log('Guitar Center scrape error:', e.message);
  }
  return listings;
}

async function downloadImage(page, url, filename) {
  try {
    const response = await page.evaluate(async (imageUrl) => {
      const res = await fetch(imageUrl);
      const blob = await res.blob();
      return URL.createObjectURL(blob);
    }, url);
    
    // In real implementation, would save to disk
    return filename;
  } catch (e) {
    return null;
  }
}

async function main() {
  // Get inputs from environment variables (set by GitHub Actions)
  let searchTerm = process.env.SEARCH_TERM || process.argv[2];
  let zipCode = process.env.ZIP_CODE || process.argv[3];
  
  if (!searchTerm || !zipCode) {
    console.error('Usage: SEARCH_TERM="Fender Strat" ZIP_CODE=29710 node scrape.js');
    process.exit(1);
  }
  
  // Sanitize inputs
  try {
    searchTerm = sanitizeInput(searchTerm, 'search');
    zipCode = sanitizeInput(zipCode, 'zip');
  } catch (e) {
    console.error('Input validation failed:', e.message);
    process.exit(1);
  }
  
  console.log(`Scraping for: "${searchTerm}" in ZIP ${zipCode}`);
  
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  });
  const page = await context.newPage();
  
  // Block unnecessary resources for speed
  await page.route('**/*', (route) => {
    const type = route.request().resourceType();
    if (['image', 'font', 'media'].includes(type)) {
      route.abort();
    } else {
      route.continue();
    }
  });
  
  const allListings = [];
  
  // Scrape each site
  console.log('Scraping Reverb...');
  allListings.push(...await scrapeReverb(page, searchTerm));
  
  console.log('Scraping eBay...');
  allListings.push(...await scrapeEbay(page, searchTerm, zipCode));
  
  console.log('Scraping MusicGoRound...');
  allListings.push(...await scrapeMusicGoRound(page, searchTerm));
  
  console.log('Scraping Guitar Center...');
  allListings.push(...await scrapeGuitarCenter(page, searchTerm));
  
  await browser.close();
  
  // Save results
  const outputPath = path.join(__dirname, 'gear.json');
  const data = {
    lastUpdated: new Date().toISOString(),
    lastSearch: {
      term: searchTerm,
      zip: zipCode,
      timestamp: new Date().toISOString()
    },
    listings: allListings
  };
  
  fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));
  console.log(`Saved ${allListings.length} listings to gear.json`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
