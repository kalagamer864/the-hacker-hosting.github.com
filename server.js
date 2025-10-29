
// Simple demo server for "The Hacker Hosting"
// NOTE: This is a demo implementation intended for local development only.
const fs = require('fs');
const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const SECRET = 'change_this_secret_in_production';
const DB_FILE = path.join(__dirname, 'db.json');

function readDB() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ users: [], servers: [], plans: [] }, null, 2));
  }
  return JSON.parse(fs.readFileSync(DB_FILE));
}
function writeDB(db) { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); }

// Seed plans on first run
const seedPlans = () => {
  const db = readDB();
  if (!db.plans || db.plans.length === 0) {
    db.plans = [
      { id: 'basic', name: 'Basic', ram: '2GB', cpu: '1 vCPU', storage: '5GB', slots: 10, autoBackup: true },
      { id: 'standard', name: 'Standard', ram: '4GB', cpu: '2 vCPU', storage: '10GB', slots: 25, autoBackup: true },
      { id: 'ultimate', name: 'Ultimate', ram: 'Unlimited', cpu: '4 vCPU', storage: 'Unlimited', slots: '∞', autoBackup: true }
    ];
    writeDB(db);
  }
};
seedPlans();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: '*' } });

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Helpers
function findUserByEmail(email) {
  const db = readDB();
  return db.users.find(u => u.email.toLowerCase() === email.toLowerCase());
}

function authMiddleware(req, res, next) {
  const auth = req.headers['authorization'];
  if (!auth) return res.status(401).json({ error: 'Missing authorization header' });
  const parts = auth.split(' ');
  if (parts.length !== 2) return res.status(401).json({ error: 'Invalid authorization format' });
  const token = parts[1];
  try {
    const payload = jwt.verify(token, SECRET);
    req.user = payload;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// Routes
app.get('/api/plans', (req, res) => {
  const db = readDB();
  res.json(db.plans || []);
});

app.post('/api/signup', async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) return res.status(400).json({ error: 'Missing fields' });
  if (findUserByEmail(email)) return res.status(400).json({ error: 'User already exists' });
  const hashed = await bcrypt.hash(password, 10);
  const db = readDB();
  const user = { id: 'u_' + Date.now(), username, email, password: hashed, createdAt: new Date().toISOString() };
  db.users.push(user);
  writeDB(db);
  const token = jwt.sign({ id: user.id, email: user.email, username: user.username }, SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: user.id, username: user.username, email: user.email } });
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Missing fields' });
  const user = findUserByEmail(email);
  if (!user) return res.status(400).json({ error: 'Invalid credentials' });
  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.status(400).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ id: user.id, email: user.email, username: user.username }, SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: user.id, username: user.username, email: user.email } });
});

// Protected demo endpoints
app.get('/api/myservers', authMiddleware, (req, res) => {
  const db = readDB();
  const servers = db.servers.filter(s => s.ownerId === req.user.id);
  res.json(servers);
});

app.post('/api/create-server', authMiddleware, (req, res) => {
  const { name, planId } = req.body;
  if (!name || !planId) return res.status(400).json({ error: 'Missing fields' });
  const db = readDB();
  const plan = db.plans.find(p => p.id === planId);
  if (!plan) return res.status(400).json({ error: 'Plan not found' });
  const serverObj = {
    id: 'srv_' + Date.now(),
    ownerId: req.user.id,
    name,
    planId,
    status: 'running',
    createdAt: new Date().toISOString(),
    players: []
  };
  db.servers.push(serverObj);
  writeDB(db);
  res.json(serverObj);
});

// Socket: simple console log streaming demo
io.on('connection', (socket) => {
  console.log('socket connected', socket.id);
  socket.on('join-server-console', ({ serverId }) => {
    console.log('join-server-console', serverId, socket.id);
    // Emit fake console logs every 3 seconds (demo)
    const interval = setInterval(() => {
      socket.emit('console-log', `[${new Date().toISOString()}] [${serverId}] Demo log: server heartbeat OK`);
    }, 3000);
    socket.on('disconnect', () => clearInterval(interval));
  });
  socket.on('server-command', ({ serverId, cmd }) => {
    socket.emit('console-log', `[${new Date().toISOString()}] [${serverId}] Executed command: ${cmd}`);
  });
});

const port = process.env.PORT || 3000;
server.listen(port, () => console.log('Server running on port', port));
