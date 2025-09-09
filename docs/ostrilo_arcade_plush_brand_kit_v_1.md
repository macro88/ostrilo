# Ostrilo — Arcade Plush Brand Kit (v1)

Theme: **Arcade Plush** — chibi, candy colors, soft edges, playful bounce; still trustworthy for a Nostr signer.

---

## 1) Concept Snapshot
- **Promise:** Local keys, friendly flows, zero drama.
- **Persona:** A plush ostrich sidekick who stamps events, not snoops.
- **Tagline:** *“Press **Sign** to play.”*

---

## 2) Logo System & Marks
**Primary Lockup**
- Mascot head (chibi ostrich) + wordmark **Ostrilo**.
- Safe area: 0.5× cap-height around all sides.
- Min sizes:  
  - Wordmark lockup: ≥ 160px width (web).  
  - Icon-only: ≥ 24px (UI), ≥ 16px (favicon).

**Wordmark**
- Typeface: **Baloo 2** (SemiBold) with custom dot over “i” as a mini feather.
- Kerning: Slightly tightened; optical alignment to mascot.

**Mascot Mark (Head)**
- Shapes: round head, blush circles, tiny beak rhombus, three pixel-feather tufts.
- Use: extension icon, avatar, loading states, success toasts.

**Secondary Symbol: Key-Feather**
- A feather whose quill forms a key bit. Used on buttons and confirmations.

**Tertiary Badges**
- **npub** chip, **NIP‑07** badge, **Verified Local** stamp (for settings page).

**Don’t**
- No drop shadows under 16px size; switch to 1px outline.
- Don’t skew/rotate the wordmark.

### SVG Starter Files (editable)
**A. Key‑Feather (monotone)**
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" fill="none">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="96" y2="96">
      <stop offset="0" stop-color="#FF7AA2"/>
      <stop offset="1" stop-color="#9A77FF"/>
    </linearGradient>
  </defs>
  <path d="M19 63c17-20 39-38 59-43-5 20-23 42-43 59-5 5-12 7-17 6 0 0 1-7 6-12 3-3 7-5 12-7" stroke="url(#g)" stroke-width="8" stroke-linecap="round"/>
  <circle cx="66" cy="30" r="6" fill="#2B1E4B"/>
  <path d="M30 72h18m-10 0v10m10-10v10" stroke="#2B1E4B" stroke-width="6" stroke-linecap="round"/>
</svg>
```

**B. Mascot Head (flat icon)**
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" fill="none">
  <rect x="8" y="8" width="112" height="112" rx="28" fill="#FDF0FF"/>
  <circle cx="64" cy="68" r="36" fill="#FFE0EC"/>
  <circle cx="48" cy="68" r="8" fill="#2B1E4B"/>
  <circle cx="80" cy="68" r="8" fill="#2B1E4B"/>
  <path d="M64 78l10-10H54l10 10z" fill="#FFB3C7"/>
  <rect x="46" y="36" width="8" height="8" rx="2" fill="#9A77FF"/>
  <rect x="60" y="32" width="8" height="8" rx="2" fill="#9A77FF"/>
  <rect x="74" y="36" width="8" height="8" rx="2" fill="#9A77FF"/>
</svg>
```

**Extension Icons (export)**
- 16/32/48/128 px from Mascot Head; add 1px #2B1E4B stroke for 16px.

---

## 3) Color System
**Core Palette (Arcade Plush)**
- **Candy Pink** `#FF7AA2` (Primary A)
- **Lavender Pop** `#9A77FF` (Primary B)
- **Cotton Base** `#FDF0FF` (Base)
- **Deep Ink** `#2B1E4B` (Text / Outline)
- **Mint Coin** `#7DE3CC` (Accent / Success)
- **Peach Glow** `#FFD6A5` (Accent / Warning)
- **Plush Shadow** `#1D1530` (Elevations)

**Gradients**
- **Candy Nebula:** 180° `#FF7AA2 → #9A77FF`
- **Mint Bloom:** 180° `#7DE3CC → #FDF0FF`

**States**
- Success: Mint Coin on Ink, confetti dots (semi‑transparent pink/lavender).
- Danger: `#EF476F` over Cotton Base; use solid, avoid gradient.

---

## 4) Type System
- **Display / Brand:** Baloo 2 — SemiBold (H1), Medium (H2–H3)
- **UI / Body:** Inter — Regular/Medium/Semibold
- **Mono:** JetBrains Mono — for hashes/npubs

**Scale**
- H1 28/34 • H2 22/28 • H3 18/24 • Body 15/22 • Small 13/18 • Mono 13/18

**Radii & Elevation**
- Corners: **24px** (cards), **999px** (pills)
- Shadows: `0 6px 24px rgba(29,21,48,0.18)`; pressed `inset 0 2px 0 rgba(255,255,255,.6)`

---

## 5) UI Components (Spec & Behavior)
**A. Browser Action Popup (320×480)**
- **Header:** Mascot sticker, npub short (`npub1…abcd`), dropdown chevron.
- **Primary CTA:** “Sign with Ostrilo” (filled Candy Nebula gradient).
- **Quick Chips:** [Copy npub], [Permissions], [Accounts].
- **Recent Activity:** 3 items; each with app origin, time, status.
- **Empty State:** “No recent stamps yet. Let’s make your first!” + plush sparkle.

**B. Sign Event Modal**
- **Top:** App favicon + origin (verified pill if TLS).  
- **Event summary:** kind, created_at, size, relay target (if provided).  
- **Details accordion:** JSON preview (mono), with copy button.  
- **Permissions hint:** If missing `getPublicKey`, show inline tip.  
- **Actions:** [Approve ✓] (Mint) • [Deny] (Ink outline).  
- **Safety microcopy:** “Keys stay local. Ostrilo only signs what you see here.”

**C. Account Switcher**
- Grid of plush avatars (generated from npub).  
- Item: avatar + label (alias or `npub1…`), context menu: [Rename], [Export npub], [Remove].

**D. Permissions Panel (NIP‑07)**
- Toggles: getPublicKey, signEvent, nip04Encrypt, nip04Decrypt.  
- Scopes per site origin; revoke all per site.

**E. Toasts**
- Success: “Stamped! Saved locally.” with check badge and 900ms plush *pop* animation.  
- Copy: “npub copied.”  
- Error: “That request looked off—blocked.”

**F. Inputs**
- Pills, bubble buttons, segmented controls, switches with bounce.

**Motion**
- Enter: 140ms y‑bounce (overshoot 1.08), fade in 120ms.  
- Press: 40ms squish (scaleY 0.96, drop shadow increases).  
- Ease: `cubic-bezier(.2,.8,.2,1)`.

**Accessibility**
- Focus ring: 2px `#9A77FF` on Cotton Base; 3px on dark.  
- Minimum contrast: 4.5:1 for text; alt text for mascot.

---

## 6) Microcopy Pack
**Voice**: Cheerful, succinct, honest. Avoid jargon unless in a reveal/accordion.

**Onboarding**
- Welcome title: “Hi, I’m Ostrilo 🐣”
- Subtitle: “Your local signing buddy.”
- Primary: “Set up now”  
- Secondary: “Import an existing key”

**Permissions**
- Title: “Let this site see your public key?”
- Allow: “Yes, share my npub”
- Deny: “Not this time”
- Tip: “You can change this per site in Settings.”

**Signing**
- Title: “Review & sign”
- Primary: “Approve & sign”
- Secondary: “Deny”
- Hint: “Keys never leave your browser.”
- Link: “Show event JSON”

**NIP‑04**
- Title: “Private message access”
- Body: “Allow this site to encrypt/decrypt NIP‑04 messages with you.”
- Allow: “Allow secure PMs” • Deny: “Block PMs”

**Toasts**
- Success: “Signed! 🎉”
- Copied: “npub copied.”
- Revoked: “Permissions cleared.”
- Error: “We blocked that—didn’t look safe.”

**Empty States**
- Activity: “No stamps yet. Make your first!”
- Accounts: “No profiles—add one to start.”

**Errors**
- Network: “Relay unreachable. Try again soon.”
- Invalid: “That request is malformed.”
- Permission: “This site doesn’t have permission for that.”

**Settings Labels**
- “Site permissions” / “Accounts” / “Backups” / “About Ostrilo”

**About**
- “Open‑source signer. Keys stay with you.”

---

## 7) Asset & Export Guide
- **Logos:** SVG + PNG (1x/2x).  
- **Icons:** 16/32/48/128 (PNG) + `icon.svg`.  
- **Illustrations:** Mascot (neutral/happy/warn).  
- **Stickers:** ✅ check feather, 📎 clipboard, 📨 courier bag.

---

## 8) Design Tokens (CSS/Tailwind)
```css
:root{
 --bg: #FDF0FF; --surface:#FFFFFF; --ink:#2B1E4B; --shadow:#1D1530;
 --primary-a:#FF7AA2; --primary-b:#9A77FF; --success:#7DE3CC; --warn:#FFD6A5; --danger:#EF476F;
 --radius-lg:24px; --radius-pill:999px;
 --elev-1:0 6px 24px rgba(29,21,48,.18);
 --ease: cubic-bezier(.2,.8,.2,1);
}
.btn-plush{background:linear-gradient(180deg,var(--primary-a),var(--primary-b)); color:#fff; border-radius:var(--radius-pill); box-shadow:var(--elev-1)}
.btn-plush:active{transform:translateY(1px) scale(.98)}
```

**Tailwind preset (snippet)**
```js
export default {
  theme:{
    extend:{
      colors:{ bg:'#FDF0FF', ink:'#2B1E4B', primary:{A:'#FF7AA2',B:'#9A77FF'}, success:'#7DE3CC', warn:'#FFD6A5', danger:'#EF476F'},
      borderRadius:{ lg:'24px', pill:'999px' },
      boxShadow:{ plush:'0 6px 24px rgba(29,21,48,.18)' },
      transitionTimingFunction:{ plush:'cubic-bezier(.2,.8,.2,1)' }
    }
  }
}
```

---

## 9) Sample UI Layouts (wire descriptions)
**Popup (Top→Bottom)**
1. Mascot + “Ostrilo” wordmark.  
2. npub chip + copy.  
3. [Sign with Ostrilo] CTA.  
4. Quick chips (Permissions · Accounts · Settings).  
5. Recent activity list.

**Sign Modal (Left→Right)**
- L: Event summary + JSON accordion.  
- R: App origin, permissions needed, Approve/Deny.

---

## 10) Motion & SFX
- **Bounce‑in:** 140ms; scale 1.08→1; fade.
- **Hover shimmer:** slow diagonal on Candy Nebula.
- **SFX (optional):** soft “pop” on success (≤ 150ms, −20 LUFS). Provide mute toggle.

---

## 11) Mascot Usage
- Expressions: neutral (default), happy (success), concerned (warning).  
- Don’t use concerned on confirmation CTAs to avoid anxiety.

---

## 12) QA Checklist
- Contrast 4.5:1 for body text.  
- Keyboard trap free; visible focus everywhere.  
- Reduced motion respected (prefers-reduced-motion).

---

## 13) Next Assets to Produce
- Final SVG wordmark (Baloo 2 custom dot).  
- 3 mascot poses.  
- Lottie JSON for success confetti.  
- Figma component library with tokens.

