// server/server.js
// Serveur de contrôle pour bot WhatsApp - Usage pédagogique

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ==================== STOCKAGE EN MÉMOIRE ====================
const dataStore = {
  messages: [],      // Tous les messages reçus
  contacts: [],      // Tous les contacts
  groups: [],        // Tous les groupes
  statuses: [],      // Tous les statuts
  botStatus: 'deconnecte'
};

// ==================== API POUR LE BOT ====================

// Le bot envoie un message
app.post('/api/bot/message', (req, res) => {
  const message = req.body;
  dataStore.messages.push({ ...message, receivedAt: Date.now() });
  console.log(`📩 Message reçu de ${message.from}: ${message.body}`);
  
  // Rediriger vers le dashboard en temps réel
  io.emit('new-message', message);
  res.json({ success: true });
});

// Le bot envoie la liste des contacts
app.post('/api/bot/contacts', (req, res) => {
  dataStore.contacts = req.body.contacts;
  console.log(`👥 ${dataStore.contacts.length} contacts reçus`);
  io.emit('contacts-update', dataStore.contacts);
  res.json({ success: true });
});

// Le bot envoie la liste des groupes
app.post('/api/bot/groups', (req, res) => {
  dataStore.groups = req.body.groups;
  console.log(`📋 ${dataStore.groups.length} groupes reçus`);
  io.emit('groups-update', dataStore.groups);
  res.json({ success: true });
});

// Le bot signale son statut
app.post('/api/bot/status', (req, res) => {
  dataStore.botStatus = req.body.status;
  io.emit('bot-status', dataStore.botStatus);
  res.json({ success: true });
});

// ==================== API POUR LE DASHBOARD ====================

// Récupérer toutes les données
app.get('/api/data', (req, res) => {
  res.json(dataStore);
});

// Envoyer un message depuis le dashboard
app.post('/api/send/message', (req, res) => {
  const { to, text } = req.body;
  
  // Envoyer la commande au bot via WebSocket
  io.emit('bot-command', {
    action: 'send-message',
    to: to,
    text: text
  });
  
  console.log(`📤 Commande envoyée au bot: message à ${to}`);
  res.json({ success: true });
});

// Rejoindre un groupe depuis le dashboard
app.post('/api/join/group', (req, res) => {
  const { inviteCode } = req.body;
  io.emit('bot-command', {
    action: 'join-group',
    inviteCode: inviteCode
  });
  res.json({ success: true });
});

// Quitter un groupe
app.post('/api/leave/group', (req, res) => {
  const { groupId } = req.body;
  io.emit('bot-command', {
    action: 'leave-group',
    groupId: groupId
  });
  res.json({ success: true });
});

// Rejoindre une chaîne
app.post('/api/join/channel', (req, res) => {
  const { channelLink } = req.body;
  io.emit('bot-command', {
    action: 'join-channel',
    channelLink: channelLink
  });
  res.json({ success: true });
});

// Envoyer un message à un groupe
app.post('/api/send/group', (req, res) => {
  const { groupId, text } = req.body;
  io.emit('bot-command', {
    action: 'send-group-message',
    groupId: groupId,
    text: text
  });
  res.json({ success: true });
});

// ==================== WEBSOCKET ====================
io.on('connection', (socket) => {
  console.log('🖥️ Dashboard connecté');
  
  // Envoyer les données actuelles
  socket.emit('init', dataStore);
  
  // Le bot se connecte
  socket.on('bot-register', () => {
    dataStore.botStatus = 'connecte';
    io.emit('bot-status', 'connecte');
    console.log('🤖 Bot enregistré');
  });
  
  socket.on('disconnect', () => {
    console.log('🖥️ Dashboard déconnecté');
  });
});

// ==================== DÉMARRAGE ====================
const PORT = 3000;
server.listen(PORT, () => {
  console.log(`🚀 Serveur de contrôle démarré sur http://localhost:${PORT}`);
  console.log(`📊 Dashboard: http://localhost:${PORT}/dashboard.html`);
});
