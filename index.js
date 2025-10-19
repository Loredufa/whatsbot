import axios from 'axios';
import 'dotenv/config';
import express from 'express';
import qrcode from 'qrcode-terminal';
import pkg from 'whatsapp-web.js';
const { Buttons, Client, List, LocalAuth, MessageMedia } = pkg;

const app = express();
app.use(express.json({ limit: '25mb' }));

// ---- Client con sesión persistente
const client = new Client({
  authStrategy: new LocalAuth({ dataPath: process.env.SESSION_DIR || './data' }),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  }
});

// ---- Eventos básicos
client.on('qr', (qr) => {
  console.log('Escaneá este QR (WhatsApp → Dispositivos vinculados):');
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => console.log('✅ WhatsApp listo'));
client.on('authenticated', () => console.log('🔐 Autenticado'));
client.on('auth_failure', (m) => console.error('❌ Falla de auth:', m));
client.on('disconnected', (r) => { console.error('🔌 Desconectado:', r); client.initialize(); });

// ---- Mensajes entrantes → reenvío a n8n
client.on('message', async (msg) => {
  try {
    const payload = {
      from: msg.from,             // '54911xxxxxxx@c.us'
      body: msg.body || '',
      timestamp: msg.timestamp,
      type: msg.type,
      hasMedia: msg.hasMedia
    };

    if (msg.hasMedia) {
      const media = await msg.downloadMedia(); // { data(base64), mimetype, filename }
      payload.media = {
        mimetype: media.mimetype,
        filename: media.filename || null,
        data: media.data            // base64. En n8n podés guardarlo o reenviarlo
      };
    }

    if (process.env.N8N_WEBHOOK_URL) {
      await axios.post(process.env.N8N_WEBHOOK_URL, payload, { timeout: 10000 });
    }
  } catch (e) {
    console.error('Error -> n8n:', e.message);
  }
});

// ---- Helper
const toJid = (to) => (to.endsWith('@c.us') ? to : `${to}@c.us`);
const checkToken = (t) => t === process.env.API_TOKEN;

// ---- Enviar texto
// POST /send  { to: "54911...", message: "Hola", token: "..." }
app.post('/send', async (req, res) => {
  try {
    const { to, message, token } = req.body;
    if (!checkToken(token)) return res.status(401).json({ error: 'Unauthorized' });
    if (!to || !message) return res.status(400).json({ error: 'to y message son requeridos' });
    const resp = await client.sendMessage(toJid(to), message);
    res.json({ ok: true, id: resp.id.id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ---- Enviar media desde URL (imagen/audio/doc)
// POST /send-media { to, url, caption?, token }
app.post('/send-media', async (req, res) => {
  try {
    const { to, url, caption, token } = req.body;
    if (!checkToken(token)) return res.status(401).json({ error: 'Unauthorized' });
    if (!to || !url) return res.status(400).json({ error: 'to y url son requeridos' });
    const media = await MessageMedia.fromUrl(url);
    const resp = await client.sendMessage(toJid(to), media, { caption });
    res.json({ ok: true, id: resp.id.id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ---- Enviar menú (Buttons)
// POST /send-menu-buttons { to, title?, footer?, buttons:[{body:'Texto'}], token }
app.post('/send-menu-buttons', async (req, res) => {
  try {
    const { to, buttons, title, footer, token } = req.body;
    if (!checkToken(token)) return res.status(401).json({ error: 'Unauthorized' });
    if (!to || !Array.isArray(buttons) || buttons.length === 0) {
      return res.status(400).json({ error: 'to y buttons[] son requeridos' });
    }
    const btn = new Buttons('Elegí una opción 👇', buttons, title || 'FG Concept', footer || 'Hair Studio');
    const resp = await client.sendMessage(toJid(to), btn);
    res.json({ ok: true, id: resp.id.id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ---- Enviar menú (List)
// POST /send-menu-list { to, sections:[{title,rows:[{id,title,description?}]}], buttonText?, title?, footer?, token }
app.post('/send-menu-list', async (req, res) => {
  try {
    const { to, sections, buttonText, title, footer, token } = req.body;
    if (!checkToken(token)) return res.status(401).json({ error: 'Unauthorized' });
    if (!to || !Array.isArray(sections) || sections.length === 0)
      return res.status(400).json({ error: 'to y sections[] son requeridos' });

    const list = new List(
      'Seleccioná una opción 👇',
      buttonText || 'Ver opciones',
      sections,
      title || 'FG Concept',
      footer || 'Hair Studio'
    );
    const resp = await client.sendMessage(toJid(to), list);
    res.json({ ok: true, id: resp.id.id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ---- Estado
app.get('/status', (_req, res) => {
  res.json({ ready: !!client.info, me: client.info?.wid?.user || null });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`HTTP listo en :${port}`));

client.initialize();
