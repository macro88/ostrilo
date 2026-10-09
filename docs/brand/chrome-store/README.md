# Ostrilo Chrome Web Store graphics

Upload-ready English listing assets, prepared and visually reviewed on
7 October 2026. Upload the PNG files individually to the matching dashboard
fields. Use screenshots in their numbered order.

| Dashboard field | File | Dimensions | Format |
| --- | --- | --- | --- |
| Store icon | `store-icon-128.png` | 128 × 128 | PNG with transparency |
| Small promo tile | `small-promo-440x280.png` | 440 × 280 | 24-bit RGB PNG, no alpha |
| Marquee promo tile | `marquee-promo-1400x560.png` | 1400 × 560 | 24-bit RGB PNG, no alpha |
| Screenshot 1: Home | `screenshot-01-your-keys-1280x800.png` | 1280 × 800 | 24-bit RGB PNG, no alpha |
| Screenshot 2: Signing | `screenshot-02-signing-1280x800.png` | 1280 × 800 | 24-bit RGB PNG, no alpha |
| Screenshot 3: Identities | `screenshot-03-identities-1280x800.png` | 1280 × 800 | 24-bit RGB PNG, no alpha |
| Screenshot 4: Permissions | `screenshot-04-permissions-1280x800.png` | 1280 × 800 | 24-bit RGB PNG, no alpha |
| Screenshot 5: Activity | `screenshot-05-activity-1280x800.png` | 1280 × 800 | 24-bit RGB PNG, no alpha |

The icon has 96 × 96 artwork centered on a 128 × 128 transparent canvas,
leaving a 16-pixel margin. The original mascot is preserved in every composition.
The other assets have opaque, full-bleed backgrounds, square canvas corners,
and no personal image metadata. Tiles remain readable at half size.

## Sources

- Mascot: `src/assets/icon.png` in this repository.
- Type: bundled Archivo, with the existing Inkline and Deep Ink colours.
- Real extension UI: the production-build September 2026 design-review captures
  under `docs/design-review/screenshots`. Screens 1, 2, and 5 place the captures
  within captioned layouts. Screens 3 and 4 retain the original UI pixels and
  remove only the empty bottom 100 pixels of the settings captures.
- The displayed profile, public-key fragments, site origins, and requests are
  synthetic design-review fixtures. No live identity, private key, password,
  backup, account contact detail, or personal workstation path is included.
- These assets do not modify the extension manifest or its bundled icons.

Verified dimensions, PNG bit depth, colour type, transparency, image metadata,
and visual layout for every file. No application source changed.

[Chrome Web Store image requirements](https://developer.chrome.com/docs/webstore/images)
were checked when preparing these exports. The marquee tile is optional. A
promo video is not required by the image requirements and is not supplied.
