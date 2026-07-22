// Vercel serverless entry point. The existing Express app (server.js) already
// handles all routing — static assets under pripay/, the landing page at /,
// the app at /app, and every /api/* endpoint — so we simply hand Vercel the
// app as the function handler. vercel.json rewrites all paths to this function.
module.exports = require('../server.js');
