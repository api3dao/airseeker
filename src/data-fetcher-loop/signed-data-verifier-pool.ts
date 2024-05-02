import workerpool, { type Pool } from 'workerpool';

// Create a worker pool using an external worker script.
let pool: Pool | undefined;

export const initializeVerifierPool = () => {
  // If the pool is already initialized, no need to re-initialize it.
  if (pool) return pool;

  // Allow using the worker from TS (run in development mode) or JS files (when compiled). Note, that transpiling the
  // file in development mode is done by ts-node and so it must be available.
  const extension = __filename.endsWith('.ts') ? 'ts' : 'js';
  // By default the max workers is the number of CPU cores minus one. This is dangerous when the Signed API is deployed
  // on a single core machine (possible on low tier Cloud). We set the min number of workers to 1 to avoid this issue.
  // This will also correctly set the maximum number of workers. See:
  // https://github.com/josdejong/workerpool/blob/a1d85d5e49ca7632a43251d703e69f1c3ba4107b/src/Pool.js#L76
  //
  // As a note, on AWS the min number of workers is set to 1 even with the defaults (even with 256 CPU).
  const baseOptions = {
    workerType: 'thread',
    minWorkers: 1,
  } as const;
  // Allow using the worker as a TypeScript module. See:
  // https://github.com/josdejong/workerpool/issues/379#issuecomment-1580093502.
  const options =
    extension === 'ts'
      ? {
          ...baseOptions,
          workerThreadOpts: {
            execArgv: ['--require', 'ts-node/register'],
          },
        }
      : baseOptions;
  pool = workerpool.pool(`${__dirname}/signed-data-verifier.${extension}`, options);

  return pool;
};

export const getVerifier = async () => {
  if (!pool) throw new Error('Worker pool has not been initialized');

  return pool.proxy<typeof import('./signed-data-verifier')>();
};
