import { defineConfig } from 'vite-plus';

export default defineConfig({
  test: {
    exclude: ["node_modules", "dist", ".repos", ".lalph", ".direnv"],
  },
  lint: {
    "ignorePatterns": [
      ".repos",
      ".lalph",
      "dist",
      "build",
      "coverage",
      "node_modules"
    ],
    "plugins": [
      "typescript",
      "import",
      "oxc",
      "eslint",
      "unicorn",
      "node"
    ],
    "categories": {
      "correctness": "error",
      "suspicious": "error",
      "perf": "error"
    },
    "rules": {
      "typescript/consistent-type-imports": [
        "error",
        {
          "fixStyle": "inline-type-imports"
        }
      ],
      "typescript/no-import-type-side-effects": "error",
      "import/no-duplicates": "error",
      "typescript/array-type": [
        "error",
        {
          "default": "generic",
          "readonly": "generic"
        }
      ],
      "no-shadow": "off"
    },
    "options": {
      "typeAware": true,
      "typeCheck": true
    }
  },
  staged: {
    "*.{ts,tsx}": [
      "vp lint --fix",
      "vp fmt"
    ],
    "*.{json,md,yml,yaml}": [
      "vp fmt"
    ]
  },
  fmt: {
    "semi": false,
    "trailingComma": "all",
    "printWidth": 80,
    "sortPackageJson": false,
    "ignorePatterns": [
      ".git/",
      ".github/",
      ".agents/",
      ".lalph/",
      "pnpm-lock.yaml",
      "node_modules",
      "dist",
      "build"
    ]
  },
});
