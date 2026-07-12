# Marginalia — Notes

Running log of spec gaps, friction, and blockers found during implementation.
Append; don't rewrite history.

## Spec gaps

- **2026-07-11 (M0):** SPEC calls for Node 22+, but the dev machine has Node
  20.19.4 (homebrew `node@20`), and `corepack prepare pnpm@latest` fails on it
  (`ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING` — pnpm 11 requires a newer Node).
  Pinned `pnpm@9` via `corepack prepare pnpm@9 --activate`, which works fine
  on Node 20. Nothing in the stack (Express 5, better-sqlite3, Vite, React 18)
  needs Node 22-specific features. `package.json` engines field set to
  `>=20` instead of `>=22`. Revisit if the runtime machine gets Node 22+.
- **2026-07-11 (M0):** `tsconfig.base.json` originally also set
  `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` (stricter than
  SPEC's plain "strict mode" requirement). This broke on Vite's CSS Modules
  typing (`styles.brand` becomes `string | undefined` under
  `noUncheckedIndexedAccess` because `vite/client`'s `CSSModuleClasses` type
  is an index signature) — every CSS-module class reference in the web
  package would need `!` or a guard. Removed both flags, kept `strict: true`.

## Friction

_(none yet)_

## Blockers

_(none yet)_
