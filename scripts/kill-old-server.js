const http = require('http');

// Try to send a shutdown signal
const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/shutdown',
  method: 'GET',
  timeout: 2000
};

const req = http.request(options, (res) => {
  console.log('Shutdown request sent');
  process.exit(0);
});

req.on('error', (err) => {
  console.log('Server not responding, trying forceful exit...');
  // Use process.exit since the server isn't responding
  process.exit(0);
});

req.end();

setTimeout(() => {
  console.log('Timeout - exiting');
  process.exit(0);
}, 3000);
