import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import prettierConfig from 'eslint-config-prettier'

export default tseslint.config(
  // Ignore patterns
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/.git/**',
      '**/.github/**',
      '**/*.d.ts',
    ],
  },

  // Base JavaScript config
  js.configs.recommended,

  // TypeScript configs
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  // Global settings for TypeScript
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['eslint.config.mts', 'jest.config.ts', 'tsup.config.ts'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.node,
        ...globals.es2022,
      },
    },
  },

  // TypeScript-specific rules
  {
    files: ['**/*.{ts,mts,cts}'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'warn',
      '@typescript-eslint/explicit-function-return-type': 'error',
      '@typescript-eslint/prefer-readonly-parameter-types': [
        'warn',
        { treatMethodsAsReadonly: true },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'max-lines-per-function': ['warn', { max: 40, skipBlankLines: true, skipComments: true }],
      complexity: ['error', 10],
    },
  },

  // Test files - more lenient rules
  {
    files: ['tests/**/*.{ts,mts}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/prefer-readonly-parameter-types': 'off',
      'max-lines-per-function': 'off',
    },
  },

  // Disable rules that conflict with Prettier
  // Must be last to override other configs
  prettierConfig
)
