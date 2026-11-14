// Command-line scripts run outside Next.js, where the `server-only` guard has nothing to protect:
// preloading this file lets them reuse the server libraries as they are.
const id = require.resolve('server-only');
require.cache[id] = { id, filename: id, loaded: true, exports: {}, children: [], paths: [] };
