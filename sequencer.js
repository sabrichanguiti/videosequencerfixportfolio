// Sabri CHANGUITI - MCT


const PACKS = [
  { label: 'Greyhound',       artist: 'Tangerine Dream', color: '#ff2d78', video: null, path: n => `media/greyhound/TD_GREYHOUND_${n}.mp3`                     },
  { label: 'Pussyface',       artist: 'The Alchemist',   color: '#95eda7', video: 'a',  path: n => `media/pussyface/ALC_PB2_PUSSYFACE_${n}.mp3`               },
  { label: 'Burning Bar',     artist: 'Tangerine Dream', color: '#72aabe', video: 'b',  path: n => `media/burningbar/TD_BURNING_BAR_${n}.mp3`                  },
  { label: 'Crocodile Tears', artist: 'Woody Jackson',   color: '#fda147', video: 'c',  path: n => `media/crocodiletears/WDY_CROCODILE_TEARS_${n}.mp3`         },
];
const NUM_STEMS = 8;
const BEATS     = 16;

let audioCtx;
let audioLevel  = 0;
const wired         = new WeakSet();
const stemAnalysers = {}; 

function initAudio() {
  if (audioCtx) { audioCtx.state === 'suspended' && audioCtx.resume(); return; }
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    // Pre-wire every stem immediately so there's zero wiring overhead at toggle time
    for (let n = 1; n <= NUM_STEMS; n++) {
      if (stems[n]) wireElement(stems[n].audio, n);
    }
  }
  catch (e) { console.warn('[NP] Web Audio unavailable:', e.message); }
}


function getStemAnalyser(n) {
  if (stemAnalysers[n]) return stemAnalysers[n];
  const node = audioCtx.createAnalyser();
  node.fftSize               = 256;
  node.smoothingTimeConstant = 0.82;
  node.connect(audioCtx.destination);
  return (stemAnalysers[n] = { node, data: new Uint8Array(node.frequencyBinCount), level: 0 });
}

function wireElement(el, n) {
  if (!audioCtx || wired.has(el)) return;
  try { audioCtx.createMediaElementSource(el).connect(getStemAnalyser(n).node); wired.add(el); } catch {}
}


function readAllLevels() {
  let sum = 0, count = 0;
  for (let n = 1; n <= NUM_STEMS; n++) {
    const sa = stemAnalysers[n];
    if (!sa) continue;
    if (stems[n]?.active) {
      sa.node.getByteFrequencyData(sa.data);
      const end = Math.floor(sa.data.length * 0.12);
      let bsum = 0;
      for (let i = 0; i < end; i++) bsum += sa.data[i];
      const raw = bsum / (end * 255);
      sa.level = raw > sa.level ? sa.level * 0.4 + raw * 0.6 : sa.level * 0.88 + raw * 0.12;
      sum += sa.level; count++;
    } else if (sa) {
      sa.level *= 0.88;
    }
  }
  audioLevel = count > 0 ? sum / count : audioLevel * 0.94;
}

const $ = id => document.getElementById(id);
let els     = {};
let packIdx = 0;

const stems = {};
const keys  = {};

const S = {
  playing:      true,
  songDur:      0,
  seekPos:      0,
  dragging:     false,
  vid1:         false, vid2: false, vid3: false, img: -1,
  glitchHold:   false, glitchI: 0,
  scanlines:    false, strobe: false,
  pulseHold:    false, pulsePhase: 0,
  videoVisible: true,
};

const clamp   = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const mmss    = s  => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const hexRgba = (hex, a) => {
  const [r, g, b] = [hex.slice(1,3), hex.slice(3,5), hex.slice(5,7)].map(x => parseInt(x, 16));
  return `rgba(${r},${g},${b},${clamp(a, 0, 1)})`;
};
const packColor = () => PACKS[packIdx].color;

function getElapsed() {
  for (let n = 1; n <= NUM_STEMS; n++) {
    const s = stems[n];
    if (s?.active && !s.audio.paused) return s.audio.currentTime;
  }
  return S.seekPos * S.songDur;
}

function getDuration() {
  for (let n = 1; n <= NUM_STEMS; n++) {
    const d = stems[n]?.audio?.duration;
    if (d && isFinite(d)) return d;
  }
  return S.songDur;
}


function fade(audio, from, to, ms, done) {
  clearInterval(audio.__fadeTimer);
  audio.volume = from;
  const t0 = performance.now();
  audio.__fadeTimer = setInterval(() => {
    const p = clamp((performance.now() - t0) / ms, 0, 1);
    audio.volume = from + (to - from) * p;
    if (p >= 1) { clearInterval(audio.__fadeTimer); done?.(); }
  }, 16);
}


function createStemsForPack() {
  for (let n = 1; n <= NUM_STEMS; n++) {
    if (stems[n]) {
      clearInterval(stems[n].audio.__fadeTimer);
      try { stems[n].audio.pause(); stems[n].audio.src = ''; } catch {}
    }
    const a   = new Audio(PACKS[packIdx].path(n));
    a.loop    = true;
    a.preload = 'auto';  
    a.volume  = 0;
    a.addEventListener('loadedmetadata', () => {
      if (isFinite(a.duration)) S.songDur = a.duration;
    }, { once: true });
    stems[n] = { audio: a, active: false };
    // If AudioContext already exists (pack switch mid-session), wire straight away
    if (audioCtx) wireElement(a, n);
}}

function toggleStem(n) {
  initAudio();
  const s = stems[n];
  if (!s) return;
  s.active = !s.active;

  if (s.active) {
    const elapsed = getElapsed();
    s.audio.volume = 1;
    // Seek immediately if duration is known; otherwise seek once metadata arrives
    if (isFinite(s.audio.duration) && s.audio.duration > 0) {
      s.audio.currentTime = elapsed % s.audio.duration;
    } else {
      s.audio.addEventListener('loadedmetadata', () => {
        if (isFinite(s.audio.duration)) s.audio.currentTime = elapsed % s.audio.duration;
      }, { once: true });
    }
    // Call play() straight away — browser buffers on demand, no canplay wait needed
    if (S.playing) s.audio.play().catch(() => {});
  } else {
    fade(s.audio, s.audio.volume, 0, 600, () => s.audio.pause());
  }

  $(`stem-${n}`)?.classList.toggle('active', s.active);
}

function pauseAllStems()  { Object.values(stems).forEach(s => s.active && s.audio.pause()); }
function resumeAllStems() { Object.values(stems).forEach(s => s.active && s.audio.play().catch(() => {})); }

function animateStemBars() {
  for (let n = 1; n <= NUM_STEMS; n++) {
    const level  = stemAnalysers[n]?.level ?? 0;
    const active = stems[n]?.active ?? false;
    $(`stem-${n}`)?.querySelectorAll('.stem-bar').forEach(bar => {
      bar.style.height = active
        ? `${Math.max(2, (level * 0.65 + (0.25 + Math.random() * 0.75) * 0.35) * 18)}px`
        : '2px';
    });
  }
}

function switchPack(targetIdx = null) {
  initAudio();
  const newIdx = targetIdx !== null ? targetIdx : (packIdx + 1) % PACKS.length;
  if (newIdx === packIdx) return;

  const activeNums    = Object.keys(stems).filter(n => stems[n]?.active).map(Number);
  const dur           = getDuration();
  const normalizedPos = dur > 0 ? getElapsed() / dur : S.seekPos;

  packIdx   = newIdx;
  S.songDur = 0;

  createStemsForPack();

  activeNums.forEach(n => {
    stems[n].active = true;
    wireElement(stems[n].audio, n);
    const a  = stems[n].audio;
    const go = () => {
      if (isFinite(a.duration)) a.currentTime = normalizedPos * a.duration;
      a.volume = 1;
      if (S.playing) a.play().catch(() => {});
    };
    // Seek immediately if ready, otherwise seek on metadata then play regardless
    if (isFinite(a.duration) && a.duration > 0) {
      go();
    } else {
      a.addEventListener('loadedmetadata', () => {
        if (isFinite(a.duration)) a.currentTime = normalizedPos * a.duration;
      }, { once: true });
      a.volume = 1;
      if (S.playing) a.play().catch(() => {});
    }
    $(`stem-${n}`)?.classList.add('active');
  });

  updateBranding();
}

function updateBranding() {
  const { label, artist, color, video } = PACKS[packIdx];

  document.title = label;
  document.querySelector('.artist-label').textContent = label;
  const artistEl = $('artist-name');
  if (artistEl) artistEl.textContent = artist;
  const packLabel = $('pack-label');
  if (packLabel) packLabel.textContent = label;

  document.documentElement.style.setProperty('--accent', color);

    S.vid1 = false; S.vid2 = false; S.vid3 = false;
    $('layer-video-a').classList.remove('active');
    $('layer-video-b').classList.remove('active');
    $('layer-video-c').classList.remove('active');

    if (video === 'a') { S.vid1 = true; $('layer-video-a').classList.add('active'); }
    if (video === 'b') { S.vid2 = true; $('layer-video-b').classList.add('active'); }
    if (video === 'c') { S.vid3 = true; $('layer-video-c').classList.add('active'); }

updateVideoStates();
}

function setupSeekbar() {
  const sb = els.seekbar;
  const posFromEvent = e => {
    const rect = sb.getBoundingClientRect();
    const x    = e.touches ? e.touches[0].clientX : e.clientX;
    return clamp((x - rect.left) / rect.width, 0, 1);
  };
  const onStart = e => {
    if (e.type === 'touchstart') e.preventDefault();
    S.dragging = true; sb.classList.add('dragging'); applySeek(posFromEvent(e));
  };
  const onMove = e => {
    if (!S.dragging) return;
    if (e.type === 'touchmove') e.preventDefault();
    applySeek(posFromEvent(e));
  };
  const onEnd = () => { S.dragging = false; sb.classList.remove('dragging'); };

  sb.addEventListener('mousedown',  onStart);
  sb.addEventListener('touchstart', onStart, { passive: false });
  document.addEventListener('mousemove',  onMove);
  document.addEventListener('touchmove',  onMove, { passive: false });
  document.addEventListener('mouseup',   onEnd);
  document.addEventListener('touchend',  onEnd);
}

function applySeek(pos) {
  S.seekPos = pos;
  [els.video1, els.video2, els.video3].forEach(v => {
    if (v?.readyState > 2 && v.duration) v.currentTime = pos * v.duration;
  });
  Object.values(stems).forEach(s => {
    if (isFinite(s.audio.duration)) s.audio.currentTime = pos * s.audio.duration;
  });
}

function updateSeekUI() {
  const dur     = getDuration();
  const elapsed = dur > 0 ? getElapsed() : S.seekPos * S.songDur;
  const pos     = dur > 0 ? clamp(elapsed / dur, 0, 1) : S.seekPos;
  if (!S.dragging) S.seekPos = pos;

  const pct = `${pos * 100}%`;
  els.seekProgress.style.width = pct;
  els.seekThumb.style.left     = pct;

  if (els.seekTime)      els.seekTime.textContent      = dur > 0 ? `${mmss(elapsed)} / ${mmss(dur)}` : '--:-- / --:--';
  if (els.timeRemaining) els.timeRemaining.textContent  = dur > 0 ? `−${mmss(dur - elapsed)}`         : '−--:--';
}

function updateSpectrumGrid() {
  const cells = els.beatCells;
  if (!cells?.length) return;

  const activeData = [];
  for (let n = 1; n <= NUM_STEMS; n++) {
    if (stems[n]?.active && stemAnalysers[n]) activeData.push(stemAnalysers[n].data);
  }

  cells.forEach((cell, i) => {
    if (!activeData.length) { cell.style.background = ''; return; }
    const binCount = activeData[0].length;
    const lo = Math.floor(Math.pow(binCount, i / BEATS));
    const hi = Math.floor(Math.pow(binCount, (i + 1) / BEATS));
    let peak = 0;
    activeData.forEach(data => { for (let b = lo; b <= hi; b++) if (data[b] > peak) peak = data[b]; });
    const v = peak / 255;
    cell.style.background = v > 0.02 ? hexRgba(packColor(), clamp(v * 1.1, 0, 0.9)) : '';
  });
}

function updateVideoStates() {
  [[els.video1, S.vid1], [els.video2, S.vid2], [els.video3, S.vid3]].forEach(([v, on]) => {
    if (!v) return;
    const shouldPlay = on && S.playing;
    if (shouldPlay  && v.paused)  v.play().catch(() => {});
    if (!shouldPlay && !v.paused) v.pause();
  });
}

function updateHoldFX() {
  S.glitchI    = clamp(S.glitchI + (S.glitchHold ? 4 : -2.5), 0, 100);
  S.pulsePhase += S.pulseHold ? 0.06 + audioLevel * 0.22 : 0.02 + audioLevel * 0.08;
}

function drawBG(time, w, h) {
  const ctx = els.ctxs.bg;
  const t   = time * 0.001;
  const col = packColor();

  ctx.fillStyle = '#050508';
  ctx.fillRect(0, 0, w, h);

  const waves = [
    { color: col,                       amp: h * 0.12, freq: 2.5, speed:  0.4, phase: 0   },
    { color: 'rgba(255,255,255,0.06)',  amp: h * 0.06, freq: 4.2, speed: -0.7, phase: 1.1 },
    { color: col,                       amp: h * 0.03, freq: 7.0, speed:  1.1, phase: 2.4 },
  ];

  waves.forEach(({ color, amp, freq, speed, phase }) => {
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth   = 1.8;
    ctx.shadowColor = color;
    ctx.shadowBlur  = 14;
    for (let x = 0; x <= w; x += 3) {
      const y = h / 2
        + Math.sin(x / w * Math.PI * 2 * freq + t * speed + phase) * amp
        + Math.sin(x / w * Math.PI * 2 * freq * 0.4 + t * speed * 1.6) * amp * 0.25;
      x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
  });
}

function drawPulse(w, h) {
  const ctx = els.ctxs.pulse;
  ctx.clearRect(0, 0, w, h);

  const active = [];
  for (let n = 1; n <= NUM_STEMS; n++) { if (stems[n]?.active) active.push(n); }

  if (!active.length) {
    if (!S.pulseHold) return;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    drawStemCircle(ctx, w / 2, h / 2, audioLevel, w, h);
    ctx.restore();
    return;
  }

  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  const cx     = w / 2;
  const cy     = h / 2;
  const orbitR = Math.min(w, h) * (active.length === 1 ? 0 : 0.22);

  active.forEach(n => {
    const angle = ((n - 1) / NUM_STEMS) * Math.PI * 2 - Math.PI / 2;
    drawStemCircle(
      ctx,
      cx + Math.cos(angle) * orbitR,
      cy + Math.sin(angle) * orbitR,
      stemAnalysers[n]?.level ?? 0,
      w, h
    );
  });
  ctx.restore();
}

function drawStemCircle(ctx, cx, cy, level, w, h) {
  const color    = packColor();
  const boost    = S.pulseHold ? 1.0 : 0.55;
  const maxR     = Math.min(w, h) * 0.14;
  const minR     = maxR * 0.18;
  const numRings = S.pulseHold ? 4 : 3;
  const phase    = S.pulsePhase + cx * 0.001 + cy * 0.001;

  for (let i = 0; i < numRings; i++) {
    const wave   = Math.sin(phase - i * 1.3) * 0.5 + 0.5;
    const radius = minR + wave * maxR * (0.3 + level * 0.7) + i * 7;
    const alpha  = (1 - i / numRings) * (0.12 + level * 0.75) * boost;
    const lw     = (numRings - i) * 4 * (0.4 + level * 0.6) * boost;
    if (radius <= 0 || alpha <= 0 || lw <= 0) continue;
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(1, radius), 0, Math.PI * 2);
    ctx.strokeStyle = hexRgba(color, alpha);
    ctx.lineWidth   = lw;
    ctx.shadowBlur  = 20 + level * 50;
    ctx.shadowColor = color;
    ctx.stroke();
  }

  if (level > 0.04) {
    const glowR = minR * (1 + level * 3) * boost;
    const grad  = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR);
    grad.addColorStop(0, hexRgba(color, level * 0.5 * boost));
    grad.addColorStop(1, hexRgba(color, 0));
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(cx, cy, glowR, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
  }
}


function drawGlitch(w, h) {
  const ctx       = els.ctxs.fx;
  const intensity = S.glitchI / 100;
  ctx.clearRect(0, 0, w, h);
  if (intensity <= 0) return;

  const slices = Math.floor(3 + intensity * 16);
  for (let i = 0; i < slices; i++) {
    const sy    = Math.random() * h;
    const sh    = Math.random() * (12 + intensity * 55) + 2;
    const dx    = (Math.random() - 0.5) * intensity * 130;
    const aberr = (6 + Math.random() * 12) * intensity;

    ctx.globalAlpha              = 0.55 + Math.random() * 0.4;
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(els.bgCanvas, 0, sy, w, sh, dx, sy, w, sh);

    ctx.globalAlpha              = 0.3 * intensity;
    ctx.globalCompositeOperation = 'screen';
    ctx.filter = 'saturate(0) sepia(1) saturate(10) hue-rotate(300deg)';
    ctx.drawImage(els.bgCanvas, 0, sy, w, sh, dx + aberr, sy, w, sh);
    ctx.filter = 'saturate(0) sepia(1) saturate(10) hue-rotate(140deg)';
    ctx.drawImage(els.bgCanvas, 0, sy, w, sh, dx - aberr, sy, w, sh);

    ctx.filter                   = 'none';
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha              = 1;
  }

  for (let i = 0; i < Math.floor(intensity * 15); i++) {
    ctx.globalAlpha = (0.2 + Math.random() * 0.55) * intensity;
    ctx.fillStyle   = Math.random() < 0.5 ? packColor() : '#ffffff';
    ctx.fillRect(Math.random() * w, Math.random() * h, Math.random() * 260 + 30, Math.random() * 2.5 + 0.5);
  }

  if (intensity > 0.4 && Math.random() < 0.07) {
    ctx.globalAlpha              = 0.2 * intensity;
    ctx.globalCompositeOperation = 'screen';
    ctx.drawImage(els.bgCanvas, 0, (Math.random() - 0.5) * 45 * intensity);
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.globalAlpha = 1;
}


let wheelOpen  = false;
let wheelHover = -1;
let wCanvas, wCtx;

const W_OUTER  = 145;
const W_INNER  = 52;
const W_LABEL  = 184;
const W_GAP    = 0.04;

function drawWheel() {
  if (!wCtx) return;
  const CX = 250, CY = 250;
  wCtx.clearRect(0, 0, 500, 500);

  PACKS.forEach((pack, i) => {
    const segStart = -3 * Math.PI / 4 + i * Math.PI / 2 + W_GAP;
    const segEnd   = -3 * Math.PI / 4 + (i + 1) * Math.PI / 2 - W_GAP;
    const midAngle = -Math.PI / 2 + i * Math.PI / 2;
    const isHover  = wheelHover === i;
    const isCurrent = packIdx === i;
    const R         = isHover ? W_OUTER + 13 : W_OUTER;

    wCtx.beginPath();
    wCtx.arc(CX, CY, R, segStart, segEnd);
    wCtx.arc(CX, CY, W_INNER, segEnd, segStart, true);
    wCtx.closePath();
    wCtx.fillStyle   = pack.color;
    wCtx.globalAlpha = isHover ? 0.88 : (isCurrent ? 0.52 : 0.18);
    if (isHover) { wCtx.shadowColor = pack.color; wCtx.shadowBlur = 32; }
    wCtx.fill();
    wCtx.shadowBlur = 0;

    const labelPush = isHover ? 7 : 0;
    const lx = CX + Math.cos(midAngle) * (W_LABEL + labelPush);
    const ly = CY + Math.sin(midAngle) * (W_LABEL + labelPush);

    wCtx.textAlign    = 'center';
    wCtx.textBaseline = 'middle';

    wCtx.globalAlpha  = isHover ? 1.0 : (isCurrent ? 0.75 : 0.45);
    wCtx.fillStyle    = isHover ? pack.color : '#ffffff';
    wCtx.font         = `bold ${isHover ? 14 : 12}px 'Orbitron', sans-serif`;
    wCtx.shadowColor  = isHover ? pack.color : 'transparent';
    wCtx.shadowBlur   = isHover ? 12 : 0;
    wCtx.fillText(pack.label.toUpperCase(), lx, ly - 9);

    wCtx.font         = `${isHover ? 12 : 10}px 'Share Tech Mono', monospace`;
    wCtx.fillStyle    = '#ffffff';
    wCtx.globalAlpha  = isHover ? 0.82 : 0.38;
    wCtx.shadowBlur   = 0;
    wCtx.fillText(pack.artist, lx, ly + 9);
  });

  const focused = wheelHover >= 0 ? PACKS[wheelHover] : PACKS[packIdx];
  wCtx.globalAlpha = 1;
  wCtx.beginPath();
  wCtx.arc(CX, CY, W_INNER - 5, 0, Math.PI * 2);
  wCtx.fillStyle = '#050508';
  wCtx.fill();

  wCtx.textAlign    = 'center';
  wCtx.textBaseline = 'middle';
  wCtx.shadowColor  = focused.color;
  wCtx.shadowBlur   = 10;
  wCtx.fillStyle    = focused.color;
  wCtx.font         = `bold 10px 'Orbitron', sans-serif`;
  wCtx.fillText(focused.label.toUpperCase(), CX, CY - 8);
  wCtx.fillStyle    = 'rgba(255,255,255,0.6)';
  wCtx.font         = `9px 'Share Tech Mono', monospace`;
  wCtx.shadowBlur   = 0;
  wCtx.fillText(focused.artist, CX, CY + 8);
}

function openWheel() {
  if (wheelOpen) return;
  wheelOpen  = true;
  wheelHover = -1;
  $('radio-wheel').classList.add('open');
  drawWheel();
}

function closeWheel() {
  if (!wheelOpen) return;
  wheelOpen = false;
  $('radio-wheel').classList.remove('open');
  if (wheelHover >= 0 && wheelHover !== packIdx) switchPack(wheelHover);
  wheelHover = -1;
}

function setupWheelMouse() {
  document.addEventListener('mousemove', e => {
    if (!wheelOpen || !wCanvas) return;
    const rect    = wCanvas.getBoundingClientRect();
    const dx      = e.clientX - (rect.left + rect.width  / 2);
    const dy      = e.clientY - (rect.top  + rect.height / 2);
    const dist    = Math.sqrt(dx * dx + dy * dy);
    const prevH   = wheelHover;

    if (dist < 60) {
      wheelHover = -1;
    } else {
      const shifted = ((Math.atan2(dy, dx) + 3 * Math.PI / 4) + 2 * Math.PI) % (2 * Math.PI);
      wheelHover    = Math.floor(shifted / (Math.PI / 2)) % 4;
    }

    if (wheelHover !== prevH) drawWheel();
  });
}

function mainLoop(time) {
  const { width: w, height: h } = els.bgCanvas;

  readAllLevels();
  animateStemBars();
  updateSeekUI();
  updateSpectrumGrid();
  updateVideoStates();
  updateHoldFX();
  drawBG(time, w, h);
  drawPulse(w, h);
  drawGlitch(w, h);
  if (wheelOpen) drawWheel();

  requestAnimationFrame(mainLoop);
}

const KEY_MAP = {
  v: 'video', d: 'imgs',
  f: 'glitch', g: 'scan', h: 'strobe',
  j: 'pulse', t: 'pack', ' ': 'play',
};
for (let i = 1; i <= NUM_STEMS; i++) KEY_MAP[String(i)] = `stem${i}`;

const ACTIONS = {
  imgs()   {
    S.img = S.img >= els.imgs.length - 1 ? -1 : S.img + 1;
    els.imgs.forEach((img, i) => img.classList.toggle('active', i === S.img));
  },
  glitch() { S.glitchHold = true; },
  scan()   { S.scanlines = !S.scanlines; document.body.classList.toggle('scanlines', S.scanlines); },
  strobe() { S.strobe    = !S.strobe;    document.body.classList.toggle('strobe',    S.strobe); },
  pulse()  { S.pulseHold = true; },
  pack()   { switchPack(); },
  play()   { S.playing = !S.playing; S.playing ? resumeAllStems() : pauseAllStems(); updateVideoStates(); },
  video()  {
    S.videoVisible = !S.videoVisible;
    [els.layer1, els.layer2, els.layer3].forEach(l => l?.classList.toggle('hidden', !S.videoVisible));
  },
};
for (let i = 1; i <= NUM_STEMS; i++) ACTIONS[`stem${i}`] = () => toggleStem(i);

function getKbd(key) {
  const label = key === ' ' ? 'SPACE' : key.toUpperCase();
  return [...document.querySelectorAll('#key-guide kbd')].find(k => k.textContent.trim() === label);
}

addEventListener('keydown', e => {
  if (e.key === 'Shift') { e.preventDefault(); openWheel(); return; }
  if (e.code === 'Space') e.preventDefault();
  if (e.repeat) return;

  initAudio();
  const key = e.key === ' ' ? ' ' : e.key.toLowerCase();
  if (keys[key]) return;
  keys[key] = true;

  const action = KEY_MAP[key];
  if (!action) return;

  getKbd(key)?.classList.add('pressed');
  els.keyDisplay.textContent = key === ' ' ? '▶' : key.toUpperCase();
  els.keyDisplay.classList.add('flash');
  setTimeout(() => { els.keyDisplay.classList.remove('flash'); els.keyDisplay.textContent = ''; }, 240);

  ACTIONS[action]?.();
});

addEventListener('keyup', e => {
  if (e.key === 'Shift') { closeWheel(); return; }
  const key = e.key === ' ' ? ' ' : e.key.toLowerCase();
  keys[key] = false;
  getKbd(key)?.classList.remove('pressed');
  if (key === 'f') S.glitchHold = false;
  if (key === 'j') S.pulseHold  = false;
});

function init() {
  els = {
    bgCanvas:      $('bg-canvas'),
    pulseCanvas:   $('pulse-canvas'),
    fxCanvas:      $('fx-canvas'),
    video1:        $('vid-a'),
    video2:        $('vid-b'),
    video3:        $('vid-c'),
    layer1:        $('layer-video-a'),
    layer2:        $('layer-video-b'),
    layer3:        $('layer-video-c'),
    imgs:          [...document.querySelectorAll('.overlay-img')],
    seekbar:       $('seekbar'),
    seekProgress:  $('seekbar-progress'),
    seekThumb:     $('seekbar-thumb'),
    seekTime:      $('seek-time'),
    timeRemaining: $('time-remaining'),
    beatCells:     null,
    keyDisplay:    $('active-keys'),
    ctxs:          {},
  };

  els.ctxs.bg    = els.bgCanvas.getContext('2d');
  els.ctxs.pulse = els.pulseCanvas.getContext('2d');
  els.ctxs.fx    = els.fxCanvas.getContext('2d');

  wCanvas = $('wheel-canvas');
  wCtx    = wCanvas?.getContext('2d');

  const grid = $('beat-grid');
  for (let i = 0; i < BEATS; i++) {
    const d = document.createElement('div');
    d.className = 'beat-cell';
    grid.appendChild(d);
  }
  els.beatCells = [...grid.querySelectorAll('.beat-cell')];

  const resize = () => [els.bgCanvas, els.pulseCanvas, els.fxCanvas].forEach(c => {
    c.width = innerWidth; c.height = innerHeight;
  });
  resize();
  addEventListener('resize', resize);

  setupSeekbar();
  setupWheelMouse();

  createStemsForPack();
  updateBranding();

  [els.video1, els.video2, els.video3].filter(Boolean).forEach(v => v.play().catch(() => {}));

  requestAnimationFrame(mainLoop);
}

let _initDone = false;
function safeInit() { if (!_initDone) { _initDone = true; init(); } }
addEventListener('DOMContentLoaded', safeInit);
if (document.readyState !== 'loading') safeInit();afeInit();
