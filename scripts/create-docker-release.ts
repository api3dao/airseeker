import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import isWsl from 'is-wsl';

const execSyncWithErrorHandling = (command: string) => {
  // eslint-disable-next-line functional/no-try-statements
  try {
    return execSync(command, { stdio: 'pipe' }).toString();
  } catch (error: any) {
    // eslint-disable-next-line no-console
    console.error(error.message);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    console.info('STDOUT', error.stdout.toString());
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    console.info('STDERR', error.stderr.toString());

    process.exit(1);
  }
};

export const isMacOrWindows = () => process.platform === 'win32' || process.platform === 'darwin' || isWsl;

const main = () => {
  const { version } = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf8')) as any;
  console.info(`Building docker image with semantic version ${version}...`);

  if (isMacOrWindows()) {
    console.info('Detected Mac or Windows platform. Using Docker buildx...');
    execSyncWithErrorHandling(`pnpm run docker:build:amd64`);
  } else {
    console.info('Detected Linux platform. Using standard Docker build...');
    execSyncWithErrorHandling(`pnpm run docker:build`);
  }

  console.info(`Tagging the images with ${version}...`);
  execSyncWithErrorHandling(`docker tag api3/airseeker:latest api3/airseeker:${version}`);

  console.info('The images are built and ready to be published. Run the following commands to publish them:');
  console.info();
  console.info(`docker push api3/airseeker:${version} && docker push api3/airseeker:latest`);
};

main();
