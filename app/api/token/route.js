import { NextResponse } from "next/server";
import { getState, makeToken, clean, roomFull, pubs } from "../../../lib/lk";
export const dynamic = "force-dynamic";

export async function POST(req) {
  const b = await req.json();
  const room = clean(b.room);
  if (!room || !b.identity) return NextResponse.json({ error: "Thiếu tên phòng" }, { status: 400 });
  try {
    if (await roomFull(room)) return NextResponse.json({ error: "Phòng đã đầy (30/30 ghế). Hãy chọn phòng khác." }, { status: 409 });
    const st = await getState(room);
    const token = await makeToken(room, b.identity, b.name || "Khách", pubs(st).includes(b.identity));
    return NextResponse.json({ token, url: process.env.LIVEKIT_URL, now: Date.now() });
  } catch (e) {
    return NextResponse.json({ error: "Lỗi LiveKit: kiểm tra biến môi trường" }, { status: 500 });
  }
}
