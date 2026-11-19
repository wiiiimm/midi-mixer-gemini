(function () {
  'use strict';

  const {
    TRACK_GROUPS,
    INSTRUMENTS,
    KEY_TONIC_PC,
    parseMidiBuffer,
    buildBuiltInLibrary
  } = window.MidiMixerParser;

  const {
    midiToFreq,
    ensureAudioContext,
    getAudioContext,
    clearTrackGainNodes,
    getTrackGainNode,
    syncMixGains,
    playMetronomeClick,
    scheduleSynthNote,
    createLiveSustainedVoice,
    activePianoVoices
  } = window.MidiMixerAudio;

  const {
    PITCH_CLASS_SHARP,
    getTrackRowHeight,
    getStaffGutterWidth,
    formatNoteName,
    formatSolfege,
    secToX,
    xToTick,
    drawRulerCanvas,
    drawStaffCanvas
  } = window.MidiMixerScore;

  // =========================================================================
  // 1. STATE & QWERTY KEYBOARD MAP
  // =========================================================================
  const state = {
    songs: [],
    activeSongId: null,
    searchQuery: '',

    isPlaying: false,
    tempoRate: 1.0,
    masterVolume: 0.95,
    metronomeEnabled: false,

    playheadBaseSec: 0,
    startBaseSec: 0,

    loopEnabled: false,
    loopStartBaseSec: 0,
    loopEndBaseSec: 8,

    mutedGroups: new Set(),

    pixelsPerBeat: 58,
    zoomPercent: 100,
    pitchLabelMode: 'lyrics_notes',
    autoScroll: true,
    compactMixer: false,
    rulerClickMode: 'seek',
    scrollX: 0,
    scrollY: 0,

    renderedNoteHits: [],
    hoveredHit: null,

    pianoOpen: true,
    pianoInstrument: 'grand_piano',
    pianoVolume: 1.05,
    pianoQwertyOctave: 4,
    pianoViewBaseOctave: 3,
    pianoSustain: false,
    qwertyEnabled: true
  };

  const QWERTY_KEY_MAP = [
    { code: 'KeyA', semi: 0, label: 'A' },
    { code: 'KeyW', semi: 1, label: 'W' },
    { code: 'KeyS', semi: 2, label: 'S' },
    { code: 'KeyE', semi: 3, label: 'E' },
    { code: 'KeyD', semi: 4, label: 'D' },
    { code: 'KeyF', semi: 5, label: 'F' },
    { code: 'KeyT', semi: 6, label: 'T' },
    { code: 'KeyG', semi: 7, label: 'G' },
    { code: 'KeyY', semi: 8, label: 'Y' },
    { code: 'KeyH', semi: 9, label: 'H' },
    { code: 'KeyU', semi: 10, label: 'U' },
    { code: 'KeyJ', semi: 11, label: 'J' },
    { code: 'KeyK', semi: 12, label: 'K' },
    { code: 'KeyO', semi: 13, label: 'O' },
    { code: 'KeyL', semi: 14, label: 'L' },
    { code: 'KeyP', semi: 15, label: 'P' },
    { code: 'Semicolon', semi: 16, label: ';' },
    { code: 'Quote', semi: 17, label: "'" }
  ];
  const CODE_TO_SEMI = new Map(QWERTY_KEY_MAP.map(k => [k.code, k.semi]));
  let midiLitKeys = new Set();

  function getActiveSong() {
    return state.songs.find(s => s.id === state.activeSongId) || null;
  }

  function isTrackAudible(song, track) {
    if (!song || !track) return false;
    const anySolo = song.tracks.some(t => t.solo);
    if (anySolo) return track.solo;
    if (track.muted) return false;
    if (state.mutedGroups.has(track.group)) return false;
    return true;
  }

  function syncAllTrackGains() {
    syncMixGains(getActiveSong(), state.masterVolume, state.pianoVolume, isTrackAudible);
  }

  function showToast(message, kind = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const el = document.createElement('div');
    const colors = kind === 'error'
      ? 'bg-rose-950/95 border-rose-500/50 text-rose-100'
      : kind === 'success'
        ? 'bg-emerald-950/95 border-emerald-500/50 text-emerald-100'
        : 'bg-slate-900/95 border-sky-500/40 text-slate-100';
    el.className = `px-3.5 py-2.5 rounded-xl border text-xs font-medium shadow-xl transition-all duration-200 ${colors}`;
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(6px)';
      setTimeout(() => el.remove(), 220);
    }, 2800);
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // =========================================================================
  // 2. LOOKAHEAD PLAYBACK SCHEDULER
  // =========================================================================
  let schedulerTimer = null;
  let lastAudioClock = 0;
  let scheduledCursorBaseSec = 0;
  let scheduledBeatCursor = -1;
  const LOOKAHEAD_REAL_SEC = 0.11;

  function resetAudioSchedulingCursor(baseSec) {
    scheduledCursorBaseSec = baseSec - 0.0001;
    const song = getActiveSong();
    if (song) {
      const tick = song.secToTick(baseSec);
      scheduledBeatCursor = Math.floor(tick / song.ticksPerBeat) - 1;
    }
  }

  function schedulerStep() {
    const audioCtx = getAudioContext();
    if (!state.isPlaying || !audioCtx) return;
    const song = getActiveSong();
    if (!song) return;

    const now = audioCtx.currentTime;
    const realDt = Math.max(0, Math.min(0.15, now - lastAudioClock));
    lastAudioClock = now;

    state.playheadBaseSec += realDt * state.tempoRate;

    if (state.loopEnabled && state.loopEndBaseSec > state.loopStartBaseSec + 0.15) {
      if (state.playheadBaseSec >= state.loopEndBaseSec) {
        state.playheadBaseSec = state.loopStartBaseSec;
        resetAudioSchedulingCursor(state.playheadBaseSec);
      }
    }

    if (state.playheadBaseSec >= song.durationBaseSec) {
      if (state.loopEnabled && state.loopEndBaseSec > state.loopStartBaseSec + 0.15) {
        state.playheadBaseSec = state.loopStartBaseSec;
        resetAudioSchedulingCursor(state.playheadBaseSec);
      } else {
        stopPlayback(false);
        state.playheadBaseSec = state.startBaseSec;
        updateTransportUI();
        requestDraw();
        return;
      }
    }

    let windowEndBaseSec = state.playheadBaseSec + LOOKAHEAD_REAL_SEC * state.tempoRate;
    if (state.loopEnabled && state.loopEndBaseSec > state.loopStartBaseSec + 0.15) {
      windowEndBaseSec = Math.min(windowEndBaseSec, state.loopEndBaseSec);
    }

    if (windowEndBaseSec > scheduledCursorBaseSec) {
      for (const trk of song.tracks) {
        const notes = trk.notes;
        let lo = 0, hi = notes.length - 1, startIdx = notes.length;
        while (lo <= hi) {
          const mid = (lo + hi) >>> 1;
          if (notes[mid].startBaseSec > scheduledCursorBaseSec) {
            startIdx = mid;
            hi = mid - 1;
          } else {
            lo = mid + 1;
          }
        }
        for (let i = startIdx; i < notes.length; i++) {
          const n = notes[i];
          if (n.startBaseSec > windowEndBaseSec) break;
          const offsetReal = Math.max(0, (n.startBaseSec - state.playheadBaseSec) / state.tempoRate);
          const durReal = Math.max(0.045, n.durationBaseSec / state.tempoRate);
          scheduleSynthNote(trk, n.midi, n.velocity, now + offsetReal, durReal);
        }
      }

      if (state.metronomeEnabled) {
        const startTick = song.secToTick(Math.max(0, scheduledCursorBaseSec));
        const endTick = song.secToTick(windowEndBaseSec);
        const firstBeat = Math.max(scheduledBeatCursor + 1, Math.ceil(startTick / song.ticksPerBeat));
        const lastBeat = Math.floor(endTick / song.ticksPerBeat);
        for (let b = firstBeat; b <= lastBeat; b++) {
          const beatTick = b * song.ticksPerBeat;
          const beatBaseSec = song.tickToSec(beatTick);
          if (beatBaseSec > scheduledCursorBaseSec && beatBaseSec <= windowEndBaseSec) {
            const isBarStart = song.measures.some(m => Math.abs(m.startTick - beatTick) <= 4);
            const offsetReal = Math.max(0, (beatBaseSec - state.playheadBaseSec) / state.tempoRate);
            playMetronomeClick(now + offsetReal, isBarStart);
            scheduledBeatCursor = b;
          }
        }
      }

      scheduledCursorBaseSec = windowEndBaseSec;
    }
  }

  function startPlayback() {
    const song = getActiveSong();
    if (!song) return;
    const audioCtx = ensureAudioContext(state.masterVolume, state.pianoVolume);
    syncAllTrackGains();

    if (state.playheadBaseSec >= song.durationBaseSec - 0.05) {
      state.playheadBaseSec = state.startBaseSec;
    }
    if (state.loopEnabled && (state.playheadBaseSec < state.loopStartBaseSec || state.playheadBaseSec >= state.loopEndBaseSec)) {
      state.playheadBaseSec = state.loopStartBaseSec;
    }
    state.isPlaying = true;
    lastAudioClock = audioCtx.currentTime;
    resetAudioSchedulingCursor(state.playheadBaseSec);

    if (schedulerTimer) clearInterval(schedulerTimer);
    schedulerTimer = setInterval(schedulerStep, 25);
    schedulerStep();
    updateTransportUI();
    startAnimationLoop();
  }

  function pausePlayback() {
    state.isPlaying = false;
    if (schedulerTimer) {
      clearInterval(schedulerTimer);
      schedulerTimer = null;
    }
    updateTransportUI();
    requestDraw();
  }

  function stopPlayback(resetToStart = true) {
    pausePlayback();
    if (resetToStart) {
      state.playheadBaseSec = state.startBaseSec;
      if (state.autoScroll) scrollPlayheadIntoView(true);
    }
    updateTransportUI();
    requestDraw();
  }

  function seekToBaseSec(sec) {
    const song = getActiveSong();
    if (!song) return;
    state.playheadBaseSec = Math.max(0, Math.min(song.durationBaseSec, sec));
    const audioCtx = getAudioContext();
    if (state.isPlaying && audioCtx) {
      lastAudioClock = audioCtx.currentTime;
      resetAudioSchedulingCursor(state.playheadBaseSec);
    }
    updateTransportUI();
    requestDraw();
  }

  function auditionTrackPitch(track, overrideMidi) {
    const song = getActiveSong();
    if (!song || !track) return;
    const audioCtx = ensureAudioContext(state.masterVolume, state.pianoVolume);
    syncAllTrackGains();

    let pitch = overrideMidi;
    if (pitch == null) {
      const upcoming = track.notes.find(n => n.startBaseSec >= state.playheadBaseSec - 0.05) || track.notes[0];
      pitch = upcoming ? upcoming.midi : 60;
    }
    const gNode = getTrackGainNode(track);
    const wasSilent = !isTrackAudible(song, track);
    if (wasSilent && gNode) {
      gNode.gain.setTargetAtTime(Math.max(0.4, track.volume / 100), audioCtx.currentTime, 0.005);
      setTimeout(() => syncAllTrackGains(), 520);
    }
    scheduleSynthNote(track, pitch, 100, audioCtx.currentTime + 0.01, 0.45);
  }

  // =========================================================================
  // 3. VIRTUAL SOUND-CHECK PIANO LOGIC
  // =========================================================================
  function isBlackKey(midi) {
    const pc = ((midi % 12) + 12) % 12;
    return pc === 1 || pc === 3 || pc === 6 || pc === 8 || pc === 10;
  }

  function pressPianoKey(midi, sourceId) {
    if (midi < 21 || midi > 108) return;
    let entry = activePianoVoices.get(midi);
    if (entry && entry.sources.size === 1 && entry.sources.has('sustain') && sourceId !== 'sustain') {
      entry.stopFn(true);
      activePianoVoices.delete(midi);
      entry = null;
    }
    if (!entry) {
      const stopFn = createLiveSustainedVoice(midi, state.pianoInstrument, state.masterVolume, state.pianoVolume);
      const sources = new Set([sourceId]);
      if (state.pianoSustain) sources.add('sustain');
      activePianoVoices.set(midi, { stopFn, sources });
    } else {
      entry.sources.add(sourceId);
      if (state.pianoSustain) entry.sources.add('sustain');
    }
    updatePianoKeyVisuals();
    updatePianoReadout();
  }

  function releasePianoKey(midi, sourceId) {
    const entry = activePianoVoices.get(midi);
    if (!entry) return;
    entry.sources.delete(sourceId);
    if (entry.sources.size === 0) {
      entry.stopFn(false);
      activePianoVoices.delete(midi);
    }
    updatePianoKeyVisuals();
    updatePianoReadout();
  }

  function releaseAllPianoKeys(includeSustained = true) {
    for (const [midi, entry] of Array.from(activePianoVoices.entries())) {
      if (includeSustained) {
        entry.stopFn(false);
        activePianoVoices.delete(midi);
      } else {
        for (const s of Array.from(entry.sources)) {
          if (s !== 'sustain') entry.sources.delete(s);
        }
        if (entry.sources.size === 0) {
          entry.stopFn(false);
          activePianoVoices.delete(midi);
        }
      }
    }
    updatePianoKeyVisuals();
    updatePianoReadout();
  }

  function updatePianoReadout() {
    const readout = document.getElementById('pianoNoteReadout');
    const panicBtn = document.getElementById('btnPianoPanic');
    if (!readout) return;
    const activeMidis = Array.from(activePianoVoices.keys()).sort((a, b) => a - b);
    if (panicBtn) {
      panicBtn.classList.toggle('hidden', !(state.pianoSustain && activeMidis.length > 0));
    }
    if (activeMidis.length === 0) {
      readout.textContent = 'Click or type A–L to play';
      return;
    }
    const song = getActiveSong();
    const preferFlats = song ? song.keySf < 0 : false;
    if (activeMidis.length === 1) {
      const m = activeMidis[0];
      const hz = midiToFreq(m).toFixed(1);
      const solf = song ? ` · ${formatSolfege(m, song.keySf, KEY_TONIC_PC)}` : '';
      readout.textContent = `${formatNoteName(m, preferFlats)} · ${hz} Hz${solf}`;
    } else {
      readout.textContent = activeMidis.map(m => formatNoteName(m, preferFlats)).join(' + ');
    }
  }

  function renderPianoKeybed() {
    const bed = document.getElementById('pianoKeybed');
    if (!bed) return;

    if (state.pianoQwertyOctave < state.pianoViewBaseOctave) {
      state.pianoViewBaseOctave = state.pianoQwertyOctave;
    } else if (state.pianoQwertyOctave > state.pianoViewBaseOctave + 1) {
      state.pianoViewBaseOctave = Math.min(5, state.pianoQwertyOctave - 1);
    }

    const startMidi = (state.pianoViewBaseOctave + 1) * 12;
    const endMidi = startMidi + 36;
    const qwertyStartMidi = (state.pianoQwertyOctave + 1) * 12;

    const midiToKeycap = new Map();
    if (state.qwertyEnabled) {
      for (const k of QWERTY_KEY_MAP) {
        midiToKeycap.set(qwertyStartMidi + k.semi, k.label);
      }
    }

    const whiteMidis = [];
    for (let m = startMidi; m <= endMidi; m++) {
      if (!isBlackKey(m)) whiteMidis.push(m);
    }
    const totalWhites = whiteMidis.length;
    const whiteWidthPct = 100 / totalWhites;
    const blackWidthPct = whiteWidthPct * 0.62;

    let html = '';
    for (const m of whiteMidis) {
      const pc = m % 12;
      const oct = Math.floor(m / 12) - 1;
      const isC = pc === 0;
      const isA440 = m === 69;
      const noteLbl = PITCH_CLASS_SHARP[pc] + oct;
      const keycap = midiToKeycap.get(m) || '';
      const inQwertyZone = m >= qwertyStartMidi && m <= qwertyStartMidi + 17 && state.qwertyEnabled;

      html += `
        <div data-piano-midi="${m}" style="width:${whiteWidthPct.toFixed(4)}%" class="piano-white-key flex flex-col items-center justify-between py-1.5 ${inQwertyZone ? 'is-qwerty-zone' : ''}">
          <span class="text-[10px] font-mono font-bold ${keycap ? 'px-1 py-0.2 rounded bg-slate-200/90 text-slate-700' : 'opacity-0'}">${escapeHtml(keycap || '.')}</span>
          <div class="flex flex-col items-center leading-tight">
            ${isA440 ? '<span class="text-[8px] font-bold text-amber-600">440</span>' : ''}
            <span class="text-[10px] ${isC ? 'font-bold text-sky-700' : 'font-medium text-slate-500'}">${noteLbl}</span>
          </div>
        </div>
      `;
    }

    let whiteIndexSoFar = 0;
    for (let m = startMidi; m <= endMidi; m++) {
      if (!isBlackKey(m)) {
        whiteIndexSoFar++;
      } else {
        const leftPct = whiteIndexSoFar * whiteWidthPct - blackWidthPct / 2;
        const keycap = midiToKeycap.get(m) || '';
        const pc = m % 12;
        html += `
          <div data-piano-midi="${m}" style="left:${leftPct.toFixed(4)}%; width:${blackWidthPct.toFixed(4)}%" class="piano-black-key flex flex-col items-center justify-between py-1">
            <span class="text-[9px] font-mono font-bold ${keycap ? 'text-sky-300' : 'opacity-0'}">${escapeHtml(keycap || '.')}</span>
            <span class="text-[8px] text-slate-400 font-medium">${PITCH_CLASS_SHARP[pc]}</span>
          </div>
        `;
      }
    }

    bed.innerHTML = html;

    const qLow = formatNoteName(qwertyStartMidi, false);
    const qHigh = formatNoteName(qwertyStartMidi + 17, false);
    const octReadout = document.getElementById('pianoOctaveReadout');
    if (octReadout) octReadout.textContent = `Keys: ${qLow}–${qHigh}`;

    updatePianoKeyVisuals();
  }

  function updatePianoKeyVisuals() {
    const bed = document.getElementById('pianoKeybed');
    if (!bed) return;
    bed.querySelectorAll('[data-piano-midi]').forEach(el => {
      const m = parseInt(el.getAttribute('data-piano-midi'), 10);
      el.classList.toggle('is-active', activePianoVoices.has(m));
      el.classList.toggle('is-midi-lit', midiLitKeys.has(m) && !activePianoVoices.has(m));
    });
  }

  // =========================================================================
  // 4. SCORE DRAWING, ANIMATION & DOM RENDERERS
  // =========================================================================
  let rafId = null;
  let drawQueued = false;

  function renderBothCanvases() {
    const song = getActiveSong();
    if (!song) return;
    drawRulerCanvas(document.getElementById('rulerCanvas'), song, state);
    drawStaffCanvas(document.getElementById('staffCanvas'), song, state, isTrackAudible, KEY_TONIC_PC);
    updateVuMetersDOM();

    const nextLit = new Set();
    if (state.isPlaying && state.pianoOpen) {
      for (const trk of song.tracks) {
        if (!isTrackAudible(song, trk) || trk.clef === 'percussion' || trk.instrument === 'drums') continue;
        for (const n of trk.notes) {
          if (n.startBaseSec > state.playheadBaseSec) break;
          if (state.playheadBaseSec >= n.startBaseSec && state.playheadBaseSec <= n.endBaseSec) {
            nextLit.add(n.midi);
          }
        }
      }
    }
    if (nextLit.size !== midiLitKeys.size || Array.from(nextLit).some(k => !midiLitKeys.has(k))) {
      midiLitKeys = nextLit;
      updatePianoKeyVisuals();
    }
  }

  function requestDraw() {
    if (drawQueued) return;
    drawQueued = true;
    requestAnimationFrame(() => {
      drawQueued = false;
      renderBothCanvases();
    });
  }

  function startAnimationLoop() {
    if (rafId) cancelAnimationFrame(rafId);
    function tickFrame() {
      if (!state.isPlaying) {
        rafId = null;
        renderBothCanvases();
        return;
      }
      if (state.autoScroll) {
        scrollPlayheadIntoView(false);
      }
      updateTransportReadoutOnly();
      renderBothCanvases();
      rafId = requestAnimationFrame(tickFrame);
    }
    rafId = requestAnimationFrame(tickFrame);
  }

  function updateHorizontalScrollExtent() {
    const song = getActiveSong();
    const inner = document.getElementById('scoreHScrollInner');
    const viewport = document.getElementById('scoreViewport');
    if (!song || !inner || !viewport) return;
    const gutterW = getStaffGutterWidth(song);
    const totalBeats = song.totalTicks / song.ticksPerBeat + 6;
    const contentWidth = Math.max(viewport.clientWidth, gutterW + 48 + totalBeats * state.pixelsPerBeat);
    inner.style.width = `${Math.round(contentWidth)}px`;
  }

  function scrollPlayheadIntoView(forceCenter = false) {
    const song = getActiveSong();
    const hScroll = document.getElementById('scoreHScroll');
    const container = document.getElementById('staffCanvasContainer');
    if (!song || !hScroll || !container) return;
    const gutterW = getStaffGutterWidth(song);
    const viewW = container.clientWidth;
    const usableW = Math.max(120, viewW - gutterW);
    const x = secToX(song, state.playheadBaseSec, state.pixelsPerBeat, state.scrollX, gutterW);

    if (forceCenter || x > viewW - 70 || x < gutterW + 10) {
      const tick = song.secToTick(state.playheadBaseSec);
      const rawX = (tick / song.ticksPerBeat) * state.pixelsPerBeat;
      const targetScroll = Math.max(0, rawX - usableW * (forceCenter ? 0.25 : 0.18));
      state.scrollX = targetScroll;
      hScroll.scrollLeft = targetScroll;
    }
  }

  function formatClock(sec, showTenths) {
    const s = Math.max(0, sec);
    const mins = Math.floor(s / 60);
    const rem = s - mins * 60;
    if (showTenths) {
      const whole = Math.floor(rem);
      const tenth = Math.floor((rem - whole) * 10);
      return `${mins}:${String(whole).padStart(2, '0')}.${tenth}`;
    }
    return `${mins}:${String(Math.floor(rem)).padStart(2, '0')}`;
  }

  function findMeasureAndBeat(song, baseSec) {
    if (!song || !song.measures.length) return { measure: 1, beat: 1 };
    const tick = song.secToTick(baseSec);
    let chosen = song.measures[0];
    for (const m of song.measures) {
      if (m.startTick <= tick + 1) chosen = m;
      else break;
    }
    const beatInBar = Math.min(
      chosen.num,
      Math.max(1, Math.floor((tick - chosen.startTick) / chosen.beatTicks) + 1)
    );
    return { measure: chosen.number, beat: beatInBar };
  }

  function updateTransportReadoutOnly() {
    const song = getActiveSong();
    if (!song) return;
    const mb = findMeasureAndBeat(song, state.playheadBaseSec);
    const mbEl = document.getElementById('measureBeatReadout');
    const tmEl = document.getElementById('timeReadout');
    if (mbEl) mbEl.textContent = `M ${String(mb.measure).padStart(2, '0')} : ${mb.beat}`;
    if (tmEl) {
      const scaledCur = state.playheadBaseSec / state.tempoRate;
      const scaledTot = song.durationBaseSec / state.tempoRate;
      tmEl.textContent = `${formatClock(scaledCur, true)} / ${formatClock(scaledTot, false)}`;
    }
  }

  function updateTransportUI() {
    const song = getActiveSong();
    const iconPlay = document.getElementById('iconPlay');
    const iconPause = document.getElementById('iconPause');
    const playLabel = document.getElementById('playBtnLabel');
    const btnPlay = document.getElementById('btnPlayPause');

    if (state.isPlaying) {
      iconPlay.classList.add('hidden');
      iconPause.classList.remove('hidden');
      playLabel.textContent = 'Pause';
      btnPlay.className = 'px-3.5 py-2 rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold text-xs flex items-center gap-1.5 shadow-sm transition-colors';
    } else {
      iconPlay.classList.remove('hidden');
      iconPause.classList.add('hidden');
      playLabel.textContent = 'Play';
      btnPlay.className = 'px-3.5 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 shadow-sm transition-colors';
    }

    document.getElementById('btnMetronome').className = state.metronomeEnabled
      ? 'px-2 py-1.5 rounded-lg text-[11px] font-semibold bg-sky-500/25 text-sky-200 border border-sky-500/40 flex items-center gap-1 transition-colors'
      : 'px-2 py-1.5 rounded-lg text-[11px] font-medium text-slate-400 hover:text-white hover:bg-slate-800 flex items-center gap-1 transition-colors';

    document.getElementById('btnLoopToggle').className = state.loopEnabled
      ? 'px-2.5 py-1 rounded-lg bg-cyan-500 text-slate-950 text-xs font-bold flex items-center gap-1 shadow-sm transition-colors'
      : 'px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold flex items-center gap-1 transition-colors';

    if (song) {
      document.getElementById('activeSongTitle').textContent = song.title;
      document.getElementById('activeSongMeta').textContent = `${song.timeSigLabel} · ${song.keyLabel} · ${song.measures.length} bars`;

      const effBpm = Math.round(song.baseBpm * state.tempoRate);
      const pct = Math.round(state.tempoRate * 100);
      document.getElementById('tempoReadout').textContent = `${effBpm} BPM (${pct}%)`;
      document.getElementById('tempoSlider').value = String(pct);

      document.querySelectorAll('[data-tempo-preset]').forEach(btn => {
        const val = parseInt(btn.getAttribute('data-tempo-preset'), 10);
        btn.className = val === pct
          ? 'px-1.5 py-1 rounded text-[11px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/40'
          : 'px-1.5 py-1 rounded text-[11px] font-medium bg-slate-900 hover:bg-slate-800 text-slate-300';
      });

      const startM = findMeasureAndBeat(song, state.startBaseSec).measure;
      const loopAM = findMeasureAndBeat(song, state.loopStartBaseSec).measure;
      const loopBM = Math.max(loopAM + 1, findMeasureAndBeat(song, Math.max(0, state.loopEndBaseSec - 0.02)).measure + 1);
      document.getElementById('startMeasureInput').value = String(startM);
      document.getElementById('loopStartMeasure').value = String(loopAM);
      document.getElementById('loopEndMeasure').value = String(Math.min(song.measures.length + 1, loopBM));
    }
    updateTransportReadoutOnly();
  }

  function renderSidebarList() {
    const listEl = document.getElementById('midiFileList');
    document.getElementById('playlistCountBadge').textContent = String(state.songs.length);

    const q = state.searchQuery.trim().toLowerCase();
    const filtered = state.songs.filter(s => !q || s.title.toLowerCase().includes(q));

    if (!filtered.length) {
      listEl.innerHTML = `<div class="p-4 text-center text-xs text-slate-500">No matching MIDI files.</div>`;
      return;
    }

    listEl.innerHTML = filtered.map(s => {
      const active = s.id === state.activeSongId;
      return `
        <div data-midi-id="${s.id}" class="group rounded-xl px-3 py-2.5 cursor-pointer border transition-all flex items-start justify-between gap-2 ${
          active
            ? 'bg-sky-500/15 border-sky-500/50 text-white shadow-sm'
            : 'bg-slate-950/40 border-transparent hover:bg-slate-800/70 hover:border-slate-700 text-slate-300'
        }">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1.5">
              <span class="w-2 h-2 rounded-full shrink-0 ${active ? 'bg-emerald-400' : 'bg-slate-600'}"></span>
              <span class="text-xs font-semibold truncate">${escapeHtml(s.title)}</span>
            </div>
            <div class="mt-1 flex items-center gap-2 text-[11px] text-slate-400 pl-3.5">
              <span>${s.tracks.length} tracks</span>
              <span>·</span>
              <span>${s.baseBpm} BPM</span>
              <span>·</span>
              <span>${s.timeSigLabel}</span>
            </div>
          </div>
          ${state.songs.length > 1 ? `
            <button type="button" data-delete-midi="${s.id}" class="opacity-60 group-hover:opacity-100 p-1 rounded hover:bg-rose-500/20 hover:text-rose-300 text-slate-400 transition-opacity" title="Remove from playlist">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
          ` : ''}
        </div>
      `;
    }).join('');
  }

  function renderGroupControlsBar() {
    const song = getActiveSong();
    const bar = document.getElementById('groupControlsBar');
    if (!song || !bar) return;

    const presentGroups = TRACK_GROUPS.filter(g => song.tracks.some(t => t.group === g));
    bar.innerHTML = presentGroups.map(group => {
      const tracksInGroup = song.tracks.filter(t => t.group === group);
      const groupMuted = state.mutedGroups.has(group) || tracksInGroup.every(t => t.muted);
      const groupSolo = tracksInGroup.length > 0 && tracksInGroup.every(t => t.solo);
      return `
        <div class="inline-flex items-center rounded-lg bg-slate-950 border border-slate-800 overflow-hidden text-[11px]">
          <span class="px-2 py-1 text-slate-300 font-medium">${escapeHtml(group)} <span class="text-slate-500">(${tracksInGroup.length})</span></span>
          <button type="button" data-group-solo="${escapeHtml(group)}" class="px-1.5 py-1 border-l border-slate-800 font-bold transition-colors ${
            groupSolo ? 'bg-amber-400 text-slate-950' : 'text-slate-400 hover:bg-slate-800 hover:text-amber-300'
          }" title="Solo entire ${escapeHtml(group)} group">S</button>
          <button type="button" data-group-mute="${escapeHtml(group)}" class="px-1.5 py-1 border-l border-slate-800 font-bold transition-colors ${
            groupMuted ? 'bg-rose-500 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-rose-300'
          }" title="Mute / Unmute entire ${escapeHtml(group)} group">M</button>
        </div>
      `;
    }).join('');

    const checkedCount = song.tracks.filter(t => t.checked).length;
    document.getElementById('selectedCountBadge').textContent = String(checkedCount);
    document.getElementById('chkSelectAllTracks').checked = song.tracks.length > 0 && checkedCount === song.tracks.length;
  }

  function renderTrackMixerList() {
    const song = getActiveSong();
    const container = document.getElementById('trackMixerList');
    const countLabel = document.getElementById('activeTrackCountLabel');
    if (!song || !container) return;

    countLabel.textContent = `${song.tracks.length} tracks`;

    if (state.compactMixer) {
      container.innerHTML = song.tracks.map(trk => {
        const audible = isTrackAudible(song, trk);
        const rowH = getTrackRowHeight(trk);
        return `
          <div style="height:${rowH}px" class="track-row-card px-2.5 py-2.5 flex flex-col justify-between ${audible ? 'bg-slate-900' : 'bg-slate-950/80 opacity-75'}">
            <div class="flex items-center gap-1.5 min-w-0">
              <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background:${trk.color.hex}"></span>
              <span class="text-xs font-semibold text-white truncate">${escapeHtml(trk.name)}</span>
            </div>
            <div class="flex items-center gap-1">
              <button type="button" data-track-solo="${trk.id}" class="flex-1 py-1 rounded text-[11px] font-bold ${
                trk.solo ? 'bg-amber-400 text-slate-950' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }">S</button>
              <button type="button" data-track-mute="${trk.id}" class="flex-1 py-1 rounded text-[11px] font-bold ${
                trk.muted || state.mutedGroups.has(trk.group) ? 'bg-rose-500 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }">M</button>
              <button type="button" data-track-ping="${trk.id}" class="px-1.5 py-1 rounded bg-slate-800 hover:bg-sky-500/25 text-sky-300 text-[11px]" title="Hear starting note">♪</button>
            </div>
            <input type="range" min="0" max="150" value="${trk.volume}" data-track-vol="${trk.id}" class="studio-slider vol-slider w-full" title="Track Volume ${trk.volume}%" />
          </div>
        `;
      }).join('');
      return;
    }

    container.innerHTML = song.tracks.map(trk => {
      const audible = isTrackAudible(song, trk);
      const groupMuted = state.mutedGroups.has(trk.group);
      const rowH = getTrackRowHeight(trk);
      const instOptions = INSTRUMENTS.map(inst =>
        `<option value="${inst.id}" ${trk.instrument === inst.id ? 'selected' : ''}>${inst.label}</option>`
      ).join('');

      return `
        <div style="height:${rowH}px" class="track-row-card px-3 py-2.5 flex flex-col justify-between transition-colors ${
          audible ? 'bg-slate-900' : 'bg-slate-950/90'
        }">
          <div class="flex items-center justify-between gap-1.5">
            <div class="flex items-center gap-1.5 min-w-0">
              <input type="checkbox" data-track-check="${trk.id}" ${trk.checked ? 'checked' : ''} class="rounded border-slate-600 bg-slate-950 text-sky-500 focus:ring-0 cursor-pointer shrink-0" title="Select track for group mute/solo" />
              <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background:${trk.color.hex}"></span>
              <span class="text-xs font-semibold truncate ${audible ? 'text-white' : 'text-slate-400 line-through'}" title="${escapeHtml(trk.name)}">${escapeHtml(trk.name)}</span>
            </div>

            <div class="flex items-center gap-1 shrink-0">
              <button type="button" data-track-ping="${trk.id}" class="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-sky-500/25 text-sky-300 text-[11px] font-semibold transition-colors" title="Audition reference note for this track">
                ♪ Pitch
              </button>
              <button type="button" data-track-solo="${trk.id}" class="w-6 h-6 rounded text-[11px] font-bold transition-colors ${
                trk.solo ? 'bg-amber-400 text-slate-950 shadow-sm' : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
              }" title="Solo Track">S</button>
              <button type="button" data-track-mute="${trk.id}" class="w-6 h-6 rounded text-[11px] font-bold transition-colors ${
                trk.muted || groupMuted ? 'bg-rose-500 text-white shadow-sm' : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
              }" title="Mute Track">M</button>
            </div>
          </div>

          <div class="flex items-center gap-1.5">
            <select data-track-inst="${trk.id}" class="flex-1 min-w-0 bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-[11px] text-slate-200 focus:outline-none focus:border-sky-500" title="Change Playback Instrument">
              ${instOptions}
            </select>
            <select data-track-clef="${trk.id}" class="w-[88px] shrink-0 bg-slate-950 border border-slate-800 rounded-lg px-1.5 py-1 text-[11px] text-slate-300 focus:outline-none focus:border-sky-500" title="Staff Clef">
              <option value="treble" ${trk.clef === 'treble' ? 'selected' : ''}>Treble</option>
              <option value="treble8vb" ${trk.clef === 'treble8vb' ? 'selected' : ''}>Tenor 8vb</option>
              <option value="bass" ${trk.clef === 'bass' ? 'selected' : ''}>Bass</option>
              <option value="grand" ${trk.clef === 'grand' ? 'selected' : ''}>Grand Staff</option>
              <option value="percussion" ${trk.clef === 'percussion' ? 'selected' : ''}>Percussion</option>
            </select>
          </div>

          <div class="flex items-center gap-2">
            <button type="button" data-track-group="${trk.id}" class="px-1.5 py-0.5 rounded border text-[10px] font-medium shrink-0 ${trk.color.badge}" title="Click to change track group category">
              ${escapeHtml(trk.group)}
            </button>
            <input type="range" min="0" max="150" value="${trk.volume}" data-track-vol="${trk.id}" class="studio-slider vol-slider flex-1 min-w-0" title="Track Volume (0% - 150%)" />
            <span data-vol-label="${trk.id}" class="text-[11px] font-mono text-slate-300 w-9 text-right shrink-0">${trk.volume}%</span>
          </div>

          <div class="h-1 w-full bg-slate-950 rounded-full overflow-hidden">
            <div data-vu-bar="${trk.id}" class="h-full transition-all duration-75 rounded-full" style="width:0%; background:${trk.color.glow}"></div>
          </div>
        </div>
      `;
    }).join('');
  }

  function updateVuMetersDOM() {
    const song = getActiveSong();
    if (!song) return;
    for (const trk of song.tracks) {
      const bar = document.querySelector(`[data-vu-bar="${trk.id}"]`);
      if (bar) bar.style.width = `${Math.round(trk.vuLevel)}%`;
    }
  }

  // =========================================================================
  // 5. LOCAL BROWSER INDEXEDDB STORAGE (ZERO CLOUD) & SONG LOADING
  // =========================================================================
  const LOCAL_DB_NAME = 'MidiMixerBrowserDB';
  const LOCAL_STORE_NAME = 'midiFiles';

  function openLocalMidiDB() {
    return new Promise((resolve, reject) => {
      try {
        if (!window.indexedDB) return reject(new Error('IndexedDB unavailable'));
        const req = window.indexedDB.open(LOCAL_DB_NAME, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(LOCAL_STORE_NAME)) {
            db.createObjectStore(LOCAL_STORE_NAME, { keyPath: 'storageKey' });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error('DB open blocked'));
      } catch (err) {
        reject(err);
      }
    });
  }

  async function saveMidiToBrowserDB(storageKey, fileName, arrayBuffer) {
    try {
      const db = await openLocalMidiDB();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(LOCAL_STORE_NAME, 'readwrite');
        tx.objectStore(LOCAL_STORE_NAME).put({
          storageKey,
          fileName,
          bytes: new Uint8Array(arrayBuffer),
          savedAt: Date.now()
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
      updateClearCacheButtonVisibility();
    } catch (_e) {}
  }

  async function removeMidiFromBrowserDB(storageKey) {
    if (!storageKey) return;
    try {
      const db = await openLocalMidiDB();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(LOCAL_STORE_NAME, 'readwrite');
        tx.objectStore(LOCAL_STORE_NAME).delete(storageKey);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
      updateClearCacheButtonVisibility();
    } catch (_e) {}
  }

  async function clearAllBrowserDBMidis() {
    try {
      const db = await openLocalMidiDB();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(LOCAL_STORE_NAME, 'readwrite');
        tx.objectStore(LOCAL_STORE_NAME).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    } catch (_e) {}
    state.songs = state.songs.filter(s => !s.storageKey);
    if (!state.songs.length) state.songs = buildBuiltInLibrary();
    selectSong(state.songs[0].id);
    updateClearCacheButtonVisibility();
    showToast('Cleared browser-saved MIDI files.');
  }

  async function restoreMidisFromBrowserDB() {
    try {
      const db = await openLocalMidiDB();
      const records = await new Promise((resolve, reject) => {
        const tx = db.transaction(LOCAL_STORE_NAME, 'readonly');
        const req = tx.objectStore(LOCAL_STORE_NAME).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
      db.close();
      records.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
      let restored = 0;
      for (const rec of records) {
        try {
          const u8 = rec.bytes instanceof Uint8Array ? rec.bytes : new Uint8Array(rec.bytes);
          const buf = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
          const parsed = parseMidiBuffer(buf, rec.fileName);
          parsed.storageKey = rec.storageKey;
          state.songs.unshift(parsed);
          restored++;
        } catch (_parseErr) {}
      }
      if (restored > 0) selectSong(state.songs[0].id);
      updateClearCacheButtonVisibility();
    } catch (_e) {}
  }

  function updateClearCacheButtonVisibility() {
    const btn = document.getElementById('btnClearLocalCache');
    if (!btn) return;
    const hasUserSaved = state.songs.some(s => Boolean(s.storageKey));
    btn.classList.toggle('hidden', !hasUserSaved);
  }

  function selectSong(songId) {
    const wasPlaying = state.isPlaying;
    stopPlayback(false);
    clearTrackGainNodes();

    state.activeSongId = songId;
    const song = getActiveSong();
    if (!song) return;

    state.mutedGroups.clear();
    state.playheadBaseSec = 0;
    state.startBaseSec = 0;
    state.scrollX = 0;
    state.scrollY = 0;

    const m4Idx = Math.min(song.measures.length - 1, 3);
    state.loopStartBaseSec = 0;
    state.loopEndBaseSec = song.measures[m4Idx] ? song.measures[m4Idx].endBaseSec : Math.min(8, song.durationBaseSec);

    const mixerEl = document.getElementById('trackMixerList');
    const hScroll = document.getElementById('scoreHScroll');
    if (mixerEl) mixerEl.scrollTop = 0;
    if (hScroll) hScroll.scrollLeft = 0;

    renderSidebarList();
    renderGroupControlsBar();
    renderTrackMixerList();
    updateHorizontalScrollExtent();
    updateTransportUI();
    updatePianoReadout();
    syncAllTrackGains();
    requestDraw();

    if (wasPlaying) startPlayback();
  }

  async function handleMidiFileUploads(fileList, fromFolder = false) {
    if (!fileList || !fileList.length) return;
    let addedCount = 0;
    let firstNewId = null;

    const candidates = Array.from(fileList).filter(f => {
      if (!fromFolder) return true;
      return /\.(mid|midi|kar)$/i.test(f.name);
    });

    if (fromFolder && candidates.length === 0) {
      showToast('No .mid or .midi files found in that folder.', 'error');
      return;
    }

    for (const file of candidates) {
      try {
        const buf = await file.arrayBuffer();
        const parsed = parseMidiBuffer(buf, file.name);
        const storageKey = `local_${file.name}_${file.size}`;
        parsed.storageKey = storageKey;
        state.songs = state.songs.filter(s => s.storageKey !== storageKey);
        state.songs.unshift(parsed);
        await saveMidiToBrowserDB(storageKey, file.name, buf);
        if (!firstNewId) firstNewId = parsed.id;
        addedCount++;
      } catch (err) {
        if (!fromFolder) {
          showToast(`Could not parse "${file.name}": ${err.message}`, 'error');
        }
      }
    }

    if (addedCount > 0 && firstNewId) {
      selectSong(firstNewId);
      updateClearCacheButtonVisibility();
      showToast(`Loaded ${addedCount} local MIDI ${addedCount === 1 ? 'file' : 'files'}!`, 'success');
      closeMobileSidebar();
    }
  }

  function openMobileSidebar() {
    document.getElementById('librarySidebar').classList.remove('-translate-x-full');
    document.getElementById('sidebarBackdrop').classList.remove('hidden');
  }

  function closeMobileSidebar() {
    document.getElementById('librarySidebar').classList.add('-translate-x-full');
    document.getElementById('sidebarBackdrop').classList.add('hidden');
  }

  // =========================================================================
  // 6. EVENT WIRING
  // =========================================================================
  function bindEvents() {
    document.getElementById('btnToggleSidebar').addEventListener('click', openMobileSidebar);
    document.getElementById('btnCloseSidebar').addEventListener('click', closeMobileSidebar);
    document.getElementById('sidebarBackdrop').addEventListener('click', closeMobileSidebar);

    const fileInput = document.getElementById('midiFileInput');
    document.getElementById('btnUploadMidi').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', e => {
      handleMidiFileUploads(e.target.files, false);
      fileInput.value = '';
    });

    const folderInput = document.getElementById('midiFolderInput');
    document.getElementById('btnUploadFolder').addEventListener('click', () => folderInput.click());
    folderInput.addEventListener('change', e => {
      handleMidiFileUploads(e.target.files, true);
      folderInput.value = '';
    });

    document.getElementById('btnClearLocalCache').addEventListener('click', () => {
      clearAllBrowserDBMidis();
    });

    let dragDepth = 0;
    const dropOverlay = document.getElementById('dropOverlay');
    window.addEventListener('dragenter', e => {
      e.preventDefault();
      dragDepth++;
      dropOverlay.classList.remove('hidden');
    });
    window.addEventListener('dragover', e => e.preventDefault());
    window.addEventListener('dragleave', e => {
      e.preventDefault();
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) dropOverlay.classList.add('hidden');
    });
    window.addEventListener('drop', e => {
      e.preventDefault();
      dragDepth = 0;
      dropOverlay.classList.add('hidden');
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
        handleMidiFileUploads(e.dataTransfer.files, false);
      }
    });

    document.getElementById('midiSearchInput').addEventListener('input', e => {
      state.searchQuery = e.target.value;
      renderSidebarList();
    });

    document.getElementById('midiFileList').addEventListener('click', e => {
      const delBtn = e.target.closest('[data-delete-midi]');
      if (delBtn) {
        e.stopPropagation();
        const delId = delBtn.getAttribute('data-delete-midi');
        if (state.songs.length <= 1) return;
        const targetSong = state.songs.find(s => s.id === delId);
        if (targetSong && targetSong.storageKey) {
          removeMidiFromBrowserDB(targetSong.storageKey);
        }
        state.songs = state.songs.filter(s => s.id !== delId);
        if (state.activeSongId === delId) selectSong(state.songs[0].id);
        else renderSidebarList();
        return;
      }
      const card = e.target.closest('[data-midi-id]');
      if (card) {
        const id = card.getAttribute('data-midi-id');
        if (id !== state.activeSongId) selectSong(id);
        closeMobileSidebar();
      }
    });

    // Transport
    document.getElementById('btnPlayPause').addEventListener('click', () => {
      if (state.isPlaying) pausePlayback();
      else startPlayback();
    });
    document.getElementById('btnStop').addEventListener('click', () => stopPlayback(true));
    document.getElementById('btnReturnStart').addEventListener('click', () => {
      seekToBaseSec(state.startBaseSec);
      if (state.autoScroll) scrollPlayheadIntoView(true);
    });
    document.getElementById('btnMetronome').addEventListener('click', () => {
      state.metronomeEnabled = !state.metronomeEnabled;
      if (state.isPlaying) resetAudioSchedulingCursor(state.playheadBaseSec);
      updateTransportUI();
    });

    // Tempo
    function setTempoPercent(pct) {
      const clamped = Math.max(25, Math.min(200, Math.round(pct / 5) * 5));
      state.tempoRate = clamped / 100;
      const audioCtx = getAudioContext();
      if (state.isPlaying && audioCtx) {
        lastAudioClock = audioCtx.currentTime;
      }
      updateTransportUI();
    }
    document.getElementById('tempoSlider').addEventListener('input', e => {
      setTempoPercent(parseInt(e.target.value, 10) || 100);
    });
    document.getElementById('btnTempoDown').addEventListener('click', () => {
      setTempoPercent(Math.round(state.tempoRate * 100) - 5);
    });
    document.getElementById('btnTempoUp').addEventListener('click', () => {
      setTempoPercent(Math.round(state.tempoRate * 100) + 5);
    });
    document.getElementById('tempoPresetsGroup').addEventListener('click', e => {
      const btn = e.target.closest('[data-tempo-preset]');
      if (btn) setTempoPercent(parseInt(btn.getAttribute('data-tempo-preset'), 10));
    });

    // Start Cue & Loop
    document.getElementById('startMeasureInput').addEventListener('change', e => {
      const song = getActiveSong();
      if (!song) return;
      const mNum = Math.max(1, Math.min(song.measures.length, parseInt(e.target.value, 10) || 1));
      const m = song.measures[mNum - 1];
      if (m) {
        state.startBaseSec = m.startBaseSec;
        seekToBaseSec(m.startBaseSec);
        scrollPlayheadIntoView(true);
      }
    });
    document.getElementById('btnSetStartAtPlayhead').addEventListener('click', () => {
      state.startBaseSec = state.playheadBaseSec;
      updateTransportUI();
      requestDraw();
      showToast('Pinned Start Cue at current playhead position.');
    });

    document.getElementById('btnLoopToggle').addEventListener('click', () => {
      state.loopEnabled = !state.loopEnabled;
      updateTransportUI();
      requestDraw();
    });
    document.getElementById('btnSetLoopA').addEventListener('click', () => {
      const song = getActiveSong();
      if (!song) return;
      state.loopStartBaseSec = state.playheadBaseSec;
      if (state.loopEndBaseSec <= state.loopStartBaseSec + 0.3) {
        state.loopEndBaseSec = Math.min(song.durationBaseSec, state.loopStartBaseSec + 4);
      }
      state.loopEnabled = true;
      updateTransportUI();
      requestDraw();
    });
    document.getElementById('btnSetLoopB').addEventListener('click', () => {
      if (state.playheadBaseSec > state.loopStartBaseSec + 0.25) {
        state.loopEndBaseSec = state.playheadBaseSec;
        state.loopEnabled = true;
        updateTransportUI();
        requestDraw();
      } else {
        showToast('Move playhead past Loop A before setting Loop B.', 'error');
      }
    });
    document.getElementById('loopStartMeasure').addEventListener('change', e => {
      const song = getActiveSong();
      if (!song) return;
      const mNum = Math.max(1, Math.min(song.measures.length, parseInt(e.target.value, 10) || 1));
      state.loopStartBaseSec = song.measures[mNum - 1].startBaseSec;
      if (state.loopEndBaseSec <= state.loopStartBaseSec + 0.2) {
        const nextM = song.measures[Math.min(song.measures.length - 1, mNum - 1)];
        state.loopEndBaseSec = nextM.endBaseSec;
      }
      state.loopEnabled = true;
      updateTransportUI();
      requestDraw();
    });
    document.getElementById('loopEndMeasure').addEventListener('change', e => {
      const song = getActiveSong();
      if (!song) return;
      const mNum = Math.max(2, Math.min(song.measures.length + 1, parseInt(e.target.value, 10) || 2));
      const endMeasure = song.measures[Math.min(song.measures.length - 1, mNum - 2)];
      if (endMeasure && endMeasure.endBaseSec > state.loopStartBaseSec + 0.2) {
        state.loopEndBaseSec = endMeasure.endBaseSec;
        state.loopEnabled = true;
      }
      updateTransportUI();
      requestDraw();
    });
    document.getElementById('btnLoop4Bars').addEventListener('click', () => {
      const song = getActiveSong();
      if (!song) return;
      const curM = findMeasureAndBeat(song, state.playheadBaseSec).measure;
      const startIdx = Math.max(0, curM - 1);
      const endIdx = Math.min(song.measures.length - 1, startIdx + 3);
      state.loopStartBaseSec = song.measures[startIdx].startBaseSec;
      state.loopEndBaseSec = song.measures[endIdx].endBaseSec;
      state.startBaseSec = state.loopStartBaseSec;
      state.loopEnabled = true;
      seekToBaseSec(state.loopStartBaseSec);
      scrollPlayheadIntoView(true);
      showToast(`Looping 4 bars: Measure ${startIdx + 1} to ${endIdx + 1}`);
    });

    document.getElementById('masterVolumeSlider').addEventListener('input', e => {
      const v = parseInt(e.target.value, 10) || 0;
      state.masterVolume = v / 100;
      document.getElementById('masterVolReadout').textContent = `${v}%`;
      syncAllTrackGains();
    });

    // Group Mute / Solo & Batch Actions
    document.getElementById('groupControlsBar').addEventListener('click', e => {
      const song = getActiveSong();
      if (!song) return;
      const muteBtn = e.target.closest('[data-group-mute]');
      if (muteBtn) {
        const grp = muteBtn.getAttribute('data-group-mute');
        if (state.mutedGroups.has(grp)) {
          state.mutedGroups.delete(grp);
          song.tracks.filter(t => t.group === grp).forEach(t => { t.muted = false; });
        } else {
          state.mutedGroups.add(grp);
        }
        syncAllTrackGains();
        renderGroupControlsBar();
        renderTrackMixerList();
        requestDraw();
        return;
      }
      const soloBtn = e.target.closest('[data-group-solo]');
      if (soloBtn) {
        const grp = soloBtn.getAttribute('data-group-solo');
        const grpTracks = song.tracks.filter(t => t.group === grp);
        const alreadyAllSolo = grpTracks.length > 0 && grpTracks.every(t => t.solo) && song.tracks.filter(t => t.group !== grp).every(t => !t.solo);
        song.tracks.forEach(t => {
          t.solo = alreadyAllSolo ? false : (t.group === grp);
        });
        syncAllTrackGains();
        renderGroupControlsBar();
        renderTrackMixerList();
        requestDraw();
      }
    });

    document.getElementById('chkSelectAllTracks').addEventListener('change', e => {
      const song = getActiveSong();
      if (!song) return;
      const checked = e.target.checked;
      song.tracks.forEach(t => { t.checked = checked; });
      renderGroupControlsBar();
      renderTrackMixerList();
    });

    document.getElementById('btnMuteChecked').addEventListener('click', () => {
      const song = getActiveSong();
      if (!song) return;
      const sel = song.tracks.filter(t => t.checked);
      if (!sel.length) {
        showToast('Check two or more tracks on the left first to mute them together.');
        return;
      }
      sel.forEach(t => { t.muted = true; t.solo = false; });
      syncAllTrackGains();
      renderGroupControlsBar();
      renderTrackMixerList();
      requestDraw();
    });

    document.getElementById('btnUnmuteChecked').addEventListener('click', () => {
      const song = getActiveSong();
      if (!song) return;
      const sel = song.tracks.filter(t => t.checked);
      if (!sel.length) {
        showToast('Check tracks first to unmute them together.');
        return;
      }
      sel.forEach(t => {
        t.muted = false;
        state.mutedGroups.delete(t.group);
      });
      syncAllTrackGains();
      renderGroupControlsBar();
      renderTrackMixerList();
      requestDraw();
    });

    document.getElementById('btnSoloChecked').addEventListener('click', () => {
      const song = getActiveSong();
      if (!song) return;
      const sel = song.tracks.filter(t => t.checked);
      if (!sel.length) {
        showToast('Check one or more tracks first to solo that group.');
        return;
      }
      song.tracks.forEach(t => { t.solo = t.checked; });
      syncAllTrackGains();
      renderGroupControlsBar();
      renderTrackMixerList();
      requestDraw();
    });

    document.getElementById('btnResetMix').addEventListener('click', () => {
      const song = getActiveSong();
      if (!song) return;
      state.mutedGroups.clear();
      song.tracks.forEach(t => { t.muted = false; t.solo = false; });
      syncAllTrackGains();
      renderGroupControlsBar();
      renderTrackMixerList();
      requestDraw();
    });

    // Ruler Click Mode & Score View Controls
    document.getElementById('rulerModeGroup').addEventListener('click', e => {
      const btn = e.target.closest('[data-ruler-mode]');
      if (!btn) return;
      state.rulerClickMode = btn.getAttribute('data-ruler-mode');
      document.querySelectorAll('[data-ruler-mode]').forEach(b => {
        const m = b.getAttribute('data-ruler-mode');
        b.className = m === state.rulerClickMode
          ? 'px-2 py-0.5 rounded bg-sky-500/20 text-sky-300 font-medium'
          : 'px-2 py-0.5 rounded text-slate-400 hover:text-slate-200';
      });
    });

    document.getElementById('pitchLabelMode').addEventListener('change', e => {
      state.pitchLabelMode = e.target.value;
      requestDraw();
    });

    function applyZoom(newPct) {
      state.zoomPercent = Math.max(50, Math.min(225, newPct));
      state.pixelsPerBeat = Math.round(58 * (state.zoomPercent / 100));
      document.getElementById('zoomReadout').textContent = `${state.zoomPercent}%`;
      updateHorizontalScrollExtent();
      requestDraw();
    }
    document.getElementById('btnZoomOut').addEventListener('click', () => applyZoom(state.zoomPercent - 25));
    document.getElementById('btnZoomIn').addEventListener('click', () => applyZoom(state.zoomPercent + 25));

    document.getElementById('btnAutoScroll').addEventListener('click', e => {
      state.autoScroll = !state.autoScroll;
      e.currentTarget.className = state.autoScroll
        ? 'px-2.5 py-1 rounded-lg bg-sky-500/20 border border-sky-500/40 text-sky-300 text-[11px] font-medium transition-colors'
        : 'px-2.5 py-1 rounded-lg bg-slate-800 text-slate-400 text-[11px] font-medium transition-colors';
    });

    document.getElementById('btnCompactMixer').addEventListener('click', e => {
      state.compactMixer = !state.compactMixer;
      const mixerCol = document.getElementById('mixerColumn');
      const hdrTitle = document.getElementById('mixerHeaderTitle');
      if (state.compactMixer) {
        mixerCol.className = 'w-36 shrink-0 bg-slate-900 border-r border-slate-800 flex flex-col min-h-0 transition-all duration-150';
        hdrTitle.textContent = 'Tracks';
        e.currentTarget.className = 'px-2.5 py-1 rounded-lg bg-sky-500/20 border border-sky-500/40 text-sky-300 text-[11px] font-medium transition-colors';
        e.currentTarget.textContent = 'Full Mixer';
      } else {
        mixerCol.className = 'w-72 sm:w-80 shrink-0 bg-slate-900 border-r border-slate-800 flex flex-col min-h-0 transition-all duration-150';
        hdrTitle.textContent = 'Tracks · Instrument · Vol';
        e.currentTarget.className = 'px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-medium transition-colors';
        e.currentTarget.textContent = 'Wide Staff';
      }
      renderTrackMixerList();
      setTimeout(() => {
        updateHorizontalScrollExtent();
        requestDraw();
      }, 160);
    });

    // Mixer Track Card Events
    const mixerList = document.getElementById('trackMixerList');
    mixerList.addEventListener('click', e => {
      const song = getActiveSong();
      if (!song) return;

      const soloBtn = e.target.closest('[data-track-solo]');
      if (soloBtn) {
        const trk = song.tracks.find(t => t.id === soloBtn.getAttribute('data-track-solo'));
        if (trk) {
          trk.solo = !trk.solo;
          if (trk.solo) trk.muted = false;
          syncAllTrackGains();
          renderGroupControlsBar();
          renderTrackMixerList();
          requestDraw();
        }
        return;
      }

      const muteBtn = e.target.closest('[data-track-mute]');
      if (muteBtn) {
        const trk = song.tracks.find(t => t.id === muteBtn.getAttribute('data-track-mute'));
        if (trk) {
          if (state.mutedGroups.has(trk.group)) {
            state.mutedGroups.delete(trk.group);
            song.tracks.filter(t => t.group === trk.group && t.id !== trk.id).forEach(t => { t.muted = true; });
            trk.muted = false;
          } else {
            trk.muted = !trk.muted;
            if (trk.muted) trk.solo = false;
          }
          syncAllTrackGains();
          renderGroupControlsBar();
          renderTrackMixerList();
          requestDraw();
        }
        return;
      }

      const pingBtn = e.target.closest('[data-track-ping]');
      if (pingBtn) {
        const trk = song.tracks.find(t => t.id === pingBtn.getAttribute('data-track-ping'));
        if (trk) auditionTrackPitch(trk);
        return;
      }

      const grpBtn = e.target.closest('[data-track-group]');
      if (grpBtn) {
        const trk = song.tracks.find(t => t.id === grpBtn.getAttribute('data-track-group'));
        if (trk) {
          const nextIdx = (TRACK_GROUPS.indexOf(trk.group) + 1) % TRACK_GROUPS.length;
          trk.group = TRACK_GROUPS[nextIdx];
          syncAllTrackGains();
          renderGroupControlsBar();
          renderTrackMixerList();
          requestDraw();
        }
      }
    });

    mixerList.addEventListener('input', e => {
      const song = getActiveSong();
      if (!song) return;
      if (e.target.matches('[data-track-vol]')) {
        const id = e.target.getAttribute('data-track-vol');
        const trk = song.tracks.find(t => t.id === id);
        if (trk) {
          trk.volume = parseInt(e.target.value, 10) || 0;
          const lbl = mixerList.querySelector(`[data-vol-label="${id}"]`);
          if (lbl) lbl.textContent = `${trk.volume}%`;
          syncAllTrackGains();
        }
      }
    });

    mixerList.addEventListener('change', e => {
      const song = getActiveSong();
      if (!song) return;

      if (e.target.matches('[data-track-check]')) {
        const trk = song.tracks.find(t => t.id === e.target.getAttribute('data-track-check'));
        if (trk) {
          trk.checked = e.target.checked;
          renderGroupControlsBar();
        }
        return;
      }
      if (e.target.matches('[data-track-inst]')) {
        const trk = song.tracks.find(t => t.id === e.target.getAttribute('data-track-inst'));
        if (trk) {
          trk.instrument = e.target.value;
          if (!state.isPlaying) auditionTrackPitch(trk);
        }
        return;
      }
      if (e.target.matches('[data-track-clef]')) {
        const trk = song.tracks.find(t => t.id === e.target.getAttribute('data-track-clef'));
        if (trk) {
          trk.clef = e.target.value;
          renderTrackMixerList();
          requestDraw();
        }
      }
    });

    // Scroll Sync
    mixerList.addEventListener('scroll', () => {
      state.scrollY = mixerList.scrollTop;
      requestDraw();
    });

    const hScroll = document.getElementById('scoreHScroll');
    hScroll.addEventListener('scroll', () => {
      state.scrollX = hScroll.scrollLeft;
      requestDraw();
    });

    const staffCanvas = document.getElementById('staffCanvas');
    staffCanvas.addEventListener('wheel', e => {
      e.preventDefault();
      if (Math.abs(e.deltaX) > 0) {
        hScroll.scrollLeft += e.deltaX;
        state.scrollX = hScroll.scrollLeft;
      }
      if (Math.abs(e.deltaY) > 0) {
        if (e.shiftKey) {
          hScroll.scrollLeft += e.deltaY;
          state.scrollX = hScroll.scrollLeft;
        } else {
          mixerList.scrollTop += e.deltaY;
          state.scrollY = mixerList.scrollTop;
        }
      }
      requestDraw();
    }, { passive: false });

    // Ruler Scrubbing & Marker Dragging
    const rulerCanvas = document.getElementById('rulerCanvas');
    let rulerDragTarget = null;

    function applyRulerPosition(clientX, mode) {
      const song = getActiveSong();
      if (!song) return;
      const gutterW = getStaffGutterWidth(song);
      const rect = rulerCanvas.getBoundingClientRect();
      const cx = Math.max(gutterW, clientX - rect.left);
      const tick = Math.max(0, Math.min(song.totalTicks, xToTick(song, cx, state.pixelsPerBeat, state.scrollX, gutterW)));
      const sec = song.tickToSec(tick);

      if (mode === 'start') {
        state.startBaseSec = sec;
        seekToBaseSec(sec);
      } else if (mode === 'loopA') {
        state.loopStartBaseSec = Math.min(sec, state.loopEndBaseSec - 0.25);
        state.loopEnabled = true;
        updateTransportUI();
        requestDraw();
      } else if (mode === 'loopB') {
        state.loopEndBaseSec = Math.max(sec, state.loopStartBaseSec + 0.25);
        state.loopEnabled = true;
        updateTransportUI();
        requestDraw();
      } else {
        seekToBaseSec(sec);
      }
    }

    rulerCanvas.addEventListener('pointerdown', e => {
      const song = getActiveSong();
      if (!song) return;
      const gutterW = getStaffGutterWidth(song);
      const rect = rulerCanvas.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const loopX1 = secToX(song, state.loopStartBaseSec, state.pixelsPerBeat, state.scrollX, gutterW);
      const loopX2 = secToX(song, state.loopEndBaseSec, state.pixelsPerBeat, state.scrollX, gutterW);
      const startX = secToX(song, state.startBaseSec, state.pixelsPerBeat, state.scrollX, gutterW);

      if (e.shiftKey) rulerDragTarget = 'start';
      else if (Math.abs(cx - startX - 14) <= 18) rulerDragTarget = 'start';
      else if (Math.abs(cx - (loopX1 + 7)) <= 10) rulerDragTarget = 'loopA';
      else if (Math.abs(cx - (loopX2 - 7)) <= 10) rulerDragTarget = 'loopB';
      else rulerDragTarget = state.rulerClickMode;

      rulerCanvas.setPointerCapture(e.pointerId);
      applyRulerPosition(e.clientX, rulerDragTarget);
    });
    rulerCanvas.addEventListener('pointermove', e => {
      if (rulerDragTarget) applyRulerPosition(e.clientX, rulerDragTarget);
    });
    rulerCanvas.addEventListener('pointerup', () => {
      rulerDragTarget = null;
    });

    // Staff Hover & Click-Note-to-Audition
    const tooltip = document.getElementById('staffNoteTooltip');
    staffCanvas.addEventListener('mousemove', e => {
      const rect = staffCanvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      let found = null;
      let minDist = 14;
      for (const hit of state.renderedNoteHits) {
        const d = Math.hypot(mx - hit.x, my - hit.y);
        if (d < minDist) {
          minDist = d;
          found = hit;
        }
      }
      state.hoveredHit = found;
      if (found) {
        staffCanvas.style.cursor = 'pointer';
        tooltip.classList.remove('hidden');
        tooltip.textContent = `${found.track.name}: ${found.pitchLabel}${found.note.lyric ? ' "' + found.note.lyric + '"' : ''} · Click to hear & cue`;
        tooltip.style.left = `${Math.min(rect.width - 190, Math.max(8, mx + 12))}px`;
        tooltip.style.top = `${Math.max(6, my - 28)}px`;
      } else {
        staffCanvas.style.cursor = 'crosshair';
        tooltip.classList.add('hidden');
      }
    });

    staffCanvas.addEventListener('mouseleave', () => {
      tooltip.classList.add('hidden');
      state.hoveredHit = null;
    });

    staffCanvas.addEventListener('click', e => {
      const song = getActiveSong();
      if (!song) return;
      const gutterW = getStaffGutterWidth(song);
      const rect = staffCanvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      if (mx < gutterW) return;

      if (state.hoveredHit) {
        const { track, note } = state.hoveredHit;
        seekToBaseSec(note.startBaseSec);
        if (e.shiftKey) state.startBaseSec = note.startBaseSec;
        if (!state.isPlaying) auditionTrackPitch(track, note.midi);
        updateTransportUI();
        requestDraw();
      } else {
        const tick = Math.max(0, Math.min(song.totalTicks, xToTick(song, mx, state.pixelsPerBeat, state.scrollX, gutterW)));
        const sec = song.tickToSec(tick);
        if (e.shiftKey) state.startBaseSec = sec;
        seekToBaseSec(sec);
      }
    });

    // Sound-Check Virtual Piano Dock Events
    function setPianoDockOpen(open) {
      state.pianoOpen = open;
      document.getElementById('pianoKeyboardDock').classList.toggle('hidden', !open);
      document.getElementById('btnToggleKeyboard').className = open
        ? 'px-2.5 py-1 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-[11px] font-semibold flex items-center gap-1 transition-colors'
        : 'px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold flex items-center gap-1 transition-colors';
      if (!open) releaseAllPianoKeys(true);
      requestDraw();
    }

    document.getElementById('btnToggleKeyboard').addEventListener('click', () => setPianoDockOpen(!state.pianoOpen));
    document.getElementById('btnCollapseKeyboard').addEventListener('click', () => setPianoDockOpen(false));

    document.getElementById('pianoInstSelect').addEventListener('change', e => {
      state.pianoInstrument = e.target.value;
      e.target.blur();
    });

    function shiftQwertyOctave(delta) {
      const nextOct = Math.max(1, Math.min(6, state.pianoQwertyOctave + delta));
      if (nextOct === state.pianoQwertyOctave) return;
      releaseAllPianoKeys(false);
      state.pianoQwertyOctave = nextOct;
      renderPianoKeybed();
    }
    document.getElementById('btnOctaveDown').addEventListener('click', () => shiftQwertyOctave(-1));
    document.getElementById('btnOctaveUp').addEventListener('click', () => shiftQwertyOctave(1));

    document.getElementById('btnPianoSustain').addEventListener('click', e => {
      state.pianoSustain = !state.pianoSustain;
      e.currentTarget.className = state.pianoSustain
        ? 'px-2 py-0.5 rounded-lg bg-amber-400 text-slate-950 text-[11px] font-bold shadow-sm transition-colors'
        : 'px-2 py-0.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-medium transition-colors';
      if (!state.pianoSustain) {
        for (const [midi, entry] of Array.from(activePianoVoices.entries())) {
          entry.sources.delete('sustain');
          if (entry.sources.size === 0) {
            entry.stopFn(false);
            activePianoVoices.delete(midi);
          }
        }
        updatePianoKeyVisuals();
        updatePianoReadout();
      }
    });

    document.getElementById('btnPianoPanic').addEventListener('click', () => releaseAllPianoKeys(true));

    document.getElementById('btnQwertyToggle').addEventListener('click', e => {
      state.qwertyEnabled = !state.qwertyEnabled;
      e.currentTarget.className = state.qwertyEnabled
        ? 'px-2 py-0.5 rounded-lg bg-sky-500/20 border border-sky-500/40 text-sky-300 text-[11px] font-medium transition-colors'
        : 'px-2 py-0.5 rounded-lg bg-slate-800 text-slate-400 text-[11px] font-medium transition-colors';
      e.currentTarget.textContent = state.qwertyEnabled ? 'QWERTY On' : 'QWERTY Off';
      if (!state.qwertyEnabled) releaseAllPianoKeys(false);
      renderPianoKeybed();
    });

    document.getElementById('pianoVolSlider').addEventListener('input', e => {
      const val = parseInt(e.target.value, 10) || 0;
      state.pianoVolume = val / 100;
      document.getElementById('pianoVolReadout').textContent = `${val}%`;
      syncAllTrackGains();
    });

    let refTimer = null;
    function triggerReferencePitches(midis, durationMs) {
      if (refTimer) clearTimeout(refTimer);
      for (const [m, entry] of Array.from(activePianoVoices.entries())) {
        if (entry.sources.has('ref')) releasePianoKey(m, 'ref');
      }
      midis.forEach(m => pressPianoKey(m, 'ref'));
      refTimer = setTimeout(() => {
        midis.forEach(m => releasePianoKey(m, 'ref'));
      }, durationMs);
    }

    document.getElementById('btnRefA440').addEventListener('click', () => {
      triggerReferencePitches([69], 1300);
    });
    document.getElementById('btnRefKeyChord').addEventListener('click', () => {
      const song = getActiveSong();
      const tonicPc = song ? (KEY_TONIC_PC[String(song.keySf)] ?? 0) : 0;
      const rootMidi = 60 + tonicPc;
      const adjustedRoot = rootMidi > 67 ? rootMidi - 12 : rootMidi;
      const thirdOffset = song && song.keyMi === 1 ? 3 : 4;
      triggerReferencePitches([adjustedRoot, adjustedRoot + thirdOffset, adjustedRoot + 7, adjustedRoot + 12], 1600);
    });

    // Pointer Click & Glissando on Piano Keybed
    const pianoKeybed = document.getElementById('pianoKeybed');
    const pointerActiveMidi = new Map();

    function midiFromPoint(clientX, clientY) {
      const el = document.elementFromPoint(clientX, clientY);
      if (!el) return null;
      const keyEl = el.closest('[data-piano-midi]');
      return keyEl ? parseInt(keyEl.getAttribute('data-piano-midi'), 10) : null;
    }

    pianoKeybed.addEventListener('pointerdown', e => {
      const keyEl = e.target.closest('[data-piano-midi]');
      if (!keyEl) return;
      e.preventDefault();
      const midi = parseInt(keyEl.getAttribute('data-piano-midi'), 10);
      pianoKeybed.setPointerCapture(e.pointerId);
      pointerActiveMidi.set(e.pointerId, midi);
      pressPianoKey(midi, `ptr:${e.pointerId}`);
    });
    pianoKeybed.addEventListener('pointermove', e => {
      if (!pointerActiveMidi.has(e.pointerId)) return;
      const prevMidi = pointerActiveMidi.get(e.pointerId);
      const curMidi = midiFromPoint(e.clientX, e.clientY);
      if (curMidi !== prevMidi) {
        if (prevMidi != null) releasePianoKey(prevMidi, `ptr:${e.pointerId}`);
        if (curMidi != null) {
          pointerActiveMidi.set(e.pointerId, curMidi);
          pressPianoKey(curMidi, `ptr:${e.pointerId}`);
        } else {
          pointerActiveMidi.set(e.pointerId, null);
        }
      }
    });
    function endPointerNote(e) {
      if (!pointerActiveMidi.has(e.pointerId)) return;
      const prevMidi = pointerActiveMidi.get(e.pointerId);
      pointerActiveMidi.delete(e.pointerId);
      if (prevMidi != null) releasePianoKey(prevMidi, `ptr:${e.pointerId}`);
    }
    pianoKeybed.addEventListener('pointerup', endPointerNote);
    pianoKeybed.addEventListener('pointercancel', endPointerNote);

    // Keyboard Shortcuts + Computer Keyboard Piano Mapping
    window.addEventListener('keydown', e => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'select' || tag === 'textarea') return;

      if (e.code === 'Space') {
        e.preventDefault();
        if (state.isPlaying) pausePlayback();
        else startPlayback();
        return;
      }
      if (e.code === 'KeyR') {
        e.preventDefault();
        seekToBaseSec(state.startBaseSec);
        if (state.autoScroll) scrollPlayheadIntoView(true);
        return;
      }
      if (e.code === 'KeyL' && (e.shiftKey || !state.pianoOpen || !state.qwertyEnabled)) {
        e.preventDefault();
        state.loopEnabled = !state.loopEnabled;
        updateTransportUI();
        requestDraw();
        return;
      }

      if (state.pianoOpen && state.qwertyEnabled && !e.shiftKey) {
        if (e.code === 'KeyZ' && !e.repeat) {
          e.preventDefault();
          shiftQwertyOctave(-1);
          return;
        }
        if (e.code === 'KeyX' && !e.repeat) {
          e.preventDefault();
          shiftQwertyOctave(1);
          return;
        }
        if (CODE_TO_SEMI.has(e.code)) {
          e.preventDefault();
          if (e.repeat) return;
          const semi = CODE_TO_SEMI.get(e.code);
          const midi = (state.pianoQwertyOctave + 1) * 12 + semi;
          pressPianoKey(midi, `kbd:${e.code}`);
        }
      }
    });

    window.addEventListener('keyup', e => {
      if (CODE_TO_SEMI.has(e.code)) {
        const semi = CODE_TO_SEMI.get(e.code);
        const midi = (state.pianoQwertyOctave + 1) * 12 + semi;
        releasePianoKey(midi, `kbd:${e.code}`);
      }
    });

    window.addEventListener('blur', () => releaseAllPianoKeys(false));

    // Observe exact canvas container resizes so canvases never stretch or distort
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(() => {
        updateHorizontalScrollExtent();
        requestDraw();
      });
      ro.observe(document.getElementById('staffCanvasContainer'));
    } else {
      window.addEventListener('resize', () => {
        updateHorizontalScrollExtent();
        requestDraw();
      });
    }
  }

  function init() {
    state.songs = buildBuiltInLibrary();
    renderPianoKeybed();
    bindEvents();
    if (state.songs.length > 0) {
      selectSong(state.songs[0].id);
    }
    restoreMidisFromBrowserDB();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
