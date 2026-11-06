import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

// Query keys come from src/db/queryKeys.ts (qk), never inline arrays, so a
// write can find every query it makes stale.
const noInlineQueryKey = {
  meta: {
    type: 'suggestion',
    messages: { inline: 'Use a key from qk (src/db/queryKeys.ts), not an inline array.' },
  },
  create(context) {
    return {
      "Property[key.name='queryKey'] > ArrayExpression"(node) {
        context.report({ node, messageId: 'inline' });
      },
    };
  },
};
// Pages and components reach the database through src/db/queries and
// src/db/hooks, never getDb() or SQL of their own: queries stay testable and
// in one place.
const DB_INDEX = /(^|\/)db(\/index)?$/;
const noDbInUi = {
  meta: {
    type: 'problem',
    messages: {
      getDb: 'Put the query in src/db/queries and call it from here, not getDb().',
      sql: 'Put the query in src/db/queries; components never import the SQL plugin.',
    },
  },
  create(context) {
    return {
      ImportDeclaration(node) {
        const src = node.source.value;
        if (src === '@tauri-apps/plugin-sql' && node.importKind !== 'type') {
          context.report({ node, messageId: 'sql' });
        }
        if (DB_INDEX.test(src) && node.specifiers.some((s) => s.imported?.name === 'getDb')) {
          context.report({ node, messageId: 'getDb' });
        }
      },
      ImportExpression(node) {
        if (node.source.type === 'Literal' && DB_INDEX.test(node.source.value)) {
          context.report({ node, messageId: 'getDb' });
        }
      },
    };
  },
};
const studio = { rules: { 'no-inline-query-key': noInlineQueryKey, 'no-db-in-ui': noDbInUi } };

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
      studio,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'studio/no-inline-query-key': 'error',
      // react-hooks v7 "recommended" bundles the React Compiler diagnostics.
      // This codebase is not compiled with React Compiler. Render stays pure:
      // "now" in render comes from useNow (src/hooks/useNow.ts), a handler's
      // time or id from src/lib/clock.ts. Render never writes a ref: a ref
      // that follows a prop or callback is kept current by useKeepCurrent
      // (src/hooks/useKeepCurrent.ts). State that follows a prop or query is
      // adjusted during render with useChanged / useChangedOrMount
      // (src/hooks/useChanged.ts), not copied in an effect.
      'react-hooks/set-state-in-effect': 'error',
      'react-hooks/refs': 'error',
      'react-hooks/purity': 'error',
      'react-hooks/preserve-manual-memoization': 'error',
      'react-hooks/immutability': 'error',
      'react-hooks/globals': 'error',
      'react-hooks/incompatible-library': 'error',
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
        // Money: formatMoney (src/lib/money.ts), see "Money as text" in DESIGN-SYSTEM.md.
        {
          selector: "CallExpression[callee.property.name='toFixed'][arguments.0.value=2]",
          message: 'Write money with formatMoney(amount, currency) from src/lib/money.ts (formatMoneyPdf in PDFs).',
        },
        {
          selector: "CallExpression[callee.property.name='toLocaleString'][arguments.0.value='de-CH']",
          message: 'Write money with formatMoney(amount, currency) from src/lib/money.ts (formatMoneyPdf in PDFs).',
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
    files: ['src/pages/**/*.{ts,tsx}', 'src/components/**/*.{ts,tsx}'],
    ignores: ['src/**/*.test.{ts,tsx}'],
    rules: { 'studio/no-db-in-ui': 'error' },
  },
  {
    // Tests build their own keys
    files: ['src/**/*.test.{ts,tsx}', 'src/__tests__/**'],
    rules: { 'studio/no-inline-query-key': 'off' },
  },
  {
    // The only two files that may import sonner
    files: ['src/lib/notify.ts', 'src/components/ui/Toaster.tsx'],
    rules: { 'no-restricted-imports': 'off' },
  }
);
