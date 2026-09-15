#!/usr/bin/env node
import { main } from './cli/main.js';

main(process.argv.slice(2)).then(
  (code) => {
    if (code) process.exitCode = code;
  },
  (err: Error) => {
    console.error(`error: ${err.message}`);
    process.exitCode = 1;
  },
);
