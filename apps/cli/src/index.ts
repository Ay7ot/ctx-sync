#!/usr/bin/env node

/**
 * ctx-sync — Sync your complete development context across machines.
 *
 * @module ctx-sync
 */

const VERSION = '1.0.0';

export function main(): void {
  const args = process.argv.slice(2);

  if (args.includes('--version') || args.includes('-V')) {
    console.log(VERSION);
    return;
  }

  console.log('ctx-sync — Development context synchronization tool');
  console.log(`Version: ${VERSION}`);
  console.log('Run ctx-sync --help for usage information.');
}

main();
