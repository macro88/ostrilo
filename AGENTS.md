
## Development Standards

All development work must conform to `docs/development-standards.md`. Before editing, review the standards and the referenced source documents relevant to the change. After editing, verify the work with the checks required by the standards and report any command that could not run.

## UI Design System

All UI work must follow `docs/design/DESIGN_RULES.md`. Do not reintroduce gradients, accent rails, dot-grid backgrounds, the retired Arcade Plush class names, or pink/candy palette choices.

## React Doctor Verification

After code edits, run `npx react-doctor@latest` and keep fixing findings until React Doctor reports `No issues found!` and a `100 / 100` score. Do not consider edited work complete, ready to hand off, or ready to commit with a lower score unless the user explicitly overrides this rule for that turn.
