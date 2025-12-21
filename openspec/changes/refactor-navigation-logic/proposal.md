# Refactor Navigation Logic

## Summary
Extract navigation logic from `MainApp.tsx` into a custom hook and define broadcast event strings as constants to improve code maintainability, type safety, and testability.

## Problem
The current implementation of sidepanel mode support introduced a hardcoded string `"ostrilo.switchToActivity"` in both `background.ts` and `MainApp.tsx`. Additionally, `MainApp.tsx` directly manages the imperative logic for listening to this message and switching tabs, which mixes layout concerns with application logic.

## Solution
1.  Define a shared constants file for broadcast event names.
2.  Create a `useAppNavigation` hook to encapsulate tab state and message listeners.
3.  Refactor `MainApp.tsx` to use the hook.
4.  Update `background.ts` and other consumers to use the constant.

## Impact
- **Code Quality**: Reduces magic strings and separates concerns.
- **Maintainability**: Centralizes navigation logic.
- **Testability**: The hook can be tested in isolation.
