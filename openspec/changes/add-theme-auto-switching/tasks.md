# Implementation Tasks: Automatic Theme Switching

## Task 1: Add Theme Resolution Utility
**Status:** ⏸️ Not Started  
**Estimated Effort:** 1–2 hours  
**Dependencies:** None  
**Verification:** Unit tests pass

- [ ] Add a small UI utility module to compute effective theme from (`settings.theme`, system preference)
- [ ] Add an idempotent helper to apply/remove the `dark` class on `document.documentElement`
- [ ] Add unit tests for resolution and DOM class application

---

## Task 2: Apply Theme in Popup UI Root
**Status:** ⏸️ Not Started  
**Estimated Effort:** 1–2 hours  
**Dependencies:** Task 1  
**Verification:** Manual: switching theme updates popup immediately

- [ ] Mount a top-level theme applier (component/hook) in the popup React tree
- [ ] Ensure it reacts to settings changes and applies `.dark` correctly

---

## Task 3: Apply Theme in Side Panel UI Root
**Status:** ⏸️ Not Started  
**Estimated Effort:** 1–2 hours  
**Dependencies:** Task 1  
**Verification:** Manual: switching theme updates side panel immediately

- [ ] Mount the theme applier in the side panel React tree

---

## Task 4: Apply Theme in Approval UI Root
**Status:** ⏸️ Not Started  
**Estimated Effort:** 1–2 hours  
**Dependencies:** Task 1  
**Verification:** Manual: approval UI respects current theme

- [ ] Mount the theme applier in the approval React tree

---

## Task 5: System Preference Live Updates (System Mode)
**Status:** ⏸️ Not Started  
**Estimated Effort:** 1–2 hours  
**Dependencies:** Task 1–4  
**Verification:** Manual: change OS theme while UI is open

- [ ] In `system` mode, listen for `prefers-color-scheme` changes and update without reload
- [ ] Ensure listener cleanup on unmount and when leaving `system` mode

---

## Task 6: Validation
**Status:** ⏸️ Not Started  
**Estimated Effort:** 15 minutes  
**Dependencies:** Task 1–5

- [ ] Run `npm run compile`
- [ ] Run `npm run build`
- [ ] Run `npm run build:firefox`
- [ ] Run relevant unit/integration tests (or `npm test` if available)
