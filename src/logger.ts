const debug = (...args: any[]) =>
  // eslint-disable-next-line no-console
  console.debug(...args);
const error = (...args: any[]) =>
  // eslint-disable-next-line no-console
  console.error(...args);
const info = (...args: any[]) =>
  // eslint-disable-next-line no-console
  console.info(...args);
const log = (...args: any[]) =>
  // eslint-disable-next-line no-console
  console.log(...args);
const warn = (...args: any[]) =>
  // eslint-disable-next-line no-console
  console.warn(...args);

export const logger = {
  debug,
  error,
  info,
  log,
  warn,
};
