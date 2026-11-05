import { NextResponse } from "next/server";
import { getState, makeToken, clean } from "../../../lib/lk";
export const dynamic = "force-dynamic";

export async function POST(req) {
  const b = await req.json();
  const room = clean(b.room);
  if (!room || !b.identity) return NextResponse.json({ error: "Thiếu tên phòng" }, { status: 400 });
  try {
    const st = await getState(room);
    const token = await makeToken(room, b.identity, b.name || "Khách", st.cur?.by === b.identity);
    return NextResponse.json({ token, url: process.env.LIVEKIT_URL, now: Date.now() });
  } catch (e) {
    return NextResponse.json({ error: "Lỗi LiveKit: kiểm tra biến môi trường" }, { status: 500 });
  }
}
