'use strict';
// DOM-to-handle resolution: find the exact profile link inside a container.

const core = require('./core.js');

function handleOf(container) {
  for (const a of container.querySelectorAll('a[href]')) {
    let u;
    try { u = new URL(a.getAttribute('href'), 'https://x.com'); } catch { continue; }
    if (!['x.com', 'twitter.com'].includes(u.hostname) || !/^\/[A-Za-z0-9_]{1,15}\/?$/.test(u.pathname)) continue;
    const handle = core.normalizeHandle(u.pathname.split('/')[1]);
    if (handle && a.textContent.trim().toLowerCase() === '@' + handle) return handle;
  }
  return '';
}

module.exports = { handleOf };
