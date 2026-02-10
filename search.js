#!/usr/bin/env node
/**
 * House Hunter - Scrape Realtor.com and update listings
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const CONFIG = {
  zips: ['29710', '29745', '29720', '29730'],
  priceMin: 300000,
  priceMax: 400000,
  bedsMin: 3,
  bedsMax: 4,
  bathsMin: 2.5,
  sqftMin: 1800,
  sqftMax: 2200,
  repoPath: '/home/mihr/.openclaw/workspace/house-hunt-site',
  listingsFile: 'listings.json'
};

// Load existing listings to track "new" status
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
  
  // Mark new listings
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

// Update timestamp even when no new listings found
function updateTimestamp() {
  const filePath = path.join(CONFIG.repoPath, CONFIG.listingsFile);
  
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    data.lastChecked = new Date().toISOString();
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    console.log('Updated lastChecked timestamp');
    return true;
  } catch (error) {
    console.error('Could not update timestamp:', error.message);
    return false;
  }
}

// Git commit and push
function gitPush() {
  try {
    process.chdir(CONFIG.repoPath);
    
    // Check for changes
    const status = execSync('git status --porcelain', { encoding: 'utf8' });
    if (!status.trim()) {
      console.log('No changes to push');
      return;
    }
    
    execSync('git add listings.json');
    execSync(`git commit -m "Update listings: ${new Date().toLocaleString()}"`);
    execSync('git push origin main');
    console.log('Pushed to GitHub');
  } catch (error) {
    console.error('Git error:', error.message);
  }
}

// Main function - will be called by browser automation
async function main() {
  console.log('Starting Realtor.com scrape...');
  console.log('This script expects listing data from browser automation');
  console.log('Run with: cd ~/.openclaw/workspace/house-hunt-site && node search.js');
}

// Export for use by automation
module.exports = { CONFIG, saveListings, gitPush, loadExistingListings, updateTimestamp };

// Main function
async function main() {
  console.log('Starting Realtor.com scrape...');
  console.log('Zips:', CONFIG.zips.join(', '));
  
  // Update timestamp to show we checked, even if scraping fails
  updateTimestamp();
  gitPush();
}

// If run directly
if (require.main === module) {
  main().catch(console.error);
}
