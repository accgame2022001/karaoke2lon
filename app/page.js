"use client";
import { Component, useEffect, useRef, useState } from "react";
import { Room, RoomEvent, Track, LocalAudioTrack } from "livekit-client";
import { startVoice, unlockAudio, getCtx, listMics } from "../lib/voice";

const api = (p, body) =>
  fetch(p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    .then((r) => r.json())
    .catch(() => ({ error: "Lỗi mạng, hãy thử lại" }));
const ytId = (s) => (s.match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([\w-]{11})/) || (/^[\w-]{11}$/.test(s) ? [0, s] : []))[1];
const cleanRoom = (s) => s.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 32) || "phong-1";
const MAX = 30;
// Trạng thái phòng luôn được chuẩn hóa: dù máy chủ gửi thiếu trường hay sai dạng thì giao diện vẫn không sập
const EMPTY = { q: [], cur: null, lb: {}, rate: null, last: null, hist: [], seat: {}, ask: [] };
const isObj = (x) => x && typeof x === "object" && !Array.isArray(x);
const norm = (x) =>
  isObj(x)
    ? { ...EMPTY, ...x, q: Array.isArray(x.q) ? x.q : [], hist: Array.isArray(x.hist) ? x.hist : [], ask: Array.isArray(x.ask) ? x.ask : [], lb: isObj(x.lb) ? x.lb : {}, seat: isObj(x.seat) ? x.seat : {}, cur: isObj(x.cur) ? x.cur : null }
    : null;

// Nếu có lỗi bất ngờ thì hiện thông báo kèm chi tiết thay vì trang trắng
class Boundary extends Component {
  constructor(p) { super(p); this.state = { e: null }; }
  static getDerivedStateFromError(e) { return { e }; }
  componentDidCatch(e, info) { console.error("Karaoke lỗi:", e, info?.componentStack); }
  render() {
    const e = this.state.e;
    if (!e) return this.props.children;
    return (
      <main className="join">
        <h1>Có lỗi xảy ra</h1>
        <p className="err">{String(e.message || e)}</p>
        <pre style={{ whiteSpace: "pre-wrap", fontSize: ".75rem", color: "var(--dim)" }}>{String(e.stack || "").split("\n").slice(0, 5).join("\n")}</pre>
        <button onClick={() => (location.href = "/")}>Tải lại</button>
      </main>
    );
  }
}
const FX0 = { filter: true, reverb: 28, echo: 14, monitor: true, ear: false, gate: false, gain: 30, plain: false, dev: "" };
const PRESETS = [
  { n: "Rõ lời", reverb: 10, echo: 0 },
  { n: "Ca sĩ", reverb: 28, echo: 14 },
  { n: "Tiệm karaoke", reverb: 45, echo: 25 },
  { n: "Hội trường", reverb: 65, echo: 8 },
];
const ROOMS = [
  { id: "hoang-gia", name: "Phòng Hoàng Gia", sub: "Tím vàng sang trọng", t: "royal" },
  { id: "vip-1", name: "Phòng VIP 1", sub: "Đỏ neon sôi động", t: "neon" },
  { id: "vip-2", name: "Phòng VIP 2", sub: "Xanh đại dương", t: "ocean" },
  { id: "vip-3", name: "Phòng VIP 3", sub: "Xanh rừng ấm áp", t: "forest" },
  { id: "phong-dao", name: "Phòng Đào", sub: "Hồng đào ngọt ngào, chỉ có hình ảnh", t: "peach" },
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
  if (me) return <Boundary><Karaoke {...me} /></Boundary>;
  const enter = (r) => { // cú bấm này mở khóa âm thanh của trình duyệt
    unlockAudio();
    localStorage.setItem("kname", name);
    setMe({ name: name.trim() || "Khách", room: cleanRoom(r) });
  };
  return (
    <main className="join">
      <h1>5 Sao Plus</h1>
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

// Phòng Đào chỉ trình chiếu hình ảnh, danh sách ảnh nằm trong public/dao/index.json
function Gallery({ who }) {
  const [imgs, setImgs] = useState([]);
  const [i, setI] = useState(0);
  useEffect(() => {
    fetch("/dao/index.json").then((r) => r.json()).then((d) => setImgs(Array.isArray(d.images) ? d.images : [])).catch(() => {});
  }, []);
  useEffect(() => {
    if (imgs.length < 2) return;
    const t = setInterval(() => setI((x) => (x + 1) % imgs.length), 6000);
    return () => clearInterval(t);
  }, [imgs.length]);
  return (
    <section className="gallery">
      {imgs.map((src, k) => <img key={src} src={"/dao/" + src} alt="" className={k === i ? "on" : ""} />)}
    
    </section>
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
  const [st, setSt] = useState(EMPTY);
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
  const [micState, setMicState] = useState("off"); // off | starting | live | plain | retry
  const [canPlay, setCanPlay] = useState(true);
  const [speaking, setSpeaking] = useState(new Set());
  const [tk, setTk] = useState(0);
  const [mics, setMics] = useState([]);
  // Bài đã lưu nằm trên trình duyệt này (localStorage), không đồng bộ giữa các thiết bị
  const [saved, setSaved] = useState(() => { try { return JSON.parse(localStorage.getItem("ksaved")) || []; } catch { return []; } });
  // Lọc tiếng và nghe lại giọng mình: mặc định bật, nhớ lựa chọn trên máy này
  const [fx, setFx] = useState(() => {
    try { return { ...FX0, ...JSON.parse(localStorage.getItem("kfx5")) }; } catch { return FX0; }
  });
  const fxRef = useRef(fx);
  fxRef.current = fx;
  useEffect(() => {
    voice.current?.set(fx);
    try { localStorage.setItem("kfx5", JSON.stringify(fx)); } catch {}
  }, [fx]);
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
  const lk = useRef(null), yt = useRef(null), off = useRef(0), voiceVol = useRef(1), peopleRef = useRef([]), gone = useRef(0), voice = useRef(null), starting = useRef(false), remote = useRef(new Map()), allowRef = useRef([]), usingPlain = useRef(false), fails = useRef(0);
  // Âm lượng giọng người hát: đến 100% dùng loa thường, trên 100% khuếch đại bằng Web Audio
  const applyVol = (e) => {
    const v = voiceVol.current;
    if (!allowRef.current.includes(e.who)) { // chỉ nghe tiếng của người đang hát
      e.el.muted = true;
      if (e.g) e.g.gain.value = 0;
      return;
    }
    if (v <= 1) {
      e.el.muted = false;
      e.el.volume = v;
      if (e.g) e.g.gain.value = 0;
    } else {
      if (!e.g) {
        const c = getCtx();
        e.s = c.createMediaStreamSource(new MediaStream([e.t.mediaStreamTrack]));
        e.g = c.createGain();
        e.s.connect(e.g).connect(c.destination);
      }
      e.el.muted = true; // vẫn giữ phần tử để trình duyệt tiếp tục nhận luồng
      e.g.gain.value = v;
    }
  };
  const setVoiceVol = (v) => {
    voiceVol.current = v;
    for (const e of remote.current.values()) applyVol(e);
  };
  const stRef = useRef(st);
  stRef.current = st;
  peopleRef.current = people;
  const cur = st?.cur;
  const singing = cur?.by === id;
  const duo = cur?.duo || [];
  const inDuo = duo.some((d) => d.id === id);
  const mic = singing || inDuo; // người hát chính và người hát chung đều được mở mic

  const next = (skip) => api("/api/room", { room, action: "next", t0: stRef.current?.cur?.t0, skip: skip === true });

  const play = () => {
    const p = yt.current, c = stRef.current?.cur;
    if (!p?.loadVideoById) return;
    if (!c) return p.stopVideo();
    const pos = () => (Date.now() + off.current - c.t0) / 1000;
    const go = () => stRef.current?.cur?.t0 === c.t0 && p.loadVideoById({ videoId: c.vid, startSeconds: Math.max(0, pos()) });
    pos() < 0 ? setTimeout(go, -pos() * 1000) : go();
  };

  // 1) Kết nối phòng, tự kết nối lại khi rớt mạng. Người nghe KHÔNG bao giờ xin quyền mic.
  useEffect(() => {
    let dead = false;
    const r = new Room();
    lk.current = r;
    const sync = () => setPeople([r.localParticipant, ...r.remoteParticipants.values()].map((p) => ({ id: p.identity, name: p.name || p.identity, at: p.joinedAt ? +p.joinedAt : 0 })));
    const meta = (m) => { try { const x = norm(JSON.parse(m)); if (x) setSt(x); } catch {} };
    const unlock = () => { unlockAudio(); r.startAudio().catch(() => {}); }; // chạm bất kỳ đâu cũng mở khóa âm thanh
    const onVis = () => {
      if (document.hidden) return;
      unlock();
      if (r.state === "connected") { sync(); meta(r.metadata); }
    };
    r.on(RoomEvent.RoomMetadataChanged, meta)
      .on(RoomEvent.ParticipantConnected, sync)
      .on(RoomEvent.ParticipantDisconnected, sync)
      .on(RoomEvent.Reconnected, () => { sync(); meta(r.metadata); })
      .on(RoomEvent.Disconnected, () => {
        if (dead) return;
        setErr("Mất kết nối, đang kết nối lại…");
        setTimeout(() => !dead && join(), 1500);
      })
      .on(RoomEvent.AudioPlaybackStatusChanged, () => setCanPlay(r.canPlaybackAudio))
      .on(RoomEvent.ActiveSpeakersChanged, (sp) => setSpeaking(new Set(sp.map((x) => x.identity))))
      .on(RoomEvent.DataReceived, (buf, p, _k, topic) => {
        if (topic !== "chat" || !p) return;
        try { say(p.identity, p.name || p.identity, String(JSON.parse(new TextDecoder().decode(buf)).t).slice(0, 120)); } catch {}
      })
      .on(RoomEvent.TrackSubscribed, (t, _pub, p) => {
        if (t.kind !== Track.Kind.Audio) return;
        const el = t.attach();
        el.dataset.voice = "1";
        document.body.append(el);
        const e = { t, el, who: p.identity };
        remote.current.set(t.sid, e);
        applyVol(e);
        setTk((x) => x + 1);
      })
      .on(RoomEvent.TrackUnsubscribed, (t) => {
        t.detach().forEach((e) => e.remove());
        const e = remote.current.get(t.sid);
        try { e?.s?.disconnect(); e?.g?.disconnect(); } catch {}
        remote.current.delete(t.sid);
        setTk((x) => x + 1);
      });
    const join = async () => {
      for (let n = 0; !dead; n++) {
        try {
          const d = await api("/api/token", { room, identity: id, name });
          if (dead) return;
          if (!d.token) return setErr(d.error || "Không vào được phòng");
          off.current = d.now - Date.now();
          await r.connect(d.url, d.token);
          if (dead) return r.disconnect();
          await r.startAudio().catch(() => {});
          sync();
          meta(r.metadata);
          setCanPlay(r.canPlaybackAudio);
          setErr("");
          return;
        } catch {
          setErr("Không kết nối được, đang thử lại…");
          await new Promise((res) => setTimeout(res, Math.min(8000, 1500 * (n + 1))));
        }
      }
    };
    join();
    document.addEventListener("pointerdown", unlock, { passive: true });
    document.addEventListener("visibilitychange", onVis);
    return () => {
      dead = true;
      document.removeEventListener("pointerdown", unlock);
      document.removeEventListener("visibilitychange", onVis);
      r.disconnect();
      voice.current?.stop();
      voice.current = null;
      document.querySelectorAll("audio[data-voice]").forEach((e) => e.remove());
    };
  }, []);

  // 2) Mic có giám sát: tự dựng lại khi mic bị ngắt, AudioContext bị tạm dừng, rớt kết nối hoặc đầu ra bị câm.
  //    Nếu bộ hiệu ứng lỗi liên tiếp thì tự chuyển sang mic thường của LiveKit (ổn định nhất).
  const micRef = useRef(false);
  micRef.current = mic;
  const stopMic = async () => {
    const v = voice.current;
    voice.current = null;
    const lp = lk.current?.localParticipant;
    const t = lp?.getTrackPublication(Track.Source.Microphone)?.track;
    if (t) await lp.unpublishTrack(t, !v).catch(() => {}); // mic thường: dừng luôn; mic hiệu ứng: dừng ở bước dưới
    v?.stop(); // nhả mic hoàn toàn
  };
  const startMic = async () => {
    const lp = lk.current.localParticipant;
    starting.current = true;
    setMicState("starting");
    try {
      const plain = fxRef.current.plain;
      usingPlain.current = plain;
      if (plain) {
        await lp.setMicrophoneEnabled(true, { echoCancellation: !fxRef.current.ear, noiseSuppression: false, autoGainControl: true, deviceId: fxRef.current.dev || undefined }, { dtx: false });
      } else {
        const v = await startVoice(fxRef.current);
        if (!micRef.current) { v.stop(); setMicState("off"); return; }
        voice.current = v;
        await lp.publishTrack(new LocalAudioTrack(v.track, undefined, true), {
          source: Track.Source.Microphone, name: "mic", dtx: false, audioPreset: { maxBitrate: 96000 },
        });
      }
      fails.current = 0;
      setMicState(plain ? "plain" : "live");
      setErr("");
    } catch (e) {
      await stopMic();
      setMicState("retry");
      if (++fails.current >= 2 && !fxRef.current.plain) {
        setFx((f) => ({ ...f, plain: true }));
        setErr("Mic hiệu ứng chưa ổn định trên máy này, đã chuyển sang mic thường.");
      } else setErr("Không bật được mic: " + (e.message || e));
    } finally {
      starting.current = false;
    }
  };
  const healthy = () => {
    const pub = lk.current?.localParticipant.getTrackPublication(Track.Source.Microphone);
    const mt = pub?.track?.mediaStreamTrack;
    if (!pub?.track || pub.isMuted || !mt || mt.readyState !== "live") return false;
    if (usingPlain.current !== fxRef.current.plain) return false; // đổi chế độ mic thường / hiệu ứng
    const v = voice.current;
    if (v && (!v.alive() || v.ear !== fxRef.current.ear || v.dev !== (fxRef.current.dev || ""))) return false;
    return true;
  };
  useEffect(() => {
    if (!mic) { stopMic(); setMicState("off"); fails.current = 0; return; }
    let live = true, bad = 0, cool = 0;
    const tick = async () => {
      if (!live || starting.current || lk.current?.state !== "connected") return;
      if (healthy()) { bad = 0; return; }
      if (++bad < (voice.current ? 2 : 1)) return; // cho 2 lần kiểm tra trước khi dựng lại
      if (fails.current >= 3 && cool++ % 4) return; // lỗi nhiều lần thì thử thưa dần
      bad = 0;
      await stopMic();
      if (live && micRef.current) await startMic();
    };
    tick();
    const iv = setInterval(tick, 1500);
    return () => { live = false; clearInterval(iv); };
  }, [mic]);

  // Danh sách mic để chọn (tên mic chỉ hiện sau khi đã cấp quyền). Cắm hoặc rút tai nghe thì cập nhật lại.
  useEffect(() => {
    const load = () => listMics().then((d) => setMics(d.map((x) => ({ id: x.deviceId, label: x.label })))).catch(() => {});
    if (mic) load();
    navigator.mediaDevices?.addEventListener?.("devicechange", load);
    return () => navigator.mediaDevices?.removeEventListener?.("devicechange", load);
  }, [mic, micState]);

  // Thanh đo mức tiếng của mic để người hát biết mic có nhận được giọng hay không
  const meterRef = useRef(null);
  const [quiet, setQuiet] = useState(false);
  useEffect(() => {
    if (!mic) { setQuiet(false); return; }
    let low = 0;
    const iv = setInterval(() => {
      const l = voice.current?.level() ?? 0;
      if (meterRef.current) meterRef.current.style.width = Math.min(100, l * 160) + "%";
      if (!voice.current) return;
      low = l < 0.02 ? low + 1 : 0;
      setQuiet(low > 65); // khoảng 8 giây liên tục không có tiếng
    }, 120);
    return () => clearInterval(iv);
  }, [mic]);

  // 3) Phát YouTube đồng bộ theo mốc thời gian t0 của máy chủ
  useEffect(() => {
    loadYT().then(() => {
      if (yt.current) return;
      yt.current = new window.YT.Player("yt", {
        width: "100%", height: "100%",
        playerVars: { controls: 0, playsinline: 1, rel: 0, disablekb: 1, fs: 0 },
        events: {
          onReady: () => { yt.current.setVolume(50); play(); },
          onStateChange: (e) => e.data === 0 && next(),
          onError: () => next(true),
        },
      });
    });
    const tick = setInterval(() => {
      const p = yt.current, c = stRef.current?.cur;
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
  allowRef.current = pubIds;
  useEffect(() => { for (const e of remote.current.values()) applyVol(e); }, [pubIds.join(",")]);
  const hearing = tk >= 0 && [...remote.current.values()].some((e) => pubIds.includes(e.who));
  const stText = { off: "", starting: "Đang khởi động mic…", live: "Đang phát giọng lên phòng.", plain: "Đang phát giọng bằng mic thường (không hiệu ứng).", retry: "Mic chưa lên, đang thử lại…" }[micState];
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
      {!canPlay && <button onClick={() => { unlockAudio(); lk.current?.startAudio(); }}>Chạm để bật âm thanh</button>}
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
          <h2>Phòng Đào thay đồ, dâm tặc chớ vào</h2>
        )}
      </div>
      {mic && (
        <section className="sec">
          <h3>Giọng hát của bạn</h3>
          {stText && <small>{stText}</small>}
          <div className="meter"><i ref={meterRef} /></div>
          {quiet && <small className="err">Mic đang rất nhỏ hoặc chưa có tiếng. Nếu bạn đang hát mà thanh trên không nhảy, hãy tăng Độ nhạy mic và kiểm tra quyền mic của trình duyệt.</small>}
          <label className="row"><input type="checkbox" checked={fx.plain} onChange={(e) => setFx({ ...fx, plain: e.target.checked })} /> Mic thường (ổn định nhất, không hiệu ứng, không nghe lại)</label>
          <label className="row">Mic <select value={fx.dev} onChange={(e) => setFx({ ...fx, dev: e.target.value })}><option value="">Mặc định</option>{mics.map((m, i) => <option key={m.id || i} value={m.id}>{m.label || "Mic " + (i + 1)}</option>)}</select></label>
          <label className="row">Độ nhạy tối đa <input type="range" min="1" max="40" step="1" value={fx.gain} onChange={(e) => setFx({ ...fx, gain: +e.target.value })} /> x{fx.gain}</label>
          <div className="presets">
            {PRESETS.map((p) => (
              <button key={p.n} className={fx.filter && fx.reverb === p.reverb && fx.echo === p.echo ? "" : "alt"} onClick={() => setFx({ ...fx, filter: true, reverb: p.reverb, echo: p.echo })}>{p.n}</button>
            ))}
          </div>
          <label className="row"><input type="checkbox" checked={fx.filter} onChange={(e) => setFx({ ...fx, filter: e.target.checked })} /> Hiệu ứng karaoke (EQ, vang, echo)</label>
          <label className="row">Vang <input type="range" min="0" max="100" value={fx.reverb} disabled={!fx.filter} onChange={(e) => setFx({ ...fx, reverb: +e.target.value })} /> {fx.reverb}%</label>
          <label className="row">Echo <input type="range" min="0" max="100" value={fx.echo} disabled={!fx.filter} onChange={(e) => setFx({ ...fx, echo: +e.target.value })} /> {fx.echo}%</label>
          <label className="row"><input type="checkbox" checked={fx.gate} onChange={(e) => setFx({ ...fx, gate: e.target.checked })} /> Giảm ồn nền (có thể làm nhỏ tiếng khi hát khẽ)</label>
          <label className="row"><input type="checkbox" checked={fx.ear} onChange={(e) => setFx({ ...fx, ear: e.target.checked })} /> Tắt khử vọng (chỉ khi đeo tai nghe, giọng tự nhiên hơn)</label>
          <label className="row"><input type="checkbox" checked={fx.monitor} onChange={(e) => setFx({ ...fx, monitor: e.target.checked })} /> Nghe lại giọng mình</label>
          <small>Mic của tai nghe thường nhỏ và hay chập chờn, hãy thử chọn mic của máy ở ô Mic. Hát bằng loa ngoài thì tắt "nghe lại" để khỏi bị hú. Hát nhanh thì chọn kiểu "Rõ lời".</small>
        </section>
      )}
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
      {theme === "peach" ? <Gallery who={onStage.map((p) => p.name).join(" & ")} /> : (
      <section className="hall">
        <div className="stage">
          {onStage.length ? (
            <>
              <div className="duo">{onStage.map((p) => <Person key={p.id} p={p} text={bub[p.id]} big />)}</div>
              <small>{onStage.map((p) => (speaking.has(p.id) ? "● " : "") + p.name).join(" & ")} đang hát</small>
              {!mic && !hearing && <small>Đang chờ giọng hát…</small>}
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
      )}
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
        <label>Nhạc <input type="range" min="0" max="100" defaultValue="50" onChange={(e) => yt.current?.setVolume(+e.target.value)} /></label>
        <label>Giọng hát <input type="range" min="0" max="300" defaultValue="100" onChange={(e) => setVoiceVol(e.target.value / 100)} /></label>
        <small style={{ flexBasis: "100%" }}>Nghe giọng hát nhỏ? Hạ thanh Nhạc xuống, kéo thanh Giọng hát lên trên giữa (100%).</small>
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
