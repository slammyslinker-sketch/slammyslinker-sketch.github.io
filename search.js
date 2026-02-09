#!/usr/bin/env node
/**
 * House Hunter - Search and update listings
 * 
 * Searches Realtor.com for houses matching criteria:
 * - Zips: 29710, 29745, 29720, 29730
 * - Price: $300k-$400k
 * - Beds: 3-4
 * - Baths: 2.5+
 * - Sqft: 1800-2200
 */

const fs = require('fs');
const path = require('path');

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

// Read current listings
function loadListings() {
  const filePath = path.join(CONFIG.repoPath, CONFIG.listingsFile);
  try {
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error loading listings:', error.message);
    return { listings: [], lastUpdated: null };
  }
}

// Save listings
function saveListings(data) {
  const filePath = path.join(CONFIG.repoPath, CONFIG.listingsFile);
  data.lastUpdated = new Date().toISOString();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  console.log(`Saved ${data.listings.length} listings`);
}

// Filter listing by criteria
function matchesCriteria(listing) {
  // Parse price (handle formats like "$350,000" or "From$480,000")
  const priceStr = listing.price.replace(/[^0-9]/g, '');
  const price = parseInt(priceStr, 10);
  
  if (price < CONFIG.priceMin || price > CONFIG.priceMax) {
    return false;
  }
  
  // Check beds
  if (listing.beds < CONFIG.bedsMin || listing.beds > CONFIG.bedsMax) {
    return false;
  }
  
  // Check baths
  if (listing.baths < CONFIG.bathsMin) {
    return false;
  }
  
  // Check sqft
  if (listing.sqft < CONFIG.sqftMin || listing.sqft > CONFIG.sqftMax) {
    return false;
  }
  
  return true;
}

// Generate mock listings for demonstration
// In production, this would scrape Realtor.com
function generateMockListings() {
  const mockListings = [
    {
      id: '1',
      address: '123 Main Street',
      city: 'Clover',
      state: 'SC',
      zip: '29710',
      price: '$350,000',
      beds: 3,
      baths: 2.5,
      sqft: 1950,
      status: 'For Sale',
      url: 'https://www.realtor.com/realestateandhomes-detail/123-Main-St_Clover_SC_29710',
      isNew: true
    },
    {
      id: '2',
      address: '456 Oak Avenue',
      city: 'Lake Wylie',
      state: 'SC',
      zip: '29710',
      price: '$375,000',
      beds: 4,
      baths: 3,
      sqft: 2100,
      status: 'For Sale',
      url: 'https://www.realtor.com/realestateandhomes-detail/456-Oak-Ave_Lake-Wylie_SC_29710',
      isNew: true
    },
    {
      id: '3',
      address: '789 Pine Road',
      city: 'Fort Mill',
      state: 'SC',
      zip: '29720',
      price: '$325,000',
      beds: 3,
      baths: 2.5,
      sqft: 1850,
      status: 'For Sale',
      url: 'https://www.realtor.com/realestateandhomes-detail/789-Pine-Rd_Fort-Mill_SC_29720',
      isNew: false
    }
  ];
  
  return mockListings.filter(matchesCriteria);
}

// Main search function
async function searchListings() {
  console.log('Starting house hunt search...');
  console.log('Criteria:', CONFIG);
  
  const existingData = loadListings();
  const existingIds = new Set(existingData.listings.map(l => l.id));
  
  // Generate new listings (replace with actual scraping)
  const newListings = generateMockListings();
  
  // Mark new listings
  newListings.forEach(listing => {
    if (!existingIds.has(listing.id)) {
      listing.isNew = true;
      console.log(`New listing found: ${listing.address} - ${listing.price}`);
    } else {
      listing.isNew = false;
    }
  });
  
  // Sort by price
  newListings.sort((a, b) => {
    const priceA = parseInt(a.price.replace(/[^0-9]/g, ''), 10);
    const priceB = parseInt(b.price.replace(/[^0-9]/g, ''), 10);
    return priceA - priceB;
  });
  
  const data = {
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
    listings: newListings
  };
  
  saveListings(data);
  
  return newListings.length;
}

// Git commit and push
async function gitPush() {
  const { execSync } = require('child_process');
  
  try {
    process.chdir(CONFIG.repoPath);
    
    // Configure git if not already done
    try {
      execSync('git config user.email "openclaw@localhost"', { stdio: 'ignore' });
      execSync('git config user.name "OpenClaw Bot"', { stdio: 'ignore' });
    } catch (e) {
      // Already configured
    }
    
    // Check if there are changes
    const status = execSync('git status --porcelain', { encoding: 'utf8' });
    
    if (!status.trim()) {
      console.log('No changes to commit');
      return;
    }
    
    // Add, commit, push
    execSync('git add listings.json');
    execSync(`git commit -m "Update listings: ${new Date().toISOString()}"`);
    execSync('git push origin main');
    
    console.log('Successfully pushed to GitHub');
  } catch (error) {
    console.error('Git error:', error.message);
    throw error;
  }
}

// Main
async function main() {
  try {
    const count = await searchListings();
    console.log(`Found ${count} matching listings`);
    
    await gitPush();
    console.log('House hunt update complete!');
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { searchListings, gitPush };
