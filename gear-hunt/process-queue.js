#!/usr/bin/env node
/**
 * Gear Hunt Queue Processor - Runs via cron every 10 minutes
 * Uses puppeteer-extra with stealth plugin to avoid detection
 * Hardened against prompt injection attacks
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// SECURITY: Input validation and sanitization
const SECURITY = {
  // Maximum input lengths
  MAX_SEARCH_LENGTH: 55,
  MAX_ZIP_LENGTH: 5,
  
  // Blocked patterns for prompt injection prevention
  BLOCKED_PATTERNS: [
    /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/, // Control characters
    /[<>\"'`;\\$\{\}\[\]\|]/, // Dangerous characters
    /(javascript|data|vbscript):/i, // Protocol handlers
    /on\w+\s*=/i, // Event handlers
    /\$\{.*\}/, // Template literals
    /\`.*\`/, // Backtick execution
    /\\x[0-9a-f]{2}/i, // Hex encoding
    /\\u[0-9a-f]{4}/i, // Unicode encoding
    /%(?:2[12]|3[bc]|3[0-9a-f]|5[bc]|7[bcd])/i, // URL encoding of dangerous chars
    /<script/i, // Script tags
    /<iframe/i, // Iframes
    /<object/i, // Objects
    /<embed/i, // Embeds
  ],
  
  // Allowed characters in search terms
  ALLOWED_SEARCH_CHARS: /^[a-zA-Z0-9\s\-_\.\(\),&+]+$/,
  
  // Validate and sanitize search term
  sanitizeSearch(input) {
    if (typeof input !== 'string') throw new Error('Invalid input type');
    
    // Check length
    if (input.length < 2 || input.length > this.MAX_SEARCH_LENGTH) {
      throw new Error(`Search term must be 2-${this.MAX_SEARCH_LENGTH} characters`);
    }
    
    // Check blocked patterns (prompt injection prevention)
    for (const pattern of this.BLOCKED_PATTERNS) {
      if (pattern.test(input)) {
        console.error(`SECURITY: Blocked pattern detected in search: ${pattern}`);
        throw new Error('Search term contains invalid characters');
      }
    }
    
    // Normalize whitespace
    let sanitized = input.trim().replace(/\s+/g, ' ');
    
    // Check allowed characters
    if (!this.ALLOWED_SEARCH_CHARS.test(sanitized)) {
      throw new Error('Search term contains disallowed characters');
    }
    
    return sanitized;
  },
  
  // Validate ZIP code
  sanitizeZip(input) {
    if (typeof input !== 'string') throw new Error('Invalid ZIP type');
    
    // Extract only digits
    const cleaned = input.replace(/\D/g, '').slice(0, this.MAX_ZIP_LENGTH);
    
    // Must be exactly 5 digits
    if (!/^\d{5}$/.test(cleaned)) {
      throw new Error('ZIP code must be exactly 5 digits');
    }
    
    return cleaned;
  },
  
  // Validate queue entry
  validateQueueEntry(entry) {
    if (!entry || typeof entry !== 'object') {
      throw new Error('Invalid queue entry');
    }
    
    // Check required fields
    if (!entry.term || !entry.zip || !entry.id) {
      throw new Error('Missing required fields');
    }
    
    // Validate ID format (alphanumeric only)
    if (!/^[a-zA-Z0-9]+$/.test(entry.id)) {
      throw new Error('Invalid ID format');
    }
    
    // Sanitize inputs
    entry.term = this.sanitizeSearch(entry.term);
    entry.zip = this.sanitizeZip(entry.zip);
    
    return entry;
  }
};

const QUEUE_FILE = path.join(__dirname, 'search-queue.json');
const GEAR_FILE = path.join(__dirname, 'gear.json');
const REPO_PATH = '/home/mihr/.openclaw/workspace/willy-site';

// Update queue status
function updateQueueStatus(updates) {
  const queue = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'));
  Object.assign(queue, updates);
  fs.writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2));
}

// Extract price as number
function extractPrice(priceStr) {
  if (!priceStr) return Infinity;
  const match = priceStr.match(/[\d,]+\.?\d*/);
  if (match) return parseFloat(match[0].replace(/,/g, ''));
  return Infinity;
}

// Get 3 cheapest
function getTop3Cheapest(listings) {
  return listings
    .filter(l => l.price && l.price !== 'Price not shown' && l.price !== 'Contact for Price')
    .sort((a, b) => extractPrice(a.price) - extractPrice(b.price))
    .slice(0, 3);
}

// Initialize puppeteer with stealth
async function initBrowser() {
  // Dynamic import for ES modules
  const { default: puppeteerExtra } = await import('puppeteer-extra');
  const { default: StealthPlugin } = await import('puppeteer-extra-plugin-stealth');
  
  puppeteerExtra.use(StealthPlugin());
  
  return puppeteerExtra.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
      '--window-size=1920,1080'
    ]
  });
}

// Scrape Reverb with stealth
async function scrapeReverb(browser, searchTerm, onProgress) {
  const listings = [];
  let page = null;
  
  try {
    onProgress(10, 'Loading Reverb...');
    page = await browser.newPage();
    
    // Set viewport and user agent
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // Navigate to search
    const url = `https://reverb.com/marketplace?query=${encodeURIComponent(searchTerm)}`;
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    
    onProgress(25, 'Waiting for results...');
    await page.waitForTimeout(2000);
    
    // Accept cookies if present
    try {
      const acceptBtn = await page.$('button:has-text("Accept"), button:has-text("Accept All")');
      if (acceptBtn) await acceptBtn.click();
    } catch {}
    
    onProgress(40, 'Extracting listings...');
    
    // Extract listings with multiple selector strategies
    const items = await page.evaluate(() => {
      const results = [];
      
      // Try different selectors
      const selectors = [
        '[role="listitem"]',
        '.grid-card',
        '[data-testid="listing-card"]',
        '.listing-card'
      ];
      
      for (const selector of selectors) {
        const elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
          elements.forEach(el => {
            const link = el.querySelector('a[href*="/item/"]');
            const titleEl = el.querySelector('h2, h3, .title, [data-testid="title"]');
            const priceEl = el.querySelector('.price, [data-testid="price"], span[class*="price"]');
            const imgEl = el.querySelector('img');
            
            if (link && titleEl) {
              results.push({
                title: titleEl.textContent.trim(),
                price: priceEl ? priceEl.textContent.trim() : 'Price not shown',
                image: imgEl ? imgEl.src : null,
                url: link.href,
                source: 'Reverb',
                condition: 'Used',
                location: 'Ships nationwide'
              });
            }
          });
          break; // Found working selector
        }
      }
      
      return results.slice(0, 12);
    });
    
    listings.push(...items);
    onProgress(60, `Found ${listings.length} on Reverb`);
  } catch (e) {
    console.log('Reverb error:', e.message);
  } finally {
    if (page) await page.close();
  }
  
  return listings;
}

// Scrape eBay with stealth
async function scrapeEbay(browser, searchTerm, zipCode, onProgress) {
  const listings = [];
  let page = null;
  
  try {
    onProgress(65, 'Loading eBay...');
    page = await browser.newPage();
    
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    const url = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(searchTerm)}&_sacat=619`;
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    
    onProgress(75, 'Extracting eBay listings...');
    
    const items = await page.evaluate(() => {
      const results = [];
      const items = document.querySelectorAll('.s-item');
      
      items.forEach((item, index) => {
        if (index === 0) return; // Skip first (usually promo)
        
        const titleEl = item.querySelector('.s-item__title span');
        const priceEl = item.querySelector('.s-item__price');
        const linkEl = item.querySelector('.s-item__link');
        
        if (titleEl && !titleEl.textContent.includes('Shop on eBay')) {
          results.push({
            title: titleEl.textContent.trim(),
            price: priceEl ? priceEl.textContent.trim() : 'Price not shown',
            url: linkEl ? linkEl.href : null,
            source: 'eBay',
            condition: 'Varies',
            location: 'Ships nationwide'
          });
        }
      });
      
      return results.slice(0, 10);
    });
    
    listings.push(...items);
    onProgress(85, `Found ${listings.length} on eBay`);
  } catch (e) {
    console.log('eBay error:', e.message);
  } finally {
    if (page) await page.close();
  }
  
  return listings;
}

// ZIP to Craigslist subdomain mapping (major metros)
function getCraigslistSubdomain(zipCode) {
  const prefix2 = zipCode.substring(0, 2);
  const prefix3 = zipCode.substring(0, 3);
  
  const cityMap = {
    // California
    '90': 'losangeles', '91': 'losangeles', '92': 'losangeles', '93': 'losangeles',
    '94': 'sandiego', '95': 'sfbay', '96': 'sfbay',
    // Texas
    '75': 'dallas', '76': 'dallas', '77': 'houston', '78': 'sanantonio', '79': 'austin',
    // Florida
    '32': 'jacksonville', '33': 'miami', '34': 'miami',
    // New York
    '10': 'newyork', '11': 'newyork', '12': 'albany',
    // Illinois
    '60': 'chicago', '61': 'chicago',
    // Pennsylvania
    '15': 'pittsburgh', '16': 'pittsburgh', '17': 'philadelphia', '18': 'philadelphia', '19': 'philadelphia',
    // Ohio
    '43': 'columbus', '44': 'cleveland', '45': 'cincinnati',
    // Georgia
    '30': 'atlanta', '31': 'atlanta',
    // North Carolina
    '27': 'raleigh', '28': 'charlotte', '29': 'charlotte',
    // Michigan
    '48': 'detroit', '49': 'grandrapids',
    // Arizona
    '85': 'phoenix', '86': 'phoenix',
    // Massachusetts
    '01': 'boston', '02': 'boston',
    // Washington
    '98': 'seattle', '99': 'seattle',
    // Colorado
    '80': 'denver', '81': 'denver',
    // Tennessee
    '37': 'nashville', '38': 'memphis',
    // Missouri
    '63': 'stlouis', '64': 'kansascity', '65': 'kansascity',
    // Indiana
    '46': 'indianapolis', '47': 'fortwayne',
    // Maryland
    '21': 'baltimore',
    // Wisconsin
    '53': 'milwaukee', '54': 'madison',
    // Oregon
    '97': 'portland',
    // Nevada
    '89': 'lasvegas',
    // Minnesota
    '55': 'minneapolis', '56': 'minneapolis',
    // Louisiana
    '70': 'neworleans',
    // Kentucky
    '40': 'louisville',
    // Alabama
    '35': 'huntsville', '36': 'birmingham',
    // South Carolina
    '29': 'charlotte', '25': 'greenville',
    // Oklahoma
    '73': 'oklahomacity', '74': 'tulsa',
    // Connecticut
    '06': 'hartford',
    // Iowa
    '52': 'desmoines',
    // Arkansas
    '72': 'littlerock',
    // Mississippi
    '39': 'jackson',
    // Kansas
    '66': 'wichita', '67': 'wichita',
    // Utah
    '84': 'saltlakecity',
    // New Mexico
    '87': 'albuquerque', '88': 'albuquerque',
    // Nebraska
    '68': 'omaha', '69': 'omaha',
    // Idaho
    '83': 'boise',
    // Hawaii
    '96': 'honolulu',
    // Alaska
    '99': 'anchorage',
  };
  
  return cityMap[prefix2] || cityMap[prefix3] || 'newyork';
}

// Scrape Craigslist
async function scrapeCraigslist(browser, searchTerm, zipCode, onProgress) {
  const listings = [];
  let page = null;
  
  try {
    const subdomain = getCraigslistSubdomain(zipCode);
    onProgress(67, `Loading Craigslist ${subdomain}...`);
    
    page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    
    const url = `https://${subdomain}.craigslist.org/search/sss?query=${encodeURIComponent(searchTerm)}`;
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    
    onProgress(80, 'Extracting Craigslist listings...');
    
    const items = await page.evaluate(() => {
      const results = [];
      const listings = document.querySelectorAll('.result-row, .cl-search-result');
      
      listings.forEach(item => {
        const titleEl = item.querySelector('.result-title, .title');
        const priceEl = item.querySelector('.result-price, .price');
        const linkEl = item.querySelector('a');
        const locationEl = item.querySelector('.result-hood, .location');
        
        if (titleEl) {
          results.push({
            title: titleEl.textContent.trim(),
            price: priceEl ? priceEl.textContent.trim() : 'Contact for price',
            url: linkEl ? linkEl.href : null,
            source: 'Craigslist',
            condition: 'Used',
            location: locationEl ? locationEl.textContent.trim() : 'Local'
          });
        }
      });
      
      return results.slice(0, 10);
    });
    
    listings.push(...items);
    onProgress(88, `Found ${listings.length} on Craigslist`);
  } catch (e) {
    console.log('Craigslist error:', e.message);
  } finally {
    if (page) await page.close();
  }
  
  return listings;
}

// Save results
function saveGearResults(searchTerm, zipCode, listings) {
  const data = {
    lastUpdated: new Date().toISOString(),
    lastSearch: {
      term: searchTerm,
      zip: zipCode,
      timestamp: new Date().toISOString()
    },
    listings: listings
  };
  fs.writeFileSync(GEAR_FILE, JSON.stringify(data, null, 2));
}

// Git push
function gitPush(message) {
  try {
    process.chdir(REPO_PATH);
    execSync('git add gear-hunt/gear.json gear-hunt/search-queue.json');
    
    const status = execSync('git status --porcelain', { encoding: 'utf8' });
    if (!status.trim()) return false;
    
    execSync(`git commit -m "${message}"`);
    execSync('git push origin main');
    return true;
  } catch (error) {
    console.error('Git error:', error.message);
    return false;
  }
}

// Process one search
async function processSearch(browser, search) {
  console.log(`\n🔍 Processing: "${search.term}" in ZIP ${search.zip}`);
  
  // Progress callback
  const onProgress = (percent, message) => {
    console.log(`  ${percent}% - ${message}`);
    updateQueueStatus({ 
      currentProgress: percent, 
      statusMessage: message 
    });
  };
  
  try {
    const allListings = [];
    const sources = search.sources || { reverb: true, ebay: true, craigslist: true, musicgoround: false, guitarcenter: false };
    
    onProgress(5, 'Starting search...');
    
    if (sources.reverb !== false) {
      allListings.push(...await scrapeReverb(browser, search.term, onProgress));
    }
    if (sources.ebay !== false) {
      allListings.push(...await scrapeEbay(browser, search.term, search.zip, onProgress));
    }
    if (sources.craigslist !== false) {
      allListings.push(...await scrapeCraigslist(browser, search.term, search.zip, onProgress));
    }
    
    onProgress(90, 'Finding best prices...');
    const top3 = getTop3Cheapest(allListings);
    
    onProgress(95, 'Saving results...');
    saveGearResults(search.term, search.zip, top3);
    
    onProgress(100, 'Complete!');
    console.log(`  ✅ Found ${top3.length} results`);
    
    return { success: true, count: top3.length };
  } catch (error) {
    console.error('  ❌ Error:', error.message);
    return { success: false, error: error.message };
  }
}

// Main processor
async function processQueue() {
  const queue = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'));
  
  if (!queue.pendingSearches || queue.pendingSearches.length === 0) {
    console.log('No pending searches');
    updateQueueStatus({ lastChecked: new Date().toISOString() });
    return;
  }
  
  if (queue.processing) {
    console.log('Already processing a search, skipping...');
    return;
  }
  
  // Get and validate next search
  let search;
  try {
    search = SECURITY.validateQueueEntry(queue.pendingSearches[0]);
  } catch (error) {
    console.error('SECURITY: Invalid queue entry:', error.message);
    // Remove invalid entry
    queue.pendingSearches.shift();
    fs.writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2));
    return;
  }
  
  queue.processing = search;
  queue.currentProgress = 0;
  queue.statusMessage = 'Starting...';
  fs.writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2));
  
  console.log(`\n⏰ ${new Date().toISOString()}`);
  console.log('========================');
  
  // Initialize browser with stealth
  let browser;
  try {
    browser = await initBrowser();
  } catch (e) {
    console.error('Failed to launch browser:', e.message);
    queue.processing = null;
    fs.writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2));
    return;
  }
  
  // Process it
  const result = await processSearch(browser, search);
  
  // Close browser
  await browser.close();
  
  // Update queue
  queue.pendingSearches.shift();
  queue.completedSearches.unshift({
    ...search,
    completedAt: new Date().toISOString(),
    resultCount: result.count || 0,
    success: result.success
  });
  
  // Keep only last 10 completed
  if (queue.completedSearches.length > 10) {
    queue.completedSearches = queue.completedSearches.slice(0, 10);
  }
  
  queue.processing = null;
  queue.currentProgress = 0;
  queue.statusMessage = '';
  queue.lastChecked = new Date().toISOString();
  fs.writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2));
  
  // Push to GitHub
  if (result.success) {
    console.log('📤 Pushing to GitHub...');
    const safeTerm = search.term.replace(/"/g, '');
    const pushed = gitPush(`Gear Hunt: Results for ${safeTerm} (${result.count} listings)`);
    if (pushed) {
      console.log('✅ Pushed successfully');
    }
  }
  
  console.log('========================\n');
}

// Run
processQueue().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
