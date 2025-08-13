import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import speakeasy from 'speakeasy';
import { v4 as uuidv4 } from 'uuid';
import { users, tokens, tickets } from './store.js';

const app = express();
app.use(express.json());

const JWT_SECRET = 'change_this_secret';

function generateUsername(email) {
  const [firstPart] = email.split('@');
  const [first, last] = firstPart.split('.');
  const year = new Date().getFullYear().toString().slice(-2);
  const firstLetter = first ? first[0] : '';
  const lastPart = last ? last.slice(-5) : '';
  return `${firstLetter}${lastPart}${year}`.toLowerCase();
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = { id: decoded.id };
    next();
  } catch (err) {
    res.status(401).json({ error: 'unauthorized' });
  }
}

// Create user (for demo purposes)
app.post('/api/users', (req, res) => {
  const { email } = req.body;
  const username = generateUsername(email);
  const password_hash = bcrypt.hashSync('CompNet1234', 10);
  if (users.find((u) => u.email === email)) {
    return res.status(400).json({ error: 'User exists' });
  }
  users.push({
    id: users.length + 1,
    email,
    username,
    password_hash,
    cml_url: `https://cml.example.com/${username}`,
    vm1_url: `https://vm.example.com/${username}/1`,
    vm2_url: `https://vm.example.com/${username}/2`,
    totp_secret: null,
  });
  res.json({ username });
});

// Lookup username
app.post('/api/lookup', (req, res) => {
  const { email } = req.body;
  const user = users.find((u) => u.email === email);
  if (!user) return res.status(404).json({ error: 'not found' });
  res.json({ username: user.username });
});

// Login
app.post('/api/login', (req, res) => {
  const { identifier, email, username, password, token } = req.body;
  const loginId = identifier || email || username;
  const user = loginId
    ? loginId.includes('@')
      ? users.find((u) => u.email === loginId)
      : users.find((u) => u.username === loginId)
    : null;
  if (!user) return res.status(401).json({ error: 'invalid credentials' });
  if (!bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'invalid credentials' });
  }
  if (user.totp_secret) {
    const verified = speakeasy.totp.verify({
      secret: user.totp_secret,
      encoding: 'base32',
      token,
    });
    if (!verified) return res.status(401).json({ error: 'invalid token' });
  }
  const jwtToken = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '1h' });
  res.json({ token: jwtToken, username: user.username });
});

// Password reset request
app.post('/api/password-reset-request', (req, res) => {
  const { email } = req.body;
  const user = users.find((u) => u.email === email);
  if (!user) return res.json({ ok: true });
  const token = uuidv4();
  const expires = Date.now() + 1000 * 60 * 60;
  tokens.push({ token, user_id: user.id, expires_at: expires });
  console.log(`Password reset link: http://localhost:3000/reset.html?token=${token}`);
  res.json({ ok: true });
});

// Password reset
app.post('/api/password-reset', (req, res) => {
  const { token, password } = req.body;
  const rowIndex = tokens.findIndex((t) => t.token === token);
  const row = tokens[rowIndex];
  if (!row || row.expires_at < Date.now())
    return res.status(400).json({ error: 'invalid token' });
  const hash = bcrypt.hashSync(password, 10);
  const user = users.find((u) => u.id === row.user_id);
  user.password_hash = hash;
  tokens.splice(rowIndex, 1);
  res.json({ ok: true });
});

// Dashboard data
app.get('/api/dashboard', authMiddleware, (req, res) => {
  const user = users.find((u) => u.id === req.user.id);
  const { username, cml_url, vm1_url, vm2_url } = user;
  res.json({ username, cml_url, vm1_url, vm2_url });
});

// Launch CML
app.get('/api/cml/launch', authMiddleware, (req, res) => {
  const user = users.find((u) => u.id === req.user.id);
  res.json({ url: user.cml_url });
});

// Launch VMs
app.get('/api/vms', authMiddleware, (req, res) => {
  const user = users.find((u) => u.id === req.user.id);
  res.json({ vms: [user.vm1_url, user.vm2_url] });
});

const status = {};

// CML reboot
app.post('/api/cml/reboot', authMiddleware, (req, res) => {
  const key = `cml_${req.user.id}`;
  if (status[key] && Date.now() - status[key] < 120000) {
    return res.status(429).json({ error: 'recently rebooted' });
  }
  status[key] = Date.now();
  setTimeout(() => {
    delete status[key];
  }, 60000);
  res.json({ status: 'rebooting' });
});

// VM reboot
app.post('/api/vm/:index/reboot', authMiddleware, (req, res) => {
  const idx = req.params.index;
  const key = `vm${idx}_${req.user.id}`;
  if (status[key] && Date.now() - status[key] < 120000) {
    return res.status(429).json({ error: 'recently rebooted' });
  }
  status[key] = Date.now();
  setTimeout(() => {
    delete status[key];
  }, 60000);
  res.json({ status: 'rebooting' });
});

// Trouble tickets
app.post('/api/tickets', authMiddleware, (req, res) => {
  const { subject, description } = req.body;
  tickets.push({
    id: tickets.length + 1,
    user_id: req.user.id,
    subject,
    description,
    created_at: Date.now(),
  });
  console.log(`Ticket from user ${req.user.id}: ${subject} - ${description}`);
  res.json({ ok: true });
});

app.use(express.static('public'));

export default app;

if (process.env.NODE_ENV !== 'test') {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`Server running on port ${port}`));
}
