"use client";
import { useEffect, useRef, useState } from "react";
import { Room, RoomEvent, Track } from "livekit-client";

const api = (p, body) =>
  fetch(p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
const ytId = (s) => (s.match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([\w-]{11})/) || (/^[\w-]{11}$/.test(s) ? [0, s] : []))[1];
const cleanRoom = (s) => s.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 32) || "phong-1";
const MAX = 30;
const ROOMS = [
  { id: "hoang-gia", name: "Phòng Hoàng Gia", sub: "Tím vàng sang trọng", t: "royal" },
  { id: "vip-1", name: "Phòng VIP 1", sub: "Đỏ neon sôi động", t: "neon" },
  { id: "vip-2", name: "Phòng VIP 2", sub: "Xanh đại dương", t: "ocean" },
  { id: "vip-3", name: "Phòng VIP 3", sub: "Xanh rừng ấm áp", t: "forest" },
];
const hue = (s) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);

// Nhân vật pixel + bong bóng chat nổi trên đầu
function Person({ p, text, big }) {
  const h = hue(p.id);
  return (
    <div className={big ? "pp big" : "pp"}>
      {text && <div className="bub">{text}</div>}
      <i className="hair" style={{ background: `hsl(${(h + 120) % 360} 30% 22%)` }} />
      <i className="head" />
      <i className="body" style={{ background: `hsl(${h} 55% 58%)` }} />
    </div>
  );
}

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
  const [room, setRoom] = useState("");
  const [counts, setCounts] = useState({});
  useEffect(() => {
    setName(localStorage.getItem("kname") || "");
    const r = new URLSearchParams(location.search).get("r");
    if (r) setRoom(r);
    const load = () => fetch("/api/rooms").then((x) => x.json()).then((d) => setCounts(d.counts || {})).catch(() => {});
    load();
    const iv = setInterval(load, 10000);
    return () => clearInterval(iv);
  }, []);
  if (me) return <Karaoke {...me} />;
  const enter = (r) => { // cú bấm này mở khóa âm thanh của trình duyệt
    localStorage.setItem("kname", name);
    setMe({ name: name.trim() || "Khách", room: cleanRoom(r) });
  };
  return (
    <main className="join">
      <h1>Karaoke cùng nhau</h1>
      <input type="text" placeholder="Tên của bạn" value={name} onChange={(e) => setName(e.target.value)} />
      <div className="rooms">
        {ROOMS.map((r) => (
          <button key={r.id} className="card" data-t={r.t} onClick={() => enter(r.id)}>
            <b>{r.name}</b><small>{r.sub}</small><em>{counts[r.id] || 0}/{MAX} ghế</em>
          </button>
        ))}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); enter(room); }} style={{ display: "flex" }}>
        <input type="text" placeholder="Hoặc nhập mã phòng riêng" value={room} onChange={(e) => setRoom(e.target.value)} />
        <button type="submit">Vào</button>
      </form>
    </main>
  );
}

function Song({ s, saved, onSave, children }) {
  const on = saved.some((x) => x.vid === s.vid);
  return (
    <li>
      {s.thumb && <img src={s.thumb} alt="" />}
      <span style={{ flex: 1 }}>{s.title}{s.byName && <em> {s.byName}</em>}</span>
      <button className="star" aria-label="Lưu bài" onClick={() => onSave(s.vid, s.title)}>{on ? "★" : "☆"}</button>
      {children}
    </li>
  );
}

function Karaoke({ name, room }) {
  const [id] = useState(() => {
    let v = sessionStorage.getItem("kid");
    if (!v) sessionStorage.setItem("kid", (v = Math.random().toString(36).slice(2, 10)));
    return v;
  });
  const [st, setSt] = useState({ q: [], cur: null, lb: {}, rate: null, last: null, hist: [], seat: {}, ask: [] });
  const [people, setPeople] = useState([]);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [res, setRes] = useState([]);
  const [voted, setVoted] = useState({});
  const [now, setNow] = useState(Date.now());
  const [bub, setBub] = useState({});
  const [log, setLog] = useState([]);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  // Bài đã lưu nằm trên trình duyệt này (localStorage), không đồng bộ giữa các thiết bị
  const [saved, setSaved] = useState(() => { try { return JSON.parse(localStorage.getItem("ksaved")) || []; } catch { return []; } });
  const toggleSave = (vid, title) => setSaved((s) => {
    const n = s.some((x) => x.vid === vid) ? s.filter((x) => x.vid !== vid) : [{ vid, title }, ...s].slice(0, 50);
    try { localStorage.setItem("ksaved", JSON.stringify(n)); } catch {}
    return n;
  });
  const timers = useRef({});
  const say = (idn, who, text) => {
    setBub((b) => ({ ...b, [idn]: text }));
    setLog((l) => [...l.slice(-19), { who, text }]);
    clearTimeout(timers.current[idn]);
    timers.current[idn] = setTimeout(() => setBub((b) => { const x = { ...b }; delete x[idn]; return x; }), 6000);
  };
  const lk = useRef(null), yt = useRef(null), off = useRef(0), voiceVol = useRef(1), peopleRef = useRef([]), gone = useRef(0);
  const stRef = useRef(st);
  stRef.current = st;
  peopleRef.current = people;
  const cur = st.cur;
  const singing = cur?.by === id;
  const duo = cur?.duo || [];
  const inDuo = duo.some((d) => d.id === id);
  const mic = singing || inDuo; // người hát chính và người hát chung đều được mở mic

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
    const sync = () => setPeople([r.localParticipant, ...r.remoteParticipants.values()].map((p) => ({ id: p.identity, name: p.name || p.identity, at: p.joinedAt ? +p.joinedAt : 0 })));
    const meta = (m) => { try { setSt(JSON.parse(m)); } catch {} };
    r.on(RoomEvent.RoomMetadataChanged, meta)
      .on(RoomEvent.ParticipantConnected, sync)
      .on(RoomEvent.ParticipantDisconnected, sync)
      .on(RoomEvent.DataReceived, (buf, p, _k, topic) => {
        if (topic !== "chat" || !p) return;
        try { say(p.identity, p.name || p.identity, String(JSON.parse(new TextDecoder().decode(buf)).t).slice(0, 120)); } catch {}
      })
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
        if (mic) await lp.setMicrophoneEnabled(true);
        else {
          const t = lp.getTrackPublication(Track.Source.Microphone)?.track;
          if (t) await lp.unpublishTrack(t, true);
        }
      } catch (e) {
        if (mic && !stop && n++ < 4) setTimeout(go, 1000); // quyền publish có thể đến chậm
        else if (mic) setErr("Không bật được mic: " + e.message);
      }
    };
    go();
    return () => { stop = true; };
  }, [mic, cur?.t0, people.length]);

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
      // Người hát đã thoát hơn 5 giây thì bỏ qua bài (không chấm điểm)
      if (c && lk.current?.state === "connected" && peopleRef.current.length && !peopleRef.current.some((x) => x.id === c.by)) {
        gone.current ||= Date.now();
        if (Date.now() - gone.current > 5000) next(true);
      } else gone.current = 0;
      if (!p?.getPlayerState || !c) return;
      const want = (Date.now() + off.current - c.t0) / 1000;
      if (want < 0) return;
      const dur = p.getDuration?.();
      if (dur > 0 && want > dur + 3) return next(); // phòng khi sự kiện hết bài không tới
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
  const info = ROOMS.find((r) => r.id === room);
  const theme = info?.t || "classic";
  useEffect(() => {
    document.body.dataset.t = theme;
    return () => { delete document.body.dataset.t; };
  }, [theme]);
  const pubIds = cur ? [cur.by, ...duo.map((d) => d.id)] : [];
  const onStage = pubIds.map((x) => people.find((p) => p.id === x)).filter(Boolean);
  // Ghế: ai đã chọn ghế thì ngồi đúng ghế đó, ai chưa chọn thì được xếp vào ghế trống đầu tiên
  const sorted = [...people].sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
  const seats = Array(MAX).fill(null);
  const unseated = [];
  for (const p of sorted) {
    const n = st.seat?.[p.id];
    if (Number.isInteger(n) && n >= 0 && n < MAX && !seats[n]) seats[n] = p;
    else unseated.push(p);
  }
  for (const p of unseated) { const i = seats.indexOf(null); if (i >= 0) seats[i] = p; }

  // Tìm karaoke ngay khi gõ (chờ 450ms sau phím cuối)
  useEffect(() => {
    const k = q.trim();
    if (k.length < 2 || ytId(k)) return setRes([]);
    let dead = false;
    const t = setTimeout(async () => {
      setBusy(true);
      const d = await fetch("/api/search?q=" + encodeURIComponent(k)).then((r) => r.json()).catch(() => ({ error: "Lỗi mạng" }));
      if (dead) return;
      setBusy(false);
      d.error ? setErr(d.error) : (setErr(""), setRes(d.items));
    }, 450);
    return () => { dead = true; clearTimeout(t); };
  }, [q]);

  const add = async (vid, title) => {
    setErr("");
    const d = await api("/api/room", { room, action: "add", vid, title, identity: id, name });
    if (d.error) setErr(d.error);
    else { setRes([]); setQ(""); }
  };
  const sit = async (n) => {
    const d = await api("/api/room", { room, action: "seat", n, identity: id });
    setErr(d.error || "");
  };
  const duoAct = (action, who) => api("/api/room", { room, action, identity: id, name, who });
  const search = (e) => {
    e.preventDefault();
    const v = ytId(q.trim());
    if (v) add(v);
  };
  const sendChat = (e) => {
    e.preventDefault();
    const t = msg.trim().slice(0, 120);
    if (!t || !lk.current) return;
    setMsg("");
    say(id, name, t);
    lk.current.localParticipant
      .publishData(new TextEncoder().encode(JSON.stringify({ t })), { reliable: true, topic: "chat" })
      .catch((x) => setErr(String(x.message || x)));
  };

  return (
    <main className="app">
      <header><b>{info?.name || "Phòng " + room}</b><span>{people.length}/{MAX} ghế</span><button onClick={() => (location.href = "/")}>Rời phòng</button></header>
      <div className="vid"><div id="yt" /></div>
      <div className="now">
        {cur ? (
          <>
            <small>{singing ? "Đến lượt bạn hát! Mic đang mở" : inDuo ? "Bạn đang hát chung! Mic đang mở" : cur.byName + (duo.length ? " hát chung với " + duo.map((d) => d.name).join(", ") : "") + " đang hát"}</small>
            <h2>{cur.title}</h2>
            {singing && <button onClick={() => next(true)}>Bỏ qua bài</button>}
            {inDuo && <button onClick={() => duoAct("duo_leave")}>Thôi hát chung</button>}
            {!mic && (st.ask || []).some((x) => x.id === id) && <small> Đã xin hát chung, chờ {cur.byName} đồng ý</small>}
            {!mic && !(st.ask || []).some((x) => x.id === id) && duo.length < 3 && <button onClick={() => duoAct("duo_ask")}>Xin hát chung</button>}
          </>
        ) : (
          <h2>Chưa có bài nào. Chọn bài bên dưới để bắt đầu.</h2>
        )}
      </div>
      {singing && (st.ask || []).length > 0 && (
        <section className="sec">
          <h3>Xin hát chung</h3>
          <ul>
            {st.ask.map((x) => (
              <li key={x.id}><span style={{ flex: 1 }}>{x.name}</span>
                <button onClick={() => duoAct("duo_ok", x.id)}>Cho hát</button>
                <button onClick={() => duoAct("duo_no", x.id)}>Từ chối</button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="hall">
        <div className="stage">
          {onStage.length ? (
            <>
              <div className="duo">{onStage.map((p) => <Person key={p.id} p={p} text={bub[p.id]} big />)}</div>
              <small>{onStage.map((p) => p.name).join(" & ")} đang hát</small>
            </>
          ) : (
            <small>Sân khấu đang trống</small>
          )}
        </div>
        <div className="seats">
          {seats.map((p, i) => {
            const on = p && !pubIds.includes(p.id);
            return (
              <div className={"sc" + (p ? "" : " free") + (p?.id === id ? " me" : "")} key={i} title={p ? "" : "Ngồi vào ghế này"} onClick={() => !p && sit(i)}>
                {on ? <Person p={p} text={bub[p.id]} /> : <div className="pp" />}
                <div className="chair" />
                <small>{on ? p.name : ""}</small>
              </div>
            );
          })}
        </div>
      </section>
      <form className="chat" onSubmit={sendChat}>
        <input type="text" maxLength={120} placeholder="Nói gì với cả phòng…" value={msg} onChange={(e) => setMsg(e.target.value)} />
        <button type="submit">Gửi</button>
      </form>
      {log.length > 0 && <div className="log">{log.map((l, i) => <div key={i}><b>{l.who}:</b> {l.text}</div>)}</div>}
      {rate && (
        <section className="sec">
          {rate.by === id || (rate.duo || []).some((d) => d.id === id) ? (
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
        <h3>Chọn bài {busy && <small>đang tìm…</small>}</h3>
        <form onSubmit={search}>
          <input type="text" placeholder="Gõ tên bài để tìm karaoke, hoặc dán link YouTube" value={q} onChange={(e) => setQ(e.target.value)} />
          <button type="submit">Thêm link</button>
        </form>
        <ul style={{ marginTop: ".6rem" }}>
          {res.map((r) => (
            <Song key={r.vid} s={r} saved={saved} onSave={toggleSave}><button onClick={() => add(r.vid, r.title)}>Thêm</button></Song>
          ))}
        </ul>
      </section>
      <section className="sec">
        <h3>Hàng chờ ({st.q.length})</h3>
        <ul>
          {st.q.map((s, i) => (
            <Song key={i} s={s} saved={saved} onSave={toggleSave}>
              {s.by === id && <button onClick={() => api("/api/room", { room, action: "remove", i, identity: id })}>Xóa</button>}
            </Song>
          ))}
        </ul>
      </section>
      <section className="sec">
        <h3>Bài đã lưu ({saved.length})</h3>
        {saved.length ? (
          <ul>
            {saved.map((s) => (
              <Song key={s.vid} s={s} saved={saved} onSave={toggleSave}><button onClick={() => add(s.vid, s.title)}>Thêm</button></Song>
            ))}
          </ul>
        ) : (
          <p style={{ margin: 0, color: "var(--dim)" }}>Bấm ☆ cạnh bài hát để lưu, lần sau chọn luôn.</p>
        )}
      </section>
      <section className="sec">
        <h3>10 bài vừa hát trong phòng</h3>
        {(st.hist || []).length ? (
          <ul>
            {st.hist.map((s) => (
              <Song key={s.vid} s={s} saved={saved} onSave={toggleSave}><button onClick={() => add(s.vid, s.title)}>Chọn lại</button></Song>
            ))}
          </ul>
        ) : (
          <p style={{ margin: 0, color: "var(--dim)" }}>Chưa có bài nào được hát xong.</p>
        )}
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
      {err && <p className="err">{err}</p>}
    </main>
  );
}
