// server.js
// Serveur de contrôle pour bot WhatsApp - Version robuste et sécurisée

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

// ==================== CONFIGURATION ====================
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || 'xenoban-secret-2026';
const STATIC_FOLDER = 'public';
const BOT_HEARTBEAT_TIMEOUT = 90 * 1000;

// ==================== INITIALISATION ====================
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'], credentials: true },
  maxHttpBufferSize: 1e8
});

// ==================== MIDDLEWARES ====================
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, STATIC_FOLDER)));

app.use((req, res, next) => {
  if (!req.path.startsWith('/api/')) return next();
  const providedKey = req.headers['x-api-key'];
  if (providedKey !== API_KEY) {
    console.log(`⚠️ Accès refusé (clé invalide) depuis ${req.ip} sur ${req.path}`);
    return res.status(401).json({ error: 'Non autorisé : clé API invalide' });
  }
  next();
});

// ==================== STOCKAGE ====================
const dataStore = {
  messages: [],
  contacts: [],
  groups: [],
  statuses: [],
  botStatus: 'deconnecte',
  lastPing: null,
  botSocketId: null,
  startedAt: Date.now()
};

const MAX_MESSAGES = 500;
const viewOnceStore = [];
const MAX_VIEW_ONCE = 50;
const pendingRequests = new Map();

// ==================== HELPERS ====================
function normalizeGroups(body) {
  if (!body) return [];
  if (Array.isArray(body)) return body;
  if (Array.isArray(body.groups)) return body.groups;
  return [];
}

// ==================== ROUTES DE BASE ====================
app.get('/', (req, res) => {
  res.redirect(`/${STATIC_FOLDER}/dashboard.html`);
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    botStatus: dataStore.botStatus,
    uptime: Math.floor((Date.now() - dataStore.startedAt) / 1000),
    messagesCount: dataStore.messages.length,
    groupsCount: dataStore.groups.length,
    viewOnceCount: viewOnceStore.length,
    lastPingAgo: dataStore.lastPing ? Math.round((Date.now() - dataStore.lastPing) / 1000) + 's' : null
  });
});

// ==================== API BOT ====================

app.post('/api/bot/message', (req, res) => {
  try {
    const message = req.body;
    if (!message || !message.from) return res.status(400).json({ error: 'Message invalide' });
    
    dataStore.messages.push({ ...message, receivedAt: Date.now() });
    if (dataStore.messages.length > MAX_MESSAGES) {
      dataStore.messages = dataStore.messages.slice(-MAX_MESSAGES);
    }
    
    console.log(`📩 Message reçu de ${message.from}`);
    io.emit('new-message', message);
    res.json({ success: true });
  } catch (e) {
    console.error('❌ Erreur /api/bot/message:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/bot/contacts', (req, res) => {
  try {
    const body = req.body;
    dataStore.contacts = Array.isArray(body) ? body : (body.contacts || []);
    console.log(`👥 ${dataStore.contacts.length} contacts reçus`);
    io.emit('contacts-update', dataStore.contacts);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/bot/groups', (req, res) => {
  try {
    const groups = normalizeGroups(req.body);
    console.log(`📋 Réception groupes : ${groups.length} (depuis ${req.ip})`);
    
    if (!groups.length) {
      console.warn('⚠️ Aucun groupe dans le body reçu.');
      return res.status(400).json({ error: 'Aucun groupe fourni' });
    }
    
    // Stats admin pour les logs
    const admins = groups.filter(g => g.isAdmin).length;
    console.log(`📊 dont ${admins} où je suis admin`);
    
    dataStore.groups = groups;
    
    if (dataStore.botStatus !== 'connecte') {
      dataStore.botStatus = 'connecte';
      io.emit('bot-status', 'connecte');
      console.log('🤖 Bot marqué connecté (via /api/bot/groups)');
    }
    dataStore.lastPing = Date.now();
    
    io.emit('groups-update', dataStore.groups);
    res.json({ success: true, count: groups.length, admins });
  } catch (e) {
    console.error('❌ Erreur /api/bot/groups:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/bot/status', (req, res) => {
  try {
    const body = req.body;
    let status;
    if (typeof body === 'string') status = body;
    else if (body && typeof body.status === 'string') status = body.status;
    else status = 'inconnu';
    
    dataStore.botStatus = status;
    dataStore.lastPing = Date.now();
    io.emit('bot-status', status);
    console.log(`🤖 Statut bot mis à jour : ${status}`);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== VUES UNIQUES ====================

app.post('/api/bot/viewonce', (req, res) => {
  try {
    const data = req.body;
    if (!data || !data.buffer) return res.status(400).json({ error: 'Données manquantes' });
    
    const viewOnce = {
      id: Date.now() + '_' + Math.random().toString(36).slice(2, 11),
      type: data.type || 'image',
      buffer: data.buffer,
      caption: data.caption || '',
      from: data.from || 'Inconnu',
      sender: data.sender || 'Inconnu',
      time: data.time || Date.now(),
      receivedAt: Date.now()
    };
    
    viewOnceStore.push(viewOnce);
    if (viewOnceStore.length > MAX_VIEW_ONCE) viewOnceStore.shift();
    
    console.log(`📸 Vue unique reçue (${viewOnce.type}) de ${viewOnce.sender}`);
    io.emit('new-viewonce', {
      id: viewOnce.id, type: viewOnce.type, caption: viewOnce.caption,
      sender: viewOnce.sender, from: viewOnce.from, time: viewOnce.time
    });
    
    res.json({ success: true, id: viewOnce.id });
  } catch (e) {
    console.error('❌ Erreur /api/bot/viewonce:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/viewonce/list', (req, res) => {
  res.json(viewOnceStore.map(v => ({
    id: v.id, type: v.type, caption: v.caption,
    sender: v.sender, from: v.from, time: v.time
  })));
});

app.get('/api/viewonce/:id', (req, res) => {
  const vo = viewOnceStore.find(v => v.id === req.params.id);
  if (!vo) return res.status(404).json({ error: 'Vue unique non trouvée' });
  res.json(vo);
});

// ==================== API DASHBOARD ====================

app.get('/api/data', (req, res) => {
  res.json({
    messages: dataStore.messages.slice(-50),
    contacts: dataStore.contacts,
    groups: dataStore.groups,
    botStatus: dataStore.botStatus,
    lastPing: dataStore.lastPing,
    uptime: Math.floor((Date.now() - dataStore.startedAt) / 1000),
    viewOnce: viewOnceStore.map(v => ({
      id: v.id, type: v.type, caption: v.caption, sender: v.sender, time: v.time
    }))
  });
});

app.post('/api/send/message', (req, res) => {
  const { to, text } = req.body;
  if (!to || !text) return res.status(400).json({ error: 'Paramètres manquants' });
  io.emit('bot-command', { action: 'send-message', to, text });
  console.log(`📤 Commande : message à ${to}`);
  res.json({ success: true });
});

app.post('/api/join/group', (req, res) => {
  const { inviteCode } = req.body;
  if (!inviteCode) return res.status(400).json({ error: 'Code manquant' });
  io.emit('bot-command', { action: 'join-group', inviteCode });
  res.json({ success: true });
});

app.post('/api/leave/group', (req, res) => {
  const { groupId } = req.body;
  if (!groupId) return res.status(400).json({ error: 'groupId manquant' });
  io.emit('bot-command', { action: 'leave-group', groupId });
  res.json({ success: true });
});

app.post('/api/join/channel', (req, res) => {
  const { channelLink } = req.body;
  if (!channelLink) return res.status(400).json({ error: 'Lien manquant' });
  io.emit('bot-command', { action: 'join-channel', channelLink });
  res.json({ success: true });
});

app.post('/api/send/group', (req, res) => {
  const { groupId, text } = req.body;
  if (!groupId || !text) return res.status(400).json({ error: 'Paramètres manquants' });
  io.emit('bot-command', { action: 'send-group-message', groupId, text });
  res.json({ success: true });
});

app.post('/api/clear/messages', (req, res) => {
  dataStore.messages = [];
  io.emit('messages-cleared');
  res.json({ success: true });
});

// ==================== GESTION GROUPES ====================

app.post('/api/group/create', (req, res) => {
  const { name, members } = req.body;
  if (!name || !members || !Array.isArray(members) || members.length === 0) {
    return res.status(400).json({ error: 'Nom et membres requis' });
  }
  io.emit('bot-command', { action: 'create-group', name, members });
  console.log(`📤 Commande : créer groupe "${name}"`);
  res.json({ success: true });
});

app.post('/api/group/add', (req, res) => {
  const { groupId, number } = req.body;
  if (!groupId || !number) return res.status(400).json({ error: 'Paramètres manquants' });
  io.emit('bot-command', { action: 'add-member', groupId, number });
  res.json({ success: true });
});

app.post('/api/group/promote', (req, res) => {
  const { groupId, number } = req.body;
  if (!groupId || !number) return res.status(400).json({ error: 'Paramètres manquants' });
  io.emit('bot-command', { action: 'promote-admin', groupId, number });
  res.json({ success: true });
});

app.post('/api/group/demote', (req, res) => {
  const { groupId, number } = req.body;
  if (!groupId || !number) return res.status(400).json({ error: 'Paramètres manquants' });
  io.emit('bot-command', { action: 'demote-admin', groupId, number });
  res.json({ success: true });
});

app.post('/api/group/kick', (req, res) => {
  const { groupId, number } = req.body;
  if (!groupId || !number) return res.status(400).json({ error: 'Paramètres manquants' });
  io.emit('bot-command', { action: 'kick-member', groupId, number });
  res.json({ success: true });
});

// ==================== ACTIONS GLOBALES ====================

app.post('/api/group/add-all', (req, res) => {
  const { number } = req.body;
  if (!number) return res.status(400).json({ error: 'Numéro manquant' });
  
  const taskId = 'task_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  io.emit('bot-command', { action: 'add-member-all-groups', number, taskId });
  console.log(`📤 GLOBAL [${taskId}] : ajouter ${number}`);
  res.json({ success: true, taskId });
});

app.post('/api/group/promote-all', (req, res) => {
  const { number } = req.body;
  if (!number) return res.status(400).json({ error: 'Numéro manquant' });
  
  const taskId = 'task_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  io.emit('bot-command', { action: 'promote-admin-all-groups', number, taskId });
  console.log(`📤 GLOBAL [${taskId}] : promouvoir ${number}`);
  res.json({ success: true, taskId });
});

// ==================== STATUTS ====================

app.post('/api/status/post', (req, res) => {
  const { type, text, buffer, mimetype, caption } = req.body;
  if (!type) return res.status(400).json({ error: 'Type manquant' });
  io.emit('bot-command', {
    action: 'post-status', type, text: text || '',
    buffer: buffer || null, mimetype: mimetype || null, caption: caption || ''
  });
  console.log(`📤 Commande : publier statut (${type})`);
  res.json({ success: true });
});

// ==================== CHAÎNES ====================

app.post('/api/channel/broadcast', (req, res) => {
  const { channelLink, text } = req.body;
  if (!channelLink || !text) return res.status(400).json({ error: 'Paramètres manquants' });
  io.emit('bot-command', { action: 'broadcast-channel', channelLink, text });
  res.json({ success: true });
});

// ==================== WEBSOCKET ====================

io.use((socket, next) => {
  const authKey = socket.handshake.auth?.apiKey;
  if (authKey === API_KEY) next();
  else {
    console.log(`⚠️ Connexion Socket.io refusée (clé invalide)`);
    next(new Error('Non autorisé'));
  }
});

io.on('connection', (socket) => {
  console.log(`🖥️ Client connecté : ${socket.id}`);
  
  socket.emit('init', {
    messages: dataStore.messages.slice(-50),
    contacts: dataStore.contacts,
    groups: dataStore.groups,
    botStatus: dataStore.botStatus,
    viewOnce: viewOnceStore.map(v => ({
      id: v.id, type: v.type, caption: v.caption, sender: v.sender, time: v.time
    }))
  });
  
  socket.on('bot-register', () => {
    dataStore.botSocketId = socket.id;
    dataStore.botStatus = 'connecte';
    dataStore.lastPing = Date.now();
    io.emit('bot-status', 'connecte');
    console.log(`🤖 Bot enregistré (socket ${socket.id})`);
  });
  
  socket.on('bot-heartbeat', () => {
    dataStore.lastPing = Date.now();
    if (dataStore.botStatus !== 'connecte') {
      dataStore.botStatus = 'connecte';
      dataStore.botSocketId = socket.id;
      io.emit('bot-status', 'connecte');
      console.log('🤖 Bot reconnecté (heartbeat)');
    }
  });
  
  socket.on('bulk-progress', (data) => {
    console.log(`📊 Progression [${data.taskId}] ${data.current}/${data.total} - ${data.groupName || ''} ${data.success ? '✅' : '❌'}`);
    io.emit('bulk-progress', data);
  });

  socket.on('bulk-done', (data) => {
    console.log(`✅ Terminé [${data.taskId}] : ${data.ok} succès, ${data.fail} échecs`);
    io.emit('bulk-done', data);
  });
  
  socket.on('bot-response', (data) => {
    console.log('📬 Réponse bot:', data);
    const { requestId, success, message } = data;
    if (requestId && pendingRequests.has(requestId)) {
      const cb = pendingRequests.get(requestId);
      cb({ success, message });
      pendingRequests.delete(requestId);
    }
    io.emit('bot-response', data);
  });
  
  socket.on('bot-groups', (groups) => {
    const list = Array.isArray(groups) ? groups : (groups?.groups || []);
    if (!list.length) return;
    
    dataStore.groups = list;
    dataStore.lastPing = Date.now();
    
    if (dataStore.botStatus !== 'connecte') {
      dataStore.botStatus = 'connecte';
      dataStore.botSocketId = socket.id;
      io.emit('bot-status', 'connecte');
    }
    
    io.emit('groups-update', dataStore.groups);
    console.log(`📋 ${list.length} groupes via Socket.IO`);
  });
  
  socket.on('disconnect', () => {
    console.log(`🖥️ Client déconnecté : ${socket.id}`);
    if (socket.id === dataStore.botSocketId) {
      dataStore.botSocketId = null;
      dataStore.botStatus = 'deconnecte';
      io.emit('bot-status', 'deconnecte');
      console.log('🔴 Bot déconnecté (socket fermée)');
    }
  });
});

// ==================== TIMEOUT BOT ====================
setInterval(() => {
  if (dataStore.botStatus === 'connecte' && dataStore.lastPing) {
    const elapsed = Date.now() - dataStore.lastPing;
    if (elapsed > BOT_HEARTBEAT_TIMEOUT) {
      console.log(`⏱️ Bot inactif ${Math.round(elapsed / 1000)}s → déconnecté`);
      dataStore.botStatus = 'deconnecte';
      dataStore.botSocketId = null;
      io.emit('bot-status', 'deconnecte');
    }
  }
}, 15000);

// ==================== NETTOYAGE VUES UNIQUES ====================
setInterval(() => {
  const now = Date.now();
  const before = viewOnceStore.length;
  for (let i = viewOnceStore.length - 1; i >= 0; i--) {
    if (now - viewOnceStore[i].receivedAt > 24 * 60 * 60 * 1000) viewOnceStore.splice(i, 1);
  }
  const after = viewOnceStore.length;
  if (before !== after) console.log(`🧹 ${before - after} vue(s) nettoyée(s)`);
}, 60 * 60 * 1000);

// ==================== DÉMARRAGE ====================
server.listen(PORT, '0.0.0.0', () => {
  console.log('════════════════════════════════════════════');
  console.log(`🚀 Serveur démarré sur le port ${PORT}`);
  console.log(`📊 Dashboard : http://localhost:${PORT}/${STATIC_FOLDER}/dashboard.html`);
  console.log(`🔑 Clé API : ${API_KEY.substring(0, 4)}...${API_KEY.substring(API_KEY.length - 4)}`);
  console.log(`⏱️ Timeout heartbeat : ${BOT_HEARTBEAT_TIMEOUT / 1000}s`);
  console.log('════════════════════════════════════════════');
});

process.on('SIGTERM', () => {
  console.log('🛑 Arrêt du serveur...');
  server.close(() => process.exit(0));
});
