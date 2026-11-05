import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";

export async function GET(req) {
  const q = new URL(req.url).searchParams.get("q") || "";
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return NextResponse.json({ error: "Chưa bật tìm bài. Hãy dán link YouTube, hoặc thêm YOUTUBE_API_KEY." }, { status: 501 });
  const u = new URL("https://www.googleapis.com/youtube/v3/search");
  const p = { part: "snippet", type: "video", videoEmbeddable: "true", maxResults: "8", q: q + " karaoke", key };
  for (const k in p) u.searchParams.set(k, p[k]);
  const j = await (await fetch(u, { next: { revalidate: 86400 } })).json();
  if (j.error) return NextResponse.json({ error: j.error.message }, { status: 502 });
  return NextResponse.json({ items: j.items.map((i) => ({ vid: i.id.videoId, title: i.snippet.title, thumb: i.snippet.thumbnails.default.url })) });
}
