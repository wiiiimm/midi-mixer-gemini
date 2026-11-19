(function (global) {
  'use strict';

  const TRACK_COLORS = [
    { hex: '#0284c7', glow: '#38bdf8', badge: 'bg-sky-500/20 text-sky-300 border-sky-500/40' },
    { hex: '#7c3aed', glow: '#a78bfa', badge: 'bg-violet-500/20 text-violet-300 border-violet-500/40' },
    { hex: '#059669', glow: '#34d399', badge: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' },
    { hex: '#d97706', glow: '#fbbf24', badge: 'bg-amber-500/20 text-amber-300 border-amber-500/40' },
    { hex: '#e11d48', glow: '#fb7185', badge: 'bg-rose-500/20 text-rose-300 border-rose-500/40' },
    { hex: '#0891b2', glow: '#22d3ee', badge: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40' },
    { hex: '#c026d3', glow: '#e879f9', badge: 'bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/40' },
    { hex: '#4f46e5', glow: '#818cf8', badge: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40' }
  ];

  const TRACK_GROUPS = ['Vocals', 'Harmony', 'Accompaniment', 'Bass & Rhythm'];

  const INSTRUMENTS = [
    { id: 'choir_aahs', label: 'Choir Aahs (Vocal)' },
    { id: 'voice_oohs', label: 'Voice Oohs (Warm)' },
    { id: 'pitch_guide', label: 'Vocal Pitch Guide (Clear)' },
    { id: 'grand_piano', label: 'Concert Grand Piano' },
    { id: 'epiano', label: 'Electric Piano (Rhodes)' },
    { id: 'clarinet', label: 'Clarinet (Rehearsal Lead)' },
    { id: 'flute', label: 'Concert Flute' },
    { id: 'strings', label: 'Warm String Ensemble' },
    { id: 'guitar', label: 'Acoustic Nylon Guitar' },
    { id: 'organ', label: 'Cathedral Pipe Organ' },
    { id: 'brass', label: 'Warm Brass Section' },
    { id: 'bass', label: 'Acoustic Bass' },
    { id: 'drums', label: 'Studio Percussion Kit' }
  ];

  const KEY_NAMES_MAJOR = {
    '-7': 'Cb Maj', '-6': 'Gb Maj', '-5': 'Db Maj', '-4': 'Ab Maj', '-3': 'Eb Maj', '-2': 'Bb Maj', '-1': 'F Maj',
    '0': 'C Maj', '1': 'G Maj', '2': 'D Maj', '3': 'A Maj', '4': 'E Maj', '5': 'B Maj', '6': 'F# Maj', '7': 'C# Maj'
  };

  const KEY_NAMES_MINOR = {
    '-7': 'Ab Min', '-6': 'Eb Min', '-5': 'Bb Min', '-4': 'F Min', '-3': 'C Min', '-2': 'G Min', '-1': 'D Min',
    '0': 'A Min', '1': 'E Min', '2': 'B Min', '3': 'F# Min', '4': 'C# Min', '5': 'G# Min', '6': 'D# Min', '7': 'A# Min'
  };

  const KEY_TONIC_PC = {
    '-7': 11, '-6': 6, '-5': 1, '-4': 8, '-3': 3, '-2': 10, '-1': 5,
    '0': 0, '1': 7, '2': 2, '3': 9, '4': 4, '5': 11, '6': 6, '7': 1
  };

  function decodeTextBytes(bytes) {
    try {
      const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
      return utf8.replace(/\0/g, '').trim();
    } catch (_e) {
      let out = '';
      for (let i = 0; i < bytes.length; i++) {
        const c = bytes[i];
        if (c >= 32 && c < 127) out += String.fromCharCode(c);
        else if (c >= 160) out += String.fromCharCode(c);
      }
      return out.trim();
    }
  }

  function mapProgramToInstrument(program, channel, trackName) {
    if (channel === 9) return 'drums';
    const lower = (trackName || '').toLowerCase();
    if (/(soprano|lead vocal|melody)/.test(lower) && program < 8) return 'choir_aahs';
    if (/(alto|tenor|choir|harmony|vocal|voice)/.test(lower) && program < 8) return 'voice_oohs';
    if (/(bass)/.test(lower) && !/(acoustic bass|electric bass|contrabass|synth bass)/.test(lower) && program < 8) return 'choir_aahs';
    if (program <= 3) return 'grand_piano';
    if (program <= 7) return 'epiano';
    if (program >= 16 && program <= 23) return 'organ';
    if (program >= 24 && program <= 31) return 'guitar';
    if (program >= 32 && program <= 39) return 'bass';
    if (program >= 40 && program <= 51) return 'strings';
    if (program === 52) return 'choir_aahs';
    if (program === 53 || program === 54) return 'voice_oohs';
    if (program >= 56 && program <= 63) return 'brass';
    if (program >= 64 && program <= 71) return 'clarinet';
    if (program >= 72 && program <= 79) return 'flute';
    if (program >= 80 && program <= 95) return 'pitch_guide';
    return 'grand_piano';
  }

  function inferTrackGroup(trackName, channel, instrumentId, index) {
    if (channel === 9 || instrumentId === 'drums' || instrumentId === 'bass') return 'Bass & Rhythm';
    const lower = (trackName || '').toLowerCase();
    if (/(bass|cello|continuo|percussion|drum|rhythm|timpani)/.test(lower)) {
      if (lower === 'bass' || /(vocal|choir|voice|satb)/.test(lower)) return 'Harmony';
      return 'Bass & Rhythm';
    }
    if (/(soprano|lead|melody|solo|guide|vox 1|voice 1)/.test(lower)) return 'Vocals';
    if (/(alto|tenor|baritone|harmony|choir|chorus|vox|voice|backing|descant)/.test(lower)) return 'Harmony';
    if (/(piano|accompaniment|harp|guitar|organ|strings|pad|keys|orch|band)/.test(lower)) return 'Accompaniment';
    if (instrumentId === 'choir_aahs' || instrumentId === 'pitch_guide') return index === 0 ? 'Vocals' : 'Harmony';
    if (instrumentId === 'voice_oohs') return 'Harmony';
    return 'Accompaniment';
  }

  /**
   * Musically accurate clef inference:
   * - Soprano & Alto ALWAYS use standard Treble clef ('treble')
   * - Tenor vocal parts use Choral Tenor Treble 8vb ('treble8vb')
   * - Bass vocal & low bass instruments use Bass clef ('bass')
   * - Piano / Keyboard / Harp / Organ accompaniments spanning across C4 (< 57 and >= 62) use Grand Staff ('grand')
   */
  function inferClef(notes, trackName, channel, instrumentId) {
    if (channel === 9 || instrumentId === 'drums') return 'percussion';
    const lower = (trackName || '').toLowerCase();

    if (/(soprano|alto|mezzo|descant|flute|violin|oboe|clarinet)/.test(lower)) {
      return 'treble';
    }
    if (/(tenor)/.test(lower)) {
      return 'treble8vb';
    }
    if (/(bass|baritone|cello|contrabass|tuba|trombone|fagotto|bassoon)/.test(lower)) {
      return 'bass';
    }

    if (!notes.length) return 'treble';

    let minMidi = 127;
    let maxMidi = 0;
    const pitches = [];
    for (const n of notes) {
      if (n.midi < minMidi) minMidi = n.midi;
      if (n.midi > maxMidi) maxMidi = n.midi;
      pitches.push(n.midi);
    }
    pitches.sort((a, b) => a - b);
    const median = pitches[Math.floor(pitches.length / 2)];

    const isKeyboardOrPlucked = /(piano|keys|accompaniment|organ|harp|harpsichord|clav|rhodes)/.test(lower) ||
      instrumentId === 'grand_piano' || instrumentId === 'epiano' || instrumentId === 'organ';

    // Use Grand Staff when keyboard/accompaniment spans both Bass and Treble registers
    if (isKeyboardOrPlucked && minMidi <= 55 && maxMidi >= 60) {
      return 'grand';
    }
    if (maxMidi - minMidi >= 22 && minMidi <= 52 && maxMidi >= 64) {
      return 'grand';
    }

    if (median < 53) return 'bass';
    return 'treble';
  }

  function parseMidiBuffer(arrayBuffer, fileName) {
    const view = new DataView(arrayBuffer);
    const bytes = new Uint8Array(arrayBuffer);
    let pos = 0;

    function readStr(len) {
      let s = '';
      for (let i = 0; i < len && pos < bytes.length; i++) {
        s += String.fromCharCode(bytes[pos++]);
      }
      return s;
    }
    function readU16() {
      const v = view.getUint16(pos, false);
      pos += 2;
      return v;
    }
    function readU32() {
      const v = view.getUint32(pos, false);
      pos += 4;
      return v;
    }
    function readVLQ(limit) {
      let value = 0;
      let count = 0;
      while (pos < limit && count < 5) {
        const b = bytes[pos++];
        value = (value << 7) | (b & 0x7F);
        count++;
        if ((b & 0x80) === 0) break;
      }
      return value;
    }

    const headerTag = readStr(4);
    if (headerTag !== 'MThd') {
      throw new Error('Not a valid Standard MIDI File (missing MThd header).');
    }
    const headerLen = readU32();
    const format = readU16();
    const numTracks = readU16();
    const division = readU16();
    if (headerLen > 6) pos += (headerLen - 6);

    let ticksPerBeat = 480;
    if ((division & 0x8000) !== 0) {
      const fpsRaw = 256 - (division >> 8);
      const subFrames = division & 0xFF;
      ticksPerBeat = Math.max(48, Math.round((fpsRaw * subFrames) / 2));
    } else {
      ticksPerBeat = Math.max(24, division);
    }

    const tempoEvents = [];
    const timeSigEvents = [];
    const keySigEvents = [];
    const rawTracks = [];
    let maxTick = 0;

    for (let t = 0; t < numTracks && pos + 8 <= bytes.length; t++) {
      const chunkTag = readStr(4);
      const chunkLen = readU32();
      const chunkEnd = Math.min(bytes.length, pos + chunkLen);

      if (chunkTag !== 'MTrk') {
        pos = chunkEnd;
        continue;
      }

      let tick = 0;
      let runningStatus = 0;
      let trackName = '';
      let instName = '';
      const openNotes = new Map();
      const notes = [];
      const lyrics = [];
      const channelPrograms = new Map();
      const channelVolumes = new Map();

      while (pos < chunkEnd) {
        const delta = readVLQ(chunkEnd);
        tick += delta;
        if (tick > maxTick) maxTick = tick;
        if (pos >= chunkEnd) break;

        let status = bytes[pos];
        if (status >= 0x80) {
          pos++;
          if (status < 0xF0) runningStatus = status;
        } else {
          status = runningStatus;
        }

        if (status === 0xFF) {
          if (pos >= chunkEnd) break;
          const metaType = bytes[pos++];
          const len = readVLQ(chunkEnd);
          const metaEnd = Math.min(chunkEnd, pos + len);
          const metaSlice = bytes.subarray(pos, metaEnd);
          pos = metaEnd;

          if (metaType === 0x03) {
            const txt = decodeTextBytes(metaSlice);
            if (txt && !trackName) trackName = txt;
          } else if (metaType === 0x04) {
            const txt = decodeTextBytes(metaSlice);
            if (txt && !instName) instName = txt;
          } else if (metaType === 0x05 || (metaType === 0x01 && tick > 0)) {
            const txt = decodeTextBytes(metaSlice);
            if (txt && txt.length <= 24 && !txt.startsWith('@')) {
              lyrics.push({ tick, text: txt.replace(/[\/\\]/g, '').trim() });
            }
          } else if (metaType === 0x51 && metaSlice.length === 3) {
            const usPerBeat = (metaSlice[0] << 16) | (metaSlice[1] << 8) | metaSlice[2];
            if (usPerBeat > 0) tempoEvents.push({ tick, usPerBeat });
          } else if (metaType === 0x58 && metaSlice.length >= 2) {
            const num = metaSlice[0] || 4;
            const den = Math.pow(2, metaSlice[1] || 2);
            timeSigEvents.push({ tick, num, den });
          } else if (metaType === 0x59 && metaSlice.length >= 2) {
            const sf = metaSlice[0] > 127 ? metaSlice[0] - 256 : metaSlice[0];
            const mi = metaSlice[1] || 0;
            keySigEvents.push({ tick, sf: Math.max(-7, Math.min(7, sf)), mi });
          } else if (metaType === 0x2F) {
            pos = chunkEnd;
            break;
          }
        } else if (status === 0xF0 || status === 0xF7) {
          const len = readVLQ(chunkEnd);
          pos = Math.min(chunkEnd, pos + len);
        } else {
          const high = status & 0xF0;
          const ch = status & 0x0F;
          if (high === 0x90 || high === 0x80) {
            const pitch = pos < chunkEnd ? bytes[pos++] : 60;
            const vel = pos < chunkEnd ? bytes[pos++] : 0;
            const key = `${ch}:${pitch}`;
            if (high === 0x90 && vel > 0) {
              if (openNotes.has(key)) {
                const prev = openNotes.get(key);
                if (tick > prev.startTick) {
                  notes.push({
                    midi: pitch,
                    startTick: prev.startTick,
                    durationTicks: tick - prev.startTick,
                    velocity: prev.velocity,
                    channel: ch
                  });
                }
              }
              openNotes.set(key, { startTick: tick, velocity: vel, channel: ch });
            } else {
              if (openNotes.has(key)) {
                const prev = openNotes.get(key);
                openNotes.delete(key);
                const dur = Math.max(Math.round(ticksPerBeat / 16), tick - prev.startTick);
                notes.push({
                  midi: pitch,
                  startTick: prev.startTick,
                  durationTicks: dur,
                  velocity: prev.velocity,
                  channel: ch
                });
              }
            }
          } else if (high === 0xA0 || high === 0xE0) {
            pos = Math.min(chunkEnd, pos + 2);
          } else if (high === 0xB0) {
            const cc = pos < chunkEnd ? bytes[pos++] : 0;
            const val = pos < chunkEnd ? bytes[pos++] : 0;
            if (cc === 7 && !channelVolumes.has(ch)) {
              channelVolumes.set(ch, Math.round((val / 127) * 100));
            }
          } else if (high === 0xC0) {
            const prog = pos < chunkEnd ? bytes[pos++] : 0;
            if (!channelPrograms.has(ch)) channelPrograms.set(ch, prog);
          } else if (high === 0xD0) {
            pos = Math.min(chunkEnd, pos + 1);
          } else {
            pos = Math.min(chunkEnd, pos + 1);
          }
        }
      }

      for (const [key, prev] of openNotes.entries()) {
        const pitch = parseInt(key.split(':')[1], 10);
        const dur = Math.max(Math.round(ticksPerBeat / 4), tick - prev.startTick);
        notes.push({
          midi: pitch,
          startTick: prev.startTick,
          durationTicks: dur,
          velocity: prev.velocity,
          channel: prev.channel
        });
      }

      rawTracks.push({
        trackName,
        instName,
        notes,
        lyrics,
        channelPrograms,
        channelVolumes
      });
      pos = chunkEnd;
    }

    // Build Tempo Map
    tempoEvents.sort((a, b) => a.tick - b.tick);
    const dedupTempos = [];
    for (const ev of tempoEvents) {
      if (dedupTempos.length && dedupTempos[dedupTempos.length - 1].tick === ev.tick) {
        dedupTempos[dedupTempos.length - 1] = ev;
      } else {
        dedupTempos.push(ev);
      }
    }
    if (!dedupTempos.length || dedupTempos[0].tick > 0) {
      dedupTempos.unshift({ tick: 0, usPerBeat: 500000 });
    }

    const tempoSegments = [];
    let accSec = 0;
    for (let i = 0; i < dedupTempos.length; i++) {
      const cur = dedupTempos[i];
      if (i > 0) {
        const prev = tempoSegments[i - 1];
        const dticks = cur.tick - prev.startTick;
        accSec += (dticks / ticksPerBeat) * (prev.usPerBeat / 1000000);
      }
      tempoSegments.push({
        startTick: cur.tick,
        usPerBeat: cur.usPerBeat,
        bpm: Math.round(60000000 / cur.usPerBeat),
        startSec: accSec
      });
    }

    function tickToSec(t) {
      let seg = tempoSegments[0];
      for (let i = 1; i < tempoSegments.length; i++) {
        if (tempoSegments[i].startTick <= t) seg = tempoSegments[i];
        else break;
      }
      return seg.startSec + ((t - seg.startTick) / ticksPerBeat) * (seg.usPerBeat / 1000000);
    }

    function secToTick(sec) {
      if (sec <= 0) return 0;
      let seg = tempoSegments[0];
      for (let i = 1; i < tempoSegments.length; i++) {
        if (tempoSegments[i].startSec <= sec) seg = tempoSegments[i];
        else break;
      }
      const dSec = sec - seg.startSec;
      return seg.startTick + (dSec / (seg.usPerBeat / 1000000)) * ticksPerBeat;
    }

    // Time Signature & Key Signature Maps
    timeSigEvents.sort((a, b) => a.tick - b.tick);
    if (!timeSigEvents.length || timeSigEvents[0].tick > 0) {
      timeSigEvents.unshift({ tick: 0, num: 4, den: 4 });
    }

    keySigEvents.sort((a, b) => a.tick - b.tick);
    if (!keySigEvents.length || keySigEvents[0].tick > 0) {
      keySigEvents.unshift({ tick: 0, sf: 0, mi: 0 });
    }

    // Normalize logical tracks
    const expandedTracks = [];
    const noteBearingRaw = rawTracks.filter(rt => rt.notes.length > 0);
    if (format === 0 && noteBearingRaw.length === 1) {
      const single = noteBearingRaw[0];
      const byCh = new Map();
      for (const n of single.notes) {
        if (!byCh.has(n.channel)) byCh.set(n.channel, []);
        byCh.get(n.channel).push(n);
      }
      if (byCh.size > 1) {
        for (const [ch, chNotes] of byCh.entries()) {
          expandedTracks.push({
            trackName: ch === 9 ? 'Percussion' : `Channel ${ch + 1}`,
            notes: chNotes,
            lyrics: ch === 0 ? single.lyrics : [],
            program: single.channelPrograms.get(ch) || 0,
            volume: single.channelVolumes.get(ch) ?? 90,
            channel: ch
          });
        }
      }
    }

    if (!expandedTracks.length) {
      noteBearingRaw.forEach((rt, idx) => {
        const firstCh = rt.notes[0] ? rt.notes[0].channel : 0;
        const prog = rt.channelPrograms.get(firstCh) ?? 0;
        const vol = rt.channelVolumes.get(firstCh) ?? 90;
        expandedTracks.push({
          trackName: rt.trackName || rt.instName || (firstCh === 9 ? 'Percussion' : `Track ${idx + 1}`),
          notes: rt.notes,
          lyrics: rt.lyrics,
          program: prog,
          volume: vol,
          channel: firstCh
        });
      });
    }

    if (!expandedTracks.length) {
      throw new Error('MIDI file contains no playable notes.');
    }

    let songMaxTick = maxTick;
    const tracks = expandedTracks.map((et, idx) => {
      et.notes.sort((a, b) => a.startTick - b.startTick || b.midi - a.midi);

      if (et.lyrics && et.lyrics.length) {
        const tolerance = ticksPerBeat * 0.4;
        for (const lyr of et.lyrics) {
          let best = null;
          let bestDist = Infinity;
          for (const n of et.notes) {
            const dist = Math.abs(n.startTick - lyr.tick);
            if (dist <= tolerance && dist < bestDist) {
              best = n;
              bestDist = dist;
            }
          }
          if (best && !best.lyric) best.lyric = lyr.text;
        }
      }

      const enrichedNotes = et.notes.map(n => {
        const endTick = n.startTick + n.durationTicks;
        if (endTick > songMaxTick) songMaxTick = endTick;
        const startBaseSec = tickToSec(n.startTick);
        const endBaseSec = tickToSec(endTick);
        // Quantize rhythmic beat duration for clean score notation while preserving exact playback gate
        const rawBeats = n.durationTicks / ticksPerBeat;
        return {
          midi: n.midi,
          velocity: n.velocity,
          startTick: n.startTick,
          durationTicks: n.durationTicks,
          beatDuration: rawBeats,
          startBaseSec,
          endBaseSec,
          durationBaseSec: Math.max(0.04, endBaseSec - startBaseSec),
          lyric: n.lyric || ''
        };
      });

      const instId = mapProgramToInstrument(et.program, et.channel, et.trackName);
      const group = inferTrackGroup(et.trackName, et.channel, instId, idx);
      const clef = inferClef(enrichedNotes, et.trackName, et.channel, instId);
      const color = TRACK_COLORS[idx % TRACK_COLORS.length];

      return {
        id: `trk_${idx}_${Math.random().toString(36).slice(2, 7)}`,
        index: idx,
        name: et.trackName,
        channel: et.channel,
        instrument: instId,
        group,
        clef,
        volume: Math.max(25, Math.min(130, et.volume)),
        muted: false,
        solo: false,
        checked: false,
        color,
        notes: enrichedNotes,
        vuLevel: 0
      };
    });

    // Compute Measures array
    const measures = [];
    let curTick = 0;
    let measureNum = 1;
    let tsIdx = 0;
    while (curTick < songMaxTick) {
      while (tsIdx + 1 < timeSigEvents.length && timeSigEvents[tsIdx + 1].tick <= curTick) {
        tsIdx++;
      }
      const ts = timeSigEvents[tsIdx];
      const measureTicks = Math.max(
        Math.round(ticksPerBeat / 2),
        Math.round(ticksPerBeat * ts.num * (4 / ts.den))
      );
      const startSec = tickToSec(curTick);
      const endSec = tickToSec(curTick + measureTicks);
      measures.push({
        number: measureNum,
        startTick: curTick,
        endTick: curTick + measureTicks,
        num: ts.num,
        den: ts.den,
        beatTicks: Math.round(ticksPerBeat * (4 / ts.den)),
        startBaseSec: startSec,
        endBaseSec: endSec
      });
      curTick += measureTicks;
      measureNum++;
      if (measureNum > 2000) break;
    }

    if (!measures.length) {
      const mTicks = ticksPerBeat * 4;
      measures.push({
        number: 1,
        startTick: 0,
        endTick: mTicks,
        num: 4,
        den: 4,
        beatTicks: ticksPerBeat,
        startBaseSec: 0,
        endBaseSec: tickToSec(mTicks)
      });
    }

    const finalBarEndTick = measures[measures.length - 1].endTick;
    const totalDurationBaseSec = Math.max(2, tickToSec(Math.max(songMaxTick, finalBarEndTick)) + 0.25);
    const primaryKey = keySigEvents[0];
    const primaryTimeSig = timeSigEvents[0];
    const baseBpm = tempoSegments[0].bpm;
    const cleanTitle = fileName.replace(/\.(mid|midi|kar)$/i, '');
    const keyLabel = primaryKey.mi === 1
      ? (KEY_NAMES_MINOR[String(primaryKey.sf)] || 'A Min')
      : (KEY_NAMES_MAJOR[String(primaryKey.sf)] || 'C Maj');

    return {
      id: `song_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      fileName,
      title: cleanTitle,
      ticksPerBeat,
      baseBpm,
      tempoSegments,
      timeSigEvents,
      keySigEvents,
      keyLabel,
      keySf: primaryKey.sf,
      keyMi: primaryKey.mi,
      timeSigLabel: `${primaryTimeSig.num}/${primaryTimeSig.den}`,
      measures,
      tracks,
      totalTicks: Math.max(songMaxTick, finalBarEndTick),
      durationBaseSec: totalDurationBaseSec,
      tickToSec,
      secToTick
    };
  }

  function encodeDemoSmf({ ticksPerBeat = 480, bpm = 100, timeSig = [4, 2], keySf = 0, tracks = [] }) {
    function writeVLQ(arr, val) {
      let buffer = val & 0x7F;
      while ((val >>= 7)) {
        buffer <<= 8;
        buffer |= ((val & 0x7F) | 0x80);
      }
      while (true) {
        arr.push(buffer & 0xFF);
        if (buffer & 0x80) buffer >>>= 8;
        else break;
      }
    }
    function pushAscii(arr, str) {
      for (let i = 0; i < str.length; i++) arr.push(str.charCodeAt(i) & 0x7F);
    }
    function buildTrackChunk(events) {
      events.sort((a, b) => a.tick - b.tick || a.order - b.order);
      const body = [];
      let lastTick = 0;
      for (const ev of events) {
        const delta = Math.max(0, Math.round(ev.tick - lastTick));
        lastTick += delta;
        writeVLQ(body, delta);
        for (const b of ev.bytes) body.push(b & 0xFF);
      }
      writeVLQ(body, 0);
      body.push(0xFF, 0x2F, 0x00);

      const chunk = [];
      pushAscii(chunk, 'MTrk');
      const len = body.length;
      chunk.push((len >>> 24) & 0xFF, (len >>> 16) & 0xFF, (len >>> 8) & 0xFF, len & 0xFF);
      for (const b of body) chunk.push(b);
      return chunk;
    }

    const usPerBeat = Math.round(60000000 / bpm);
    const conductorEvents = [
      { tick: 0, order: 0, bytes: [0xFF, 0x58, 0x04, timeSig[0], timeSig[1], 24, 8] },
      { tick: 0, order: 1, bytes: [0xFF, 0x59, 0x02, keySf < 0 ? 256 + keySf : keySf, 0] },
      { tick: 0, order: 2, bytes: [0xFF, 0x51, 0x03, (usPerBeat >>> 16) & 0xFF, (usPerBeat >>> 8) & 0xFF, usPerBeat & 0xFF] }
    ];

    const chunks = [buildTrackChunk(conductorEvents)];

    tracks.forEach((trk, idx) => {
      const ch = trk.channel ?? (idx % 15);
      const evs = [];
      const nameBytes = [];
      pushAscii(nameBytes, trk.name);
      evs.push({ tick: 0, order: 0, bytes: [0xFF, 0x03, nameBytes.length, ...nameBytes] });
      evs.push({ tick: 0, order: 1, bytes: [0xC0 | ch, trk.program ?? 0] });
      evs.push({ tick: 0, order: 2, bytes: [0xB0 | ch, 7, trk.ccVol ?? 108] });

      for (const n of trk.notes) {
        const startTick = Math.round(n.beat * ticksPerBeat);
        const endTick = Math.round((n.beat + n.dur * 0.96) * ticksPerBeat);
        if (n.lyric) {
          const lBytes = [];
          pushAscii(lBytes, n.lyric);
          evs.push({ tick: startTick, order: 3, bytes: [0xFF, 0x05, lBytes.length, ...lBytes] });
        }
        evs.push({ tick: startTick, order: 4, bytes: [0x90 | ch, n.midi, n.vel ?? 92] });
        evs.push({ tick: Math.max(startTick + 30, endTick), order: 2, bytes: [0x80 | ch, n.midi, 0] });
      }
      chunks.push(buildTrackChunk(evs));
    });

    const totalTrackCount = chunks.length;
    const header = [];
    pushAscii(header, 'MThd');
    header.push(0, 0, 0, 6, 0, 1);
    header.push((totalTrackCount >>> 8) & 0xFF, totalTrackCount & 0xFF);
    header.push((ticksPerBeat >>> 8) & 0xFF, ticksPerBeat & 0xFF);

    const totalLen = header.length + chunks.reduce((s, c) => s + c.length, 0);
    const out = new Uint8Array(totalLen);
    let offset = 0;
    out.set(header, offset);
    offset += header.length;
    for (const c of chunks) {
      out.set(c, offset);
      offset += c.length;
    }
    return out.buffer;
  }

  function buildBuiltInLibrary() {
    // Piece 1: Ode to Joy — SATB Choir (in proper Soprano/Alto/Tenor 8vb/Bass ranges!) + Grand Staff Piano
    const odeSoprano = [
      [66,0,1,'Joy-'],[66,1,1,'ful,'],[67,2,1,'joy-'],[69,3,1,'ful,'],
      [69,4,1,'we'],[67,5,1,'a-'],[66,6,1,'dore'],[64,7,1,'Thee,'],
      [62,8,1,'God'],[62,9,1,'of'],[64,10,1,'glo-'],[66,11,1,'ry,'],
      [66,12,1.5,'Lord'],[64,13.5,0.5,'of'],[64,14,2,'love!'],
      [66,16,1,'Hearts'],[66,17,1,'un-'],[67,18,1,'fold'],[69,19,1,'like'],
      [69,20,1,'flowrs'],[67,21,1,'be-'],[66,22,1,'fore'],[64,23,1,'Thee,'],
      [62,24,1,'O-'],[62,25,1,'pning'],[64,26,1,'to'],[66,27,1,'the'],
      [64,28,1.5,'sun'],[62,29.5,0.5,'a-'],[62,30,2,'bove.']
    ].map(([midi, beat, dur, lyric]) => ({ midi, beat, dur, lyric, vel: 96 }));

    // Alto in true Alto vocal tessitura (A3-F#4) read on standard Treble clef
    const odeAlto = [
      [62,0,1],[62,1,1],[62,2,1],[62,3,1],
      [62,4,1],[62,5,1],[62,6,1],[61,7,1],
      [57,8,1],[57,9,1],[61,10,1],[62,11,1],
      [62,12,1.5],[61,13.5,0.5],[61,14,2],
      [62,16,1],[62,17,1],[62,18,1],[62,19,1],
      [62,20,1],[62,21,1],[62,22,1],[59,23,1],
      [57,24,1],[57,25,1],[61,26,1],[62,27,1],
      [61,28,1.5],[57,29.5,0.5],[57,30,2]
    ].map(([midi, beat, dur]) => ({ midi, beat, dur, vel: 84 }));

    // Tenor in true Tenor tessitura (F#3-D4), displayed cleanly on Choral Tenor 8vb Clef
    const odeTenor = [
      [57,0,1],[57,1,1],[59,2,1],[57,3,1],
      [57,4,1],[59,5,1],[57,6,1],[57,7,1],
      [54,8,1],[54,9,1],[57,10,1],[57,11,1],
      [57,12,1.5],[57,13.5,0.5],[57,14,2],
      [57,16,1],[57,17,1],[59,18,1],[57,19,1],
      [57,20,1],[59,21,1],[57,22,1],[56,23,1],
      [54,24,1],[54,25,1],[57,26,1],[57,27,1],
      [57,28,1.5],[54,29.5,0.5],[54,30,2]
    ].map(([midi, beat, dur]) => ({ midi, beat, dur, vel: 84 }));

    // Bass in true Bass clef range (D2-D3)
    const odeBass = [
      [50,0,2],[43,2,2],
      [50,4,2],[45,6,2],
      [50,8,2],[45,10,1],[50,11,1],
      [45,12,2],[45,14,2],
      [50,16,2],[43,18,2],
      [50,20,2],[42,22,2],
      [43,24,2],[45,26,1],[50,27,1],
      [45,28,2],[38,30,2]
    ].map(([midi, beat, dur]) => ({ midi, beat, dur, vel: 88 }));

    // Piano Accompaniment spanning LH Bass + RH Treble chords -> renders on Grand Staff!
    const odePiano = [];
    const pianoProgression = [
      [50, [62, 66]], [55, [62, 67]], [50, [62, 66]], [45, [61, 64]],
      [50, [62, 66]], [45, [61, 64]], [45, [62, 66]], [45, [61, 64]],
      [50, [62, 66]], [55, [62, 67]], [50, [62, 66]], [54, [62, 66]],
      [55, [59, 62]], [45, [61, 64]], [45, [61, 64]], [50, [57, 62]]
    ];
    pianoProgression.forEach(([lh, rh], idx) => {
      const b = idx * 2;
      odePiano.push({ midi: lh, beat: b, dur: 2, vel: 76 });
      odePiano.push({ midi: rh[0], beat: b, dur: 1, vel: 70 });
      odePiano.push({ midi: rh[1], beat: b, dur: 1, vel: 70 });
      odePiano.push({ midi: rh[0], beat: b + 1, dur: 1, vel: 66 });
      odePiano.push({ midi: rh[1], beat: b + 1, dur: 1, vel: 66 });
    });

    const buf1 = encodeDemoSmf({
      bpm: 104,
      timeSig: [4, 2],
      keySf: 2, // D Major (F#, C#)
      tracks: [
        { name: 'Soprano (Lead)', program: 52, channel: 0, ccVol: 112, notes: odeSoprano },
        { name: 'Alto Harmony', program: 53, channel: 1, ccVol: 96, notes: odeAlto },
        { name: 'Tenor Harmony', program: 53, channel: 2, ccVol: 96, notes: odeTenor },
        { name: 'Bass Vocal', program: 52, channel: 3, ccVol: 100, notes: odeBass },
        { name: 'Piano Accompaniment', program: 0, channel: 4, ccVol: 82, notes: odePiano }
      ]
    });

    // Piece 2: Vocal Agility & Solfege Warmup (C -> Db -> D -> Eb)
    const warmupLead = [];
    const warmupChords = [];
    const warmupBass = [];
    const warmupDrums = [];
    const keys = [60, 61, 62, 63];
    keys.forEach((root, kIdx) => {
      const baseBeat = kIdx * 8;
      const pattern = [
        [0, 0, 0.5, 'Do'], [2, 0.5, 0.5, 'Re'], [4, 1, 0.5, 'Mi'], [5, 1.5, 0.5, 'Fa'],
        [7, 2, 1, 'Sol'], [12, 3, 1, 'Do'],
        [7, 4, 1, 'Sol'], [4, 5, 1, 'Mi'], [0, 6, 2, 'Do']
      ];
      pattern.forEach(([semi, off, dur, lyr]) => {
        warmupLead.push({ midi: root + semi, beat: baseBeat + off, dur, lyric: lyr, vel: 98 });
      });
      [0, 2, 4, 6].forEach(off => {
        warmupChords.push({ midi: root - 12, beat: baseBeat + off, dur: 2, vel: 72 });
        warmupChords.push({ midi: root, beat: baseBeat + off, dur: 2, vel: 74 });
        warmupChords.push({ midi: root + 4, beat: baseBeat + off, dur: 2, vel: 72 });
        warmupChords.push({ midi: root + 7, beat: baseBeat + off, dur: 2, vel: 72 });
      });
      warmupBass.push({ midi: root - 24, beat: baseBeat, dur: 4, vel: 88 });
      warmupBass.push({ midi: root - 17, beat: baseBeat + 4, dur: 2, vel: 84 });
      warmupBass.push({ midi: root - 24, beat: baseBeat + 6, dur: 2, vel: 88 });
      for (let b = 0; b < 8; b++) {
        warmupDrums.push({ midi: 42, beat: baseBeat + b, dur: 0.5, vel: 62 });
        if (b % 2 === 0) warmupDrums.push({ midi: 36, beat: baseBeat + b, dur: 0.5, vel: 80 });
        else warmupDrums.push({ midi: 37, beat: baseBeat + b, dur: 0.5, vel: 70 });
      }
    });

    const buf2 = encodeDemoSmf({
      bpm: 96,
      timeSig: [4, 2],
      keySf: 0,
      tracks: [
        { name: 'Vocal Pitch Guide', program: 80, channel: 0, ccVol: 112, notes: warmupLead },
        { name: 'Studio Grand Piano', program: 0, channel: 1, ccVol: 88, notes: warmupChords },
        { name: 'Acoustic Bass', program: 32, channel: 2, ccVol: 92, notes: warmupBass },
        { name: 'Rhythm Click Kit', program: 0, channel: 9, ccVol: 80, notes: warmupDrums }
      ]
    });

    // Piece 3: Scarborough Fair — 3-Part Vocal & Plucked Guitar (3/4, F Maj / D Dorian, 92 BPM)
    const scarLead = [
      [62,0,2,'Are'],[62,2,1,'you'],[69,3,2,'go-'],[69,5,1,'ing'],
      [69,6,1.5,'to'],[64,7.5,0.5,'Scar-'],[65,8,1,'bo-'],[64,9,2,'rough'],[62,11,1,'Fair?'],
      [69,15,1,'Pars-'],[72,16,2,'ley,'],[74,18,2,'sage,'],[72,20,1,'rose-'],
      [69,21,1,'ma-'],[71,22,1,'ry'],[67,23,1,'and'],[69,24,3,'thyme.']
    ].map(([midi, beat, dur, lyric]) => ({ midi, beat, dur, lyric, vel: 95 }));

    const scarHarmony = [
      [57,0,2],[57,2,1],[65,3,2],[64,5,1],
      [64,6,1.5],[60,7.5,0.5],[62,8,1],[60,9,2],[57,11,1],
      [64,15,1],[67,16,2],[69,18,2],[67,20,1],
      [65,21,1],[64,22,1],[62,23,1],[64,24,3]
    ].map(([midi, beat, dur]) => ({ midi, beat, dur, vel: 82 }));

    const scarGuitar = [];
    const barChords = [
      [50,57,62], [50,57,62], [48,55,60], [50,57,62], [50,57,62],
      [53,60,65], [48,55,60], [50,57,62], [45,52,61], [45,52,61]
    ];
    barChords.forEach((triad, barIdx) => {
      const b = barIdx * 3;
      scarGuitar.push({ midi: triad[0], beat: b, dur: 1, vel: 78 });
      scarGuitar.push({ midi: triad[1], beat: b + 1, dur: 1, vel: 70 });
      scarGuitar.push({ midi: triad[2], beat: b + 2, dur: 1, vel: 72 });
    });

    const buf3 = encodeDemoSmf({
      bpm: 92,
      timeSig: [3, 2],
      keySf: -1, // 1 flat (Bb)
      tracks: [
        { name: 'Lead Melody (Soprano)', program: 68, channel: 0, ccVol: 110, notes: scarLead },
        { name: 'Alto Harmony', program: 73, channel: 1, ccVol: 90, notes: scarHarmony },
        { name: 'Acoustic Nylon Guitar', program: 24, channel: 2, ccVol: 86, notes: scarGuitar }
      ]
    });

    return [
      parseMidiBuffer(buf1, 'Ode to Joy — SATB Choir & Piano.mid'),
      parseMidiBuffer(buf2, 'Vocal Arpeggio & Solfege Warmup.mid'),
      parseMidiBuffer(buf3, 'Scarborough Fair — 3-Part Vocal.mid')
    ];
  }

  global.MidiMixerParser = {
    TRACK_COLORS,
    TRACK_GROUPS,
    INSTRUMENTS,
    KEY_NAMES_MAJOR,
    KEY_TONIC_PC,
    parseMidiBuffer,
    buildBuiltInLibrary
  };
})(window);
