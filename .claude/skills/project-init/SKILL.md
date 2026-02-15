---
name: project-init
description: Initialize or upgrade a TypeScript project to comply with the mission-critical coding standard
disable-model-invocation: true
---

# Initialize Mission-Critical TypeScript Project

You are setting up (or upgrading) a TypeScript project to comply with the mission-critical coding standard.

## Instructions

### 1. Detect existing project

Check for existing configuration files:
- `package.json` — if present, this is an upgrade (preserve existing config)
- `tsconfig.json` — check current compiler options
- `.eslintrc.json` / `eslint.config.js` / `.eslintrc.js` — check linting config
- `src/` directory — check for existing source files
- `.husky/` directory — check for existing git hooks

If any of these exist, inform the user this is an **upgrade** and list what will be modified. Ask for confirmation before proceeding.

### 2. Initialize or update package.json

If `package.json` does not exist, ask the user for:
- Project name (default: directory name)
- Description
- Author

Create `package.json` with these scripts:
```json
{
  "scripts": {
    "build": "tsc",
    "type-check": "tsc --noEmit",
    "lint": "eslint 'src/**/*.ts' --max-warnings 0",
    "lint:fix": "eslint 'src/**/*.ts' --fix --max-warnings 0",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "prepare": "husky"
  }
}
```

If `package.json` already exists, merge these scripts (do not overwrite existing custom scripts).

### 3. Configure tsconfig.json (Rule 3.1)

Create or update `tsconfig.json` with the strict configuration from Rule 3.1:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "strictBindCallApply": true,
    "strictPropertyInitialization": true,
    "noImplicitThis": true,
    "useUnknownInCatchVariables": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noFallthroughCasesInSwitch": true,
    "noImplicitReturns": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "skipLibCheck": false,
    "allowUnusedLabels": false,
    "allowUnreachableCode": false,
    "forceConsistentCasingInFileNames": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "isolatedModules": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/*.test.ts", "**/*.spec.ts"]
}
```

If `tsconfig.json` exists, show the user a diff of what will change and confirm.

### 4. Configure ESLint (Rule 3.3, Appendix A)

Create `.eslintrc.json` with the configuration from Appendix A of the coding standard:

```json
{
  "parser": "@typescript-eslint/parser",
  "extends": [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:@typescript-eslint/recommended-requiring-type-checking"
  ],
  "parserOptions": {
    "project": "./tsconfig.json"
  },
  "rules": {
    "@typescript-eslint/no-floating-promises": "error",
    "@typescript-eslint/no-misused-promises": "error",
    "@typescript-eslint/prefer-readonly-parameter-types": "warn",
    "@typescript-eslint/explicit-function-return-type": "error",
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
    "no-console": ["warn", { "allow": ["warn", "error"] }],
    "max-lines-per-function": ["warn", { "max": 40, "skipBlankLines": true, "skipComments": true }],
    "complexity": ["error", 10]
  }
}
```

### 5. Create Result type utilities (Rule 6.2)

Read the template at `.claude/skills/project-init/templates/result.ts.template` and write it to `src/utils/result.ts`. If the file already exists, skip and inform the user.

### 6. Create branded type utilities (Rule 7.3)

Read the template at `.claude/skills/project-init/templates/branded-types.ts.template` and write it to `src/utils/branded-types.ts`. If the file already exists, skip and inform the user.

### 7. Create barrel export

Create `src/utils/index.ts` that re-exports from `result.ts` and `branded-types.ts`. If it exists, append the exports (don't overwrite).

### 8. Configure Husky pre-commit hooks (Appendix A)

Create `.husky/pre-commit` with:
```bash
npm run lint
npm run type-check
npm run test -- --run
```

### 9. Create src directory structure

Ensure these directories exist:
- `src/`
- `src/utils/`

### 10. Install dependencies

Tell the user to run the following commands (do NOT run them automatically — the user should review first):

```bash
# Core dev dependencies
npm install --save-exact -D typescript @typescript-eslint/parser @typescript-eslint/eslint-plugin eslint

# Testing
npm install --save-exact -D vitest @vitest/coverage-v8

# Property-based testing (Rule 9.1)
npm install --save-exact -D fast-check

# Git hooks
npm install --save-exact -D husky

# Schema validation (Rule 7.2) — optional, add if needed
npm install --save-exact zod
```

### 11. Summary

List all files created or modified, and any manual steps the user needs to complete.
