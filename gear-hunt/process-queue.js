#!/usr/bin/env node
/**
 * Gear Hunt Queue Processor
 * Checks search-queue.json for pending searches and processes them
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const QUEUE_FILE = path.join(__dirname, 'search-queue.json');
const GEAR_FILE = path.join(__dirname, 'gear.json');

// Load queue
function loadQueue() {
  try {
    const data = fs.readFileSync(QUEUE_FILE, 'utf8');
    return JSON.parse(data);
  } catch {
    return { pendingSearches: [], processing: false, lastChecked: null };
  }
}

// Save queue
function saveQueue(queue) {
  queue.lastChecked = new Date().toISOString();
  fs.writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2));
}

// Extract price for sorting
function extractPrice(priceStr) {
  if (!priceStr) return Infinity;
  const match = priceStr.match(/[\d,]+\.?\d*/);
  if (match) {
    return parseFloat(match[0].replace(/,/g, ''));
  }
  return Infinity;
}

// Get 3 cheapest
function getTop3Cheapest(listings) {
  return listings
    .filter(l => l.price && l.price !== 'Price not shown')
    .sort((a, b) => extractPrice(a.price) - extractPrice(b.price))
    .slice(0, 3);
}

// Scrape Reverb (simplified for demo - would use browser in production)
async function scrapeReverb(searchTerm) {
  const listings = [];
  try {
    // Simulated results for demo - in production would use browser automation
    console.log(`Would scrape Reverb for: ${searchTerm}`);
    // Return empty for now - real implementation would use browser
  } catch (e) {
    console.log('Reverb error:', e.message);
  }
  return listings;
}

// Save gear results
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
    process.chdir('/home/mihr/.openclaw/workspace/willy-site');
    execSync('git add gear-hunt/gear.json gear-hunt/search-queue.json');
    
    const status = execSync('git status --porcelain', { encoding: 'utf8' });
    if (!status.trim()) {
      console.log('No changes to push');
      return false;
    }
    
    execSync(`git commit -m "${message}"`);
    execSync('git push origin main');
    console.log('Pushed to GitHub');
    return true;
  } catch (error) {
    console.error('Git error:', error.message);
    return false;
  }
}

// Process queue
async function processQueue() {
  const queue = loadQueue();
  
  if (queue.processing) {
    console.log('Already processing, skipping...');
    return;
  }
  
  if (!queue.pendingSearches || queue.pendingSearches.length === 0) {
    console.log('No pending searches');
    saveQueue(queue);
    return;
  }
  
  // Mark as processing
  queue.processing = true;
  saveQueue(queue);
  
  // Process first search
  const search = queue.pendingSearches[0];
  console.log(`\nProcessing search: "${search.term}" in ZIP ${search.zip}`);
  console.log(`Requested at: ${search.requestedAt}`);
  
  try {
    // Scrape (simplified - would use browser)
    const allListings = [];
    allListings.push(...await scrapeReverb(search.term));
    
    // For demo, create placeholder results
    // In production, this would be real scraped data
    const top3 = getTop3Cheapest(allListings);
    
    if (top3.length === 0) {
      // No results found - save empty with message
      saveGearResults(search.term, search.zip, []);
    } else {
      saveGearResults(search.term, search.zip, top3);
    }
    
    // Remove from queue
    queue.pendingSearches.shift();
    
    // Commit and push
    const success = gitPush(`Gear Hunt: Search results for "${search.term}"`);
    
    if (success) {
      console.log(`✅ Completed search for "${search.term}"`);
    } else {
      // Put back in queue if push failed
      queue.pendingSearches.unshift(search);
      console.log('⚠️ Push failed, will retry');
    }
    
  } catch (error) {
    console.error('Processing error:', error);
    // Put back in queue
    queue.pendingSearches.unshift(search);
  }
  
  queue.processing = false;
  saveQueue(queue);
}

// Main
async function main() {
  console.log('Gear Hunt Queue Processor');
  console.log('========================');
  console.log(`Time: ${new Date().toISOString()}\n`);
  
  await processQueue();
  
  console.log('\nDone.');
}

main().catch(console.error);
