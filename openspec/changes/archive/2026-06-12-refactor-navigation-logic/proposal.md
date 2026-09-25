# Refactor Navigation Logic

## 2026-06-11 Review Status

Status: ready for development as a small refactor.

Current code still hardcodes `"ostrilo.switchToActivity"` and `"ostrilo.queue.updated"` across `background.ts`, `MainApp.tsx`, `ApprovalPrompt.tsx`, and `ActivityView.tsx`. The proposal remains useful, but the shared constants should live in the infrastructure/messaging layer rather than `src/domain/`, because these are extension broadcast transport events, not domain concepts.

Development readiness: ready once the tasks below are interpreted with that path correction and include compile/unit validation.

## Summary
Extract navigation logic from `MainApp.tsx` into a custom hook and define broadcast event strings as constants to improve code maintainability, type safety, and testability.

## Problem
The current implementation of sidepanel mode support introduced a hardcoded string `"ostrilo.switchToActivity"` in both `background.ts` and `MainApp.tsx`. Additionally, `MainApp.tsx` directly manages the imperative logic for listening to this message and switching tabs, which mixes layout concerns with application logic.

## Solution
1.  Define a shared infrastructure constants file for broadcast event names.
2.  Create a `useAppNavigation` hook to encapsulate tab state and message listeners.
3.  Refactor `MainApp.tsx` to use the hook.
4.  Update `background.ts` and other consumers to use the constant.

## Impact
- **Code Quality**: Reduces magic strings and separates concerns.
- **Maintainability**: Centralizes navigation logic.
- **Testability**: The hook can be tested in isolation.
