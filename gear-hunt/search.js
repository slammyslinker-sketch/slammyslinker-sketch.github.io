#!/usr/bin/env node
/**
 * Gear Hunt - Scrape music gear from multiple sites
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const CONFIG = {
  sites: {
    reverb: { enabled: true, name: 'Reverb' },
    ebay: { enabled: true, name: 'eBay' },
    musicgoround: { enabled: true, name: 'MusicGoRound' },
    guitarcenter: { enabled: true, name: 'Guitar Center' },
    craigslist: { enabled: false, name: 'Craigslist' },
    facebook: { enabled: false, name: 'Facebook' }
  },
  repoPath: '/home/mihr/.openclaw/workspace/willy-site/gear-hunt',
  gearFile: 'gear.json'
};

// Generate search URLs for each site
function generateSearchUrls(searchTerm, zipCode) {
  const encoded = encodeURIComponent(searchTerm);
  
  return {
    reverb: `https://reverb.com/marketplace?query=${encoded}`,
    ebay: `https://www.ebay.com/sch/i.html?_nkw=${encoded}&_sacat=619&_stpos=${zipCode}`,
    musicgoround: `https://www.musicgoround.com/search?q=${encoded}`,
    guitarcenter: `https://www.guitarcenter.com/search?Ntt=${encoded}&Ns=r`,
    craigslist: `https://${getCraigslistSubdomain(zipCode)}.craigslist.org/search/sss?query=${encoded}`,
  };
}

// Map ZIP to Craigslist subdomain (simplified — expand as needed)
function getCraigslistSubdomain(zip) {
  // Charlotte/Lake Wylie area
  if (['29710', '29745', '29720', '29730'].includes(zip)) return 'charlotte';
  // Add more regions as needed
  // Default to nationwide search if unknown
  return 'charlotte';
}

// Load existing gear data
function loadExistingGear() {
  try {
    const data = fs.readFileSync(path.join(CONFIG.repoPath, CONFIG.gearFile), 'utf8');
    return JSON.parse(data);
  } catch {
    return { listings: [] };
  }
}

// Save gear data
function saveGear(listings, searchTerm, zipCode) {
  const data = {
    lastUpdated: new Date().toISOString(),
    lastSearch: {
      term: searchTerm,
      zip: zipCode,
      timestamp: new Date().toISOString()
    },
    listings: listings
  };
  
  fs.writeFileSync(path.join(CONFIG.repoPath, CONFIG.gearFile), JSON.stringify(data, null, 2));
  console.log(`Saved ${listings.length} gear listings`);
}

// Git commit and push
function gitPush(message) {
  try {
    process.chdir(CONFIG.repoPath);
    
    const status = execSync('git status --porcelain', { encoding: 'utf8' });
    if (!status.trim()) {
      console.log('No changes to push');
      return;
    }
    
    execSync('git add .');
    execSync(`git commit -m "${message}"`);
    execSync('git push origin main');
    console.log('Pushed to GitHub');
  } catch (error) {
    console.error('Git error:', error.message);
  }
}

// Export for browser automation
module.exports = { 
  CONFIG, 
  generateSearchUrls, 
  loadExistingGear, 
  saveGear, 
  gitPush,
  getCraigslistSubdomain
};

// CLI usage
if (require.main === module) {
  const searchTerm = process.argv[2];
  const zipCode = process.argv[3];
  
  if (!searchTerm || !zipCode) {
    console.log('Usage: node search.js "search term" zipcode');
    console.log('Example: node search.js "Fender Stratocaster" 29710');
    process.exit(1);
  }
  
  console.log('Gear Hunt Scraper');
  console.log('=================');
  console.log(`Search: ${searchTerm}`);
  console.log(`ZIP: ${zipCode}`);
  console.log('');
  
  const urls = generateSearchUrls(searchTerm, zipCode);
  console.log('URLs to scrape:');
  Object.entries(urls).forEach(([site, url]) => {
    const enabled = CONFIG.sites[site]?.enabled ?? true;
    console.log(`  ${enabled ? '✓' : '✗'} ${site}: ${url}`);
  });
  
  console.log('');
  console.log('Run with browser automation to populate gear.json');
}
