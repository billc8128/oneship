#!/usr/bin/env node
const http = require('http');

let input = '';
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  const port = process.env.ONESHIP_HOOK_PORT || '19876';
  const source = process.argv.find(a => a.startsWith('--source='))?.split('=')[1] || 'unknown';

  const payload = JSON.stringify({
    source,
    event: input ? JSON.parse(input) : {},
    cwd: process.env.CLAUDE_CWD || process.env.PWD || '',
    terminalSessionId: process.env.ONESHIP_SESSION_ID || '',
    timestamp: Date.now()
  });

  const req = http.request({
    hostname: '127.0.0.1',
    port: parseInt(port),
    path: '/hook',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, () => {});

  req.on('error', () => {}); // Silently fail if app not running
  req.write(payload);
  req.end();
});

// If no stdin after 100ms, send empty event
setTimeout(() => {
  if (!input) {
    process.stdin.destroy();
  }
}, 100);
