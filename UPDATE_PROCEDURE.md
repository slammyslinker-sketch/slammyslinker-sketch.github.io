# Willy's Adventure Zone - Update Procedure

**Last Updated:** 2026-02-26

## Overview

This document outlines the complete procedure for updating the Willy's Adventure Zone house hunt site hosted on GitHub Pages.

## Prerequisites

### 1. OpenClaw Browser Relay Active (CRITICAL)

**⚠️ WARNING: The subagent MUST use the existing Chrome instance. Do NOT let it open a new browser instance — the extension won't work there!**

**Before spawning the subagent:**
1. Open **Google Chrome** (the existing instance you use daily)
2. Navigate to Realtor.com in a tab
3. Click the **OpenClaw extension icon** (badge should show "ON")
4. **Keep this Chrome window open** — the subagent will connect to it

**When the subagent runs:**
- It MUST use `profile="chrome"` — this connects to your existing Chrome
- It MUST create a **new tab** in the existing browser, not open a new browser instance
- Kasada bot protection blocks all headless browsers (Playwright, Puppeteer, Selenium)

**If the subagent tries to open a new Chromium instance, STOP IT.** The relay extension only works in the existing Chrome instance where it's been manually attached.

### 2. GitHub Access
- Repo: `slammyslinker-sketch/slammyslinker-sketch.github.io`
- Ensure push access is configured

## Update Procedure

### Step 1: Spawn Subagent

**Always use a subagent for this task.** The main session should stay responsive for communication.

```bash
sessions_spawn({
  label: "willys-adventure-zone-update",
  mode: "run",
  runTimeoutSeconds: 600,
  task: "Update Willy's Adventure Zone house hunt site..."
})
```

### Step 2: Read Current State

1. Read `willy-site/listings.json` to get existing listings
2. Note the total count and any listings marked as `isNew: true`
3. Read `willy-site/index.html` to understand the template structure

### Step 3: Extract New Listings via Browser Relay

**⚠️ CRITICAL: Use the EXISTING Chrome instance — do NOT open a new browser**

**Correct approach:**
```javascript
// Open a NEW TAB in the existing Chrome instance
// profile="chrome" connects to the relay-attached browser
browser({
  action: "open",
  profile: "chrome",  // ← CRITICAL: Uses existing Chrome, not new browser
  targetUrl: "https://www.realtor.com/realestateandhomes-search/29710"
})

// The subagent now has control of a new tab in your existing Chrome
// Wait for listings to load
browser({
  action: "act",
  request: {
    kind: "wait",
    timeMs: 3000
  }
})

// Get page snapshot
browser({ action: "snapshot" })

// Extract listing data using JavaScript evaluation
browser({
  action: "act",
  request: {
    kind: "evaluate",
    fn: `
      const listings = [];
      const cards = document.querySelectorAll('[data-testid="property-card"]');
      cards.forEach(card => {
        // Extract address, price, beds, baths, sqft, etc.
        // Get property detail page URL
      });
      return listings;
    `
  }
})
```

**WRONG approach (DO NOT DO THIS):**
```javascript
// ❌ This opens a NEW browser instance - extension won't work!
browser({
  action: "open",
  targetUrl: "..."  // No profile specified = new Chromium instance
})
```

### Step 4: Extract High-Quality Images

**Best Practice:** Get direct CDN URLs, not screenshots

```javascript
// Navigate to individual property page
browser({
  action: "act",
  request: {
    kind: "click",
    ref: "property-card-link"
  }
})

// Extract hero image URL
browser({
  action: "act",
  request: {
    kind: "evaluate",
    fn: `
      const heroImg = document.querySelector('img[alt*="featured"], img[alt*="yard"], .hero-image img');
      return heroImg ? heroImg.src : null;
    `
  }
})
```

**⚠️ CRITICAL: Listings Without Photos**

Some listings (especially new construction) may not have photos in the CDN. **You MUST capture a screenshot of the property front in these cases.**

```javascript
// If no hero image URL found, take a screenshot
const imageUrl = await browser({
  action: "act",
  request: {
    kind: "evaluate",
    fn: `
      const heroImg = document.querySelector('img[alt*="featured"], img[alt*="yard"], .hero-image img');
      return heroImg ? heroImg.src : null;
    `
  }
});

if (!imageUrl) {
  // No photo available - capture screenshot of property page
  // This shows the property front or placeholder
  const screenshot = await browser({
    action: "screenshot",
    fullPage: false  // Just the visible viewport showing property
  });
  // Save screenshot as property image
}
```

**Image URL Tips:**
- Realtor.com images are hosted on `ap.rdcpix.com`
- URLs often end in `.webp` but you can download as `.jpg`
- Use the largest available size (URLs often have `w1280_h960` or similar)
- **If no CDN image exists, screenshot is required** — listings without images look broken on the site

### Step 5: Extract HOA Information (CRITICAL)

**⚠️ VITAL: Check for HOA fees on EVERY listing. This affects the true cost of the home.**

While on the property detail page (from Step 4), extract HOA information:

```javascript
// Extract HOA information
browser({
  action: "act",
  request: {
    kind: "evaluate",
    fn: `
      // Check multiple possible locations for HOA data
      let hoa = null;
      
      // Method 1: Look for HOA test IDs
      const hoaElements = document.querySelectorAll('[data-testid*="hoa"], [data-testid*="association"]');
      for (const el of hoaElements) {
        const text = el.textContent;
        if (text.includes('$') || text.includes('/mo') || text.includes('/month') || text.includes('monthly')) {
          hoa = text.trim();
          break;
        }
      }
      
      // Method 2: Check property details/facts sections
      if (!hoa) {
        const detailsSections = document.querySelectorAll('[data-testid="property-details"], .property-details, [data-testid="property-facts"], .facts-container');
        for (const section of detailsSections) {
          const text = section.textContent;
          const hoaMatch = text.match(/HOA[\s\/\-]*(?:fee|dues)?[:\s]*\$?([\d,]+(?:\.\d{2})?)\s*(?:\/|\s*per\s*)?\s*(mo|month|monthly|yr|year|annual)?/i);
          if (hoaMatch) {
            const amount = hoaMatch[1];
            const period = hoaMatch[2] || 'mo';
            hoa = '$' + amount + '/' + period;
            break;
          }
        }
      }
      
      // Method 3: Look for "Association" or "HOA" in any text
      if (!hoa) {
        const allText = document.body.innerText;
        const hoaRegex = /(?:HOA|Homeowners?\s*Association|Association)\s*(?:fee|dues)?[:\s]*\$?([\d,]+)/i;
        const match = allText.match(hoaRegex);
        if (match) {
          hoa = '$' + match[1] + '/mo';
        }
      }
      
      return hoa; // Returns null if no HOA found, or string like "$150/mo"
    `
  }
})
```

**HOA Data to Record:**
- If HOA exists: Store the fee amount (e.g., "$150/mo", "$500/year")
- If no HOA: Set `hoa: null` in listings.json

**⚠️ DO NOT SKIP THIS STEP** — Even if you think a property doesn't have an HOA, verify by checking the page.

### Step 6: Update listings.json

Structure for each listing:
```json
{
  "id": "realtor-com-unique-id",
  "address": "123 Main St, City, ST 12345",
  "price": "$350,000",
  "beds": 3,
  "baths": 2,
  "sqft": 2100,
  "image": "https://ap.rdcpix.com/.../image.jpg",
  "url": "https://www.realtor.com/realestateandhomes-detail/...",
  "isNew": true,
  "hoa": "$150/mo",
  "notes": "Brief description or status"
}
```

**⚠️ CRITICAL - HOA Field:**
- **ALWAYS** check for HOA fees during extraction (Step 5)
- If HOA exists: Record the fee (e.g., `"hoa": "$150/mo"` or `"hoa": "$1,800/year"`)
- If NO HOA: Set `"hoa": null` (not undefined, not empty string)
- The site displays HOA fees prominently in red on listing cards
- The site counts and displays how many homes have HOAs

**Other Important Fields:**
- Set `isNew: true` for all newly added listings
- Set `isNew: false` for older listings that were previously marked new
- Update the `lastUpdated` timestamp at the top of the file

### Step 6: Download Images

```bash
# Download each image to willy-site/images/
curl -L -o "willy-site/images/property-id.jpg" "https://ap.rdcpix.com/.../image.jpg"

# Verify the download
file willy-site/images/property-id.jpg
# Should output: "JPEG image data, ..."
```

### Step 7: Update index.html to Display All Listings

**⚠️ IMPORTANT:** After updating `listings.json`, you MUST verify that `index.html` displays all listings.

The JavaScript in index.html loads listings dynamically from `listings.json`. After adding new listings:

1. **Check that index.html loads from listings.json correctly**
   - Look for the `loadListings()` function
   - Ensure it fetches `listings.json` (not hardcoded data)
   - Verify there's no limit/filter preventing display

2. **If listings don't appear after push:**
   - Browser cache may be holding old JS
   - Try cache-busting: add `?v=2` to the page URL
   - Or hard-refresh: Ctrl+Shift+R (or Cmd+Shift+R on Mac)

3. **If still not showing all listings:**
   - Check browser console for JavaScript errors
   - Verify `listings.json` is valid JSON (no syntax errors)
   - Ensure fetch URL is correct: `listings.json` (relative path)

**If you need to update index.html template:**
The site uses a card-based layout. Each listing generates a card with:
- Image (top)
- Price (prominent)
- Address
- Beds / Baths / Sqft
- "NEW" badge (if isNew is true)
- Link to Realtor.com detail page

### Step 8: Commit and Push

```bash
# Stage changes
git add willy-site/listings.json
git add willy-site/images/
git add willy-site/index.html  # if modified

# Commit with descriptive message
git commit -m "Update listings: added X new properties, updated timestamps

- Added: [Address 1], [Address 2], ...
- Updated isNew flags for existing listings
- Downloaded property images
- Total listings: XX"

# Push to GitHub
git push origin main
```

### Step 9: Verify Site Update (CRITICAL)

**Must be performed by subagent to confirm deployment:**

**Option A: HTTP Fetch (Recommended for verification)**
```javascript
// Wait 30 seconds for GitHub Pages to start deploying
await new Promise(r => setTimeout(r, 30000));

// Fetch the live listings.json and verify timestamp
const fetch = require('node-fetch');
const response = await fetch('https://slammyslinker-sketch.github.io/listings.json?v=' + Date.now());
const data = await response.json();

// Compare timestamps
const expectedTimestamp = "2026-02-26T21:20:00.000Z"; // Use actual timestamp from your update
if (data.lastUpdated === expectedTimestamp) {
  console.log("✅ Site updated successfully!");
} else {
  console.log("⚠️ Site not updated yet. GitHub Pages may be delayed.");
  console.log("Expected:", expectedTimestamp);
  console.log("Got:", data.lastUpdated);
}
```

**Option B: Visual Verification via Browser (Use existing Chrome!)**
If you need to visually verify the site:
```javascript
// Open site in a NEW TAB in the existing Chrome instance
browser({
  action: "open",
  profile: "chrome",  // ← CRITICAL: Use existing Chrome, not new browser
  targetUrl: "https://slammyslinker-sketch.github.io/"
})

// Take screenshot to verify
browser({ action: "screenshot", fullPage: true })
```

**If site doesn't update within 2 minutes:**
1. Try force-pushing an amended commit: `git commit --amend --no-edit && git push --force`
2. Check GitHub Pages settings for build errors
3. Manually verify at https://slammyslinker-sketch.github.io/listings.json
4. **If still not working — SPAWN DIAGNOSTIC SUBAGENT:**
   ```javascript
   sessions_spawn({
     label: "diagnose-github-pages-issue",
     mode: "run",
     runTimeoutSeconds: 600,
     task: "Diagnose why GitHub Pages site is not reflecting updates...",
     thinking: "high"  // ← High thinking for complex diagnosis
   })
   ```
5. Report failure to main session if unable to resolve

### Step 10: Verify All Listings Display and HOA Data (CRITICAL)

**Just because listings.json updated doesn't mean they appear on the site!**

**Verify count matches:**
```javascript
// Check that all listings appear on the live site
const fetch = require('node-fetch');
const response = await fetch('https://slammyslinker-sketch.github.io/listings.json?v=' + Date.now());
const data = await response.json();

console.log(`Total listings in JSON: ${data.listings.length}`);
// Should be 17 (or whatever your count is)
```

**Verify HOA data is correct:**
```javascript
// Check HOA counts
const listingsWithHOA = data.listings.filter(l => l.hoa !== null);
console.log(`Listings with HOA: ${listingsWithHOA.length}`);
listingsWithHOA.forEach(l => {
  console.log(`- ${l.address}: ${l.hoa}`);
});

// Verify HOA displays correctly on site
browser({
  action: "open",
  profile: "chrome",
  targetUrl: "https://slammyslinker-sketch.github.io/"
})

// Check HOA count banner
browser({
  action: "act",
  request: {
    kind: "evaluate",
    fn: `
      const hoaBanner = document.getElementById('hoaCount');
      hoaBanner ? hoaBanner.textContent : 'HOA banner not found'
    `
  }
})

// Check that listing cards show HOA fees
browser({
  action: "act",
  request: {
    kind: "evaluate",
    fn: `
      const hoaCards = document.querySelectorAll('.listing-hoa');
      return Array.from(hoaCards).map(card => card.textContent);
    `
  }
})
```

**Visual verification:**
```javascript
// Open site and count visible listing cards
browser({
  action: "open",
  profile: "chrome",
  targetUrl: "https://slammyslinker-sketch.github.io/"
})

// Get count of listing cards
browser({
  action: "act",
  request: {
    kind: "evaluate",
    fn: `document.querySelectorAll('.listing-card').length`
  }
})

// Should match data.listings.length
```

**If count doesn't match:**
1. Check browser console for JS errors
2. Verify index.html loads listings.json correctly
3. Try cache-busting with `?v=2` query param
4. If needed, spawn subagent to fix index.html:
   ```javascript
   sessions_spawn({
     label: "fix-index-html-display",
     mode: "run",
     runTimeoutSeconds: 600,
     task: "Fix index.html to display all listings from listings.json..."
   })
   ```

**If HOA data is missing or incorrect:**
1. Re-check the property detail page on Realtor.com for HOA info
2. Update listings.json with correct `hoa` field
3. Verify the site displays HOA fees (red text on listing cards)
4. Verify the HOA count banner shows correct number
5. If extraction missed HOA data, improve the extraction regex/pattern

## Troubleshooting

### Browser Opens New Instance (CRITICAL)
**Problem:** Subagent tries to open a new Chromium browser instead of using existing Chrome.

**Symptoms:**
- New browser window opens
- OpenClaw extension icon not present
- Kasada blocks the request immediately

**Solution:**
1. **Kill the new browser instance immediately**
2. **Ensure subagent uses `profile="chrome"`** in ALL browser calls:
   ```javascript
   browser({
     action: "open",
     profile: "chrome",  // ← REQUIRED
     targetUrl: "..."
   })
   ```
3. **Verify the existing Chrome has the relay attached:**
   - Check extension badge shows "ON"
   - If not, click the extension icon to attach

**Prevention:**
- ALWAYS include `profile: "chrome"` in browser calls
- NEVER omit the profile parameter
- The subagent should create a **new tab**, not a **new browser**

### Browser Relay Not Working
- Ensure Chrome tab is active and Realtor.com is loaded
- Check extension badge shows "ON"
- Try clicking the extension icon again to re-attach

### Kasada Block Page / Rate Limit Hit
**Problem:** Realtor.com returns "Your request could not be processed" or rate limits extraction.

**If rate limited on Realtor.com — FALLBACK TO REDFIN:**

Spawn a subagent with high thinking to gather data from Redfin.com:

```javascript
sessions_spawn({
  label: "redfin-fallback-extraction",
  mode: "run",
  runTimeoutSeconds: 600,
  task: `Extract house listings from Redfin.com for zip codes 29710, 29745, 29720, 29730.
  
Criteria:
- Price: $300k-$400k
- Beds: 3-4
- Baths: 2+
- Sqft: 1800-2200

Use the OpenClaw browser relay (profile="chrome") to navigate Redfin.com.
Search each zip code and extract:
- Address
- Price
- Beds/Baths/Sqft
- HOA fees (if any)
- Property image URL
- Listing URL

Return data in same format as Realtor.com extraction.`,
  thinking: "high"
})
```

**Redfin extraction notes:**
- Navigate to: `https://www.redfin.com/zipcode/[ZIPCODE]`
- Use browser relay with `profile="chrome"` — existing Chrome instance only
- Look for `.HomeCard` or `[data-rf-test-name="home-card"]` selectors
- Extract from property detail pages for HOA and full images
- Redfin data structure may differ — map to our listings.json format

**Prevention on Realtor.com:**
- Add delays between requests (2-3 seconds)
- Use browser relay properly — don't trigger bot detection
- If you see Kasada block, immediately switch to Redfin fallback

### Image Download Issues
- Some images may require the `Referer` header set to `https://www.realtor.com/`
- Use `curl -L -H "Referer: https://www.realtor.com/" ...`

### HOA Data Missing or Incorrect (CRITICAL)
**Problem:** Listing has HOA fees on Realtor.com but not in listings.json, or HOA not displaying on site.

**Causes:**
1. Extraction script didn't check for HOA
2. HOA information in different location on page
3. HOA listed as "Association Fee" or similar, not "HOA"
4. Data not saved to listings.json correctly

**Solutions:**
1. **Re-extract with better selectors:**
   - Look for "Association", "Community", "HOA" in page text
   - Check property facts/details sections thoroughly
   - Try multiple regex patterns: `/\$[\d,]+\s*\/(?:mo|month)/i`

2. **Verify data in listings.json:**
   ```bash
   cat listings.json | grep -A5 -B5 '"hoa"'
   ```
   Should show `null` or a fee like `"$150/mo"`

3. **Check site displays correctly:**
   - Red "HOA" label should appear on card if `hoa` field is not null
   - HOA fee should show below the red label
   - Banner at top should count homes with HOA

**Prevention:**
- ALWAYS run HOA extraction code (Step 5)
- NEVER skip HOA check even if you think there's no HOA
- Verify by checking the actual property detail page
- If HOA found, record the full fee string with period (e.g., "$150/mo", "$1,800/year")

### Git Push Failures
- Check authentication is configured
- May need to pull first if there were remote changes

### GitHub Pages Deployment Issues
**Site doesn't reflect changes after push:**

1. **Wait 2-5 minutes** — GitHub Pages CDN can be slow
2. **Force a rebuild:**
   ```bash
   git commit --amend --no-edit
   git push --force-with-lease
   ```
3. **Check Actions tab** in GitHub repo for build errors
4. **Verify files committed:** `git show HEAD:listings.json`
5. **Bypass CDN cache** by adding `?nocache=1` to URL

**If still not working after 10 minutes:**
- Check Settings → Pages in GitHub repo for errors
- Make trivial change to index.html and push again
- Contact GitHub Support if persistent

## Files Reference

| File | Purpose |
|------|---------|
| `willy-site/listings.json` | Master data file with all listings |
| `willy-site/index.html` | Site template and layout |
| `willy-site/images/` | Property photos (named by listing ID) |
| `MEMORY.md` | High-level status and known issues |

## Current Listings Count

- **Total:** 17 listings
- **Last Update:** 2026-02-26
- **Coverage Area:** Fort Mill SC 29710 and surrounding areas

## Automation Notes

- Cron jobs exist for periodic checks (currently running every 11 hours)
- Manual updates via subagent provide better control and verification
- Always verify the browser relay is active before starting extraction
