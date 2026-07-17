#!/usr/bin/env node
import { spawn } from 'child_process';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cliPath = path.resolve(__dirname, 'cli.js');

// 1. Start the customized json-i18n-editor in the background
console.log('Starting Locale Studio editor...');
const editorProcess = spawn(
  'node',
  [cliPath, ...process.argv.slice(2)],
  {
    cwd: process.cwd(),
    stdio: 'inherit',
  }
);

editorProcess.on('error', (err) => {
  console.error('Failed to start json-i18n-editor:', err);
});

// 2. Start a tiny ping server on port 3736 for Alt+Click integration
const server = http.createServer((req, res) => {
  // Handle CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url && req.url.startsWith('/start')) {
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'text/plain',
    });
    res.end('OK');
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(3736, () => {
  console.log('Locale Studio Proxy listening on http://localhost:3736');
  console.log('You can now Alt+Click on any translated text in the app!');
});

// Cleanup on exit
process.on('SIGINT', () => {
  editorProcess.kill();
  process.exit();
});
process.on('SIGTERM', () => {
  editorProcess.kill();
  process.exit();
});
