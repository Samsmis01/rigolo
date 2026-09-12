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

// ==================== INITIALISATION ====================
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
    credentials: true
  },
  maxHttpBufferSize: 1e8 // 100 Mo
});

// ==================== MIDDLEWARES ====================
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Servir les fichiers statiques
app.use(express.static(path.join(__dirname, STATIC_FOLDER)));

// Middleware de sécurité : vérifie la clé API pour les routes /api/
app.use((req, res, next) => {
  if (!req.path.startsWith('/api/')) return next();
  
  const providedKey = req.headers['x-api-key'];
  if (providedKey !== API_KEY) {
    console.log(`⚠️ Accès refusé (clé invalide) depuis ${req.ip} sur ${req.path}`);
    return res.status(401).json({ error: 'Non autorisé : clé API invalide' });
  }
  next();
});

// ==================== STOCKAGE EN MÉMOIRE ====================
const dataStore = {
  messages: [],
  contacts: [],
  groups: [],
  statuses: [],
  botStatus: 'deconnecte',
  lastPing: null,
  startedAt: Date.now()
};

const MAX_MESSAGES = 500;

// ==================== STOCKAGE DES VUES UNIQUES ====================
const viewOnceStore = [];
const MAX_VIEW_ONCE = 50;

// ==================== STOCKAGE DES REQUÊTES EN ATTENTE ====================
// Pour les réponses asynchrones du bot (create-group, promote, etc.)
const pendingRequests = new Map();

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
    viewOnceCount: viewOnceStore.length
  });
});

// ==================== API POUR LE BOT ====================

app.post('/api/bot/message', (req, res) => {
  try {
    const message = req.body;
    if (!message || !message.from) {
      return res.status(400).json({ error: 'Message invalide' });
    }
    
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
    dataStore.contacts = req.body.contacts || [];
    console.log(`👥 ${dataStore.contacts.length} contacts reçus`);
    io.emit('contacts-update', dataStore.contacts);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/bot/groups', (req, res) => {
  try {
    dataStore.groups = req.body.groups || [];
    console.log(`📋 ${dataStore.groups.length} groupes reçus`);
    io.emit('groups-update', dataStore.groups);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/bot/status', (req, res) => {
  try {
    dataStore.botStatus = req.body.status || 'inconnu';
    dataStore.lastPing = Date.now();
    io.emit('bot-status', dataStore.botStatus);
    console.log(`🤖 Statut bot mis à jour : ${dataStore.botStatus}`);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== VUES UNIQUES ====================

// Le bot envoie une vue unique
app.post('/api/bot/viewonce', (req, res) => {
  try {
    const data = req.body;
    if (!data || !data.buffer) {
      return res.status(400).json({ error: 'Données manquantes' });
    }
    
    const viewOnce = {
      id: Date.now() + '_' + Math.random().toString(36).substr(2, 9),
      type: data.type || 'image',
      buffer: data.buffer,
      caption: data.caption || '',
      from: data.from || 'Inconnu',
      sender: data.sender || 'Inconnu',
      time: data.time || Date.now(),
      receivedAt: Date.now()
    };
    
    viewOnceStore.push(viewOnce);
    if (viewOnceStore.length > MAX_VIEW_ONCE) {
      viewOnceStore.shift();
    }
    
    console.log(`📸 Vue unique reçue (${viewOnce.type}) de ${viewOnce.sender}`);
    io.emit('new-viewonce', {
      id: viewOnce.id,
      type: viewOnce.type,
      caption: viewOnce.caption,
      sender: viewOnce.sender,
      from: viewOnce.from,
      time: viewOnce.time
    });
    
    res.json({ success: true, id: viewOnce.id });
  } catch (e) {
    console.error('❌ Erreur /api/bot/viewonce:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Lister les vues uniques (sans buffer)
app.get('/api/viewonce/list', (req, res) => {
  res.json(viewOnceStore.map(v => ({
    id: v.id,
    type: v.type,
    caption: v.caption,
    sender: v.sender,
    from: v.from,
    time: v.time
  })));
});

// Récupérer une vue unique avec le buffer
app.get('/api/viewonce/:id', (req, res) => {
  const vo = viewOnceStore.find(v => v.id === req.params.id);
  if (!vo) {
    return res.status(404).json({ error: 'Vue unique non trouvée' });
  }
  res.json(vo);
});

// ==================== API POUR LE DASHBOARD ====================

app.get('/api/data', (req, res) => {
  res.json({
    messages: dataStore.messages.slice(-50),
    contacts: dataStore.contacts,
    groups: dataStore.groups,
    botStatus: dataStore.botStatus,
    lastPing: dataStore.lastPing,
    uptime: Math.floor((Date.now() - dataStore.startedAt) / 1000),
    viewOnce: viewOnceStore.map(v => ({
      id: v.id,
      type: v.type,
      caption: v.caption,
      sender: v.sender,
      time: v.time
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

// ==================== NOUVELLES ROUTES : GESTION GROUPES ====================

// Créer un groupe
app.post('/api/group/create', (req, res) => {
  const { name, members } = req.body;
  if (!name || !members || !Array.isArray(members) || members.length === 0) {
    return res.status(400).json({ error: 'Nom et membres requis' });
  }
  
  io.emit('bot-command', { action: 'create-group', name, members });
  console.log(`📤 Commande : créer groupe "${name}" avec ${members.length} membres`);
  res.json({ success: true });
});

// Ajouter un membre
app.post('/api/group/add', (req, res) => {
  const { groupId, number } = req.body;
  if (!groupId || !number) return res.status(400).json({ error: 'Paramètres manquants' });
  
  io.emit('bot-command', { action: 'add-member', groupId, number });
  console.log(`📤 Commande : ajouter ${number} dans ${groupId}`);
  res.json({ success: true });
});

// Promouvoir admin
app.post('/api/group/promote', (req, res) => {
  const { groupId, number } = req.body;
  if (!groupId || !number) return res.status(400).json({ error: 'Paramètres manquants' });
  
  io.emit('bot-command', { action: 'promote-admin', groupId, number });
  console.log(`📤 Commande : promouvoir ${number} admin dans ${groupId}`);
  res.json({ success: true });
});

// Rétrograder admin
app.post('/api/group/demote', (req, res) => {
  const { groupId, number } = req.body;
  if (!groupId || !number) return res.status(400).json({ error: 'Paramètres manquants' });
  
  io.emit('bot-command', { action: 'demote-admin', groupId, number });
  console.log(`📤 Commande : rétrograder ${number} dans ${groupId}`);
  res.json({ success: true });
});

// Expulser un membre
app.post('/api/group/kick', (req, res) => {
  const { groupId, number } = req.body;
  if (!groupId || !number) return res.status(400).json({ error: 'Paramètres manquants' });
  
  io.emit('bot-command', { action: 'kick-member', groupId, number });
  console.log(`📤 Commande : expulser ${number} de ${groupId}`);
  res.json({ success: true });
});

// ==================== NOUVELLES ROUTES : STATUTS ====================

// Publier un statut
app.post('/api/status/post', (req, res) => {
  const { type, text, buffer, mimetype, caption } = req.body;
  if (!type) return res.status(400).json({ error: 'Type manquant' });
  
  const command = {
    action: 'post-status',
    type,
    text: text || '',
    buffer: buffer || null,
    mimetype: mimetype || null,
    caption: caption || ''
  };
  
  io.emit('bot-command', command);
  console.log(`📤 Commande : publier statut (${type})`);
  res.json({ success: true });
});

// ==================== NOUVELLES ROUTES : CHAÎNES ====================

// Diffuser dans une chaîne
app.post('/api/channel/broadcast', (req, res) => {
  const { channelLink, text } = req.body;
  if (!channelLink || !text) return res.status(400).json({ error: 'Paramètres manquants' });
  
  io.emit('bot-command', { action: 'broadcast-channel', channelLink, text });
  console.log(`📤 Commande : diffuser dans ${channelLink}`);
  res.json({ success: true });
});

// ==================== WEBSOCKET ====================

io.use((socket, next) => {
  const authKey = socket.handshake.auth?.apiKey;
  if (authKey === API_KEY) {
    next();
  } else {
    console.log(`⚠️ Connexion Socket.io refusée (clé invalide)`);
    next(new Error('Non autorisé'));
  }
});

io.on('connection', (socket) => {
  console.log(`🖥️ Client connecté : ${socket.id}`);
  
  // Envoyer les données actuelles au nouveau client
  socket.emit('init', {
    messages: dataStore.messages.slice(-50),
    contacts: dataStore.contacts,
    groups: dataStore.groups,
    botStatus: dataStore.botStatus,
    viewOnce: viewOnceStore.map(v => ({
      id: v.id,
      type: v.type,
      caption: v.caption,
      sender: v.sender,
      time: v.time
    }))
  });
  
  // Le bot s'enregistre
  socket.on('bot-register', () => {
    dataStore.botStatus = 'connecte';
    dataStore.lastPing = Date.now();
    io.emit('bot-status', 'connecte');
    console.log('🤖 Bot enregistré');
  });
  
  // Heartbeat du bot
  socket.on('bot-heartbeat', () => {
    dataStore.lastPing = Date.now();
    socket.emit('bot-status', dataStore.botStatus);
  });
  
  // Réponse d'une commande du bot (pour les actions async)
  socket.on('bot-response', (data) => {
    console.log('📬 Réponse du bot:', data);
    const { requestId, success, message } = data;
    if (requestId && pendingRequests.has(requestId)) {
      const cb = pendingRequests.get(requestId);
      cb({ success, message });
      pendingRequests.delete(requestId);
    }
    io.emit('bot-response', data);
  });
  
  socket.on('disconnect', () => {
    console.log(`🖥️ Client déconnecté : ${socket.id}`);
  });
});

// ==================== BROADCAST PÉRIODIQUE DU STATUT ====================
setInterval(() => {
  if (dataStore.botStatus) {
    io.emit('bot-status', dataStore.botStatus);
  }
}, 5000);

// ==================== NETTOYAGE DES VUES UNIQUES ====================
// Supprime les vues uniques de plus de 24h
setInterval(() => {
  const now = Date.now();
  const before = viewOnceStore.length;
  for (let i = viewOnceStore.length - 1; i >= 0; i--) {
    if (now - viewOnceStore[i].receivedAt > 24 * 60 * 60 * 1000) {
      viewOnceStore.splice(i, 1);
    }
  }
  const after = viewOnceStore.length;
  if (before !== after) {
    console.log(`🧹 ${before - after} vue(s) unique(s) nettoyée(s)`);
  }
}, 60 * 60 * 1000); // Toutes les heures

// ==================== DÉMARRAGE ====================
server.listen(PORT, '0.0.0.0', () => {
  console.log('════════════════════════════════════════════');
  console.log(`🚀 Serveur de contrôle démarré sur le port ${PORT}`);
  console.log(`📊 Dashboard : http://localhost:${PORT}/${STATIC_FOLDER}/dashboard.html`);
  console.log(`🔑 Clé API : ${API_KEY.substring(0, 4)}...${API_KEY.substring(API_KEY.length - 4)}`);
  console.log(`📁 Dossier statique : ${STATIC_FOLDER}/`);
  console.log('════════════════════════════════════════════');
});

// Gestion propre de l'arrêt
process.on('SIGTERM', () => {
  console.log('🛑 Arrêt du serveur...');
  server.close(() => process.exit(0));
});
