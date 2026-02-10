# House Hunt Site - Photo Capture Lessons

## What Works for Getting Clean Exterior Photos

### ✅ Best Approach: Direct Image URL Extraction
1. Navigate to listing page
2. Use JavaScript to find hero image: `document.querySelector('img[alt*="featured"], img[alt*="yard"]').src`
3. Download image URL with `.jpg` extension (not `.webp`)
4. Verify with `file` command: should say "JPEG image data", NOT "Web/P"

### ❌ What Doesn't Work
- Screenshots of listing pages → captures UI elements (forms, banners, etc.)
- Downloading .webp files and renaming to .jpg → browser won't render properly

## Format Tips
- Realtor.com serves WebP by default
- Change URL from `.webp` to `.jpg` to get proper JPEG
- Always verify: `file image.jpg` should show "JPEG image data"

## Cache Busting
- GitHub Pages caches aggressively
- Rename files with `-v2` suffix when updating
- Or use query params: `?nocache=123`
- May need fresh browser session to see changes

## Image Quality
- Extracted photos: 1280x960 or 960x720 (good quality)
- Screenshots: Often mobile-optimized, tall/narrow (bad quality)

## Automation Script Pattern
```javascript
// Find hero image
const heroImg = document.querySelector('img[alt*="featured"], img[alt*="yard"]').src;
// Returns: https://ap.rdcpix.com/...l-m1234567890rd-w1280_h960.webp

// Download with .jpg extension to get JPEG format
```
