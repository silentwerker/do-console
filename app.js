(function () {
  "use strict";

  if (globalThis.top !== globalThis.self) {
    document.body.textContent = "Digital Objects Light Console cannot run inside a frame. Open it directly.";
    return;
  }

  const CONFIG_VERSION = 1;
  const STORAGE_KEY = "don.lightConsole.config.v1";
  const HANDLE_DB = "don-light-console";
  const HANDLE_STORE = "handles";
  const HANDLE_KEY = "config";
  const TERMINAL_RUNS = new Set(["succeeded", "failed"]);
  const DEFAULT_SYNCHRONIZER = "https://synchronizer.don.pateldhvani.com";
  const DEFAULT_RELAYER = "https://relayer.don.pateldhvani.com";
  const MAX_PEXE_BYTES = 8 * 1024 * 1024;
  const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
  const THEME_OPTIONS = Object.freeze([
    { id: "desk-classic", label: "Desk Classic", chrome: "#181b1c" },
    { id: "code-rain", label: "Code Rain", chrome: "#020703" },
    { id: "amber-tty", label: "Amber TTY", chrome: "#170b03" },
    { id: "midnight-prompt", label: "Midnight Prompt", chrome: "#06061c" },
    { id: "breadbox-8", label: "Breadbox 8", chrome: "#1b163c" },
    { id: "skinned-stereo", label: "Skinned Stereo", chrome: "#101214" },
    { id: "paper-system", label: "Paper System", chrome: "#bcbcbc" },
  ]);
  const THEME_IDS = new Set(THEME_OPTIONS.map((theme) => theme.id));
  const MUSIC_TRACKS = Object.freeze([
    { name: "Pixel Lantern.mp3", title: "Pixel Lantern", src: "./music/Pixel Lantern.mp3" },
    { name: "Pixel Quest Menu.mp3", title: "Pixel Quest Menu", src: "./music/Pixel Quest Menu.mp3" },
    { name: "Triumphant Save File.mp3", title: "Triumphant Save File", src: "./music/Triumphant Save File.mp3" },
  ]);
  const byId = (id) => document.getElementById(id);
  const appShell = byId("app");
  const main = byId("main-content");
  const drawer = byId("drawer");
  const drawerBackdrop = byId("drawer-backdrop");
  const drawerContent = byId("drawer-content");
  const pexeInput = byId("pexe-input");
  const dobjInput = byId("dobj-input");
  const configInput = byId("config-input");
  const musicAudio = byId("music-audio");
  const menuClickAudio = byId("menu-click-audio");

  function defaultDriverUrl() {
    return new Set(["http:", "https:"]).has(location.protocol)
      ? location.origin
      : "http://127.0.0.1:7717";
  }

  function adjacentMcpUrl(driverUrl) {
    const parsed = new URL(driverUrl);
    const port = Number(parsed.port || (parsed.protocol === "https:" ? 443 : 80));
    if (!Number.isInteger(port) || port < 1 || port >= 65535) return "";
    parsed.port = String(port + 1);
    parsed.pathname = "/mcp";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  }

  function newId(prefix) {
    const random = globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
    return `${prefix}-${random}`;
  }

  function defaultConnection() {
    const driverUrl = defaultDriverUrl();
    return {
      id: "local",
      name: "Local Driver",
      driverUrl,
      mcpUrl: adjacentMcpUrl(driverUrl),
      synchronizerUrl: DEFAULT_SYNCHRONIZER,
      relayerUrl: DEFAULT_RELAYER,
    };
  }

  function defaultConfig() {
    return {
      version: CONFIG_VERSION,
      activeConnectionId: "local",
      connections: [defaultConnection()],
      activeCartridgeByConnection: {},
      recentRunIdsByConnection: {},
      ui: { lastScreen: "home", theme: "desk-classic", soundsMuted: false, music: { lastTrack: "" } },
    };
  }

  function cleanUrl(value, fallback = "") {
    const text = String(value || fallback).trim();
    if (!text) return "";
    const parsed = new URL(text);
    if (!new Set(["http:", "https:"]).has(parsed.protocol)) {
      throw new Error("Only HTTP and HTTPS endpoints are supported.");
    }
    if (parsed.username || parsed.password) {
      throw new Error("Connection URLs cannot contain credentials.");
    }
    parsed.hash = "";
    parsed.search = "";
    return parsed.toString().replace(/\/$/, "");
  }

  function normalizeConnection(value, index) {
    const fallback = index === 0 ? defaultConnection() : null;
    const id = String(value?.id || fallback?.id || newId("connection")).trim();
    const name = String(value?.name || fallback?.name || `Connection ${index + 1}`).trim();
    if (!id || !name) throw new Error("Each connection needs an id and name.");
    return {
      id,
      name,
      driverUrl: cleanUrl(value?.driverUrl, fallback?.driverUrl),
      mcpUrl: cleanUrl(value?.mcpUrl, fallback?.mcpUrl),
      synchronizerUrl: cleanUrl(value?.synchronizerUrl, fallback?.synchronizerUrl),
      relayerUrl: cleanUrl(value?.relayerUrl, fallback?.relayerUrl),
    };
  }

  function normalizeConfig(value) {
    const source = value && typeof value === "object" ? value : {};
    const rawConnections = Array.isArray(source.connections) && source.connections.length
      ? source.connections
      : defaultConfig().connections;
    const connections = rawConnections.map(normalizeConnection);
    const ids = new Set();
    for (const connection of connections) {
      if (ids.has(connection.id)) connection.id = newId("connection");
      ids.add(connection.id);
    }
    const requestedActive = String(source.activeConnectionId || "");
    const activeConnectionId = ids.has(requestedActive) ? requestedActive : connections[0].id;
    return {
      version: CONFIG_VERSION,
      activeConnectionId,
      connections,
      activeCartridgeByConnection:
        source.activeCartridgeByConnection && typeof source.activeCartridgeByConnection === "object"
          ? { ...source.activeCartridgeByConnection }
          : {},
      recentRunIdsByConnection:
        source.recentRunIdsByConnection && typeof source.recentRunIdsByConnection === "object"
          ? Object.fromEntries(
              Object.entries(source.recentRunIdsByConnection).map(([key, idsValue]) => [
                key,
                Array.isArray(idsValue) ? idsValue.map(String).slice(0, 30) : [],
              ]),
            )
          : {},
      ui: {
        lastScreen: String(source.ui?.lastScreen || "home"),
        theme: THEME_IDS.has(source.ui?.theme) ? source.ui.theme : "desk-classic",
        soundsMuted: Boolean(source.ui?.soundsMuted),
        music: {
          lastTrack: String(source.ui?.music?.lastTrack || "").slice(0, 512),
        },
      },
    };
  }

  function loadConfig() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        return normalizeConfig(JSON.parse(raw));
      }
      return defaultConfig();
    } catch (error) {
      console.warn("Could not load saved console config", error);
      return defaultConfig();
    }
  }

  const state = {
    config: loadConfig(),
    screen: "home",
    statuses: new Map(),
    workspace: emptyWorkspace(),
    workspaceGeneration: 0,
    probeGeneration: 0,
    refreshing: false,
    eventSource: null,
    eventConnectionId: null,
    eventGeneration: null,
    events: [],
    runSeenAt: new Map(),
    watchingRuns: new Set(),
    drawer: null,
    editingConnectionId: null,
    actionSearch: "",
    actionFilter: "all",
    actionLimit: 60,
    objectSearch: "",
    objectStatus: "live",
    objectLimit: 90,
    techTree: {
      mode: "all",
      objectFileName: "",
      selectedNodeId: "",
      viewBox: null,
      viewKey: "",
      model: null,
      layout: null,
      drag: null,
    },
    linkedConfigHandle: null,
    linkedConfigName: null,
    configWriteTimer: null,
    drawerReturnFocus: null,
    music: {
      tracks: MUSIC_TRACKS,
      index: -1,
      autoplayBlocked: false,
      resumeArmed: false,
    },
  };

  function applyTheme(themeId) {
    const selected = THEME_OPTIONS.find((theme) => theme.id === themeId) || THEME_OPTIONS[0];
    state.config.ui.theme = selected.id;
    document.documentElement.dataset.theme = selected.id;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", selected.chrome);
    document.querySelectorAll("#theme-picker [data-theme]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.theme === selected.id));
    });
  }

  applyTheme(state.config.ui.theme);

  function emptyWorkspace() {
    return {
      connectionId: null,
      loading: false,
      health: null,
      actions: [],
      objects: [],
      classes: [],
      settings: null,
      stateRoot: null,
      runs: new Map(),
      runsSupported: null,
      errors: {},
      loadedAt: null,
    };
  }

  function activeConnection() {
    return (
      state.config.connections.find((item) => item.id === state.config.activeConnectionId) ||
      state.config.connections[0] ||
      null
    );
  }

  function isCurrentWorkspace(connection, generation = state.workspaceGeneration) {
    return Boolean(
      connection &&
        generation === state.workspaceGeneration &&
        state.workspace.connectionId === connection.id &&
        activeConnection()?.id === connection.id
    );
  }

  function activeCartridgeId() {
    const connection = activeConnection();
    return connection ? state.config.activeCartridgeByConnection[connection.id] || null : null;
  }

  function connectionStatus(id) {
    return state.statuses.get(id) || { state: "checking", checkedAt: null, health: null, error: null };
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[character]);
  }

  function safeJson(value) {
    return escapeHtml(JSON.stringify(value, null, 2));
  }

  function shortText(value, head = 8, tail = 5) {
    const text = String(value || "");
    return text.length > head + tail + 2 ? `${text.slice(0, head)}...${text.slice(-tail)}` : text || "-";
  }

  function formatTime(value) {
    if (!value) return "Not checked";
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.valueOf())
      ? "Unknown"
      : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  function formatDate(value) {
    if (!value) return "Unknown";
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.valueOf()) ? "Unknown" : date.toLocaleString();
  }

  function qualifiedKey(value) {
    return `${value?.pluginName || "?"}::${value?.name || "?"}`;
  }

  function sameQualified(left, right) {
    return left?.pluginName === right?.pluginName && left?.name === right?.name;
  }

  class DriverError extends Error {
    constructor(message, status = 0, body = null) {
      super(message);
      this.name = "DriverError";
      this.status = status;
      this.body = body;
    }
  }

  function endpointUrl(connection, path) {
    return `${connection.driverUrl}${path.startsWith("/") ? path : `/${path}`}`;
  }

  async function driverRequest(connection, path, options = {}) {
    if (!connection) throw new DriverError("Choose a Driver connection first.");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeout ?? 15000);
    const headers = new Headers(options.headers || {});
    headers.set("Accept", headers.get("Accept") || "application/json");
    try {
      const response = await fetch(endpointUrl(connection, path), {
        ...options,
        headers,
        signal: controller.signal,
        credentials: "omit",
        cache: "no-store",
        mode: "cors",
      });
      const text = response.status === 204 ? "" : await response.text();
      let body = null;
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          body = text;
        }
      }
      if (!response.ok) {
        const message =
          (body && typeof body === "object" && (body.error || body.message)) ||
          (typeof body === "string" && body.trim()) ||
          `Driver request failed (${response.status}).`;
        throw new DriverError(message, response.status, body);
      }
      return body;
    } catch (error) {
      if (error instanceof DriverError) throw error;
      if (error?.name === "AbortError") {
        throw new DriverError(`Timed out while contacting ${connection.driverUrl}.`);
      }
      throw new DriverError(
        `Could not reach ${connection.driverUrl}. It may be offline or may not allow the browser origin ${location.origin}.`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  function jsonOptions(method, body, timeout) {
    return {
      method,
      timeout,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    };
  }

  function persistConfig(writeLinkedFile = true) {
    state.config = normalizeConfig(state.config);
    applyTheme(state.config.ui.theme);
    updateMusicUi();
    updateUiSoundUi();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.config));
    } catch (error) {
      toast("Config was not saved", error.message, "error");
    }
    if (writeLinkedFile && state.linkedConfigHandle) scheduleLinkedConfigWrite();
  }

  function configText() {
    return `${JSON.stringify(state.config, null, 2)}\n`;
  }

  function openHandleDatabase() {
    return new Promise((resolve, reject) => {
      if (!globalThis.indexedDB) return reject(new Error("IndexedDB is unavailable."));
      const request = indexedDB.open(HANDLE_DB, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(HANDLE_STORE)) {
          request.result.createObjectStore(HANDLE_STORE);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function handleStore(mode, operation) {
    const database = await openHandleDatabase();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction(HANDLE_STORE, mode);
        const request = operation(transaction.objectStore(HANDLE_STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally {
      database.close();
    }
  }

  async function restoreLinkedConfigHandle() {
    try {
      const handle = await handleStore("readonly", (store) => store.get(HANDLE_KEY));
      if (!handle) return;
      state.linkedConfigHandle = handle;
      state.linkedConfigName = handle.name || "don-console.config.json";
    } catch {
      // A file link is optional; localStorage remains authoritative.
    }
  }

  async function rememberConfigHandle(handle) {
    state.linkedConfigHandle = handle;
    state.linkedConfigName = handle?.name || "don-console.config.json";
    try {
      await handleStore("readwrite", (store) => store.put(handle, HANDLE_KEY));
    } catch {
      // Some browsers cannot clone file handles into IndexedDB.
    }
  }

  function musicTitle(track) {
    return track?.title || String(track?.name || "Unknown track").replace(/\.mp3$/i, "");
  }

  function updateUiSoundUi() {
    const muted = Boolean(state.config.ui.soundsMuted);
    const toggle = byId("ui-sound-toggle");
    menuClickAudio.muted = muted;
    if (!toggle) return;
    toggle.setAttribute("aria-pressed", String(muted));
    toggle.setAttribute("aria-label", muted ? "Unmute UI sounds" : "Mute UI sounds");
    toggle.title = muted ? "Unmute UI sounds" : "Mute UI sounds";
  }

  function playUiSound() {
    if (state.config.ui.soundsMuted) return;
    try {
      menuClickAudio.currentTime = 0;
      const playback = menuClickAudio.play();
      if (playback?.catch) playback.catch(() => {});
    } catch {
      // UI actions must remain usable if audio playback is unavailable.
    }
  }

  function playMenuClick(event) {
    const control = event.target?.closest?.(
      "button, a[href], input:not([type='hidden']):not([type='file']), select, textarea, summary, [role='button'], #drawer-backdrop",
    );
    if (!control || control.disabled || control.getAttribute("aria-disabled") === "true") return;
    playUiSound();
  }

  function toggleUiSounds() {
    const wasMuted = Boolean(state.config.ui.soundsMuted);
    state.config.ui.soundsMuted = !wasMuted;
    persistConfig();
    if (wasMuted) playUiSound();
  }

  function currentMusicTrack() {
    return state.music.tracks[state.music.index] || null;
  }

  function updateMusicUi() {
    const track = currentMusicTrack();
    const hasTracks = state.music.tracks.length > 0;
    const title = byId("music-track-title");
    const play = byId("music-play");
    const previous = byId("music-previous");
    const next = byId("music-next");
    const controller = byId("music-controller");
    if (title) title.textContent = track ? musicTitle(track) : "Loading soundtrack";
    for (const button of [play, previous, next]) {
      if (button) button.disabled = !hasTracks;
    }
    if (play) {
      const playing = hasTracks && !musicAudio.paused;
      play.textContent = playing ? "\u2016" : "\u25b6";
      play.setAttribute("aria-label", playing ? "Pause" : "Play");
      play.title = playing ? "Pause" : "Play";
    }
    if (controller) {
      controller.dataset.playerState = !hasTracks
        ? "empty"
        : state.music.autoplayBlocked
          ? "blocked"
          : musicAudio.paused
            ? "paused"
            : "playing";
    }
  }

  function armMusicResume() {
    if (state.music.resumeArmed) return;
    state.music.resumeArmed = true;
    const resume = (event) => {
      document.removeEventListener("pointerdown", resume, true);
      document.removeEventListener("keydown", resume, true);
      state.music.resumeArmed = false;
      if (!event.target?.closest?.(".music-controller")) void playMusic();
    };
    document.addEventListener("pointerdown", resume, { capture: true, once: true });
    document.addEventListener("keydown", resume, { capture: true, once: true });
  }

  async function playMusic() {
    const track = currentMusicTrack();
    if (!track) return false;
    try {
      await musicAudio.play();
      state.music.autoplayBlocked = false;
      updateMusicUi();
      return true;
    } catch (error) {
      state.music.autoplayBlocked = error?.name === "NotAllowedError";
      updateMusicUi();
      if (state.music.autoplayBlocked) armMusicResume();
      else toast("Music could not play", error.message || musicTitle(track), "error");
      return false;
    }
  }

  async function selectMusicTrack(index, play = false) {
    if (!state.music.tracks.length) return false;
    const length = state.music.tracks.length;
    state.music.index = ((index % length) + length) % length;
    const track = currentMusicTrack();
    musicAudio.pause();
    musicAudio.setAttribute("src", track.src);
    musicAudio.load();
    state.config.ui.music.lastTrack = track.name;
    persistConfig();
    updateMusicUi();
    return play ? playMusic() : true;
  }

  async function changeMusicTrack(direction, forcePlay = false) {
    if (!state.music.tracks.length) return;
    const wasPlaying = !musicAudio.paused;
    const shouldPlay = forcePlay || wasPlaying || state.music.autoplayBlocked;
    if (direction < 0 && musicAudio.currentTime > 4) {
      musicAudio.currentTime = 0;
      if (shouldPlay) await playMusic();
      updateMusicUi();
      return;
    }
    await selectMusicTrack(state.music.index + direction, shouldPlay);
  }

  async function initializeMusic() {
    const remembered = state.config.ui.music.lastTrack;
    const rememberedIndex = state.music.tracks.findIndex((track) => track.name === remembered);
    await selectMusicTrack(rememberedIndex >= 0 ? rememberedIndex : 0, true);
  }

  async function writeConfigHandle(handle, requestPermission) {
    if (!handle?.createWritable) throw new Error("This browser cannot write the selected config file.");
    let permission = handle.queryPermission
      ? await handle.queryPermission({ mode: "readwrite" })
      : "granted";
    if (permission !== "granted" && requestPermission && handle.requestPermission) {
      permission = await handle.requestPermission({ mode: "readwrite" });
    }
    if (permission !== "granted") throw new Error("Write permission was not granted.");
    const writable = await handle.createWritable();
    await writable.write(configText());
    await writable.close();
  }

  function scheduleLinkedConfigWrite() {
    clearTimeout(state.configWriteTimer);
    state.configWriteTimer = setTimeout(async () => {
      try {
        await writeConfigHandle(state.linkedConfigHandle, false);
      } catch {
        // Browser storage remains authoritative until file permission is restored.
      }
    }, 350);
  }

  async function saveConfigFile() {
    try {
      if (state.linkedConfigHandle) {
        await writeConfigHandle(state.linkedConfigHandle, true);
        toast("Config saved", state.linkedConfigName, "success");
        return;
      }
      if (globalThis.showSaveFilePicker) {
        const handle = await showSaveFilePicker({
          suggestedName: "don-console.config.json",
          types: [{ description: "DON Console config", accept: { "application/json": [".json"] } }],
        });
        await rememberConfigHandle(handle);
        await writeConfigHandle(handle, true);
        toast("Config linked", "Future menu and connection changes will update this file while permission remains available.", "success");
        return;
      }
      const blob = new Blob([configText()], { type: "application/json" });
      const anchor = document.createElement("a");
      anchor.href = URL.createObjectURL(blob);
      anchor.download = "don-console.config.json";
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
      toast("Config downloaded", "Keep this file anywhere you store your DON configuration backups.", "success");
    } catch (error) {
      if (error?.name !== "AbortError") toast("Could not save config", error.message, "error");
    }
  }

  async function applyImportedConfig(text, handle = null) {
    const parsed = normalizeConfig(JSON.parse(text));
    state.config = parsed;
    applyTheme(parsed.ui.theme);
    if (handle) await rememberConfigHandle(handle);
    persistConfig(false);
    resetWorkspace();
    await refreshEverything();
    navigate("home");
    toast("Config loaded", `${parsed.connections.length} connection profile(s) restored.`, "success");
  }

  async function openConfigFile() {
    try {
      if (globalThis.showOpenFilePicker) {
        const [handle] = await showOpenFilePicker({
          multiple: false,
          types: [{ description: "DON Console config", accept: { "application/json": [".json"] } }],
        });
        const file = await handle.getFile();
        await applyImportedConfig(await file.text(), handle);
      } else {
        configInput.click();
      }
    } catch (error) {
      if (error?.name !== "AbortError") toast("Could not open config", error.message, "error");
    }
  }

  function toast(title, message, tone = "info", duration = 5000) {
    const region = byId("toast-region");
    const element = document.createElement("div");
    element.className = `toast toast-${tone}`;
    const content = document.createElement("div");
    content.className = "toast-content";
    const heading = document.createElement("p");
    heading.className = "toast-title";
    heading.textContent = title;
    const copy = document.createElement("p");
    copy.className = "toast-message";
    copy.textContent = message || "";
    content.append(heading, copy);
    element.append(content);
    region.append(element);
    setTimeout(() => element.remove(), duration);
  }

  function updateHeader() {
    const connection = activeConnection();
    const status = connection ? connectionStatus(connection.id) : { state: "offline" };
    const statusElement = byId("driver-status");
    statusElement.dataset.status = status.state;
    statusElement.className = `status status-${status.state}`;
    byId("driver-status-label").textContent = connection
      ? `${connection.name}: ${status.state === "online" ? "Online" : status.state === "checking" ? "Checking" : "Offline"}`
      : "No connection";
    byId("driver-version").textContent = status.health?.version
      ? `${status.health.version}${status.health.target ? ` / ${status.health.target}` : ""}`
      : connection?.driverUrl || "No Driver selected";
    byId("last-updated").textContent = formatTime(status.checkedAt);
    const refreshButton = byId("refresh-button");
    refreshButton.setAttribute("aria-busy", String(state.refreshing));
    refreshButton.disabled = state.refreshing;
  }

  async function probeConnection(connection, generation) {
    state.statuses.set(connection.id, { state: "checking", checkedAt: null, health: null, error: null });
    try {
      const health = await driverRequest(connection, "/healthz", { timeout: 4500 });
      if (generation !== state.probeGeneration) return;
      state.statuses.set(connection.id, {
        state: health?.ok === false ? "offline" : "online",
        checkedAt: new Date(),
        health,
        error: health?.ok === false ? "Driver reported not ready." : null,
      });
    } catch (error) {
      if (generation !== state.probeGeneration) return;
      state.statuses.set(connection.id, {
        state: "offline",
        checkedAt: new Date(),
        health: null,
        error: error.message,
      });
    }
  }

  async function probeAllConnections() {
    const generation = ++state.probeGeneration;
    for (const connection of state.config.connections) {
      state.statuses.set(connection.id, { state: "checking", checkedAt: null, health: null, error: null });
    }
    updateHeader();
    scheduleLivePatch({ connections: true });
    await Promise.allSettled(state.config.connections.map((item) => probeConnection(item, generation)));
    if (generation !== state.probeGeneration) return;
    updateHeader();
    scheduleLivePatch({ connections: true });
  }

  function mergeRunSnapshot(previous, incoming) {
    const merged = { ...previous, ...incoming };
    const previousProgress = Array.isArray(previous?.progress) ? previous.progress : [];
    const incomingProgress = Array.isArray(incoming?.progress) ? incoming.progress : [];
    if (previousProgress.length > incomingProgress.length) merged.progress = previousProgress;
    if (TERMINAL_RUNS.has(previous?.status)) {
      merged.status = previous.status;
      if (previous.result != null) merged.result = previous.result;
      if (previous.error != null) merged.error = previous.error;
      merged.progress = previousProgress.length > incomingProgress.length ? previousProgress : incomingProgress;
    }
    return merged;
  }

  function mergeRun(run) {
    if (!run?.runId) return false;
    const previous = state.workspace.runs.get(run.runId) || {};
    const merged = mergeRunSnapshot(previous, run);
    const changed = JSON.stringify(previous) !== JSON.stringify(merged);
    if (changed) state.workspace.runs.set(run.runId, merged);
    if (!state.runSeenAt.has(run.runId)) state.runSeenAt.set(run.runId, new Date());
    return changed;
  }

  function replaceRetainedRuns(runs) {
    const previous = state.workspace.runs;
    const next = new Map();
    for (const run of runs) {
      if (!run?.runId) continue;
      next.set(run.runId, mergeRunSnapshot(previous.get(run.runId) || {}, run));
      if (!state.runSeenAt.has(run.runId)) state.runSeenAt.set(run.runId, new Date());
    }
    state.workspace.runs = next;
    for (const runId of state.runSeenAt.keys()) {
      if (!next.has(runId)) state.runSeenAt.delete(runId);
    }
  }

  const livePatchQueue = {
    scheduled: false,
    activity: false,
    catalog: false,
    connections: false,
    runIds: new Set(),
  };

  function scheduleLivePatch({ activity = false, catalog = false, connections = false, runId = null } = {}) {
    livePatchQueue.activity ||= activity;
    livePatchQueue.catalog ||= catalog;
    livePatchQueue.connections ||= connections;
    if (runId) livePatchQueue.runIds.add(runId);
    if (livePatchQueue.scheduled) return;
    livePatchQueue.scheduled = true;
    requestAnimationFrame(() => {
      const patchActivityScreen = livePatchQueue.activity || livePatchQueue.runIds.size > 0;
      const patchCatalog = livePatchQueue.catalog;
      const patchConnections = livePatchQueue.connections;
      const runIds = [...livePatchQueue.runIds];
      livePatchQueue.activity = false;
      livePatchQueue.catalog = false;
      livePatchQueue.connections = false;
      livePatchQueue.runIds.clear();
      livePatchQueue.scheduled = false;
      if (patchConnections) patchConnectionStatuses();
      if (patchActivityScreen) patchActivity();
      for (const id of runIds) patchRunDrawer(id);
      if (patchCatalog) patchCatalogScreen();
    });
  }

  async function loadRetainedRuns(connection, generation = state.workspaceGeneration) {
    try {
      const runs = await driverRequest(connection, "/actions/runs", { timeout: 8000 });
      if (!Array.isArray(runs)) throw new DriverError("The retained-run response is incompatible.");
      if (!isCurrentWorkspace(connection, generation)) return false;
      state.workspace.runsSupported = true;
      delete state.workspace.errors.runs;
      replaceRetainedRuns(runs);
      return true;
    } catch (error) {
      if (!isCurrentWorkspace(connection, generation)) return false;
      state.workspace.runsSupported = false;
      state.workspace.errors.runs = error.message;
    }
    const ids = state.config.recentRunIdsByConnection[connection.id] || [];
    const snapshots = await Promise.allSettled(
      ids.slice(0, 20).map((id) => driverRequest(connection, `/actions/runs/${encodeURIComponent(id)}`, { timeout: 5000 })),
    );
    if (!isCurrentWorkspace(connection, generation)) return false;
    const recovered = snapshots.filter((result) => result.status === "fulfilled").map((result) => result.value);
    const fallbackAuthoritative = snapshots.every(
      (result) => result.status === "fulfilled" || result.reason?.status === 404,
    );
    if (fallbackAuthoritative) replaceRetainedRuns(recovered);
    else for (const run of recovered) mergeRun(run);
    return fallbackAuthoritative;
  }

  async function loadWorkspace() {
    const connection = activeConnection();
    const generation = ++state.workspaceGeneration;
    if (!connection) {
      state.workspace = emptyWorkspace();
      render();
      return;
    }
    state.workspace = { ...emptyWorkspace(), connectionId: connection.id, loading: true };
    render();
    const requests = {
      health: driverRequest(connection, "/healthz", { timeout: 5000 }),
      actions: driverRequest(connection, "/actions", { timeout: 15000 }),
      objects: driverRequest(connection, "/objects", { timeout: 30000 }),
      classes: driverRequest(connection, "/classes", { timeout: 15000 }),
      settings: driverRequest(connection, "/settings", { timeout: 8000 }),
      stateRoot: driverRequest(connection, "/state-root", { timeout: 12000 }),
    };
    const entries = Object.entries(requests);
    const results = await Promise.allSettled(entries.map(([, request]) => request));
    if (generation !== state.workspaceGeneration || activeConnection()?.id !== connection.id) return;
    const resultByKey = Object.fromEntries(entries.map(([key], index) => [key, results[index]]));
    const catalogAuthoritative = ["actions", "classes"].every(
      (key) => resultByKey[key]?.status === "fulfilled" && Array.isArray(resultByKey[key].value),
    );
    results.forEach((result, index) => {
      const key = entries[index][0];
      if (result.status === "fulfilled") state.workspace[key] = result.value;
      else state.workspace.errors[key] = result.reason?.message || "Request failed.";
    });
    state.workspace.actions = Array.isArray(state.workspace.actions) ? state.workspace.actions : [];
    state.workspace.objects = Array.isArray(state.workspace.objects) ? state.workspace.objects : [];
    state.workspace.classes = Array.isArray(state.workspace.classes) ? state.workspace.classes : [];
    await loadRetainedRuns(connection, generation);
    if (generation !== state.workspaceGeneration || activeConnection()?.id !== connection.id) return;
    state.workspace.loading = false;
    state.workspace.loadedAt = new Date();
    const status = state.statuses.get(connection.id);
    if (state.workspace.health) {
      state.statuses.set(connection.id, {
        state: state.workspace.health.ok === false ? "offline" : "online",
        checkedAt: new Date(),
        health: state.workspace.health,
        error: null,
      });
    } else if (!status || status.state === "checking") {
      state.statuses.set(connection.id, {
        state: "offline",
        checkedAt: new Date(),
        health: null,
        error: state.workspace.errors.health || "Driver unavailable.",
      });
    }
    if (catalogAuthoritative) reconcileSelectedCartridge(connection);
    connectGlobalEvents(connection, generation);
    for (const run of state.workspace.runs.values()) {
      if (!TERMINAL_RUNS.has(run.status)) watchRun(run.runId, connection, generation);
    }
    updateHeader();
    render();
  }

  function resetWorkspace() {
    state.workspaceGeneration += 1;
    state.workspace = emptyWorkspace();
    state.events = [];
    state.runSeenAt.clear();
    closeDrawer();
    if (state.eventSource) state.eventSource.close();
    state.eventSource = null;
    state.eventConnectionId = null;
    state.eventGeneration = null;
    state.techTree.model = null;
    state.techTree.layout = null;
    state.techTree.viewBox = null;
    state.techTree.viewKey = "";
    state.techTree.selectedNodeId = "";
    state.techTree.objectFileName = "";
  }

  async function refreshEverything() {
    if (state.refreshing) return;
    state.refreshing = true;
    updateHeader();
    try {
      await Promise.allSettled([probeAllConnections(), loadWorkspace()]);
    } finally {
      state.refreshing = false;
      updateHeader();
    }
  }

  function connectGlobalEvents(connection, generation = state.workspaceGeneration) {
    if (state.eventSource && state.eventConnectionId === connection.id && state.eventGeneration === generation) return;
    if (state.eventSource) state.eventSource.close();
    state.eventConnectionId = connection.id;
    state.eventGeneration = generation;
    try {
      const source = new EventSource(endpointUrl(connection, "/events"), { withCredentials: false });
      state.eventSource = source;
      source.onopen = () => {
        if (!isCurrentWorkspace(connection, generation) || state.eventSource !== source) return;
        state.workspace.eventStatus = "connected";
        scheduleLivePatch({ activity: true });
      };
      source.onerror = () => {
        if (!isCurrentWorkspace(connection, generation) || state.eventSource !== source) return;
        state.workspace.eventStatus = "reconnecting";
        scheduleLivePatch({ activity: true });
      };
      source.onmessage = (event) => {
        if (!isCurrentWorkspace(connection, generation) || state.eventSource !== source) return;
        let payload;
        try {
          payload = JSON.parse(event.data);
        } catch {
          payload = { type: "message", message: event.data };
        }
        state.events.unshift({ payload, seenAt: new Date(), id: `${Date.now()}-${Math.random()}` });
        state.events = state.events.slice(0, 200);
        if (payload.runId) {
          if (!state.runSeenAt.has(payload.runId)) state.runSeenAt.set(payload.runId, new Date());
          if (payload.status === "done" || TERMINAL_RUNS.has(payload.status)) {
            void fetchRun(payload.runId, connection, generation);
          }
        }
        scheduleLivePatch({ activity: true });
      };
    } catch (error) {
      state.workspace.eventStatus = "unavailable";
      state.workspace.errors.events = error.message;
      scheduleLivePatch({ activity: true });
    }
  }

  async function fetchRun(runId, connection = activeConnection(), generation = state.workspaceGeneration) {
    if (!connection) return null;
    const run = await driverRequest(connection, `/actions/runs/${encodeURIComponent(runId)}`, { timeout: 8000 });
    if (!isCurrentWorkspace(connection, generation)) return null;
    if (mergeRun(run)) scheduleLivePatch({ activity: true, runId });
    return state.workspace.runs.get(runId) || run;
  }

  async function watchRun(runId, connection = activeConnection(), generation = state.workspaceGeneration) {
    if (!connection) return;
    const key = `${connection.id}:${generation}:${runId}`;
    if (state.watchingRuns.has(key)) return;
    state.watchingRuns.add(key);
    try {
      for (let attempt = 0; attempt < 900; attempt += 1) {
        if (!isCurrentWorkspace(connection, generation)) return;
        let run;
        try {
          run = await fetchRun(runId, connection, generation);
        } catch (error) {
          if (error.status === 404) return;
        }
        if (run && TERMINAL_RUNS.has(run.status)) {
          await refreshCatalogAndObjects(connection, generation);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 1200));
      }
    } finally {
      state.watchingRuns.delete(key);
    }
  }

  async function refreshCatalogAndObjects(connection = activeConnection(), generation = state.workspaceGeneration) {
    if (!connection) return;
    const [actions, objects, classes] = await Promise.allSettled([
      driverRequest(connection, "/actions", { timeout: 15000 }),
      driverRequest(connection, "/objects", { timeout: 30000 }),
      driverRequest(connection, "/classes", { timeout: 15000 }),
    ]);
    if (!isCurrentWorkspace(connection, generation)) return false;
    if (actions.status === "fulfilled" && Array.isArray(actions.value)) state.workspace.actions = actions.value;
    if (objects.status === "fulfilled" && Array.isArray(objects.value)) state.workspace.objects = objects.value;
    if (classes.status === "fulfilled" && Array.isArray(classes.value)) state.workspace.classes = classes.value;
    const catalogAuthoritative =
      actions.status === "fulfilled" &&
      Array.isArray(actions.value) &&
      classes.status === "fulfilled" &&
      Array.isArray(classes.value);
    if (catalogAuthoritative) reconcileSelectedCartridge(connection);
    scheduleLivePatch({ catalog: true });
    return true;
  }

  function connectGroups() {
    const groups = new Map();
    const ensure = (name) => {
      if (!groups.has(name)) groups.set(name, { id: name, name, actions: [], classes: [], objects: [] });
      return groups.get(name);
    };
    for (const action of state.workspace.actions) ensure(action.action?.pluginName || "unknown").actions.push(action);
    for (const item of state.workspace.classes) ensure(item.class?.pluginName || "unknown").classes.push(item);
    for (const object of state.workspace.objects) ensure(object.class?.pluginName || "unknown").objects.push(object);
    return [...groups.values()].sort((left, right) => left.name.localeCompare(right.name));
  }

  function selectedCartridge() {
    const selected = activeCartridgeId();
    return connectGroups().find((item) => item.id === selected) || null;
  }

  function reconcileSelectedCartridge(connection = activeConnection()) {
    if (!connection || activeConnection()?.id !== connection.id) return;
    const selected = state.config.activeCartridgeByConnection[connection.id];
    const installed =
      state.workspace.actions.some((item) => item.action?.pluginName === selected) ||
      state.workspace.classes.some((item) => item.class?.pluginName === selected);
    if (selected && !installed) {
      delete state.config.activeCartridgeByConnection[connection.id];
      persistConfig();
    }
  }

  function rememberRun(connectionId, runId) {
    const current = state.config.recentRunIdsByConnection[connectionId] || [];
    state.config.recentRunIdsByConnection[connectionId] = [runId, ...current.filter((id) => id !== runId)].slice(0, 30);
    persistConfig();
  }

  function screenHeading(kicker, title, copy, actions = "") {
    return `
      <div class="screen-heading">
        <div>
          <p class="screen-kicker">${escapeHtml(kicker)}</p>
          <h1 class="screen-title" id="${escapeHtml(`${state.screen}-title`)}">${escapeHtml(title)}</h1>
          <p class="screen-copy">${escapeHtml(copy)}</p>
        </div>
        <div class="screen-actions">${actions}</div>
      </div>`;
  }

  function backButton(label = "Main menu") {
    return `<button class="breadcrumb-button" type="button" data-command="back">Back / ${escapeHtml(label)}</button>`;
  }

  function gameButton(label, command, options = {}) {
    const tone = options.tone ? ` game-button-${options.tone}` : "";
    const disabled = options.disabled ? " disabled" : "";
    const extra = options.extra || "";
    return `<button class="game-button${tone}" type="button" data-command="${escapeHtml(command)}"${extra}${disabled}>${escapeHtml(label)}</button>`;
  }

  function badge(value) {
    const normalized = String(value || "unknown").toLowerCase();
    const className =
      normalized === "succeeded" || normalized === "done" || normalized === "live"
        ? "badge-success"
        : normalized === "failed"
          ? "badge-failed"
          : normalized === "queued" || normalized === "generateproof" || normalized === "committing" || normalized === "running" || normalized === "pending"
            ? "badge-running"
            : "badge-neutral";
    return `<span class="badge ${className}">${escapeHtml(value || "unknown")}</span>`;
  }

  function menuTile(command, icon, title, subtitle, options = {}) {
    const disabled = options.disabled ? ' aria-disabled="true" tabindex="-1"' : "";
    const meta = options.meta ? `<span class="menu-meta">${escapeHtml(options.meta)}</span>` : "";
    const variant = options.className ? ` ${escapeHtml(options.className)}` : "";
    return `
      <button class="menu-tile menu-focusable${variant}" type="button" data-command="${escapeHtml(command)}"${disabled}>
        <span class="menu-icon" aria-hidden="true">${escapeHtml(icon)}</span>
        ${meta}
        <span class="menu-title">${escapeHtml(title)}</span>
        <span class="menu-subtitle">${escapeHtml(subtitle)}</span>
      </button>`;
  }

  function statusInline(status) {
    const value = status?.state || "checking";
    return `<span class="status-inline ${escapeHtml(value)}">${escapeHtml(value)}</span>`;
  }

  function errorPanel(title, message, command = "refresh") {
    return `
      <div class="game-panel">
        <div class="game-error">
          <h2>${escapeHtml(title)}</h2>
          <p>${escapeHtml(message)}</p>
          ${gameButton(command === "connections" ? "Connections" : "Try again", command, { tone: "primary" })}
        </div>
      </div>`;
  }

  function captureFocus(container) {
    const element = document.activeElement;
    if (!element || !container || typeof container.contains !== "function" || !container.contains(element)) return null;
    return {
      id: element.id || "",
      command: element.dataset?.command || "",
      dataId: element.dataset?.id || "",
      treeNodeId: element.dataset?.treeNodeId || "",
      actionInput: element.dataset?.actionInput || "",
      name: element.name || "",
    };
  }

  function findCapturedFocus(container, token) {
    if (!container || !token) return null;
    if (token.id) {
      const byIdentifier = byId(token.id);
      if (byIdentifier && container.contains(byIdentifier)) return byIdentifier;
    }
    if (token.treeNodeId) {
      const treeNode = [...container.querySelectorAll("[data-tree-node-id]")]
        .find((element) => element.dataset.treeNodeId === token.treeNodeId);
      if (treeNode) return treeNode;
    }
    return [...container.querySelectorAll("button, input, select, textarea, [tabindex], [data-command]")].find(
      (element) =>
        (token.command || token.dataId) &&
        (element.dataset?.command || "") === token.command &&
        (element.dataset?.id || "") === token.dataId &&
        (element.dataset?.actionInput || "") === token.actionInput &&
        (element.name || "") === token.name,
    ) || null;
  }

  function render() {
    updateHeader();
    const focusToken = captureFocus(main);
    const shouldAutofocus = Boolean(focusToken) || !document.activeElement || document.activeElement === document.body || document.activeElement === main;
    const supported = new Set([
      "home",
      "connections",
      "connection-edit",
      "cartridges",
      "actions",
      "tree",
      "objects",
      "activity",
      "settings",
      "config",
    ]);
    if (!supported.has(state.screen)) state.screen = "home";
    const renderers = {
      home: renderHome,
      connections: renderConnections,
      "connection-edit": renderConnectionEdit,
      cartridges: renderCartridges,
      actions: renderActions,
      tree: renderTechTree,
      objects: renderObjects,
      activity: renderActivity,
      settings: renderSettings,
      config: renderConfig,
    };
    main.innerHTML = renderers[state.screen]();
    main.dataset.screen = state.screen;
    requestAnimationFrame(() => {
      if (state.screen === "tree") mountTechTree();
      const captured = findCapturedFocus(main, focusToken);
      if (captured) {
        captured.focus({ preventScroll: true });
        return;
      }
      const preferred = main.querySelector("[data-autofocus]") || main.querySelector(".menu-focusable:not([aria-disabled='true'])");
      if (preferred && shouldAutofocus && !main.contains(document.activeElement)) preferred.focus({ preventScroll: true });
    });
  }

  function renderHome() {
    const connection = activeConnection();
    const status = connection ? connectionStatus(connection.id) : { state: "offline" };
    const cartridge = selectedCartridge();
    const online = status.state === "online";
    const subtitle = connection
      ? `${connection.name} is ${status.state}. Choose Play Cartridge to begin.`
      : "Choose a connection, then open a cartridge.";
    return `
      <section class="game-screen" aria-labelledby="home-title">
        ${screenHeading("Console", "Main Menu", subtitle)}
        <nav class="home-menu home-menu-simple" aria-label="Main menu">
          <div class="home-menu-list">
            ${menuTile("cartridges", "PLAY", "Play Cartridge", cartridge
              ? `Choose ${cartridge.name} to play, switch cartridges, or load a new .pexe file.`
              : "Choose an installed cartridge or load a new .pexe file.", { className: "menu-tile-primary", meta: cartridge ? "Ready" : "Select" })}
            ${menuTile("connections", "NET", "Connections", "Choose, add, edit, remove, or configure Driver connections.", { className: "menu-tile-network", meta: `${state.config.connections.length} saved` })}
            ${menuTile("config", "CFG", "Menu Config", "Open, save, reset, or link portable console settings.", { className: "menu-tile-settings", meta: state.linkedConfigName ? "Linked" : "Browser" })}
          </div>
          </nav>
        ${!online && status.error ? `<div class="terminal-note error">${escapeHtml(status.error)}</div>` : ""}
      </section>`;
  }

  function renderConnections() {
    const cards = state.config.connections.map((connection) => {
      const status = connectionStatus(connection.id);
      const active = connection.id === state.config.activeConnectionId;
      return `
        <article class="connection-card${active ? " active" : ""}" data-connection-id="${escapeHtml(connection.id)}">
          ${active ? '<span class="active-marker">Active</span>' : ""}
          <button class="card-select menu-focusable" type="button" data-command="select-connection" data-id="${escapeHtml(connection.id)}" aria-label="Use ${escapeHtml(connection.name)}" aria-pressed="${active}">
            <span class="card-orb" aria-hidden="true">${connection.driverUrl.includes("127.0.0.1") || connection.driverUrl.includes("localhost") ? "LOCAL" : "NET"}</span>
            <span class="card-title">${escapeHtml(connection.name)}</span>
            <span class="card-copy mono">${escapeHtml(connection.driverUrl)}</span>
          </button>
          <div class="card-footer-line">
            <span data-connection-status>${statusInline(status)}</span>
            <span data-connection-version>${escapeHtml(status.health?.version || formatTime(status.checkedAt))}</span>
          </div>
          <div class="card-actions-row">
            ${gameButton("Driver Settings", "connection-settings", { extra: ` data-id="${escapeHtml(connection.id)}"` })}
            ${gameButton("Edit", "edit-connection", { extra: ` data-id="${escapeHtml(connection.id)}"` })}
            ${gameButton("Remove", "delete-connection", {
              tone: "danger",
              disabled: state.config.connections.length === 1,
              extra: ` data-id="${escapeHtml(connection.id)}"`,
            })}
          </div>
          <p class="connection-error" data-connection-error${status.error ? ` title="${escapeHtml(status.error)}"` : " hidden"}>${escapeHtml(status.error || "")}</p>
        </article>`;
    }).join("");
    return `
      <section class="game-screen game-screen-wide" aria-labelledby="connections-title">
        ${screenHeading(
          "Network menu",
          "Connections",
          "Select a Driver, manage its profile, or open its synchronizer, relayer, and MCP settings.",
          `${backButton()}${gameButton("Check status", "probe-connections")}${gameButton("Add connection", "add-connection", { tone: "primary" })}`,
        )}
        <div class="connection-grid">${cards}</div>
        <div class="terminal-note warning">
          Remote profiles require a browser-reachable DON-compatible endpoint with CORS enabled. Stock dobjd binds to loopback; expose it only through a trusted tunnel or gateway.
        </div>
      </section>`;
  }

  function patchConnectionStatuses() {
    updateHeader();
    if (state.screen !== "connections") return;
    main.querySelectorAll("[data-connection-id]").forEach((card) => {
      const status = connectionStatus(card.dataset.connectionId);
      const statusElement = card.querySelector("[data-connection-status]");
      const versionElement = card.querySelector("[data-connection-version]");
      const errorElement = card.querySelector("[data-connection-error]");
      if (statusElement) statusElement.innerHTML = statusInline(status);
      if (versionElement) versionElement.textContent = status.health?.version || formatTime(status.checkedAt);
      if (errorElement) {
        errorElement.textContent = status.error || "";
        errorElement.hidden = !status.error;
        if (status.error) errorElement.title = status.error;
        else errorElement.removeAttribute("title");
      }
    });
  }

  function renderConnectionEdit() {
    const existing = state.editingConnectionId
      ? state.config.connections.find((item) => item.id === state.editingConnectionId)
      : null;
    const seed = existing || {
      id: "",
      name: "Remote Driver",
      driverUrl: "https://",
      mcpUrl: "https://",
      synchronizerUrl: DEFAULT_SYNCHRONIZER,
      relayerUrl: DEFAULT_RELAYER,
    };
    return `
      <section class="game-screen" aria-labelledby="connection-edit-title">
        ${screenHeading(
          "Connection profile",
          existing ? "Edit connection" : "Add connection",
          "The Driver API is used for status, cartridges, objects, and action runs. Other server values remain editable defaults for this profile.",
          backButton("Connections"),
        )}
        <div class="game-panel">
          <div class="game-panel-body">
            <form id="connection-form" class="game-form" data-existing-id="${escapeHtml(existing?.id || "")}">
              <div class="game-form-grid">
                <div class="game-field">
                  <label for="connection-name">Menu name</label>
                  <input id="connection-name" name="name" class="game-input" required maxlength="80" value="${escapeHtml(seed.name)}" />
                </div>
                <div class="game-field">
                  <label for="connection-driver">Driver API</label>
                  <input id="connection-driver" name="driverUrl" class="game-input mono" required type="url" value="${escapeHtml(seed.driverUrl)}" />
                  <small>For example http://127.0.0.1:${bakedDriverPort()} or an HTTPS gateway.</small>
                </div>
                <div class="game-field">
                  <label for="connection-mcp">MCP endpoint</label>
                  <input id="connection-mcp" name="mcpUrl" class="game-input mono" type="url" value="${escapeHtml(seed.mcpUrl)}" />
                </div>
                <div class="game-field">
                  <label for="connection-sync">Synchronizer default</label>
                  <input id="connection-sync" name="synchronizerUrl" class="game-input mono" type="url" value="${escapeHtml(seed.synchronizerUrl)}" />
                </div>
                <div class="game-field full">
                  <label for="connection-relay">Relayer default</label>
                  <input id="connection-relay" name="relayerUrl" class="game-input mono" type="url" value="${escapeHtml(seed.relayerUrl)}" />
                </div>
              </div>
              <div class="terminal-note">
                The profile stores endpoint addresses only. This static client never stores passwords, tokens, or cookies and sends Driver requests without browser credentials.
              </div>
              <div class="game-form-actions">
                ${gameButton("Cancel", "back")}
                <button class="game-button game-button-primary" type="submit">${existing ? "Save connection" : "Add connection"}</button>
              </div>
            </form>
          </div>
        </div>
      </section>`;
  }

  function cartridgeCatalogMarkup(connection = activeConnection()) {
    const status = connection ? connectionStatus(connection.id) : { state: "offline" };
    const groups = connectGroups();
    const selected = activeCartridgeId();
    const cards = groups.map((item) => {
      const liveObjects = item.objects.filter((object) => object.status === "live").length;
      const active = item.id === selected;
      return `
        <button class="cartridge-card menu-focusable${active ? " active" : ""}" type="button" data-command="select-cartridge" data-id="${escapeHtml(item.id)}" aria-pressed="${active}">
          ${active ? '<span class="active-marker">Current</span>' : ""}
          <span class="card-orb" aria-hidden="true">${escapeHtml(item.name.slice(0, 3).toUpperCase())}</span>
          <span class="card-title">${escapeHtml(item.name)}</span>
          <span class="card-copy">Select to open this cartridge's Play menu.</span>
          <span class="card-footer-line">
            <span>${item.actions.length} actions</span>
            <span>${item.classes.length} classes</span>
            <span>${liveObjects} live</span>
          </span>
        </button>`;
    }).join("");
    const loadCard = `
      <button class="cartridge-card menu-focusable" type="button" data-command="load-cartridge"${status.state !== "online" ? ' aria-disabled="true" tabindex="-1"' : ""}>
        <span class="card-orb" aria-hidden="true">+</span>
        <span class="card-title">Load new cartridge</span>
        <span class="card-copy">Choose a .pexe archive. The active Driver validates and installs it immediately.</span>
        <span class="card-footer-line"><span>PEXE</span><span>8 MiB maximum</span></span>
      </button>`;
    return state.workspace.loading
      ? '<div class="game-panel"><div class="game-empty"><h2>Reading Driver catalog</h2><p>Please wait.</p></div></div>'
      : state.workspace.errors.actions
        ? errorPanel("Catalog unavailable", state.workspace.errors.actions, "connections")
        : `<div class="cartridge-grid">${loadCard}${cards}</div>`;
  }

  function renderCartridges() {
    const connection = activeConnection();
    return `
      <section class="game-screen game-screen-wide" aria-labelledby="cartridges-title">
        ${screenHeading(
          "Cartridge menu",
          "Select Cartridge",
          connection ? `Choose a cartridge from ${connection.name} to open its Play menu, or load a new .pexe file.` : "Choose a Driver connection first.",
          backButton(),
        )}
        <div data-catalog-region="cartridges">${cartridgeCatalogMarkup(connection)}</div>
        <div class="terminal-note warning">
          A plain browser client cannot stage or inspect publisher identity before installation. dobjd validates the archive and catalog, but selecting Load commits the cartridge directly to that Driver.
        </div>
      </section>`;
  }

  function compatibleObjects(required, used = new Set()) {
    return state.workspace.objects.filter(
      (object) =>
        object.status === "live" &&
        !used.has(object.fileName) &&
        object.classHash === required.hash &&
        sameQualified(object.class, required.class),
    );
  }

  function actionReady(action) {
    const used = new Set();
    for (const required of action.totalInputs || []) {
      const candidate = compatibleObjects(required, used)[0];
      if (!candidate) return false;
      used.add(candidate.fileName);
    }
    return true;
  }

  function techTreeClassId(value, explicitHash = "") {
    const qualified = value?.class?.pluginName ? value.class : value;
    const hash = explicitHash || value?.hash || value?.classHash || "unhashed";
    return `place:${qualifiedKey(qualified)}@${hash}`;
  }

  function techTreeActionId(action) {
    return `transition:${qualifiedKey(action?.action)}@${action?.hash || "unhashed"}`;
  }

  function techTreeNodeLabelLines(value, maxLength = 18) {
    const words = String(value || "Unnamed")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/[_-]+/g, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    const lines = [""];
    for (const word of words) {
      const candidate = `${lines[lines.length - 1]} ${word}`.trim();
      if (candidate.length <= maxLength || !lines[lines.length - 1]) {
        lines[lines.length - 1] = candidate;
      } else if (lines.length < 2) {
        lines.push(word);
      } else {
        const last = lines[1];
        lines[1] = `${last.slice(0, Math.max(1, maxLength - 1))}\u2026`;
        break;
      }
    }
    return lines.slice(0, 2);
  }

  function buildTechTreeModel(cartridge = selectedCartridge()) {
    if (!cartridge) return null;
    const places = new Map();
    const transitions = new Map();
    const edgeMap = new Map();

    const ensurePlace = (qualified, hash, metadata = {}) => {
      const id = techTreeClassId(qualified, hash);
      let place = places.get(id);
      if (!place) {
        place = {
          id,
          kind: "place",
          key: qualifiedKey(qualified),
          qualified: { pluginName: qualified?.pluginName || "?", name: qualified?.name || "Unknown" },
          hash: hash || "",
          label: qualified?.name || "Unknown",
          emoji: "\ud83d\udce6",
          description: "Referenced object class",
          declared: false,
          external: qualified?.pluginName !== cartridge.id,
          objects: [],
          counts: { live: 0, pending: 0, unknown: 0, nullified: 0 },
        };
        places.set(id, place);
      }
      if (metadata.declared) place.declared = true;
      if (metadata.emoji) place.emoji = metadata.emoji;
      if (metadata.description) place.description = metadata.description;
      if (metadata.classSummary) place.classSummary = metadata.classSummary;
      return place;
    };

    for (const item of cartridge.classes) {
      ensurePlace(item.class, item.hash, {
        declared: true,
        emoji: item.emoji,
        description: item.description,
        classSummary: item,
      });
    }

    for (const object of cartridge.objects) {
      ensurePlace(object.class, object.classHash, {
        emoji: object.emoji,
        description: object.description,
      });
    }

    const addEdge = (source, target, role, slotIndex) => {
      const key = `${source}\u0000${target}\u0000${role}`;
      let edge = edgeMap.get(key);
      if (!edge) {
        edge = { id: `edge:${edgeMap.size}`, source, target, role, count: 0, slotIndexes: [] };
        edgeMap.set(key, edge);
      }
      edge.count += 1;
      edge.slotIndexes.push(slotIndex);
    };

    for (const action of cartridge.actions) {
      const id = techTreeActionId(action);
      const transition = {
        id,
        kind: "transition",
        key: qualifiedKey(action.action),
        label: action.action?.name || "Unnamed action",
        emoji: action.emoji || "\u2699",
        description: action.description || "",
        hash: action.hash || "",
        action,
        ready: actionReady(action),
        source: !(action.totalInputs || []).length,
        sink: !(action.totalOutputs || []).length,
      };
      transitions.set(id, transition);
      (action.totalInputs || []).forEach((required, index) => {
        const place = ensurePlace(required.class, required.hash);
        addEdge(place.id, id, "input", index);
      });
      (action.totalOutputs || []).forEach((produced, index) => {
        const place = ensurePlace(produced.class, produced.hash);
        addEdge(id, place.id, "output", index);
      });
    }

    for (const object of cartridge.objects) {
      const place = places.get(techTreeClassId(object.class, object.classHash));
      if (!place) continue;
      place.objects.push(object);
      const status = new Set(["live", "pending", "unknown", "nullified"]).has(object.status)
        ? object.status
        : "unknown";
      place.counts[status] += 1;
    }

    const allNodes = [...places.values(), ...transitions.values()];
    const allEdges = [...edgeMap.values()];
    const requestedObject = state.techTree.objectFileName
      ? cartridge.objects.find((object) => object.fileName === state.techTree.objectFileName) || null
      : null;
    const focusObject = state.techTree.mode === "object" ? requestedObject : null;
    let nodes = allNodes;
    let edges = allEdges;
    let focusPlaceId = "";

    if (focusObject) {
      focusPlaceId = techTreeClassId(focusObject.class, focusObject.classHash);
      const included = new Set([focusPlaceId]);
      const branchTransitions = new Set();
      for (const edge of allEdges) {
        if (edge.source === focusPlaceId && transitions.has(edge.target)) branchTransitions.add(edge.target);
        if (edge.target === focusPlaceId && transitions.has(edge.source)) branchTransitions.add(edge.source);
      }
      for (const transitionId of branchTransitions) {
        included.add(transitionId);
        for (const edge of allEdges) {
          if (edge.source === transitionId) included.add(edge.target);
          if (edge.target === transitionId) included.add(edge.source);
        }
      }
      nodes = allNodes.filter((node) => included.has(node.id));
      edges = allEdges.filter((edge) => included.has(edge.source) && included.has(edge.target));
    }

    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const topology = [
      state.techTree.mode,
      focusPlaceId,
      ...nodes.map((node) => `${node.kind}:${node.id}`).sort(),
      ...edges.map((edge) => `${edge.source}>${edge.target}:${edge.role}:${edge.count}`).sort(),
    ].join("|");
    return {
      cartridge,
      nodes,
      edges,
      nodeById,
      allNodes,
      allEdges,
      focusObject,
      focusPlaceId,
      fingerprint: topology,
    };
  }

  function techTreeConnectedComponents(nodes, edges) {
    const adjacency = new Map(nodes.map((node) => [node.id, new Set()]));
    for (const edge of edges) {
      adjacency.get(edge.source)?.add(edge.target);
      adjacency.get(edge.target)?.add(edge.source);
    }
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const unseen = new Set(nodeById.keys());
    const components = [];
    while (unseen.size) {
      const first = [...unseen].sort()[0];
      const stack = [first];
      const ids = [];
      unseen.delete(first);
      while (stack.length) {
        const id = stack.pop();
        ids.push(id);
        for (const neighbor of adjacency.get(id) || []) {
          if (!unseen.has(neighbor)) continue;
          unseen.delete(neighbor);
          stack.push(neighbor);
        }
      }
      components.push(ids.map((id) => nodeById.get(id)));
    }
    return components.sort((left, right) =>
      right.length - left.length || left[0].label.localeCompare(right[0].label),
    );
  }

  function techTreeDependencyRanks(component, edges) {
    const nodeById = new Map(component.map((node) => [node.id, node]));
    const incoming = new Map(component.map((node) => [node.id, []]));
    const outgoing = new Map(component.map((node) => [node.id, []]));
    for (const edge of edges) {
      incoming.get(edge.target)?.push(edge);
      outgoing.get(edge.source)?.push(edge);
    }
    const ranks = new Map();

    for (const node of component) {
      if (node.kind === "transition" && !(incoming.get(node.id) || []).length) ranks.set(node.id, 0);
      if (node.kind === "place") {
        const realProducers = (incoming.get(node.id) || []).filter((edge) => {
          const transitionInputs = incoming.get(edge.source) || [];
          return !transitionInputs.some((input) => input.source === node.id);
        });
        if (!realProducers.length) ranks.set(node.id, 0);
      }
    }

    const setEarlierRank = (id, candidate) => {
      const previous = ranks.get(id);
      if (previous != null && previous <= candidate) return false;
      ranks.set(id, candidate);
      return true;
    };

    for (let pass = 0; pass < component.length * 2; pass += 1) {
      let changed = false;
      for (const node of component) {
        if (node.kind !== "transition") continue;
        const inputs = incoming.get(node.id) || [];
        if (!inputs.length) {
          changed = setEarlierRank(node.id, 0) || changed;
        } else if (inputs.every((edge) => ranks.has(edge.source))) {
          const candidate = Math.max(...inputs.map((edge) => ranks.get(edge.source))) + 1;
          changed = setEarlierRank(node.id, candidate) || changed;
        }
        if (!ranks.has(node.id)) continue;
        for (const edge of outgoing.get(node.id) || []) {
          const roundTrip = inputs.some((input) => input.source === edge.target);
          if (!roundTrip) changed = setEarlierRank(edge.target, ranks.get(node.id) + 1) || changed;
        }
      }
      if (!changed) break;
    }

    const unresolved = new Set(component.map((node) => node.id).filter((id) => !ranks.has(id)));
    if (unresolved.size) {
      const seeds = ranks.size ? [...ranks.keys()] : [[...unresolved].sort()[0]];
      if (!ranks.size) {
        ranks.set(seeds[0], 0);
        unresolved.delete(seeds[0]);
      }
      const queue = [...seeds];
      while (queue.length && unresolved.size) {
        const source = queue.shift();
        const neighbors = [
          ...(incoming.get(source) || []).map((edge) => edge.source),
          ...(outgoing.get(source) || []).map((edge) => edge.target),
        ];
        for (const target of neighbors) {
          if (!unresolved.has(target)) continue;
          unresolved.delete(target);
          ranks.set(target, (ranks.get(source) || 0) + 1);
          queue.push(target);
        }
      }
      let fallbackRank = Math.max(...ranks.values(), 0) + 1;
      for (const id of [...unresolved].sort()) ranks.set(id, fallbackRank++);
    }

    const uniqueRanks = [...new Set(ranks.values())].sort((left, right) => left - right);
    const compact = new Map(uniqueRanks.map((rank, index) => [rank, index]));
    return new Map([...ranks].map(([id, rank]) => [id, compact.get(rank)]));
  }

  function layoutTechTree(model) {
    const NODE_WIDTH = 154;
    const PLACE_HEIGHT = 58;
    const TRANSITION_HEIGHT = 48;
    const COLUMN_STEP = 224;
    const ROW_STEP = 82;
    const COMPONENT_GAP = 46;
    const positions = new Map();
    const componentBoxes = [];
    const components = techTreeConnectedComponents(model.nodes, model.edges);
    let yOffset = 0;
    let graphWidth = 520;

    components.forEach((component, componentIndex) => {
      const componentIds = new Set(component.map((node) => node.id));
      const componentEdges = model.edges.filter(
        (edge) => componentIds.has(edge.source) && componentIds.has(edge.target),
      );
      const rankByNode = techTreeDependencyRanks(component, componentEdges);

      const columns = new Map();
      for (const node of component) {
        const rank = rankByNode.get(node.id) || 0;
        if (!columns.has(rank)) columns.set(rank, []);
        columns.get(rank).push(node);
      }
      const ranks = [...columns.keys()].sort((left, right) => left - right);
      const compareNodes = (left, right) =>
        (left.kind === right.kind ? 0 : left.kind === "place" ? -1 : 1) || left.label.localeCompare(right.label);
      for (const rank of ranks) columns.get(rank).sort(compareNodes);

      for (let sweep = 0; sweep < 4; sweep += 1) {
        const orderedRanks = sweep % 2 === 0 ? ranks : [...ranks].reverse();
        const order = new Map();
        for (const rank of ranks) columns.get(rank).forEach((node, index) => order.set(node.id, index));
        for (const rank of orderedRanks) {
          const list = columns.get(rank);
          const scored = list.map((node) => {
            const neighbors = componentEdges
              .filter((edge) => sweep % 2 === 0 ? edge.target === node.id : edge.source === node.id)
              .map((edge) => sweep % 2 === 0 ? edge.source : edge.target)
              .filter((id) => order.has(id));
            const score = neighbors.length
              ? neighbors.reduce((sum, id) => sum + order.get(id), 0) / neighbors.length
              : Number.POSITIVE_INFINITY;
            return { node, score };
          });
          scored.sort((left, right) =>
            left.score - right.score || compareNodes(left.node, right.node),
          );
          columns.set(rank, scored.map((item) => item.node));
        }
      }

      const maxRows = Math.max(...[...columns.values()].map((items) => items.length), 1);
      const componentHeight = 66 + maxRows * ROW_STEP;
      const maxRank = Math.max(...ranks, 0);
      const componentWidth = 80 + maxRank * COLUMN_STEP + NODE_WIDTH;
      graphWidth = Math.max(graphWidth, componentWidth + 38);
      for (const rank of ranks) {
        const list = columns.get(rank);
        const listHeight = list.length * ROW_STEP;
        const startY = yOffset + 54 + Math.max(0, (maxRows * ROW_STEP - listHeight) / 2);
        list.forEach((node, index) => {
          const height = node.kind === "place" ? PLACE_HEIGHT : TRANSITION_HEIGHT;
          positions.set(node.id, {
            x: 42 + rank * COLUMN_STEP,
            y: startY + index * ROW_STEP + (ROW_STEP - height) / 2,
            width: NODE_WIDTH,
            height,
            rank,
            componentIndex,
          });
        });
      }
      componentBoxes.push({
        index: componentIndex,
        x: 14,
        y: yOffset + 12,
        width: componentWidth + 24,
        height: componentHeight - 8,
        nodes: component.length,
        actions: component.filter((node) => node.kind === "transition").length,
      });
      yOffset += componentHeight + COMPONENT_GAP;
    });

    for (const box of componentBoxes) box.width = graphWidth - 28;
    return {
      positions,
      componentBoxes,
      components: components.length,
      bounds: { x: 0, y: 0, width: graphWidth, height: Math.max(280, yOffset - COMPONENT_GAP + 18) },
    };
  }

  function techTreeNodeStatus(node) {
    if (node.kind === "transition") {
      if (node.source) return node.ready ? "OPEN SOURCE" : "SOURCE";
      if (node.sink) return node.ready ? "READY / SINK" : "NEEDS TOKENS";
      return node.ready ? "READY" : "NEEDS TOKENS";
    }
    const live = node.counts?.live || 0;
    const pending = node.counts?.pending || 0;
    if (live) return `${live} LIVE${pending ? ` / ${pending} PENDING` : ""}`;
    if (pending) return `${pending} PENDING`;
    return "NO LIVE TOKENS";
  }

  function techTreeNodeAria(node) {
    const kind = node.kind === "place" ? "state" : "transition";
    return `${kind}, ${node.label}, ${techTreeNodeStatus(node)}`;
  }

  function techTreeEdgeGeometry(edge, positions) {
    const source = positions.get(edge.source);
    const target = positions.get(edge.target);
    if (!source || !target) return null;
    if (source.rank === target.rank) {
      const sourceX = source.x + source.width;
      const targetX = target.x + target.width;
      const sourceY = source.y + source.height / 2;
      const targetY = target.y + target.height / 2;
      const bend = Math.max(sourceX, targetX) + 52 + Math.min(40, Math.abs(sourceY - targetY) * 0.12);
      return {
        path: `M ${sourceX} ${sourceY} C ${bend} ${sourceY}, ${bend} ${targetY}, ${targetX} ${targetY}`,
        labelX: bend,
        labelY: (sourceY + targetY) / 2,
      };
    }
    const forward = target.x >= source.x;
    const sourceX = forward ? source.x + source.width : source.x;
    const targetX = forward ? target.x : target.x + target.width;
    const sourceY = source.y + source.height / 2;
    const targetY = target.y + target.height / 2;
    const control = Math.max(44, Math.abs(targetX - sourceX) * 0.46);
    const firstControl = sourceX + (forward ? control : -control);
    const secondControl = targetX + (forward ? -control : control);
    return {
      path: `M ${sourceX} ${sourceY} C ${firstControl} ${sourceY}, ${secondControl} ${targetY}, ${targetX} ${targetY}`,
      labelX: (sourceX + targetX) / 2,
      labelY: (sourceY + targetY) / 2,
    };
  }

  function drawTechTreeSvg(model, layout) {
    const parts = [`
      <defs>
        <marker id="tree-arrow-input" class="tech-tree-marker tech-tree-marker-input" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z"></path></marker>
        <marker id="tree-arrow-output" class="tech-tree-marker tech-tree-marker-output" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z"></path></marker>
      </defs>`];

    for (const box of layout.componentBoxes) {
      const label = `NETWORK ${String(box.index + 1).padStart(2, "0")} / ${box.nodes} NODES / ${box.actions} TRANSITIONS`;
      parts.push(`
        <g class="tech-tree-component" aria-hidden="true">
          <rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}"></rect>
          <text x="${box.x + 12}" y="${box.y + 18}">${escapeHtml(label)}</text>
        </g>`);
    }

    for (const edge of model.edges) {
      const geometry = techTreeEdgeGeometry(edge, layout.positions);
      if (!geometry) continue;
      parts.push(`
        <g class="tech-tree-edge tech-tree-edge-${edge.role}" aria-hidden="true">
          <path d="${geometry.path}" marker-end="url(#tree-arrow-${edge.role})"></path>
          ${edge.count > 1 ? `<g class="tech-tree-edge-count" transform="translate(${geometry.labelX} ${geometry.labelY})"><rect x="-13" y="-9" width="26" height="17"></rect><text y="4">x${edge.count}</text></g>` : ""}
        </g>`);
    }

    for (const node of model.nodes) {
      const position = layout.positions.get(node.id);
      if (!position) continue;
      const lines = techTreeNodeLabelLines(node.label);
      const selected = node.id === state.techTree.selectedNodeId;
      const focused = node.id === model.focusPlaceId;
      const classes = [
        "tech-tree-node",
        `tech-tree-node-${node.kind}`,
        node.kind === "transition" && node.ready ? "is-ready" : "",
        node.kind === "place" && node.counts.live ? "has-live" : "",
        node.external ? "is-external" : "",
        selected ? "is-selected" : "",
        focused ? "is-object-state" : "",
      ].filter(Boolean).join(" ");
      const transform = `translate(${position.x} ${position.y})`;
      const status = techTreeNodeStatus(node);
      const labelX = node.kind === "place" ? 38 : 12;
      const textAnchor = node.kind === "place" ? "start" : "middle";
      const anchorX = node.kind === "place" ? labelX : position.width / 2;
      const lineStart = lines.length > 1 ? 19 : 25;
      const shape = node.kind === "place"
        ? `<rect class="tech-tree-node-frame" width="${position.width}" height="${position.height}"></rect><rect class="tech-tree-token-well" x="8" y="10" width="23" height="23"></rect><text class="tech-tree-node-emoji" x="19.5" y="27" text-anchor="middle">${escapeHtml(node.emoji || "\ud83d\udce6")}</text>`
        : `<path class="tech-tree-node-frame" d="M 8 0 H ${position.width - 8} L ${position.width} 8 V ${position.height - 8} L ${position.width - 8} ${position.height} H 8 L 0 ${position.height - 8} V 8 Z"></path>`;
      parts.push(`
        <g class="${classes}" transform="${transform}" data-tree-node-id="${escapeHtml(node.id)}" data-tree-kind="${node.kind}" role="button" tabindex="0" aria-label="${escapeHtml(techTreeNodeAria(node))}">
          <title>${escapeHtml(`${node.label}: ${status}`)}</title>
          ${shape}
          <text class="tech-tree-node-label" x="${anchorX}" y="${lineStart}" text-anchor="${textAnchor}">
            ${lines.map((line, index) => `<tspan x="${anchorX}" dy="${index ? 12 : 0}">${escapeHtml(line)}</tspan>`).join("")}
          </text>
          <text class="tech-tree-node-status" data-tree-node-status x="${anchorX}" y="${position.height - 7}" text-anchor="${textAnchor}">${escapeHtml(status)}</text>
        </g>`);
    }
    return parts.join("");
  }

  function techTreeGroupedRefs(refs) {
    const grouped = new Map();
    for (const ref of refs || []) {
      const key = `${qualifiedKey(ref.class)}@${ref.hash || ""}`;
      const current = grouped.get(key) || { ref, count: 0 };
      current.count += 1;
      grouped.set(key, current);
    }
    return [...grouped.values()];
  }

  function techTreeRefsMarkup(refs, emptyLabel) {
    const grouped = techTreeGroupedRefs(refs);
    return grouped.length
      ? grouped.map(({ ref, count }) => `<span class="chip">${escapeHtml(ref.class?.name || "?")}${count > 1 ? ` x${count}` : ""}</span>`).join("")
      : `<span class="chip">${escapeHtml(emptyLabel)}</span>`;
  }

  function techTreeBranchLabel(model, transition) {
    const outputs = techTreeGroupedRefs(transition.action?.totalOutputs || [])
      .map(({ ref, count }) => `${ref.class?.name || "?"}${count > 1 ? ` x${count}` : ""}`)
      .join(" + ");
    return `${transition.label} \u2192 ${outputs || "terminal"}`;
  }

  function techTreeDetailsMarkup(model) {
    const selected = model.nodeById.get(state.techTree.selectedNodeId) || null;
    const allNodeById = new Map(model.allNodes.map((node) => [node.id, node]));
    const focusObject = model.focusObject;
    if (!selected) {
      if (focusObject) {
        const place = allNodeById.get(model.focusPlaceId);
        const branches = model.allEdges
          .filter((edge) => edge.source === model.focusPlaceId)
          .map((edge) => allNodeById.get(edge.target))
          .filter((node) => node?.kind === "transition");
        return `
          <div class="tech-tree-detail-heading">
            <div><span class="tech-tree-detail-kind">Selected object</span><h2>${escapeHtml(`${focusObject.emoji || ""} ${focusObject.class?.name || "Object"}`)}</h2></div>
            ${gameButton("Open object", "view-object", { extra: ` data-id="${escapeHtml(focusObject.fileName)}"` })}
          </div>
          <p class="tech-tree-detail-copy">Current state: ${escapeHtml(place?.label || focusObject.class?.name || "Unknown")} / ${escapeHtml(focusObject.status || "unknown")}. ${branches.length} possible outgoing transition${branches.length === 1 ? "" : "s"} use this class.</p>`;
      }
      return `
        <div class="tech-tree-detail-heading"><div><span class="tech-tree-detail-kind">Graph inspector</span><h2>Select a node</h2></div></div>
        <p class="tech-tree-detail-copy">Choose a class state or action transition to inspect its tokens, requirements, and branches.</p>`;
    }

    if (selected.kind === "transition") {
      return `
        <div class="tech-tree-detail-heading">
          <div><span class="tech-tree-detail-kind">Action transition / ${selected.ready ? "locally ready" : "needs tokens"}</span><h2>${escapeHtml(`${selected.emoji || ""} ${selected.label}`)}</h2></div>
          ${gameButton("Set up action", "setup-action", { tone: "primary", extra: ` data-id="${escapeHtml(selected.key)}"` })}
        </div>
        <p class="tech-tree-detail-copy">${escapeHtml(selected.description || "No description")}</p>
        <div class="tech-tree-detail-io">
          <div><span>Required states</span><div class="chip-list">${techTreeRefsMarkup(selected.action.totalInputs, "No inputs / source")}</div></div>
          <div><span>Produced states</span><div class="chip-list">${techTreeRefsMarkup(selected.action.totalOutputs, "No outputs / sink")}</div></div>
        </div>`;
    }

    const incoming = model.allEdges
      .filter((edge) => edge.target === selected.id)
      .map((edge) => allNodeById.get(edge.source))
      .filter((node) => node?.kind === "transition");
    const outgoing = model.allEdges
      .filter((edge) => edge.source === selected.id)
      .map((edge) => allNodeById.get(edge.target))
      .filter((node) => node?.kind === "transition");
    const objects = [...(selected.objects || [])].sort((left, right) =>
      (left.fileName === focusObject?.fileName ? -1 : 0) - (right.fileName === focusObject?.fileName ? -1 : 0) ||
      (left.status === "live" ? -1 : 1) - (right.status === "live" ? -1 : 1) ||
      left.fileName.localeCompare(right.fileName),
    );
    const objectButtons = objects.slice(0, 12).map((object) => `
      <button class="tech-tree-token${object.fileName === focusObject?.fileName ? " is-current" : ""}" type="button" data-command="view-object" data-id="${escapeHtml(object.fileName)}">
        <span>${escapeHtml(shortText(object.contentHash))}</span><small>${escapeHtml(`${object.fileName === focusObject?.fileName ? "selected / " : ""}${object.status || "unknown"}`)}</small>
      </button>`).join("");
    const branchButtons = outgoing.map((transition) => `
      <button class="tech-tree-branch" type="button" data-command="setup-action" data-id="${escapeHtml(transition.key)}">
        <span>${escapeHtml(techTreeBranchLabel(model, transition))}</span><small>${transition.ready ? "READY" : "NEEDS TOKENS"}</small>
      </button>`).join("");
    return `
      <div class="tech-tree-detail-heading">
        <div><span class="tech-tree-detail-kind">Class state / ${objects.filter((item) => item.status === "live").length} live tokens</span><h2>${escapeHtml(`${selected.emoji || ""} ${selected.label}`)}</h2></div>
      </div>
      <p class="tech-tree-detail-copy">${focusObject && selected.id === model.focusPlaceId ? `Selected object ${escapeHtml(shortText(focusObject.contentHash))} is ${escapeHtml(focusObject.status || "unknown")} in this state. ` : ""}${escapeHtml(selected.description || "No description")} ${incoming.length} incoming and ${outgoing.length} outgoing public transition${outgoing.length === 1 ? "" : "s"}.</p>
      <div class="tech-tree-detail-columns">
        <div><span class="tech-tree-detail-label">Object tokens</span><div class="tech-tree-token-list">${objectButtons || '<span class="terminal-inline">No local objects in this state.</span>'}${objects.length > 12 ? `<span class="terminal-inline">+${objects.length - 12} more</span>` : ""}</div></div>
        <div><span class="tech-tree-detail-label">Possible outgoing branches</span><div class="tech-tree-branch-list">${branchButtons || '<span class="terminal-inline">Terminal state / no outgoing transition.</span>'}</div></div>
      </div>`;
  }

  function renderTechTree() {
    const cartridge = selectedCartridge();
    if (!cartridge) {
      return `
        <section class="game-screen" aria-labelledby="tree-title">
          ${screenHeading("Cartridge map", "No cartridge selected", "Choose a cartridge before opening its dependency graph.", backButton())}
          ${errorPanel("Select a cartridge", "The skill tree is built from one cartridge's action and class catalog.", "cartridges")}
        </section>`;
    }
    const objects = [...cartridge.objects].sort((left, right) =>
      (left.status === "live" ? -1 : 1) - (right.status === "live" ? -1 : 1) ||
      (left.class?.name || "").localeCompare(right.class?.name || "") ||
      left.fileName.localeCompare(right.fileName),
    );
    if (state.techTree.objectFileName && !objects.some((object) => object.fileName === state.techTree.objectFileName)) {
      state.techTree.objectFileName = "";
    }
    if (state.techTree.mode === "object" && !state.techTree.objectFileName && objects.length) {
      state.techTree.objectFileName = objects[0].fileName;
    }
    if (state.techTree.mode === "object" && !objects.length) state.techTree.mode = "all";
    const options = objects.map((object) => `
      <option value="${escapeHtml(object.fileName)}"${object.fileName === state.techTree.objectFileName ? " selected" : ""}>${escapeHtml(`${object.emoji || ""} ${object.class?.name || "Object"} / ${shortText(object.contentHash)} / ${object.status}`)}</option>`).join("");
    const allMode = state.techTree.mode !== "object";
    return `
      <section class="game-screen game-screen-wide tech-tree-screen" aria-labelledby="tree-title">
        ${screenHeading(
          `${cartridge.name} cartridge`,
          "Cartridge Skill Tree",
          "Explore every public class and action signature as a Petri net, including disconnected networks.",
          `${backButton("Play")}${gameButton("Play", "actions")}${gameButton("Objects", "objects")}`,
        )}
        <div class="tech-tree-toolbar">
          <div class="game-toolbar-group" role="group" aria-label="Tree view">
            ${gameButton("Full Net", "tree-mode", { tone: allMode ? "primary" : "", extra: ` data-value="all" aria-pressed="${allMode}"` })}
            ${gameButton("Object Branches", "tree-mode", { tone: !allMode ? "primary" : "", extra: ` data-value="object" aria-pressed="${!allMode}"${objects.length ? "" : " disabled"}` })}
          </div>
          <label class="tech-tree-object-control" for="tree-object-select"><span>Object lens</span><select id="tree-object-select" class="game-select"${objects.length ? "" : " disabled"}><option value="">${objects.length ? "Choose object" : "No objects"}</option>${options}</select></label>
          <div class="game-toolbar-group tech-tree-view-controls" role="group" aria-label="Graph view controls">
            ${gameButton("-", "tree-zoom-out", { extra: ' aria-label="Zoom out" title="Zoom out"' })}
            ${gameButton("Fit", "tree-fit")}
            ${gameButton("+", "tree-zoom-in", { extra: ' aria-label="Zoom in" title="Zoom in"' })}
          </div>
        </div>
        <div id="tech-tree-root" data-catalog-region="tree">
          <div class="tech-tree-legend" aria-label="Graph legend">
            <span><i class="legend-place" aria-hidden="true"></i>Class state</span>
            <span><i class="legend-transition" aria-hidden="true"></i>Action transition</span>
            <span><i class="legend-ready" aria-hidden="true"></i>Locally ready</span>
            <span class="tech-tree-counts"><b data-tree-place-count>0</b> states / <b data-tree-action-count>0</b> transitions / <b data-tree-network-count>0</b> networks</span>
          </div>
          <div class="tech-tree-canvas">
            <svg id="tech-tree-svg" role="group" aria-labelledby="tech-tree-svg-title tech-tree-svg-description" preserveAspectRatio="xMidYMid meet">
              <title id="tech-tree-svg-title">${escapeHtml(cartridge.name)} action dependency graph</title>
              <desc id="tech-tree-svg-description">Class states connect to action transitions through required input and produced output arcs.</desc>
            </svg>
            <span class="tech-tree-map-help" aria-hidden="true">Drag to pan / wheel to zoom / arrows move node focus</span>
          </div>
          <div id="tech-tree-details" class="tech-tree-details" aria-live="polite"></div>
          <div class="terminal-note tech-tree-truth-note">This map uses the Driver's public, flattened action signatures. Object branches are possible transitions, not disclosed private provenance or hidden sub-action internals.</div>
        </div>
      </section>`;
  }

  function fittedTechTreeView(layout) {
    const padding = 28;
    return {
      x: layout.bounds.x - padding,
      y: layout.bounds.y - padding,
      width: layout.bounds.width + padding * 2,
      height: layout.bounds.height + padding * 2,
    };
  }

  function applyTechTreeViewBox() {
    const svg = byId("tech-tree-svg");
    const view = state.techTree.viewBox;
    if (!svg || !view) return;
    svg.setAttribute("viewBox", `${view.x} ${view.y} ${view.width} ${view.height}`);
  }

  function updateTechTreeCounts(model, layout) {
    const root = byId("tech-tree-root");
    if (!root) return;
    const places = model.nodes.filter((node) => node.kind === "place").length;
    const transitions = model.nodes.length - places;
    const placeCount = root.querySelector("[data-tree-place-count]");
    const actionCount = root.querySelector("[data-tree-action-count]");
    const networkCount = root.querySelector("[data-tree-network-count]");
    if (placeCount) placeCount.textContent = String(places);
    if (actionCount) actionCount.textContent = String(transitions);
    if (networkCount) networkCount.textContent = String(layout.components);
  }

  function updateTechTreeDetails(model = state.techTree.model) {
    const details = byId("tech-tree-details");
    if (details && model) details.innerHTML = techTreeDetailsMarkup(model);
  }

  function mountTechTree() {
    const svg = byId("tech-tree-svg");
    const root = byId("tech-tree-root");
    if (!svg || !root || state.screen !== "tree") return;
    const model = buildTechTreeModel();
    if (!model || !model.nodes.length) {
      svg.innerHTML = '<text class="tech-tree-empty" x="20" y="40">No classes or actions are available for this cartridge.</text>';
      return;
    }
    const layout = layoutTechTree(model);
    state.techTree.model = model;
    state.techTree.layout = layout;
    if (!model.nodeById.has(state.techTree.selectedNodeId)) {
      state.techTree.selectedNodeId = model.focusPlaceId || "";
    }
    if (state.techTree.viewKey !== model.fingerprint || !state.techTree.viewBox) {
      state.techTree.viewKey = model.fingerprint;
      state.techTree.viewBox = fittedTechTreeView(layout);
    }
    root.dataset.treeFingerprint = model.fingerprint;
    svg.innerHTML = drawTechTreeSvg(model, layout);
    applyTechTreeViewBox();
    updateTechTreeCounts(model, layout);
    updateTechTreeDetails(model);
  }

  function fitTechTree() {
    if (!state.techTree.layout) return;
    state.techTree.viewBox = fittedTechTreeView(state.techTree.layout);
    applyTechTreeViewBox();
  }

  function zoomTechTree(factor, anchor = null) {
    const layout = state.techTree.layout;
    const current = state.techTree.viewBox;
    if (!layout || !current) return;
    const centerX = anchor?.x ?? current.x + current.width / 2;
    const centerY = anchor?.y ?? current.y + current.height / 2;
    const minimumWidth = Math.max(180, layout.bounds.width * 0.08);
    const maximumWidth = Math.max(layout.bounds.width * 4, 1200);
    const nextWidth = Math.min(maximumWidth, Math.max(minimumWidth, current.width * factor));
    const ratio = nextWidth / current.width;
    const nextHeight = current.height * ratio;
    const anchorRatioX = (centerX - current.x) / current.width;
    const anchorRatioY = (centerY - current.y) / current.height;
    state.techTree.viewBox = {
      x: centerX - nextWidth * anchorRatioX,
      y: centerY - nextHeight * anchorRatioY,
      width: nextWidth,
      height: nextHeight,
    };
    applyTechTreeViewBox();
  }

  function selectTechTreeNode(id, focus = false) {
    const model = state.techTree.model;
    if (!model?.nodeById.has(id)) return;
    state.techTree.selectedNodeId = id;
    main.querySelectorAll("[data-tree-node-id]").forEach((element) => {
      element.classList.toggle("is-selected", element.dataset.treeNodeId === id);
    });
    updateTechTreeDetails(model);
    if (focus) {
      [...main.querySelectorAll("[data-tree-node-id]")]
        .find((element) => element.dataset.treeNodeId === id)
        ?.focus({ preventScroll: true });
    }
  }

  function focusAdjacentTechTreeNode(currentId, key) {
    const layout = state.techTree.layout;
    const current = layout?.positions.get(currentId);
    if (!layout || !current) return;
    const direction = {
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
      ArrowUp: { x: 0, y: -1 },
      ArrowDown: { x: 0, y: 1 },
    }[key];
    if (!direction) return;
    const currentCenter = { x: current.x + current.width / 2, y: current.y + current.height / 2 };
    let best = null;
    for (const [id, position] of layout.positions) {
      if (id === currentId) continue;
      const center = { x: position.x + position.width / 2, y: position.y + position.height / 2 };
      const dx = center.x - currentCenter.x;
      const dy = center.y - currentCenter.y;
      const forward = dx * direction.x + dy * direction.y;
      if (forward <= 1) continue;
      const sideways = Math.abs(dx * direction.y - dy * direction.x);
      const score = forward + sideways * 2.4;
      if (!best || score < best.score) best = { id, score };
    }
    if (!best) return;
    const element = [...main.querySelectorAll("[data-tree-node-id]")]
      .find((node) => node.dataset.treeNodeId === best.id);
    element?.focus({ preventScroll: true });
  }

  function techTreePointFromEvent(svg, event) {
    const rect = svg.getBoundingClientRect();
    const view = state.techTree.viewBox;
    if (!rect.width || !rect.height || !view) return null;
    return {
      x: view.x + ((event.clientX - rect.left) / rect.width) * view.width,
      y: view.y + ((event.clientY - rect.top) / rect.height) * view.height,
    };
  }

  function beginTechTreePan(event) {
    const svg = event.target.closest?.("#tech-tree-svg");
    if (!svg || event.button !== 0 || event.target.closest?.("[data-tree-node-id]") || !state.techTree.viewBox) return;
    state.techTree.drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      viewBox: { ...state.techTree.viewBox },
    };
    svg.classList.add("is-dragging");
    svg.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  function moveTechTreePan(event) {
    const drag = state.techTree.drag;
    const svg = byId("tech-tree-svg");
    if (!drag || !svg || drag.pointerId !== event.pointerId) return;
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    state.techTree.viewBox = {
      ...drag.viewBox,
      x: drag.viewBox.x - ((event.clientX - drag.startX) / rect.width) * drag.viewBox.width,
      y: drag.viewBox.y - ((event.clientY - drag.startY) / rect.height) * drag.viewBox.height,
    };
    applyTechTreeViewBox();
    event.preventDefault();
  }

  function endTechTreePan(event) {
    const drag = state.techTree.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const svg = byId("tech-tree-svg");
    svg?.classList.remove("is-dragging");
    if (svg?.hasPointerCapture?.(event.pointerId)) svg.releasePointerCapture(event.pointerId);
    state.techTree.drag = null;
  }

  function wheelTechTree(event) {
    const svg = event.target.closest?.("#tech-tree-svg");
    if (!svg || !state.techTree.viewBox) return;
    const anchor = techTreePointFromEvent(svg, event);
    if (!anchor) return;
    const factor = Math.min(1.35, Math.max(0.74, Math.exp(event.deltaY * 0.0014)));
    zoomTechTree(factor, anchor);
    event.preventDefault();
  }

  function patchTechTree() {
    if (state.screen !== "tree") return;
    const root = byId("tech-tree-root");
    const model = buildTechTreeModel();
    if (!root || !model) return;
    if (state.techTree.mode === "object" && !model.focusObject) {
      state.techTree.mode = "all";
      state.techTree.objectFileName = "";
      state.techTree.selectedNodeId = "";
      state.techTree.viewKey = "";
      render();
      return;
    }
    if (root.dataset.treeFingerprint !== model.fingerprint) {
      mountTechTree();
      return;
    }
    state.techTree.model = model;
    if (!model.nodeById.has(state.techTree.selectedNodeId)) state.techTree.selectedNodeId = model.focusPlaceId || "";
    main.querySelectorAll("[data-tree-node-id]").forEach((element) => {
      const node = model.nodeById.get(element.dataset.treeNodeId);
      if (!node) return;
      element.classList.toggle("is-ready", node.kind === "transition" && node.ready);
      element.classList.toggle("has-live", node.kind === "place" && Boolean(node.counts.live));
      element.classList.toggle("is-selected", node.id === state.techTree.selectedNodeId);
      element.setAttribute("aria-label", techTreeNodeAria(node));
      const status = element.querySelector("[data-tree-node-status]");
      if (status) status.textContent = techTreeNodeStatus(node);
    });
    updateTechTreeCounts(model, state.techTree.layout);
    updateTechTreeDetails(model);
  }

  function actionCatalogMarkup(cartridge = selectedCartridge()) {
    if (!cartridge) return errorPanel("Select a cartridge", "Choose a cartridge from the cartridge menu to open its Play screen.", "cartridges");
    const query = state.actionSearch.trim().toLowerCase();
    const filtered = cartridge.actions.filter((action) => {
      const ready = actionReady(action);
      const matches = !query || action.action?.name?.toLowerCase().includes(query) || action.description?.toLowerCase().includes(query);
      if (!matches) return false;
      if (state.actionFilter === "ready") return ready;
      if (state.actionFilter === "needs") return !ready;
      return true;
    });
    const visible = filtered.slice(0, state.actionLimit);
    const cards = visible.map((action) => {
      const ready = actionReady(action);
      const inputs = (action.totalInputs || []).map((item) => `<span class="chip">${escapeHtml(item.class?.name || "?")}</span>`).join("") || '<span class="chip">No inputs</span>';
      const outputs = (action.totalOutputs || []).map((item) => `<span class="chip">${escapeHtml(item.class?.name || "?")}</span>`).join("") || '<span class="chip">No outputs</span>';
      return `
        <button class="action-card menu-focusable" type="button" data-command="setup-action" data-id="${escapeHtml(qualifiedKey(action.action))}">
          <span class="card-orb" aria-hidden="true">${escapeHtml(action.emoji || "ACT")}</span>
          <span class="active-marker">${ready ? "Ready" : "Needs items"}</span>
          <span class="card-title">${escapeHtml(action.action?.name || "Unnamed action")}</span>
          <span class="card-copy">${escapeHtml(action.description || "No description")}</span>
          <span class="io-preview"><span class="io-label">In</span><span class="chip-list">${inputs}</span></span>
          <span class="io-preview"><span class="io-label">Out</span><span class="chip-list">${outputs}</span></span>
          <span class="card-footer-line"><span>${escapeHtml(action.action?.pluginName || "")}</span><span>${ready ? "Set up" : "Inspect"}</span></span>
        </button>`;
    }).join("");
    return `${state.workspace.errors.actions
      ? errorPanel("Actions unavailable", state.workspace.errors.actions)
      : visible.length
        ? `<div class="action-grid">${cards}</div>`
        : '<div class="game-panel"><div class="game-empty"><h2>No actions match</h2><p>Change the search or readiness filter.</p></div></div>'}
      ${filtered.length > visible.length ? `<div class="load-more">${gameButton(`Show ${Math.min(60, filtered.length - visible.length)} more`, "more-actions")}</div>` : ""}`;
  }

  function renderActions() {
    const cartridge = selectedCartridge();
    if (!cartridge) {
      return `
        <section class="game-screen" aria-labelledby="actions-title">
          ${screenHeading("Play menu", "No cartridge selected", "Choose a cartridge before browsing actions.", backButton())}
          <div data-catalog-region="actions">${actionCatalogMarkup(null)}</div>
        </section>`;
    }
    const filters = ["all", "ready", "needs"].map((value) => `
      <button class="game-button${state.actionFilter === value ? " game-button-primary" : ""}" type="button" data-command="filter-actions" data-value="${value}" aria-pressed="${state.actionFilter === value}">${value === "needs" ? "Needs items" : value}</button>`).join("");
    return `
      <section class="game-screen game-screen-wide" aria-labelledby="actions-title">
        ${screenHeading(
          `${cartridge.name} cartridge`,
          "Play",
          "Choose an action. The Driver performs the authoritative feasibility check before inputs are submitted.",
          `${backButton()}${gameButton("Switch Cartridge", "cartridges")}${gameButton("Tech Tree", "tree")}${gameButton("Objects", "objects")}${gameButton("Activity", "activity")}`,
        )}
        <div class="game-toolbar">
          <input id="action-search" class="game-input game-search" type="search" placeholder="Search actions" value="${escapeHtml(state.actionSearch)}" aria-label="Search actions" />
          <div class="game-toolbar-group">${filters}</div>
        </div>
        <div data-catalog-region="actions">${actionCatalogMarkup(cartridge)}</div>
      </section>`;
  }

  function actionByKey(key) {
    return state.workspace.actions.find((action) => qualifiedKey(action.action) === key) || null;
  }

  async function openActionSetup(key) {
    const action = actionByKey(key);
    if (!action) return toast("Action unavailable", "Refresh the Driver catalog and try again.", "error");
    state.drawer = { type: "action", key, report: null, error: null, loading: true, selections: [] };
    openDrawer();
    renderDrawer();
    const connection = activeConnection();
    try {
      const report = await driverRequest(
        connection,
        `/actions/${encodeURIComponent(key)}/feasibility`,
        { timeout: 15000 },
      );
      if (state.drawer?.type !== "action" || state.drawer.key !== key) return;
      state.drawer.report = report;
      state.drawer.loading = false;
      const used = new Set();
      state.drawer.selections = (action.totalInputs || []).map((required) => {
        const candidates = actionCandidates(required, report, used);
        const selected = candidates.length === 1 ? candidates[0].fileName : "";
        if (selected) used.add(selected);
        return selected;
      });
    } catch (error) {
      if (state.drawer?.type !== "action" || state.drawer.key !== key) return;
      state.drawer.loading = false;
      state.drawer.error = error.message;
    }
    renderDrawer(false);
  }

  function actionCandidates(required, report, used = new Set()) {
    const available = new Set(
      (report?.availableInputs || [])
        .filter((candidate) => sameQualified(candidate.class, required.class))
        .map((candidate) => candidate.fileName),
    );
    return compatibleObjects(required, used).filter((object) => !report || available.has(object.fileName));
  }

  function renderActionDrawer(action, model) {
    const used = new Set(model.selections.filter(Boolean));
    const slots = (action.totalInputs || []).map((required, index) => {
      const usedElsewhere = new Set([...used].filter((fileName) => fileName !== model.selections[index]));
      const candidates = actionCandidates(required, model.report, usedElsewhere);
      return `
        <div class="game-field">
          <label for="action-input-${index}">Input ${index + 1} / ${escapeHtml(required.class?.name || "Object")}</label>
          <select id="action-input-${index}" class="game-select" data-action-input="${index}">
            <option value="">Choose an object</option>
            ${candidates.map((object) => `<option value="${escapeHtml(object.fileName)}"${model.selections[index] === object.fileName ? " selected" : ""}>${escapeHtml(`${object.emoji || ""} ${object.class?.name || "Object"} / ${shortText(object.contentHash)}`)}</option>`).join("")}
          </select>
          ${candidates.length ? "" : "<small>No compatible live object is available.</small>"}
        </div>`;
    }).join("");
    const outputs = (action.totalOutputs || []).map((item) => `<span class="chip">${escapeHtml(item.class?.name || "?")}</span>`).join("") || '<span class="chip">No declared output</span>';
    const unique = new Set(model.selections.filter(Boolean)).size === (action.totalInputs || []).length;
    const complete = model.selections.filter(Boolean).length === (action.totalInputs || []).length;
    const canRun = !model.loading && !model.error && model.report?.feasible === true && complete && unique;
    return `
      <div class="drawer-header">
        <div><p class="screen-kicker">Action setup</p><h2 class="drawer-title" id="drawer-title">${escapeHtml(action.action?.name || "Action")}</h2></div>
        <button class="game-button" type="button" data-command="close-drawer">Close</button>
      </div>
      <div class="drawer-body">
        <p class="screen-copy">${escapeHtml(action.description || "")}</p>
        ${model.loading ? '<div class="terminal-note">Checking feasibility with the Driver...</div>' : ""}
        ${model.error ? `<div class="terminal-note error">${escapeHtml(model.error)}</div>` : ""}
        <form id="action-run-form" class="game-form">
          ${(action.totalInputs || []).length ? slots : '<div class="terminal-note">This action requires no input objects.</div>'}
          <div class="game-panel">
            <div class="game-panel-header"><h3>Expected outputs</h3></div>
            <div class="game-panel-body"><div class="chip-list">${outputs}</div></div>
          </div>
          <div class="terminal-note warning">Submitting starts a mutation directly on the selected Driver. If the browser loses the response, check Activity before retrying.</div>
          <div class="game-form-actions">
            <button class="game-button game-button-primary" type="submit"${canRun ? "" : " disabled"}>Run action</button>
          </div>
        </form>
      </div>`;
  }

  async function submitActionRun() {
    const model = state.drawer;
    if (model?.type !== "action") return;
    const action = actionByKey(model.key);
    const connection = activeConnection();
    const generation = state.workspaceGeneration;
    if (!action || !connection) return;
    const selections = model.selections || [];
    if (selections.filter(Boolean).length !== (action.totalInputs || []).length) return;
    const submit = drawerContent.querySelector('#action-run-form button[type="submit"]');
    if (submit) {
      submit.disabled = true;
      submit.textContent = "Starting...";
    }
    try {
      const accepted = await driverRequest(
        connection,
        "/actions/run",
        jsonOptions("POST", { input: { action: action.action, inputObjectPaths: selections } }, 30000),
      );
      if (!accepted?.runId) throw new DriverError("Driver accepted the request without returning a run id.");
      rememberRun(connection.id, accepted.runId);
      if (!isCurrentWorkspace(connection, generation)) {
        toast("Action started", `${action.action.name} started on ${connection.name}. Switch back to follow ${shortText(accepted.runId)}.`, "success");
        return;
      }
      mergeRun({ ...accepted, action: action.action, result: null, error: null, progress: [] });
      void watchRun(accepted.runId, connection, generation);
      if (state.drawer === model) {
        closeDrawer();
        navigate("activity");
        openRunDrawer(accepted.runId);
      }
      toast("Action started", `${action.action.name} / ${shortText(accepted.runId)}`, "success");
    } catch (error) {
      const ambiguous = error.status === 0;
      toast(
        ambiguous ? "Outcome unknown" : "Action was not started",
        ambiguous ? `${error.message} Check Activity before retrying; the Driver may have accepted the mutation.` : error.message,
        "error",
        9000,
      );
      if (submit && state.drawer === model) {
        submit.disabled = false;
        submit.textContent = "Run action";
      }
      if (ambiguous && isCurrentWorkspace(connection, generation)) {
        void loadRetainedRuns(connection, generation).then(() => {
          if (isCurrentWorkspace(connection, generation)) scheduleLivePatch({ activity: true });
        });
      }
    }
  }

  function objectCatalogMarkup(cartridge = selectedCartridge()) {
    if (!cartridge) return errorPanel("Select a cartridge", "Choose a cartridge before opening its objects.", "cartridges");
    const query = state.objectSearch.trim().toLowerCase();
    const filtered = state.workspace.objects.filter((object) => {
      if (object.class?.pluginName !== cartridge.id) return false;
      if (state.objectStatus !== "all" && (object.status || "unknown") !== state.objectStatus) return false;
      return !query || object.class?.name?.toLowerCase().includes(query) || object.fileName?.toLowerCase().includes(query) || object.contentHash?.toLowerCase().includes(query);
    });
    const visible = filtered.slice(0, state.objectLimit);
    const cards = visible.map((object) => `
      <button class="object-card menu-focusable" type="button" data-command="view-object" data-id="${escapeHtml(object.fileName)}">
        <span class="card-orb" aria-hidden="true">${escapeHtml(object.emoji || "OBJ")}</span>
        <span class="active-marker">${escapeHtml(object.status || "unknown")}</span>
        <span class="card-title">${escapeHtml(object.class?.name || "Unknown object")}</span>
        <span class="card-copy mono">${escapeHtml(shortText(object.contentHash, 10, 7))}</span>
        <span class="card-footer-line"><span>${escapeHtml(object.class?.pluginName || "")}</span><span>${escapeHtml(object.status || "unknown")}</span></span>
      </button>`).join("");
    return `${state.workspace.errors.objects
      ? errorPanel("Objects unavailable", state.workspace.errors.objects)
      : visible.length
        ? `<div class="object-grid">${cards}</div>`
        : '<div class="game-panel"><div class="game-empty"><h2>No objects match</h2><p>Change the search, status, or selected cartridge.</p></div></div>'}
      ${filtered.length > visible.length ? `<div class="load-more">${gameButton(`Show ${Math.min(90, filtered.length - visible.length)} more`, "more-objects")}</div>` : ""}`;
  }

  function renderObjects() {
    const cartridge = selectedCartridge();
    if (!cartridge) {
      return `
        <section class="game-screen" aria-labelledby="objects-title">
          ${screenHeading("Object menu", "No cartridge selected", "Objects are shown only for the selected cartridge.", backButton())}
          <div data-catalog-region="objects">${objectCatalogMarkup(null)}</div>
        </section>`;
    }
    const statusOptions = ["all", "live", "pending", "nullified", "unknown"]
      .map((value) => `<option value="${value}"${state.objectStatus === value ? " selected" : ""}>${value}</option>`)
      .join("");
    return `
      <section class="game-screen game-screen-wide" aria-labelledby="objects-title">
        ${screenHeading(
          `${cartridge.name} cartridge`,
          "Objects",
          "Only objects belonging to the selected cartridge are shown.",
          `${backButton("Play")}${gameButton("Play", "actions")}${gameButton("Tech Tree", "tree")}${gameButton("Activity", "activity")}${gameButton("Import .dobj", "import-object", { tone: "primary", disabled: connectionStatus(activeConnection()?.id).state !== "online" })}`,
        )}
        <div class="game-toolbar">
          <input id="object-search" class="game-input game-search" type="search" placeholder="Search objects" value="${escapeHtml(state.objectSearch)}" aria-label="Search objects" />
          <div class="game-toolbar-group">
            <label class="sr-only" for="object-status">Object status</label>
            <select id="object-status" class="game-select">${statusOptions}</select>
          </div>
        </div>
        <div data-catalog-region="objects">${objectCatalogMarkup(cartridge)}</div>
      </section>`;
  }

  function patchCatalogScreen() {
    const screen = state.screen;
    if (!new Set(["actions", "objects", "cartridges", "tree"]).has(screen)) return;
    if (screen === "tree") {
      patchTechTree();
      return;
    }
    const region = main.querySelector(`[data-catalog-region="${screen}"]`);
    if (!region) return;
    if (screen === "actions") region.innerHTML = actionCatalogMarkup();
    else if (screen === "objects") region.innerHTML = objectCatalogMarkup();
    else region.innerHTML = cartridgeCatalogMarkup();
  }

  function patchActionFilterControls() {
    if (state.screen !== "actions") return;
    main.querySelectorAll("[data-command='filter-actions']").forEach((button) => {
      const selected = button.dataset.value === state.actionFilter;
      button.classList.toggle("game-button-primary", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
  }

  function objectByFile(fileName) {
    return state.workspace.objects.find((object) => object.fileName === fileName) || null;
  }

  async function openObjectDrawer(
    fileName,
    connection = activeConnection(),
    generation = state.workspaceGeneration,
  ) {
    if (!isCurrentWorkspace(connection, generation)) return;
    state.drawer = { type: "object", fileName, object: objectByFile(fileName), loading: true, error: null };
    const model = state.drawer;
    openDrawer();
    renderDrawer();
    try {
      const object = await driverRequest(connection, `/objects/${encodeURIComponent(fileName)}`, { timeout: 12000 });
      if (!isCurrentWorkspace(connection, generation) || state.drawer !== model) return;
      state.drawer.object = object;
      state.drawer.loading = false;
    } catch (error) {
      if (!isCurrentWorkspace(connection, generation) || state.drawer !== model) return;
      state.drawer.loading = false;
      state.drawer.error = error.message;
    }
    renderDrawer(false);
  }

  function renderObjectDrawer(model) {
    const object = model.object;
    return `
      <div class="drawer-header">
        <div><p class="screen-kicker">Digital object</p><h2 class="drawer-title" id="drawer-title">${escapeHtml(object?.class?.name || model.fileName)}</h2></div>
        <div class="drawer-header-actions">
          ${object ? gameButton("View branches", "object-tree", { extra: ` data-id="${escapeHtml(object.fileName)}"` }) : ""}
          <button class="game-button" type="button" data-command="close-drawer">Close</button>
        </div>
      </div>
      <div class="drawer-body">
        ${model.loading ? '<div class="terminal-note">Reading object details...</div>' : ""}
        ${model.error ? `<div class="terminal-note error">${escapeHtml(model.error)}</div>` : ""}
        ${object ? `
          <div class="summary-strip">
            <div class="summary-stat"><span>Status</span><strong>${escapeHtml(object.status || "unknown")}</strong></div>
            <div class="summary-stat"><span>Cartridge</span><strong>${escapeHtml(object.class?.pluginName || "unknown")}</strong></div>
            <div class="summary-stat"><span>Class</span><strong>${escapeHtml(object.class?.name || "unknown")}</strong></div>
            <div class="summary-stat"><span>Transaction</span><strong>${escapeHtml(shortText(object.txHash))}</strong></div>
          </div>
          <div class="game-panel"><div class="game-panel-header"><h3>Fields</h3></div><div class="game-panel-body"><pre class="code-block">${safeJson(object.fields || {})}</pre></div></div>
          <div class="game-panel"><div class="game-panel-header"><h3>Identity</h3></div><div class="game-panel-body"><pre class="code-block">file: ${escapeHtml(object.fileName)}\ncontent: ${escapeHtml(object.contentHash)}\nclass: ${escapeHtml(object.classHash)}</pre></div></div>
        ` : ""}
      </div>`;
  }

  async function importObjectFile(file) {
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) return toast("Object file is too large", "The browser import limit is 10 MiB.", "error");
    const connection = activeConnection();
    const generation = state.workspaceGeneration;
    if (!connection) return toast("Choose a Driver", "Select a connection before importing an object.", "error");
    try {
      const text = await file.text();
      JSON.parse(text);
      const object = await driverRequest(connection, "/objects/import", jsonOptions("POST", { dobj: text }, 45000));
      if (!isCurrentWorkspace(connection, generation)) {
        toast("Object imported", `${object?.class?.name || file.name} was imported on ${connection.name}.`, "success");
        return;
      }
      await refreshCatalogAndObjects(connection, generation);
      if (!isCurrentWorkspace(connection, generation)) return;
      toast("Object imported", object?.class?.name || file.name, "success");
      if (object?.fileName) openObjectDrawer(object.fileName, connection, generation);
    } catch (error) {
      toast("Object import failed", error.message, "error", 8000);
    } finally {
      dobjInput.value = "";
    }
  }

  function sortedRuns() {
    return [...state.workspace.runs.values()].sort((left, right) => {
      const leftTime = state.runSeenAt.get(left.runId)?.valueOf() || 0;
      const rightTime = state.runSeenAt.get(right.runId)?.valueOf() || 0;
      return rightTime - leftTime;
    });
  }

  function activityRunRowsMarkup() {
    const runRows = sortedRuns().map((run) => `
      <li class="game-list-row">
        <div class="game-list-main">
          <p class="game-list-title">${escapeHtml(run.action?.name || "Action run")}</p>
          <div class="game-list-meta"><span class="mono">${escapeHtml(shortText(run.runId, 10, 7))}</span><span>${escapeHtml(formatDate(state.runSeenAt.get(run.runId)))}</span></div>
        </div>
        <div class="game-toolbar-group">${badge(run.status)}${gameButton("View", "view-run", { extra: ` data-id="${escapeHtml(run.runId)}"` })}</div>
      </li>`).join("");
    return runRows
      ? `<ul class="game-list">${runRows}</ul>`
      : '<div class="game-empty"><h2>No retained runs</h2><p>Start an action from Play or wait for another local client.</p></div>';
  }

  function activityEventRowsMarkup() {
    const eventRows = state.events.slice(0, 80).map((entry) => {
      const payload = entry.payload || {};
      const title = payload.phase || payload.type || "Driver event";
      const message = payload.message || (payload.runId ? `Run ${shortText(payload.runId)}` : "Event received");
      return `
        <li class="game-list-row">
          <div class="game-list-main">
            <p class="game-list-title">${escapeHtml(title)}</p>
            <div class="game-list-meta"><span>${escapeHtml(message)}</span><span>${escapeHtml(formatTime(entry.seenAt))}</span></div>
          </div>
          ${payload.status ? badge(payload.status) : ""}
        </li>`;
    }).join("");
    return eventRows
      ? `<ul class="game-list">${eventRows}</ul>`
      : '<div class="game-empty"><h2>No events yet</h2><p>The event stream is connected while this page remains open.</p></div>';
  }

  function runsWarningMarkup() {
    return state.workspace.runsSupported === false
      ? '<div class="terminal-note warning">This Driver does not expose a compatible retained-run inventory. Runs started by this browser are recovered individually while the daemon still retains them.</div>'
      : "";
  }

  function renderActivity() {
    const runs = sortedRuns();
    return `
      <section class="game-screen game-screen-wide" aria-labelledby="activity-title">
        ${screenHeading(
          "Driver telemetry",
          "Activity",
          "Retained runs come from dobjd; the live event list exists only in this browser tab.",
          `${backButton("Play")}${gameButton("Play", "actions")}${gameButton("Tech Tree", "tree")}${gameButton("Objects", "objects")}${gameButton("Refresh runs", "refresh-runs")}`,
        )}
        <div data-runs-warning>${runsWarningMarkup()}</div>
        <div class="panel-grid">
          <div class="game-panel">
            <div class="game-panel-header"><h2>Action runs</h2><span data-activity-run-count>${runs.length}</span></div>
            <div class="game-panel-body flush" data-activity-runs>${activityRunRowsMarkup()}</div>
          </div>
          <div class="game-panel">
            <div class="game-panel-header"><h2>Live event stream</h2><span data-activity-event-status class="status-inline ${state.workspace.eventStatus === "connected" ? "online" : "checking"}">${escapeHtml(state.workspace.eventStatus || "connecting")}</span></div>
            <div class="game-panel-body flush" data-activity-events>${activityEventRowsMarkup()}</div>
          </div>
        </div>
      </section>`;
  }

  function patchActivity() {
    if (state.screen !== "activity") return;
    const runCount = main.querySelector("[data-activity-run-count]");
    const runList = main.querySelector("[data-activity-runs]");
    const eventStatus = main.querySelector("[data-activity-event-status]");
    const eventList = main.querySelector("[data-activity-events]");
    const warning = main.querySelector("[data-runs-warning]");
    if (runCount) runCount.textContent = String(state.workspace.runs.size);
    if (runList) runList.innerHTML = activityRunRowsMarkup();
    if (eventStatus) {
      eventStatus.textContent = state.workspace.eventStatus || "connecting";
      eventStatus.className = `status-inline ${state.workspace.eventStatus === "connected" ? "online" : "checking"}`;
    }
    if (eventList) eventList.innerHTML = activityEventRowsMarkup();
    if (warning) warning.innerHTML = runsWarningMarkup();
  }

  function openRunDrawer(runId) {
    state.drawer = { type: "run", runId };
    openDrawer();
    renderDrawer();
    void fetchRun(runId).catch((error) => {
      if (state.drawer?.type === "run" && state.drawer.runId === runId) {
        state.drawer.error = error.message;
        patchRunDrawer(runId);
      }
    });
  }

  function runProgressMarkup(run) {
    const progress = (run?.progress || []).map((item) => `
      <li class="game-list-row">
        <div class="game-list-main"><p class="game-list-title">${escapeHtml(item.phase || "Progress")}</p><div class="game-list-meta"><span>${escapeHtml(item.message || "")}</span></div></div>
        ${badge(item.status)}
      </li>`).join("");
    if (progress) return `<ul class="game-list">${progress}</ul>`;
    return run
      ? '<div class="game-empty"><h2>Waiting for progress</h2><p>The browser is polling the Driver asynchronously.</p></div>'
      : '<div class="game-empty"><h2>Loading run</h2><p>Reading the retained Driver state.</p></div>';
  }

  function runResultMarkup(run) {
    return run?.result
      ? `<div class="game-panel"><div class="game-panel-header"><h3>Result</h3></div><div class="game-panel-body"><pre class="code-block">${safeJson(run.result)}</pre></div></div>`
      : "";
  }

  function renderRunDrawer(model) {
    const run = state.workspace.runs.get(model.runId);
    return `
      <div class="drawer-header">
        <div><p class="screen-kicker">Action run</p><h2 class="drawer-title" id="drawer-title" data-run-title>${escapeHtml(run?.action?.name || shortText(model.runId))}</h2></div>
        <button class="game-button" type="button" data-command="close-drawer">Close</button>
      </div>
      <div class="drawer-body">
        <div data-run-request-error>${model.error ? `<div class="terminal-note error">${escapeHtml(model.error)}</div>` : ""}</div>
        <div class="summary-strip">
          <div class="summary-stat"><span>Status</span><strong data-run-status>${escapeHtml(run?.status || "Loading")}</strong></div>
          <div class="summary-stat"><span>Run id</span><strong data-run-id>${escapeHtml(shortText(run?.runId || model.runId))}</strong></div>
          <div class="summary-stat"><span>Outputs</span><strong data-run-outputs>${run?.result?.outputFiles?.length || 0}</strong></div>
          <div class="summary-stat"><span>Consumed</span><strong data-run-consumed>${run?.result?.nullifiedFiles?.length || 0}</strong></div>
        </div>
        <div data-run-error>${run?.error ? `<div class="terminal-note error">${escapeHtml(run.error)}</div>` : ""}</div>
        <div class="game-panel"><div class="game-panel-header"><h3>Progress</h3><span data-run-badge>${badge(run?.status || "loading")}</span></div><div class="game-panel-body flush" data-run-progress>${runProgressMarkup(run)}</div></div>
        <div data-run-result>${runResultMarkup(run)}</div>
      </div>`;
  }

  function patchRunDrawer(runId) {
    if (state.drawer?.type !== "run" || state.drawer.runId !== runId) return;
    const run = state.workspace.runs.get(runId);
    const setText = (selector, value) => {
      const element = drawerContent.querySelector(selector);
      if (element) element.textContent = String(value ?? "");
    };
    const setHtml = (selector, value) => {
      const element = drawerContent.querySelector(selector);
      if (element) element.innerHTML = value;
    };
    setText("[data-run-title]", run?.action?.name || shortText(runId));
    setText("[data-run-status]", run?.status || "Loading");
    setText("[data-run-id]", shortText(run?.runId || runId));
    setText("[data-run-outputs]", run?.result?.outputFiles?.length || 0);
    setText("[data-run-consumed]", run?.result?.nullifiedFiles?.length || 0);
    setHtml("[data-run-request-error]", state.drawer.error ? `<div class="terminal-note error">${escapeHtml(state.drawer.error)}</div>` : "");
    setHtml("[data-run-error]", run?.error ? `<div class="terminal-note error">${escapeHtml(run.error)}</div>` : "");
    setHtml("[data-run-badge]", badge(run?.status || "loading"));
    setHtml("[data-run-progress]", runProgressMarkup(run));
    setHtml("[data-run-result]", runResultMarkup(run));
  }

  function renderSettings() {
    const connection = activeConnection();
    if (!connection) {
      return `<section class="game-screen">${screenHeading("Servers", "No connection", "Choose a Driver first.", backButton())}${errorPanel("No Driver profile", "Open Connections to add or select one.", "connections")}</section>`;
    }
    const settings = state.workspace.settings || {
      synchronizerApiUrl: connection.synchronizerUrl,
      relayerApiUrl: connection.relayerUrl,
      mcpEnabled: false,
    };
    const origin = location.origin === "null" ? "a fixed local HTTP origin" : location.origin;
    return `
      <section class="game-screen" aria-labelledby="settings-title">
        ${screenHeading(
          "Server menu",
          "Driver settings",
          `Settings are read from and written directly to ${connection.name}.`,
          `${backButton("Connections")}${gameButton("Edit connection", "edit-active-connection")}`,
        )}
        ${state.workspace.errors.settings ? `<div class="terminal-note error">${escapeHtml(state.workspace.errors.settings)}</div>` : ""}
        <div class="game-panel">
          <div class="game-panel-body">
            <form id="settings-form" class="game-form">
              <div class="game-form-grid">
                <div class="game-field full">
                  <label for="settings-synchronizer">Synchronizer API</label>
                  <input id="settings-synchronizer" name="synchronizerApiUrl" class="game-input mono" type="url" required value="${escapeHtml(settings.synchronizerApiUrl || connection.synchronizerUrl)}" />
                </div>
                <div class="game-field full">
                  <label for="settings-relayer">Relayer API</label>
                  <input id="settings-relayer" name="relayerApiUrl" class="game-input mono" type="url" required value="${escapeHtml(settings.relayerApiUrl || connection.relayerUrl)}" />
                </div>
                <div class="game-field full">
                  <label class="toggle-line" for="settings-mcp"><input id="settings-mcp" name="mcpEnabled" type="checkbox"${settings.mcpEnabled ? " checked" : ""} /> Enable MCP runtime</label>
                  <small>Profile endpoint: ${escapeHtml(connection.mcpUrl || "not set")}</small>
                </div>
              </div>
              <div class="game-form-actions"><button class="game-button game-button-primary" type="submit">Save to Driver</button></div>
            </form>
          </div>
        </div>
        <div class="game-panel">
          <div class="game-panel-header"><h2>Connection details</h2></div>
          <div class="game-panel-body">
            <div class="summary-strip">
              <div class="summary-stat"><span>Driver</span><strong>${escapeHtml(connection.driverUrl)}</strong></div>
              <div class="summary-stat"><span>MCP</span><strong>${escapeHtml(connection.mcpUrl || "Unset")}</strong></div>
              <div class="summary-stat"><span>Version</span><strong>${escapeHtml(state.workspace.health?.version || "Unknown")}</strong></div>
              <div class="summary-stat"><span>State root</span><strong>${escapeHtml(shortText(typeof state.workspace.stateRoot === "string" ? state.workspace.stateRoot : JSON.stringify(state.workspace.stateRoot || "")))}</strong></div>
            </div>
            <div class="terminal-note">Hardened local dobjd builds must allow this exact UI origin: DOBJD_ALLOWED_ORIGINS=${escapeHtml(origin)}</div>
          </div>
        </div>
      </section>`;
  }

  async function saveDriverSettings(form) {
    const connection = activeConnection();
    if (!connection) return;
    const generation = state.workspaceGeneration;
    const submit = form.querySelector('button[type="submit"]');
    try {
      const data = new FormData(form);
      const patch = {
        synchronizerApiUrl: cleanUrl(data.get("synchronizerApiUrl")),
        relayerApiUrl: cleanUrl(data.get("relayerApiUrl")),
        mcpEnabled: data.get("mcpEnabled") === "on",
      };
      submit.disabled = true;
      submit.textContent = "Saving...";
      const saved = await driverRequest(connection, "/settings", jsonOptions("PUT", patch, 20000));
      const profile = state.config.connections.find(
        (item) => item.id === connection.id && item.driverUrl === connection.driverUrl,
      );
      if (profile) {
        profile.synchronizerUrl = patch.synchronizerApiUrl;
        profile.relayerUrl = patch.relayerApiUrl;
        persistConfig();
      }
      if (isCurrentWorkspace(connection, generation)) {
        state.workspace.settings = saved || patch;
        toast("Driver settings saved", connection.name, "success");
        render();
      } else {
        toast("Driver settings saved", `Settings were saved on ${connection.name}.`, "success");
      }
    } catch (error) {
      toast("Settings were not saved", error.message, "error");
      if (isCurrentWorkspace(connection, generation) && form.isConnected) {
        submit.disabled = false;
        submit.textContent = "Save to Driver";
      }
    }
  }

  function renderConfig() {
    const linked = state.linkedConfigName
      ? `Linked to ${state.linkedConfigName}. Changes are also saved in this browser.`
      : "Changes are saved automatically in this browser. Link a JSON file for a portable copy.";
    return `
      <section class="game-screen" aria-labelledby="config-title">
        ${screenHeading("Console menu", "Menu Config", linked, backButton())}
        <div class="console-menu-grid config-menu">
          ${menuTile("open-config", "IN", "Open config", "Load connection profiles and menu selections from a JSON file.", { meta: "Import" })}
          ${menuTile("save-config", "OUT", state.linkedConfigName ? "Save linked config" : "Save config", "Create or link a JSON config file; supported browsers remember the file handle.", { meta: state.linkedConfigName || "Export" })}
          ${menuTile("reset-config", "RST", "Reset defaults", "Restore the local Driver profile and clear saved cartridge selections.", { meta: "Caution" })}
        </div>
        <div class="game-panel">
          <div class="game-panel-header"><h2>Current configuration</h2><span>version ${CONFIG_VERSION}</span></div>
          <div class="game-panel-body"><pre class="code-block">${safeJson(state.config)}</pre></div>
        </div>
        <div class="terminal-note warning">
          Browser sandbox rule: HTML cannot write arbitrary files silently. Choose a destination in the Save dialog once; Chromium-based browsers can then keep that selected config file updated while permission remains granted. Other browsers download the JSON and always retain an automatic localStorage copy.
        </div>
      </section>`;
  }

  function openDrawer() {
    if (drawer.hidden) state.drawerReturnFocus = document.activeElement;
    drawer.hidden = false;
    drawerBackdrop.hidden = false;
    if (appShell) appShell.inert = true;
    document.body.classList.add("drawer-open");
  }

  function closeDrawer() {
    const returnFocus = state.drawerReturnFocus;
    state.drawer = null;
    state.drawerReturnFocus = null;
    drawer.hidden = true;
    drawerBackdrop.hidden = true;
    drawerContent.innerHTML = "";
    if (appShell) appShell.inert = false;
    document.body.classList.remove("drawer-open");
    if (returnFocus && typeof returnFocus.focus === "function") {
      requestAnimationFrame(() => {
        if (returnFocus.isConnected) returnFocus.focus({ preventScroll: true });
      });
    }
  }

  function renderDrawer(focusFirst = true) {
    if (!state.drawer) return closeDrawer();
    const focusToken = captureFocus(drawerContent);
    let html = "";
    if (state.drawer.type === "action") {
      const action = actionByKey(state.drawer.key);
      html = action ? renderActionDrawer(action, state.drawer) : '<div class="drawer-body"><div class="game-error"><h2 id="drawer-title">Action unavailable</h2></div></div>';
    } else if (state.drawer.type === "object") {
      html = renderObjectDrawer(state.drawer);
    } else if (state.drawer.type === "run") {
      html = renderRunDrawer(state.drawer);
    }
    drawerContent.innerHTML = html;
    requestAnimationFrame(() => {
      const captured = !focusFirst ? findCapturedFocus(drawerContent, focusToken) : null;
      const target = captured || drawerContent.querySelector("button, select, input");
      target?.focus({ preventScroll: true });
    });
  }

  function trapDrawerFocus(event) {
    const focusable = [...drawerContent.querySelectorAll(
      "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex='-1'])",
    )].filter((element) => element.getAttribute("aria-disabled") !== "true" && !element.hidden);
    if (!focusable.length) {
      event.preventDefault();
      drawer.setAttribute("tabindex", "-1");
      drawer.focus({ preventScroll: true });
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const current = document.activeElement;
    if (!drawer.contains(current)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus({ preventScroll: true });
    } else if (event.shiftKey && current === first) {
      event.preventDefault();
      last.focus({ preventScroll: true });
    } else if (!event.shiftKey && current === last) {
      event.preventDefault();
      first.focus({ preventScroll: true });
    }
  }

  async function installCartridgeFile(file) {
    if (!file) return;
    pexeInput.value = "";
    const connection = activeConnection();
    const generation = state.workspaceGeneration;
    if (!connection || connectionStatus(connection.id).state !== "online") {
      return toast("Driver is offline", "Choose an online connection before installing a cartridge.", "error");
    }
    if (!file.name.toLowerCase().endsWith(".pexe")) {
      return toast("Choose a .pexe file", file.name, "error");
    }
    if (file.size > MAX_PEXE_BYTES) {
      return toast("Cartridge is too large", "The Driver accepts PEXE archives up to 8 MiB.", "error");
    }
    const approved = globalThis.confirm(
      `Install ${file.name} directly on ${connection.name}?\n\n` +
        "The Driver validates the archive, but this static client cannot verify its publisher before installation.",
    );
    if (!approved) return;
    toast("Installing cartridge", file.name, "info", 2500);
    try {
      const bytes = await file.arrayBuffer();
      const pluginName = await driverRequest(connection, "/actions/install", {
        method: "POST",
        timeout: 90000,
        headers: { "Content-Type": "application/octet-stream" },
        body: bytes,
      });
      const installed = typeof pluginName === "string" ? pluginName : null;
      if (!isCurrentWorkspace(connection, generation)) {
        toast("Cartridge installed", `${installed || file.name} was installed on ${connection.name}.`, "success");
        return;
      }
      await refreshCatalogAndObjects(connection, generation);
      if (!isCurrentWorkspace(connection, generation)) return;
      if (installed && connectGroups().some((item) => item.id === installed)) {
        state.config.activeCartridgeByConnection[connection.id] = installed;
        persistConfig();
      }
      toast("Cartridge installed", installed || file.name, "success");
      navigate("cartridges");
    } catch (error) {
      toast("Cartridge installation failed", error.message, "error", 9000);
    }
  }

  function screenFromHash() {
    const value = location.hash.replace(/^#\/?/, "").split(/[/?]/)[0];
    return value || "home";
  }

  function navigate(screen) {
    if (location.hash !== `#/${screen}`) {
      location.hash = `#/${screen}`;
    } else {
      state.screen = screen;
      render();
    }
  }

  function navigateBack() {
    if (state.drawer) return closeDrawer();
    const parents = {
      connections: "home",
      "connection-edit": "connections",
      cartridges: "home",
      actions: "home",
      tree: "actions",
      objects: "actions",
      activity: "actions",
      settings: "connections",
      config: "home",
    };
    navigate(parents[state.screen] || "home");
  }

  async function selectConnection(id, destination = "home") {
    if (!state.config.connections.some((item) => item.id === id)) return;
    const changed = state.config.activeConnectionId !== id;
    state.config.activeConnectionId = id;
    persistConfig();
    if (changed) resetWorkspace();
    navigate(destination);
    await Promise.allSettled([probeAllConnections(), loadWorkspace()]);
  }

  async function saveConnectionForm(form) {
    const data = new FormData(form);
    const existingId = form.dataset.existingId || "";
    try {
      const connection = normalizeConnection(
        {
          id: existingId || newId("connection"),
          name: data.get("name"),
          driverUrl: data.get("driverUrl"),
          mcpUrl: data.get("mcpUrl"),
          synchronizerUrl: data.get("synchronizerUrl"),
          relayerUrl: data.get("relayerUrl"),
        },
        1,
      );
      if (existingId) {
        const index = state.config.connections.findIndex((item) => item.id === existingId);
        if (index < 0) throw new Error("The connection no longer exists.");
        state.config.connections[index] = connection;
      } else {
        state.config.connections.push(connection);
        state.config.activeConnectionId = connection.id;
      }
      persistConfig();
      resetWorkspace();
      state.editingConnectionId = null;
      navigate("connections");
      await Promise.allSettled([probeAllConnections(), loadWorkspace()]);
      toast("Connection saved", connection.name, "success");
    } catch (error) {
      toast("Connection was not saved", error.message, "error");
    }
  }

  async function deleteConnection(id) {
    const connection = state.config.connections.find((item) => item.id === id);
    if (!connection || state.config.connections.length === 1) return;
    if (!globalThis.confirm(`Remove ${connection.name} from this menu?`)) return;
    state.config.connections = state.config.connections.filter((item) => item.id !== id);
    delete state.config.activeCartridgeByConnection[id];
    delete state.config.recentRunIdsByConnection[id];
    if (state.config.activeConnectionId === id) {
      state.config.activeConnectionId = state.config.connections[0].id;
      resetWorkspace();
      void loadWorkspace();
    }
    state.statuses.delete(id);
    persistConfig();
    render();
  }

  async function refreshRuns() {
    const connection = activeConnection();
    if (!connection) return;
    const generation = state.workspaceGeneration;
    state.workspace.errors.runs = null;
    await loadRetainedRuns(connection, generation);
    if (isCurrentWorkspace(connection, generation)) scheduleLivePatch({ activity: true });
  }

  async function handleCommand(element) {
    if (element.getAttribute("aria-disabled") === "true" || element.disabled) return;
    const command = element.dataset.command;
    const id = element.dataset.id;
    switch (command) {
      case "back":
        navigateBack();
        break;
      case "refresh":
        await refreshEverything();
        break;
      case "connections":
        navigate("connections");
        void probeAllConnections();
        break;
      case "probe-connections":
        await probeAllConnections();
        break;
      case "select-connection":
        await selectConnection(id);
        break;
      case "connection-settings":
        await selectConnection(id, "settings");
        break;
      case "add-connection":
        state.editingConnectionId = null;
        navigate("connection-edit");
        break;
      case "edit-connection":
        state.editingConnectionId = id;
        navigate("connection-edit");
        break;
      case "edit-active-connection":
        state.editingConnectionId = activeConnection()?.id || null;
        navigate("connection-edit");
        break;
      case "delete-connection":
        await deleteConnection(id);
        break;
      case "cartridges":
        navigate("cartridges");
        break;
      case "select-cartridge": {
        const connection = activeConnection();
        if (!connection) break;
        const cartridge = connectGroups().find((item) => item.id === id);
        const changed = state.config.activeCartridgeByConnection[connection.id] !== id;
        state.config.activeCartridgeByConnection[connection.id] = id;
        if (changed) {
          state.actionSearch = "";
          state.actionFilter = "all";
          state.actionLimit = 60;
          state.techTree.mode = "all";
          state.techTree.objectFileName = "";
          state.techTree.selectedNodeId = "";
          state.techTree.viewBox = null;
          state.techTree.viewKey = "";
        }
        persistConfig();
        navigate("actions");
        toast("Opening Play menu", cartridge?.name || id, "success");
        break;
      }
      case "load-cartridge":
        pexeInput.click();
        break;
      case "actions":
        navigate("actions");
        break;
      case "tree":
        state.techTree.mode = "all";
        state.techTree.selectedNodeId = "";
        navigate("tree");
        break;
      case "tree-mode":
        state.techTree.mode = element.dataset.value === "object" ? "object" : "all";
        state.techTree.selectedNodeId = "";
        state.techTree.viewKey = "";
        render();
        break;
      case "tree-fit":
        fitTechTree();
        break;
      case "tree-zoom-in":
        zoomTechTree(0.78);
        break;
      case "tree-zoom-out":
        zoomTechTree(1.28);
        break;
      case "filter-actions":
        state.actionFilter = element.dataset.value || "all";
        state.actionLimit = 60;
        patchActionFilterControls();
        patchCatalogScreen();
        break;
      case "more-actions":
        state.actionLimit += 60;
        patchCatalogScreen();
        break;
      case "setup-action":
        await openActionSetup(id);
        break;
      case "objects":
        navigate("objects");
        break;
      case "more-objects":
        state.objectLimit += 90;
        patchCatalogScreen();
        break;
      case "view-object":
        await openObjectDrawer(id);
        break;
      case "object-tree":
        {
          const object = objectByFile(id);
          const connection = activeConnection();
          const pluginName = object?.class?.pluginName;
          if (connection && pluginName && connectGroups().some((group) => group.id === pluginName)) {
            state.config.activeCartridgeByConnection[connection.id] = pluginName;
            persistConfig();
          }
        }
        closeDrawer(false);
        state.techTree.mode = "object";
        state.techTree.objectFileName = id || "";
        state.techTree.selectedNodeId = "";
        state.techTree.viewKey = "";
        navigate("tree");
        break;
      case "import-object":
        dobjInput.click();
        break;
      case "activity":
        navigate("activity");
        break;
      case "refresh-runs":
        await refreshRuns();
        break;
      case "view-run":
        openRunDrawer(id);
        break;
      case "settings":
        navigate("settings");
        break;
      case "set-theme":
        if (!THEME_IDS.has(id)) break;
        applyTheme(id);
        persistConfig();
        break;
      case "config":
        navigate("config");
        break;
      case "open-config":
        await openConfigFile();
        break;
      case "save-config":
        await saveConfigFile();
        break;
      case "reset-config":
        if (globalThis.confirm("Reset all connection profiles and menu selections to the local defaults?")) {
          state.config = defaultConfig();
          persistConfig();
          resetWorkspace();
          await refreshEverything();
          navigate("home");
        }
        break;
      case "close-drawer":
        closeDrawer();
        break;
      default:
        break;
    }
  }

  function visibleMenuItems() {
    const footerControl = document.activeElement?.closest?.(".control-legend");
    const scope = footerControl || (state.screen === "home" ? main.querySelector(".home-menu") || main : main);
    return [...scope.querySelectorAll(".menu-focusable:not([aria-disabled='true']), [data-command]:not([aria-disabled='true'])")]
      .filter((element) => !element.disabled && element.offsetParent !== null);
  }

  function moveMenuFocus(direction) {
    const items = visibleMenuItems();
    if (!items.length) return;
    const current = items.indexOf(document.activeElement);
    const next = current < 0 ? 0 : (current + direction + items.length) % items.length;
    items[next].focus();
  }

  document.addEventListener("click", playMenuClick, true);

  main.addEventListener("click", (event) => {
    const treeNode = event.target.closest?.("[data-tree-node-id]");
    if (treeNode) selectTechTreeNode(treeNode.dataset.treeNodeId, true);
    const target = event.target.closest("[data-command]");
    if (target) void handleCommand(target);
  });

  main.addEventListener("submit", (event) => {
    event.preventDefault();
    if (event.target.id === "connection-form") void saveConnectionForm(event.target);
    if (event.target.id === "settings-form") void saveDriverSettings(event.target);
  });

  main.addEventListener("input", (event) => {
    if (event.target.id === "action-search") {
      state.actionSearch = event.target.value;
      state.actionLimit = 60;
      patchCatalogScreen();
    }
    if (event.target.id === "object-search") {
      state.objectSearch = event.target.value;
      state.objectLimit = 90;
      patchCatalogScreen();
    }
  });

  main.addEventListener("change", (event) => {
    if (event.target.id === "object-status") {
      state.objectStatus = event.target.value;
      state.objectLimit = 90;
      patchCatalogScreen();
    }
    if (event.target.id === "tree-object-select") {
      state.techTree.objectFileName = event.target.value || "";
      state.techTree.mode = state.techTree.objectFileName ? "object" : "all";
      state.techTree.selectedNodeId = "";
      state.techTree.viewKey = "";
      render();
    }
  });

  main.addEventListener("keydown", (event) => {
    const treeNode = event.target.closest?.("[data-tree-node-id]");
    if (!treeNode) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      selectTechTreeNode(treeNode.dataset.treeNodeId);
      return;
    }
    if (event.key.startsWith("Arrow")) {
      event.preventDefault();
      event.stopPropagation();
      focusAdjacentTechTreeNode(treeNode.dataset.treeNodeId, event.key);
      return;
    }
    if (event.key === "Escape" && state.techTree.selectedNodeId) {
      event.preventDefault();
      event.stopPropagation();
      state.techTree.selectedNodeId = "";
      main.querySelectorAll("[data-tree-node-id]").forEach((node) => node.classList.remove("is-selected"));
      updateTechTreeDetails();
    }
  });

  main.addEventListener("pointerdown", beginTechTreePan);
  main.addEventListener("pointermove", moveTechTreePan);
  main.addEventListener("pointerup", endTechTreePan);
  main.addEventListener("pointercancel", endTechTreePan);
  main.addEventListener("wheel", wheelTechTree, { passive: false });

  drawerContent.addEventListener("click", (event) => {
    const target = event.target.closest("[data-command]");
    if (target) void handleCommand(target);
  });

  drawerContent.addEventListener("change", (event) => {
    if (event.target.matches("[data-action-input]") && state.drawer?.type === "action") {
      const index = Number(event.target.dataset.actionInput);
      state.drawer.selections[index] = event.target.value;
      renderDrawer(false);
      requestAnimationFrame(() => drawerContent.querySelector(`[data-action-input="${index}"]`)?.focus());
    }
  });

  drawerContent.addEventListener("submit", (event) => {
    if (event.target.id === "action-run-form") {
      event.preventDefault();
      void submitActionRun();
    }
  });

  drawerBackdrop.addEventListener("click", closeDrawer);
  byId("theme-picker").addEventListener("click", (event) => {
    const target = event.target.closest("[data-command='set-theme']");
    if (target) void handleCommand(target);
  });
  byId("ui-sound-toggle").addEventListener("click", toggleUiSounds);
  byId("music-play").addEventListener("click", async () => {
    if (musicAudio.paused) await playMusic();
    else musicAudio.pause();
    updateMusicUi();
  });
  byId("music-previous").addEventListener("click", () => void changeMusicTrack(-1));
  byId("music-next").addEventListener("click", () => void changeMusicTrack(1));
  musicAudio.addEventListener("play", updateMusicUi);
  musicAudio.addEventListener("pause", updateMusicUi);
  musicAudio.addEventListener("ended", () => void changeMusicTrack(1, true));
  musicAudio.addEventListener("error", () => {
    const track = currentMusicTrack();
    if (track) toast("Track could not be decoded", musicTitle(track), "error");
    updateMusicUi();
  });
  byId("refresh-button").addEventListener("click", () => void refreshEverything());
  pexeInput.addEventListener("change", () => void installCartridgeFile(pexeInput.files?.[0]));
  dobjInput.addEventListener("change", () => void importObjectFile(dobjInput.files?.[0]));
  configInput.addEventListener("change", async () => {
    const file = configInput.files?.[0];
    configInput.value = "";
    if (!file) return;
    try {
      await applyImportedConfig(await file.text());
    } catch (error) {
      toast("Config is invalid", error.message, "error");
    }
  });
  window.addEventListener("hashchange", () => {
    state.screen = screenFromHash();
    state.config.ui.lastScreen = state.screen;
    persistConfig();
    render();
  });

  window.addEventListener("keydown", (event) => {
    const editing = event.target.matches("input, textarea, select, [contenteditable='true']");
    if (event.key === "Escape") {
      event.preventDefault();
      navigateBack();
      return;
    }
    if (state.drawer && event.key === "Tab") {
      trapDrawerFocus(event);
      return;
    }
    if (editing || state.drawer) return;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      moveMenuFocus(1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      moveMenuFocus(-1);
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void probeAllConnections();
  });

  async function start() {
    await restoreLinkedConfigHandle();
    updateUiSoundUi();
    updateMusicUi();
    void initializeMusic();
    state.screen = screenFromHash();
    if (!location.hash) history.replaceState(null, "", "#/home");
    render();
    await probeAllConnections();
    await loadWorkspace();
    setInterval(() => void probeAllConnections(), 15000);
  }

  void start();
})();
