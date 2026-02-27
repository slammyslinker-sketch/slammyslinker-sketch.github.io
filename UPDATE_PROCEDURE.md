# Willy's Adventure Zone - Update Procedure

**Last Updated:** 2026-02-26

## Overview

This document outlines the complete procedure for updating the Willy's Adventure Zone house hunt site hosted on GitHub Pages.

## Prerequisites

1. **OpenClaw Browser Relay Active**
   - Chrome extension must be installed and enabled
   - Navigate to Realtor.com in Chrome
   - Click the OpenClaw extension icon (badge should show "ON")
   - This is **critical** — Kasada bot protection blocks all headless browsers (Playwright, Puppeteer, Selenium)

2. **GitHub Access**
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

**Critical:** Use `profile="chrome"` — do NOT use Playwright/Puppeteer

```javascript
// Navigate to search page
browser({
  action: "open",
  profile: "chrome",
  targetUrl: "https://www.realtor.com/realestateandhomes-search/29710"
})

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

**Image URL Tips:**
- Realtor.com images are hosted on `ap.rdcpix.com`
- URLs often end in `.webp` but you can download as `.jpg`
- Use the largest available size (URLs often have `w1280_h960` or similar)

### Step 5: Update listings.json

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
  "notes": "Brief description or status"
}
```

**Important:**
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

### Step 7: Update index.html (if template changes needed)

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

```javascript
// Wait 30 seconds for GitHub Pages to start deploying
await new Promise(r => setTimeout(r, 30000));

// Fetch the live listings.json and verify timestamp
const fetch = require('node-fetch');
const response = await fetch('https://slammyslinker-sketch.github.io/listings.json');
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

**If site doesn't update within 2 minutes:**
1. Try force-pushing an amended commit: `git commit --amend --no-edit && git push --force`
2. Check GitHub Pages settings for build errors
3. Manually verify at https://slammyslinker-sketch.github.io/listings.json
4. Report failure to main session if unable to resolve

## Troubleshooting

### Browser Relay Not Working
- Ensure Chrome tab is active and Realtor.com is loaded
- Check extension badge shows "ON"
- Try clicking the extension icon again to re-attach

### Kasada Block Page
- If you see "Your request could not be processed" with a reference ID, the browser relay isn't being used
- Double-check you're using `profile="chrome"` not default Playwright

### Image Download Issues
- Some images may require the `Referer` header set to `https://www.realtor.com/`
- Use `curl -L -H "Referer: https://www.realtor.com/" ...`

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
