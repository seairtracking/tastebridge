// Accounts, friends and two-phone plan rooms, stored in SQLite (node:sqlite). Only the Node server uses this;
// without a store the app still works fully for guests on one phone.
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';

const DAY = 86400000;
export const SESSION_DAYS = 30;
export const ROOM_HOURS = 48;

export const hash = (token) => createHash('sha256').update(String(token)).digest('hex');
export const token = (bytes = 24) => randomBytes(bytes).toString('base64url');
const ROOM_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // no look-alike characters, easy to read out loud
export const roomId = () => [...randomBytes(10)].map((b) => ROOM_ALPHABET[b % ROOM_ALPHABET.length]).join('');
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function recoveryCode() {
  const c = [...randomBytes(16)].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
  return c.match(/.{4}/g).join('-');
}
const normalizeCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

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
export const PHOTO_MAX = 3 * 1024 * 1024;
// Removes APP1 (EXIF and XMP, which can hold GPS), APP13 (IPTC) and comments from a JPEG; returns null if it is not a JPEG.
export function stripJpeg(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  const out = [buf.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    if (marker === 0xda) { out.push(buf.subarray(i)); return Buffer.concat(out); } // start of scan: image data follows
    const len = buf.readUInt16BE(i + 2);
    if (len < 2 || i + 2 + len > buf.length) return null;
    if (marker !== 0xe1 && marker !== 0xed && marker !== 0xfe) out.push(buf.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  return null;
}
const PHOTO_NAME = /^[A-Za-z0-9_-]{32}\.jpg$/;

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
  created INTEGER NOT NULL,
  recovery TEXT
);
CREATE TABLE IF NOT EXISTS visits (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  place_id TEXT NOT NULL,
  name TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  image TEXT,
  map TEXT,
  with_name TEXT NOT NULL DEFAULT '',
  rating INTEGER NOT NULL DEFAULT 0 CHECK (rating IN (-1, 0, 1)),
  visited INTEGER NOT NULL,
  minutes INTEGER,
  lat REAL,
  lon REAL,
  note TEXT NOT NULL DEFAULT '',
  photo TEXT,
  shared INTEGER NOT NULL DEFAULT 0,
  UNIQUE (user_id, place_id)
);
CREATE TABLE IF NOT EXISTS saved_plans (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  plan TEXT NOT NULL,
  created INTEGER NOT NULL,
  reviewed INTEGER NOT NULL DEFAULT 0
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
  pick TEXT,
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

export function openStore(path, now = () => Date.now(), { photosDir = path === ':memory:' ? null : join(dirname(path), 'photos') } = {}) {
  const db = new DatabaseSync(path);
  if (photosDir) mkdirSync(photosDir, { recursive: true });
  const memPhotos = new Map(); // in-memory databases (tests) keep photos in memory too
  const writePhoto = (name, buf) => (photosDir ? writeFileSync(join(photosDir, name), buf, { mode: 0o600 }) : memPhotos.set(name, buf));
  const readPhoto = (name) => { try { return photosDir ? readFileSync(join(photosDir, name)) : memPhotos.get(name) || null; } catch { return null; } };
  const dropPhoto = (name) => { if (!name || !PHOTO_NAME.test(name)) return; if (photosDir) rmSync(join(photosDir, name), { force: true }); else memPhotos.delete(name); };
  db.exec(SCHEMA);
  if (!db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'recovery')) db.exec('ALTER TABLE users ADD COLUMN recovery TEXT');
  if (!db.prepare('PRAGMA table_info(members)').all().some((c) => c.name === 'pick')) db.exec('ALTER TABLE members ADD COLUMN pick TEXT');
  if (!db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'taste')) db.exec('ALTER TABLE users ADD COLUMN taste TEXT');
  const visitCols = db.prepare('PRAGMA table_info(visits)').all().map((c) => c.name);
  for (const [col, type] of [['minutes', 'INTEGER'], ['lat', 'REAL'], ['lon', 'REAL'], ['note', "TEXT NOT NULL DEFAULT ''"], ['photo', 'TEXT'], ['shared', 'INTEGER NOT NULL DEFAULT 0']]) {
    if (!visitCols.includes(col)) db.exec(`ALTER TABLE visits ADD COLUMN ${col} ${type}`);
  }
  const one = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  const pair = (x, y) => (x < y ? [x, y] : [y, x]);
  const parse = (text) => { try { return text ? JSON.parse(text) : null; } catch { return null; } };
  const publicUser = (u) => u && { id: u.id, username: u.username, display: u.display, favorite: u.favorite, city: u.city, cuisine: u.cuisine, mood: u.mood, taste: parse(u.taste) };

  const sweep = () => {
    run('DELETE FROM sessions WHERE expires < ?', now());
    run('DELETE FROM rooms WHERE expires < ?', now());
  };
  sweep();

  return {
    close: () => db.close(),
    sweep,

    // ---- accounts ----
    // Returns the user and a one-time recovery code; only its hash is stored.
    createUser({ username, password, display }) {
      if (one('SELECT 1 FROM users WHERE username = ?', username)) throw new Error('That username is taken.');
      const code = recoveryCode();
      const r = run('INSERT INTO users (username, pass, display, created, recovery) VALUES (?, ?, ?, ?, ?)', username, hashPassword(password), display, now(), hashPassword(normalizeCode(code)));
      return { user: publicUser(one('SELECT * FROM users WHERE id = ?', Number(r.lastInsertRowid))), recoveryCode: code };
    },
    // Forgot password: a valid recovery code sets a new password, signs out every device and issues a new code.
    recover(username, code, password) {
      const u = one('SELECT * FROM users WHERE username = ?', username);
      const ok = checkPassword(normalizeCode(code), u?.recovery || DUMMY);
      if (!u || !ok) return null;
      const next = recoveryCode();
      run('UPDATE users SET pass = ?, recovery = ? WHERE id = ?', hashPassword(password), hashPassword(normalizeCode(next)), u.id);
      run('DELETE FROM sessions WHERE user_id = ?', u.id);
      return { user: publicUser(u), recoveryCode: next };
    },
    changePassword(userId, current, password, keepSession) {
      const u = one('SELECT pass FROM users WHERE id = ?', userId);
      if (!u || !checkPassword(current, u.pass)) return false;
      run('UPDATE users SET pass = ? WHERE id = ?', hashPassword(password), userId);
      run('DELETE FROM sessions WHERE user_id = ? AND hash != ?', userId, hash(keepSession || '')); // other devices sign out
      return true;
    },
    newRecoveryCode(userId) {
      const code = recoveryCode();
      run('UPDATE users SET recovery = ? WHERE id = ?', hashPassword(normalizeCode(code)), userId);
      return code;
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
    // The detailed taste profile, already cleaned by taste.js (known ids and short names only).
    setTaste(userId, taste) {
      run('UPDATE users SET taste = ? WHERE id = ?', taste ? JSON.stringify(taste) : null, userId);
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
        for (const { photo } of all('SELECT photo FROM visits WHERE user_id = ? AND photo IS NOT NULL', userId)) dropPhoto(photo);
        run('DELETE FROM users WHERE id = ?', userId);
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
    userByName(username) { return publicUser(one('SELECT * FROM users WHERE username = ?', username)); },

    // ---- places you have been, and plans you made ----
    // `minutes` (how long you stayed) is filled in later when the app noticed you leaving.
    addVisit(userId, place, withName = '', minutes = null) {
      const lat = Number.isFinite(place.lat) ? place.lat : null, lon = Number.isFinite(place.lon) ? place.lon : null;
      run(`INSERT INTO visits (user_id, place_id, name, address, category, image, map, with_name, visited, minutes, lat, lon) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (user_id, place_id) DO UPDATE SET visited = CASE WHEN excluded.minutes IS NULL THEN excluded.visited ELSE visits.visited END,
          with_name = CASE WHEN excluded.with_name != '' THEN excluded.with_name ELSE visits.with_name END, minutes = COALESCE(excluded.minutes, visits.minutes),
          lat = COALESCE(excluded.lat, visits.lat), lon = COALESCE(excluded.lon, visits.lon)`,
        userId, place.id, place.name, place.address || '', place.category || '', place.image || null, place.map || null, withName, now(), minutes, lat, lon);
    },
    rateVisit(userId, visitId, rating) { return run('UPDATE visits SET rating = ? WHERE id = ? AND user_id = ?', rating, visitId, userId).changes > 0; },
    removeVisit(userId, visitId) {
      const v = one('SELECT photo FROM visits WHERE id = ? AND user_id = ?', visitId, userId);
      if (!v) return false;
      dropPhoto(v.photo);
      return run('DELETE FROM visits WHERE id = ? AND user_id = ?', visitId, userId).changes > 0;
    },
    // ---- memories: a note, a photo and whether friends can see this check-in ----
    setMemory(userId, visitId, { note, shared }) {
      return run('UPDATE visits SET note = ?, shared = ? WHERE id = ? AND user_id = ?', note, shared ? 1 : 0, visitId, userId).changes > 0;
    },
    savePhoto(userId, visitId, buf) {
      const v = one('SELECT photo FROM visits WHERE id = ? AND user_id = ?', visitId, userId);
      if (!v) throw new Error('Check-in not found.');
      if (buf.length > PHOTO_MAX) throw new Error('Photos can be up to 3 MB.');
      const clean = stripJpeg(buf);
      if (!clean) throw new Error('Upload a JPEG photo.');
      const name = randomBytes(24).toString('base64url') + '.jpg';
      writePhoto(name, clean);
      run('UPDATE visits SET photo = ? WHERE id = ?', name, visitId);
      dropPhoto(v.photo);
      return name;
    },
    removePhoto(userId, visitId) {
      const v = one('SELECT photo FROM visits WHERE id = ? AND user_id = ?', visitId, userId);
      if (!v) return false;
      dropPhoto(v.photo);
      return run('UPDATE visits SET photo = NULL WHERE id = ?', visitId).changes > 0;
    },
    // A photo is visible to its owner, and to accepted friends when that check-in is shared.
    photo(name, viewerId) {
      if (!PHOTO_NAME.test(String(name)) || !viewerId) return null;
      const v = one('SELECT user_id, shared FROM visits WHERE photo = ?', name);
      if (!v) return null;
      if (v.user_id !== viewerId && !(v.shared && this.areFriends(viewerId, v.user_id))) return null;
      return readPhoto(name);
    },
    memoriesOf(userId) {
      const mine = all(`SELECT id, place_id AS placeId, name, address, category, map, with_name AS withName, rating, visited, minutes, lat, lon, note, photo, shared
        FROM visits WHERE user_id = ? ORDER BY visited DESC LIMIT 500`, userId);
      const friends = all(`SELECT v.id, v.place_id AS placeId, v.name, v.address, v.category, v.map, v.rating, v.visited, v.lat, v.lon, v.note, v.photo, u.display AS friend, u.username
        FROM visits v JOIN users u ON u.id = v.user_id
        JOIN friends f ON f.status = 'accepted' AND ((f.a = ? AND f.b = v.user_id) OR (f.b = ? AND f.a = v.user_id))
        WHERE v.shared = 1 ORDER BY v.visited DESC LIMIT 500`, userId, userId);
      return { mine, friends };
    },
    visitsOf(userId, limit = 100) {
      return all('SELECT id, place_id AS placeId, name, address, category, image, map, with_name AS withName, rating, visited, minutes, note, photo, shared FROM visits WHERE user_id = ? ORDER BY visited DESC LIMIT ?', userId, limit);
    },
    // Place ids the agent should treat as "been there" (1) or "not for us" (-1) for these people.
    seenBy(userIds) {
      const ids = userIds.filter(Boolean);
      if (!ids.length) return {};
      const rows = all(`SELECT place_id, MIN(rating) AS rating FROM visits WHERE user_id IN (${ids.map(() => '?').join(',')}) GROUP BY place_id`, ...ids);
      return Object.fromEntries(rows.map((r) => [r.place_id, r.rating < 0 ? -1 : 1]));
    },
    savePlanFor(userId, title, plan) {
      run('INSERT INTO saved_plans (user_id, title, plan, created) VALUES (?, ?, ?, ?)', userId, title, JSON.stringify(plan), now());
      // keep the 30 most recent plans per person
      run('DELETE FROM saved_plans WHERE user_id = ? AND id NOT IN (SELECT id FROM saved_plans WHERE user_id = ? ORDER BY created DESC LIMIT 30)', userId, userId);
    },
    plansOf(userId) { return all('SELECT id, title, created FROM saved_plans WHERE user_id = ? ORDER BY created DESC', userId); },
    savedPlan(userId, id) {
      const r = one('SELECT plan FROM saved_plans WHERE id = ? AND user_id = ?', id, userId);
      return r ? JSON.parse(r.plan) : null;
    },
    removePlan(userId, id) { return run('DELETE FROM saved_plans WHERE id = ? AND user_id = ?', id, userId).changes > 0; },
    // "How was it?": the latest plan from at least 3 hours ago (and under a week old) that nobody answered yet.
    pendingReview(userId) {
      const r = one('SELECT id, title, plan, created FROM saved_plans WHERE user_id = ? AND reviewed = 0 AND created < ? AND created > ? ORDER BY created DESC LIMIT 1', userId, now() - 3 * 3600000, now() - 7 * DAY);
      return r ? { id: r.id, title: r.title, created: r.created, plan: JSON.parse(r.plan) } : null;
    },
    markReviewed(userId, id) { return run('UPDATE saved_plans SET reviewed = 1 WHERE id = ? AND user_id = ?', id, userId).changes > 0; },

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
    createRoom({ settings, name, favorite, pick = null, userId = null }) {
      const id = roomId(), t = token();
      db.exec('BEGIN');
      try {
        run('INSERT INTO rooms (id, created, expires, settings) VALUES (?, ?, ?, ?)', id, now(), now() + ROOM_HOURS * 3600000, JSON.stringify(settings));
        run('INSERT INTO members (room_id, slot, name, favorite, pick, user_id, token_hash, joined) VALUES (?, 0, ?, ?, ?, ?, ?, ?)', id, name, favorite, pick, userId, hash(t), now());
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
      return { id, token: t };
    },
    joinRoom(id, { name, favorite, pick = null, userId = null }) {
      const room = one('SELECT * FROM rooms WHERE id = ? AND expires > ?', id, now());
      if (!room) throw new Error('This invite has expired or does not exist.');
      if (one('SELECT 1 FROM members WHERE room_id = ? AND slot = 1', id)) throw new Error('Someone has already joined this plan.');
      const t = token();
      run('INSERT INTO members (room_id, slot, name, favorite, pick, user_id, token_hash, joined) VALUES (?, 1, ?, ?, ?, ?, ?, ?)', id, name, favorite, pick, userId, hash(t), now());
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
        members: all('SELECT slot, name, favorite, pick, user_id AS userId, joined FROM members WHERE room_id = ? ORDER BY slot', id),
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
