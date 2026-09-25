# Implementation Tasks: Automatic Theme Switching

## Task 1: Add Theme Resolution Utility
**Status:** ✅ Complete  
**Estimated Effort:** 1–2 hours  
**Dependencies:** None  
**Verification:** Unit tests pass

- [x] Add a small UI utility module to compute effective theme from (`settings.theme`, system preference)
- [x] Add an idempotent helper to apply/remove the `dark` class on `document.documentElement`
- [x] Add unit tests for resolution and DOM class application

---

## Task 2: Apply Theme in Popup UI Root
**Status:** ✅ Complete  
**Estimated Effort:** 1–2 hours  
**Dependencies:** Task 1  
**Verification:** Manual: switching theme updates popup immediately

- [x] Mount a top-level theme applier (component/hook) in the popup React tree
- [x] Ensure it reacts to settings changes and applies `.dark` correctly

---

## Task 3: Apply Theme in Side Panel UI Root
**Status:** ✅ Complete  
**Estimated Effort:** 1–2 hours  
**Dependencies:** Task 1  
**Verification:** Manual: switching theme updates side panel immediately

- [x] Mount the theme applier in the side panel React tree

---

## Task 4: Apply Theme in Approval UI Root
**Status:** ✅ Complete  
**Estimated Effort:** 1–2 hours  
**Dependencies:** Task 1  
**Verification:** Manual: approval UI respects current theme

- [x] Mount the theme applier in the approval React tree

---

## Task 5: System Preference Live Updates (System Mode)
**Status:** ✅ Complete  
**Estimated Effort:** 1–2 hours  
**Dependencies:** Task 1–4  
**Verification:** Manual: change OS theme while UI is open

- [x] In `system` mode, listen for `prefers-color-scheme` changes and update without reload
- [x] Ensure listener cleanup on unmount and when leaving `system` mode

---

## Task 6: Validation
**Status:** ✅ Complete  
**Estimated Effort:** 15 minutes  
**Dependencies:** Task 1–5

- [x] Run `npm run compile`
- [x] Run `npm run build`
- [x] Run `npm run build:firefox`
- [x] Run relevant unit/integration tests (or `npm test` if available)
