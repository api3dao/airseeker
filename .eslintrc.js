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
  extends: ['plugin:@api3/eslint-plugin-commons/universal', 'plugin:@api3/eslint-plugin-commons/jest'],
  plugins: ['@typescript-eslint', 'import', 'jest'],
};
