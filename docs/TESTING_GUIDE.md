# Quick Start: Testing Profile Picture Upload

## Prerequisites
- Chrome or Firefox browser
- Node.js 20+ and Yarn installed
- Repository cloned locally

## Build the Extension

```bash
# Install dependencies
yarn install

# Build for Chrome
yarn build

# OR build for Firefox
yarn build:firefox
```

## Load Extension in Browser

### Chrome
1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked"
4. Select the `.output/chrome-mv3/` directory
5. Extension should appear with Ostrilo icon

### Firefox
1. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on"
3. Navigate to `.output/firefox-mv2/`
4. Select `manifest.json`
5. Extension should appear with Ostrilo icon

## Test Profile Picture Upload

### Setup
1. Click the Ostrilo extension icon
2. If first time, create or import a Nostr key
3. Navigate to the "Profile" tab
4. Click "Edit Profile" button

### Test Cases

#### ✅ Success Path
1. In edit mode, find the "Profile Picture URL" section
2. Click the "Upload Image" button
3. Select a JPEG image file (< 5MB)
4. **Expected:** Progress bar appears
5. **Expected:** Progress fills from 0% to 100%
6. **Expected:** Picture URL field populates automatically
7. **Expected:** Upload button returns to normal state
8. Click "Save Changes"
9. **Expected:** Profile saved, returns to view mode
10. **Expected:** Profile picture displays in view mode

#### ✅ File Type Validation
1. Click "Upload Image"
2. Select a `.txt` file
3. **Expected:** Error message: "Please select a valid image file..."
4. Try with `.pdf`, `.docx`, etc.
5. **Expected:** Same error message
6. Try with PNG, GIF, WebP
7. **Expected:** All upload successfully

#### ✅ File Size Validation
1. Create or find an image > 5MB
2. Click "Upload Image" and select the large file
3. **Expected:** Error message: "Image must be smaller than 5MB"
4. Try with image < 5MB
5. **Expected:** Uploads successfully

#### ✅ Remove Picture
1. Upload an image successfully (or manually enter a URL)
2. **Expected:** "Remove" button appears next to "Upload Image"
3. Click "Remove" button
4. **Expected:** Picture URL field clears
5. **Expected:** "Remove" button disappears

#### ✅ Cancel Edit
1. Upload an image
2. **Expected:** Picture URL field populated
3. Click "Cancel" button
4. **Expected:** Returns to view mode without saving
5. Click "Edit Profile" again
6. **Expected:** Previous picture URL still shows (if there was one)

#### ⚠️ Error Scenarios
1. Disconnect internet connection
2. Click "Upload Image" and select a file
3. **Expected:** Error message about upload failure
4. Reconnect internet
5. Try upload again
6. **Expected:** Works normally

#### ⚠️ During Upload
1. Click "Upload Image" and select a file
2. While progress bar is showing:
3. **Expected:** Upload button shows "Uploading..."
4. **Expected:** All form inputs are disabled
5. **Expected:** Cannot click Save/Cancel buttons
6. **Expected:** Cannot select another file
7. Wait for upload to complete
8. **Expected:** Everything re-enables

## Verify Integration

### Full Edit Cycle
1. Edit profile with picture upload
2. Edit name, about, website, etc.
3. Click "Save Changes"
4. **Expected:** All fields save including picture
5. Switch to view mode
6. **Expected:** All fields display correctly
7. **Expected:** Picture loads from uploaded URL

### Manual URL Entry
1. In edit mode, manually type/paste a picture URL
2. **Expected:** "Remove" button appears
3. Click "Remove"
4. **Expected:** URL clears
5. Now use "Upload Image" button
6. **Expected:** Works as normal

## Known Issues to Verify

### nostr.build API Availability
- If nostr.build is down, uploads will fail
- **Workaround:** Enter image URL manually
- **Future:** Add fallback image hosts

### Progress Bar Accuracy
- Progress is simulated (not real upload progress)
- May reach 90% quickly, then pause until upload completes
- **Expected behavior:** Not a bug

### Large Images
- Images are not compressed before upload
- 5MB image will upload full size
- May be slow on slow connections
- **Future:** Add client-side compression

## Troubleshooting

### Upload Button Does Nothing
- Check browser console for errors
- Verify nostr.build is accessible: https://nostr.build
- Try different image file
- Reload extension

### Error: "Invalid response from upload service"
- nostr.build API may have changed
- Check network tab for response
- Report issue with response details

### Picture URL Doesn't Populate
- Check if upload reached 100%
- Look for error message below upload button
- Try uploading again
- Check browser console

### Extension Won't Load
- Verify `yarn build` completed successfully
- Check for TypeScript errors: `yarn compile`
- Ensure WXT version 0.20.6 is installed
- Clear browser extension cache

## Success Criteria

All tests pass when:
- ✅ Valid images upload successfully
- ✅ Progress bar shows during upload
- ✅ Picture URL auto-populates
- ✅ Remove button works
- ✅ Validation prevents invalid files
- ✅ Validation prevents large files  
- ✅ Error messages are clear and helpful
- ✅ Uploaded picture displays in view mode
- ✅ Full profile save works with uploaded picture
- ✅ Extension remains stable (no crashes)

## Reporting Issues

If you encounter problems:

1. Check browser console for errors (F12 → Console tab)
2. Check network tab for failed requests (F12 → Network tab)
3. Note browser version and OS
4. Document steps to reproduce
5. Include screenshots if relevant
6. Report via GitHub issue with:
   - Browser and version
   - Steps to reproduce
   - Expected vs actual behavior
   - Console errors
   - Network response (if applicable)

## Advanced Testing

### Performance
- Upload 10 images in succession
- Verify no memory leaks
- Check extension background page memory

### Edge Cases
- Upload image with unicode filename
- Upload image from different domains
- Upload very small image (< 1KB)
- Upload image exactly 5MB
- Rapid click on upload button

### Browser Compatibility
- Test in Chrome (latest)
- Test in Firefox (latest)
- Test in Edge (Chromium-based)
- Test in Brave (Chromium-based)

## Next Steps After Testing

If all tests pass:
1. Document any issues found
2. Create bug reports for failures
3. Approve PR for merge
4. Update user documentation
5. Consider adding automated tests

---

**Note:** This is a manual testing guide. Automated E2E tests should be added in Task 5.2 (E2E Tests for Profile Editing).
