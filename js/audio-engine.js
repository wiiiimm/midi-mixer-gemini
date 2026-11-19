(function (global) {
  'use strict';

  let audioCtx = null;
  let masterGainNode = null;
  let pianoGainNode = null;
  let compressorNode = null;
  let noiseBuffer = null;
  const trackGainNodes = new Map();
  const activePianoVoices = new Map(); // midi -> { stopFn, sources: Set<string> }

  function midiToFreq(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  function ensureAudioContext(masterVolume, pianoVolume) {
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      audioCtx = new Ctx();
      compressorNode = audioCtx.createDynamicsCompressor();
      compressorNode.threshold.value = -14;
      compressorNode.knee.value = 18;
      compressorNode.ratio.value = 4;
      compressorNode.attack.value = 0.005;
      compressorNode.release.value = 0.15;

      masterGainNode = audioCtx.createGain();
      masterGainNode.gain.value = masterVolume ?? 0.95;
      masterGainNode.connect(compressorNode);
      compressorNode.connect(audioCtx.destination);

      pianoGainNode = audioCtx.createGain();
      pianoGainNode.gain.value = pianoVolume ?? 1.05;
      pianoGainNode.connect(masterGainNode);

      const len = audioCtx.sampleRate;
      noiseBuffer = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    return audioCtx;
  }

  function getAudioContext() {
    return audioCtx;
  }

  function clearTrackGainNodes() {
    trackGainNodes.clear();
  }

  function getTrackGainNode(track) {
    if (!audioCtx) return null;
    if (!trackGainNodes.has(track.id)) {
      const g = audioCtx.createGain();
      g.connect(masterGainNode);
      trackGainNodes.set(track.id, g);
    }
    return trackGainNodes.get(track.id);
  }

  function syncMixGains(song, masterVolume, pianoVolume, isTrackAudibleFn) {
    if (!audioCtx) return;
    const now = audioCtx.currentTime;
    masterGainNode.gain.setTargetAtTime(masterVolume, now, 0.015);
    if (pianoGainNode) {
      pianoGainNode.gain.setTargetAtTime(pianoVolume, now, 0.015);
    }
    if (!song) return;
    for (const trk of song.tracks) {
      const gNode = getTrackGainNode(trk);
      const audible = isTrackAudibleFn(song, trk);
      const target = audible ? (trk.volume / 100) : 0;
      gNode.gain.setTargetAtTime(target, now, 0.015);
    }
  }

  function playMetronomeClick(when, isDownbeat) {
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(isDownbeat ? 1320 : 880, when);
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(isDownbeat ? 0.22 : 0.12, when + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.055);
    osc.connect(g);
    g.connect(masterGainNode);
    osc.start(when);
    osc.stop(when + 0.065);
  }

  function triggerDrumVoice(destNode, midi, velNorm, startTime) {
    const ctx = audioCtx;
    if (midi === 35 || midi === 36) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(145, startTime);
      osc.frequency.exponentialRampToValueAtTime(42, startTime + 0.12);
      g.gain.setValueAtTime(0.55 * velNorm, startTime);
      g.gain.exponentialRampToValueAtTime(0.001, startTime + 0.24);
      osc.connect(g);
      g.connect(destNode);
      osc.start(startTime);
      osc.stop(startTime + 0.26);
    } else if (midi === 38 || midi === 40 || midi === 37) {
      const noise = ctx.createBufferSource();
      noise.buffer = noiseBuffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = midi === 37 ? 2200 : 1400;
      const g = ctx.createGain();
      const dur = midi === 37 ? 0.06 : 0.16;
      g.gain.setValueAtTime(0.32 * velNorm, startTime);
      g.gain.exponentialRampToValueAtTime(0.001, startTime + dur);
      noise.connect(filter);
      filter.connect(g);
      g.connect(destNode);
      noise.start(startTime);
      noise.stop(startTime + dur + 0.02);
    } else {
      const noise = ctx.createBufferSource();
      noise.buffer = noiseBuffer;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 6500;
      const g = ctx.createGain();
      const dur = (midi === 46 || midi === 49 || midi === 51) ? 0.28 : 0.065;
      g.gain.setValueAtTime(0.22 * velNorm, startTime);
      g.gain.exponentialRampToValueAtTime(0.001, startTime + dur);
      noise.connect(hp);
      hp.connect(g);
      g.connect(destNode);
      noise.start(startTime);
      noise.stop(startTime + dur + 0.02);
    }
  }

  function scheduleSynthNote(track, midi, velocity, startTime, durationSec) {
    if (!audioCtx) return;
    const ctx = audioCtx;
    const dest = getTrackGainNode(track);
    if (!dest) return;

    const velNorm = Math.max(0.15, Math.min(1.0, velocity / 127));
    const inst = track.instrument;

    if (inst === 'drums') {
      triggerDrumVoice(dest, midi, velNorm, startTime);
      return;
    }

    const freq = midiToFreq(midi);
    const dur = Math.max(0.05, durationSec);
    const voiceGain = ctx.createGain();
    voiceGain.connect(dest);

    if (inst === 'choir_aahs' || inst === 'voice_oohs') {
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      osc1.type = 'sawtooth';
      osc2.type = inst === 'choir_aahs' ? 'sawtooth' : 'triangle';
      osc1.frequency.setValueAtTime(freq, startTime);
      osc2.frequency.setValueAtTime(freq, startTime);
      osc1.detune.value = -5;
      osc2.detune.value = 5;

      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      lfo.frequency.value = 5.2;
      lfoGain.gain.setValueAtTime(0, startTime);
      lfoGain.gain.linearRampToValueAtTime(6, startTime + Math.min(0.25, dur * 0.5));
      lfo.connect(lfoGain);
      lfoGain.connect(osc1.detune);
      lfoGain.connect(osc2.detune);

      const formants = inst === 'choir_aahs'
        ? [{ f: 730, q: 4.5, g: 0.45 }, { f: 1090, q: 5.5, g: 0.35 }, { f: 2440, q: 6, g: 0.18 }]
        : [{ f: 340, q: 3.8, g: 0.55 }, { f: 820, q: 4.5, g: 0.32 }];

      const sumBus = ctx.createGain();
      sumBus.gain.value = 0.42 * velNorm;
      for (const fm of formants) {
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = fm.f;
        bp.Q.value = fm.q;
        const fg = ctx.createGain();
        fg.gain.value = fm.g;
        osc1.connect(bp);
        osc2.connect(bp);
        bp.connect(fg);
        fg.connect(sumBus);
      }
      const sub = ctx.createOscillator();
      sub.type = 'sine';
      sub.frequency.setValueAtTime(freq, startTime);
      const subG = ctx.createGain();
      subG.gain.value = 0.16 * velNorm;
      sub.connect(subG);
      subG.connect(voiceGain);
      sumBus.connect(voiceGain);

      const atk = Math.min(0.045, dur * 0.3);
      const rel = 0.16;
      voiceGain.gain.setValueAtTime(0.0001, startTime);
      voiceGain.gain.linearRampToValueAtTime(1.0, startTime + atk);
      voiceGain.gain.setValueAtTime(0.92, startTime + dur);
      voiceGain.gain.exponentialRampToValueAtTime(0.0001, startTime + dur + rel);

      osc1.start(startTime);
      osc2.start(startTime);
      sub.start(startTime);
      lfo.start(startTime);
      const stopAt = startTime + dur + rel + 0.02;
      osc1.stop(stopAt);
      osc2.stop(stopAt);
      sub.stop(stopAt);
      lfo.stop(stopAt);
    } else if (inst === 'grand_piano' || inst === 'epiano') {
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      osc1.type = inst === 'grand_piano' ? 'triangle' : 'sine';
      osc2.type = inst === 'grand_piano' ? 'sawtooth' : 'triangle';
      osc1.frequency.setValueAtTime(freq, startTime);
      osc2.frequency.setValueAtTime(inst === 'epiano' ? freq * 2 : freq, startTime);
      osc2.detune.value = 2.5;

      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(Math.min(9000, freq * (inst === 'epiano' ? 5.5 : 4.2)), startTime);
      lp.frequency.exponentialRampToValueAtTime(Math.max(350, freq * 1.6), startTime + Math.min(0.6, dur));

      const g1 = ctx.createGain();
      const g2 = ctx.createGain();
      g1.gain.value = 0.30 * velNorm;
      g2.gain.value = (inst === 'epiano' ? 0.11 : 0.12) * velNorm;

      osc1.connect(g1);
      osc2.connect(g2);
      g1.connect(lp);
      g2.connect(lp);
      lp.connect(voiceGain);

      const rel = 0.11;
      voiceGain.gain.setValueAtTime(0.0001, startTime);
      voiceGain.gain.linearRampToValueAtTime(1.0, startTime + 0.008);
      voiceGain.gain.exponentialRampToValueAtTime(0.32, startTime + Math.max(0.06, dur));
      voiceGain.gain.exponentialRampToValueAtTime(0.0001, startTime + dur + rel);

      osc1.start(startTime);
      osc2.start(startTime);
      osc1.stop(startTime + dur + rel + 0.02);
      osc2.stop(startTime + dur + rel + 0.02);
    } else if (inst === 'pitch_guide' || inst === 'clarinet' || inst === 'flute') {
      const osc = ctx.createOscillator();
      const over = ctx.createOscillator();
      osc.type = inst === 'clarinet' ? 'square' : 'triangle';
      over.type = 'sine';
      osc.frequency.setValueAtTime(freq, startTime);
      over.frequency.setValueAtTime(inst === 'flute' ? freq : freq * 2, startTime);

      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = inst === 'clarinet' ? Math.min(5000, freq * 3.4) : Math.min(6500, freq * 4.5);

      const m1 = ctx.createGain();
      const m2 = ctx.createGain();
      m1.gain.value = (inst === 'clarinet' ? 0.19 : 0.28) * velNorm;
      m2.gain.value = (inst === 'pitch_guide' ? 0.12 : 0.08) * velNorm;

      osc.connect(m1);
      over.connect(m2);
      m1.connect(lp);
      m2.connect(lp);
      lp.connect(voiceGain);

      const atk = inst === 'pitch_guide' ? 0.012 : 0.03;
      const rel = 0.09;
      voiceGain.gain.setValueAtTime(0.0001, startTime);
      voiceGain.gain.linearRampToValueAtTime(1.0, startTime + atk);
      voiceGain.gain.setValueAtTime(0.9, startTime + dur);
      voiceGain.gain.exponentialRampToValueAtTime(0.0001, startTime + dur + rel);

      osc.start(startTime);
      over.start(startTime);
      osc.stop(startTime + dur + rel + 0.02);
      over.stop(startTime + dur + rel + 0.02);
    } else if (inst === 'strings' || inst === 'brass' || inst === 'organ') {
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      osc1.type = inst === 'organ' ? 'triangle' : 'sawtooth';
      osc2.type = inst === 'organ' ? 'sine' : 'sawtooth';
      osc1.frequency.setValueAtTime(freq, startTime);
      osc2.frequency.setValueAtTime(inst === 'organ' ? freq * 2 : freq, startTime);
      if (inst !== 'organ') {
        osc1.detune.value = -7;
        osc2.detune.value = 7;
      }

      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      if (inst === 'brass') {
        lp.frequency.setValueAtTime(freq * 1.4, startTime);
        lp.frequency.linearRampToValueAtTime(Math.min(6000, freq * 4.8), startTime + Math.min(0.08, dur * 0.5));
      } else {
        lp.frequency.value = inst === 'strings' ? 2600 : 4200;
      }

      const bus = ctx.createGain();
      bus.gain.value = 0.18 * velNorm;
      osc1.connect(bus);
      osc2.connect(bus);
      bus.connect(lp);
      lp.connect(voiceGain);

      const atk = inst === 'strings' ? Math.min(0.07, dur * 0.35) : 0.022;
      const rel = inst === 'strings' ? 0.2 : 0.1;
      voiceGain.gain.setValueAtTime(0.0001, startTime);
      voiceGain.gain.linearRampToValueAtTime(1.0, startTime + atk);
      voiceGain.gain.setValueAtTime(0.92, startTime + dur);
      voiceGain.gain.exponentialRampToValueAtTime(0.0001, startTime + dur + rel);

      osc1.start(startTime);
      osc2.start(startTime);
      osc1.stop(startTime + dur + rel + 0.02);
      osc2.stop(startTime + dur + rel + 0.02);
    } else {
      const osc = ctx.createOscillator();
      const sub = ctx.createOscillator();
      osc.type = 'sawtooth';
      sub.type = 'sine';
      osc.frequency.setValueAtTime(freq, startTime);
      sub.frequency.setValueAtTime(freq, startTime);

      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(inst === 'bass' ? 950 : 3400, startTime);
      lp.frequency.exponentialRampToValueAtTime(inst === 'bass' ? 320 : 850, startTime + 0.16);

      const og = ctx.createGain();
      const sg = ctx.createGain();
      og.gain.value = 0.20 * velNorm;
      sg.gain.value = (inst === 'bass' ? 0.32 : 0.14) * velNorm;
      osc.connect(og);
      sub.connect(sg);
      og.connect(lp);
      sg.connect(lp);
      lp.connect(voiceGain);

      const rel = 0.1;
      voiceGain.gain.setValueAtTime(0.0001, startTime);
      voiceGain.gain.linearRampToValueAtTime(1.0, startTime + 0.007);
      voiceGain.gain.exponentialRampToValueAtTime(0.22, startTime + Math.max(0.08, dur));
      voiceGain.gain.exponentialRampToValueAtTime(0.0001, startTime + dur + rel);

      osc.start(startTime);
      sub.start(startTime);
      osc.stop(startTime + dur + rel + 0.02);
      sub.stop(startTime + dur + rel + 0.02);
    }
  }

  // Live Sustained Polyphonic Voice Engine for Sound-Check Piano
  function createLiveSustainedVoice(midi, instId, masterVol, pianoVol) {
    ensureAudioContext(masterVol, pianoVol);
    const ctx = audioCtx;
    const now = ctx.currentTime;
    const freq = midiToFreq(midi);
    const voiceGain = ctx.createGain();
    voiceGain.connect(pianoGainNode);

    const nodesToStop = [];
    let releaseSec = 0.14;

    if (instId === 'choir_aahs' || instId === 'voice_oohs') {
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const sub = ctx.createOscillator();
      osc1.type = 'sawtooth';
      osc2.type = instId === 'choir_aahs' ? 'sawtooth' : 'triangle';
      sub.type = 'sine';
      osc1.frequency.setValueAtTime(freq, now);
      osc2.frequency.setValueAtTime(freq, now);
      sub.frequency.setValueAtTime(freq, now);
      osc1.detune.value = -5;
      osc2.detune.value = 5;

      const lfo = ctx.createOscillator();
      const lfoG = ctx.createGain();
      lfo.frequency.value = 5.2;
      lfoG.gain.setValueAtTime(0, now);
      lfoG.gain.linearRampToValueAtTime(6, now + 0.25);
      lfo.connect(lfoG);
      lfoG.connect(osc1.detune);
      lfoG.connect(osc2.detune);

      const formants = instId === 'choir_aahs'
        ? [{ f: 730, q: 4.5, g: 0.45 }, { f: 1090, q: 5.5, g: 0.35 }, { f: 2440, q: 6, g: 0.18 }]
        : [{ f: 340, q: 3.8, g: 0.55 }, { f: 820, q: 4.5, g: 0.32 }];

      const sumBus = ctx.createGain();
      sumBus.gain.value = 0.38;
      for (const fm of formants) {
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = fm.f;
        bp.Q.value = fm.q;
        const fg = ctx.createGain();
        fg.gain.value = fm.g;
        osc1.connect(bp);
        osc2.connect(bp);
        bp.connect(fg);
        fg.connect(sumBus);
      }
      const subG = ctx.createGain();
      subG.gain.value = 0.15;
      sub.connect(subG);
      subG.connect(voiceGain);
      sumBus.connect(voiceGain);

      voiceGain.gain.setValueAtTime(0.0001, now);
      voiceGain.gain.linearRampToValueAtTime(0.95, now + 0.04);
      releaseSec = 0.18;

      osc1.start(now); osc2.start(now); sub.start(now); lfo.start(now);
      nodesToStop.push(osc1, osc2, sub, lfo);
    } else if (instId === 'grand_piano' || instId === 'epiano') {
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      osc1.type = instId === 'grand_piano' ? 'triangle' : 'sine';
      osc2.type = instId === 'grand_piano' ? 'sawtooth' : 'triangle';
      osc1.frequency.setValueAtTime(freq, now);
      osc2.frequency.setValueAtTime(instId === 'epiano' ? freq * 2 : freq, now);
      osc2.detune.value = 2.5;

      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(Math.min(9000, freq * (instId === 'epiano' ? 5.5 : 4.4)), now);
      lp.frequency.exponentialRampToValueAtTime(Math.max(380, freq * 1.5), now + 1.4);

      const g1 = ctx.createGain();
      const g2 = ctx.createGain();
      g1.gain.value = 0.30;
      g2.gain.value = 0.11;
      osc1.connect(g1); osc2.connect(g2);
      g1.connect(lp); g2.connect(lp);
      lp.connect(voiceGain);

      voiceGain.gain.setValueAtTime(0.0001, now);
      voiceGain.gain.linearRampToValueAtTime(1.0, now + 0.007);
      voiceGain.gain.exponentialRampToValueAtTime(0.24, now + 3.6);
      releaseSec = 0.13;

      osc1.start(now); osc2.start(now);
      nodesToStop.push(osc1, osc2);
    } else if (instId === 'pitch_guide' || instId === 'clarinet' || instId === 'flute') {
      const osc = ctx.createOscillator();
      const over = ctx.createOscillator();
      osc.type = instId === 'clarinet' ? 'square' : 'triangle';
      over.type = 'sine';
      osc.frequency.setValueAtTime(freq, now);
      over.frequency.setValueAtTime(instId === 'flute' ? freq : freq * 2, now);

      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = instId === 'clarinet' ? Math.min(5000, freq * 3.4) : Math.min(6500, freq * 4.5);

      const m1 = ctx.createGain();
      const m2 = ctx.createGain();
      m1.gain.value = instId === 'clarinet' ? 0.18 : 0.27;
      m2.gain.value = instId === 'pitch_guide' ? 0.12 : 0.08;
      osc.connect(m1); over.connect(m2);
      m1.connect(lp); m2.connect(lp);
      lp.connect(voiceGain);

      voiceGain.gain.setValueAtTime(0.0001, now);
      voiceGain.gain.linearRampToValueAtTime(0.95, now + (instId === 'pitch_guide' ? 0.01 : 0.028));
      releaseSec = 0.10;

      osc.start(now); over.start(now);
      nodesToStop.push(osc, over);
    } else if (instId === 'strings' || instId === 'brass' || instId === 'organ') {
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      osc1.type = instId === 'organ' ? 'triangle' : 'sawtooth';
      osc2.type = instId === 'organ' ? 'sine' : 'sawtooth';
      osc1.frequency.setValueAtTime(freq, now);
      osc2.frequency.setValueAtTime(instId === 'organ' ? freq * 2 : freq, now);
      if (instId !== 'organ') {
        osc1.detune.value = -7;
        osc2.detune.value = 7;
      }
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = instId === 'strings' ? 2700 : 4400;

      const bus = ctx.createGain();
      bus.gain.value = 0.18;
      osc1.connect(bus); osc2.connect(bus);
      bus.connect(lp); lp.connect(voiceGain);

      voiceGain.gain.setValueAtTime(0.0001, now);
      voiceGain.gain.linearRampToValueAtTime(0.95, now + (instId === 'strings' ? 0.055 : 0.02));
      releaseSec = instId === 'strings' ? 0.22 : 0.11;

      osc1.start(now); osc2.start(now);
      nodesToStop.push(osc1, osc2);
    } else {
      const osc = ctx.createOscillator();
      const sub = ctx.createOscillator();
      osc.type = 'sawtooth';
      sub.type = 'sine';
      osc.frequency.setValueAtTime(freq, now);
      sub.frequency.setValueAtTime(freq, now);

      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(instId === 'bass' ? 950 : 3400, now);
      lp.frequency.exponentialRampToValueAtTime(instId === 'bass' ? 320 : 850, now + 0.18);

      const og = ctx.createGain();
      const sg = ctx.createGain();
      og.gain.value = 0.19;
      sg.gain.value = instId === 'bass' ? 0.30 : 0.14;
      osc.connect(og); sub.connect(sg);
      og.connect(lp); sg.connect(lp);
      lp.connect(voiceGain);

      voiceGain.gain.setValueAtTime(0.0001, now);
      voiceGain.gain.linearRampToValueAtTime(1.0, now + 0.007);
      voiceGain.gain.exponentialRampToValueAtTime(0.20, now + 2.4);
      releaseSec = 0.11;

      osc.start(now); sub.start(now);
      nodesToStop.push(osc, sub);
    }

    let stopped = false;
    return function stopVoice(fast = false) {
      if (stopped || !audioCtx) return;
      stopped = true;
      const t = audioCtx.currentTime;
      const rel = fast ? 0.025 : releaseSec;
      try {
        voiceGain.gain.cancelScheduledValues(t);
        voiceGain.gain.setValueAtTime(Math.max(0.0002, voiceGain.gain.value), t);
        voiceGain.gain.exponentialRampToValueAtTime(0.0001, t + rel);
        for (const node of nodesToStop) {
          node.stop(t + rel + 0.02);
        }
      } catch (_e) {}
    };
  }

  global.MidiMixerAudio = {
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
  };
})(window);
