"use client";
import { useEffect, useRef, useState } from "react";
import { Room, RoomEvent, Track } from "livekit-client";

const api = (p, body) =>
  fetch(p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
const ytId = (s) => (s.match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([\w-]{11})/) || (/^[\w-]{11}$/.test(s) ? [0, s] : []))[1];
const cleanRoom = (s) => s.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 32) || "phong-1";

let ytReady;
const loadYT = () =>
  (ytReady ||= new Promise((res) => {
    if (window.YT?.Player) return res();
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    document.head.append(s);
    window.onYouTubeIframeAPIReady = res;
  }));

export default function Page() {
  const [me, setMe] = useState(null);
  const [name, setName] = useState("");
  const [room, setRoom] = useState("phong-1");
  useEffect(() => {
    setName(localStorage.getItem("kname") || "");
    const r = new URLSearchParams(location.search).get("r");
    if (r) setRoom(r);
  }, []);
  if (me) return <Karaoke {...me} />;
  const join = (e) => {
    e.preventDefault(); // cú bấm này mở khóa âm thanh của trình duyệt
    localStorage.setItem("kname", name);
    setMe({ name: name.trim() || "Khách", room: cleanRoom(room) });
  };
  return (
    <main className="join">
      <h1>Karaoke cùng nhau</h1>
      <form onSubmit={join} style={{ display: "grid" }}>
        <input type="text" placeholder="Tên của bạn" value={name} onChange={(e) => setName(e.target.value)} />
        <input type="text" placeholder="Mã phòng" value={room} onChange={(e) => setRoom(e.target.value)} />
        <button type="submit">Vào phòng</button>
      </form>
    </main>
  );
}

function Karaoke({ name, room }) {
  const [id] = useState(() => {
    let v = sessionStorage.getItem("kid");
    if (!v) sessionStorage.setItem("kid", (v = Math.random().toString(36).slice(2, 10)));
    return v;
  });
  const [st, setSt] = useState({ q: [], cur: null, lb: {}, rate: null, last: null });
  const [people, setPeople] = useState([]);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [res, setRes] = useState([]);
  const [voted, setVoted] = useState({});
  const [now, setNow] = useState(Date.now());
  const lk = useRef(null), yt = useRef(null), off = useRef(0), voiceVol = useRef(1);
  const stRef = useRef(st);
  stRef.current = st;
  const cur = st.cur;
  const singing = cur?.by === id;

  const next = (skip) => api("/api/room", { room, action: "next", t0: stRef.current.cur?.t0, skip: skip === true });

  const play = () => {
    const p = yt.current, c = stRef.current.cur;
    if (!p?.loadVideoById) return;
    if (!c) return p.stopVideo();
    const pos = () => (Date.now() + off.current - c.t0) / 1000;
    const go = () => stRef.current.cur?.t0 === c.t0 && p.loadVideoById({ videoId: c.vid, startSeconds: Math.max(0, pos()) });
    pos() < 0 ? setTimeout(go, -pos() * 1000) : go();
  };

  // 1) Kết nối phòng. Người nghe KHÔNG bao giờ xin quyền mic.
  useEffect(() => {
    let dead = false;
    const r = new Room({ audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: false } });
    lk.current = r;
    const sync = () => setPeople([r.localParticipant, ...r.remoteParticipants.values()].map((p) => ({ id: p.identity, name: p.name || p.identity })));
    const meta = (m) => { try { setSt(JSON.parse(m)); } catch {} };
    r.on(RoomEvent.RoomMetadataChanged, meta)
      .on(RoomEvent.ParticipantConnected, sync)
      .on(RoomEvent.ParticipantDisconnected, sync)
      .on(RoomEvent.TrackSubscribed, (t) => {
        if (t.kind !== Track.Kind.Audio) return;
        const el = t.attach();
        el.volume = voiceVol.current;
        el.dataset.voice = "1";
        document.body.append(el);
      })
      .on(RoomEvent.TrackUnsubscribed, (t) => t.detach().forEach((e) => e.remove()));
    (async () => {
      const d = await api("/api/token", { room, identity: id, name });
      if (dead) return;
      if (!d.token) return setErr(d.error || "Không vào được phòng");
      off.current = d.now - Date.now();
      await r.connect(d.url, d.token);
      if (dead) return r.disconnect();
      await r.startAudio().catch(() => {});
      sync();
      meta(r.metadata);
    })().catch((e) => setErr(String(e.message || e)));
    return () => {
      dead = true;
      r.disconnect();
      document.querySelectorAll("audio[data-voice]").forEach((e) => e.remove());
    };
  }, []);

  // 2) Mic: chỉ bật khi tới lượt mình; hết lượt thì gỡ track để nhả mic hoàn toàn
  useEffect(() => {
    const r = lk.current;
    if (!r || r.state !== "connected") return;
    let n = 0, stop = false;
    const go = async () => {
      const lp = r.localParticipant;
      try {
        if (singing) await lp.setMicrophoneEnabled(true);
        else {
          const t = lp.getTrackPublication(Track.Source.Microphone)?.track;
          if (t) await lp.unpublishTrack(t, true);
        }
      } catch (e) {
        if (singing && !stop && n++ < 4) setTimeout(go, 1000); // quyền publish có thể đến chậm
        else if (singing) setErr("Không bật được mic: " + e.message);
      }
    };
    go();
    return () => { stop = true; };
  }, [singing, cur?.t0, people.length]);

  // 3) Phát YouTube đồng bộ theo mốc thời gian t0 của máy chủ
  useEffect(() => {
    loadYT().then(() => {
      if (yt.current) return;
      yt.current = new window.YT.Player("yt", {
        width: "100%", height: "100%",
        playerVars: { controls: 0, playsinline: 1, rel: 0, disablekb: 1, fs: 0 },
        events: {
          onReady: () => { yt.current.setVolume(80); play(); },
          onStateChange: (e) => e.data === 0 && next(),
          onError: () => next(true),
        },
      });
    });
    const tick = setInterval(() => {
      const p = yt.current, c = stRef.current.cur;
      if (!p?.getPlayerState || !c) return;
      const want = (Date.now() + off.current - c.t0) / 1000;
      if (want < 0) return;
      const s = p.getPlayerState();
      if (s === 2) p.playVideo();
      else if (s === 1 && Math.abs(p.getCurrentTime() - want) > 1.5) p.seekTo(want, true);
    }, 3000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    play();
    if (cur && "mediaSession" in navigator) navigator.mediaSession.metadata = new MediaMetadata({ title: cur.title, artist: cur.byName });
  }, [cur?.t0, cur?.vid]);

  // Chấm điểm: đếm ngược theo giờ máy chủ, hết giờ thì mỗi máy (lệch ngẫu nhiên) báo "finalize", chỉ lần đầu có tác dụng
  const rate = st.rate;
  useEffect(() => {
    if (!rate) return;
    setNow(Date.now());
    const iv = setInterval(() => setNow(Date.now()), 250);
    const wait = Math.max(300, rate.until - (Date.now() + off.current) + 300 + Math.random() * 1500);
    const fin = () => api("/api/room", { room, action: "finalize", t0: rate.t0 });
    const t1 = setTimeout(fin, wait), t2 = setTimeout(fin, wait + 4000);
    return () => { clearInterval(iv); clearTimeout(t1); clearTimeout(t2); };
  }, [rate?.t0]);
  const left = rate ? Math.max(0, Math.ceil((rate.until - (now + off.current)) / 1000)) : 0;
  const vote = async (n) => {
    setVoted((v) => ({ ...v, [rate.t0]: n }));
    const d = await api("/api/room", { room, action: "vote", t0: rate.t0, score: n, identity: id });
    if (d.error) setErr(d.error);
  };
  const board = Object.values(st.lb || {}).sort((a, b) => b.pts - a.pts).slice(0, 10);

  const add = async (vid, title) => {
    setErr("");
    const d = await api("/api/room", { room, action: "add", vid, title, identity: id, name });
    if (d.error) setErr(d.error);
    else { setRes([]); setQ(""); }
  };
  const search = async (e) => {
    e.preventDefault();
    const v = ytId(q.trim());
    if (v) return add(v);
    const d = await fetch("/api/search?q=" + encodeURIComponent(q)).then((r) => r.json());
    d.error ? setErr(d.error) : (setErr(""), setRes(d.items));
  };

  return (
    <main className="app">
      <header><b>Phòng {room}</b><span>{people.length} người đang online</span></header>
      <div className="vid"><div id="yt" /></div>
      <div className="now">
        {cur ? (
          <>
            <small>{singing ? "Đến lượt bạn hát! Mic đang mở" : cur.byName + " đang hát"}</small>
            <h2>{cur.title}</h2>
            {singing && <button onClick={() => next(true)}>Bỏ qua bài</button>}
          </>
        ) : (
          <h2>Chưa có bài nào. Chọn bài bên dưới để bắt đầu.</h2>
        )}
      </div>
      {rate && (
        <section className="sec">
          {rate.by === id ? (
            <h3>Mọi người đang chấm điểm bạn · còn {left}s</h3>
          ) : (
            <>
              <h3>Chấm điểm {rate.byName} cho bài {rate.title} · {left > 0 ? `còn ${left}s` : "đang tính điểm"}</h3>
              {voted[rate.t0] ? (
                <p style={{ margin: 0 }}>Bạn đã chấm {voted[rate.t0]} điểm.</p>
              ) : (
                <div className="rate">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                    <button key={n} disabled={left === 0} onClick={() => vote(n)}>{n}</button>
                  ))}
                </div>
              )}
            </>
          )}
        </section>
      )}
      {!rate && st.last && (
        <p className="now"><small>{st.last.name} vừa được {st.last.avg} điểm ({st.last.n} phiếu) cho bài {st.last.title}</small></p>
      )}
      <div className="ctl">
        <button onClick={() => { yt.current?.playVideo(); lk.current?.startAudio(); }}>Bật nhạc</button>
        <label>Nhạc <input type="range" min="0" max="100" defaultValue="80" onChange={(e) => yt.current?.setVolume(+e.target.value)} /></label>
        <label>Giọng hát <input type="range" min="0" max="100" defaultValue="100" onChange={(e) => {
          voiceVol.current = e.target.value / 100;
          document.querySelectorAll("audio[data-voice]").forEach((a) => (a.volume = voiceVol.current));
        }} /></label>
      </div>
      <section className="sec">
        <h3>Chọn bài</h3>
        <form onSubmit={search}>
          <input type="text" placeholder="Tên bài hát hoặc link YouTube" value={q} onChange={(e) => setQ(e.target.value)} />
          <button type="submit">Tìm</button>
        </form>
        <ul style={{ marginTop: ".6rem" }}>
          {res.map((r) => (
            <li key={r.vid}><img src={r.thumb} alt="" /><span style={{ flex: 1 }}>{r.title}</span><button onClick={() => add(r.vid, r.title)}>Thêm</button></li>
          ))}
        </ul>
      </section>
      <section className="sec">
        <h3>Hàng chờ ({st.q.length})</h3>
        <ul>
          {st.q.map((s, i) => (
            <li key={i}><span style={{ flex: 1 }}>{s.title} <em>{s.byName}</em></span>
              {s.by === id && <button onClick={() => api("/api/room", { room, action: "remove", i, identity: id })}>Xóa</button>}
            </li>
          ))}
        </ul>
      </section>
      <section className="sec">
        <h3>Bảng xếp hạng</h3>
        {board.length ? (
          <ul>
            {board.map((e, i) => (
              <li key={e.name}><b>{i + 1}</b><span style={{ flex: 1 }}>{e.name}</span><span>{e.pts} điểm</span><em>{e.n} bài · TB {(e.pts / e.n).toFixed(1)}</em></li>
            ))}
          </ul>
        ) : (
          <p style={{ margin: 0, color: "var(--dim)" }}>Chưa có ai được chấm điểm.</p>
        )}
      </section>
      <section className="sec">
        <h3>Trong phòng</h3>
        <div className="seats">
          {people.map((p) => (<span key={p.id} className={p.id === cur?.by ? "seat on" : "seat"}>{p.name}</span>))}
        </div>
      </section>
      {err && <p className="err">{err}</p>}
    </main>
  );
}
