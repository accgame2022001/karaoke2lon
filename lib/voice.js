// Xử lý giọng hát kiểu dàn karaoke: cổng lọc ồn, EQ, nén, vang, echo, chorus, giới hạn đỉnh, và đường nghe lại
let ac, gateReady = false;
export function unlockAudio() {
  const C = window.AudioContext || window.webkitAudioContext;
  if (!ac) {
    ac = new C({ latencyHint: "balanced" });
    // iPhone hay tạm dừng AudioContext khi mở mic, nên tự bật lại để giọng không bị câm
    ac.onstatechange = () => { if (ac.state !== "running") ac.resume().catch(() => {}); };
  }
  return ac.resume().catch(() => {});
}

export const getCtx = () => { unlockAudio(); return ac; };

// Cổng giảm ồn mềm: giữ mở 0,2 giây sau tiếng hát, khi đóng chỉ hạ xuống còn 25% chứ không cắt hẳn
const GATE = `class G extends AudioWorkletProcessor{constructor(){super();this.g=1;this.e=0;this.h=0}process(i,o){const x=i[0]&&i[0][0],y=o[0][0];if(!x)return true;for(let n=0;n<x.length;n++){const a=Math.abs(x[n]);this.e+=(a>this.e?0.1:0.0005)*(a-this.e);if(this.e>0.004)this.h=9600;else if(this.h>0)this.h--;const t=this.h>0?1:0.3;this.g+=(t>this.g?0.02:0.0004)*(t-this.g);y[n]=x[n]*this.g}return true}}registerProcessor("gate",G)`;

// Vang kiểu hội trường: có độ trễ đầu 30ms, đuôi mịn và tối, không rít
const impulse = (ctx, sec = 1.8, decay = 2.4) => {
  const rate = ctx.sampleRate, len = Math.floor(rate * sec), pre = Math.floor(rate * 0.03);
  const buf = ctx.createBuffer(1, len, rate);
  for (let c = 0; c < 1; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = pre; i < len; i++) {
      lp += 0.45 * (Math.random() * 2 - 1 - lp);
      d[i] = lp * Math.pow(1 - (i - pre) / (len - pre), decay);
    }
  }
  return buf;
};

export async function startVoice(fx) {
  await unlockAudio();
  // Khử ồn của trình duyệt làm giọng hát nghe như nói chuyện nên luôn tắt. Tự cân mức mic bằng bộ riêng (êm hơn AGC của trình duyệt). Có tai nghe thì tắt khử vọng.
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: !fx.ear, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
  });
  await ac.resume().catch(() => {});
  const micTrack = stream.getAudioTracks()[0];
  const src = ac.createMediaStreamSource(stream);
  const inG = ac.createGain(); // độ nhạy mic, được tự cân bên dưới
  inG.gain.value = 2;
  const pre = ac.createAnalyser(); // đo giọng gốc trước khi khuếch đại
  pre.fftSize = 2048;
  src.connect(pre);
  src.connect(inG);
  const an = ac.createAnalyser(); // đo mức tiếng để hiện thanh báo
  an.fftSize = 512;
  inG.connect(an);
  let gate = inG;
  try {
    if (!gateReady) {
      await ac.audioWorklet.addModule(URL.createObjectURL(new Blob([GATE], { type: "text/javascript" })));
      gateReady = true;
    }
    gate = new AudioWorkletNode(ac, "gate", { outputChannelCount: [1] });
    inG.connect(gate);
  } catch { gate = inG; }

  const eq = (type, f, q, g) => {
    const n = ac.createBiquadFilter();
    n.type = type; n.frequency.value = f; n.Q.value = q; n.gain.value = g;
    return n;
  };
  const hp = eq("highpass", 100, 0.7, 0);
  const warm = eq("peaking", 220, 1, 1.5); // ấm, dày giọng
  const mud = eq("peaking", 400, 1.2, -2); // bớt đục
  const pres = eq("peaking", 3000, 0.8, 2); // rõ, sáng lời
  const air = eq("highshelf", 11000, 0.7, 2); // lấp lánh như phòng thu
  const fizz = eq("lowpass", 14000, 0.7, 0); // bỏ tiếng rít số ở dải cao
  const comp = ac.createDynamicsCompressor();
  comp.threshold.value = -24; comp.knee.value = 20; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.2;
  const lim = ac.createDynamicsCompressor(); // chặn đỉnh để không vỡ tiếng
  lim.threshold.value = -3; lim.knee.value = 3; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.1;
  const g = () => ac.createGain();
  const raw = g(), fxG = g(), makeup = g(), outG = g(), dry = g(), wet = g(), echoG = g(), fb = g(), chG = g(), mix = g(), out = g(), mon = g();
  makeup.gain.value = 1.3; outG.gain.value = 1.2; fb.gain.value = 0.3; chG.gain.value = 0;
  const conv = ac.createConvolver();
  conv.buffer = impulse(ac);
  const dl = ac.createDelay(1); dl.delayTime.value = 0.28; // echo
  const dlp = eq("lowpass", 3200, 0.7, 0); // echo mềm dần qua mỗi lần lặp
  const ch = ac.createDelay(0.1); ch.delayTime.value = 0.022; // chorus làm giọng dày
  const lfo = ac.createOscillator(); lfo.frequency.value = 0.7;
  const lfoG = g(); lfoG.gain.value = 0.004;
  lfo.connect(lfoG).connect(ch.delayTime);
  lfo.start();
  const dest = ac.createMediaStreamDestination();
  dest.channelCount = 1; // giọng đơn kênh, dành hết bitrate cho giọng
  dest.channelCountMode = "explicit";

  inG.connect(raw).connect(out); // giọng gốc (khi tắt hiệu ứng)
  const gateG = g(), noGateG = g();
  inG.connect(noGateG).connect(hp); // đường không qua cổng
  gate.connect(gateG).connect(hp); // đường qua cổng giảm ồn
  hp.connect(warm).connect(mud).connect(pres).connect(air).connect(fizz).connect(comp).connect(makeup).connect(fxG);
  fxG.connect(dry).connect(mix);
  fxG.connect(conv).connect(wet).connect(mix);
  fxG.connect(dl).connect(dlp).connect(echoG).connect(mix);
  dlp.connect(fb).connect(dl);
  fxG.connect(ch).connect(chG).connect(mix);
  mix.connect(outG).connect(lim).connect(out); // tăng âm lượng rồi chặn đỉnh để giọng to mà không vỡ
  out.connect(dest); // gửi lên phòng
  const oa = ac.createAnalyser(); // đo đầu ra để phát hiện bộ xử lý bị câm
  oa.fftSize = 1024;
  out.connect(oa);
  out.connect(mon).connect(ac.destination); // nghe lại giọng mình

  // Tự cân mức: kéo giọng về mức vừa phải, hạ nhanh khi sắp vỡ, tăng chậm khi hát nhỏ, không tăng khi im
  let cap = fx.gain || 6, cur = 2;
  const buf = new Float32Array(pre.fftSize);
  const ob = new Float32Array(oa.fftSize);
  let dead = 0; // số lần liên tiếp: có tiếng vào nhưng không có tiếng ra
  const iv = setInterval(() => {
    pre.getFloatTimeDomainData(buf);
    let sum = 0, pk = 0;
    for (const x of buf) { sum += x * x; pk = Math.max(pk, Math.abs(x)); }
    const rms = Math.sqrt(sum / buf.length);
    oa.getFloatTimeDomainData(ob);
    let os = 0;
    for (const x of ob) os += x * x;
    dead = rms > 0.01 && Math.sqrt(os / ob.length) < 0.0005 ? dead + 1 : 0;
    if (rms < 0.004) return;
    const want = Math.min(Math.min(cap, Math.max(1, 0.1 / rms)), 0.7 / Math.max(pk, 1e-4));
    cur += (want - cur) * (want < cur ? 0.5 : 0.08);
    inG.gain.setTargetAtTime(cur, ac.currentTime, 0.05);
  }, 100);

  const set = ({ filter, reverb, echo, monitor, gate: gt, gain }) => {
    const t = ac.currentTime, f = (p, v) => p.setTargetAtTime(v, t, 0.05);
    cap = gain || 6;
    f(raw.gain, filter ? 0 : 1);
    f(gateG.gain, gt ? 1 : 0);
    f(noGateG.gain, gt ? 0 : 1);
    f(fxG.gain, filter ? 1 : 0);
    f(wet.gain, reverb / 100);
    f(echoG.gain, (echo / 100) * 0.5);
    f(mon.gain, monitor ? 0.9 : 0);
  };
  set(fx);
  const all = [src, inG, pre, an, oa, fizz, gate, gateG, noGateG, raw, hp, warm, mud, pres, air, comp, makeup, outG, fxG, dry, wet, echoG, fb, chG, mix, lim, out, mon, dest, conv, dl, dlp, ch, lfo, lfoG];
  return {
    track: dest.stream.getAudioTracks()[0],
    ear: fx.ear,
    set,
    // Còn hoạt động tốt không: AudioContext chạy, mic chưa bị ngắt, đầu ra không bị câm
    alive() {
      return ac.state === "running" && micTrack.readyState === "live" && !micTrack.muted && dead < 25;
    },
    level() {
      const b = new Uint8Array(an.fftSize);
      an.getByteTimeDomainData(b);
      let m = 0;
      for (const x of b) m = Math.max(m, Math.abs(x - 128));
      return m / 128;
    },
    stop() {
      clearInterval(iv);
      stream.getTracks().forEach((t) => t.stop()); // nhả mic hoàn toàn
      dest.stream.getTracks().forEach((t) => t.stop());
      try { lfo.stop(); } catch {}
      all.forEach((n) => { try { n.disconnect(); } catch {} });
    },
  };
}
