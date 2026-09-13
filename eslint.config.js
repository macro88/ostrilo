import tsParser from "@typescript-eslint/parser";

/**
 * A deliberately small ESLint configuration.
 *
 * This is not a style-lint rollout. It exists for one rule: cryptographic
 * libraries belong in the adapter layer, and nowhere else.
 *
 * That rule was already written down - `docs/development-standards.md` says
 * cross-layer dependencies point inward through ports - and the violations
 * landed anyway. `src/domain/utils/crypto.ts` imported `@noble/curves`,
 * `@noble/hashes` and `@scure/base` directly from inside the domain layer and
 * grew a second implementation of every primitive in the product; the UI's key
 * list reached `@scure/base` from a React render. An unenforced rule is a
 * preference.
 *
 * The companion check is `tests/security/crypto-single-implementation.test.ts`,
 * which catches the failure this rule cannot: a SECOND adapter for the same
 * primitive, added inside `src/infrastructure/crypto/` where the import is
 * legitimate.
 */

const CRYPTO_IMPORT_MESSAGE =
  "Cryptographic libraries are confined to src/infrastructure/crypto/. " +
  "Declare what you need as a port in src/application/ports/crypto.ts and " +
  "receive an adapter, rather than importing the library here.";

export default [
  {
    ignores: [
      ".output/**",
      ".wxt/**",
      "dist/**",
      "node_modules/**",
      "coverage/**",
    ],
  },
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              // Both forms: the bare package and every deep entry point, because
              // every real import in this repo is a deep one
              // (`@noble/curves/secp256k1.js`).
              group: ["@noble", "@noble/**", "@scure", "@scure/**"],
              message: CRYPTO_IMPORT_MESSAGE,
            },
          ],
        },
      ],
    },
  },
  {
    // The adapter layer, and only the adapter layer. An allowlist with a second
    // entry is how this stops meaning anything.
    files: ["src/infrastructure/crypto/**/*.ts"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
];
