'use strict';

const $ = (id) => document.getElementById(id);
const video = $('camera');
const statusEl = $('status');
const bannerEl = $('banner');
const listEl = $('list');

let codeReader = null;
let controls = null;
let scanning = false;
let busy = false;
let lastRaw = '';
let lastAt = 0;
let speechUnlocked = false;

/** @type {{ dni: string, raw: string, time: string, duplicate: boolean }[]} */
const registry = [];
const seen = new Set();
/** @type {string[]} */
const speakQueue = [];
let speaking = false;

const DIGITS = {
  0: 'cero', 1: 'uno', 2: 'dos', 3: 'tres', 4: 'cuatro',
  5: 'cinco', 6: 'seis', 7: 'siete', 8: 'ocho', 9: 'nueve'
};

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
    warm.onend = () => { speechUnlocked = true; };
    speechSynthesis.speak(warm);
    speechUnlocked = true;
  } catch { /* iOS / navegador sin voz */ }
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

/** Chrome a veces deja speechSynthesis en pause y se queda mudo. */
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

  const play = () => {
    try {
      // En iOS, cancelar justo antes puede dejarlo mudo; solo cancelar si hay cola/ruido.
      if (speechSynthesis.speaking || speechSynthesis.pending) {
        speechSynthesis.cancel();
      }
    } catch { /* ignore */ }

    window.setTimeout(() => {
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = 'es-PE';
      utter.rate = 0.9;
      utter.pitch = 1.12;
      utter.volume = 1;
      const voice = pickFemaleVoice();
      if (voice) {
        utter.voice = voice;
        utter.lang = voice.lang || 'es-PE';
      }

      const done = () => {
        speaking = false;
        window.setTimeout(pumpSpeak, 180);
      };
      utter.onend = done;
      utter.onerror = done;

      try {
        speechSynthesis.speak(utter);
        // Si el motor no arranca, no bloquear la cola.
        window.setTimeout(() => {
          if (speaking && !speechSynthesis.speaking && !speechSynthesis.pending) done();
        }, 4000);
      } catch {
        done();
      }
    }, 60);
  };

  play();
}

function enqueueSpeak(text) {
  if (!text || !('speechSynthesis' in window)) return;
  speakQueue.push(text);
  // Evita cola eterna si escanean muy rápido: máximo 3 pendientes.
  while (speakQueue.length > 3) speakQueue.shift();
  pumpSpeak();
}

function speakDni(dni, duplicate) {
  const nums = [...dni].map((d) => DIGITS[d]).join(', ');
  if (duplicate) enqueueSpeak(`Ya registrado. D N I: ${nums}`);
  else enqueueSpeak(`D N I: ${nums}`);
}

function extractDni(raw) {
  const text = String(raw || '').replace(/\u0000/g, ' ').trim();
  const compact = text.replace(/\s+/g, '');

  if (/^\d{8}$/.test(compact)) return compact;
  if (/^\d{8}\d$/.test(compact)) return compact.slice(0, 8);
  const onlyDigits = compact.replace(/\D/g, '');
  if (/^\d{8}$/.test(onlyDigits)) return onlyDigits;

  if (compact.length >= 10 && /^\d{2}\d{8}/.test(compact)) {
    return compact.slice(2, 10);
  }

  const labelled = text.match(/(?:DNI|CUI|N(?:UMERO|ÚMERO)\s*(?:DE\s*)?DNI)\s*[:#-]?\s*(\d{8})(?!\d)/i);
  if (labelled) return labelled[1];
  return '';
}

function nowTime() {
  return new Date().toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function renderList() {
  $('count').textContent = String(registry.length);
  if (!registry.length) {
    listEl.innerHTML = '<li class="empty">Aún no hay escaneos</li>';
    return;
  }
  listEl.innerHTML = registry.map((item, i) => `
    <li>
      <div>
        <div class="num">${item.dni || '—'}</div>
        <div class="meta">${item.raw.length > 42 ? item.raw.slice(0, 42) + '…' : item.raw}</div>
      </div>
      <div class="meta">
        <div>#${registry.length - i} · ${item.time}</div>
        <span class="tag ${item.duplicate ? 'dup' : 'new'}">${item.duplicate ? 'Ya registrado' : 'Nuevo'}</span>
      </div>
    </li>
  `).join('');
}

function handleRead(raw) {
  const dni = extractDni(raw);
  const key = dni || raw;
  const duplicate = seen.has(key);
  seen.add(key);

  registry.unshift({
    dni: dni || '(sin DNI)',
    raw,
    time: nowTime(),
    duplicate
  });
  renderList();

  if (duplicate) {
    showBanner(dni ? `DUPLICADO · YA REGISTRADO\n${dni}` : 'DUPLICADO · YA REGISTRADO', 'dup');
    setStatus(dni ? `Ya registrado: ${dni}` : 'Código ya registrado', 'dup');
    if (dni) speakDni(dni, true);
    else enqueueSpeak('Ya registrado');
  } else {
    showBanner(dni ? `CAPTURADO\n${dni}` : 'CAPTURADO', 'ok');
    setStatus(dni ? `Nuevo: ${dni}` : 'Código capturado', 'ok');
    if (dni) speakDni(dni, false);
    else enqueueSpeak('Código capturado');
  }
}

async function startScan() {
  if (scanning) return;

  if (!window.ZXingBrowser?.BrowserMultiFormatReader) {
    setStatus('No se cargó el lector. Revisa tu conexión.', 'err');
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus('Este navegador no permite cámara.', 'err');
    return;
  }

  unlockSpeech();
  speechSynthesis.getVoices();
  setStatus('Abriendo cámara…');
  $('startBtn').disabled = true;

  try {
    codeReader = new ZXingBrowser.BrowserMultiFormatReader();
    $('overlay').hidden = true;
    $('scanLine').hidden = false;
    scanning = true;
    setStatus('Leyendo en vivo…');

    controls = await codeReader.decodeFromConstraints(
      {
        audio: false,
        video: {
          facingMode: 'environment',
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      },
      video,
      (result) => {
        if (!result || busy) return;
        const raw = String(result.getText() || '').trim();
        if (!raw) return;

        let format = '';
        try {
          const fmt = result.getBarcodeFormat ? result.getBarcodeFormat() : result.format;
          format = String(fmt || '');
        } catch { /* ignore */ }
        const isCode39 = /CODE_?39/i.test(format);
        const dni = extractDni(raw);
        if (!dni && !isCode39) return;

        const now = Date.now();
        // Mismo código: espera 2.8s. Otro DNI: puede entrar tras el bloqueo corto.
        if (raw === lastRaw && now - lastAt < 2800) return;
        lastRaw = raw;
        lastAt = now;

        busy = true;
        handleRead(raw);
        // Bloqueo corto para no repetir el mismo fotograma; otros DNI sí entran.
        window.setTimeout(() => { busy = false; }, 1500);
      }
    );
  } catch (err) {
    scanning = false;
    $('scanLine').hidden = true;
    $('overlay').hidden = false;
    $('startBtn').disabled = false;
    const msg = err?.name === 'NotAllowedError'
      ? 'Permiso de cámara denegado.'
      : 'No se pudo abrir la cámara.';
    setStatus(msg, 'err');
  }
}

$('startBtn').addEventListener('click', startScan);
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
