// CloudFront Function, runtime cloudfront-js-2.0, viewer-response.
// Preserve cache/CORS headers; candidate script CSP is Report-Only.
function handler(event) {
  var response = event.response;
  var headers = response.headers || (response.headers = {});
  headers["x-content-type-options"] = { value: "nosniff" };
  headers["x-frame-options"] = { value: "DENY" };
  headers["referrer-policy"] = { value: "strict-origin-when-cross-origin" };
  headers["content-security-policy"] = { value: "base-uri 'self'; object-src 'none'; frame-ancestors 'none'" };
  headers["content-security-policy-report-only"] = { value: "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; script-src 'self' https://connect.facebook.net; script-src-attr 'none'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https://tile.openstreetmap.org https://api-gas.bansir.com.br https://*.facebook.com https://*.fbcdn.net; connect-src 'self' https://api-gas.bansir.com.br https://connect.facebook.net https://www.facebook.com https://graph.facebook.com wss://localhost:* wss://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*; frame-src 'self' blob: https://www.facebook.com https://web.facebook.com; worker-src 'self' blob:; manifest-src 'self'; form-action 'self'" };
  return response;
}
