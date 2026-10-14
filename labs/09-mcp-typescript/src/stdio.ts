// [START stdio]
// Local transport: the host launches `node dist/stdio.js` and talks over stdin/stdout.
// serveStdio calls the factory per connection and serves both the 2026-07-28 and 2025 handshake eras.
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { buildServer } from './server.js';

serveStdio(() => buildServer());
console.error('atlas-ops-ts: serving on stdio');   // logs MUST go to stderr, never stdout
// [END stdio]
