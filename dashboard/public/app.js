const $ = (id) => document.getElementById(id);
const DEFAULT_STREAM_URL = 'http://teng-morse.local:81/events';
const STREAM_STORAGE_KEY = 'teng-morse-stream-url';
const DOCTOR_NUMBER_STORAGE_KEY = 'teng-morse-doctor-number';
const DOUBLE_TAP_WINDOW_MS = 1000;
const SHORT_TAP_MAX_MS = 450;
const DOCTOR_HOLD_MS = 5000;
const morse = {
  ".-":"A","-...":"B","-.-.":"C","-..":"D",".":"E","..-.":"F","--.":"G","....":"H","..":"I",".---":"J","-.-":"K",".-..":"L","--":"M","-.":"N","---":"O",".--.":"P","--.-":"Q",".-.":"R","...":"S","-":"T","..-":"U","...-":"V",".--":"W","-..-":"X","-.--":"Y","--..":"Z","-----":"0",".----":"1","..---":"2","...--":"3","....-":"4",".....":"5","-....":"6","--...":"7","---..":"8","----.":"9"
};
const entries = Object.entries(morse);
const channels = {
  raw: { label:'RAW', legend:'RAW VOLTAGE', help:'The direct ESP32 reading, unchanged. Use this to see the real sensor behavior.' },
  ema: { label:'SMOOTH', legend:'EMA SMOOTH', help:'A responsive exponential smoother. It reduces continuous jitter with only a small timing delay.' },
  median: { label:'SPIKE GUARD', legend:'MEDIAN-5', help:'Uses the middle value of five samples. Best for rejecting isolated voltage spikes; adds about 40 ms of delay.' },
  average: { label:'NOISE AVERAGE', legend:'MEAN-5', help:'Averages five samples to reduce random noise. Smoothest choice, but it softens short pulses.' }
};
const ui = { yMin:$('yMin'), yMax:$('yMax'), xSeconds:$('xSeconds'), xOutput:$('xOutput'), filterChannel:$('filterChannel'), channelOutput:$('channelOutput'), channelHelp:$('channelHelp'), streamUrl:$('streamUrl'), streamStatus:$('streamStatus'), thresholdToggle:$('thresholdToggle'), thresholdInput:$('thresholdInput'), thresholdField:$('thresholdField'), hysteresisMv:$('hysteresisMv'), hysteresisField:$('hysteresisField'), dashMs:$('dashMs'), characterGapMs:$('characterGapMs'), wordGapMs:$('wordGapMs'), doctorNumber:$('doctorNumber') };
const canvas = $('plot');
const ctx = canvas.getContext('2d');
const samples = [];
const maxHistory = 5000;
let sampleInterval = 20;
let decoder = { high:false, lastChange:0, buffer:'', text:'', characterFinished:false, wordFinished:false };
let filterState = { ema:null, window:[] };
let events = null;
let streamUrl = localStorage.getItem(STREAM_STORAGE_KEY) || DEFAULT_STREAM_URL;
let gestures = { lastShortTapAt:0, longHoldTriggered:false, doctorAlertActive:false };

function number(input, fallback) { const value = Number.parseFloat(input.value); return Number.isFinite(value) ? value : fallback; }
function settings() {
  const min = Math.max(0, number(ui.yMin, 0));
  const max = Math.min(3.3, Math.max(min + 0.0001, number(ui.yMax, 0.3)));
  return { min, max, xSeconds:Number(ui.xSeconds.value), channel:ui.filterChannel.value, enabled:ui.thresholdToggle.checked, threshold:Math.max(0, Math.min(3.3, number(ui.thresholdInput, .2))), hysteresis:Math.max(0, Number(ui.hysteresisMv.value) / 1000), dash:number(ui.dashMs, 300), characterGap:number(ui.characterGapMs, 800), wordGap:number(ui.wordGapMs, 2000) };
}
function syncControls() {
  const s = settings();
  ui.xOutput.textContent = `${s.xSeconds} SEC`;
  $('dashOutput').textContent = `${s.dash} ms`;
  $('characterOutput').textContent = `${s.characterGap} ms`;
  $('wordOutput').textContent = `${s.wordGap} ms`;
  $('hysteresisOutput').textContent = `${Math.round(s.hysteresis * 1000)} mV`;
  ui.channelOutput.textContent = channels[s.channel].label;
  ui.channelHelp.textContent = channels[s.channel].help;
  $('sampleBadge').textContent = channels[s.channel].label;
  $('channelLegend').textContent = channels[s.channel].legend;
  ui.thresholdField.classList.toggle('is-off', !s.enabled);
  ui.hysteresisField.classList.toggle('is-off', !s.enabled);
  ui.hysteresisMv.classList.toggle('is-off', !s.enabled);
  $('thresholdLegend').hidden = !s.enabled;
  $('thresholdLegend').textContent = s.hysteresis ? 'TRIGGER BAND' : 'THRESHOLD';
  $('plotSummary').textContent = `Last ${s.xSeconds} seconds / ${Math.round(1000 / sampleInterval)} samples per second`;
  $('rangeLabel').textContent = `${s.min.toFixed(3)} - ${s.max.toFixed(3)} V`;
  drawGraph();
}
function resetFilter() { filterState = { ema:null, window:[] }; }
function channelVoltage(rawVoltage, channel) {
  filterState.window.push(rawVoltage);
  if (filterState.window.length > 5) filterState.window.shift();
  filterState.ema = filterState.ema === null ? rawVoltage : 0.28 * rawVoltage + 0.72 * filterState.ema;
  if (channel === 'raw') return rawVoltage;
  if (channel === 'ema') return filterState.ema;
  if (channel === 'median') {
    const ordered = [...filterState.window].sort((a, b) => a - b);
    return ordered[Math.floor(ordered.length / 2)];
  }
  return filterState.window.reduce((total, value) => total + value, 0) / filterState.window.length;
}
function drawGraph() {
  const s = settings();
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, rect.width), height = Math.max(1, rect.height);
  const margin = { left:55, right:14, top:15, bottom:30 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#faffff'; ctx.fillRect(0, 0, width, height);
  const y = (value) => margin.top + (s.max - value) / (s.max - s.min) * plotHeight;
  ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let i = 0; i <= 4; i++) {
    const yy = margin.top + plotHeight * i / 4;
    const value = s.max - (s.max - s.min) * i / 4;
    ctx.strokeStyle = '#d9e8e8'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(margin.left, yy); ctx.lineTo(width - margin.right, yy); ctx.stroke();
    ctx.fillStyle = '#6b7788'; ctx.fillText(value.toFixed(3), margin.left - 8, yy);
  }
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (let i = 0; i <= 4; i++) {
    const xx = margin.left + plotWidth * i / 4;
    const label = i === 0 ? `-${s.xSeconds}s` : i === 4 ? 'NOW' : `-${Math.round(s.xSeconds * (1 - i / 4))}s`;
    ctx.fillStyle = '#6b7788'; ctx.fillText(label, xx, height - margin.bottom + 10);
  }
  if (s.enabled && s.threshold >= s.min && s.threshold <= s.max) {
    const pressLevel = Math.min(3.3, s.threshold + s.hysteresis / 2);
    const releaseLevel = Math.max(0, s.threshold - s.hysteresis / 2);
    const upper = y(pressLevel), lower = y(releaseLevel), center = y(s.threshold);
    if (s.hysteresis) { ctx.fillStyle = '#cf20321a'; ctx.fillRect(margin.left, Math.min(upper, lower), plotWidth, Math.abs(lower - upper)); }
    ctx.setLineDash([5, 4]); ctx.strokeStyle = '#cf2032'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(margin.left, center); ctx.lineTo(width - margin.right, center); ctx.stroke(); ctx.setLineDash([]);
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillStyle = '#cf2032';
    ctx.fillText(s.hysteresis ? `PRESS ${pressLevel.toFixed(3)} / RELEASE ${releaseLevel.toFixed(3)} V` : `THRESHOLD ${s.threshold.toFixed(3)} V`, margin.left + 7, center - 4);
  }
  const cutoff = Date.now() - s.xSeconds * 1000;
  const windowed = samples.filter((sample) => sample.at >= cutoff);
  $('plotEmpty').hidden = windowed.length > 1;
  if (windowed.length < 2) return;
  const firstAt = Math.max(windowed[0].at, Date.now() - s.xSeconds * 1000);
  ctx.save(); ctx.beginPath(); ctx.rect(margin.left, margin.top, plotWidth, plotHeight); ctx.clip();
  ctx.strokeStyle = '#17c6b3'; ctx.lineWidth = 2.25; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.beginPath();
  windowed.forEach((sample, index) => { const x = margin.left + Math.min(1, (sample.at - firstAt) / (s.xSeconds * 1000)) * plotWidth; index ? ctx.lineTo(x, y(sample.voltage)) : ctx.moveTo(x, y(sample.voltage)); });
  ctx.stroke(); ctx.restore();
}
function candidates() {
  const matches = decoder.buffer ? entries.filter(([pattern]) => pattern.startsWith(decoder.buffer)).slice(0, 9) : [];
  $('candidates').innerHTML = matches.map(([pattern, letter]) => `<b>${letter}<small>${pattern}</small></b>`).join('');
  $('candidateText').textContent = decoder.buffer ? `${matches.length || 'No'} character${matches.length === 1 ? '' : 's'} still match “${decoder.buffer}”.` : 'The partial dot/dash sequence will reveal likely letters and numbers here.';
}
function finishCharacter(addSpace = false) {
  if (!decoder.buffer || decoder.characterFinished) return;
  decoder.text += morse[decoder.buffer] || '?';
  if (addSpace && !decoder.text.endsWith(' ')) decoder.text += ' ';
  decoder.buffer = ''; decoder.characterFinished = true; decoder.wordFinished = addSpace;
  $('decodedText').textContent = decoder.text || '...';
  $('morseBuffer').textContent = '-'; $('bufferHint').textContent = 'Character complete';
  candidates();
}
function finishWord() {
  if (!decoder.characterFinished || decoder.wordFinished || !decoder.text || decoder.text.endsWith(' ')) return;
  decoder.text += ' ';
  decoder.wordFinished = true;
  $('decodedText').textContent = decoder.text;
}
function clearMorseBuffer(hint = 'Special gesture received') {
  decoder.buffer = ''; decoder.characterFinished = false; decoder.wordFinished = false;
  $('morseBuffer').textContent = '—'; $('bufferHint').textContent = hint; candidates();
}
function updateDoctorCallLink() {
  const number = ui.doctorNumber.value.trim();
  const dialable = number.replace(/[^0-9+*#]/g, '');
  const link = $('callDoctor');
  if (!dialable || dialable === '+') {
    link.removeAttribute('href'); link.classList.add('is-disabled'); link.setAttribute('aria-disabled', 'true'); link.textContent = 'Add a number to call';
    return;
  }
  link.href = `tel:${dialable}`; link.classList.remove('is-disabled'); link.setAttribute('aria-disabled', 'false'); link.textContent = `Call ${number}`;
}
function saveDoctorNumber() {
  localStorage.setItem(DOCTOR_NUMBER_STORAGE_KEY, ui.doctorNumber.value.trim());
  updateDoctorCallLink();
}
function triggerHungry() {
  gestures.lastShortTapAt = 0;
  decoder.text = 'HUNGRY';
  $('decodedText').textContent = decoder.text;
  clearMorseBuffer('Double press recognized · HUNGRY');
  updateDecoderStatus();
}
function triggerDoctorAlert() {
  gestures.longHoldTriggered = true; gestures.doctorAlertActive = true;
  decoder.text = 'CALL DOCTOR';
  $('decodedText').textContent = decoder.text;
  clearMorseBuffer('Five-second hold recognized · doctor alert');
  $('doctorAlert').hidden = false;
  document.body.classList.add('doctor-alert-active');
  updateDoctorCallLink();
}
function dismissDoctorAlert() {
  gestures.doctorAlertActive = false;
  $('doctorAlert').hidden = true;
  document.body.classList.remove('doctor-alert-active');
  updateGestureStatus();
}
function registerShortTap(heldMs, at) {
  if (heldMs > SHORT_TAP_MAX_MS) { gestures.lastShortTapAt = 0; return false; }
  if (gestures.lastShortTapAt && at - gestures.lastShortTapAt <= DOUBLE_TAP_WINDOW_MS) {
    triggerHungry();
    return true;
  }
  gestures.lastShortTapAt = at;
  return false;
}
function updateGestureStatus() {
  const s = settings(); const status = $('gestureStatus');
  if (!s.enabled) { gestures.lastShortTapAt = 0; status.textContent = 'Enable the voltage threshold to use special inputs.'; return; }
  if (gestures.doctorAlertActive) { status.textContent = 'Doctor assistance alert is active.'; return; }
  if (decoder.high && decoder.lastChange) {
    const held = Date.now() - decoder.lastChange;
    if (held >= DOCTOR_HOLD_MS && !gestures.longHoldTriggered) { triggerDoctorAlert(); status.textContent = 'Doctor assistance alert is active.'; return; }
    status.textContent = `Hold for doctor alert: ${(held / 1000).toFixed(1)} / 5.0 seconds.`;
    return;
  }
  if (gestures.lastShortTapAt) {
    const remaining = DOUBLE_TAP_WINDOW_MS - (Date.now() - gestures.lastShortTapAt);
    if (remaining > 0) { status.textContent = `Tap again within ${(remaining / 1000).toFixed(1)} seconds for HUNGRY.`; return; }
    gestures.lastShortTapAt = 0;
  }
  status.textContent = 'Ready: double short press for HUNGRY · five-second hold for doctor.';
}
function triggerHigh(voltage, s) {
  const pressLevel = Math.min(3.3, s.threshold + s.hysteresis / 2);
  const releaseLevel = Math.max(0, s.threshold - s.hysteresis / 2);
  return decoder.high ? voltage >= releaseLevel : voltage >= pressLevel;
}
function processMorse(voltage, at) {
  const s = settings();
  if (!s.enabled) return;
  const high = triggerHigh(voltage, s);
  if (gestures.doctorAlertActive) {
    if (!high) gestures.longHoldTriggered = false;
    decoder.high = high; decoder.lastChange = at;
    return;
  }
  if (!decoder.lastChange) { decoder.high = high; decoder.lastChange = at; return; }
  const elapsed = at - decoder.lastChange;
  if (high !== decoder.high) {
    if (decoder.high) {
      const longHoldRelease = gestures.longHoldTriggered;
      const hungryDoubleTap = !longHoldRelease && registerShortTap(elapsed, at);
      if (longHoldRelease) {
        gestures.longHoldTriggered = false;
        clearMorseBuffer(gestures.doctorAlertActive ? 'Doctor alert active' : 'Doctor hold released');
      } else if (hungryDoubleTap) {
        // triggerHungry() already cleared the active Morse sequence.
      } else {
        decoder.buffer += elapsed < s.dash ? '.' : '-';
        decoder.characterFinished = false; decoder.wordFinished = false;
        $('morseBuffer').textContent = decoder.buffer; $('bufferHint').textContent = elapsed < s.dash ? `DOT / ${Math.round(elapsed)} ms` : `DASH / ${Math.round(elapsed)} ms`;
        candidates();
      }
    } else if (decoder.buffer && !decoder.characterFinished) {
      if (elapsed >= s.wordGap) finishCharacter(true);
      else if (elapsed >= s.characterGap) finishCharacter();
    }
    decoder.high = high; decoder.lastChange = at;
  } else if (!high) {
    if (decoder.buffer && !decoder.characterFinished && elapsed >= s.characterGap) finishCharacter();
    if (decoder.characterFinished && elapsed >= s.wordGap) finishWord();
  }
}
function updateDecoderStatus() {
  const s = settings(); const state = $('signalState'), prediction = $('pressPrediction');
  if (!s.enabled) { state.className = ''; state.innerHTML = '<i></i>OFF'; prediction.textContent = 'Enable the threshold to begin decoding.'; $('triggerState').textContent = 'OFF'; $('triggerState').className = 'armed'; updateGestureStatus(); return; }
  const high = decoder.high; state.className = high ? 'active' : ''; state.innerHTML = `<i></i>${high ? 'PRESSED' : 'READY'}`;
  if (high && decoder.lastChange) { const held = Date.now() - decoder.lastChange; prediction.textContent = held < s.dash ? `Prediction: dot if released now (${Math.round(held)} ms).` : `Prediction: dash if released now (${Math.round(held)} ms).`; }
  else prediction.textContent = decoder.buffer ? 'Release gap determines when this character is translated.' : 'Waiting for the next threshold crossing.';
  const trigger = $('triggerState'); trigger.textContent = high ? 'TRIGGERED' : 'ARMED'; trigger.className = high ? 'triggered' : 'armed';
  const words = decoder.text.trim().split(/\s+/).filter(Boolean); const last = words.at(-1) || '';
  $('wordPrediction').textContent = last ? `Predictive context: current text ends in “${last}”.` : 'Waiting for a completed character...';
  updateGestureStatus();
}
function processReading(reading) {
  // ESP32 `millis()` is relative to boot; local time keeps chart and Morse
  // timing consistent after reconnects and page refreshes.
  const at = Date.now(); const rawVoltage = Number(reading.voltage);
  if (!Number.isFinite(rawVoltage)) return;
  const voltage = channelVoltage(rawVoltage, settings().channel);
  if (samples.length && at - samples.at(-1).at > 800) decoder.lastChange = at;
  samples.push({ voltage, rawVoltage, at }); if (samples.length > maxHistory) samples.splice(0, samples.length - maxHistory);
  sampleInterval = samples.length > 1 ? Math.max(1, Math.round((at - samples[0].at) / (samples.length - 1))) : sampleInterval;
  $('liveVoltage').innerHTML = `${voltage.toFixed(4)} <small>V</small>`; $('millivolts').textContent = Math.round(voltage * 1000); $('rawMillivolts').textContent = reading.millivolts ?? Math.round(rawVoltage * 1000);
  const recent = samples.filter((sample) => sample.at >= Date.now() - settings().xSeconds * 1000).map((sample) => sample.voltage);
  $('peakVoltage').innerHTML = `${Math.max(...recent, voltage).toFixed(3)} <small>V</small>`; $('lowVoltage').innerHTML = `${Math.min(...recent, voltage).toFixed(3)} <small>V</small>`;
  processMorse(voltage, at); updateDecoderStatus(); drawGraph();
}
function resetActiveCharacter() {
  decoder.high = false; decoder.lastChange = 0; decoder.buffer = ''; decoder.characterFinished = false; decoder.wordFinished = false;
  $('morseBuffer').textContent = '-'; $('bufferHint').textContent = 'No active character'; candidates();
}
function resetDecoder() {
  decoder = { high:false, lastChange:0, buffer:'', text:'', characterFinished:false, wordFinished:false };
  gestures = { lastShortTapAt:0, longHoldTriggered:false, doctorAlertActive:false };
  $('morseBuffer').textContent = '-'; $('decodedText').textContent = '...'; $('bufferHint').textContent = 'No active character';
  $('doctorAlert').hidden = true; document.body.classList.remove('doctor-alert-active'); candidates(); updateDecoderStatus();
}
function clearMessage() { decoder.text = ''; $('decodedText').textContent = '...'; updateDecoderStatus(); }
function undoMessage() {
  const trimmed = decoder.text.replace(/\s+$/, '');
  decoder.text = trimmed.slice(0, -1);
  $('decodedText').textContent = decoder.text || '...';
  updateDecoderStatus();
}
function changeChannel() {
  resetFilter(); samples.splice(0); resetActiveCharacter(); gestures.lastShortTapAt = 0; gestures.longHoldTriggered = false;
  $('liveVoltage').innerHTML = '0.0000 <small>V</small>';
  $('millivolts').textContent = '0'; $('rawMillivolts').textContent = '0';
  syncControls(); updateDecoderStatus();
}
function normalizeStreamUrl(value) {
  const candidate = value.trim();
  if (!candidate) return DEFAULT_STREAM_URL;
  try {
    const url = new URL(candidate.startsWith('http') ? candidate : `http://${candidate}`);
    if (!url.port) url.port = '81';
    if (url.pathname === '/') url.pathname = '/events';
    return url.toString().replace(/\/$/, '');
  } catch { return DEFAULT_STREAM_URL; }
}
function connectEvents() {
  if (events) events.close();
  $('connection').className = 'connection'; $('connection').innerHTML = '<i></i><span>CONNECTING TO ESP32</span>';
  ui.streamStatus.textContent = 'CONNECTING';
  events = new EventSource(streamUrl);
  events.addEventListener('reading', (event) => {
    const reading = JSON.parse(event.data);
    if (reading.receivedAt) {
      $('connection').className = 'connection live'; $('connection').innerHTML = '<i></i><span>ESP32 DIRECT STREAM</span>';
      ui.streamStatus.textContent = 'LIVE'; processReading(reading);
    }
  });
  events.onerror = () => {
    $('connection').className = 'connection'; $('connection').innerHTML = '<i></i><span>RECONNECTING</span>';
    ui.streamStatus.textContent = 'RETRYING';
  };
}
function saveStreamUrl() {
  streamUrl = normalizeStreamUrl(ui.streamUrl.value);
  ui.streamUrl.value = streamUrl;
  localStorage.setItem(STREAM_STORAGE_KEY, streamUrl);
  connectEvents();
}
[ui.yMin,ui.yMax,ui.xSeconds,ui.thresholdToggle,ui.thresholdInput,ui.hysteresisMv,ui.dashMs,ui.characterGapMs,ui.wordGapMs].forEach((element) => element.addEventListener('input', syncControls));
ui.filterChannel.addEventListener('change', changeChannel);
$('clearGraph').addEventListener('click', () => { samples.splice(0); drawGraph(); }); $('resetDecoder').addEventListener('click', resetDecoder); $('clearMessage').addEventListener('click', clearMessage); $('undoMessage').addEventListener('click', undoMessage); $('connectStream').addEventListener('click', saveStreamUrl); $('dismissDoctorAlert').addEventListener('click', dismissDoctorAlert); ui.doctorNumber.addEventListener('input', saveDoctorNumber); ui.streamUrl.addEventListener('keydown', (event) => { if (event.key === 'Enter') saveStreamUrl(); }); window.addEventListener('resize', drawGraph);
ui.streamUrl.value = streamUrl;
ui.doctorNumber.value = localStorage.getItem(DOCTOR_NUMBER_STORAGE_KEY) || '';
setInterval(updateDecoderStatus, 50); syncControls(); candidates(); updateDoctorCallLink(); updateGestureStatus(); connectEvents();
