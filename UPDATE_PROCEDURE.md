# Willy's Adventure Zone - Update Procedure

**Last Updated:** 2026-02-28

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
  runTimeoutSeconds: 900,
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
  "address": "123 Main St",
  "city": "City",
  "state": "ST",
  "zip": "12345",
  "price": 350000,
  "beds": 3,
  "baths": 2,
  "sqft": 2100,
  "lotSize": "0.5 acres",
  "yearBuilt": 2010,
  "hoa": "$150/mo",
  "status": "Active",
  "description": "Brief description",
  "image": "images/property-id.jpg",
  "url": "https://www.realtor.com/realestateandhomes-detail/...",
  "isNew": true
}
```

**⚠️ CRITICAL - Required Fields:**
- **status** (REQUIRED): Must be present on every listing. Use "Active", "Pending", "Contingent", etc.
- **hoa** (REQUIRED): Must be present. Use `"$150/mo"`, `"$1,800/year"`, or `null` if no HOA.
- **sqft** (REQUIRED): Must be a number or `null`. Do not omit this field.
- **price** (REQUIRED): Must be a number (not a string like "$350,000")
- **address** (REQUIRED): Street address only (no city/state/zip)
- **city, state, zip** (REQUIRED): Separate fields

**⚠️ DO NOT SKIP THESE FIELDS** — Missing fields will cause JavaScript errors on the site.

**Other Important Fields:**
- Set `isNew: true` for all newly added listings
- Set `isNew: false` for older listings that were previously marked new
- Update the `lastUpdated` timestamp at the top of the file

### Step 7: Download Images

```bash
# Download each image to willy-site/images/
curl -L -o "willy-site/images/property-id.jpg" "https://ap.rdcpix.com/.../image.jpg"

# Verify the download
file willy-site/images/property-id.jpg
# Should output: "JPEG image data, ..."
```

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

**Wait for deployment:** GitHub Pages takes 30-120 seconds to deploy.

**Verification Steps:**

1. **HTTP fetch to verify timestamp updated:**
```javascript
const fetch = require('node-fetch');
const response = await fetch('https://slammyslinker-sketch.github.io/listings.json?v=' + Date.now());
const data = await response.json();
console.log(`Listings count: ${data.listings.length}`);
console.log(`Last updated: ${data.lastUpdated}`);
```

2. **Browser verification (use existing Chrome):**
```javascript
// Open site with cache-busting
browser({
  action: "open",
  profile: "chrome",
  targetUrl: "https://slammyslinker-sketch.github.io/?v=" + Date.now()
})

// Wait for page to load, then check console for errors
browser({ action: "console" })
```

**If errors appear in console, diagnose immediately.** Common errors:
- `Cannot read properties of undefined (reading 'toLowerCase')` → Missing `status` field
- `Cannot read properties of null (reading 'toLocaleString')` → Missing or null `sqft` field

### Step 10: Post-Update Verification Checklist (CRITICAL)

**⚠️ DO NOT SKIP THIS STEP** — The site may break silently if data is malformed.

**Verify via browser:**
```javascript
// 1. Check no JavaScript errors
browser({ action: "console" })
// Should return: { ok: true, messages: [] }

// 2. Check listings count matches
browser({
  action: "act",
  request: {
    kind: "evaluate",
    fn: `document.querySelectorAll('.listing-card').length`
  }
})
// Should equal data.listings.length from Step 9

// 3. Check HOA count displays correctly
browser({
  action: "act",
  request: {
    kind: "evaluate",
    fn: `document.getElementById('hoaCount').textContent`
  }
})
// Should show: "X homes currently displayed have an HOA"

// 4. Check sample listing card renders correctly
browser({
  action: "act",
  request: {
    kind: "evaluate",
    fn: `
      const firstCard = document.querySelector('.listing-card');
      return {
        hasImage: firstCard.querySelector('img') !== null,
        hasPrice: firstCard.querySelector('.listing-price') !== null,
        hasAddress: firstCard.querySelector('.listing-address') !== null,
        hasStatus: firstCard.querySelector('.status-badge') !== null
      };
    `
  }
})
// All should be true
```

**If any check fails:**
1. Check `listings.json` for missing required fields
2. Verify `index.html` JavaScript handles null values properly
3. Fix data or code issues
4. Commit and push again
5. Re-verify

---

## Known Issues & Solutions

### Issue: Site Shows "Error loading listings"

**Causes:**
1. Missing `status` field in listings.json
2. Missing or null `sqft` field without proper handling
3. Malformed JSON

**Solutions:**

**Fix 1: Ensure all listings have required fields**
```bash
cd willy-site
python3 -c "
import json
with open('listings.json') as f:
    data = json.load(f)

for listing in data['listings']:
    # Ensure status exists
    if not listing.get('status'):
        listing['status'] = 'Active'
    # Ensure sqft exists (can be null, but field must exist)
    if 'sqft' not in listing:
        listing['sqft'] = None
    # Ensure hoa exists
    if 'hoa' not in listing:
        listing['hoa'] = None

with open('listings.json', 'w') as f:
    json.dump(data, f, indent=2)
"
```

**Fix 2: Update index.html to handle null values**

In the JavaScript template string that generates listing cards, replace:
```javascript
// OLD (crashes on null):
<span>${listing.sqft.toLocaleString()} sqft</span>

// NEW (handles null):
<span>${listing.sqft ? listing.sqft.toLocaleString() : 'N/A'} sqft</span>
```

Also ensure status is handled:
```javascript
// This assumes status exists:
<span class="status-badge ${listing.status.toLowerCase()}">${listing.status}</span>
```

### Issue: GitHub Pages Not Updating

**Symptoms:** Site shows old data after push

**Solutions:**
1. Wait 2-5 minutes for CDN cache
2. Add cache-busting query param: `?v=2` or `?v=` + Date.now()
3. Force rebuild: `git commit --amend --no-edit && git push --force`
4. Check GitHub repo → Settings → Pages for build errors

### Issue: Missing Images

**Symptoms:** Listings show 🏠 emoji instead of photos

**Causes:**
1. Image URLs in listings.json don't match downloaded files
2. Images not committed to git
3. Wrong file extension (webp saved as jpg)

**Verification:**
```bash
# Check images exist
ls -la willy-site/images/

# Check file types
file willy-site/images/*.jpg
```

---

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

---

## Files Reference

| File | Purpose |
|------|---------|
| `willy-site/listings.json` | Master data file with all listings |
| `willy-site/index.html` | Site template and layout |
| `willy-site/images/` | Property photos (named by listing ID) |
| `MEMORY.md` | High-level status and known issues |

## Current Listings Count

- **Total:** 31 listings
- **Last Update:** 2026-02-28
- **Coverage Area:** ZIP codes 29710, 29745, 29720, 29730

## Automation Notes

- Cron jobs exist for periodic checks (currently running every 11 hours)
- Manual updates via subagent provide better control and verification
- Always verify the browser relay is active before starting extraction
- **Always run post-update verification** to catch data issues before user sees them

---

## Incident Log

### 2026-02-28: "Error loading listings" After Update

**Problem:** Site showed "Error loading listings" after subagent update.

**Root Causes:**
1. **Missing `status` field:** Subagent didn't include `status` field in listings.json, causing `listing.status.toLowerCase()` to crash
2. **Null `sqft` value:** One listing (760 Bellegray Rd) had `sqft: null`, causing `listing.sqft.toLocaleString()` to crash

**Fixes Applied:**
1. Added `"status": "Active"` to all 31 listings
2. Updated JavaScript to handle null sqft: `${listing.sqft ? listing.sqft.toLocaleString() : 'N/A'} sqft`

**Prevention:**
- Added Step 10 (Post-Update Verification Checklist) to this procedure
- Documented required fields in Step 6
- Updated UPDATE_PROCEDURE.md with known issues section

**Verification:**
- All 31 listings now display correctly
- 2 homes with HOA fees properly highlighted
- No JavaScript errors in console
