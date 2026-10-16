## 1. Key selector

- [x] 1.1 `KeySelector.tsx`: drop the `listbox`/`option` overrides; key rows are `menuitemradio` with `aria-checked`; trigger keeps Radix's `aria-haspopup="menu"`
- [x] 1.2 Unit tests assert the menu, the checked item and that "Add Key" is a legal child

## 2. Tests and docs

- [x] 2.1 e2e specs that located the dropdown by `listbox`/`option` use `menu`/`menuitemradio`
- [x] 2.2 `docs/multi-key-management-developer-guide.md` and the design-review runner follow
- [x] 2.3 `tests/e2e/accessibility.spec.ts` audits the open selector in both themes

## 3. Archive

- [x] 3.1 Archive this change (Task 14 of phase 0.10)
