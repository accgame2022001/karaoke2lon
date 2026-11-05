// Xử lý giọng hát bằng Web Audio: lọc ồn, EQ, nén, vang, và đường nghe lại cho người hát
let ac;
export function unlockAudio() {
  const C = window.AudioContext || window.webkitAudioContext;
  ac ||= new C({ latencyHint: "interactive" });
  return ac.resume().catch(() => {});
}

const impulse = (ctx, sec = 1.8, decay = 3) => {
  const len = Math.floor(ctx.sampleRate * sec);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
};

export async function startVoice(fx) {
  await unlockAudio();
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false, channelCount: 1 },
  });
  const src = ac.createMediaStreamSource(stream);
  const eq = (type, f, q, g) => {
    const n = ac.createBiquadFilter();
    n.type = type; n.frequency.value = f; n.Q.value = q; n.gain.value = g;
    return n;
  };
  const hp = eq("highpass", 90, 0.7, 0); // cắt tiếng ù, tiếng gió
  const body = eq("peaking", 200, 1, 2); // giọng đầy hơn
  const pres = eq("peaking", 3200, 1, 3); // rõ lời hơn
  const air = eq("highshelf", 8000, 0.7, 2); // giọng sáng hơn
  const comp = ac.createDynamicsCompressor(); // giữ giọng đều, không vỡ khi hát to
  comp.threshold.value = -24; comp.knee.value = 20; comp.ratio.value = 3; comp.attack.value = 0.005; comp.release.value = 0.2;
  const g = () => ac.createGain();
  const raw = g(), fxG = g(), dry = g(), wet = g(), out = g(), mon = g();
  const conv = ac.createConvolver();
  conv.buffer = impulse(ac);
  const dest = ac.createMediaStreamDestination();

  src.connect(raw).connect(out); // đường giọng gốc (khi tắt lọc)
  src.connect(hp).connect(body).connect(pres).connect(air).connect(comp).connect(fxG);
  fxG.connect(dry).connect(out);
  fxG.connect(conv).connect(wet).connect(out); // vang
  out.connect(dest); // gửi lên phòng
  out.connect(mon).connect(ac.destination); // nghe lại giọng mình

  const set = ({ filter, reverb, monitor }) => {
    const t = ac.currentTime;
    raw.gain.setTargetAtTime(filter ? 0 : 1, t, 0.05);
    fxG.gain.setTargetAtTime(filter ? 1 : 0, t, 0.05);
    wet.gain.setTargetAtTime(filter ? reverb / 100 : 0, t, 0.05);
    mon.gain.setTargetAtTime(monitor ? 0.9 : 0, t, 0.05);
  };
  set(fx);
  const all = [src, raw, hp, body, pres, air, comp, fxG, dry, wet, conv, out, mon, dest];
  return {
    track: dest.stream.getAudioTracks()[0],
    set,
    stop() {
      stream.getTracks().forEach((t) => t.stop()); // nhả mic hoàn toàn
      dest.stream.getTracks().forEach((t) => t.stop());
      all.forEach((n) => { try { n.disconnect(); } catch {} });
    },
  };
}
