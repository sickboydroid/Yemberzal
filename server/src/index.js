'use strict';
/**
 * Yemberzal server entrypoint.
 * - Serves the REST API under /api
 * - Serves the built React app from ../client/dist
 * - Socket.IO for live tracking
 * - HTTP  on :8080 (laptop use)
 * - HTTPS on :8443 with a self-signed cert (needed so PHONE browsers allow
 *   geolocation over the LAN — accept the certificate warning once)
 */
require('dotenv').config();
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');
const express = require('express');
const { Server } = require('socket.io');

const { db } = require('./db');
const { seedIfEmpty } = require('./seed');
const routes = require('./routes');
const { attachSockets } = require('./sockets');

seedIfEmpty();

const app = express();
app.use(express.json({ limit: '1mb' }));

// CORS (handy if the Vite dev server is used during development)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use('/api', routes);

// Serve built frontend
const dist = path.join(__dirname, '..', '..', 'client', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api|\/socket\.io).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
} else {
  app.get('/', (_req, res) =>
    res.send('<h2>Yemberzal API is running.</h2><p>Frontend build not found — run <code>npm run build</code> inside <code>client/</code>.</p>')
  );
}

// --- self-signed certificate for LAN HTTPS (generated once) ---
const certDir = path.join(__dirname, '..', 'certs');
fs.mkdirSync(certDir, { recursive: true });
const keyFile = path.join(certDir, 'key.pem');
const certFile = path.join(certDir, 'cert.pem');
if (!fs.existsSync(keyFile) || !fs.existsSync(certFile)) {
  const selfsigned = require('selfsigned');
  const lanIps = Object.values(os.networkInterfaces()).flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  const pems = selfsigned.generate([{ name: 'commonName', value: 'yemberzal.local' }], {
    days: 365,
    keySize: 2048,
    extensions: [{
      name: 'subjectAltName',
      altNames: [
        { type: 2, value: 'localhost' },
        { type: 7, ip: '127.0.0.1' },
        ...lanIps.map((ip) => ({ type: 7, ip })),
      ],
    }],
  });
  fs.writeFileSync(keyFile, pems.private);
  fs.writeFileSync(certFile, pems.cert);
  console.log('[tls] Generated self-signed certificate in server/certs/');
}

const HTTP_PORT = Number(process.env.HTTP_PORT || 8080);
const HTTPS_PORT = Number(process.env.HTTPS_PORT || 8443);

const httpServer = http.createServer(app);
const httpsServer = https.createServer({ key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) }, app);

const io = new Server({ cors: { origin: '*' } });
io.attach(httpServer);
io.attach(httpsServer);
app.set('io', io);
attachSockets(io);

httpServer.listen(HTTP_PORT, '0.0.0.0', () => {
  httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
    const ips = Object.values(os.networkInterfaces()).flat()
      .filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
    console.log('\n================= YEMBERZAL =================');
    console.log(`Laptop:            http://localhost:${HTTP_PORT}`);
    for (const ip of ips) {
      console.log(`Phones (same WiFi): https://${ip}:${HTTPS_PORT}   <-- use HTTPS on phones (GPS needs it)`);
    }
    console.log('Phones will warn about the certificate once — tap Advanced > Proceed.');
    console.log('=============================================\n');
  });
});
