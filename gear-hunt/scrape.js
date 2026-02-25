const fs = require('fs');
const path = require('path');

// Simple fetch-based scraper (no browser needed for basic sites)
async function fetchWithTimeout(url, timeout = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    clearTimeout(timer);
    return response;
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

// Extract price as number for sorting
function extractPrice(priceStr) {
  if (!priceStr) return Infinity;
  const match = priceStr.match(/[\d,]+\.?\d*/);
  if (match) {
    return parseFloat(match[0].replace(/,/g, ''));
  }
  return Infinity;
}

// Get 3 cheapest listings from all sources
function getTop3Cheapest(listings) {
  return listings
    .filter(l => l.price && l.price !== 'Price not shown')
    .sort((a, b) => extractPrice(a.price) - extractPrice(b.price))
    .slice(0, 3);
}

// Simple HTML scraper for Reverb
async function scrapeReverb(searchTerm) {
  const listings = [];
  try {
    const url = `https://reverb.com/marketplace?query=${encodeURIComponent(searchTerm)}`;
    const response = await fetchWithTimeout(url);
    const html = await response.text();
    
    // Simple regex-based extraction (works for basic scraping)
    const itemRegex = /href="(\/item\/[^"]+)"[^>]*>[\s\S]*?<h[23][^>]*>([^<]+)<[\s\S]*?(?:\$[\d,]+(?:\.\d{2})?)/gi;
    const priceRegex = /\$([\d,]+(?:\.\d{2})?)/g;
    
    // Find all listing blocks
    const blocks = html.match(/href="\/item\/[^"]+"[\s\S]{0,2000}?\$[\d,]+/gi) || [];
    
    for (const block of blocks.slice(0, 20)) {
      const urlMatch = block.match(/href="(\/item\/[^"]+)"/);
      const titleMatch = block.match(/<h[23][^>]*>([^<]+)</);
      const priceMatches = block.match(/\$([\d,]+(?:\.\d{2})?)/g);
      
      if (urlMatch && titleMatch) {
        // Get the lowest price from all prices found
        let price = 'Price not shown';
        if (priceMatches && priceMatches.length > 0) {
          const prices = priceMatches.map(p => extractPrice(p)).filter(p => p > 0);
          if (prices.length > 0) {
            const minPrice = Math.min(...prices);
            price = `$${minPrice.toLocaleString()}`;
          }
        }
        
        listings.push({
          title: titleMatch[1].trim(),
          price: price,
          url: `https://reverb.com${urlMatch[1].split('?')[0]}`,
          source: 'Reverb',
          condition: 'Used',
          location: 'Ships nationwide'
        });
      }
    }
    
    console.log(`Found ${listings.length} listings on Reverb`);
  } catch (e) {
    console.log('Reverb error:', e.message);
  }
  return listings;
}

// Scrape eBay (simpler version)
async function scrapeEbay(searchTerm, zipCode) {
  const listings = [];
  try {
    const url = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(searchTerm)}&_sacat=619`;
    const response = await fetchWithTimeout(url);
    const html = await response.text();
    
    // Extract eBay listings
    const blocks = html.match(/<li class="s-item"[\s\S]{0,3000}?<\/li>/gi) || [];
    
    for (const block of blocks.slice(1, 15)) {
      const titleMatch = block.match(/class="s-item__title"[^>]*>(?:<span[^>]*>)?([^<]+)/);
      const priceMatch = block.match(/class="s-item__price"[^>]*>([^<]+)/);
      const urlMatch = block.match(/class="s-item__link" href="([^"]+)"/);
      
      if (titleMatch && priceMatch && urlMatch) {
        listings.push({
          title: titleMatch[1].replace('Shop on eBay', '').trim(),
          price: priceMatch[1].trim(),
          url: urlMatch[1],
          source: 'eBay',
          condition: 'Varies',
          location: zipCode
        });
      }
    }
    
    console.log(`Found ${listings.length} listings on eBay`);
  } catch (e) {
    console.log('eBay error:', e.message);
  }
  return listings;
}

// Sanitize inputs
function sanitizeInput(input, type) {
  if (type === 'zip') {
    const cleaned = input.replace(/\D/g, '').slice(0, 5);
    if (!/^\d{5}$/.test(cleaned)) throw new Error('Invalid ZIP');
    return cleaned;
  }
  if (type === 'search') {
    const cleaned = input.replace(/[<>"'`;${}]/g, '').trim().slice(0, 100);
    if (cleaned.length < 2) throw new Error('Search too short');
    return cleaned;
  }
  throw new Error('Unknown type');
}

async function main() {
  let searchTerm = process.env.SEARCH_TERM || process.argv[2];
  let zipCode = process.env.ZIP_CODE || process.argv[3];
  
  if (!searchTerm || !zipCode) {
    console.error('Usage: SEARCH_TERM="Fender Strat" ZIP_CODE=29710 node scrape.js');
    process.exit(1);
  }
  
  searchTerm = sanitizeInput(searchTerm, 'search');
  zipCode = sanitizeInput(zipCode, 'zip');
  
  console.log(`Scraping: "${searchTerm}" in ZIP ${zipCode}`);
  console.log('Getting top 3 cheapest results...\n');
  
  const allListings = [];
  
  allListings.push(...await scrapeReverb(searchTerm));
  allListings.push(...await scrapeEbay(searchTerm, zipCode));
  
  // Get 3 cheapest
  const top3 = getTop3Cheapest(allListings);
  
  console.log(`\nTop 3 cheapest:`);
  top3.forEach((l, i) => {
    console.log(`${i+1}. ${l.title} - ${l.price} (${l.source})`);
  });
  
  // Save results
  const outputPath = path.join(__dirname, 'gear.json');
  const data = {
    lastUpdated: new Date().toISOString(),
    lastSearch: {
      term: searchTerm,
      zip: zipCode,
      timestamp: new Date().toISOString()
    },
    listings: top3
  };
  
  fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));
  console.log(`\nSaved ${top3.length} listings to gear.json`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
