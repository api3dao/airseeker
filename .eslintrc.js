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
    'unicorn/no-process-exit': 'off',
    'unicorn/prefer-top-level-await': 'off',

    // Typescript
    '@typescript-eslint/consistent-return': 'off', // Does not play with no useless undefined when function return type is "T | undefined" and does not have a fixer.
    '@typescript-eslint/max-params': 'off',
    '@typescript-eslint/no-dynamic-delete': 'off',
    '@typescript-eslint/no-var-requires': 'off',
    '@typescript-eslint/use-unknown-in-catch-callback-variable': 'off',

    // Lodash
    'lodash/prefer-immutable-method': 'off',
    'lodash/prop-shorthand': 'off',

    // Jest
    'jest/no-hooks': 'off',
    'jest/prefer-importing-jest-globals': 'off',
  },
};
