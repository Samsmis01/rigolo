// server.js
// Serveur de contrôle pour bot WhatsApp - Version robuste et sécurisée

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

// ==================== CONFIGURATION ====================
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || 'hexgate-secret-2026'; // ⚠️ Changez cette clé !
const STATIC_FOLDER = 'publique'; // ⚠️ Correspond au nom du dossier sur GitHub

// ==================== INITIALISATION ====================
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
    credentials: true
  },
  maxHttpBufferSize: 1e8 // 100 Mo pour les gros médias
});

// ==================== MIDDLEWARES ====================
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Servir les fichiers statiques depuis le dossier "publique"
app.use(express.static(path.join(__dirname, STATIC_FOLDER)));

// Middleware de sécurité : vérifie la clé API pour les routes /api/
app.use((req, res, next) => {
  // Laisser passer les fichiers statiques
  if (!req.path.startsWith('/api/')) return next();
  
  const providedKey = req.headers['x-api-key'];
  if (providedKey !== API_KEY) {
    console.log(`⚠️ Tentative d'accès non autorisée depuis ${req.ip} sur ${req.path}`);
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

const MAX_MESSAGES = 500; // Limite pour éviter la surcharge mémoire

// ==================== ROUTES DE BASE ====================

// Page d'accueil (redirige vers le dashboard)
app.get('/', (req, res) => {
  res.redirect(`/${STATIC_FOLDER}/dashboard.html`);
});

// Route de santé (utile pour UptimeRobot)
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    botStatus: dataStore.botStatus,
    uptime: Math.floor((Date.now() - dataStore.startedAt) / 1000),
    messagesCount: dataStore.messages.length
  });
});

// ==================== API POUR LE BOT ====================

// Le bot envoie un message
app.post('/api/bot/message', (req, res) => {
  try {
    const message = req.body;
    if (!message || !message.from) {
      return res.status(400).json({ error: 'Message invalide' });
    }
    
    dataStore.messages.push({ ...message, receivedAt: Date.now() });
    
    // Limiter la taille de l'historique
    if (dataStore.messages.length > MAX_MESSAGES) {
      dataStore.messages = dataStore.messages.slice(-MAX_MESSAGES);
    }
    
    console.log(`📩 Message reçu de ${message.from}: ${(message.body || '').substring(0, 50)}`);
    io.emit('new-message', message);
    res.json({ success: true });
  } catch (e) {
    console.error('❌ Erreur /api/bot/message:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Le bot envoie la liste des contacts
app.post('/api/bot/contacts', (req, res) => {
  try {
    dataStore.contacts = req.body.contacts || [];
    console.log(`👥 ${dataStore.contacts.length} contacts reçus`);
    io.emit('contacts-update', dataStore.contacts);
    res.json({ success: true });
  } catch (e) {
    console.error('❌ Erreur /api/bot/contacts:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Le bot envoie la liste des groupes
app.post('/api/bot/groups', (req, res) => {
  try {
    dataStore.groups = req.body.groups || [];
    console.log(`📋 ${dataStore.groups.length} groupes reçus`);
    io.emit('groups-update', dataStore.groups);
    res.json({ success: true });
  } catch (e) {
    console.error('❌ Erreur /api/bot/groups:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Le bot signale son statut
app.post('/api/bot/status', (req, res) => {
  try {
    dataStore.botStatus = req.body.status || 'inconnu';
    dataStore.lastPing = Date.now();
    io.emit('bot-status', dataStore.botStatus);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== API POUR LE DASHBOARD ====================

// Récupérer toutes les données
app.get('/api/data', (req, res) => {
  res.json({
    messages: dataStore.messages.slice(-50),
    contacts: dataStore.contacts,
    groups: dataStore.groups,
    botStatus: dataStore.botStatus,
    lastPing: dataStore.lastPing,
    uptime: Math.floor((Date.now() - dataStore.startedAt) / 1000)
  });
});

// Envoyer un message depuis le dashboard
app.post('/api/send/message', (req, res) => {
  const { to, text } = req.body;
  if (!to || !text) return res.status(400).json({ error: 'Paramètres manquants' });
  
  io.emit('bot-command', { action: 'send-message', to, text });
  console.log(`📤 Commande : message à ${to}`);
  res.json({ success: true });
});

// Rejoindre un groupe
app.post('/api/join/group', (req, res) => {
  const { inviteCode } = req.body;
  if (!inviteCode) return res.status(400).json({ error: 'Code manquant' });
  
  io.emit('bot-command', { action: 'join-group', inviteCode });
  res.json({ success: true });
});

// Quitter un groupe
app.post('/api/leave/group', (req, res) => {
  const { groupId } = req.body;
  if (!groupId) return res.status(400).json({ error: 'groupId manquant' });
  
  io.emit('bot-command', { action: 'leave-group', groupId });
  res.json({ success: true });
});

// Rejoindre une chaîne
app.post('/api/join/channel', (req, res) => {
  const { channelLink } = req.body;
  if (!channelLink) return res.status(400).json({ error: 'Lien manquant' });
  
  io.emit('bot-command', { action: 'join-channel', channelLink });
  res.json({ success: true });
});

// Envoyer un message à un groupe
app.post('/api/send/group', (req, res) => {
  const { groupId, text } = req.body;
  if (!groupId || !text) return res.status(400).json({ error: 'Paramètres manquants' });
  
  io.emit('bot-command', { action: 'send-group-message', groupId, text });
  res.json({ success: true });
});

// Vider l'historique des messages
app.post('/api/clear/messages', (req, res) => {
  dataStore.messages = [];
  io.emit('messages-cleared');
  res.json({ success: true });
});

// ==================== WEBSOCKET ====================

// Authentification Socket.io
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
    botStatus: dataStore.botStatus
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
  });
  
  socket.on('disconnect', () => {
    console.log(`🖥️ Client déconnecté : ${socket.id}`);
  });
});

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
