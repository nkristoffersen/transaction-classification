import js from '@eslint/js';
import prettierRecommended from 'eslint-plugin-prettier/recommended';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['coverage/', 'ai-engineer/', 'data/', 'results.json', 'report.json'],
  },

  // Source and tests: type-aware linting against tsconfig.json.
  {
    files: ['src/**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // verbatimModuleSyntax is on, so type-only imports must be marked as
      // such or they survive type stripping and fail at runtime.
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },

  // Build and tool config at the root is outside tsconfig's include, so it is
  // linted without type information.
  {
    files: ['*.config.ts', 'eslint.config.js'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
  },

  // Must stay last. This both turns off the rules that would fight Prettier and
  // runs Prettier itself as the `prettier/prettier` rule, so formatting is
  // reported and fixed by eslint rather than by a second command. One tool, one
  // pass, and `--fix` covers correctness and layout together.
  prettierRecommended,
);
