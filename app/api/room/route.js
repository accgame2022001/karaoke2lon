import { NextResponse } from "next/server";
import { getState, setState, advance, clean, setVote, collectVotes, listIds, MAX } from "../../../lib/lk";
export const dynamic = "force-dynamic";

const dec = (s) => s.replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"');
const ok = () => NextResponse.json({ ok: true });
const bad = (error, status = 400) => NextResponse.json({ error }, { status });

export async function POST(req) {
  const b = await req.json();
  const room = clean(b.room);
  if (!room) return bad("Thiếu tên phòng");
  const st = await getState(room);
  st.lb ||= {}; st.hist ||= []; st.seat ||= {}; st.ask ||= [];
  const a = b.action;

  if (a === "vote") {
    const r = st.rate, s = Math.round(+b.score);
    const ex = r ? [r.by, ...(r.duo || []).map((d) => d.id)] : [];
    if (!r || r.t0 !== b.t0 || Date.now() > r.until + 1500 || ex.includes(b.identity) || !(s >= 1 && s <= 10)) return bad("Đã hết giờ chấm điểm");
    await setVote(room, b.identity, r.t0, s);
    return ok();
  }

  // Bỏ các bài của người đã thoát phòng khỏi hàng chờ
  if (a === "add" || a === "next") {
    const ids = new Set(await listIds(room));
    st.q = st.q.filter((x) => ids.has(x.by));
  }

  if (a === "add") {
    if (room === "phong-dao") return bad("Phòng Đào không có nhạc");
    const vid = String(b.vid || "");
    if (!/^[\w-]{11}$/.test(vid)) return bad("Link YouTube không hợp lệ");
    let title = b.title;
    if (!title) {
      try {
        const r = await fetch(`https://www.youtube.com/oembed?url=https://youtu.be/${vid}&format=json`);
        title = (await r.json()).title;
      } catch {}
    }
    st.q.push({ vid, title: dec(title || vid), by: b.identity, byName: b.name });
    if (!st.cur) advance(st);
  } else if (a === "next") {
    // t0 làm "khóa": nhiều máy cùng báo hết bài thì chỉ chuyển bài một lần
    if (!st.cur || st.cur.t0 !== b.t0) return ok();
    // Hát xong (không phải bỏ qua) thì mở 10 giây chấm điểm và ghi vào 10 bài gần nhất
    if (!b.skip) {
      const c = st.cur;
      st.rate = { t0: c.t0, by: c.by, byName: c.byName, title: c.title, duo: c.duo || [], until: Date.now() + 10000 };
      st.hist = [{ vid: c.vid, title: c.title, byName: c.byName }, ...st.hist.filter((x) => x.vid !== c.vid)].slice(0, 10);
    }
    advance(st);
  } else if (a === "finalize") {
    const r = st.rate;
    if (!r || r.t0 !== b.t0 || Date.now() < r.until) return ok();
    const duo = r.duo || [];
    const v = await collectVotes(room, r.t0, [r.by, ...duo.map((d) => d.id)]);
    st.rate = null;
    if (v.length) {
      const avg = v.reduce((x, y) => x + y, 0) / v.length;
      const names = [r.byName, ...duo.map((d) => d.name)];
      for (const nm of names) {
        const e = (st.lb[nm.toLowerCase()] ||= { name: nm, pts: 0, n: 0 });
        e.pts = Math.round((e.pts + avg) * 10) / 10;
        e.n++;
      }
      st.last = { name: names.join(" & "), title: r.title, avg: Math.round(avg * 10) / 10, n: v.length };
    }
  } else if (a === "remove") {
    if (st.q[b.i]?.by === b.identity) st.q.splice(b.i, 1);
  } else if (a === "duo_ask") {
    const c = st.cur;
    if (!c || c.by === b.identity || (c.duo || []).some((d) => d.id === b.identity) || st.ask.some((x) => x.id === b.identity) || st.ask.length >= 6) return ok();
    st.ask.push({ id: b.identity, name: String(b.name || "Khách").slice(0, 30) });
  } else if (a === "duo_ok" || a === "duo_no") {
    if (st.cur?.by !== b.identity) return bad("Chỉ người đang hát mới được duyệt", 403);
    const who = st.ask.find((x) => x.id === b.who);
    st.ask = st.ask.filter((x) => x.id !== b.who);
    if (who && a === "duo_ok" && (st.cur.duo ||= []).length < 3) st.cur.duo.push(who);
  } else if (a === "duo_leave") {
    if (st.cur?.duo) st.cur.duo = st.cur.duo.filter((d) => d.id !== b.identity);
  } else if (a === "seat") {
    const ids = new Set(await listIds(room));
    for (const k in st.seat) if (!ids.has(k)) delete st.seat[k];
    const n = Math.floor(+b.n);
    if (!(n >= 0 && n < MAX)) return bad("Ghế không hợp lệ");
    if (Object.entries(st.seat).some(([k, v]) => v === n && k !== b.identity)) return bad("Ghế này đã có người ngồi", 409);
    st.seat[b.identity] = n;
  }
  await setState(room, st);
  return ok();
}
