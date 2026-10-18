// Optional accounts and two-phone plan rooms. Everything here is extra: guests can still plan on one phone
// without signing up. Routes: /api/account/* and /api/rooms/*.
import { tidy } from './qloo.js';
import { CUISINES, MOODS, SPECIALS } from './evening.js';
import { OCCASIONS } from './engine.js';
import { SESSION_DAYS } from './store.js';

const COOKIE = 'tb_session';
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });
const fail = (error, status = 400) => json({ error }, status);

function cookie(request, name) {
  for (const part of (request.headers.get('cookie') || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}
const sessionCookie = (value, maxAge) => `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

// State-changing requests must come from this site (the session cookie is also SameSite=Lax).
function sameOrigin(request) {
  if (request.method === 'GET') return true;
  const origin = request.headers.get('origin');
  return !origin || origin === new URL(request.url).origin;
}

const USERNAME = /^[a-z0-9_.]{3,20}$/i;
const cleanSettings = (s = {}) => {
  const lat = Number(s.lat), lon = Number(s.lon);
  const near = Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);
  return {
    mode: s.mode === 'plan' ? 'plan' : 'evening',
    city: tidy(s.city, 70),
    lat: near ? Math.round(lat * 1e4) / 1e4 : null, lon: near ? Math.round(lon * 1e4) / 1e4 : null,
    start: /^\d{1,2}:\d{2}$/.test(s.start || '') ? s.start : '18:30',
    day: ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].includes(s.day) ? s.day : null,
    cuisine: CUISINES.includes(s.cuisine) ? s.cuisine : '',
    mood: MOODS.includes(s.mood) ? s.mood : '',
    budget: [1, 2, 3, 4].includes(Number(s.budget)) ? Number(s.budget) : null,
    occasion: Object.hasOwn(OCCASIONS, s.occasion) ? s.occasion : 'dinner',
    special: Object.hasOwn(SPECIALS, s.special) ? s.special : '',
  };
};

// Every option in a plan that people can vote on, keyed by its Qloo id.
const optionIds = (plan) => new Set([...(plan?.places || []), ...(plan?.stops || []).flatMap((s) => s.options), ...(plan?.films || [])].map((x) => x.id));

export async function handleSocial(request, env, { allow, runPlan }) {
  const url = new URL(request.url);
  const store = env.STORE;
  if (!store) return fail('Accounts and shared plans need the TasteBridge Node server.', 503);
  if (!sameOrigin(request)) return fail('Cross-site request blocked.', 403);
  if (Number(request.headers.get('content-length') || 0) > 4000) return fail('Request is too large.', 413);
  let body = {};
  if (request.method !== 'GET') {
    const raw = await request.text(); // read with a hard cap, even without a content-length header
    if (raw.length > 4000) return fail('Request is too large.', 413);
    try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
  }

  const sessionToken = cookie(request, COOKIE);
  const me = store.sessionUser(sessionToken);
  const parts = url.pathname.split('/').filter(Boolean); // ['api', 'account' | 'rooms', ...]

  // ---------- accounts ----------
  if (parts[1] === 'account') {
    const action = parts.slice(2).join('/');
    if (action === 'signup' && request.method === 'POST') {
      if (!allow(request, 10, 'signup')) return fail('Too many sign-ups from this connection. Try again later.', 429);
      const username = tidy(body.username, 20), password = typeof body.password === 'string' ? body.password : '';
      const display = tidy(body.display, 40) || username;
      if (!USERNAME.test(username)) return fail('Usernames are 3 to 20 letters, numbers, dots or underscores.');
      if (password.length < 8 || password.length > 200) return fail('Use a password of at least 8 characters.');
      let user;
      try { user = store.createUser({ username, password, display }); } catch (e) { return fail(e.message, 409); }
      return json({ user }, 200, { 'set-cookie': sessionCookie(store.startSession(user.id), SESSION_DAYS * 86400) });
    }
    if (action === 'login' && request.method === 'POST') {
      const username = tidy(body.username, 20);
      if (!allow(request, 10, 'login') || !allow(request, 10, 'login:' + username.toLowerCase())) return fail('Too many sign-in attempts. Try again in a few minutes.', 429);
      const user = store.login(username, typeof body.password === 'string' ? body.password.slice(0, 200) : '');
      if (!user) return fail('Wrong username or password.', 401);
      return json({ user }, 200, { 'set-cookie': sessionCookie(store.startSession(user.id), SESSION_DAYS * 86400) });
    }
    if (action === 'logout' && request.method === 'POST') {
      store.endSession(sessionToken);
      return json({ ok: true }, 200, { 'set-cookie': sessionCookie('', 0) });
    }
    if (action === '' && request.method === 'GET') {
      if (!me) return json({ user: null });
      return json({ user: me, friends: store.friendsOf(me.id), invites: store.invitesFor(me.id), rooms: store.roomsOf(me.id) });
    }
    if (!me) return fail('Please sign in.', 401);
    if (action === 'profile' && request.method === 'PUT') {
      const user = store.updateProfile(me.id, {
        display: tidy(body.display, 40) || me.display,
        favorite: tidy(body.favorite, 70), city: tidy(body.city, 70),
        cuisine: CUISINES.includes(body.cuisine) ? body.cuisine : '', mood: MOODS.includes(body.mood) ? body.mood : '',
      });
      return json({ user });
    }
    if (action.startsWith('friends') && request.method === 'POST') {
      const other = store.userByName(tidy(body.username, 20));
      if (!other) return fail('No one has that username.', 404);
      if (action === 'friends') {
        if (!allow(request, 30, 'friend')) return fail('Too many friend requests. Try again later.', 429);
        try { return json({ status: store.requestFriend(me.id, other.id) }); } catch (e) { return fail(e.message); }
      }
      if (action === 'friends/accept') return json({ ok: store.acceptFriend(me.id, other.id) });
      if (action === 'friends/remove') return json({ ok: store.removeFriend(me.id, other.id) });
    }
    if (action === 'delete' && request.method === 'POST') {
      if (!store.checkUserPassword(me.id, typeof body.password === 'string' ? body.password.slice(0, 200) : '')) return fail('Wrong password.', 401);
      store.deleteUser(me.id);
      return json({ ok: true }, 200, { 'set-cookie': sessionCookie('', 0) });
    }
    return fail('Not found.', 404);
  }

  // ---------- two-phone rooms ----------
  if (parts[1] === 'rooms') {
    const id = parts[2], action = parts[3] || '';
    const roomToken = request.headers.get('x-room-token');

    if (!id && request.method === 'POST') {
      if (!allow(request, 20, 'room')) return fail('Too many invites from this connection. Try again later.', 429);
      const name = tidy(body.name, 40) || me?.display || 'Me';
      const favorite = tidy(body.favorite, 70) || me?.favorite || '';
      if (favorite.length < 2) return fail('Enter your favorite first.');
      const settings = cleanSettings(body.settings);
      if (!settings.city && settings.lat == null) return fail('Enter a city or use your location.');
      let friend = null;
      if (body.invite) {
        if (!me) return fail('Sign in to invite a friend by username.', 401);
        friend = store.userByName(tidy(body.invite, 20));
        if (!friend || !store.areFriends(me.id, friend.id)) return fail('You can only invite people who accepted your friend request.', 403);
      }
      const room = store.createRoom({ settings, name, favorite, userId: me?.id ?? null });
      if (friend && friend.favorite) {
        // Friends agreed to share their favorite when they accepted, so their seat fills in from their profile;
        // they still see the plan on their own phone and can vote.
        store.joinRoom(room.id, { name: friend.display, favorite: friend.favorite, userId: friend.id });
      } else if (friend) store.invite(room.id, friend.id);
      return json({ id: room.id, token: room.token, url: `${url.origin}/r/${room.id}` });
    }

    const room = id && /^[a-z0-9]{6,16}$/.test(id) ? store.room(id) : null;
    if (!room) return fail('This invite has expired or does not exist.', 404);
    const seat = store.seat(room.id, roomToken, me?.id);

    if (!action && request.method === 'GET') {
      const planned = !!room.plan;
      const tally = {};
      for (const v of room.votes) {
        const t = (tally[v.option] ||= { up: 0, down: 0, mine: 0 });
        if (v.value > 0) t.up++; else t.down++;
        if (v.slot === seat) t.mine = v.value;
      }
      return json({
        // The host's location stays on the server: the room only says whether it plans near them.
        id: room.id, expires: room.expires, settings: { ...room.settings, lat: undefined, lon: undefined, near: room.settings.lat != null }, you: seat,
        // Each person's favorite stays hidden from the other until the plan is made, so nobody adjusts to the other.
        members: room.members.map((m) => ({ slot: m.slot, name: m.name, joined: m.joined, favorite: planned || m.slot === seat ? m.favorite : null })),
        canJoin: seat == null && room.members.length < 2,
        plan: room.plan, planned: room.planned, votes: tally,
      });
    }
    if (action === 'join' && request.method === 'POST') {
      if (seat != null) return fail('You are already in this plan.', 409);
      const name = tidy(body.name, 40) || me?.display || 'Friend';
      const favorite = tidy(body.favorite, 70) || me?.favorite || '';
      if (favorite.length < 2) return fail('Enter your favorite first.');
      try { return json(store.joinRoom(room.id, { name, favorite, userId: me?.id ?? null })); } catch (e) { return fail(e.message, 409); }
    }
    if (seat == null) return fail('Only the two people in this plan can do that.', 403);
    if (action === 'vote' && request.method === 'POST') {
      const option = String(body.option || ''), value = Number(body.value);
      if (!room.plan || !optionIds(room.plan).has(option) || ![-1, 0, 1].includes(value)) return fail('Unknown option.');
      store.vote(room.id, seat, option, value);
      return json({ ok: true });
    }
    if (action === 'plan' && request.method === 'POST') {
      if (room.members.length < 2) return fail('Wait for your friend to join first.', 409);
      const s = room.settings;
      const input = {
        favorites: room.members.map((m) => m.favorite), names: room.members.map((m) => m.name),
        city: s.city, lat: s.lat, lon: s.lon, start: s.start, day: s.day, cuisine: s.cuisine, mood: s.mood, budget: s.budget, occasion: s.occasion, special: s.special,
      };
      return runPlan(s.mode, input, request, (result) => store.savePlan(room.id, { ...result, room: room.id }));
    }
    return fail('Not found.', 404);
  }
  return fail('Not found.', 404);
}
