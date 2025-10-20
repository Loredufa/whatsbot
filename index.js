// index.js (ESM, Windows-stable, maneja LOGOUT + EBUSY)
import 'dotenv/config';
import express from 'express';
import fetch from 'node-fetch';
import pkg from 'whatsapp-web.js';
const { Buttons, Client, List, LocalAuth, MessageMedia } = pkg;

// ---------- Config ----------
const PORT = process.env.PORT || 3000;
const SESSION_DIR = process.env.SESSION_DIR || './data';
const API_TOKEN = process.env.API_TOKEN || 'test123';
const BROWSER_PATH =
  process.env.BROWSER_PATH ||
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

// ---------- App HTTP ----------
const app = express();
app.use(express.json({ limit: '10mb' }));

const getToken = (req) => req.body?.token || req.headers['x-api-token'];
const checkToken = (t) => t && String(t) === String(API_TOKEN);

// ---------- WhatsApp Client (una sola vez) ----------
// --- una sola inicialización ---
let client;
let initialized = false;
let WA_READY = false;

function start() {
  if (initialized) return;    // <-- GARANTÍA: 1 sola vez
  initialized = true;

  client = new Client({
    authStrategy: new LocalAuth({ dataPath: SESSION_DIR, clientId: 'wsbot1' }),
    webVersionCache: { type: 'local' },
    puppeteer: {
      headless: true,
      executablePath: BROWSER_PATH,
      args: [
        '--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage',
        '--disable-extensions','--disable-gpu','--no-first-run',
        '--no-default-browser-check','--disable-crash-reporter',
        '--disable-features=FirstPartySets,PrivacySandboxSettings3,Parakeet,UserAgentClientHint',
        '--password-store=basic','--use-mock-keychain'
      ]
    }
  });

  client.on('qr', qr => { /* QR */ });
  client.on('authenticated', () => console.log('🔐 Autenticado'));
  client.on('ready', () => { WA_READY = true; console.log('✅ WhatsApp listo'); });

  // NO relanzar el cliente acá: si es LOGOUT, se reescanea manualmente
  client.on('disconnected', async (reason) => {
    WA_READY = false;
    console.error('🔌 Desconectado:', reason);

    // Soltar el navegador primero para evitar EBUSY al limpiar sesión
    try { if (client.pupBrowser?.isConnected()) await client.pupBrowser.close(); } catch {}

    // No tocar 'initialized' y NO llamar a start() de nuevo
    console.error('ℹ️ Para reanudar: cerrar proceso (Ctrl+C), borrar carpeta de sesión y volver a iniciar para reescanear QR.');
  });

  client.initialize();
}
start();

// ---------- Rutas ----------
app.get('/status', (_req, res) => {
  res.json({
    ready: WA_READY,
    me: client?.info?.wid?._serialized || null,
  });
});

app.post('/send', async (req, res) => {
  try {
    const token = getToken(req);
    if (!checkToken(token)) return res.status(401).json({ error: 'Unauthorized' });
    if (!WA_READY) return res.status(503).json({ error: 'Client not ready' });

    const { to, message } = req.body;
    if (!to || !message) return res.status(400).json({ error: 'Missing "to" or "message"' });

    const numberId = await client.getNumberId(String(to));
    if (!numberId) return res.status(404).json({ error: 'Number is not on WhatsApp' });

    const chatId = numberId._serialized;
    const sent = await client.sendMessage(chatId, message);
    res.json({ to: chatId, id: sent.id?.id || null, ack: sent.ack });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/send-media', async (req, res) => {
  try {
    const token = getToken(req);
    if (!checkToken(token)) return res.status(401).json({ error: 'Unauthorized' });
    if (!WA_READY) return res.status(503).json({ error: 'Client not ready' });

    const { to, url, caption } = req.body;
    if (!to || !url) return res.status(400).json({ error: 'Missing "to" or "url"' });

    const numberId = await client.getNumberId(String(to));
    if (!numberId) return res.status(404).json({ error: 'Number is not on WhatsApp' });
    const chatId = numberId._serialized;

    const resp = await fetch(url);
    if (!resp.ok) return res.status(400).json({ error: `Download failed: ${resp.status}` });
    const buffer = Buffer.from(await resp.arrayBuffer());
    const contentType = resp.headers.get('content-type') || 'application/octet-stream';
    const filename = url.split('?')[0].split('/').pop() || 'file';

    const media = new MessageMedia(contentType, buffer.toString('base64'), filename);
    const sent = await client.sendMessage(chatId, media, { caption });
    res.json({ to: chatId, id: sent.id?.id || null, ack: sent.ack, filename });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/send-buttons', async (req, res) => {
  try {
    const token = getToken(req);
    if (!checkToken(token)) return res.status(401).json({ error: 'Unauthorized' });
    if (!WA_READY) return res.status(503).json({ error: 'Client not ready' });

    const { to, text, buttons = [], title, footer } = req.body;
    if (!to || !text || !Array.isArray(buttons) || buttons.length === 0) {
      return res.status(400).json({ error: 'Missing "to", "text" or non-empty "buttons" array' });
    }

    const numberId = await client.getNumberId(String(to));
    if (!numberId) return res.status(404).json({ error: 'Number is not on WhatsApp' });
    const chatId = numberId._serialized;

    const btns = buttons.map((b) => ({ body: String(b) }));
    const btnMsg = new Buttons(text, btns, title || '', footer || '');
    const sent = await client.sendMessage(chatId, btnMsg);
    res.json({ to: chatId, id: sent.id?.id || null, ack: sent.ack });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ---------- Shutdown ordenado (anti-EBUSY) ----------
async function shutdown() {
  try {
    console.log('🧹 Cerrando cliente...');
    WA_READY = false;
    try {
      if (client?.pupBrowser && client.pupBrowser.isConnected()) {
        await client.pupBrowser.close(); // soltar archivos primero
      }
    } catch (e) {
      console.error('Error cerrando browser en shutdown:', e.message);
    }
    if (client) await client.destroy(); // cleanup de wwebjs
  } catch (e) {
    console.error('Error al cerrar cliente:', e.message);
  } finally {
    process.exit(0);
  }
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// ---------- Server ----------
app.listen(PORT, () => {
  console.log(`🚀 API escuchando en http://localhost:${PORT}`);
  console.log(`🔑 Usando token: ${API_TOKEN}`);
  console.log(`🧭 Chrome en: ${BROWSER_PATH}`);
});

