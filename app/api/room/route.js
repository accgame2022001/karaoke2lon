import { NextResponse } from "next/server";
import { getState, setState, advance, clean, setVote, collectVotes } from "../../../lib/lk";
export const dynamic = "force-dynamic";

const dec = (s) => s.replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"');

export async function POST(req) {
  const b = await req.json();
  const room = clean(b.room);
  if (!room) return NextResponse.json({ error: "Thiếu tên phòng" }, { status: 400 });
  const st = await getState(room);
  st.lb ||= {};
  const oldSinger = st.cur?.by;

  if (b.action === "vote") {
    const r = st.rate, s = Math.round(+b.score);
    if (!r || r.t0 !== b.t0 || Date.now() > r.until + 1500 || b.identity === r.by || !(s >= 1 && s <= 10))
      return NextResponse.json({ error: "Đã hết giờ chấm điểm" }, { status: 400 });
    await setVote(room, b.identity, r.t0, s);
    return NextResponse.json({ ok: true });
  }

  if (b.action === "add") {
    const vid = String(b.vid || "");
    if (!/^[\w-]{11}$/.test(vid)) return NextResponse.json({ error: "Link YouTube không hợp lệ" }, { status: 400 });
    let title = b.title;
    if (!title) {
      try {
        const r = await fetch(`https://www.youtube.com/oembed?url=https://youtu.be/${vid}&format=json`);
        title = (await r.json()).title;
      } catch {}
    }
    st.q.push({ vid, title: dec(title || vid), by: b.identity, byName: b.name });
    if (!st.cur) advance(st);
  } else if (b.action === "next") {
    // t0 làm "khóa": nhiều máy cùng báo hết bài thì chỉ chuyển bài một lần
    if (!st.cur || st.cur.t0 !== b.t0) return NextResponse.json({ ok: true });
    // Hát xong (không phải bỏ qua) thì mở 10 giây chấm điểm; bài kế tiếp vẫn chạy song song
    if (!b.skip) st.rate = { t0: st.cur.t0, by: st.cur.by, byName: st.cur.byName, title: st.cur.title, until: Date.now() + 10000 };
    advance(st);
  } else if (b.action === "finalize") {
    const r = st.rate;
    if (!r || r.t0 !== b.t0 || Date.now() < r.until) return NextResponse.json({ ok: true });
    const v = await collectVotes(room, r.t0, r.by);
    st.rate = null;
    if (v.length) {
      const avg = v.reduce((a, x) => a + x, 0) / v.length;
      const e = (st.lb[r.byName.toLowerCase()] ||= { name: r.byName, pts: 0, n: 0 });
      e.pts = Math.round((e.pts + avg) * 10) / 10;
      e.n++;
      st.last = { name: r.byName, title: r.title, avg: Math.round(avg * 10) / 10, n: v.length };
    }
  } else if (b.action === "remove") {
    if (st.q[b.i]?.by === b.identity) st.q.splice(b.i, 1);
  }
  await setState(room, st, oldSinger);
  return NextResponse.json({ ok: true });
}
