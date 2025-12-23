# UI/UX Review & Improvement Plan

## Executive Summary
This review analyzes the current UI implementation of the Ostrilo extension against strict "UI Design Specialist" standards. The focus is on accessibility, logical spacing (8pt grid), typography, and touch targets.

**Overall Status:** ⚠️ Needs Improvement
The current implementation relies heavily on standard desktop patterns (small text, small inputs) which violate the mandatory design rules for accessible and touch-friendly interfaces.

## 1. Design System Violations

### 1.1 Spacing (The 8pt Grid)
- **Current State:** The codebase frequently uses `p-3`, `m-3`, `gap-3` (12px), which breaks the 8pt grid system.
- **Requirement:** All spacing must be multiples of 8px (8, 16, 24, 32...).
- **Action:**
  - Replace `p-3` with `p-4` (16px) or `p-2` (8px).
  - Replace `gap-3` with `gap-4` (16px) or `gap-2` (8px).
  - Standardize container padding to `p-4` (16px) or `p-6` (24px).

### 1.2 Typography
- **Current State:** Extensive use of `text-xs` (12px) and `text-sm` (14px) for body content and labels.
- **Requirement:** Body text must be minimum **16px** (18px preferred). Small text (<18px) requires higher contrast (4.5:1).
- **Action:**
  - Bump base font size to 16px.
  - Reserve `text-sm` only for very secondary metadata, never for main content.
  - Eliminate `text-xs` unless absolutely necessary for dense data displays (and ensure high contrast).

### 1.3 Touch Targets
- **Current State:**
  - Buttons are `h-9` (36px).
  - Inputs are `h-9` (36px).
  - Icon buttons are `size-9` (36px).
- **Requirement:** All interactive elements must have a touch target of at least **48x48px**.
- **Action:**
  - Increase default Button height to `h-12` (48px).
  - Increase Input height to `h-12` (48px).
  - Ensure icon buttons have a hit area of 48x48px (even if the visual icon is smaller).

### 1.4 Colors & Accessibility
- **Current State:**
  - Hardcoded colors (e.g., `blue-500`, `green-500`) in `OnboardingWelcome.tsx`.
  - `muted-foreground` usage needs contrast verification against card backgrounds.
- **Requirement:**
  - No hardcoded hex/tailwind colors; use semantic variables (`primary`, `secondary`, `destructive`, `success`).
  - Text contrast must meet WCAG 2.1 AA (4.5:1 for normal text).
- **Action:**
  - Refactor hardcoded colors to use semantic theme variables.
  - Verify `muted-foreground` contrast.

### 1.5 Interaction
- **Current State:** `div` elements with `onClick` handlers in `OnboardingWelcome.tsx`.
- **Requirement:** Interactive elements must be semantic `<button>` tags or have valid ARIA roles (`role="button"`) and keyboard support.
- **Action:**
  - Convert clickable cards to `<button>` elements or wrap in `<Button>` components.

## 2. Component-Specific Changes

### `src/ui/components/ui/button.tsx`
- [ ] Change `default` size from `h-9` to `h-12`.
- [ ] Change `sm` size from `h-8` to `h-10` (or remove if not needed).
- [ ] Change `lg` size from `h-10` to `h-14`.
- [ ] Ensure `icon` size provides 48px hit area.

### `src/ui/components/ui/input.tsx`
- [ ] Change height from `h-9` to `h-12`.
- [ ] Increase font size to `text-base` (16px) to prevent mobile zoom and improve readability.

### `src/ui/features/home/components/HomeView.tsx`
- [ ] Refactor `p-3` to `p-4`.
- [ ] Increase font sizes for stats labels (currently `text-xs`).
- [ ] Ensure "Status Cards" have sufficient padding and touch area if clickable.

### `src/ui/features/onboarding/components/OnboardingWelcome.tsx`
- [ ] Replace `div` onClick with semantic `<button>` or Radio Group component.
- [ ] Remove hardcoded `blue-500`/`green-500` classes; use `border-primary` or specific semantic classes.
- [ ] Fix spacing to align with 8pt grid.

## 3. Implementation Checklist

- [ ] **Step 1: Base Components**
    - [ ] Update `Button` component sizes.
    - [ ] Update `Input` component sizes.
    - [ ] Verify `tailwind.css` theme colors for accessibility.

- [ ] **Step 2: Onboarding Flow**
    - [ ] Refactor `OnboardingWelcome` to use semantic buttons and 8pt grid.
    - [ ] Ensure text sizes are >= 16px.

- [ ] **Step 3: Home View**
    - [ ] Update grid spacing and padding.
    - [ ] Bump font sizes.

- [ ] **Step 4: Global Polish**
    - [ ] Scan for any remaining `p-3`, `m-3`, `text-xs`.
    - [ ] Verify dark mode contrast for all modified components.
