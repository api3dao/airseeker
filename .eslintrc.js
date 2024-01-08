module.exports = {
  root: true, // https://github.com/eslint/eslint/issues/13385#issuecomment-641252879
  env: {
    es6: true,
    jest: true,
    node: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: ['./tsconfig.json'],
    ecmaVersion: 11,
    sourceType: 'module',
  },
  globals: {
    Atomics: 'readonly',
    SharedArrayBuffer: 'readonly',
  },
  extends: ['./node_modules/@api3/commons/dist/eslint/universal', './node_modules/@api3/commons/dist/eslint/jest'],
  plugins: ['@typescript-eslint', 'import', 'jest'],
  rules: {
    'unicorn/prefer-top-level-await': 'off',
    'unicorn/no-process-exit': 'off',
    '@typescript-eslint/max-params': 'off',

    // Typescript
    '@typescript-eslint/no-var-requires': 'off',
    '@typescript-eslint/no-dynamic-delete': 'off',

    // Lodash
    'lodash/prefer-immutable-method': 'off',

    // Jest
    'jest/no-hooks': 'off',
  },
};
