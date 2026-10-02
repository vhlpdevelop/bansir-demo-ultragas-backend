const http = require('http');

const data = JSON.stringify({
  customerName: 'Test',
  customerPhone: '123',
  items: [{
    product: '60c72b2f9b1d8b0015b8d2b2', // FAKE ID
    productName: 'Gas',
    quantity: 1,
    price: 100
  }],
  totalAmount: 100
});

const req = http.request({
  hostname: 'localhost',
  port: 5000,
  path: '/api/v1/vouchers',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
}, (res) => {
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => console.log('Response:', res.statusCode, body));
});

req.on('error', (e) => console.error('Error:', e.message));
req.write(data);
req.end();
