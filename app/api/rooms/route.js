import { NextResponse } from "next/server";
import { listCounts } from "../../../lib/lk";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ counts: await listCounts(["hoang-gia", "vip-1", "vip-2", "vip-3", "phong-dao"]) });
  } catch {
    return NextResponse.json({ counts: {} });
  }
}
