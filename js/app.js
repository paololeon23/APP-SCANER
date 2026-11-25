'use strict';

const $ = (id) => document.getElementById(id);
const video = $('camera');
const statusEl = $('status');
const bannerEl = $('banner');
const listEl = $('list');
const cameraWrap = $('cameraWrap');
const scanBox = $('scanBox');

const STORAGE_KEY = 'qberries-dni-registry-v1';
const MAX_LIST_RENDER = 120;

let stream = null;
let scanning = false;
let busy = false;
let lastDni = '';
let lastAt = 0;
let speechUnlocked = false;
let scanTimer = null;
let reader = null;
let canvas = null;
let ctx = null;

/** @type {{ dni: string, time: string }[]} */
let registry = [];
const seen = new Set();
/** @type {string[]} */
const speakQueue = [];
let speaking = false;

function setStatus(msg, kind = '') {
  statusEl.textContent = msg;
  statusEl.className = `status ${kind}`.trim();
}

function showBanner(text, kind) {
  bannerEl.hidden = false;
  bannerEl.textContent = text;
  bannerEl.className = `banner ${kind}`;
}

function unlockSpeech() {
  if (!('speechSynthesis' in window) || speechUnlocked) return;
  try {
    const warm = new SpeechSynthesisUtterance('ok');
    warm.volume = 0.01;
    warm.rate = 2;
    speechSynthesis.speak(warm);
    speechUnlocked = true;
  } catch { /* ignore */ }
}

function pickFemaleVoice() {
  const voices = speechSynthesis.getVoices() || [];
  const spanish = voices.filter((v) => /^es([-_]|$)/i.test(v.lang));
  const pool = spanish.length ? spanish : voices;
  const female = /paulina|m[oó]nica|sabina|luc[ií]a|mar[ií]a|carmen|elena|sof[ií]a|isabel|francisca|mujer|female|woman/i;
  const male = /jorge|carlos|diego|juan|pablo|pedro|miguel|hombre|male|\bman\b|daniel|thomas/i;
  return (
    pool.find((v) => female.test(v.name)) ||
    pool.find((v) => /^es/i.test(v.lang) && !male.test(v.name)) ||
    pool.find((v) => /^es/i.test(v.lang)) ||
    pool[0] ||
    null
  );
}

if ('speechSynthesis' in window) {
  setInterval(() => {
    try {
      if (speechSynthesis.speaking && speechSynthesis.paused) speechSynthesis.resume();
    } catch { /* ignore */ }
  }, 800);
}

function pumpSpeak() {
  if (speaking || !speakQueue.length || !('speechSynthesis' in window)) return;
  speaking = true;
  const text = speakQueue.shift();

  try {
    if (speechSynthesis.speaking || speechSynthesis.pending) speechSynthesis.cancel();
  } catch { /* ignore */ }

  window.setTimeout(() => {
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = 'es-PE';
    utter.rate = 1.08;
    utter.pitch = 1.12;
    utter.volume = 1;
    const voice = pickFemaleVoice();
    if (voice) {
      utter.voice = voice;
      utter.lang = voice.lang || 'es-PE';
    }
    const done = () => {
      speaking = false;
      window.setTimeout(pumpSpeak, 80);
    };
    utter.onend = done;
    utter.onerror = done;
    try {
      speechSynthesis.speak(utter);
      window.setTimeout(() => {
        if (speaking && !speechSynthesis.speaking && !speechSynthesis.pending) done();
      }, 2200);
    } catch {
      done();
    }
  }, 40);
}

function enqueueSpeak(text) {
  if (!text || !('speechSynthesis' in window)) return;
  speakQueue.length = 0;
  speakQueue.push(text);
  pumpSpeak();
}

function isValidDni(value) {
  return /^\d{8}$/.test(value) && value !== '00000000';
}

function extractDni(raw) {
  const text = String(raw || '').replace(/\u0000/g, ' ').trim();
  if (!text) return '';

  const compact = text.replace(/\s+/g, '');
  if (isValidDni(compact)) return compact;
  if (/^\d{9}$/.test(compact) && isValidDni(compact.slice(0, 8))) return compact.slice(0, 8);

  const mrz = text.toUpperCase().match(/I<PER(\d{8})</);
  if (mrz && isValidDni(mrz[1])) return mrz[1];

  const labelled = text.match(/(?:DNI|CUI|NUM(?:ERO)?(?:\s*DE)?\s*DNI)\s*[:#=\-]?\s*(\d{8})(?!\d)/i);
  if (labelled && isValidDni(labelled[1])) return labelled[1];

  const only = compact.replace(/\D/g, '');
  if (isValidDni(only)) return only;

  const groups = [...text.matchAll(/(?:^|[^\d])(\d{8})(?!\d)/g)].map((m) => m[1]);
  const unique = [...new Set(groups)].filter(isValidDni);
  if (unique.length === 1 && only.length <= 12) return unique[0];
  return '';
}

function nowTime() {
  return new Date().toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function persist() {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(registry));
  } catch { /* cuota / modo privado */ }
}

function restore() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return;
    registry = data.filter((x) => x && isValidDni(x.dni));
    registry.forEach((x) => seen.add(x.dni));
  } catch { /* ignore */ }
}

function renderList() {
  $('count').textContent = String(registry.length);
  if (!registry.length) {
    listEl.innerHTML = '<li class="empty">Aún no hay escaneos</li>';
    return;
  }
  const visible = registry.slice(0, MAX_LIST_RENDER);
  listEl.innerHTML = visible.map((item, i) => `
    <li>
      <div class="num">${item.dni}</div>
      <div class="meta">
        <div>#${registry.length - i} · ${item.time}</div>
        <span class="tag new">Registrado</span>
      </div>
    </li>
  `).join('');
}

function handleValidDni(dni) {
  if (seen.has(dni)) {
    showBanner(`DNI YA REGISTRADO\n${dni}`, 'dup');
    setStatus(`Ya registrado · Total ${registry.length}`, 'dup');
    enqueueSpeak('DNI ya registrado');
    return;
  }

  seen.add(dni);
  registry.unshift({ dni, time: nowTime() });
  persist();
  renderList();
  showBanner(`DNI REGISTRADO\n${dni}`, 'ok');
  setStatus(`Registrado · Total ${registry.length}`, 'ok');
  enqueueSpeak('DNI registrado');
}

function grabRoiFrame() {
  if (!video.videoWidth || !video.videoHeight) return null;

  const wrap = cameraWrap.getBoundingClientRect();
  const box = scanBox.getBoundingClientRect();
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const scale = Math.max(wrap.width / vw, wrap.height / vh);
  const dispW = vw * scale;
  const dispH = vh * scale;
  const offX = (wrap.width - dispW) / 2;
  const offY = (wrap.height - dispH) / 2;

  const sx = Math.max(0, Math.floor((box.left - wrap.left - offX) / scale));
  const sy = Math.max(0, Math.floor((box.top - wrap.top - offY) / scale));
  const sw = Math.min(vw - sx, Math.floor(box.width / scale));
  const sh = Math.min(vh - sy, Math.floor(box.height / scale));
  if (sw < 20 || sh < 20) return null;

  if (!canvas) {
    canvas = document.createElement('canvas');
    ctx = canvas.getContext('2d', { willReadFrequently: true });
  }
  canvas.width = sw;
  canvas.height = sh;
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);
  return canvas;
}

function buildReader() {
  // Prioriza Code 39 (DNI azul/electrónico). QR de respaldo. Sin PDF417 = más rápido en cola.
  const hints = new Map();
  hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
    ZXing.BarcodeFormat.CODE_39,
    ZXing.BarcodeFormat.QR_CODE
  ]);
  hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
  const r = new ZXing.MultiFormatReader();
  r.setHints(hints);
  return r;
}

function decodeCanvas(c) {
  if (!window.ZXing || !reader) return null;
  try {
    const luminance = new ZXing.HTMLCanvasElementLuminanceSource(c);
    const binary = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(luminance));
    const result = reader.decode(binary);
    reader.reset();
    return result ? String(result.getText() || '').trim() : null;
  } catch {
    try { reader.reset(); } catch { /* ignore */ }
    return null;
  }
}

function scanTick() {
  if (!scanning) return;

  if (!busy && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    const frame = grabRoiFrame();
    if (frame) {
      const raw = decodeCanvas(frame);
      if (raw) {
        const dni = extractDni(raw);
        if (isValidDni(dni)) {
          const now = Date.now();
          const sameTooSoon = dni === lastDni && now - lastAt < 2200;
          const nextTooSoon = dni !== lastDni && now - lastAt < 700;
          if (!sameTooSoon && !nextTooSoon) {
            lastDni = dni;
            lastAt = now;
            busy = true;
            handleValidDni(dni);
            window.setTimeout(() => { busy = false; }, 650);
          }
        }
      }
    }
  }

  scanTimer = window.setTimeout(scanTick, 150);
}

async function startScan() {
  if (scanning) return;

  if (!window.ZXing) {
    setStatus('No se cargó el lector. Revisa tu conexión.', 'err');
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus('Este navegador no permite cámara.', 'err');
    return;
  }

  unlockSpeech();
  if ('speechSynthesis' in window) speechSynthesis.getVoices();
  setStatus('Abriendo cámara…');
  $('startBtn').disabled = true;

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      }
    });
    video.srcObject = stream;
    await video.play();

    reader = buildReader();
    $('overlay').hidden = true;
    $('scanMask').hidden = false;
    scanning = true;
    setStatus(`Listo para personal · Total ${registry.length}`);
    scanTick();
  } catch (err) {
    scanning = false;
    $('scanMask').hidden = true;
    $('overlay').hidden = false;
    $('startBtn').disabled = false;
    const msg = err?.name === 'NotAllowedError'
      ? 'Permiso de cámara denegado.'
      : 'No se pudo abrir la cámara.';
    setStatus(msg, 'err');
  }
}

$('startBtn').addEventListener('click', startScan);

restore();
renderList();

if ('speechSynthesis' in window) {
  speechSynthesis.onvoiceschanged = () => speechSynthesis.getVoices();
  speechSynthesis.getVoices();
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
