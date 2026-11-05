// Xử lý giọng hát kiểu dàn karaoke: cổng lọc ồn, EQ, nén, vang, echo, chorus, giới hạn đỉnh, và đường nghe lại
let ac, gateReady = false;
export function unlockAudio() {
  const C = window.AudioContext || window.webkitAudioContext;
  ac ||= new C({ latencyHint: "balanced" });
  return ac.resume().catch(() => {});
}

// Cổng giảm ồn mềm: giữ mở 0,2 giây sau tiếng hát, khi đóng chỉ hạ xuống còn 25% chứ không cắt hẳn
const GATE = `class G extends AudioWorkletProcessor{constructor(){super();this.g=1;this.e=0;this.h=0}process(i,o){const x=i[0]&&i[0][0],y=o[0][0];if(!x)return true;for(let n=0;n<x.length;n++){const a=Math.abs(x[n]);this.e+=(a>this.e?0.1:0.0005)*(a-this.e);if(this.e>0.004)this.h=9600;else if(this.h>0)this.h--;const t=this.h>0?1:0.25;this.g+=(t>this.g?0.02:0.0004)*(t-this.g);y[n]=x[n]*this.g}return true}}registerProcessor("gate",G)`;

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
  // Khử ồn của trình duyệt làm giọng hát nghe như nói chuyện, nên luôn tắt. Có tai nghe thì tắt luôn khử vọng.
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: !fx.ear, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
  });
  const src = ac.createMediaStreamSource(stream);
  let gate = src;
  try {
    if (!gateReady) {
      await ac.audioWorklet.addModule(URL.createObjectURL(new Blob([GATE], { type: "text/javascript" })));
      gateReady = true;
    }
    gate = new AudioWorkletNode(ac, "gate", { outputChannelCount: [1] });
    src.connect(gate);
  } catch { gate = src; }

  const eq = (type, f, q, g) => {
    const n = ac.createBiquadFilter();
    n.type = type; n.frequency.value = f; n.Q.value = q; n.gain.value = g;
    return n;
  };
  const hp = eq("highpass", 100, 0.7, 0);
  const warm = eq("peaking", 220, 1, 2); // ấm, dày giọng
  const mud = eq("peaking", 400, 1.2, -2); // bớt đục
  const pres = eq("peaking", 3500, 1, 4); // rõ, sáng lời
  const air = eq("highshelf", 10000, 0.7, 4); // lấp lánh như phòng thu
  const comp = ac.createDynamicsCompressor();
  comp.threshold.value = -30; comp.knee.value = 12; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.25;
  const lim = ac.createDynamicsCompressor(); // chặn đỉnh để không vỡ tiếng
  lim.threshold.value = -4; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.1;
  const g = () => ac.createGain();
  const raw = g(), fxG = g(), makeup = g(), dry = g(), wet = g(), echoG = g(), fb = g(), chG = g(), mix = g(), out = g(), mon = g();
  makeup.gain.value = 1.7; fb.gain.value = 0.32; chG.gain.value = 0.3;
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

  src.connect(raw).connect(out); // giọng gốc (khi tắt hiệu ứng)
  const gateG = g(), noGateG = g();
  src.connect(noGateG).connect(hp); // đường không qua cổng
  gate.connect(gateG).connect(hp); // đường qua cổng giảm ồn
  hp.connect(warm).connect(mud).connect(pres).connect(air).connect(comp).connect(makeup).connect(fxG);
  fxG.connect(dry).connect(mix);
  fxG.connect(conv).connect(wet).connect(mix);
  fxG.connect(dl).connect(dlp).connect(echoG).connect(mix);
  dlp.connect(fb).connect(dl);
  fxG.connect(ch).connect(chG).connect(mix);
  mix.connect(lim).connect(out);
  out.connect(dest); // gửi lên phòng
  out.connect(mon).connect(ac.destination); // nghe lại giọng mình

  const set = ({ filter, reverb, echo, monitor, gate: gt }) => {
    const t = ac.currentTime, f = (p, v) => p.setTargetAtTime(v, t, 0.05);
    f(raw.gain, filter ? 0 : 1);
    f(gateG.gain, gt ? 1 : 0);
    f(noGateG.gain, gt ? 0 : 1);
    f(fxG.gain, filter ? 1 : 0);
    f(wet.gain, reverb / 100);
    f(echoG.gain, (echo / 100) * 0.6);
    f(mon.gain, monitor ? 0.9 : 0);
  };
  set(fx);
  const all = [src, gate, gateG, noGateG, raw, hp, warm, mud, pres, air, comp, makeup, fxG, dry, wet, echoG, fb, chG, mix, lim, out, mon, dest, conv, dl, dlp, ch, lfo, lfoG];
  return {
    track: dest.stream.getAudioTracks()[0],
    ear: fx.ear,
    set,
    stop() {
      stream.getTracks().forEach((t) => t.stop()); // nhả mic hoàn toàn
      dest.stream.getTracks().forEach((t) => t.stop());
      try { lfo.stop(); } catch {}
      all.forEach((n) => { try { n.disconnect(); } catch {} });
    },
  };
}
