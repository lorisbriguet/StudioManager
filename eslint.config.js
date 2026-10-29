import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: [
      'dist',
      'src-tauri',
      'node_modules',
      'SNAFU',
      'docs',
      'scripts',
      'vite.config.ts',
      'vitest.config.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // react-hooks v7 "recommended" bundles the React Compiler diagnostics.
      // This codebase is not compiled with React Compiler; these rules flag
      // long-standing (working) patterns en masse. Deferred to phase 2.
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/globals': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
      'react-hooks/static-components': 'off',
      'react-hooks/use-memo': 'off',
      'react-hooks/incompatible-library': 'off',
      'react-hooks/error-boundaries': 'off',
      'react-hooks/set-state-in-render': 'off',
      'react-hooks/unsupported-syntax': 'off',
      'react-hooks/config': 'off',
      'react-hooks/gating': 'off',
      // Toasts go through notify (src/lib/notify.ts): one API, the app's
      // durations and wording, errors never show raw text. See "Toasts" in
      // DESIGN-SYSTEM.md.
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'sonner',
              message: 'Use notify from src/lib/notify.ts (see "Toasts" in DESIGN-SYSTEM.md).',
            },
          ],
        },
      ],
      // Icons: sizes come from ICON_SIZE (src/components/ui/icons.ts) and
      // glyphs are lucide icons, never text. See "Icon Sizes" in DESIGN-SYSTEM.md.
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "JSXAttribute[name.name='size'] > JSXExpressionContainer > Literal:matches([value=11], [value=13], [value=15], [value=17])",
          message: 'Off-scale icon size. Use ICON_SIZE (pill 10, control 12, menu 14, callout 16, nav 18).',
        },
        {
          selector: 'JSXText[value=/[✓✔✕✖✗]/]',
          message: 'Use a lucide icon (ICONS.done, ICONS.close), not a text glyph.',
        },
      ],
      // Codebase convention: intentionally-unused values are `_`-prefixed, and
      // fields are stripped via rest destructuring ({ _id, ...rest }).
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  {
    // The only two files that may import sonner
    files: ['src/lib/notify.ts', 'src/components/ui/Toaster.tsx'],
    rules: { 'no-restricted-imports': 'off' },
  }
);
