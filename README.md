# DO Console

DO Console is a lightweight, retro-styled browser client for an existing Digital Objects Network Driver. It is plain HTML, CSS, and JavaScript with no build step or application server.

## Features

- Saved local and remote Driver connection profiles with live status
- PEXE cartridge selection, installation, object browsing, and action execution
- Full cartridge dependency tech tree and per-action I/O maps
- Goal planner with dependency paths, CWI-grounded estimates, and a persistent sequential workflow runner with play, pause, exit, and recovery controls
- PoW/VDF difficulty indicators on object nodes
- Client Work Index benchmark saved per Driver in browser storage
- Multiple period-inspired screen palettes, background music, and optional UI sounds

## Use

Open `index.html` in a modern browser, choose a Driver under **Connections**, then select or load a cartridge. The default local Driver is `http://127.0.0.1:7717`.

The selected Driver remains authoritative for cartridge validation, object state, proof generation, and transaction submission. Connection profiles, UI choices, and CWI results are stored in `localStorage`.

Music files live in `music/`; the menu click sound is `sounds/menuclick.mp3`. Track entries are currently listed in `app.js`.
