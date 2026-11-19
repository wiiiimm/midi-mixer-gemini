(function (global) {
  'use strict';

  const SINGLE_STAFF_ROW_HEIGHT = 138;
  const GRAND_STAFF_ROW_HEIGHT = 206;

  const PITCH_CLASS_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const PITCH_CLASS_FLAT  = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  const SOLFEGE_SYLLABLES = ['Do', 'Di', 'Re', 'Ri', 'Mi', 'Fa', 'Fi', 'Sol', 'Si', 'La', 'Li', 'Ti'];

  const SHARP_SPELLING = [
    { d: 0, a: 0 }, { d: 0, a: 1 }, { d: 1, a: 0 }, { d: 1, a: 1 },
    { d: 2, a: 0 }, { d: 3, a: 0 }, { d: 3, a: 1 }, { d: 4, a: 0 },
    { d: 4, a: 1 }, { d: 5, a: 0 }, { d: 5, a: 1 }, { d: 6, a: 0 }
  ];
  const FLAT_SPELLING = [
    { d: 0, a: 0 }, { d: 1, a: -1 }, { d: 1, a: 0 }, { d: 2, a: -1 },
    { d: 2, a: 0 }, { d: 3, a: 0 },  { d: 4, a: -1 }, { d: 4, a: 0 },
    { d: 5, a: -1 }, { d: 5, a: 0 }, { d: 6, a: -1 }, { d: 6, a: 0 }
  ];

  const SHARP_ORDER_DIATONIC = [3, 0, 4, 1, 5, 2, 6]; // F C G D A E B
  const FLAT_ORDER_DIATONIC  = [6, 2, 5, 1, 4, 0, 3]; // B E A D G C F

  // Exact traditional staff-step offsets (from Line 1 = 0) for Key Signatures
  const KEY_SIG_STEPS = {
    treble_sharp: [8, 5, 9, 6, 3, 7, 4], // F5 C5 G5 D5 A4 E5 B4
    bass_sharp:   [6, 3, 7, 4, 1, 5, 2], // F3 C3 G3 D3 A2 E3 B2
    treble_flat:  [4, 7, 3, 6, 2, 5, 1], // B4 E5 A4 D5 G4 C5 F4
    bass_flat:    [2, 5, 1, 4, 0, 3, -1] // B2 E3 A2 D3 G2 C3 F2
  };

  function getTrackRowHeight(track) {
    return track && track.clef === 'grand' ? GRAND_STAFF_ROW_HEIGHT : SINGLE_STAFF_ROW_HEIGHT;
  }

  function getStaffGutterWidth(song) {
    const accidentals = song ? Math.abs(song.keySf || 0) : 0;
    return 86 + accidentals * 8;
  }

  function formatNoteName(midi, preferFlats) {
    const oct = Math.floor(midi / 12) - 1;
    const pc = ((midi % 12) + 12) % 12;
    return (preferFlats ? PITCH_CLASS_FLAT[pc] : PITCH_CLASS_SHARP[pc]) + oct;
  }

  function formatSolfege(midi, keySf, keyTonicMap) {
    const tonic = keyTonicMap[String(keySf)] ?? 0;
    const rel = (((midi % 12) - tonic) % 12 + 12) % 12;
    return SOLFEGE_SYLLABLES[rel];
  }

  function getKeyAlterationMap(sf) {
    const map = [0, 0, 0, 0, 0, 0, 0];
    if (sf > 0) {
      for (let i = 0; i < Math.min(7, sf); i++) map[SHARP_ORDER_DIATONIC[i]] = 1;
    } else if (sf < 0) {
      for (let i = 0; i < Math.min(7, -sf); i++) map[FLAT_ORDER_DIATONIC[i]] = -1;
    }
    return map;
  }

  function spellPitchOnSubStaff(midi, subClef, keySf, keyAlterMap) {
    if (subClef === 'percussion') {
      let stepOffset = 4;
      if (midi === 35 || midi === 36) stepOffset = 1;
      else if (midi === 38 || midi === 40 || midi === 37) stepOffset = 5;
      else if (midi === 42 || midi === 44 || midi === 46) stepOffset = 9;
      else if (midi === 49 || midi === 51) stepOffset = 10;
      return { offsetSteps: stepOffset, diatonicKey: stepOffset, alter: 0, isDrum: true };
    }

    const octave = Math.floor(midi / 12) - 1;
    const pc = ((midi % 12) + 12) % 12;
    const preferFlats = keySf < 0;

    let chosen = preferFlats ? FLAT_SPELLING[pc] : SHARP_SPELLING[pc];
    for (let d = 0; d < 7; d++) {
      const baseSemis = [0, 2, 4, 5, 7, 9, 11][d];
      const keyPc = ((baseSemis + keyAlterMap[d]) % 12 + 12) % 12;
      if (keyPc === pc) {
        chosen = { d, a: keyAlterMap[d] };
        break;
      }
    }

    let octaveAdj = octave;
    if (chosen.d === 6 && chosen.a === 1 && pc === 0) octaveAdj -= 1;
    if (chosen.d === 0 && chosen.a === -1 && pc === 11) octaveAdj += 1;

    const absStep = octaveAdj * 7 + chosen.d;
    // Reference bottom line (Line 1):
    // Treble E4 = 30 | Tenor 8vb E3 = 23 | Bass G2 = 18
    const refStep = subClef === 'bass' ? 18 : subClef === 'treble8vb' ? 23 : 30;
    return {
      offsetSteps: absStep - refStep,
      absStep,
      diatonicIdx: chosen.d,
      alter: chosen.a,
      isDrum: false
    };
  }

  // =========================================================================
  // PRECISION VECTOR MUSICAL GLYPHS (OS-FONT INDEPENDENT)
  // =========================================================================
  function drawVectorSharp(ctx, x, y, scale, color) {
    const s = scale || 1;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    // Two vertical lines
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.moveTo(-2.1, -6.8);
    ctx.lineTo(-2.1, 7.2);
    ctx.moveTo(2.1, -7.2);
    ctx.lineTo(2.1, 6.8);
    ctx.stroke();
    // Two slanted heavy crossbars
    ctx.lineWidth = 2.1;
    ctx.beginPath();
    ctx.moveTo(-4.4, -1.6);
    ctx.lineTo(4.4, -3.4);
    ctx.moveTo(-4.4, 3.4);
    ctx.lineTo(4.4, 1.6);
    ctx.stroke();
    ctx.restore();
  }

  function drawVectorFlat(ctx, x, y, scale, color) {
    const s = scale || 1;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // Vertical stem ascending well above target line/space
    ctx.lineWidth = 1.35;
    ctx.beginPath();
    ctx.moveTo(-2.6, -10.5);
    ctx.lineTo(-2.6, 4.2);
    ctx.stroke();
    // Teardrop belly centered around y = 0
    ctx.lineWidth = 1.7;
    ctx.beginPath();
    ctx.moveTo(-2.6, -1.8);
    ctx.bezierCurveTo(3.8, -5.2, 4.5, 0.8, -2.6, 4.2);
    ctx.stroke();
    ctx.restore();
  }

  function drawVectorNatural(ctx, x, y, scale, color) {
    const s = scale || 1;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    // Left stem (high top, middle bottom)
    ctx.moveTo(-2.3, -7.2);
    ctx.lineTo(-2.3, 3.2);
    // Right stem (middle top, low bottom)
    ctx.moveTo(2.3, -3.2);
    ctx.lineTo(2.3, 7.2);
    ctx.stroke();

    ctx.lineWidth = 1.9;
    ctx.beginPath();
    ctx.moveTo(-2.3, -2.0);
    ctx.lineTo(2.3, -3.4);
    ctx.moveTo(-2.3, 3.2);
    ctx.lineTo(2.3, 1.8);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Draws an engraved Vector Treble (G) Clef anchored directly to Line 2 (G4).
   */
  function drawVectorTrebleClef(ctx, leftX, bottomLineY, lineSpacing, is8vb, color) {
    const s = lineSpacing; // ~8.5px
    const gLineY = bottomLineY - s; // Line 2 = G4
    const cx = leftX + 13;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Main G-spiral -> outer belly -> upper loop -> straight spine -> lower hook
    ctx.lineWidth = 1.95;
    ctx.beginPath();
    // Start inside G4 curl
    ctx.moveTo(cx - 1.5, gLineY - 0.15 * s);
    ctx.bezierCurveTo(cx + 3.5, gLineY - 0.65 * s, cx + 6.8, gLineY - 0.05 * s, cx + 6.2, gLineY + 0.55 * s);
    // Curve along bottom Line 1 (E4)
    ctx.bezierCurveTo(cx + 5.2, bottomLineY + 0.22 * s, cx - 5.2, bottomLineY + 0.18 * s, cx - 6.8, gLineY - 0.15 * s);
    // Sweep diagonally up across Line 3 & Line 4 into upper S-loop above Line 5
    ctx.bezierCurveTo(cx - 8.2, bottomLineY - 2.1 * s, cx + 4.8, bottomLineY - 3.3 * s, cx + 3.6, bottomLineY - 4.75 * s);
    ctx.bezierCurveTo(cx + 3.0, bottomLineY - 5.45 * s, cx - 1.2, bottomLineY - 5.35 * s, cx - 1.1, bottomLineY - 4.35 * s);
    // Straight descending spine all the way through staff to hook below Line 1
    ctx.lineTo(cx + 0.6, bottomLineY + 1.25 * s);
    ctx.bezierCurveTo(cx + 0.9, bottomLineY + 1.95 * s, cx - 4.2, bottomLineY + 2.0 * s, cx - 4.8, bottomLineY + 1.35 * s);
    ctx.stroke();

    // Terminal solid ball at lower hook
    ctx.beginPath();
    ctx.arc(cx - 4.2, bottomLineY + 1.32 * s, 2.1, 0, Math.PI * 2);
    ctx.fill();

    if (is8vb) {
      ctx.font = 'italic 700 10px Georgia, serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText('8', cx - 1, bottomLineY + 1.85 * s);
    }
    ctx.restore();
  }

  /**
   * Draws an engraved Vector Bass (F) Clef anchored directly to Line 4 (F3).
   */
  function drawVectorBassClef(ctx, leftX, bottomLineY, lineSpacing, color) {
    const s = lineSpacing;
    const fLineY = bottomLineY - 3 * s; // Line 4 = F3
    const cx = leftX + 10;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineCap = 'round';

    // Solid origin bulb on F3 line
    ctx.beginPath();
    ctx.arc(cx - 1.5, fLineY + 0.08 * s, 2.7, 0, Math.PI * 2);
    ctx.fill();

    // Graceful sweeping C-curve from F3 bulb up to Line 5 and down to Line 1.3
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(cx - 1.5, fLineY);
    ctx.bezierCurveTo(cx - 2.0, bottomLineY - 4.05 * s, cx + 8.5, bottomLineY - 4.05 * s, cx + 8.2, bottomLineY - 2.55 * s);
    ctx.bezierCurveTo(cx + 7.9, bottomLineY - 1.25 * s, cx + 2.0, bottomLineY - 0.35 * s, cx - 3.8, bottomLineY - 0.1 * s);
    ctx.stroke();

    // Two classic dots straddling Line 4 (in Space 4 and Space 3)
    ctx.beginPath();
    ctx.arc(cx + 12.2, bottomLineY - 3.45 * s, 1.65, 0, Math.PI * 2);
    ctx.arc(cx + 12.2, bottomLineY - 2.55 * s, 1.65, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function drawVectorPercussionClef(ctx, leftX, bottomLineY, lineSpacing, color) {
    const s = lineSpacing;
    ctx.save();
    ctx.fillStyle = color;
    ctx.fillRect(leftX + 9, bottomLineY - 3 * s, 2.8, 2 * s);
    ctx.fillRect(leftX + 15, bottomLineY - 3 * s, 2.8, 2 * s);
    ctx.restore();
  }

  function drawGrandStaffBrace(ctx, x, topY, bottomY, color) {
    const midY = (topY + bottomY) / 2;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.0;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x + 5, topY);
    ctx.bezierCurveTo(x - 1, topY + 8, x + 2, midY - 10, x - 3.5, midY);
    ctx.bezierCurveTo(x + 2, midY + 10, x - 1, bottomY - 8, x + 5, bottomY);
    ctx.stroke();
    ctx.restore();
  }

  function drawKeySignatureOnStaff(ctx, startX, bottomLineY, stepPx, subClef, keySf, color) {
    if (!keySf || subClef === 'percussion') return startX;
    const isBass = subClef === 'bass';
    const count = Math.min(7, Math.abs(keySf));
    const steps = keySf > 0
      ? (isBass ? KEY_SIG_STEPS.bass_sharp : KEY_SIG_STEPS.treble_sharp)
      : (isBass ? KEY_SIG_STEPS.bass_flat : KEY_SIG_STEPS.treble_flat);

    let x = startX;
    for (let i = 0; i < count; i++) {
      const y = bottomLineY - steps[i] * stepPx;
      if (keySf > 0) drawVectorSharp(ctx, x + 3, y, 0.85, color);
      else drawVectorFlat(ctx, x + 3, y, 0.88, color);
      x += 8;
    }
    return x + 3;
  }

  function drawTimeSignatureOnStaff(ctx, x, bottomLineY, lineSpacing, num, den, color) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.font = '700 15px Georgia, "Times New Roman", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Upper number centered on Lines 3..5 (bottomLineY - 3*s)
    ctx.fillText(String(num), x, bottomLineY - 3 * lineSpacing + 0.5);
    // Lower number centered on Lines 1..3 (bottomLineY - 1*s)
    ctx.fillText(String(den), x, bottomLineY - 1 * lineSpacing + 0.5);
    ctx.restore();
  }

  function drawQuarterRest(ctx, x, bottomLineY, lineSpacing, color) {
    const midY = bottomLineY - 2 * lineSpacing;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.8;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x - 2, midY - 8);
    ctx.lineTo(x + 2.5, midY - 3);
    ctx.lineTo(x - 2.5, midY + 1.5);
    ctx.lineTo(x + 2, midY + 6);
    ctx.quadraticCurveTo(x - 3.5, midY + 6.5, x - 1.5, midY + 10);
    ctx.stroke();
    ctx.restore();
  }

  // =========================================================================
  // COORDINATE HELPERS
  // =========================================================================
  function tickToX(song, tick, pixelsPerBeat, scrollX, gutterW) {
    return gutterW + 24 + (tick / song.ticksPerBeat) * pixelsPerBeat - scrollX;
  }

  function secToX(song, baseSec, pixelsPerBeat, scrollX, gutterW) {
    return tickToX(song, song.secToTick(baseSec), pixelsPerBeat, scrollX, gutterW);
  }

  function xToTick(song, canvasX, pixelsPerBeat, scrollX, gutterW) {
    const beats = Math.max(0, (canvasX - gutterW - 24 + scrollX) / pixelsPerBeat);
    return beats * song.ticksPerBeat;
  }

  // =========================================================================
  // RULER RENDERER
  // =========================================================================
  function drawRulerCanvas(canvas, song, state) {
    if (!canvas || !song) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w <= 0 || h <= 0) return;

    const targetW = Math.round(w * dpr);
    const targetH = Math.round(h * dpr);
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }

    const gutterW = getStaffGutterWidth(song);
    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.scale(dpr, dpr);

    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, w, h);

    const loopX1 = secToX(song, state.loopStartBaseSec, state.pixelsPerBeat, state.scrollX, gutterW);
    const loopX2 = secToX(song, state.loopEndBaseSec, state.pixelsPerBeat, state.scrollX, gutterW);
    if (loopX2 > loopX1) {
      const lx = Math.max(gutterW, loopX1);
      const lw = Math.max(0, loopX2 - lx);
      ctx.fillStyle = state.loopEnabled ? 'rgba(6, 182, 212, 0.22)' : 'rgba(100, 116, 139, 0.12)';
      ctx.fillRect(lx, 0, lw, h);
      ctx.fillStyle = state.loopEnabled ? '#22d3ee' : '#64748b';
      ctx.fillRect(lx, 0, lw, 3);
    }

    ctx.font = '600 11px Inter, sans-serif';
    ctx.textBaseline = 'top';
    for (const m of song.measures) {
      const mx = tickToX(song, m.startTick, state.pixelsPerBeat, state.scrollX, gutterW);
      if (mx > w + 40) break;
      const endX = tickToX(song, m.endTick, state.pixelsPerBeat, state.scrollX, gutterW);
      if (endX < gutterW - 20) continue;

      if (mx >= gutterW) {
        ctx.strokeStyle = '#475569';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(mx, 14);
        ctx.lineTo(mx, h);
        ctx.stroke();

        ctx.fillStyle = '#cbd5e1';
        ctx.fillText(`${m.number}`, mx + 5, 16);
      }

      if (state.pixelsPerBeat >= 32) {
        ctx.strokeStyle = '#1e293b';
        for (let b = 1; b < m.num; b++) {
          const bx = tickToX(song, m.startTick + b * m.beatTicks, state.pixelsPerBeat, state.scrollX, gutterW);
          if (bx >= gutterW && bx <= w) {
            ctx.beginPath();
            ctx.moveTo(bx, 30);
            ctx.lineTo(bx, h);
            ctx.stroke();
          }
        }
      }
    }

    // Loop A & B Handles
    if (loopX1 >= gutterW - 6 && loopX1 <= w) {
      ctx.fillStyle = state.loopEnabled ? '#06b6d4' : '#64748b';
      ctx.fillRect(loopX1, 0, 2, h);
      ctx.beginPath();
      ctx.roundRect(loopX1, 2, 16, 14, 3);
      ctx.fill();
      ctx.fillStyle = '#082f49';
      ctx.font = '700 9px Inter, sans-serif';
      ctx.fillText('A', loopX1 + 4.5, 4);
    }
    if (loopX2 >= gutterW - 6 && loopX2 <= w) {
      ctx.fillStyle = state.loopEnabled ? '#06b6d4' : '#64748b';
      ctx.fillRect(loopX2 - 1, 0, 2, h);
      ctx.beginPath();
      ctx.roundRect(loopX2 - 16, 2, 16, 14, 3);
      ctx.fill();
      ctx.fillStyle = '#082f49';
      ctx.font = '700 9px Inter, sans-serif';
      ctx.fillText('B', loopX2 - 11.5, 4);
    }

    // Start Cue Flag
    const startX = secToX(song, state.startBaseSec, state.pixelsPerBeat, state.scrollX, gutterW);
    if (startX >= gutterW - 6 && startX <= w) {
      ctx.fillStyle = '#f97316';
      ctx.fillRect(startX - 1, 0, 2, h);
      ctx.beginPath();
      ctx.moveTo(startX, 18);
      ctx.lineTo(startX + 34, 18);
      ctx.lineTo(startX + 30, 25);
      ctx.lineTo(startX + 34, 32);
      ctx.lineTo(startX, 32);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#fff7ed';
      ctx.font = '700 9px Inter, sans-serif';
      ctx.fillText('CUE', startX + 5, 20.5);
    }

    // Playhead
    const px = secToX(song, state.playheadBaseSec, state.pixelsPerBeat, state.scrollX, gutterW);
    if (px >= gutterW && px <= w) {
      ctx.fillStyle = '#10b981';
      ctx.beginPath();
      ctx.moveTo(px - 7, 0);
      ctx.lineTo(px + 7, 0);
      ctx.lineTo(px, 11);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(px - 1, 10, 2, h - 10);
    }

    // Sticky Left Gutter Header
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, gutterW, h);
    ctx.strokeStyle = '#1e293b';
    ctx.beginPath();
    ctx.moveTo(gutterW + 0.5, 0);
    ctx.lineTo(gutterW + 0.5, h);
    ctx.stroke();

    ctx.fillStyle = '#94a3b8';
    ctx.font = '600 10px Inter, sans-serif';
    ctx.fillText('CLEF · KEY', 12, 16);

    ctx.restore();
  }

  // =========================================================================
  // SINGLE SUB-STAFF VOICE / CHORD / BEAM / REST ENGRAVER
  // =========================================================================
  function renderNotesOnSubStaff(params) {
    const {
      ctx, song, trk, notesSubset, subClef, bottomLineY, lineSpacing,
      audible, visibleStartTick, visibleEndTick, gutterW, w,
      keyAlterMap, preferFlats, state, keyTonicMap, drawLyricsHere
    } = params;

    const stepPx = lineSpacing / 2;
    const clusterTol = Math.max(8, Math.round(song.ticksPerBeat * 0.06));

    // 1. Group visible (+1 measure margin) notes into simultaneous Chord Clusters
    let lo = 0, hi = notesSubset.length - 1, firstIdx = notesSubset.length;
    const marginStart = Math.max(0, visibleStartTick - song.ticksPerBeat * 4);
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (notesSubset[mid].startTick + notesSubset[mid].durationTicks >= marginStart) {
        firstIdx = mid;
        hi = mid - 1;
      } else {
        lo = mid + 1;
      }
    }

    const clusters = [];
    for (let i = firstIdx; i < notesSubset.length; i++) {
      const n = notesSubset[i];
      if (n.startTick > visibleEndTick + song.ticksPerBeat * 2) break;
      const last = clusters[clusters.length - 1];
      if (last && Math.abs(n.startTick - last.startTick) <= clusterTol) {
        last.notes.push(n);
        if (n.beatDuration < last.minBeats) last.minBeats = n.beatDuration;
        if (n.lyric && !last.lyric) last.lyric = n.lyric;
      } else {
        clusters.push({
          startTick: n.startTick,
          minBeats: n.beatDuration,
          lyric: n.lyric || '',
          notes: [n]
        });
      }
    }

    // 2. Draw Whole-Measure Rests & Pickup Beat Rests per visible measure
    if (subClef !== 'percussion') {
      for (const m of song.measures) {
        if (m.endTick < visibleStartTick) continue;
        if (m.startTick > visibleEndTick) break;

        const mClusters = clusters.filter(c => c.startTick >= m.startTick - clusterTol && c.startTick < m.endTick - clusterTol);
        if (mClusters.length === 0) {
          // Draw Whole-Measure Rest block hanging from Line 4
          const mx1 = tickToX(song, m.startTick, state.pixelsPerBeat, state.scrollX, gutterW);
          const mx2 = tickToX(song, m.endTick, state.pixelsPerBeat, state.scrollX, gutterW);
          const midX = (mx1 + mx2) / 2;
          if (midX >= gutterW + 10 && midX <= w) {
            const line4Y = bottomLineY - 3 * lineSpacing;
            ctx.fillStyle = audible ? '#475569' : '#64748b';
            ctx.fillRect(midX - 5, line4Y + 0.5, 10, 4.2);
          }
        } else {
          // Draw Quarter Rests for empty whole beats before the first entrance in the measure
          const firstNoteTick = mClusters[0].startTick;
          const emptyBeatsBefore = Math.floor((firstNoteTick - m.startTick + clusterTol) / m.beatTicks);
          if (emptyBeatsBefore >= 1 && emptyBeatsBefore < m.num) {
            for (let b = 0; b < Math.min(3, emptyBeatsBefore); b++) {
              const rx = tickToX(song, m.startTick + b * m.beatTicks, state.pixelsPerBeat, state.scrollX, gutterW);
              if (rx >= gutterW + 8 && rx <= w) {
                drawQuarterRest(ctx, rx, bottomLineY, lineSpacing, audible ? '#475569' : '#64748b');
              }
            }
          }
        }
      }
    }

    // 3. Prepare Chord Layout & Measure-Scoped Accidental Memory
    let currentMeasureIdx = -1;
    let measureAccidentalMemory = new Map(); // absStep -> active alter (-1, 0, +1)
    let activeNotesSounding = 0;

    const preparedChords = [];
    for (const cl of clusters) {
      // Reset accidental memory at each new measure barline
      let mIdx = 0;
      for (let k = 0; k < song.measures.length; k++) {
        if (song.measures[k].startTick <= cl.startTick + clusterTol) mIdx = k;
        else break;
      }
      if (mIdx !== currentMeasureIdx) {
        currentMeasureIdx = mIdx;
        measureAccidentalMemory = new Map();
      }
      const measure = song.measures[mIdx];

      const nx = tickToX(song, cl.startTick, state.pixelsPerBeat, state.scrollX, gutterW);
      // Deduplicate identical MIDI pitches in same cluster
      const seenMidis = new Set();
      const uniqueNotes = cl.notes.filter(n => {
        if (seenMidis.has(n.midi)) return false;
        seenMidis.add(n.midi);
        return true;
      });

      const items = uniqueNotes.map(n => {
        const sp = spellPitchOnSubStaff(n.midi, subClef, song.keySf, keyAlterMap);
        const sounding = state.playheadBaseSec >= n.startBaseSec && state.playheadBaseSec <= n.endBaseSec;
        if (sounding && state.isPlaying && audible) activeNotesSounding++;

        let accidental = '';
        if (!sp.isDrum) {
          const defaultAlter = measureAccidentalMemory.has(sp.absStep)
            ? measureAccidentalMemory.get(sp.absStep)
            : keyAlterMap[sp.diatonicIdx];
          if (sp.alter !== defaultAlter) {
            accidental = sp.alter === 1 ? 'sharp' : sp.alter === -1 ? 'flat' : 'natural';
            measureAccidentalMemory.set(sp.absStep, sp.alter);
          }
        }
        return { n, sp, sounding, accidental, headShiftX: 0 };
      });

      items.sort((a, b) => a.sp.offsetSteps - b.sp.offsetSteps);

      const minStep = items[0].sp.offsetSteps;
      const maxStep = items[items.length - 1].sp.offsetSteps;
      const stemUp = subClef === 'percussion' ? true : ((minStep + maxStep) / 2) < 4;

      // Second-interval horizontal displacement so adjacent steps never collide
      if (stemUp) {
        for (let i = 1; i < items.length; i++) {
          if (items[i].sp.offsetSteps - items[i - 1].sp.offsetSteps === 1 && items[i - 1].headShiftX === 0) {
            items[i].headShiftX = 8.8;
          }
        }
      } else {
        for (let i = items.length - 2; i >= 0; i--) {
          if (items[i + 1].sp.offsetSteps - items[i].sp.offsetSteps === 1 && items[i + 1].headShiftX === 0) {
            items[i].headShiftX = -8.8;
          }
        }
      }

      const beats = cl.minBeats;
      const isHollow = beats >= 1.75;
      const hasStem = beats < 3.4;
      const isBeamable = subClef !== 'percussion' && beats >= 0.16 && beats < 0.85;
      const isSixteenth = beats <= 0.35;
      const isDotted = (beats >= 1.38 && beats < 1.72) || (beats >= 2.75 && beats < 3.35) || (beats >= 0.68 && beats < 0.84);
      const beatBucket = measure
        ? `${mIdx}:${Math.floor(Math.max(0, cl.startTick - measure.startTick + clusterTol) / measure.beatTicks)}`
        : `${cl.startTick}`;

      const minY = bottomLineY - minStep * stepPx; // Lowest pitch (largest Y)
      const maxY = bottomLineY - maxStep * stepPx; // Highest pitch (smallest Y)
      const stemX = stemUp ? nx + 4.8 : nx - 4.8;
      const stemBaseY = stemUp ? minY : maxY;
      const rawTipY = stemUp ? (maxY - 25) : (minY + 25);
      // Standard engraving rule: stems reach at least the middle staff line (Line 3)
      const midLineY = bottomLineY - 4 * stepPx;
      const stemTipY = stemUp ? Math.min(rawTipY, midLineY) : Math.max(rawTipY, midLineY);

      preparedChords.push({
        cl, nx, items, minStep, maxStep, minY, maxY,
        stemUp, stemX, stemBaseY, stemTipY,
        isHollow, hasStem, isBeamable, isSixteenth, isDotted,
        beatBucket, beamed: false,
        anySounding: items.some(it => it.sounding)
      });
    }

    // 4. Group consecutive beamable eighth/sixteenth chords within the same beat
    const beamGroups = [];
    let idx = 0;
    while (idx < preparedChords.length) {
      const ch = preparedChords[idx];
      if (!ch.isBeamable) {
        idx++;
        continue;
      }
      const grp = [ch];
      let j = idx + 1;
      while (
        j < preparedChords.length &&
        preparedChords[j].isBeamable &&
        preparedChords[j].beatBucket === ch.beatBucket &&
        preparedChords[j].stemUp === ch.stemUp &&
        (preparedChords[j].nx - preparedChords[j - 1].nx) <= state.pixelsPerBeat * 1.15 &&
        grp.length < 4
      ) {
        grp.push(preparedChords[j]);
        j++;
      }
      if (grp.length >= 2) {
        grp.forEach(g => { g.beamed = true; });
        beamGroups.push(grp);
      }
      idx = j;
    }

    // Adjust stem tips on beamed groups to form a clean linear beam line
    for (const grp of beamGroups) {
      const first = grp[0];
      const last = grp[grp.length - 1];
      let slope = (last.stemTipY - first.stemTipY) / Math.max(1, last.stemX - first.stemX);
      slope = Math.max(-0.22, Math.min(0.22, slope)); // Gentle musical beam slope cap

      // Ensure beam clears all chord noteheads in the group
      let shift = 0;
      for (const g of grp) {
        const lineY = first.stemTipY + slope * (g.nx - first.nx);
        if (first.stemUp) {
          const minNeeded = g.maxY - 19;
          if (lineY > minNeeded) shift = Math.min(shift, minNeeded - lineY);
        } else {
          const maxNeeded = g.minY + 19;
          if (lineY < maxNeeded) shift = Math.max(shift, maxNeeded - lineY);
        }
      }
      for (const g of grp) {
        g.stemTipY = first.stemTipY + shift + slope * (g.nx - first.nx);
      }
    }

    // 5. Render Ledger Lines, Sustain Bars, Noteheads, Accidentals, Stems, Flags & Labels
    for (const ch of preparedChords) {
      if (ch.nx < gutterW - 22 || ch.nx > w + 28) continue;

      const chordInk = !audible
        ? '#64748b'
        : ch.anySounding
          ? trk.color.hex
          : '#0f172a';

      // Ledger lines below Line 1 (offsetSteps <= -2) and above Line 5 (offsetSteps >= 10)
      if (subClef !== 'percussion') {
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 1.25;
        if (ch.minStep <= -2) {
          const lowestEven = ch.minStep % 2 === 0 ? ch.minStep : ch.minStep + 1;
          for (let s = -2; s >= lowestEven; s -= 2) {
            const ly = Math.round(bottomLineY - s * stepPx) + 0.5;
            ctx.beginPath();
            ctx.moveTo(ch.nx - 8.5, ly);
            ctx.lineTo(ch.nx + 9.5, ly);
            ctx.stroke();
          }
        }
        if (ch.maxStep >= 10) {
          const highestEven = ch.maxStep % 2 === 0 ? ch.maxStep : ch.maxStep - 1;
          for (let s = 10; s <= highestEven; s += 2) {
            const ly = Math.round(bottomLineY - s * stepPx) + 0.5;
            ctx.beginPath();
            ctx.moveTo(ch.nx - 8.5, ly);
            ctx.lineTo(ch.nx + 9.5, ly);
            ctx.stroke();
          }
        }
      }

      // Draw each notehead & staggered accidentals in the chord
      let accIndex = 0;
      for (const it of ch.items) {
        const headX = ch.nx + it.headShiftX;
        const headY = bottomLineY - it.sp.offsetSteps * stepPx;
        const endX = tickToX(song, it.n.startTick + it.n.durationTicks, state.pixelsPerBeat, state.scrollX, gutterW);
        const durPx = Math.max(8, endX - headX);

        // Subtle translucent sustain duration guide bar
        if (durPx > 14 && !it.sp.isDrum) {
          ctx.fillStyle = it.sounding && audible
            ? trk.color.glow + '55'
            : trk.color.hex + (audible ? '22' : '14');
          ctx.beginPath();
          ctx.roundRect(headX + 5, headY - 2.5, Math.max(4, durPx - 7), 5, 2.5);
          ctx.fill();
        }

        // Active sounding halo
        if (it.sounding && audible) {
          ctx.fillStyle = trk.color.glow + '40';
          ctx.beginPath();
          ctx.arc(headX, headY, 10.5, 0, Math.PI * 2);
          ctx.fill();
        }

        const headColor = !audible
          ? '#64748b'
          : it.sounding
            ? trk.color.hex
            : '#0f172a';

        ctx.save();
        ctx.translate(headX, headY);
        if (it.sp.isDrum) {
          ctx.strokeStyle = headColor;
          ctx.fillStyle = it.sounding ? trk.color.glow : trk.color.hex;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(0, -4.2);
          ctx.lineTo(4.8, 0);
          ctx.lineTo(0, 4.2);
          ctx.lineTo(-4.8, 0);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        } else {
          ctx.rotate(-0.31);
          ctx.beginPath();
          ctx.ellipse(0, 0, 5.4, 3.85, 0, 0, Math.PI * 2);
          if (ch.isHollow) {
            ctx.lineWidth = 1.85;
            ctx.strokeStyle = headColor;
            ctx.fillStyle = audible ? '#f8fafc' : '#cbd5e1';
            ctx.fill();
            ctx.stroke();
          } else {
            ctx.fillStyle = headColor;
            ctx.fill();
            ctx.fillStyle = it.sounding ? '#ffffff' : trk.color.glow;
            ctx.beginPath();
            ctx.arc(0, 0, 1.55, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.restore();

        // Augmentation dot
        if (ch.isDotted && !it.sp.isDrum) {
          ctx.fillStyle = headColor;
          ctx.beginPath();
          ctx.arc(headX + 9.2, headY - (it.sp.offsetSteps % 2 === 0 ? 2.1 : 0), 1.75, 0, Math.PI * 2);
          ctx.fill();
        }

        // Vector Accidental (staggered cleanly on multi-accidental chords)
        if (it.accidental) {
          const accX = ch.nx - 13 - (accIndex % 2) * 8.5;
          accIndex++;
          const accColor = it.sounding && audible ? trk.color.hex : '#1e293b';
          if (it.accidental === 'sharp') drawVectorSharp(ctx, accX, headY, 0.84, accColor);
          else if (it.accidental === 'flat') drawVectorFlat(ctx, accX, headY, 0.88, accColor);
          else drawVectorNatural(ctx, accX, headY, 0.84, accColor);
        }

        // Hit-test target for click-to-audition & cue
        state.renderedNoteHits.push({
          x: headX,
          y: headY,
          track: trk,
          note: it.n,
          pitchLabel: it.sp.isDrum ? `Drum (${it.n.midi})` : formatNoteName(it.n.midi, preferFlats)
        });
      }

      // Single unified Stem per Chord
      if (ch.hasStem) {
        ctx.strokeStyle = chordInk;
        ctx.lineWidth = 1.35;
        ctx.beginPath();
        ctx.moveTo(ch.stemX, ch.stemBaseY);
        ctx.lineTo(ch.stemX, ch.stemTipY);
        ctx.stroke();

        // Isolated Eighth / Sixteenth Flag (when not beamed)
        if (ch.isBeamable && !ch.beamed) {
          ctx.lineWidth = 1.65;
          ctx.beginPath();
          ctx.moveTo(ch.stemX, ch.stemTipY);
          if (ch.stemUp) {
            ctx.bezierCurveTo(ch.stemX + 6, ch.stemTipY + 3, ch.stemX + 8, ch.stemTipY + 9, ch.stemX + 4, ch.stemTipY + 15);
            if (ch.isSixteenth) {
              ctx.moveTo(ch.stemX, ch.stemTipY + 5.5);
              ctx.bezierCurveTo(ch.stemX + 6, ch.stemTipY + 8.5, ch.stemX + 8, ch.stemTipY + 14, ch.stemX + 4, ch.stemTipY + 19);
            }
          } else {
            ctx.bezierCurveTo(ch.stemX + 6, ch.stemTipY - 3, ch.stemX + 8, ch.stemTipY - 9, ch.stemX + 4, ch.stemTipY - 15);
            if (ch.isSixteenth) {
              ctx.moveTo(ch.stemX, ch.stemTipY - 5.5);
              ctx.bezierCurveTo(ch.stemX + 6, ch.stemTipY - 8.5, ch.stemX + 8, ch.stemTipY - 14, ch.stemX + 4, ch.stemTipY - 19);
            }
          }
          ctx.stroke();
        }
      }

      // Single clean Lyric / Pitch / Solfege Label per Chord onset (zero overlapping text!)
      if (drawLyricsHere && state.pitchLabelMode !== 'off' && subClef !== 'percussion') {
        const topItem = ch.items[ch.items.length - 1];
        let label = '';
        if (state.pitchLabelMode === 'lyrics_notes') {
          if (ch.cl.lyric) {
            label = ch.cl.lyric;
          } else if (state.pixelsPerBeat >= 40) {
            label = ch.items.length > 1
              ? `${formatNoteName(topItem.n.midi, preferFlats)}`
              : formatNoteName(topItem.n.midi, preferFlats);
          }
        } else if (state.pitchLabelMode === 'lyrics') {
          label = ch.cl.lyric || '';
        } else if (state.pitchLabelMode === 'solfege') {
          const solf = formatSolfege(topItem.n.midi, song.keySf, keyTonicMap);
          label = ch.cl.lyric ? `${ch.cl.lyric} (${solf})` : solf;
        }
        if (label) {
          ctx.fillStyle = ch.anySounding && audible ? trk.color.hex : '#334155';
          ctx.font = ch.cl.lyric ? '600 10.5px Inter, sans-serif' : '500 9.5px Inter, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillText(label, ch.nx, bottomLineY + 18);
          ctx.textAlign = 'left';
        }
      }
    }

    // 6. Draw Eighth / Sixteenth Beam Bars across Beamed Groups
    for (const grp of beamGroups) {
      const first = grp[0];
      const last = grp[grp.length - 1];
      if (last.stemX < gutterW - 10 || first.stemX > w + 10) continue;

      const groupSounding = grp.some(g => g.anySounding);
      const beamColor = !audible
        ? '#64748b'
        : groupSounding
          ? trk.color.hex
          : '#0f172a';

      ctx.strokeStyle = beamColor;
      ctx.lineWidth = 3.6;
      ctx.lineCap = 'butt';
      ctx.beginPath();
      ctx.moveTo(first.stemX - 0.6, first.stemTipY);
      ctx.lineTo(last.stemX + 0.6, last.stemTipY);
      ctx.stroke();

      // Secondary beam for sixteenth pairs
      for (let k = 0; k < grp.length - 1; k++) {
        if (grp[k].isSixteenth && grp[k + 1].isSixteenth) {
          const offset = first.stemUp ? 5.2 : -5.2;
          ctx.lineWidth = 2.8;
          ctx.beginPath();
          ctx.moveTo(grp[k].stemX, grp[k].stemTipY + offset);
          ctx.lineTo(grp[k + 1].stemX, grp[k + 1].stemTipY + offset);
          ctx.stroke();
        }
      }
    }

    return activeNotesSounding;
  }

  // =========================================================================
  // MULTI-TRACK SCORE CANVAS RENDERER
  // =========================================================================
  function drawStaffCanvas(canvas, song, state, isTrackAudibleFn, keyTonicMap) {
    if (!canvas || !song) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w <= 0 || h <= 0) return;

    const targetW = Math.round(w * dpr);
    const targetH = Math.round(h * dpr);
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }

    const gutterW = getStaffGutterWidth(song);
    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.scale(dpr, dpr);

    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, w, h);

    const keyAlterMap = getKeyAlterationMap(song.keySf);
    const preferFlats = song.keySf < 0;
    const visibleStartTick = Math.max(0, xToTick(song, gutterW - 40, state.pixelsPerBeat, state.scrollX, gutterW));
    const visibleEndTick = xToTick(song, w + 50, state.pixelsPerBeat, state.scrollX, gutterW);

    const loopX1 = secToX(song, state.loopStartBaseSec, state.pixelsPerBeat, state.scrollX, gutterW);
    const loopX2 = secToX(song, state.loopEndBaseSec, state.pixelsPerBeat, state.scrollX, gutterW);
    const startX = secToX(song, state.startBaseSec, state.pixelsPerBeat, state.scrollX, gutterW);
    const playheadX = secToX(song, state.playheadBaseSec, state.pixelsPerBeat, state.scrollX, gutterW);

    state.renderedNoteHits = [];
    const lineSpacing = 8.5;
    const stepPx = lineSpacing / 2;

    let accTop = -state.scrollY;
    for (let idx = 0; idx < song.tracks.length; idx++) {
      const trk = song.tracks[idx];
      const rowHeight = getTrackRowHeight(trk);
      const rowTop = accTop;
      const rowBottom = rowTop + rowHeight;
      accTop += rowHeight;

      if (rowBottom < 0 || rowTop > h) {
        trk.vuLevel = Math.max(0, trk.vuLevel - 14);
        continue;
      }

      const audible = isTrackAudibleFn(song, trk);

      // Strict per-row clip so wide intervals never bleed into adjacent staves
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, rowTop, w, rowHeight);
      ctx.clip();

      // Sheet music paper lane
      ctx.fillStyle = audible ? '#f8fafc' : '#cbd5e1';
      ctx.fillRect(0, rowTop, w, rowHeight - 1);
      ctx.fillStyle = '#94a3b8';
      ctx.fillRect(0, rowBottom - 1, w, 1);

      if (loopX2 > loopX1 && state.loopEnabled) {
        const lx = Math.max(gutterW, loopX1);
        const lw = Math.max(0, loopX2 - lx);
        ctx.fillStyle = 'rgba(6, 182, 212, 0.10)';
        ctx.fillRect(lx, rowTop, lw, rowHeight - 1);
      }

      const isGrand = trk.clef === 'grand';
      const staves = isGrand
        ? [
            { subClef: 'treble', bottomY: rowTop + 76, notes: trk.notes.filter(n => n.midi >= 60), drawLyrics: false },
            { subClef: 'bass',   bottomY: rowTop + 150, notes: trk.notes.filter(n => n.midi < 60), drawLyrics: true }
          ]
        : [
            { subClef: trk.clef, bottomY: rowTop + 82, notes: trk.notes, drawLyrics: true }
          ];

      // Draw 5 horizontal lines for each staff in the track
      ctx.strokeStyle = audible ? '#334155' : '#64748b';
      ctx.lineWidth = 1;
      for (const st of staves) {
        for (let line = 0; line < 5; line++) {
          const ly = Math.round(st.bottomY - line * lineSpacing) + 0.5;
          ctx.beginPath();
          ctx.moveTo(gutterW, ly);
          ctx.lineTo(w, ly);
          ctx.stroke();
        }
      }

      // Draw Measure Barlines (spanning full Grand Staff height if Grand!) & Final Double Barline
      const barTopY = staves[0].bottomY - 4 * lineSpacing;
      const barBotY = staves[staves.length - 1].bottomY;

      for (let mi = 0; mi < song.measures.length; mi++) {
        const m = song.measures[mi];
        if (m.endTick < visibleStartTick) continue;
        if (m.startTick > visibleEndTick) break;

        const mx = Math.round(tickToX(song, m.startTick, state.pixelsPerBeat, state.scrollX, gutterW)) + 0.5;
        if (mx >= gutterW) {
          ctx.strokeStyle = '#475569';
          ctx.lineWidth = 1.1;
          ctx.beginPath();
          ctx.moveTo(mx, barTopY);
          ctx.lineTo(mx, barBotY);
          ctx.stroke();
        }

        // Final Engraved Double Barline at end of last measure
        if (mi === song.measures.length - 1) {
          const endBarX = Math.round(tickToX(song, m.endTick, state.pixelsPerBeat, state.scrollX, gutterW)) + 0.5;
          if (endBarX >= gutterW && endBarX <= w + 10) {
            ctx.strokeStyle = '#1e293b';
            ctx.lineWidth = 1.1;
            ctx.beginPath();
            ctx.moveTo(endBarX - 4, barTopY);
            ctx.lineTo(endBarX - 4, barBotY);
            ctx.stroke();

            ctx.fillStyle = '#0f172a';
            ctx.fillRect(endBarX - 1, barTopY, 3.2, barBotY - barTopY);
          }
        }
      }

      // Render Notes, Chords, Stems, Beams & Rests on each sub-staff
      let trackActiveNotes = 0;
      for (const st of staves) {
        trackActiveNotes += renderNotesOnSubStaff({
          ctx,
          song,
          trk,
          notesSubset: st.notes,
          subClef: st.subClef,
          bottomLineY: st.bottomY,
          lineSpacing,
          audible,
          visibleStartTick,
          visibleEndTick,
          gutterW,
          w,
          keyAlterMap,
          preferFlats,
          state,
          keyTonicMap,
          drawLyricsHere: st.drawLyrics
        });
      }

      trk.vuLevel = state.isPlaying && audible && trackActiveNotes > 0
        ? Math.min(100, 55 + trackActiveNotes * 20)
        : Math.max(0, trk.vuLevel - 14);

      // Sticky Left Gutter: Clef + Engraved Key Signature + Stacked Time Signature
      ctx.fillStyle = audible ? '#f1f5f9' : '#cbd5e1';
      ctx.fillRect(0, rowTop, gutterW, rowHeight - 1);

      // Colored Track Stripe
      ctx.fillStyle = trk.color.hex;
      ctx.fillRect(0, rowTop, 4, rowHeight - 1);

      const staffStartInGutter = isGrand ? 13 : 8;
      ctx.strokeStyle = '#64748b';
      ctx.lineWidth = 1;
      for (const st of staves) {
        for (let line = 0; line < 5; line++) {
          const ly = Math.round(st.bottomY - line * lineSpacing) + 0.5;
          ctx.beginPath();
          ctx.moveTo(staffStartInGutter, ly);
          ctx.lineTo(gutterW, ly);
          ctx.stroke();
        }
      }

      // Left vertical system barline + Grand Staff Brace
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(staffStartInGutter + 0.5, barTopY);
      ctx.lineTo(staffStartInGutter + 0.5, barBotY);
      ctx.stroke();

      if (isGrand) {
        drawGrandStaffBrace(ctx, 7.5, barTopY, barBotY, '#0f172a');
      }

      // Right gutter divider
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(gutterW - 0.5, rowTop);
      ctx.lineTo(gutterW - 0.5, rowBottom);
      ctx.stroke();

      const ts = song.timeSigEvents[0];
      const clefInk = '#0f172a';

      for (const st of staves) {
        const clefLeft = staffStartInGutter + 3;
        if (st.subClef === 'bass') {
          drawVectorBassClef(ctx, clefLeft, st.bottomY, lineSpacing, clefInk);
        } else if (st.subClef === 'percussion') {
          drawVectorPercussionClef(ctx, clefLeft, st.bottomY, lineSpacing, '#334155');
        } else {
          drawVectorTrebleClef(ctx, clefLeft, st.bottomY, lineSpacing, st.subClef === 'treble8vb', clefInk);
        }

        const keyStartX = clefLeft + 26;
        const afterKeyX = drawKeySignatureOnStaff(ctx, keyStartX, st.bottomY, stepPx, st.subClef, song.keySf, clefInk);
        drawTimeSignatureOnStaff(ctx, afterKeyX + 10, st.bottomY, lineSpacing, ts.num, ts.den, clefInk);
      }

      // Subtle Track Name label at top-left of gutter
      ctx.fillStyle = '#475569';
      ctx.font = '600 10px Inter, sans-serif';
      ctx.textBaseline = 'top';
      ctx.fillText(trk.name.slice(0, 14), 8, rowTop + 6);

      ctx.restore();
    }

    // Vertical Marker Overlays (Loop A-B, Start Cue, Playhead)
    if (loopX1 >= gutterW && loopX1 <= w && state.loopEnabled) {
      ctx.strokeStyle = 'rgba(6, 182, 212, 0.75)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(loopX1, 0);
      ctx.lineTo(loopX1, h);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (loopX2 >= gutterW && loopX2 <= w && state.loopEnabled) {
      ctx.strokeStyle = 'rgba(6, 182, 212, 0.75)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(loopX2, 0);
      ctx.lineTo(loopX2, h);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (startX >= gutterW && startX <= w) {
      ctx.strokeStyle = 'rgba(249, 115, 22, 0.7)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(startX, 0);
      ctx.lineTo(startX, h);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (playheadX >= gutterW && playheadX <= w) {
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(playheadX, 0);
      ctx.lineTo(playheadX, h);
      ctx.stroke();
    }

    ctx.restore();
  }

  global.MidiMixerScore = {
    PITCH_CLASS_SHARP,
    PITCH_CLASS_FLAT,
    getTrackRowHeight,
    getStaffGutterWidth,
    formatNoteName,
    formatSolfege,
    tickToX,
    secToX,
    xToTick,
    drawRulerCanvas,
    drawStaffCanvas
  };
})(window);
