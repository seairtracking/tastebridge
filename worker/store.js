// Accounts, friends and two-phone plan rooms, stored in SQLite (node:sqlite). Only the Node server uses this;
// without a store the app still works fully for guests on one phone.
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';

const DAY = 86400000;
export const SESSION_DAYS = 30;
export const ROOM_HOURS = 48;

export const hash = (token) => createHash('sha256').update(String(token)).digest('hex');
export const token = (bytes = 24) => randomBytes(bytes).toString('base64url');
const ROOM_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // no look-alike characters, easy to read out loud
export const roomId = () => [...randomBytes(10)].map((b) => ROOM_ALPHABET[b % ROOM_ALPHABET.length]).join('');

// Passwords: scrypt with a random salt, compared in constant time.
export function hashPassword(password) {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('base64')}$${scryptSync(password, salt, 64).toString('base64')}`;
}
export function checkPassword(password, stored) {
  const [kind, salt, digest] = String(stored || '').split('$');
  if (kind !== 'scrypt' || !salt || !digest) return false;
  const expected = Buffer.from(digest, 'base64');
  const actual = scryptSync(password, Buffer.from(salt, 'base64'), expected.length);
  return timingSafeEqual(actual, expected);
}
const DUMMY = hashPassword(randomBytes(12).toString('hex')); // keeps login timing equal for unknown names

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pass TEXT NOT NULL,
  display TEXT NOT NULL,
  favorite TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  cuisine TEXT NOT NULL DEFAULT '',
  mood TEXT NOT NULL DEFAULT '',
  created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS friends (
  a INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  b INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requester INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted')),
  created INTEGER NOT NULL,
  PRIMARY KEY (a, b),
  CHECK (a < b)
);
CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  created INTEGER NOT NULL,
  expires INTEGER NOT NULL,
  settings TEXT NOT NULL,
  plan TEXT,
  planned INTEGER
);
CREATE TABLE IF NOT EXISTS members (
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  slot INTEGER NOT NULL CHECK (slot IN (0, 1)),
  name TEXT NOT NULL,
  favorite TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  token_hash TEXT NOT NULL,
  joined INTEGER NOT NULL,
  PRIMARY KEY (room_id, slot)
);
CREATE TABLE IF NOT EXISTS invites (
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (room_id, user_id)
);
CREATE TABLE IF NOT EXISTS votes (
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  slot INTEGER NOT NULL,
  option TEXT NOT NULL,
  value INTEGER NOT NULL CHECK (value IN (-1, 1)),
  PRIMARY KEY (room_id, slot, option)
);
`;

export function openStore(path, now = () => Date.now()) {
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  const one = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  const pair = (x, y) => (x < y ? [x, y] : [y, x]);
  const publicUser = (u) => u && { id: u.id, username: u.username, display: u.display, favorite: u.favorite, city: u.city, cuisine: u.cuisine, mood: u.mood };

  const sweep = () => {
    run('DELETE FROM sessions WHERE expires < ?', now());
    run('DELETE FROM rooms WHERE expires < ?', now());
  };
  sweep();

  return {
    close: () => db.close(),
    sweep,

    // ---- accounts ----
    createUser({ username, password, display }) {
      if (one('SELECT 1 FROM users WHERE username = ?', username)) throw new Error('That username is taken.');
      const r = run('INSERT INTO users (username, pass, display, created) VALUES (?, ?, ?, ?)', username, hashPassword(password), display, now());
      return publicUser(one('SELECT * FROM users WHERE id = ?', Number(r.lastInsertRowid)));
    },
    login(username, password) {
      const u = one('SELECT * FROM users WHERE username = ?', username);
      const ok = checkPassword(password, u ? u.pass : DUMMY);
      return u && ok ? publicUser(u) : null;
    },
    startSession(userId) {
      const t = token(32);
      run('INSERT INTO sessions (hash, user_id, expires) VALUES (?, ?, ?)', hash(t), userId, now() + SESSION_DAYS * DAY);
      return t;
    },
    sessionUser(t) {
      if (!t) return null;
      return publicUser(one('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.hash = ? AND s.expires > ?', hash(t), now()));
    },
    endSession(t) { if (t) run('DELETE FROM sessions WHERE hash = ?', hash(t)); },
    updateProfile(userId, { display, favorite, city, cuisine, mood }) {
      run('UPDATE users SET display = ?, favorite = ?, city = ?, cuisine = ?, mood = ? WHERE id = ?', display, favorite, city, cuisine, mood, userId);
      return publicUser(one('SELECT * FROM users WHERE id = ?', userId));
    },
    checkUserPassword(userId, password) {
      const u = one('SELECT pass FROM users WHERE id = ?', userId);
      return !!u && checkPassword(password, u.pass);
    },
    deleteUser(userId) {
      // Rooms this person hosted go too; in other rooms their seat stays but loses the link to the account.
      db.exec('BEGIN');
      try {
        for (const { room_id } of all('SELECT room_id FROM members WHERE user_id = ? AND slot = 0', userId)) run('DELETE FROM rooms WHERE id = ?', room_id);
        run('DELETE FROM users WHERE id = ?', userId);
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
    userByName(username) { return publicUser(one('SELECT * FROM users WHERE username = ?', username)); },

    // ---- friends: a request must be accepted before either side can use the other's favorite ----
    requestFriend(userId, otherId) {
      if (userId === otherId) throw new Error('You cannot add yourself.');
      const [a, b] = pair(userId, otherId);
      const row = one('SELECT * FROM friends WHERE a = ? AND b = ?', a, b);
      if (!row) { run('INSERT INTO friends (a, b, requester, status, created) VALUES (?, ?, ?, ?, ?)', a, b, userId, 'pending', now()); return 'pending'; }
      if (row.status === 'pending' && row.requester !== userId) { run("UPDATE friends SET status = 'accepted' WHERE a = ? AND b = ?", a, b); return 'accepted'; }
      return row.status;
    },
    acceptFriend(userId, otherId) {
      const [a, b] = pair(userId, otherId);
      const r = run("UPDATE friends SET status = 'accepted' WHERE a = ? AND b = ? AND status = 'pending' AND requester = ?", a, b, otherId);
      return r.changes > 0;
    },
    removeFriend(userId, otherId) {
      const [a, b] = pair(userId, otherId);
      return run('DELETE FROM friends WHERE a = ? AND b = ?', a, b).changes > 0;
    },
    areFriends(userId, otherId) {
      const [a, b] = pair(userId, otherId);
      return !!one("SELECT 1 FROM friends WHERE a = ? AND b = ? AND status = 'accepted'", a, b);
    },
    friendsOf(userId) {
      return all(`SELECT f.status, f.requester, u.id, u.username, u.display, u.favorite FROM friends f
        JOIN users u ON u.id = CASE WHEN f.a = ? THEN f.b ELSE f.a END
        WHERE f.a = ? OR f.b = ? ORDER BY f.status DESC, u.display`, userId, userId, userId)
        .map((r) => ({
          username: r.username, display: r.display,
          status: r.status === 'accepted' ? 'friend' : r.requester === userId ? 'sent' : 'received',
          favorite: r.status === 'accepted' ? r.favorite : null, // only friends see each other's favorite
        }));
    },

    // ---- rooms: two phones, one plan ----
    createRoom({ settings, name, favorite, userId = null }) {
      const id = roomId(), t = token();
      db.exec('BEGIN');
      try {
        run('INSERT INTO rooms (id, created, expires, settings) VALUES (?, ?, ?, ?)', id, now(), now() + ROOM_HOURS * 3600000, JSON.stringify(settings));
        run('INSERT INTO members (room_id, slot, name, favorite, user_id, token_hash, joined) VALUES (?, 0, ?, ?, ?, ?, ?)', id, name, favorite, userId, hash(t), now());
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
      return { id, token: t };
    },
    joinRoom(id, { name, favorite, userId = null }) {
      const room = one('SELECT * FROM rooms WHERE id = ? AND expires > ?', id, now());
      if (!room) throw new Error('This invite has expired or does not exist.');
      if (one('SELECT 1 FROM members WHERE room_id = ? AND slot = 1', id)) throw new Error('Someone has already joined this plan.');
      const t = token();
      run('INSERT INTO members (room_id, slot, name, favorite, user_id, token_hash, joined) VALUES (?, 1, ?, ?, ?, ?, ?)', id, name, favorite, userId, hash(t), now());
      run('DELETE FROM invites WHERE room_id = ?', id);
      return { token: t };
    },
    // Which seat (0 = host, 1 = friend) a room token belongs to, or a signed-in member's seat.
    seat(id, roomToken, userId = null) {
      if (roomToken) { const m = one('SELECT slot FROM members WHERE room_id = ? AND token_hash = ?', id, hash(roomToken)); if (m) return m.slot; }
      if (userId) { const m = one('SELECT slot FROM members WHERE room_id = ? AND user_id = ?', id, userId); if (m) return m.slot; }
      return null;
    },
    room(id) {
      const r = one('SELECT * FROM rooms WHERE id = ? AND expires > ?', id, now());
      if (!r) return null;
      return {
        id: r.id, created: r.created, expires: r.expires, settings: JSON.parse(r.settings),
        plan: r.plan ? JSON.parse(r.plan) : null, planned: r.planned,
        members: all('SELECT slot, name, favorite, user_id AS userId, joined FROM members WHERE room_id = ? ORDER BY slot', id),
        votes: all('SELECT slot, option, value FROM votes WHERE room_id = ?', id),
      };
    },
    savePlan(id, plan) {
      run('UPDATE rooms SET plan = ?, planned = ? WHERE id = ?', JSON.stringify(plan), now(), id);
      run('DELETE FROM votes WHERE room_id = ?', id);
    },
    vote(id, slot, option, value) {
      if (value === 0) run('DELETE FROM votes WHERE room_id = ? AND slot = ? AND option = ?', id, slot, option);
      else run('INSERT INTO votes (room_id, slot, option, value) VALUES (?, ?, ?, ?) ON CONFLICT (room_id, slot, option) DO UPDATE SET value = excluded.value', id, slot, option, value);
    },
    invite(id, userId) { run('INSERT OR IGNORE INTO invites (room_id, user_id) VALUES (?, ?)', id, userId); },
    invitesFor(userId) {
      return all(`SELECT r.id, r.created, m.name AS host FROM invites i JOIN rooms r ON r.id = i.room_id
        JOIN members m ON m.room_id = r.id AND m.slot = 0 WHERE i.user_id = ? AND r.expires > ? ORDER BY r.created DESC`, userId, now());
    },
    roomsOf(userId) {
      return all(`SELECT r.id, r.created, r.planned, m.slot,
          (SELECT name FROM members o WHERE o.room_id = r.id AND o.slot != m.slot) AS other
        FROM members m JOIN rooms r ON r.id = m.room_id WHERE m.user_id = ? AND r.expires > ? ORDER BY r.created DESC LIMIT 20`, userId, now());
    },
  };
}
