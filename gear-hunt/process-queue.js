#!/usr/bin/env node
/**
 * Gear Hunt Queue Processor - Runs via cron every 10 minutes
 * Processes pending searches and updates gear.json
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { chromium } = require('playwright');

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

// Scrape Reverb with progress updates
async function scrapeReverb(page, searchTerm, onProgress) {
  const listings = [];
  try {
    onProgress(10, 'Loading Reverb...');
    const url = `https://reverb.com/marketplace?query=${encodeURIComponent(searchTerm)}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    
    onProgress(25, 'Waiting for results...');
    await page.waitForTimeout(3000); // Let JS render
    
    onProgress(40, 'Extracting listings...');
    const items = await page.$$eval('[role="listitem"] a[href*="/item/"]', links => 
      links.slice(0, 15).map(link => {
        const container = link.closest('[role="listitem"]') || link.parentElement;
        const titleEl = link.querySelector('h2, h3') || link;
        const priceEl = container.querySelector('[class*="price"], span[class*="Price"]');
        const imgEl = container.querySelector('img');
        const conditionEl = container.querySelector('[class*="condition"], [class*="Condition"]');
        
        return {
          title: titleEl.textContent?.trim() || 'Unknown',
          price: priceEl?.textContent?.trim() || 'Price not shown',
          image: imgEl?.src || null,
          url: link.href,
          source: 'Reverb',
          condition: conditionEl?.textContent?.trim() || 'Used',
          location: 'Ships nationwide'
        };
      })
    );
    
    listings.push(...items.filter(i => i.title !== 'Unknown' && i.url));
    onProgress(60, `Found ${listings.length} on Reverb`);
  } catch (e) {
    console.log('Reverb error:', e.message);
  }
  return listings;
}

// Scrape eBay
async function scrapeEbay(page, searchTerm, zipCode, onProgress) {
  const listings = [];
  try {
    onProgress(65, 'Loading eBay...');
    const url = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(searchTerm)}&_sacat=619`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    
    onProgress(75, 'Extracting eBay listings...');
    const items = await page.$$eval('.s-item', items => 
      items.slice(1, 12).map(item => {
        const titleEl = item.querySelector('.s-item__title span');
        const priceEl = item.querySelector('.s-item__price');
        const linkEl = item.querySelector('.s-item__link');
        
        if (!titleEl || titleEl.textContent.includes('Shop on eBay')) return null;
        
        return {
          title: titleEl.textContent.trim(),
          price: priceEl?.textContent?.trim() || 'Price not shown',
          url: linkEl?.href,
          source: 'eBay',
          condition: 'Varies',
          location: 'Ships nationwide'
        };
      }).filter(Boolean)
    );
    
    listings.push(...items);
    onProgress(85, `Found ${listings.length} on eBay`);
  } catch (e) {
    console.log('eBay error:', e.message);
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
async function processSearch(search) {
  console.log(`\n🔍 Processing: "${search.term}" in ZIP ${search.zip}`);
  
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
  });
  const page = await context.newPage();
  
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
    
    onProgress(5, 'Starting search...');
    
    allListings.push(...await scrapeReverb(page, search.term, onProgress));
    allListings.push(...await scrapeEbay(page, search.term, search.zip, onProgress));
    
    onProgress(90, 'Finding best prices...');
    const top3 = getTop3Cheapest(allListings);
    
    onProgress(95, 'Saving results...');
    saveGearResults(search.term, search.zip, top3);
    
    await browser.close();
    
    onProgress(100, 'Complete!');
    console.log(`  ✅ Found ${top3.length} results`);
    
    return { success: true, count: top3.length };
  } catch (error) {
    await browser.close();
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
  
  // Get next search
  const search = queue.pendingSearches[0];
  queue.processing = search;
  queue.currentProgress = 0;
  queue.statusMessage = 'Starting...';
  fs.writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2));
  
  console.log(`\n⏰ ${new Date().toISOString()}`);
  console.log('========================');
  
  // Process it
  const result = await processSearch(search);
  
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
processQueue().catch(console.error);
