# midi-mixer

**midi-mixer** is a 100% browser-local MIDI rehearsal player and sight-singing studio built for singers, choir members, and vocalists learning parts from multi-track `.mid` / `.midi` files. Everything runs client-side in your browser using the Web Audio API, HTML5 Canvas engraving, and local `IndexedDB` storage — **zero backend servers and zero cloud uploads**.

## Features

- **100% On-Device MIDI Playlist**: Load `.mid` / `.midi` files individually, import an entire local directory via **Folder**, or drag and drop files anywhere. Loaded files cache locally in your browser (`IndexedDB`) across reloads.
- **Engraved Multi-Track Musical Staves**:
  - Vector **Treble**, **Choral Tenor (8vb)**, **Bass**, **Grand Staff** (Treble + Bass with piano brace), and **Percussion** clefs.
  - Engraved key signatures on proper staff lines/spaces, stacked time signatures, chord stem grouping, second-interval notehead offsets, eighth/sixteenth beaming, measure rests, and lyrics / pitch / movable-solfege labels.
  - Click any note directly on a staff while paused to hear its exact pitch and cue playback there.
- **Pitch-Invariant Tempo Control**: Speed up or slow down playback from **25% (0.25x)** to **200% (2.0x)** in real time without shifting vocal pitch.
- **Rehearsal Start Cues & A–B Phrase Looping**: Pin your custom **Start Cue** at any bar or beat (`Cue Here` or click/drag on the measure ruler), set `A–B` phrase loops, or trigger an instant **4 Bars** loop.
- **Individual & Group Track Mixing**:
  - Per-track **Solo (`S`)**, **Mute (`M`)**, **13 Web Audio instruments** (*Choir Aahs*, *Voice Oohs*, *Vocal Pitch Guide*, *Grand Piano*, *Clarinet*, *Strings*, etc.), and **0%–150% volume faders** with live VU meters.
  - One-click **Group Mute / Solo** chips (*Vocals*, *Harmony*, *Accompaniment*, *Bass & Rhythm*) plus multi-track checkboxes for muting or soloing custom track groups.
- **Playable Sound-Check Virtual Piano (Mouse + Computer Keyboard)**:
  - 37-key clickable & glissando-enabled keyboard dock with `A440 Fork`, `Song Key Chord`, and hands-free `Sustain`.
  - Polyphonic computer keyboard mapping: `A S D F G H J K L ; '` (white keys), `W E T Y U O P` (sharps/flats), and `Z` / `X` to shift octaves.

## Running Locally

No build step or package installation is required:

1. Open `index.html` directly in any modern browser (Chrome, Safari, Edge, or Firefox), **or**
2. Serve the folder locally:
   ```bash
   python3 -m http.server 8080
   ```
   Then visit `http://localhost:8080`.

## Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `Space` | Play / Pause |
| `R` | Jump back to pinned Start Cue |
| `Shift + L` | Toggle A–B Loop (`L` also works when QWERTY piano typing is toggled off) |
| `A S D F G H J K L ; '` | Play natural keys on Sound-Check Piano |
| `W E T Y U O P` | Play sharp / flat keys on Sound-Check Piano |
| `Z` / `X` | Shift computer-keyboard piano octave down / up |
