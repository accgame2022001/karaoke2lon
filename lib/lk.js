import { RoomServiceClient, AccessToken } from "livekit-server-sdk";

export const clean = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 32);
const EMPTY = () => ({ q: [], cur: null, lb: {}, rate: null, last: null, hist: [], seat: {}, ask: [] });
const svc = () =>
  new RoomServiceClient(process.env.LIVEKIT_URL.replace(/^wss?:/, "https:"), process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET);

// Trạng thái phòng (hàng chờ + bài đang hát) lưu trong metadata của phòng LiveKit
export async function getState(room) {
  const s = svc();
  const [r] = await s.listRooms([room]);
  if (!r) {
    await s.createRoom({ name: room, emptyTimeout: 600, metadata: JSON.stringify(EMPTY()) });
    return EMPTY();
  }
  try { return JSON.parse(r.metadata); } catch { return EMPTY(); }
}

// Chỉ người hát được quyền publish mic; đổi quyền trước rồi mới đổi metadata
// Những người được phép mở mic: người hát chính + người được cho hát chung
export const pubs = (st) => (st.cur ? [st.cur.by, ...(st.cur.duo || []).map((d) => d.id)] : []);

// Đổi quyền publish cho người vào/ra khỏi nhóm hát trước, rồi mới đổi metadata
export async function setState(room, st, oldPubs = []) {
  const s = svc();
  const now = pubs(st);
  for (const id of [...oldPubs.filter((x) => !now.includes(x)), ...now.filter((x) => !oldPubs.includes(x))]) {
    await s.updateParticipant(room, id, undefined, { canPublish: now.includes(id), canSubscribe: true, canPublishData: true }).catch(() => {});
  }
  await s.updateRoomMetadata(room, JSON.stringify(st));
}

export function advance(st) {
  const n = st.q.shift();
  st.cur = n ? { ...n, duo: [], t0: Math.ceil((Date.now() + 2500) / 3000) * 3000 } : null;
  st.ask = [];
}

export function makeToken(room, identity, name, canPublish) {
  const t = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, { identity, name, ttl: "6h" });
  t.addGrant({ roomJoin: true, room, canSubscribe: true, canPublish, canPublishData: true });
  return t.toJwt();
}

// Phiếu chấm lưu trong metadata của từng người xem, nên 30 người bấm cùng lúc không ghi đè nhau
export const setVote = (room, identity, t0, score) =>
  svc().updateParticipant(room, identity, JSON.stringify({ vote: { t0, score } }));

export async function collectVotes(room, t0, exclude) {
  const out = [];
  for (const p of await svc().listParticipants(room)) {
    if ([].concat(exclude).includes(p.identity)) continue;
    try { const v = JSON.parse(p.metadata).vote; if (v?.t0 === t0) out.push(v.score); } catch {}
  }
  return out;
}

export const MAX = 30;
export async function listCounts(names) {
  const out = {};
  for (const r of await svc().listRooms(names)) out[r.name] = r.numParticipants;
  return out;
}
export async function roomFull(room) {
  const [r] = await svc().listRooms([room]);
  return (r?.numParticipants || 0) >= MAX;
}

export async function listIds(room) {
  return (await svc().listParticipants(room)).map((p) => p.identity);
}
