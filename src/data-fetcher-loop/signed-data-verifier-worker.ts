import workerpool from 'workerpool';

import { verifySignedData } from './signed-data-verifier';

// Create a worker from this module and register public functions.
workerpool.worker({
  verifySignedData,
});
