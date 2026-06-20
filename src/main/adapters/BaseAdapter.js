const http = require('http');
const https = require('https');

class BaseAdapter {
  constructor(config) {
    this.config = config;
  }

  async fetch(url, options = {}) {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const client = parsedUrl.protocol === 'https:' ? https : http;

      const headers = {
        'Content-Type': 'application/json',
        ...options.headers
      };

      if (this.config.authType === 'basic' && this.config.username && this.config.password) {
        const credentials = Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64');
        headers['Authorization'] = `Basic ${credentials}`;
      } else if (this.config.authType === 'bearer' && this.config.token) {
        headers['Authorization'] = `Bearer ${this.config.token}`;
      } else if (this.config.authType === 'apikey' && this.config.apiKey) {
        headers[this.config.apiKeyHeader || 'X-API-Key'] = this.config.apiKey;
      }

      const reqOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: options.method || 'GET',
        headers,
        timeout: options.timeout || 10000
      };

      const req = client.request(reqOptions, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          try {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(data ? JSON.parse(data) : null);
            } else {
              reject(new Error(`HTTP ${res.statusCode}: ${data}`));
            }
          } catch (e) {
            reject(new Error(`Parse error: ${e.message}`));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      if (options.body) {
        req.write(JSON.stringify(options.body));
      }
      req.end();
    });
  }

  async test() {
    throw new Error('Subclass must implement test()');
  }

  async fetchTasks() {
    throw new Error('Subclass must implement fetchTasks()');
  }
}

module.exports = BaseAdapter;
