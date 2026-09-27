// @ts-check
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/node_modules/**',
      'apps/server/src/db/migrations/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            'eslint.config.js',
            'apps/server/scripts/*.mjs',
            'apps/web/scripts/*.mjs',
            'scripts/*.mjs',
          ],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Les promesses non attendues sont une source classique de pertes silencieuses d'erreurs.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'always'],
      'no-console': 'error',
    },
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    files: ['apps/server/**', 'apps/web/scripts/**', 'scripts/**', 'eslint.config.js'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['apps/server/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/apps/web/**', '@dental/web'],
              message: 'Le serveur ne dépend jamais du frontend.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/web/**'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/apps/server/**', '@dental/server', 'pg', 'drizzle-orm', 'drizzle-orm/*'],
              message:
                "Le frontend ne contient aucune logique d'accès aux données : passer par l'API.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/shared/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/apps/**', '@dental/server', '@dental/web'],
              message: 'Le paquet partagé ne dépend d’aucune application.',
            },
          ],
        },
      ],
    },
  },
  {
    // Les CLI d'exploitation écrivent sur la sortie standard.
    files: [
      'apps/server/src/db/cli/**',
      'apps/server/scripts/**',
      'apps/web/scripts/**',
      'scripts/**',
    ],
    rules: { 'no-console': 'off' },
  },
  prettier,
);
