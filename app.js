(function () {
  "use strict";

  if (globalThis.top !== globalThis.self) {
    document.body.textContent = "Digital Objects Light Console cannot run inside a frame. Open it directly.";
    return;
  }

  const CONFIG_VERSION = 1;
  const STORAGE_KEY = "don.lightConsole.config.v1";
  const GOAL_WORKFLOW_STORAGE_KEY = "don.lightConsole.goalWorkflow.v1";
  const GOAL_WORKFLOW_VERSION = 1;
  const GOAL_WORKFLOW_POLL_MS = 1_200;
  const GOAL_WORKFLOW_MAX_POLL_ERRORS = 50;
  const GOAL_WORKFLOW_OUTPUT_ATTEMPTS = 30;
  const GOAL_WORKFLOW_OUTPUT_POLL_MS = 2_000;
  const GOAL_WORKFLOW_MAX_STEPS = 512;
  const GOAL_WORKFLOW_MAX_QUANTITY = 99;
  const HARDWARE_INDEX_VERSION = 4;
  const HARDWARE_INDEX_LABEL = "CWI-4";
  const HARDWARE_INDEX_BENCHMARK_ID = "driver-craft-rocket-mineiron-proof-window-v1";
  const HARDWARE_INDEX_SCOPE = "selected-driver-generate-proof-window";
  const HARDWARE_INDEX_ALGORITHM = "craft-rocket::MineIron/generateProof-running-to-done-v1";
  const LEGACY_HARDWARE_INDEX_STORAGE_KEY = "don.lightConsole.clientWorkIndex.v1";
  const HARDWARE_INDEX_MAX_AGE_MS = 30 * 24 * 60 * 60_000;
  const HARDWARE_INDEX_MAX_RUN_MS = 30 * 60_000;
  const HARDWARE_INDEX_PENDING_MAX_AGE_MS = 24 * 60 * 60_000;
  const HARDWARE_INDEX_POLL_MS = 1_200;
  const HARDWARE_INDEX_ACTION = Object.freeze({ pluginName: "craft-rocket", name: "MineIron" });
  const ACTION_COMMIT_ALLOWANCE_MS = 60_000;
  const WORK_ESTIMATOR_REFERENCE_CWI_MS = 41_700;
  const POW_REFERENCE_WORK_MS = 1_000;
  const VDF_ITERATION_WORK_MS = 5_000;
  const STRUCTURAL_SLOT_WORK_MS = 60_000;
  const WORK_ESTIMATOR_EXTRAPOLATION_FACTOR = 0.5;
  const ACTION_OPERATIONAL_CONTINGENCY = 0.25;
  const HARDWARE_INDEX_PROOF_START = Object.freeze({ phase: "generateProof", status: "running", message: "Generating proof" });
  const HARDWARE_INDEX_PROOF_STOP = Object.freeze({ phase: "generateProof", status: "done", message: "Proof generation complete" });
  const clearedHardwareIndexRunUrls = new Set();
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
      clientWorkIndexes: {},
      clientWorkIndexRuns: {},
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
    const clientWorkIndexes = normalizeHardwareIndexMap(source.clientWorkIndexes);
    const clientWorkIndexRuns = pruneHardwareIndexRunMap(
      normalizeHardwareIndexRunMap(source.clientWorkIndexRuns),
      clientWorkIndexes,
    );
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
      clientWorkIndexes,
      clientWorkIndexRuns,
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
        const source = JSON.parse(raw);
        const config = normalizeConfig(source);
        if (source?.clientWorkIndex) {
          delete source.clientWorkIndex;
          try { localStorage.removeItem(LEGACY_HARDWARE_INDEX_STORAGE_KEY); } catch { /* best effort */ }
        }
        return config;
      }
      return defaultConfig();
    } catch (error) {
      console.warn("Could not load saved console config", error);
      return defaultConfig();
    }
  }

  function normalizedDriverUrl(value) {
    try {
      return cleanUrl(value);
    } catch {
      return "";
    }
  }

  function hardwareIndexConnectionKey(connection) {
    return normalizedDriverUrl(connection?.driverUrl);
  }

  function normalizeHardwareIndex(value) {
    if (
      !value ||
      value.version !== HARDWARE_INDEX_VERSION ||
      value.benchmarkId !== HARDWARE_INDEX_BENCHMARK_ID ||
      value.scope !== HARDWARE_INDEX_SCOPE ||
      value.algorithm !== HARDWARE_INDEX_ALGORITHM ||
      !sameQualified(value.action, HARDWARE_INDEX_ACTION)
    ) return null;
    const driverUrl = normalizedDriverUrl(value.driverUrl);
    const driverVersion = String(value.driverVersion || "").slice(0, 160);
    const actionHash = String(value.actionHash || "").trim().slice(0, 512);
    const runId = String(value.runId || "").trim().slice(0, 256);
    const reportedDurationMs = Number(value.durationMs);
    const requestedAt = String(value.requestedAt || "");
    const acceptedAt = String(value.acceptedAt || "");
    const proofStartedAt = String(value.proofStartedAt || "");
    const proofCompletedAt = String(value.proofCompletedAt || value.measuredAt || "");
    const measuredAt = proofCompletedAt;
    const requestedTimestamp = new Date(requestedAt).valueOf();
    const acceptedTimestamp = new Date(acceptedAt).valueOf();
    const proofStartedTimestamp = new Date(proofStartedAt).valueOf();
    const measuredTimestamp = new Date(measuredAt).valueOf();
    const durationMs = measuredTimestamp - proofStartedTimestamp;
    const timingSource = new Set(["live-run-sse", "resumed-client-clock", "poll-observed"]).has(value.timingSource)
      ? value.timingSource
      : "";
    const proofStartProgressIndex = Number(value.proofStartProgressIndex);
    const proofStopProgressIndex = Number(value.proofStopProgressIndex);
    const settlementStatus = new Set(["pending", "succeeded", "failed"]).has(value.settlementStatus)
      ? value.settlementStatus
      : "pending";
    const settledAt = String(value.settledAt || "");
    const settledTimestamp = settledAt ? new Date(settledAt).valueOf() : NaN;
    const settlementError = String(value.settlementError || "").slice(0, 1000);
    if (
      !driverUrl || !actionHash || !runId ||
      !Number.isFinite(reportedDurationMs) || Math.abs(reportedDurationMs - durationMs) > 1 ||
      !Number.isFinite(durationMs) || durationMs <= 0 || durationMs > 24 * 60 * 60_000 || !timingSource ||
      !Number.isInteger(proofStartProgressIndex) || proofStartProgressIndex < 0 ||
      !Number.isInteger(proofStopProgressIndex) || proofStopProgressIndex <= proofStartProgressIndex ||
      !Number.isFinite(requestedTimestamp) || !Number.isFinite(acceptedTimestamp) ||
      !Number.isFinite(proofStartedTimestamp) || !Number.isFinite(measuredTimestamp) ||
      acceptedTimestamp < requestedTimestamp || proofStartedTimestamp < acceptedTimestamp || measuredTimestamp < proofStartedTimestamp ||
      measuredTimestamp > Date.now() + 5 * 60_000 ||
      measuredTimestamp < Date.now() - HARDWARE_INDEX_MAX_AGE_MS ||
      (settlementStatus !== "pending" && (!Number.isFinite(settledTimestamp) || settledTimestamp < measuredTimestamp))
    ) return null;
    return {
      version: HARDWARE_INDEX_VERSION,
      benchmarkId: HARDWARE_INDEX_BENCHMARK_ID,
      scope: HARDWARE_INDEX_SCOPE,
      algorithm: HARDWARE_INDEX_ALGORITHM,
      driverUrl,
      driverVersion,
      action: { ...HARDWARE_INDEX_ACTION },
      actionHash,
      runId,
      durationMs,
      requestedAt,
      acceptedAt,
      proofStartedAt,
      proofCompletedAt,
      measuredAt,
      timingSource,
      proofStartProgressIndex,
      proofStopProgressIndex,
      settlementStatus,
      settledAt: settlementStatus === "pending" ? "" : settledAt,
      settlementError: settlementStatus === "failed" ? settlementError : "",
      mineIronProofsPerHour: 3_600_000 / durationMs,
    };
  }

  function normalizeHardwareIndexMap(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const normalized = {};
    for (const candidate of Object.values(value)) {
      const result = normalizeHardwareIndex(candidate);
      if (result) normalized[result.driverUrl] = newestHardwareIndex(normalized[result.driverUrl], result);
    }
    return normalized;
  }

  function normalizeHardwareIndexRun(value) {
    const legacyCwi3 = Boolean(
      value?.version === 3 &&
      value?.benchmarkId === "driver-craft-rocket-mineiron-v1" &&
      sameQualified(value?.action, HARDWARE_INDEX_ACTION)
    );
    const source = legacyCwi3
      ? {
          ...value,
          version: HARDWARE_INDEX_VERSION,
          benchmarkId: HARDWARE_INDEX_BENCHMARK_ID,
          scope: HARDWARE_INDEX_SCOPE,
          algorithm: HARDWARE_INDEX_ALGORITHM,
          phase: value.runId ? "settling" : value.phase,
          measurementError: value.runId
            ? "This accepted CWI-3 run is retained for settlement safety but cannot produce a CWI-4 proof-window score."
            : value.measurementError,
        }
      : value;
    if (
      !source ||
      source.version !== HARDWARE_INDEX_VERSION ||
      source.benchmarkId !== HARDWARE_INDEX_BENCHMARK_ID ||
      source.scope !== HARDWARE_INDEX_SCOPE ||
      source.algorithm !== HARDWARE_INDEX_ALGORITHM ||
      !sameQualified(source.action, HARDWARE_INDEX_ACTION)
    ) return null;
    const driverUrl = normalizedDriverUrl(source.driverUrl);
    const driverVersion = String(source.driverVersion || "").slice(0, 160);
    const actionHash = String(source.actionHash || "").trim().slice(0, 512);
    const runId = String(source.runId || "").trim().slice(0, 256);
    const phases = new Set(["submitting", "outcome-unknown", "accepted", "proof-running", "settling", "settled"]);
    const phase = phases.has(source.phase)
      ? source.phase
      : runId
        ? "accepted"
        : "";
    const submissionId = String(source.submissionId || "").trim().slice(0, 256);
    const requestedAt = String(source.requestedAt || source.acceptedAt || "");
    const acceptedAt = String(source.acceptedAt || "");
    const proofStartedAt = String(source.proofStartedAt || "");
    const proofCompletedAt = String(source.proofCompletedAt || "");
    const proofStartProgressIndex = Number.isInteger(Number(source.proofStartProgressIndex))
      ? Number(source.proofStartProgressIndex)
      : -1;
    const proofStopProgressIndex = Number.isInteger(Number(source.proofStopProgressIndex))
      ? Number(source.proofStopProgressIndex)
      : -1;
    const lastProgressIndex = Number.isInteger(Number(source.lastProgressIndex))
      ? Math.max(-1, Number(source.lastProgressIndex))
      : -1;
    const timingSource = new Set(["live-run-sse", "resumed-client-clock", "poll-observed"]).has(source.timingSource)
      ? source.timingSource
      : "";
    const measurementError = String(source.measurementError || "").slice(0, 1000);
    const settledAt = String(source.settledAt || "");
    const terminalStatus = new Set(["succeeded", "failed"]).has(source.terminalStatus) ? source.terminalStatus : "";
    const terminalError = String(source.terminalError || "").slice(0, 1000);
    const lifecycleTimestamp = phase === "settled" ? new Date(settledAt).valueOf() : new Date(requestedAt).valueOf();
    const acceptedTimestamp = new Date(acceptedAt).valueOf();
    const proofStartedTimestamp = new Date(proofStartedAt).valueOf();
    const proofCompletedTimestamp = new Date(proofCompletedAt).valueOf();
    const requiresRun = new Set(["accepted", "proof-running", "settling", "settled"]).has(phase);
    if (
      !driverUrl || !actionHash || !phase || (!runId && !submissionId) ||
      (requiresRun && (!runId || !Number.isFinite(acceptedTimestamp))) ||
      (phase === "proof-running" && (!Number.isFinite(proofStartedTimestamp) || proofStartProgressIndex < 0)) ||
      (proofCompletedAt && (!Number.isFinite(proofCompletedTimestamp) || proofStopProgressIndex <= proofStartProgressIndex)) ||
      (phase === "settled" && (!terminalStatus || !Number.isFinite(lifecycleTimestamp))) ||
      !Number.isFinite(lifecycleTimestamp) || lifecycleTimestamp > Date.now() + 5 * 60_000 ||
      lifecycleTimestamp < Date.now() - HARDWARE_INDEX_PENDING_MAX_AGE_MS
    ) return null;
    return {
      version: HARDWARE_INDEX_VERSION,
      benchmarkId: HARDWARE_INDEX_BENCHMARK_ID,
      scope: HARDWARE_INDEX_SCOPE,
      algorithm: HARDWARE_INDEX_ALGORITHM,
      driverUrl,
      driverVersion,
      connectionId: String(source.connectionId || "").slice(0, 256),
      connectionName: String(source.connectionName || "Driver").slice(0, 160),
      action: { ...HARDWARE_INDEX_ACTION },
      actionHash,
      runId,
      phase,
      submissionId,
      outcomeUnknown: phase === "outcome-unknown",
      requestedAt,
      acceptedAt,
      proofStartedAt,
      proofCompletedAt,
      proofStartProgressIndex,
      proofStopProgressIndex,
      lastProgressIndex: Math.max(lastProgressIndex, proofStartProgressIndex, proofStopProgressIndex),
      timingSource,
      measurementError,
      settledAt: phase === "settled" ? settledAt : "",
      terminalStatus: phase === "settled" ? terminalStatus : "",
      terminalError: phase === "settled" && terminalStatus === "failed" ? terminalError : "",
    };
  }

  function normalizeHardwareIndexRunMap(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const normalized = {};
    for (const candidate of Object.values(value)) {
      const run = normalizeHardwareIndexRun(candidate);
      if (run) normalized[run.driverUrl] = run;
    }
    return normalized;
  }

  function pruneHardwareIndexRunMap(runs, results) {
    void results;
    // A proof-window result is available before the action settles. Keep the
    // accepted/settling run record as a lock until a terminal tombstone wins
    // cross-tab merging; normalizing the map also expires old tombstones.
    return normalizeHardwareIndexRunMap(runs);
  }

  function hardwareIndexTimestamp(result) {
    const timestamp = new Date(result?.measuredAt || "").valueOf();
    return Number.isFinite(timestamp) ? timestamp : -Infinity;
  }

  function hardwareIndexFingerprint(result) {
    const normalized = normalizeHardwareIndex(result);
    return normalized ? JSON.stringify(normalized) : "";
  }

  function compareHardwareIndexes(left, right) {
    const timestampDifference = hardwareIndexTimestamp(left) - hardwareIndexTimestamp(right);
    if (timestampDifference) return timestampDifference;
    const settlementRank = { pending: 0, failed: 1, succeeded: 1 };
    const settlementDifference = (settlementRank[left?.settlementStatus] || 0) - (settlementRank[right?.settlementStatus] || 0);
    if (settlementDifference) return settlementDifference;
    const settledDifference = new Date(left?.settledAt || 0).valueOf() - new Date(right?.settledAt || 0).valueOf();
    if (settledDifference) return settledDifference;
    const leftFingerprint = hardwareIndexFingerprint(left);
    const rightFingerprint = hardwareIndexFingerprint(right);
    return leftFingerprint === rightFingerprint ? 0 : leftFingerprint > rightFingerprint ? 1 : -1;
  }

  function sameHardwareIndex(left, right) {
    return hardwareIndexFingerprint(left) === hardwareIndexFingerprint(right);
  }

  function newestHardwareIndex(...results) {
    return results.reduce((latest, value) => {
      const candidate = normalizeHardwareIndex(value);
      return candidate && compareHardwareIndexes(candidate, latest) > 0 ? candidate : latest;
    }, null);
  }

  function mergeHardwareIndexMaps(...maps) {
    const merged = {};
    for (const map of maps.map(normalizeHardwareIndexMap)) {
      for (const [key, result] of Object.entries(map)) {
        merged[key] = newestHardwareIndex(merged[key], result);
      }
    }
    return merged;
  }

  function mergeHardwareIndexRunMaps(...maps) {
    const merged = {};
    const phaseRank = { submitting: 0, "outcome-unknown": 1, accepted: 2, "proof-running": 3, settling: 4, settled: 5 };
    const mergeSameRun = (previous, run) => {
      const advanced = (phaseRank[run.phase] || 0) >= (phaseRank[previous.phase] || 0) ? run : previous;
      const other = advanced === run ? previous : run;
      return normalizeHardwareIndexRun({
        ...other,
        ...advanced,
        runId: advanced.runId || other.runId,
        proofStartedAt: advanced.proofStartedAt || other.proofStartedAt,
        proofCompletedAt: advanced.proofCompletedAt || other.proofCompletedAt,
        proofStartProgressIndex: Math.max(previous.proofStartProgressIndex, run.proofStartProgressIndex),
        proofStopProgressIndex: Math.max(previous.proofStopProgressIndex, run.proofStopProgressIndex),
        lastProgressIndex: Math.max(previous.lastProgressIndex, run.lastProgressIndex),
        timingSource: advanced.timingSource || other.timingSource,
        measurementError: advanced.measurementError || other.measurementError,
        settledAt: advanced.settledAt || other.settledAt,
        terminalStatus: advanced.terminalStatus || other.terminalStatus,
        terminalError: advanced.terminalError || other.terminalError,
      }) || advanced;
    };
    for (const map of maps.map(normalizeHardwareIndexRunMap)) {
      for (const [key, run] of Object.entries(map)) {
        const previous = merged[key];
        const timeDifference = new Date(run.requestedAt).valueOf() - new Date(previous?.requestedAt || 0).valueOf();
        const sameRun = Boolean(
          previous &&
          ((run.runId && run.runId === previous.runId) ||
            (run.submissionId && run.submissionId === previous.submissionId))
        );
        if (sameRun) {
          merged[key] = mergeSameRun(previous, run);
          continue;
        }
        if (
          !previous ||
          timeDifference > 0 ||
          (timeDifference === 0 && (phaseRank[run.phase] || 0) > (phaseRank[previous.phase] || 0))
        ) merged[key] = run;
      }
    }
    return merged;
  }

  function loadStoredHardwareIndexes() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return {};
      return normalizeHardwareIndexMap(JSON.parse(raw)?.clientWorkIndexes);
    } catch {
      return {};
    }
  }

  function loadStoredConfigSnapshot(fallbackConfig) {
    const fallback = fallbackConfig && typeof fallbackConfig === "object" && !Array.isArray(fallbackConfig)
      ? fallbackConfig
      : state.config;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { config: fallback, results: {}, runs: {} };
      const parsed = JSON.parse(raw);
      const validConfig = parsed && typeof parsed === "object" && !Array.isArray(parsed);
      const config = validConfig ? parsed : fallback;
      return {
        config,
        results: validConfig ? normalizeHardwareIndexMap(parsed.clientWorkIndexes) : {},
        runs: validConfig ? normalizeHardwareIndexRunMap(parsed.clientWorkIndexRuns) : {},
      };
    } catch {
      return { config: fallback, results: {}, runs: {} };
    }
  }

  function synchronizeHardwareIndexFromStorage(candidateConfig, fallbackConfig) {
    const currentResult = currentHardwareIndex();
    const snapshot = loadStoredConfigSnapshot(fallbackConfig);
    const candidateResults = normalizeHardwareIndexMap(candidateConfig?.clientWorkIndexes);
    const candidateRuns = normalizeHardwareIndexRunMap(candidateConfig?.clientWorkIndexRuns);
    state.config.clientWorkIndexes = mergeHardwareIndexMaps(state.config.clientWorkIndexes, candidateResults, snapshot.results);
    state.config.clientWorkIndexRuns = pruneHardwareIndexRunMap(
      mergeHardwareIndexRunMaps(state.config.clientWorkIndexRuns, candidateRuns, snapshot.runs),
      state.config.clientWorkIndexes,
    );
    const result = hardwareIndexForConnection(state.config, activeConnection());
    const resultChanged = !sameHardwareIndex(result, currentResult);
    const wasPersistent = state.hardwareIndex.persistent;
    const persistent = Boolean(result && sameHardwareIndex(snapshot.results[result.driverUrl], result));
    const homePromptVisible = resultChanged && Boolean(document.querySelector('[data-hardware-index-view="home"]'));

    state.hardwareIndex.result = result;
    state.hardwareIndex.persistent = persistent;
    if (resultChanged && !new Set(["running", "settling"]).has(state.hardwareIndex.status)) {
      state.hardwareIndex.status = "ready";
      state.hardwareIndex.error = "";
    }
    patchCurrentConfigPreview();
    if (homePromptVisible) {
      toast("Client work index updated", `${formatProofDuration(result.durationMs)} Generate Proof window / ${persistent ? "saved locally" : "this tab only"}`, "success");
    }
    if (resultChanged || persistent !== wasPersistent) patchHardwareIndex();
    return persistent;
  }

  function persistHardwareIndex(result) {
    state.config.clientWorkIndexes[result.driverUrl] = result;
    state.hardwareIndex.result = result;
    return persistConfig(false, false);
  }

  function persistHardwareIndexRun(run) {
    clearedHardwareIndexRunUrls.delete(run.driverUrl);
    state.config.clientWorkIndexRuns[run.driverUrl] = run;
    return persistConfig(false, false);
  }

  function clearHardwareIndexRun(driverUrl) {
    const key = normalizedDriverUrl(driverUrl);
    clearedHardwareIndexRunUrls.add(key);
    delete state.config.clientWorkIndexRuns[key];
    persistConfig(false, false);
  }

  function hardwareIndexForConnection(config, connection) {
    const key = hardwareIndexConnectionKey(connection);
    return key ? normalizeHardwareIndex(config?.clientWorkIndexes?.[key]) : null;
  }

  function loadGoalWorkflowSnapshot(options = {}) {
    try {
      const raw = localStorage.getItem(GOAL_WORKFLOW_STORAGE_KEY);
      if (!raw) return null;
      const workflow = JSON.parse(raw);
      const executionMode = workflow?.executionMode === "repeat-unit" ? "repeat-unit" : "fixed-plan";
      const quantity = Number(workflow?.goal?.quantity);
      const completedQuantity = Number(workflow?.completedQuantity ?? 0);
      const expectedGoalTokens = executionMode === "repeat-unit" ? 1 : quantity;
      if (
        !workflow ||
        workflow.version !== GOAL_WORKFLOW_VERSION ||
        !workflow.id ||
        !workflow.connection?.id ||
        !workflow.connection?.driverUrl ||
        !workflow.cartridgeId ||
        !workflow.goal?.classId ||
        !Array.isArray(workflow.steps) ||
        !Array.isArray(workflow.stepStates) ||
        workflow.steps.length !== workflow.stepStates.length ||
        workflow.steps.length > GOAL_WORKFLOW_MAX_STEPS ||
        !Array.isArray(workflow.goalTokenIds) ||
        workflow.goalTokenIds.length < 1 ||
        workflow.goalTokenIds.length > GOAL_WORKFLOW_MAX_QUANTITY ||
        !Number.isInteger(quantity) ||
        quantity < 1 ||
        quantity > GOAL_WORKFLOW_MAX_QUANTITY ||
        workflow.goalTokenIds.length !== expectedGoalTokens ||
        !Number.isInteger(completedQuantity) ||
        completedQuantity < 0 ||
        completedQuantity > quantity ||
        (executionMode === "repeat-unit" && quantity < 2) ||
        !workflow.tokenBindings ||
        typeof workflow.tokenBindings !== "object"
      ) return null;
      workflow.executionMode = executionMode;
      workflow.completedQuantity = completedQuantity;
      workflow.completedActionCount = Math.max(0, Number(workflow.completedActionCount) || 0);
      workflow.batchGoalIncrease = Math.max(1, Math.trunc(Number(workflow.batchGoalIncrease) || 1));
      workflow.estimatedActionCount = Math.max(
        workflow.steps.length,
        Number(workflow.estimatedActionCount) || workflow.steps.length,
      );
      workflow.currentStepIndex = Math.max(0, Math.min(workflow.steps.length, Number(workflow.currentStepIndex) || 0));
      if (options.recoverInterrupted === false) return workflow;
      const exitWasRequested = Boolean(workflow.exitRequested || workflow.status === "stopping");
      workflow.pauseRequested = false;
      const current = workflow.stepStates[workflow.currentStepIndex] || null;
      const interruptedSubmission = current?.status === "submitting" && !current.runId;
      if (interruptedSubmission) {
        current.status = "needs-review";
        current.outcomeUnknown = true;
        current.retryable = false;
        workflow.status = "needs-review";
        workflow.error = "The page closed while an action request was awaiting its run id. The Driver may have accepted it, so this step cannot be retried automatically.";
        workflow.message = "Review Driver Activity before clearing this safety lock.";
      } else if (exitWasRequested && !current?.runId && current?.status !== "submitting") {
        workflow.status = "stopped";
        workflow.exitRequested = true;
        workflow.stoppedAt ||= new Date().toISOString();
        workflow.message = "Exit was completed during reload recovery. No further action will be submitted.";
      } else if (new Set(["running", "pausing", "stopping"]).has(workflow.status)) {
        workflow.status = "paused";
        workflow.exitRequested = exitWasRequested;
        workflow.recoveryRequired = Boolean(current?.runId);
        workflow.message = current?.runId
          ? exitWasRequested
            ? `Exit recovery is paused after reload. Resume tracking retained run ${current.runId}; it will be verified and then the flow will stop.`
            : `Automation paused after reload. Resume to reconcile retained run ${current.runId} before any new action is submitted.`
          : "Automation paused after reload. Resume to repeat the live preflight before the next action.";
      } else {
        workflow.exitRequested = exitWasRequested;
      }
      return workflow;
    } catch (error) {
      console.warn("Could not restore the saved goal workflow", error);
      return null;
    }
  }

  const initialConfig = loadConfig();
  const initialConnection = initialConfig.connections.find((item) => item.id === initialConfig.activeConnectionId) || initialConfig.connections[0];
  const savedHardwareIndex = hardwareIndexForConnection(initialConfig, initialConnection);
  const goalWorkflowTabId = newId("flow-tab");
  // Active checkpoints are loaded verbatim. Startup recovery is performed only
  // after this tab proves that no other tab still owns the Driver Web Lock.
  const savedGoalWorkflow = loadGoalWorkflowSnapshot({ recoverInterrupted: false });

  const state = {
    config: initialConfig,
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
    inFlightActionSubmissions: new Set(),
    ambiguousActionSubmissions: new Set(),
    goalWorkflow: savedGoalWorkflow,
    goalWorkflowPreparing: false,
    goalWorkflowLoopPromise: null,
    goalWorkflowLoopToken: 0,
    goalWorkflowTabId,
    hardwareIndex: {
      status: savedHardwareIndex ? "ready" : "idle",
      result: savedHardwareIndex,
      error: "",
      runToken: 0,
      persistent: Boolean(savedHardwareIndex),
      restoreFocus: false,
      progress: null,
      activeRun: null,
      progressTimer: null,
      proofEventSource: null,
      settlementWatchers: new Set(),
    },
    drawer: null,
    cartridgeNavOpen: false,
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
      fullscreenFallback: false,
      fullscreenRequestPending: false,
    },
    planner: {
      goalClassId: "",
      goalQuantity: 1,
      quantityTimer: null,
      result: null,
      viewBox: null,
      viewKey: "",
      layout: null,
      drag: null,
      viewMode: "fit",
      fullscreenFallback: false,
      fullscreenRequestPending: false,
      deferredReplan: null,
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

  function currentHardwareIndex() {
    const connection = activeConnection();
    if (!connection) return null;
    const stored = loadStoredHardwareIndexes();
    state.config.clientWorkIndexes = mergeHardwareIndexMaps(state.config.clientWorkIndexes, stored);
    const current = hardwareIndexForConnection(state.config, connection);
    const action = state.workspace.actions.find((item) => sameQualified(item.action, HARDWARE_INDEX_ACTION));
    const catalogIsAuthoritative = Boolean(
      state.workspace.connectionId === connection.id &&
      !state.workspace.loading &&
      !state.workspace.errors.actions &&
      Array.isArray(state.workspace.actions)
    );
    const driverVersion = state.workspace.connectionId === connection.id
      ? String(state.workspace.health?.version || "")
      : "";
    const contextMatches = Boolean(
      current &&
      current.driverUrl === hardwareIndexConnectionKey(connection) &&
      (!catalogIsAuthoritative || (action?.hash && action.hash === current.actionHash)) &&
      (!driverVersion || driverVersion === current.driverVersion)
    );
    if (contextMatches) {
      state.hardwareIndex.result = current;
      state.hardwareIndex.persistent = sameHardwareIndex(stored[current.driverUrl], current);
      return current;
    }
    state.hardwareIndex.result = null;
    state.hardwareIndex.persistent = false;
    if (state.hardwareIndex.status === "ready") {
      state.hardwareIndex.status = "idle";
    }
    return null;
  }

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

  function patchCurrentConfigPreview() {
    document.querySelectorAll("[data-current-config]").forEach((preview) => {
      preview.textContent = JSON.stringify(state.config, null, 2);
    });
  }

  function persistConfig(writeLinkedFile = true, patchHardwareIndexUi = true) {
    const previousResult = state.hardwareIndex?.result || null;
    const previousPersistent = Boolean(state.hardwareIndex?.persistent);
    state.config = normalizeConfig(state.config);
    const storedSnapshot = loadStoredConfigSnapshot(state.config);
    state.config.clientWorkIndexes = mergeHardwareIndexMaps(
      state.config.clientWorkIndexes,
      storedSnapshot.results,
    );
    state.config.clientWorkIndexRuns = mergeHardwareIndexRunMaps(
      state.config.clientWorkIndexRuns,
      storedSnapshot.runs,
    );
    for (const key of clearedHardwareIndexRunUrls) delete state.config.clientWorkIndexRuns[key];
    state.config.clientWorkIndexRuns = pruneHardwareIndexRunMap(
      state.config.clientWorkIndexRuns,
      state.config.clientWorkIndexes,
    );
    const mergedResult = hardwareIndexForConnection(state.config, activeConnection());
    state.hardwareIndex.result = mergedResult;
    if (!new Set(["running", "settling"]).has(state.hardwareIndex.status)) {
      state.hardwareIndex.status = mergedResult ? "ready" : "idle";
      if (mergedResult) state.hardwareIndex.error = "";
    }
    applyTheme(state.config.ui.theme);
    updateMusicUi();
    updateUiSoundUi();
    let saved = true;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.config));
    } catch (error) {
      saved = false;
      toast("Config was not saved", error.message, "error");
    }
    if (saved) {
      state.hardwareIndex.persistent = Boolean(mergedResult);
      clearedHardwareIndexRunUrls.clear();
      try {
        localStorage.removeItem(LEGACY_HARDWARE_INDEX_STORAGE_KEY);
      } catch {
        // A leftover legacy record is harmless because the config field takes precedence.
      }
    }
    if (writeLinkedFile && state.linkedConfigHandle) scheduleLinkedConfigWrite();
    patchCurrentConfigPreview();
    const resultChanged = !sameHardwareIndex(state.hardwareIndex?.result, previousResult);
    const persistenceChanged = Boolean(state.hardwareIndex?.persistent) !== previousPersistent;
    if (patchHardwareIndexUi && (resultChanged || persistenceChanged)) patchHardwareIndex();
    return saved;
  }

  function configText() {
    const portableConfig = { ...state.config };
    delete portableConfig.clientWorkIndexes;
    delete portableConfig.clientWorkIndexRuns;
    return `${JSON.stringify(portableConfig, null, 2)}\n`;
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
    const localClientWorkIndexes = state.config.clientWorkIndexes;
    const localClientWorkIndexRuns = state.config.clientWorkIndexRuns;
    const parsed = normalizeConfig(JSON.parse(text));
    parsed.clientWorkIndexes = localClientWorkIndexes;
    parsed.clientWorkIndexRuns = localClientWorkIndexRuns;
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
    updateGoalWorkflowHud();
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
      if (runIds.length) patchGoalWorkflowDrawer();
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
      const expectsArray = key === "actions" || key === "objects" || key === "classes";
      if (result.status === "fulfilled" && (!expectsArray || Array.isArray(result.value))) {
        state.workspace[key] = result.value;
        delete state.workspace.errors[key];
      } else {
        state.workspace.errors[key] = result.status === "fulfilled"
          ? `The ${key} response is incompatible.`
          : result.reason?.message || "Request failed.";
      }
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
    void resumePendingHardwareIndexForConnection(connection);
  }

  function resetWorkspace() {
    if (goalWorkflowAutomationActive() && !goalWorkflowOwnedByOtherTab()) {
      state.goalWorkflow.pauseRequested = true;
      state.goalWorkflow.exitRequested = false;
      state.goalWorkflow.status = "pausing";
      state.goalWorkflow.message = "Connection context changed. The current accepted action will be reconciled, then automation will pause.";
      persistGoalWorkflow();
    }
    cleanupTechTreeFullscreen();
    cleanupPlannerTreeFullscreen();
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
    clearTimeout(state.planner.quantityTimer);
    state.planner.goalClassId = "";
    state.planner.goalQuantity = 1;
    state.planner.quantityTimer = null;
    state.planner.result = null;
    state.planner.viewBox = null;
    state.planner.viewKey = "";
    state.planner.layout = null;
    state.planner.drag = null;
    state.planner.viewMode = "fit";
    state.planner.deferredReplan = null;
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
    const results = { actions, objects, classes };
    for (const [key, result] of Object.entries(results)) {
      if (result.status === "fulfilled" && Array.isArray(result.value)) {
        state.workspace[key] = result.value;
        delete state.workspace.errors[key];
      } else {
        state.workspace.errors[key] = result.status === "fulfilled"
          ? `The ${key} response is incompatible.`
          : result.reason?.message || "Request failed.";
      }
    }
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
        ${actions ? `<div class="screen-actions">${actions}</div>` : ""}
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

  function cartridgeNavigation(activeScreen, contextActions = "") {
    const cartridge = selectedCartridge();
    if (!cartridge) return "";
    const items = [
      { screen: "cartridges", command: "cartridges", label: "Change Cartridge" },
      { screen: "actions", command: "actions", label: "Play" },
      { screen: "planner", command: "planner", label: "Goal Planner" },
      { screen: "tree", command: "tree", label: "Tech Tree" },
      { screen: "objects", command: "objects", label: "Inventory" },
      { screen: "activity", command: "activity", label: "Activity" },
    ];
    const activeLabel = items.find((item) => item.screen === activeScreen)?.label || "Cartridge";
    const buttons = items.map((item) => gameButton(item.label, item.command, {
      tone: item.screen === activeScreen ? "primary" : "",
      extra: item.screen === activeScreen ? ' aria-current="page"' : "",
    })).join("");
    return `
      <div class="cartridge-nav-shell">
        <nav class="cartridge-nav${state.cartridgeNavOpen ? " is-open" : ""}" aria-label="${escapeHtml(cartridge.name)} cartridge menu">
          <button class="game-button cartridge-nav-toggle" type="button" data-command="toggle-cartridge-nav" aria-expanded="${state.cartridgeNavOpen}" aria-controls="cartridge-nav-items">
            <span>Cartridge menu</span><strong>${escapeHtml(activeLabel)}</strong><span data-cartridge-nav-symbol aria-hidden="true">${state.cartridgeNavOpen ? "−" : "+"}</span>
          </button>
          <div id="cartridge-nav-items" class="cartridge-nav-items">${buttons}</div>
        </nav>
        ${contextActions ? `<div class="cartridge-context-actions" role="group" aria-label="Page actions">${contextActions}</div>` : ""}
      </div>`;
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
    const buttonLabel = command === "connections" ? "Connections" : command === "cartridges" ? "Select Cartridge" : "Try again";
    return `
      <div class="game-panel">
        <div class="game-error">
          <h2>${escapeHtml(title)}</h2>
          <p>${escapeHtml(message)}</p>
          ${gameButton(buttonLabel, command, { tone: "primary" })}
        </div>
      </div>`;
  }

  function focusTokenForElement(element) {
    if (!element) return null;
    return {
      id: element.id || "",
      command: element.dataset?.command || "",
      dataId: element.dataset?.id || "",
      treeNodeId: element.dataset?.treeNodeId || "",
      actionInput: element.dataset?.actionInput || "",
      name: element.name || "",
    };
  }

  function captureFocus(container) {
    const element = document.activeElement;
    if (!element || !container || typeof container.contains !== "function" || !container.contains(element)) return null;
    return focusTokenForElement(element);
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
    currentHardwareIndex();
    if (state.planner.drag) cancelPlannerTreePan();
    if (state.screen !== "tree") cleanupTechTreeFullscreen();
    if (state.screen !== "planner") cleanupPlannerTreeFullscreen();
    updateHeader();
    const focusToken = captureFocus(main);
    const shouldAutofocus = Boolean(focusToken) || !document.activeElement || document.activeElement === document.body || document.activeElement === main;
    const supported = new Set([
      "home",
      "connections",
      "connection-edit",
      "cartridges",
      "actions",
      "planner",
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
      planner: renderPlanner,
      tree: renderTechTree,
      objects: renderObjects,
      activity: renderActivity,
      settings: renderSettings,
      config: renderConfig,
    };
    main.innerHTML = renderers[state.screen]();
    if (state.screen !== "tree" || !byId("tech-tree-canvas")) cleanupTechTreeFullscreen();
    if (state.screen !== "planner" || !byId("planner-tree-canvas")) cleanupPlannerTreeFullscreen();
    main.dataset.screen = state.screen;
    requestAnimationFrame(() => {
      if (state.screen === "tree") mountTechTree();
      if (state.screen === "planner") mountPlannerTree();
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
        <div class="home-menu home-menu-simple">
          <nav class="home-menu-list" aria-label="Main menu">
            ${menuTile("cartridges", "PLAY", "Play Cartridge", cartridge
              ? `Choose ${cartridge.name} to play, switch cartridges, or load a new .pexe file.`
              : "Choose an installed cartridge or load a new .pexe file.", { className: "menu-tile-primary", meta: cartridge ? "Ready" : "Select" })}
            ${menuTile("connections", "NET", "Connections", "Choose, add, edit, remove, or configure Driver connections.", { className: "menu-tile-network", meta: `${state.config.connections.length} saved` })}
            ${menuTile("config", "CFG", "Menu Config", "Open, save, reset, or link portable console settings.", { className: "menu-tile-settings", meta: state.linkedConfigName ? "Linked" : "Browser" })}
          </nav>
          ${!currentHardwareIndex() || state.hardwareIndex.status === "running" || hardwareIndexPendingForConnection() ? homeHardwareIndexRegionMarkup() : ""}
        </div>
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

  function classRefKey(ref) {
    return `${qualifiedKey(ref?.class)}@${ref?.hash || ""}`;
  }

  function groupedClassRefs(refs) {
    const grouped = new Map();
    for (const ref of refs || []) {
      const key = classRefKey(ref);
      const current = grouped.get(key) || { ref, count: 0 };
      current.count += 1;
      grouped.set(key, current);
    }
    return grouped;
  }

  // Planner domain core. This block is intentionally pure: it reads catalog data,
  // models exact class-version tokens, and returns data for a caller to render.
  const PLANNER_DEFAULT_MAX_STEPS = GOAL_WORKFLOW_MAX_STEPS;
  const PLANNER_DEFAULT_MAX_EXPANDED_STATES = 30000;
  const PLANNER_MAX_QUANTITY = GOAL_WORKFLOW_MAX_QUANTITY;

  function plannerCompareText(left, right) {
    const a = String(left || "");
    const b = String(right || "");
    return a < b ? -1 : a > b ? 1 : 0;
  }

  function plannerUniqueStrings(values) {
    return [...new Set((values || []).filter(Boolean))];
  }

  function plannerValidClassRef(ref) {
    return Boolean(ref?.class?.pluginName && ref?.class?.name && String(ref?.hash || "").trim());
  }

  function plannerActionId(action) {
    return `${qualifiedKey(action?.action)}@${action?.hash || ""}`;
  }

  function plannerGroupedSlots(slots) {
    const grouped = new Map();
    for (const slot of slots) {
      const current = grouped.get(slot.classId) || {
        classId: slot.classId,
        ref: slot.ref,
        count: 0,
        slotIndexes: [],
      };
      current.count += 1;
      current.slotIndexes.push(slot.slotIndex);
      grouped.set(slot.classId, current);
    }
    return [...grouped.values()].sort((left, right) => plannerCompareText(left.classId, right.classId));
  }

  function plannerHasStateGuards(source) {
    const text = String(source || "");
    const hasNonTypeDictionaryField = ["DictContains", "DictUpdate"].some((name) =>
      predicateCalls(text, name).some((call) => {
        const field = splitPredicateArguments(call.argumentsSource)[1] || "";
        const literal = field.match(/^\s*["']([^"']+)["']\s*$/)?.[1];
        return Boolean(literal && literal !== "type");
      }),
    );
    if (hasNonTypeDictionaryField) return true;
    // SDK action wrappers use ArrayContains(in|out, ...) as slot plumbing. An
    // array membership test against any other value is an application guard.
    return predicateCalls(text, "ArrayContains").some((call) => {
      const container = splitPredicateArguments(call.argumentsSource)[0] || "";
      return !/^\s*(?:in|out)\s*$/.test(container);
    });
  }

  /** Build a deterministic dependency catalog from one cartridge's flattened action totals. */
  function buildPlannerCatalog(cartridge, workspace = {}) {
    const cartridgeId = String(cartridge?.id || cartridge?.name || "");
    const classById = new Map();
    const catalogWarnings = [];

    const ensureClass = (ref, metadata = {}) => {
      if (!ref?.class) return null;
      const id = classRefKey(ref);
      let item = classById.get(id);
      if (!item) {
        item = {
          id,
          classId: id,
          qualified: {
            pluginName: ref.class.pluginName || "?",
            name: ref.class.name || "Unknown",
          },
          hash: ref.hash || "",
          label: ref.class.name || "Unknown",
          emoji: "\ud83d\udce6",
          description: "Referenced object class",
          declared: false,
          external: Boolean(cartridgeId && ref.class.pluginName !== cartridgeId),
          classSummary: null,
        };
        classById.set(id, item);
      }
      if (metadata.declared) item.declared = true;
      if (metadata.emoji) item.emoji = metadata.emoji;
      if (metadata.description) item.description = metadata.description;
      if (metadata.classSummary) item.classSummary = metadata.classSummary;
      return item;
    };

    for (const item of Array.isArray(cartridge?.classes) ? cartridge.classes : []) {
      ensureClass({ class: item.class, hash: item.hash }, {
        declared: true,
        emoji: item.emoji,
        description: item.description,
        classSummary: item,
      });
    }

    const rawActions = Array.isArray(cartridge?.actions) ? cartridge.actions : [];
    for (const action of rawActions) {
      for (const ref of [...(action.totalInputs || []), ...(action.totalOutputs || [])]) ensureClass(ref);
    }

    // Workspace class summaries only enrich exact versions already referenced by this PEXE.
    for (const item of Array.isArray(workspace?.classes) ? workspace.classes : []) {
      const ref = { class: item.class, hash: item.hash };
      if (!classById.has(classRefKey(ref))) continue;
      ensureClass(ref, {
        declared: item.class?.pluginName === cartridgeId,
        emoji: item.emoji,
        description: item.description,
        classSummary: item,
      });
    }

    const actions = [];
    const seenActionIds = new Set();
    for (const raw of rawActions) {
      const id = plannerActionId(raw);
      if (seenActionIds.has(id)) {
        catalogWarnings.push(`Duplicate action identity ${id} was ignored.`);
        continue;
      }
      seenActionIds.add(id);
      const inputSlots = (raw.totalInputs || []).map((ref, slotIndex) => ({
        classId: classRefKey(ref),
        slotIndex,
        ref,
      }));
      const outputSlots = (raw.totalOutputs || []).map((ref, slotIndex) => ({
        classId: classRefKey(ref),
        slotIndex,
        ref,
      }));
      const inputs = plannerGroupedSlots(inputSlots);
      const outputs = plannerGroupedSlots(outputSlots);
      const inputCounts = new Map(inputs.map((item) => [item.classId, item.count]));
      const outputCounts = new Map(outputs.map((item) => [item.classId, item.count]));
      const involvedClassIds = [...new Set([...inputCounts.keys(), ...outputCounts.keys()])].sort(plannerCompareText);
      const delta = involvedClassIds.map((classId) => ({
        classId,
        inputCount: inputCounts.get(classId) || 0,
        outputCount: outputCounts.get(classId) || 0,
        net: (outputCounts.get(classId) || 0) - (inputCounts.get(classId) || 0),
      }));
      const flow = actionDependencyFlow(raw);
      const warnings = [];
      if (flow.mutations.length) {
        warnings.push("Object mutation or identity turnover is present; paired same-class turnover is shown as UPDATE flow, but field-level mutation and identity continuity are not simulated.");
      }
      if (!flow.classified || flow.opaqueInputs.length || flow.opaqueOutputs.length) {
        warnings.push("Some predicate effects are opaque; the planner uses the action's raw flattened input/output totals.");
      }
      if (plannerHasStateGuards(raw.predicateSource)) {
        warnings.push("Predicate state guards are not simulated; this plan proves class-token flow only.");
      }
      const invalidRefs = [...(raw.totalInputs || []), ...(raw.totalOutputs || [])].filter((ref) => !plannerValidClassRef(ref));
      const searchable = Boolean(raw?.action?.pluginName && raw?.action?.name && String(raw?.hash || "").trim()) && !invalidRefs.length;
      if (!searchable) warnings.push("This action has an incomplete action or class-version identity and is excluded from search.");
      const sameClassTurnover = delta
        .filter((item) => item.inputCount && item.outputCount)
        .map((item) => ({ classId: item.classId, inputs: item.inputCount, outputs: item.outputCount }));
      const normalized = {
        id,
        actionId: id,
        actionKey: qualifiedKey(raw.action),
        qualified: {
          pluginName: raw.action?.pluginName || "?",
          name: raw.action?.name || "Unnamed action",
        },
        hash: raw.hash || "",
        label: raw.action?.name || "Unnamed action",
        emoji: raw.emoji || "\u2699",
        description: raw.description || "",
        raw,
        inputSlots,
        outputSlots,
        inputs,
        outputs,
        inputCounts,
        outputCounts,
        delta,
        positiveNetOutputs: delta.filter((item) => item.net > 0),
        netConsumes: delta.filter((item) => item.net < 0),
        sameClassTurnover,
        flow,
        searchable,
        warnings,
      };
      actions.push(normalized);
    }
    actions.sort((left, right) => plannerCompareText(left.id, right.id));

    const actionById = new Map(actions.map((action) => [action.id, action]));
    const positiveProducersByClass = new Map();
    const outputtersByClass = new Map();
    const consumersByClass = new Map();
    const appendAction = (index, classId, action) => {
      if (!index.has(classId)) index.set(classId, []);
      index.get(classId).push(action);
    };
    for (const action of actions) {
      if (!action.searchable) continue;
      for (const item of action.positiveNetOutputs) appendAction(positiveProducersByClass, item.classId, action);
      for (const item of action.outputs) appendAction(outputtersByClass, item.classId, action);
      for (const item of action.inputs) appendAction(consumersByClass, item.classId, action);
    }
    for (const index of [positiveProducersByClass, outputtersByClass, consumersByClass]) {
      for (const values of index.values()) values.sort((left, right) => plannerCompareText(left.id, right.id));
    }

    const classes = [...classById.values()].sort((left, right) => plannerCompareText(left.id, right.id));
    return {
      version: 1,
      cartridgeId,
      classes,
      classById,
      actions,
      actionById,
      positiveProducersByClass,
      positiveProducerIdsByClass: new Map(
        [...positiveProducersByClass].map(([classId, values]) => [classId, values.map((action) => action.id)]),
      ),
      outputtersByClass,
      consumersByClass,
      warnings: plannerUniqueStrings([
        ...catalogWarnings,
        ...actions.flatMap((action) => action.warnings.map((warning) => `${action.label}: ${warning}`)),
      ]),
    };
  }

  /** Normalize all live workspace objects into exact class-version inventory tokens. */
  function buildPlannerInventory(objects) {
    const warnings = [];
    const seen = new Set();
    const normalized = [];
    for (const object of Array.isArray(objects) ? objects : []) {
      if (object?.status !== "live") continue;
      const ref = { class: object.class, hash: object.classHash };
      if (!plannerValidClassRef(ref)) {
        warnings.push(`Skipped live object ${object?.fileName || object?.contentHash || "(unnamed)"}: incomplete class-version identity.`);
        continue;
      }
      const identity = object.contentHash ? `hash:${object.contentHash}` : object.fileName ? `file:${object.fileName}` : "";
      if (!identity) {
        warnings.push(`Skipped live ${ref.class.name} object: no content hash or file name.`);
        continue;
      }
      if (seen.has(identity)) {
        warnings.push(`Ignored duplicate live object identity ${object.contentHash || object.fileName}.`);
        continue;
      }
      seen.add(identity);
      normalized.push({
        id: `object:${encodeURIComponent(identity)}`,
        objectId: `object:${encodeURIComponent(identity)}`,
        classId: classRefKey(ref),
        qualified: { pluginName: object.class.pluginName, name: object.class.name },
        classHash: object.classHash,
        classLabel: object.class.name,
        fileName: object.fileName || null,
        contentHash: object.contentHash || null,
        emoji: object.emoji || "\ud83d\udce6",
        object,
      });
    }
    normalized.sort(
      (left, right) =>
        plannerCompareText(left.fileName, right.fileName) ||
        plannerCompareText(left.contentHash, right.contentHash) ||
        plannerCompareText(left.classId, right.classId),
    );
    const byClass = new Map();
    for (const object of normalized) {
      if (!byClass.has(object.classId)) byClass.set(object.classId, []);
      byClass.get(object.classId).push(object);
    }
    const counts = new Map([...byClass].map(([classId, values]) => [classId, values.length]));
    return {
      version: 1,
      objects: normalized,
      byClass,
      counts,
      countEntries: [...counts]
        .map(([classId, count]) => ({ classId, count }))
        .sort((left, right) => plannerCompareText(left.classId, right.classId)),
      warnings: plannerUniqueStrings(warnings),
    };
  }

  /** Goal classes are stock classes for which at least one action has positive net output. */
  function plannerGoalOptions(catalog) {
    if (!catalog?.positiveProducersByClass) return [];
    return [...catalog.positiveProducersByClass]
      .filter(([, actions]) => actions.length)
      .map(([classId, actions]) => {
        const item = catalog.classById.get(classId);
        return {
          classId,
          qualified: item?.qualified || { pluginName: "?", name: "Unknown" },
          hash: item?.hash || "",
          label: item?.label || classId,
          emoji: item?.emoji || "\ud83d\udce6",
          description: item?.description || "",
          declared: Boolean(item?.declared),
          external: Boolean(item?.external),
          producerActionIds: actions.map((action) => action.id),
          producerCount: actions.length,
        };
      })
      .sort(
        (left, right) =>
          plannerCompareText(left.label, right.label) ||
          plannerCompareText(left.qualified.pluginName, right.qualified.pluginName) ||
          plannerCompareText(left.hash, right.hash),
      );
  }

  function plannerRequest(goalRequest) {
    const value = goalRequest && typeof goalRequest === "object" ? goalRequest : { classId: goalRequest };
    const quantity = value.quantity === undefined ? 1 : Number(value.quantity);
    const semantics = value.semantics === "target-total" ? "target-total" : "additional";
    const boundedInteger = (candidate, fallback, maximum, minimum = 0) => {
      if (candidate === undefined) return fallback;
      const number = Number(candidate);
      return Number.isInteger(number) && number >= minimum && number <= maximum ? number : fallback;
    };
    return {
      classId: String(value.classId || ""),
      quantity,
      semantics,
      maxSteps: boundedInteger(value.maxSteps, PLANNER_DEFAULT_MAX_STEPS, GOAL_WORKFLOW_MAX_STEPS),
      maxExpandedStates: boundedInteger(value.maxExpandedStates, PLANNER_DEFAULT_MAX_EXPANDED_STATES, 250000),
    };
  }

  function normalizePlannerQuantity(value, fallback = 1) {
    const quantity = Number(value);
    if (!Number.isFinite(quantity)) return fallback;
    return Math.min(PLANNER_MAX_QUANTITY, Math.max(1, Math.trunc(quantity)));
  }

  /** Convert transient planner UI state into the planner's explicit request contract. */
  function plannerStateRequest(plannerState = state.planner) {
    return plannerRequest({
      classId: plannerState?.goalClassId,
      quantity: plannerState?.goalQuantity,
      semantics: "additional",
    });
  }

  function plannerGoalSummary(catalog, inventory, request) {
    const item = catalog?.classById?.get(request.classId);
    const initialCount = inventory?.counts?.get(request.classId) || 0;
    const targetCount = request.semantics === "additional" ? initialCount + request.quantity : request.quantity;
    return {
      classId: request.classId,
      qualified: item?.qualified || { pluginName: "?", name: "Unknown" },
      hash: item?.hash || "",
      label: item?.label || request.classId || "Unknown",
      quantity: request.quantity,
      semantics: request.semantics,
      initialCount,
      targetCount,
      finalCount: initialCount,
    };
  }

  function plannerEmptyResult(catalog, inventory, request, status, diagnostics = [], warnings = []) {
    const goal = plannerGoalSummary(catalog, inventory, request);
    return {
      version: 1,
      status,
      strategy: "none",
      shortestGuaranteed: false,
      goal,
      sequence: [],
      steps: [],
      tokens: [],
      goalTokenIds: [],
      finalGoalTokenIds: [],
      dependencyEdges: [],
      totals: {
        actionCount: 0,
        expandedStates: 0,
        visitedStates: 1,
        maxSteps: request.maxSteps,
        maxExpandedStates: request.maxExpandedStates,
      },
      alternativeProducerActionIds: (catalog?.positiveProducersByClass?.get(request.classId) || []).map((action) => action.id),
      warnings: plannerUniqueStrings([...(inventory?.warnings || []), ...warnings]),
      diagnostics,
    };
  }

  function plannerRelevantClosure(catalog, goalClassId) {
    const classIds = new Set([goalClassId]);
    const actionIds = new Set();
    const queue = [goalClassId];
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const classId = queue[cursor];
      for (const action of catalog.positiveProducersByClass.get(classId) || []) {
        if (actionIds.has(action.id)) continue;
        actionIds.add(action.id);
        for (const input of action.inputs) {
          if (classIds.has(input.classId)) continue;
          classIds.add(input.classId);
          queue.push(input.classId);
        }
      }
    }
    return {
      classIds: [...classIds].sort(plannerCompareText),
      actions: [...actionIds].map((id) => catalog.actionById.get(id)).filter(Boolean).sort((a, b) => plannerCompareText(a.id, b.id)),
    };
  }

  function plannerStructuralSupport(closure, inventory) {
    const supported = new Set(
      closure.classIds.filter((classId) => (inventory.counts.get(classId) || 0) > 0),
    );
    const enabledActionIds = new Set();
    let changed = true;
    while (changed) {
      changed = false;
      for (const action of closure.actions) {
        if (!action.inputs.every((input) => supported.has(input.classId))) continue;
        enabledActionIds.add(action.id);
        for (const output of action.positiveNetOutputs) {
          if (supported.has(output.classId)) continue;
          supported.add(output.classId);
          changed = true;
        }
      }
    }
    return { supported, enabledActionIds };
  }

  function plannerCycleDiagnostics(closure, inventory, support) {
    const graph = new Map(closure.classIds.map((classId) => [classId, new Set()]));
    for (const action of closure.actions) {
      for (const input of action.inputs) {
        if (!graph.has(input.classId)) continue;
        for (const output of action.positiveNetOutputs) {
          if (graph.has(output.classId)) graph.get(input.classId).add(output.classId);
        }
      }
    }
    let nextIndex = 0;
    const indexes = new Map();
    const lowLinks = new Map();
    const stack = [];
    const onStack = new Set();
    const components = [];
    const visit = (classId) => {
      indexes.set(classId, nextIndex);
      lowLinks.set(classId, nextIndex);
      nextIndex += 1;
      stack.push(classId);
      onStack.add(classId);
      for (const target of graph.get(classId) || []) {
        if (!indexes.has(target)) {
          visit(target);
          lowLinks.set(classId, Math.min(lowLinks.get(classId), lowLinks.get(target)));
        } else if (onStack.has(target)) {
          lowLinks.set(classId, Math.min(lowLinks.get(classId), indexes.get(target)));
        }
      }
      if (lowLinks.get(classId) !== indexes.get(classId)) return;
      const component = [];
      let popped;
      do {
        popped = stack.pop();
        onStack.delete(popped);
        component.push(popped);
      } while (popped !== classId);
      components.push(component.sort(plannerCompareText));
    };
    for (const classId of closure.classIds) if (!indexes.has(classId)) visit(classId);

    return components
      .filter((component) => component.length > 1 || graph.get(component[0])?.has(component[0]))
      .map((component) => {
        const componentSet = new Set(component);
        const seeded = component.some((classId) => (inventory.counts.get(classId) || 0) > 0 || support.supported.has(classId));
        const actionIds = closure.actions
          .filter(
            (action) =>
              action.inputs.some((input) => componentSet.has(input.classId)) &&
              action.positiveNetOutputs.some((output) => componentSet.has(output.classId)),
          )
          .map((action) => action.id);
        return {
          code: seeded ? "seeded-cycle" : "unseeded-cycle",
          message: seeded
            ? "A cyclic production dependency has a reachable seed; bounded token search decides whether its quantities work."
            : "A cyclic production dependency has no reachable seed.",
          classIds: component,
          actionIds,
        };
      });
  }

  /**
   * Build a deterministic, validated action sequence by recursively satisfying
   * exact class-version counts. This is a bounded fallback for goals whose
   * shortest-path state space is too wide; it never replaces a completed BFS.
   */
  function plannerGoalDirectedSequence(catalog, inventory, request) {
    const classIds = catalog.classes.map((item) => item.classId);
    const initialState = {
      marking: new Map(classIds.map((classId) => [classId, inventory.counts.get(classId) || 0])),
      sequence: [],
    };
    const attemptLimit = Math.max(1000, Math.min(100000, request.maxExpandedStates * 2));
    let attempts = 0;
    let limitHit = false;
    const countOf = (state, classId) => state.marking.get(classId) || 0;
    const producerOrder = (classId) => [...(catalog.positiveProducersByClass.get(classId) || [])].sort((left, right) => {
      const leftNet = left.positiveNetOutputs.find((item) => item.classId === classId)?.net || 0;
      const rightNet = right.positiveNetOutputs.find((item) => item.classId === classId)?.net || 0;
      return rightNet - leftNet || left.inputSlots.length - right.inputSlots.length || plannerCompareText(left.id, right.id);
    });

    function* ensureAvailable(classId, targetCount, state, activeActionIds = new Set()) {
      attempts += 1;
      if (attempts > attemptLimit) {
        limitHit = true;
        return;
      }
      if (countOf(state, classId) >= targetCount) {
        yield state;
        return;
      }
      for (const action of producerOrder(classId)) {
        if (activeActionIds.has(action.id)) continue;
        const active = new Set(activeActionIds).add(action.id);
        for (const firedState of enableAndFire(action, state, active)) {
          const markingChanged = classIds.some((itemClassId) => countOf(firedState, itemClassId) !== countOf(state, itemClassId));
          if (!markingChanged) continue;
          for (const completedState of ensureAvailable(classId, targetCount, firedState, activeActionIds)) {
            yield completedState;
          }
          if (limitHit) return;
        }
        if (limitHit) return;
      }
    }

    function* enableAndFire(action, state, activeActionIds) {
      attempts += 1;
      if (attempts > attemptLimit) {
        limitHit = true;
        return;
      }
      const missingInputs = action.inputs.filter((input) => countOf(state, input.classId) < input.count);
      if (missingInputs.length) {
        for (const missing of missingInputs) {
          for (const suppliedState of ensureAvailable(missing.classId, missing.count, state, activeActionIds)) {
            yield* enableAndFire(action, suppliedState, activeActionIds);
            if (limitHit) return;
          }
        }
        return;
      }
      if (state.sequence.length >= request.maxSteps) return;
      const marking = new Map(state.marking);
      const read = (classId) => marking.get(classId) || 0;
      for (const input of action.inputs) marking.set(input.classId, read(input.classId) - input.count);
      for (const output of action.outputs) marking.set(output.classId, read(output.classId) + output.count);
      yield { marking, sequence: [...state.sequence, action.id] };
    }

    const targetCount = plannerGoalSummary(catalog, inventory, request).targetCount;
    const candidate = ensureAvailable(request.classId, targetCount, initialState).next().value || null;
    return {
      success: Boolean(candidate),
      sequence: candidate ? candidate.sequence : [],
      attempts,
      limitHit,
      finalCount: candidate ? countOf(candidate, request.classId) : countOf(initialState, request.classId),
    };
  }

  /** Replay a sequence into concrete/symbolic tokens and annotate parent dependencies. */
  function materializePlannerSequence(catalog, inventory, sequence, goalRequest) {
    const request = plannerRequest(goalRequest);
    const goal = plannerGoalSummary(catalog, inventory, request);
    const tokens = [];
    const queues = new Map();
    const steps = [];
    const dependencyEdges = [];
    const warnings = [];
    const queueFor = (classId) => {
      if (!queues.has(classId)) queues.set(classId, []);
      return queues.get(classId);
    };
    for (const [index, object] of inventory.objects.entries()) {
      const token = {
        tokenId: `inventory:${String(index + 1).padStart(4, "0")}:${encodeURIComponent(object.contentHash || object.fileName || object.id)}`,
        classId: object.classId,
        classLabel: catalog.classById.get(object.classId)?.label || object.classLabel || object.classId,
        kind: "inventory",
        fileName: object.fileName,
        contentHash: object.contentHash,
        producedByStepId: null,
        consumedByStepId: null,
      };
      tokens.push(token);
      queueFor(token.classId).push(token);
    }

    (sequence || []).forEach((actionId, index) => {
      const action = catalog.actionById.get(actionId);
      if (!action) {
        warnings.push(`Cannot materialize unknown action ${actionId}.`);
        return;
      }
      const stepId = `step:${index + 1}`;
      const inputs = [];
      const dependencyStepIds = new Set();
      for (const slot of action.inputSlots) {
        const token = queueFor(slot.classId).shift();
        if (!token) {
          warnings.push(`${action.label} could not consume input slot ${slot.slotIndex + 1} while materializing the plan.`);
          continue;
        }
        token.consumedByStepId = stepId;
        if (token.producedByStepId) {
          dependencyStepIds.add(token.producedByStepId);
          dependencyEdges.push({
            id: `dependency:${token.tokenId}>${stepId}`,
            fromStepId: token.producedByStepId,
            toStepId: stepId,
            classId: token.classId,
            tokenId: token.tokenId,
          });
        }
        inputs.push({
          tokenId: token.tokenId,
          classId: token.classId,
          slotIndex: slot.slotIndex,
          classLabel: token.classLabel,
          sourceKind: token.kind === "inventory" ? "inventory" : "step",
          sourceStepId: token.producedByStepId,
          fileName: token.fileName,
          contentHash: token.contentHash,
        });
      }
      const outputs = action.outputSlots.map((slot) => {
        const token = {
          tokenId: `${stepId}:out:${slot.slotIndex + 1}`,
          classId: slot.classId,
          classLabel: catalog.classById.get(slot.classId)?.label || slot.ref.class?.name || slot.classId,
          kind: "planned-output",
          fileName: null,
          contentHash: null,
          producedByStepId: stepId,
          consumedByStepId: null,
        };
        tokens.push(token);
        queueFor(token.classId).push(token);
        return {
          tokenId: token.tokenId,
          classId: token.classId,
          slotIndex: slot.slotIndex,
          classLabel: token.classLabel,
          sourceKind: "step",
          sourceStepId: stepId,
          fileName: null,
          contentHash: null,
        };
      });
      steps.push({
        id: stepId,
        index,
        order: index + 1,
        actionId: action.id,
        actionKey: action.actionKey,
        label: action.label,
        emoji: action.emoji,
        inputs,
        outputs,
        dependencyStepIds: [...dependencyStepIds].sort(plannerCompareText),
        warnings: [...action.warnings],
      });
    });

    const finalGoalTokens = [...queueFor(request.classId)];
    const producedGoalTokens = finalGoalTokens.filter((token) => token.producedByStepId);
    const inventoryGoalTokens = finalGoalTokens.filter((token) => !token.producedByStepId);
    const stepById = new Map(steps.map((step) => [step.id, step]));
    const isNewGoalOutput = (token) => {
      const step = stepById.get(token.producedByStepId);
      const action = step ? catalog.actionById.get(step.actionId) : null;
      const output = step?.outputs.find((item) => item.tokenId === token.tokenId);
      const turnover = action?.sameClassTurnover?.find((item) => item.classId === token.classId);
      if (!turnover) return true;
      const sameClassSlots = action.outputSlots.filter((slot) => slot.classId === token.classId);
      const position = sameClassSlots.findIndex((slot) => slot.slotIndex === output?.slotIndex);
      return position >= Math.min(turnover.inputs, turnover.outputs);
    };
    const newestFirst = (left, right) => {
      const leftIndex = stepById.get(left.producedByStepId)?.index ?? -1;
      const rightIndex = stepById.get(right.producedByStepId)?.index ?? -1;
      return rightIndex - leftIndex || plannerCompareText(left.tokenId, right.tokenId);
    };
    const createdGoalTokens = producedGoalTokens.filter(isNewGoalOutput).sort(newestFirst);
    const turnoverGoalTokens = producedGoalTokens.filter((token) => !isNewGoalOutput(token)).sort(newestFirst);
    // A produced turnover token can represent an existing tool carried through
    // the plan. Prefer genuine positive-net outputs so an "additional" goal's
    // display tree starts at the object the action set actually added.
    const preferredGoalTokens = [...createdGoalTokens, ...turnoverGoalTokens, ...inventoryGoalTokens];
    const selectedGoalTokens = request.semantics === "additional"
      ? preferredGoalTokens.slice(0, Math.max(0, request.quantity))
      : preferredGoalTokens.slice(0, Math.max(0, goal.targetCount));
    goal.finalCount = finalGoalTokens.length;
    return {
      goal,
      steps,
      tokens,
      goalTokenIds: selectedGoalTokens.map((token) => token.tokenId),
      finalGoalTokenIds: finalGoalTokens.map((token) => token.tokenId),
      dependencyEdges,
      warnings: plannerUniqueStrings([...warnings, ...steps.flatMap((step) => step.warnings)]),
    };
  }

  /** Find a valid lexical action sequence, using bounded shortest search first. */
  function planGoalOutput(catalog, inventory, goalRequest) {
    const request = plannerRequest(goalRequest);
    const normalizedInventory = Array.isArray(inventory) ? buildPlannerInventory(inventory) : inventory;
    if (
      !catalog?.classById ||
      !catalog?.actionById ||
      !catalog?.positiveProducersByClass ||
      !normalizedInventory?.counts ||
      !normalizedInventory?.objects ||
      !request.classId ||
      !catalog.classById.has(request.classId) ||
      !Number.isInteger(request.quantity) ||
      request.quantity < 1 ||
      request.quantity > PLANNER_MAX_QUANTITY
    ) {
      const result = plannerEmptyResult(catalog, normalizedInventory || buildPlannerInventory([]), request, "invalid-goal", [
        {
          code: "invalid-goal",
          message: `Choose an exact goal class version and a whole quantity from 1 to ${PLANNER_MAX_QUANTITY.toLocaleString()}.`,
          classIds: request.classId ? [request.classId] : [],
          actionIds: [],
        },
      ]);
      result.totals.visitedStates = 0;
      return result;
    }

    const goal = plannerGoalSummary(catalog, normalizedInventory, request);
    if (goal.initialCount >= goal.targetCount) {
      const materialized = materializePlannerSequence(catalog, normalizedInventory, [], request);
      return {
        version: 1,
        status: "satisfied",
        strategy: "inventory",
        shortestGuaranteed: true,
        goal: materialized.goal,
        sequence: [],
        steps: materialized.steps,
        tokens: materialized.tokens,
        goalTokenIds: materialized.goalTokenIds,
        finalGoalTokenIds: materialized.finalGoalTokenIds,
        dependencyEdges: materialized.dependencyEdges,
        totals: {
          actionCount: 0,
          expandedStates: 0,
          visitedStates: 1,
          maxSteps: request.maxSteps,
          maxExpandedStates: request.maxExpandedStates,
        },
        alternativeProducerActionIds: (catalog.positiveProducersByClass.get(request.classId) || []).map((action) => action.id),
        warnings: plannerUniqueStrings([...(normalizedInventory.warnings || []), ...materialized.warnings]),
        diagnostics: [],
      };
    }

    const closure = plannerRelevantClosure(catalog, request.classId);
    const support = plannerStructuralSupport(closure, normalizedInventory);
    const cycleDiagnostics = plannerCycleDiagnostics(closure, normalizedInventory, support);
    const relatedWarnings = closure.actions.flatMap((action) => action.warnings.map((warning) => `${action.label}: ${warning}`));
    const goalProducers = catalog.positiveProducersByClass.get(request.classId) || [];
    if (!goalProducers.length || !support.supported.has(request.classId)) {
      const missingClassIds = closure.classIds.filter(
        (classId) =>
          (normalizedInventory.counts.get(classId) || 0) === 0 &&
          !(catalog.positiveProducersByClass.get(classId) || []).length,
      );
      const diagnostics = [...cycleDiagnostics];
      if (!goalProducers.length) {
        diagnostics.unshift({
          code: "no-positive-producer",
          message: "No action has positive net output for this exact class version.",
          classIds: [request.classId],
          actionIds: [],
        });
      }
      if (missingClassIds.length) {
        diagnostics.push({
          code: "missing-seed",
          message: "Required class versions have neither live inventory nor a positive-net producer.",
          classIds: missingClassIds,
          actionIds: [],
        });
      }
      if (!diagnostics.length) {
        diagnostics.push({
          code: "structurally-unreachable",
          message: "The goal is outside the production support reachable from live inventory and source actions.",
          classIds: [request.classId],
          actionIds: closure.actions.map((action) => action.id),
        });
      }
      return plannerEmptyResult(catalog, normalizedInventory, request, "unreachable", diagnostics, relatedWarnings);
    }

    const classIds = closure.classIds;
    const classIndex = new Map(classIds.map((classId, index) => [classId, index]));
    const goalIndex = classIndex.get(request.classId);
    const maxInputByClass = new Map();
    for (const action of closure.actions) {
      for (const input of action.inputs) {
        maxInputByClass.set(input.classId, Math.max(maxInputByClass.get(input.classId) || 0, input.count));
      }
    }
    // Any <= D-step plan can consume at most D times the largest per-action input
    // multiplicity, so counts beyond this cap are behaviorally indistinguishable.
    const caps = classIds.map((classId) => {
      const retainedGoalCount = classId === request.classId ? goal.targetCount : 0;
      return retainedGoalCount + request.maxSteps * (maxInputByClass.get(classId) || 0);
    });
    const initialMarking = classIds.map((classId, index) =>
      Math.min(normalizedInventory.counts.get(classId) || 0, caps[index]),
    );
    const markingKey = (marking) => marking.join(",");
    const queue = [{ marking: initialMarking, depth: 0, parent: null, actionId: "" }];
    const visited = new Set([markingKey(initialMarking)]);
    const visitedStateBudget = Math.max(1, request.maxExpandedStates);
    let cursor = 0;
    let expandedStates = 0;
    let winningNode = null;
    let depthLimitHit = false;
    let expansionLimitHit = false;

    while (cursor < queue.length) {
      if (expandedStates >= request.maxExpandedStates) {
        expansionLimitHit = true;
        break;
      }
      const node = queue[cursor];
      cursor += 1;
      expandedStates += 1;
      if (node.marking[goalIndex] >= goal.targetCount) {
        winningNode = node;
        break;
      }
      if (node.depth >= request.maxSteps) {
        depthLimitHit = true;
        continue;
      }
      for (const action of closure.actions) {
        let enabled = true;
        for (const input of action.inputs) {
          if (node.marking[classIndex.get(input.classId)] < input.count) {
            enabled = false;
            break;
          }
        }
        if (!enabled) continue;
        const next = node.marking.slice();
        for (const input of action.inputs) next[classIndex.get(input.classId)] -= input.count;
        for (const output of action.outputs) {
          const index = classIndex.get(output.classId);
          if (index === undefined) continue;
          next[index] = Math.min(caps[index], next[index] + output.count);
        }
        const key = markingKey(next);
        if (visited.has(key)) continue;
        if (visited.size >= visitedStateBudget) {
          expansionLimitHit = true;
          break;
        }
        visited.add(key);
        queue.push({ marking: next, depth: node.depth + 1, parent: node, actionId: action.id });
      }
    }

    if (!winningNode) {
      const limitingCode = expansionLimitHit ? "state-budget-exhausted" : depthLimitHit ? "step-budget-exhausted" : "bounded-search-exhausted";
      const searchDiagnostic = {
        code: "search-limit",
        message: expansionLimitHit
          ? `Shortest-path search reached the ${request.maxExpandedStates.toLocaleString()}-state budget.`
          : depthLimitHit
            ? `Shortest-path search found no plan within ${request.maxSteps.toLocaleString()} actions.`
            : "The safely capped shortest-path state space was exhausted.",
        classIds: [request.classId],
        actionIds: closure.actions.map((action) => action.id),
        reason: limitingCode,
      };
      const fallback = plannerGoalDirectedSequence(catalog, normalizedInventory, request);
      if (fallback.success) {
        const materialized = materializePlannerSequence(catalog, normalizedInventory, fallback.sequence, request);
        const completeReplay =
          materialized.steps.length === fallback.sequence.length &&
          materialized.steps.every((step) => {
            const action = catalog.actionById.get(step.actionId);
            return action && step.inputs.length === action.inputSlots.length && step.outputs.length === action.outputSlots.length;
          });
        const validFallback =
          completeReplay &&
          materialized.goal.finalCount >= materialized.goal.targetCount &&
          !materialized.warnings.some((warning) => warning.includes("could not consume") || warning.includes("unknown action"));
        if (validFallback) {
          return {
            version: 1,
            status: "planned",
            strategy: "goal-directed-fallback",
            shortestGuaranteed: false,
            goal: materialized.goal,
            sequence: fallback.sequence,
            steps: materialized.steps,
            tokens: materialized.tokens,
            goalTokenIds: materialized.goalTokenIds,
            finalGoalTokenIds: materialized.finalGoalTokenIds,
            dependencyEdges: materialized.dependencyEdges,
            totals: {
              actionCount: fallback.sequence.length,
              expandedStates,
              visitedStates: visited.size,
              fallbackAttempts: fallback.attempts,
              maxSteps: request.maxSteps,
              maxExpandedStates: request.maxExpandedStates,
            },
            alternativeProducerActionIds: goalProducers.map((action) => action.id),
            warnings: plannerUniqueStrings([
              ...(normalizedInventory.warnings || []),
              ...materialized.warnings,
              "A valid exact-token goal-directed fallback plan was found after shortest-path search reached its bound; its action count is not guaranteed minimal, and Driver predicate/state checks remain authoritative.",
            ]),
            diagnostics: [...cycleDiagnostics, searchDiagnostic],
          };
        }
      }
      const diagnostics = [...cycleDiagnostics, {
        ...searchDiagnostic,
        message: `${searchDiagnostic.message} ${fallback.limitHit ? "Goal-directed fallback reached its branch budget" : "Goal-directed fallback also found no valid sequence"}; reachability remains unknown.`,
      }];
      const result = plannerEmptyResult(catalog, normalizedInventory, request, "search-limit", diagnostics, [
        ...relatedWarnings,
        "Planner bounds were reached without a result; the goal has not been declared unreachable.",
      ]);
      result.totals.expandedStates = expandedStates;
      result.totals.visitedStates = visited.size;
      result.totals.fallbackAttempts = fallback.attempts;
      return result;
    }

    const sequence = [];
    for (let node = winningNode; node?.parent; node = node.parent) sequence.push(node.actionId);
    sequence.reverse();
    const materialized = materializePlannerSequence(catalog, normalizedInventory, sequence, request);
    return {
      version: 1,
      status: "planned",
      strategy: "bounded-shortest",
      shortestGuaranteed: true,
      goal: materialized.goal,
      sequence,
      steps: materialized.steps,
      tokens: materialized.tokens,
      goalTokenIds: materialized.goalTokenIds,
      finalGoalTokenIds: materialized.finalGoalTokenIds,
      dependencyEdges: materialized.dependencyEdges,
      totals: {
        actionCount: sequence.length,
        expandedStates,
        visitedStates: visited.size,
        maxSteps: request.maxSteps,
        maxExpandedStates: request.maxExpandedStates,
      },
      alternativeProducerActionIds: goalProducers.map((action) => action.id),
      warnings: plannerUniqueStrings([...(normalizedInventory.warnings || []), ...materialized.warnings]),
      diagnostics: cycleDiagnostics,
    };
  }

  /**
   * Large craft quantities can expand into thousands of actions, which is too
   * large for a recoverable localStorage checkpoint and too dense to render as
   * one useful tree. Preview one exact goal batch and let the workflow
   * controller replan from live inventory until the quantity is verified.
   */
  function planGoalCraftRequest(catalog, inventory, goalRequest) {
    const request = plannerRequest(goalRequest);
    if (request.quantity <= 1) return planGoalOutput(catalog, inventory, request);
    const unitRequest = { ...request, quantity: 1, semantics: "additional" };
    const unitResult = planGoalOutput(catalog, inventory, unitRequest);
    const requestedGoal = plannerGoalSummary(catalog, inventory, request);
    const unitGoalIncrease = Math.max(
      1,
      (Number(unitResult.goal?.finalCount) || requestedGoal.initialCount) - requestedGoal.initialCount,
    );
    const estimatedBatchCount = Math.ceil(request.quantity / unitGoalIncrease);
    const repeat = {
      mode: "repeat-unit",
      quantity: request.quantity,
      unitQuantity: 1,
      unitGoalIncrease,
      estimatedBatchCount,
      unitActionCount: unitResult.totals?.actionCount || 0,
    };
    const result = {
      ...unitResult,
      goal: {
        ...requestedGoal,
        finalCount: unitResult.status === "planned" ? requestedGoal.targetCount : unitResult.goal?.finalCount ?? requestedGoal.initialCount,
      },
      execution: repeat,
      totals: {
        ...unitResult.totals,
        actionCount: (unitResult.totals?.actionCount || 0) * estimatedBatchCount,
        unitActionCount: unitResult.totals?.actionCount || 0,
      },
    };
    return result;
  }
  // End planner domain core.

  function predicateCalls(source, name) {
    const text = String(source || "");
    const callName = String(name);
    const calls = [];
    let outerQuote = "";
    let outerEscaped = false;
    let lineComment = false;
    let blockComment = false;
    for (let cursor = 0; cursor < text.length; cursor += 1) {
      const character = text[cursor];
      const next = text[cursor + 1] || "";
      if (lineComment) {
        if (character === "\n") lineComment = false;
        continue;
      }
      if (blockComment) {
        if (character === "*" && next === "/") {
          blockComment = false;
          cursor += 1;
        }
        continue;
      }
      if (outerQuote) {
        if (outerEscaped) outerEscaped = false;
        else if (character === "\\") outerEscaped = true;
        else if (character === outerQuote) outerQuote = "";
        continue;
      }
      if (character === "/" && next === "/") {
        lineComment = true;
        cursor += 1;
        continue;
      }
      if (character === "/" && next === "*") {
        blockComment = true;
        cursor += 1;
        continue;
      }
      if (character === '"' || character === "'" || character === "`") {
        outerQuote = character;
        continue;
      }
      if (!text.startsWith(callName, cursor) || /[A-Za-z0-9_]/.test(text[cursor - 1] || "")) continue;
      let openIndex = cursor + callName.length;
      while (/\s/.test(text[openIndex] || "")) openIndex += 1;
      if (text[openIndex] !== "(") continue;
      let depth = 0;
      let quote = "";
      let escaped = false;
      let innerLineComment = false;
      let innerBlockComment = false;
      for (let index = openIndex; index < text.length; index += 1) {
        const innerCharacter = text[index];
        const innerNext = text[index + 1] || "";
        if (innerLineComment) {
          if (innerCharacter === "\n") innerLineComment = false;
          continue;
        }
        if (innerBlockComment) {
          if (innerCharacter === "*" && innerNext === "/") {
            innerBlockComment = false;
            index += 1;
          }
          continue;
        }
        if (quote) {
          if (escaped) escaped = false;
          else if (innerCharacter === "\\") escaped = true;
          else if (innerCharacter === quote) quote = "";
          continue;
        }
        if (innerCharacter === "/" && innerNext === "/") {
          innerLineComment = true;
          index += 1;
          continue;
        }
        if (innerCharacter === "/" && innerNext === "*") {
          innerBlockComment = true;
          index += 1;
          continue;
        }
        if (innerCharacter === '"' || innerCharacter === "'" || innerCharacter === "`") {
          quote = innerCharacter;
          continue;
        }
        if (innerCharacter === "(") depth += 1;
        if (innerCharacter !== ")") continue;
        depth -= 1;
        if (depth !== 0) continue;
        calls.push({
          source: text.slice(cursor, index + 1),
          argumentsSource: text.slice(openIndex + 1, index),
        });
        break;
      }
    }
    return calls;
  }

  function splitPredicateArguments(source) {
    const text = String(source || "");
    const parts = [];
    let start = 0;
    let depth = 0;
    let quote = "";
    let escaped = false;
    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      if (quote) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === quote) quote = "";
        continue;
      }
      if (character === '"' || character === "'" || character === "`") {
        quote = character;
        continue;
      }
      if ("([{".includes(character)) depth += 1;
      else if (")]}".includes(character)) depth = Math.max(0, depth - 1);
      else if (character === "," && depth === 0) {
        parts.push(text.slice(start, index).trim());
        start = index + 1;
      }
    }
    parts.push(text.slice(start).trim());
    return parts;
  }

  function predicateOperationClassCounts(source, operation) {
    const counts = new Map();
    for (const call of predicateCalls(source, `tx::Tx${operation}`)) {
      const match = call.source.match(/@self_predicate\(\s*Is([-A-Za-z0-9_]+)\s*\)/);
      if (!match) continue;
      counts.set(match[1], (counts.get(match[1]) || 0) + 1);
    }
    return counts;
  }

  function actionDependencyFlow(action) {
    const totalInputs = action.totalInputs || [];
    const totalOutputs = action.totalOutputs || [];
    const deletedByClass = predicateOperationClassCounts(action.predicateSource, "Delete");
    const insertedByClass = predicateOperationClassCounts(action.predicateSource, "Insert");
    const mutatedByClass = predicateOperationClassCounts(action.predicateSource, "Mutate");
    const source = String(action.predicateSource || "");
    const sourceAvailable = Boolean(source.trim()) && !/AND\(\.\.\.\)/.test(source);
    const countRefsByClass = (refs) => {
      const counts = new Map();
      for (const ref of refs) {
        const className = ref.class?.name || "";
        counts.set(className, (counts.get(className) || 0) + 1);
      }
      return counts;
    };
    const combineCounts = (left, right) => {
      const combined = new Map(left);
      for (const [key, count] of right) combined.set(key, (combined.get(key) || 0) + count);
      return combined;
    };
    const requiredInputs = combineCounts(deletedByClass, mutatedByClass);
    const requiredOutputs = combineCounts(insertedByClass, mutatedByClass);
    const availableInputs = countRefsByClass(totalInputs);
    const availableOutputs = countRefsByClass(totalOutputs);
    const refVariantsByClass = (refs) => {
      const variants = new Map();
      for (const ref of refs) {
        const className = ref.class?.name || "";
        if (!variants.has(className)) variants.set(className, new Set());
        variants.get(className).add(classRefKey(ref));
      }
      return variants;
    };
    const inputVariants = refVariantsByClass(totalInputs);
    const outputVariants = refVariantsByClass(totalOutputs);
    const inconsistent =
      [...requiredInputs].some(([key, count]) => count > (availableInputs.get(key) || 0)) ||
      [...requiredOutputs].some(([key, count]) => count > (availableOutputs.get(key) || 0)) ||
      [...requiredInputs.keys()].some((key) => (inputVariants.get(key)?.size || 0) > 1) ||
      [...requiredOutputs.keys()].some((key) => (outputVariants.get(key)?.size || 0) > 1) ||
      [...mutatedByClass.keys()].some((key) => {
        const inputKey = [...(inputVariants.get(key) || [])][0];
        const outputKey = [...(outputVariants.get(key) || [])][0];
        return inputKey !== outputKey;
      });
    if (!sourceAvailable || inconsistent) {
      return {
        inputs: [],
        outputs: [],
        mutations: [],
        opaqueInputs: totalInputs,
        opaqueOutputs: totalOutputs,
        classified: false,
      };
    }

    const assignRoles = (refs, firstCounts, secondCounts, firstRole, secondRole) => {
      const firstRemaining = new Map(firstCounts);
      const secondRemaining = new Map(secondCounts);
      return refs.map((ref) => {
        const className = ref.class?.name || "";
        if ((firstRemaining.get(className) || 0) > 0) {
          firstRemaining.set(className, firstRemaining.get(className) - 1);
          return firstRole;
        }
        if ((secondRemaining.get(className) || 0) > 0) {
          secondRemaining.set(className, secondRemaining.get(className) - 1);
          return secondRole;
        }
        return "opaque";
      });
    };
    const inputRoles = assignRoles(totalInputs, deletedByClass, mutatedByClass, "input", "mutation");
    const outputRoles = assignRoles(totalOutputs, insertedByClass, mutatedByClass, "output", "mutation");
    return {
      inputs: totalInputs.filter((_, index) => inputRoles[index] === "input"),
      outputs: totalOutputs.filter((_, index) => outputRoles[index] === "output"),
      mutations: totalInputs.filter((_, index) => inputRoles[index] === "mutation"),
      opaqueInputs: totalInputs.filter((_, index) => inputRoles[index] === "opaque"),
      opaqueOutputs: totalOutputs.filter((_, index) => outputRoles[index] === "opaque"),
      classified: true,
    };
  }

  function actionProofWorkload(action) {
    const source = String(action.predicateSource || "");
    const sourceAvailable = Boolean(source.trim()) && !/AND\(\.\.\.\)/.test(source);
    if (!sourceAvailable) {
      return {
        sourceAvailable: false,
        complete: false,
        partial: false,
        coverage: "unknown",
        pow: {
          level: "Unknown",
          detail: "Predicate unavailable",
          callCount: null,
          knownCount: 0,
          unreadableCount: null,
          expectedAttempts: 0n,
          complete: false,
          coverage: "unknown",
        },
        vdf: {
          level: "Unknown",
          detail: "Predicate unavailable",
          callCount: null,
          knownCount: 0,
          literalCount: 0,
          invalidCount: 0,
          unreadableCount: null,
          totalIterations: 0n,
          complete: false,
          coverage: "unknown",
        },
      };
    }

    const vdfCalls = predicateCalls(source, "Vdf");
    const vdfIterations = vdfCalls.map((call) => splitPredicateArguments(call.argumentsSource)[0]);
    const literalVdfIterations = vdfIterations.filter((value) => /^-?\d+$/.test(value || "")).map((value) => BigInt(value));
    const invalidVdfCount = literalVdfIterations.filter((value) => value < 2n || value >= (1n << 32n)).length;
    const validVdfIterations = literalVdfIterations.filter((value) => value >= 2n && value < (1n << 32n));
    const vdfTotal = validVdfIterations.reduce((sum, value) => sum + value, 0n);
    const unreadableVdfCount = vdfCalls.length - literalVdfIterations.length;
    const vdfComplete = validVdfIterations.length === vdfCalls.length;
    const vdfCoverage = !vdfCalls.length
      ? "none"
      : vdfComplete
        ? "complete"
        : validVdfIterations.length
          ? "partial"
          : "unknown";
    const vdfLevel = !vdfCalls.length
      ? "None"
      : invalidVdfCount
        ? "Invalid"
        : literalVdfIterations.length !== vdfCalls.length
        ? "Unknown"
        : vdfTotal <= 5n
          ? "Short"
          : vdfTotal <= 20n
            ? "Medium"
            : "Long";

    const powCalls = predicateCalls(source, "LtEqU256");
    const powTargets = powCalls.map((call) => {
      const targetSource = splitPredicateArguments(call.argumentsSource)[1] || "";
      const target = predicateCalls(targetSource, "Raw")[0]?.argumentsSource.match(/^\s*0x([0-9a-fA-F]+)\s*$/)?.[1] || "";
      return target.length <= 64 ? target : "";
    });
    const readablePowTargets = powTargets.filter(Boolean);
    let expectedAttempts = 0n;
    for (const target of readablePowTargets) {
      const targetValue = BigInt(`0x${target.padStart(64, "0")}`);
      const denominator = targetValue + 1n;
      expectedAttempts += ((1n << 256n) + denominator - 1n) / denominator;
    }
    const powComplete = readablePowTargets.length === powCalls.length;
    const powCoverage = !powCalls.length
      ? "none"
      : powComplete
        ? "complete"
        : readablePowTargets.length
          ? "partial"
          : "unknown";
    const powLevel = !powCalls.length
      ? "None"
      : readablePowTargets.length !== powCalls.length
        ? "Unknown"
        : expectedAttempts <= 256n
          ? "Easy"
          : expectedAttempts <= 2048n
            ? "Medium"
            : expectedAttempts <= 4096n
              ? "Hard"
              : "Extreme";
    const expectedAttemptDetail = expectedAttempts <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Math.max(1, Number(expectedAttempts)).toLocaleString()
      : `>${Number.MAX_SAFE_INTEGER.toLocaleString()}`;
    const complete = powComplete && vdfComplete;
    const knownCount = readablePowTargets.length + validVdfIterations.length;
    const callCount = powCalls.length + vdfCalls.length;

    return {
      sourceAvailable: true,
      complete,
      partial: !complete && knownCount > 0,
      coverage: complete ? (callCount ? "complete" : "none") : knownCount ? "partial" : "unknown",
      pow: {
        level: powLevel,
        callCount: powCalls.length,
        knownCount: readablePowTargets.length,
        unreadableCount: powCalls.length - readablePowTargets.length,
        expectedAttempts,
        complete: powComplete,
        coverage: powCoverage,
        detail: !powCalls.length
          ? "No direct LtEq threshold"
          : readablePowTargets.length !== powCalls.length
            ? `${readablePowTargets.length} of ${powCalls.length} thresholds readable`
            : `~${expectedAttemptDetail} assumed search trials / ${powCalls.length} target${powCalls.length === 1 ? "" : "s"}`,
      },
      vdf: {
        level: vdfLevel,
        callCount: vdfCalls.length,
        knownCount: validVdfIterations.length,
        literalCount: literalVdfIterations.length,
        invalidCount: invalidVdfCount,
        unreadableCount: unreadableVdfCount,
        totalIterations: vdfTotal,
        complete: vdfComplete,
        coverage: vdfCoverage,
        detail: !vdfCalls.length
          ? "No direct VDF call"
          : invalidVdfCount
            ? `${invalidVdfCount} invalid literal count${invalidVdfCount === 1 ? "" : "s"} outside 2..2^32-1${literalVdfIterations.length !== vdfCalls.length ? " / additional unreadable count" : ""}`
            : literalVdfIterations.length !== vdfCalls.length
              ? `${literalVdfIterations.length} of ${vdfCalls.length} counts readable`
              : `${vdfCalls.length} call${vdfCalls.length === 1 ? "" : "s"} / ${vdfTotal.toLocaleString()} total recursive iterations`,
      },
    };
  }

  const PROOF_GATE_LEVEL_ORDER = Object.freeze({
    pow: Object.freeze({ None: 0, Easy: 1, Medium: 2, Unknown: 2.5, Hard: 3, Extreme: 4, Invalid: 5 }),
    vdf: Object.freeze({ None: 0, Short: 1, Medium: 2, Unknown: 2.5, Long: 3, Invalid: 4 }),
  });

  function proofGateTone(kind, level) {
    if (level === "Invalid" || (kind === "pow" && (level === "Hard" || level === "Extreme")) || (kind === "vdf" && level === "Long")) return "red";
    if (level === "Medium" || level === "Unknown") return "yellow";
    if ((kind === "pow" && (level === "None" || level === "Easy")) || (kind === "vdf" && (level === "None" || level === "Short"))) return "green";
    return "yellow";
  }

  function proofDifficultySummary(workloads, options = {}) {
    const entries = (Array.isArray(workloads) ? workloads : [workloads]).filter(Boolean);
    const inventory = Boolean(options.inventory);
    const producerCount = Number(options.producerCount ?? entries.length) || 0;
    const unknownReason = String(options.unknownReason || "producer metadata unavailable");
    const badge = (kind) => {
      const label = kind === "pow" ? "PoW" : "VDF";
      const glyph = kind === "pow" ? "⛏" : "⌛";
      if (inventory) {
        return { kind, label, glyph, level: "No action", tone: "green", title: `${label}: no action required; live inventory satisfies this plan.` };
      }
      if (!entries.length) {
        return { kind, label, glyph, level: "Unknown", tone: "yellow", title: `${label}: unknown; ${unknownReason}.` };
      }
      const order = PROOF_GATE_LEVEL_ORDER[kind];
      const candidates = entries.map((workload) => {
        const candidate = String(workload?.[kind]?.level || "Unknown");
        return Object.hasOwn(order, candidate) ? candidate : "Unknown";
      });
      const level = candidates.reduce((highest, candidate) =>
        (order[candidate] ?? order.Unknown) > (order[highest] ?? order.Unknown) ? candidate : highest,
      candidates[0] || "Unknown");
      const suffix = producerCount > 1 ? `; highest severity across ${producerCount} producing actions` : "";
      return { kind, label, glyph, level, tone: proofGateTone(kind, level), title: `${label}: ${level}${suffix}.` };
    };
    const badges = [badge("pow"), badge("vdf")];
    const producerSuffix = !inventory && producerCount > 1 ? `; highest of ${producerCount} producers` : "";
    const unknownSuffix = !inventory && !entries.length ? `; ${unknownReason}` : "";
    return { badges, text: `${badges.map((item) => `${item.label} ${item.level}`).join(", ")}${producerSuffix}${unknownSuffix}` };
  }

  function proofDifficultySvgMarkup(summary, x, y, gap = 3) {
    if (!summary?.badges?.length) return "";
    return `<g class="work-gate-badges" aria-hidden="true">${summary.badges.map((badge, index) => {
      const offsetY = y + index * (16 + gap);
      return `<g class="work-gate-badge is-${badge.tone}" transform="translate(${x} ${offsetY})"><title>${escapeHtml(badge.title)}</title><rect width="16" height="16"></rect><text class="work-gate-glyph" x="8" y="12" text-anchor="middle">${escapeHtml(badge.glyph)}</text></g>`;
    }).join("")}</g>`;
  }

  function finiteBigIntRatio(numerator, denominator) {
    if (typeof numerator !== "bigint" || typeof denominator !== "bigint" || denominator <= 0n || numerator < 0n) return null;
    const whole = numerator / denominator;
    const wholeNumber = Number(whole);
    if (!Number.isFinite(wholeNumber)) return Number.POSITIVE_INFINITY;
    return wholeNumber + Number(numerator % denominator) / Number(denominator);
  }

  function mineIronReferenceAttempts(cwi, action, workload) {
    if (
      cwi &&
      sameQualified(action?.action, HARDWARE_INDEX_ACTION) &&
      String(action?.hash || "") === cwi.actionHash &&
      workload?.pow?.complete &&
      workload.pow.expectedAttempts > 0n
    ) {
      return workload.pow.expectedAttempts;
    }
    const benchmark = mineIronBenchmarkAction();
    if (!benchmark || (cwi?.actionHash && benchmark.hash !== cwi.actionHash)) return null;
    const benchmarkWorkload = actionProofWorkload(benchmark);
    return benchmarkWorkload.pow.complete && benchmarkWorkload.pow.expectedAttempts > 0n
      ? benchmarkWorkload.pow.expectedAttempts
      : null;
  }

  // CWI-4 observes MineIron's complete Generate Proof window. The estimator scales
  // that machine-specific result with the readable proof gates and flattened I/O
  // shape, then adds commit and operational allowances. The calibration constants
  // come from craft-rocket's authored 1 s PoW / 5 s VDF scale and observed Driver
  // proof windows. Modeled work beyond the observed CWI baseline is empirically
  // corrected without altering that measured baseline or the commit allowance.
  function estimateActionProofTiming(
    action,
    cwiResult = currentHardwareIndex(),
    workload = actionProofWorkload(action),
  ) {
    const cwi = normalizeHardwareIndex(cwiResult);
    const hasCwi = Boolean(cwi);
    const benchmarkAction = Boolean(
      cwi &&
      sameQualified(action?.action, HARDWARE_INDEX_ACTION) &&
      String(action?.hash || "") === cwi.actionHash
    );
    const directWorkKnown = Boolean(workload.complete || (workload.pow.knownCount || 0) + (workload.vdf.knownCount || 0) > 0);
    const referenceAttempts = hasCwi ? mineIronReferenceAttempts(cwi, action, workload) : null;
    const powRatio = referenceAttempts ? finiteBigIntRatio(workload.pow.expectedAttempts || 0n, referenceAttempts) : null;
    const powWorkMilliseconds = powRatio == null ? 0 : powRatio * POW_REFERENCE_WORK_MS;
    const vdfIterations = Number(workload.vdf.totalIterations || 0n);
    const vdfWorkMilliseconds = Number.isFinite(vdfIterations)
      ? vdfIterations * VDF_ITERATION_WORK_MS
      : Number.POSITIVE_INFINITY;
    const directWorkMilliseconds = powWorkMilliseconds + vdfWorkMilliseconds;
    const totalInputs = Array.isArray(action?.totalInputs) ? action.totalInputs.length : 0;
    const totalOutputs = Array.isArray(action?.totalOutputs) ? action.totalOutputs.length : 0;
    const ioSlotCount = totalInputs + totalOutputs;
    const structuralWorkMilliseconds = Math.max(0, ioSlotCount - 1) * STRUCTURAL_SLOT_WORK_MS;
    const hardwareScale = hasCwi ? cwi.durationMs / WORK_ESTIMATOR_REFERENCE_CWI_MS : null;
    const extrapolationScale = hasCwi ? hardwareScale * WORK_ESTIMATOR_EXTRAPOLATION_FACTOR : null;
    const additionalDirectWorkMilliseconds = hasCwi
      ? Math.max(0, directWorkMilliseconds - POW_REFERENCE_WORK_MS) * extrapolationScale
      : null;
    const structuralProofMilliseconds = hasCwi ? structuralWorkMilliseconds * extrapolationScale : null;
    const proofMilliseconds = hasCwi
      ? cwi.durationMs + additionalDirectWorkMilliseconds + structuralProofMilliseconds
      : null;
    const commitAllowanceMilliseconds = ACTION_COMMIT_ALLOWANCE_MS;
    const nominalMilliseconds = hasCwi ? proofMilliseconds + commitAllowanceMilliseconds : null;
    const operationalAllowanceMilliseconds = hasCwi
      ? nominalMilliseconds * ACTION_OPERATIONAL_CONTINGENCY
      : null;
    const totalMilliseconds = hasCwi ? nominalMilliseconds + operationalAllowanceMilliseconds : null;
    const workloadComplete = Boolean(benchmarkAction || (workload.complete && referenceAttempts));
    return {
      workload,
      cwi,
      hasCwi,
      hasKnownWork: directWorkKnown || ioSlotCount > 0,
      directWorkKnown,
      requiresCwi: !hasCwi,
      complete: Boolean(hasCwi && workloadComplete),
      partial: Boolean(hasCwi && !workloadComplete),
      lowerBound: Boolean(hasCwi && !workloadComplete),
      coverage: hasCwi ? (benchmarkAction ? "observed" : workloadComplete ? "calibrated" : "lower-bound") : "unknown",
      estimateKind: hasCwi ? (benchmarkAction ? "observed" : workloadComplete ? "calibrated" : "lower-bound") : "unavailable",
      benchmarkAction,
      referenceAttempts,
      powRatio,
      ioSlotCount,
      hardwareScale,
      extrapolationScale,
      extrapolationFactor: WORK_ESTIMATOR_EXTRAPOLATION_FACTOR,
      directWorkMilliseconds,
      structuralWorkMilliseconds,
      additionalDirectWorkMilliseconds,
      structuralProofMilliseconds,
      proofMilliseconds,
      commitAllowanceMilliseconds,
      nominalMilliseconds,
      operationalAllowanceMilliseconds,
      operationalContingency: ACTION_OPERATIONAL_CONTINGENCY,
      totalMilliseconds,
      powMilliseconds: hasCwi && powRatio != null ? powWorkMilliseconds * extrapolationScale : null,
      vdfMilliseconds: hasCwi ? vdfWorkMilliseconds * extrapolationScale : null,
      powLowerBound: Boolean(!workload.pow.complete || !referenceAttempts),
      vdfLowerBound: Boolean(!workload.vdf.complete),
    };
  }

  function compactProofDurationNumber(value) {
    if (value === 0) return "0";
    if (value < 0.000000000001) return "0.000000000001";
    if (value < 1) {
      const decimals = Math.min(12, Math.max(3, Math.ceil(-Math.log10(value)) + 2));
      return value.toFixed(decimals).replace(/0+$/, "").replace(/\.$/, "");
    }
    if (value < 10) return value.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
    if (value < 100) return value.toFixed(1).replace(/\.0$/, "");
    return Math.round(value).toLocaleString();
  }

  function formatProofDuration(milliseconds) {
    if (milliseconds == null || Number.isNaN(milliseconds)) return "Unknown";
    if (!Number.isFinite(milliseconds)) return ">999 years";
    if (milliseconds < 0) return "Unknown";
    if (milliseconds === 0) return "0 sec";
    const seconds = milliseconds / 1000;
    if (seconds < 59.95) return `${compactProofDurationNumber(seconds)} sec`;
    if (seconds < 60) return "1 min";
    const minutes = seconds / 60;
    if (minutes < 59.95) return `${compactProofDurationNumber(minutes)} min`;
    if (minutes < 60) return "1 hr";
    const hours = minutes / 60;
    if (hours < 23.95) return `${compactProofDurationNumber(hours)} hr`;
    if (hours < 24) return "1 day";
    const days = hours / 24;
    if (days < 365.2) {
      const value = compactProofDurationNumber(days);
      return `${value} ${value === "1" ? "day" : "days"}`;
    }
    if (days < 365.25) return "1 year";
    const years = days / 365.25;
    if (years > 999) return ">999 years";
    const value = compactProofDurationNumber(years);
    return `${value} ${value === "1" ? "year" : "years"}`;
  }

  function mineIronBenchmarkAction() {
    return state.workspace.actions.find((item) => sameQualified(item.action, HARDWARE_INDEX_ACTION)) || null;
  }

  function mineIronBenchmarkPreflight(action) {
    if (!action?.hash) return "Install the craft-rocket cartridge with MineIron on this Driver before running CWI.";
    const inputs = Array.isArray(action.totalInputs) ? action.totalInputs : [];
    const outputs = Array.isArray(action.totalOutputs) ? action.totalOutputs : [];
    if (inputs.length !== 0) return "This MineIron build is not benchmark-safe: it declares input objects.";
    if (outputs.length !== 1 || !sameQualified(outputs[0]?.class, { pluginName: "craft-rocket", name: "Iron" })) {
      return "This MineIron build is not benchmark-safe: it must declare exactly one craft-rocket::Iron output.";
    }
    return "";
  }

  function hardwareIndexRunForConnection(connection = activeConnection()) {
    const key = hardwareIndexConnectionKey(connection);
    return key ? normalizeHardwareIndexRun(state.config.clientWorkIndexRuns?.[key]) : null;
  }

  function hardwareIndexPendingForConnection(connection = activeConnection()) {
    const run = hardwareIndexRunForConnection(connection);
    return run?.phase === "settled" ? null : run;
  }

  function hardwareIndexPendingHasRun(pending) {
    return Boolean(
      pending?.runId &&
      new Set(["accepted", "proof-running", "settling"]).has(pending.phase)
    );
  }

  function hardwareIndexPendingLockCopy(pending) {
    if (hardwareIndexPendingHasRun(pending)) {
      return `Run ${shortText(pending.runId)} was already accepted. Resume tracking it; do not start another benchmark.`;
    }
    return "A MineIron submission may already have reached this Driver, but no trustworthy run id was returned. The benchmark is locked to prevent a duplicate Iron; inspect Driver Activity before clearing local console data.";
  }

  function formatMineIronRate(result) {
    const value = Number(result?.mineIronProofsPerHour ?? result?.proofBaselinesPerHour ?? result?.mineIronPerHour);
    if (!Number.isFinite(value) || value <= 0) return "Unknown";
    return `${value < 10 ? value.toFixed(2) : value < 100 ? value.toFixed(1) : Math.round(value).toLocaleString()} proof baselines/hr`;
  }

  function hardwareIndexUiIsActive() {
    return state.hardwareIndex.status === "running" || state.hardwareIndex.status === "settling";
  }

  function hardwareIndexProgressElapsedMs(progress = state.hardwareIndex.progress) {
    const frozenDuration = Number(currentHardwareIndex()?.durationMs);
    if (state.hardwareIndex.status === "settling" && Number.isFinite(frozenDuration)) {
      return Math.max(0, frozenDuration);
    }
    const startedAt = progress?.proofStartedAt ? new Date(progress.proofStartedAt).valueOf() : NaN;
    const completedAt = progress?.proofCompletedAt ? new Date(progress.proofCompletedAt).valueOf() : NaN;
    if (Number.isFinite(startedAt)) {
      return Math.max(0, (Number.isFinite(completedAt) ? completedAt : Date.now()) - startedAt);
    }
    return Math.max(0, Number(progress?.elapsedMs) || 0);
  }

  function hardwareIndexProgressTimeLabel(progress, elapsedMs) {
    if (state.hardwareIndex.status === "settling" || progress?.proofCompletedAt) return `${formatProofDuration(elapsedMs)} proof / frozen`;
    if (!progress?.proofStartedAt) return "Waiting to start";
    return `${formatProofDuration(elapsedMs)} elapsed`;
  }

  function hardwareIndexProgressAriaValue(progress, phase, elapsedMs) {
    if (state.hardwareIndex.status === "settling" || progress?.proofCompletedAt) {
      return `Proof measurement complete at ${formatProofDuration(elapsedMs)}. MineIron settlement continues outside CWI.`;
    }
    if (!progress?.proofStartedAt) return `${phase}. Waiting for the proof timing start event.`;
    return `${phase}. Generate Proof timing is active.`;
  }

  function hardwareIndexProgressAnnouncement(progress, phase, elapsedMs) {
    if (state.hardwareIndex.status === "settling" || progress?.proofCompletedAt) {
      return `CWI proof timing complete at ${formatProofDuration(elapsedMs)}. The timer is frozen. MineIron settlement continues and is excluded from CWI.`;
    }
    if (!progress?.proofStartedAt) {
      return `${phase}. Waiting for Driver event generateProof running, message Generating proof.`;
    }
    return `${phase}. CWI timing started at Driver event generateProof running, message Generating proof.`;
  }

  function hardwareIndexProgressDetail(progress = state.hardwareIndex.progress) {
    const message = String(progress?.message || "Waiting for retained Driver state.");
    if (state.hardwareIndex.status === "settling" || progress?.proofCompletedAt) {
      return `${message} CWI is frozen at the Generate Proof stop event. Commit continues in Activity and is excluded from the score.`;
    }
    return `${message} CWI starts at generateProof/running with message "Generating proof" and stops at generateProof/done with message "Proof generation complete". Commit is excluded; closing this page does not cancel the submitted MineIron.`;
  }

  function hardwareIndexProgressMarkup(extraClass = "") {
    const progress = state.hardwareIndex.progress || {};
    const elapsedMs = hardwareIndexProgressElapsedMs(progress);
    const phase = String(progress.phase || "Starting MineIron action");
    const status = String(state.hardwareIndex.status || "idle");
    const timingPhase = progress.proofCompletedAt ? "proof-complete" : progress.proofStartedAt ? "proof-running" : "waiting";
    const phaseKey = `${status}:${timingPhase}:${phase}`;
    const settlingClass = status === "settling" ? " is-settling" : "";
    return `
      <div class="cwi-progress${settlingClass}${extraClass ? ` ${extraClass}` : ""}">
        <div class="cwi-progress-copy"><span data-cwi-progress-phase>${escapeHtml(phase)}</span><strong data-cwi-progress-time>${escapeHtml(hardwareIndexProgressTimeLabel(progress, elapsedMs))}</strong></div>
        <progress data-cwi-progress-meter data-cwi-progress-meter-phase="${escapeHtml(phaseKey)}" aria-label="${status === "settling" ? "MineIron settlement after client work index measurement" : "Client work index proof measurement in progress"}" aria-valuetext="${escapeHtml(hardwareIndexProgressAriaValue(progress, phase, elapsedMs))}"></progress>
        <small data-cwi-progress-detail>${escapeHtml(hardwareIndexProgressDetail(progress))}</small>
        <span class="sr-only" data-cwi-progress-announcement data-cwi-announced-phase="${escapeHtml(phaseKey)}" role="status" aria-live="polite" aria-atomic="true">${escapeHtml(hardwareIndexProgressAnnouncement(progress, phase, elapsedMs))}</span>
      </div>`;
  }

  function updateHardwareIndexProgressUi() {
    if (!hardwareIndexUiIsActive()) return;
    const progress = state.hardwareIndex.progress || {};
    const elapsedMs = hardwareIndexProgressElapsedMs(progress);
    const phase = String(progress.phase || "Following MineIron action");
    const timingPhase = progress.proofCompletedAt ? "proof-complete" : progress.proofStartedAt ? "proof-running" : "waiting";
    const phaseKey = `${state.hardwareIndex.status}:${timingPhase}:${phase}`;
    document.querySelectorAll("[data-cwi-progress-meter]").forEach((meter) => {
      meter.removeAttribute("value");
      if (meter.dataset.cwiProgressMeterPhase !== phaseKey) {
        meter.dataset.cwiProgressMeterPhase = phaseKey;
        meter.setAttribute("aria-valuetext", hardwareIndexProgressAriaValue(progress, phase, elapsedMs));
      }
    });
    document.querySelectorAll("[data-cwi-progress-phase]").forEach((element) => { element.textContent = phase; });
    document.querySelectorAll("[data-cwi-progress-time]").forEach((element) => {
      element.textContent = hardwareIndexProgressTimeLabel(progress, elapsedMs);
    });
    document.querySelectorAll("[data-cwi-progress-detail]").forEach((element) => {
      element.textContent = hardwareIndexProgressDetail(progress);
    });
    document.querySelectorAll("[data-cwi-progress-announcement]").forEach((element) => {
      if (element.dataset.cwiAnnouncedPhase === phaseKey) return;
      element.dataset.cwiAnnouncedPhase = phaseKey;
      element.textContent = hardwareIndexProgressAnnouncement(progress, phase, elapsedMs);
    });
  }

  function homeHardwareIndexContentMarkup() {
    const benchmark = state.hardwareIndex;
    const result = currentHardwareIndex();
    const pending = hardwareIndexPendingForConnection();
    const measuring = benchmark.status === "running";
    const settling = benchmark.status === "settling";
    const active = measuring || settling;
    const failed = benchmark.status === "error" && !result;
    const activeRunName = benchmark.activeRun?.connectionName || activeConnection()?.name || "selected Driver";
    const title = settling
      ? result ? `${HARDWARE_INDEX_LABEL} / ${formatProofDuration(result.durationMs)} measured` : "MineIron settling / no CWI saved"
      : measuring
        ? `Measuring MineIron proof on ${activeRunName}`
      : result
        ? `${HARDWARE_INDEX_LABEL} / ${formatProofDuration(result.durationMs)}`
        : pending
          ? hardwareIndexPendingHasRun(pending) ? "MineIron run needs tracking" : "MineIron outcome needs review"
          : failed
            ? "Driver check needs attention"
            : "Driver index not measured";
    const copy = settling
      ? result
        ? `Generate Proof timing is frozen at ${formatProofDuration(result.durationMs)}. MineIron settlement continues in Activity; commit is excluded from ${HARDWARE_INDEX_LABEL}.`
        : `The exact Generate Proof timing window was not available, so no score was fabricated. MineIron settlement continues in Activity.`
      : measuring
        ? `Timing generateProof/running "Generating proof" through generateProof/done "Proof generation complete". Commit is excluded.`
      : result
        ? `${formatMineIronRate(result)} / higher is faster / commit excluded / ${benchmark.persistent ? "saved locally" : "this tab only"}.`
        : pending
          ? hardwareIndexPendingLockCopy(pending)
          : failed
            ? benchmark.error
            : `Measure one real craft-rocket::MineIron Generate Proof window on the selected Driver. Settlement continues separately and may keep one Iron.`;
    let button;
    if (active) {
      button = `<button class="game-button menu-focusable" type="button" data-hardware-index-focus aria-disabled="true" aria-describedby="home-cwi-help">${settling ? "Settlement in progress" : "Measurement in progress"}</button>`;
    } else if (result) {
      button = '<button class="game-button menu-focusable" type="button" data-command="config" data-hardware-index-focus aria-label="Open client work index details">View details</button>';
    } else if (pending && !hardwareIndexPendingHasRun(pending)) {
      button = '<button class="game-button menu-focusable" type="button" data-command="activity" data-hardware-index-focus aria-describedby="home-cwi-help">Review Activity</button>';
    } else {
      const buttonText = pending ? "Resume" : failed ? "Retry CWI" : "Run proof test";
      button = `<button class="game-button menu-focusable" type="button" data-command="run-hardware-index" data-hardware-index-focus aria-describedby="home-cwi-help">${buttonText}</button>`;
    }
    return `
      <span class="home-cwi-mark" aria-hidden="true">CWI</span>
      <div class="home-cwi-copy">
        <span class="home-cwi-kicker">Selected Driver proof baseline</span>
        <h2 id="home-cwi-title">${escapeHtml(title)}</h2>
        <p id="home-cwi-help">${escapeHtml(copy)}</p>
        ${active ? hardwareIndexProgressMarkup("home-cwi-track") : ""}
      </div>
      ${button}`;
  }

  function homeHardwareIndexRegionMarkup() {
    return `
      <section class="home-cwi-prompt" id="home-cwi-prompt" tabindex="-1" data-hardware-index data-hardware-index-view="home" data-cwi-state="${state.hardwareIndex.status}" aria-labelledby="home-cwi-title">
        <span class="sr-only" data-hardware-index-announcement aria-live="polite" aria-atomic="true">${escapeHtml(hardwareIndexAnnouncement())}</span>
        <div class="home-cwi-content" data-hardware-index-content>${homeHardwareIndexContentMarkup()}</div>
      </section>`;
  }

  function hardwareIndexContentMarkup() {
    const benchmark = state.hardwareIndex;
    const result = currentHardwareIndex();
    const pending = hardwareIndexPendingForConnection();
    const measuring = benchmark.status === "running";
    const settling = benchmark.status === "settling";
    const active = measuring || settling;
    const buttonLabel = measuring
      ? "Measurement in progress"
      : settling
        ? "Settlement in progress"
      : pending
        ? hardwareIndexPendingHasRun(pending) ? "Resume tracking" : "Submission locked"
        : result
          ? "Measure another MineIron"
          : "Measure MineIron proof";
    const buttonMarkup = active
      ? `<button class="game-button" type="button" data-hardware-index-focus aria-disabled="true">${buttonLabel}</button>`
      : pending && !hardwareIndexPendingHasRun(pending)
        ? '<button class="game-button" type="button" data-command="activity" data-hardware-index-focus>Review Activity</button>'
      : `<button class="game-button" type="button" data-command="run-hardware-index" data-hardware-index-focus>${buttonLabel}</button>`;
    let readout;
    if (measuring) {
      const activeRun = benchmark.activeRun;
      readout = `
        <div class="hardware-index-score is-running"><span>Client work index / Generate Proof window</span><strong>${HARDWARE_INDEX_LABEL} MEASURE</strong><small>${escapeHtml(activeRun?.connectionName || "Driver")} / generateProof/running "Generating proof" → generateProof/done "Proof generation complete"</small></div>
        ${hardwareIndexProgressMarkup("hardware-index-track")}`;
    } else if (result) {
      const resultNote = benchmark.status === "error"
        ? `Last saved result retained / tracking failed: ${benchmark.error}`
        : settling
          ? `proof timing saved / MineIron settlement continues in Activity / commit excluded`
          : `${benchmark.persistent ? "saved locally" : "this tab only"} / measured ${formatDate(result.measuredAt)}`;
      const settlementStatus = settling ? "pending" : String(result.settlementStatus || "unknown");
      const settlementLabel = settlementStatus === "pending"
        ? "Continuing in Activity"
        : settlementStatus === "succeeded"
          ? "Succeeded"
          : settlementStatus === "failed"
            ? "Failed"
            : "Not recorded";
      const settlementDetail = result.settlementError
        ? `run ${shortText(result.runId)} / ${result.settlementError}`
        : `run ${shortText(result.runId)} / excluded from ${HARDWARE_INDEX_LABEL}`;
      const timingSourceLabel = {
        "live-run-sse": "live Driver progress events",
        "resumed-client-clock": "resumed client observation",
        "poll-observed": "polled Driver progress",
      }[result.timingSource] || "timing source unavailable";
      readout = `
        <div class="hardware-index-score${settling ? " is-settling" : ""}"><span>Client work index / observed Generate Proof window</span><strong>${escapeHtml(formatProofDuration(result.durationMs))}</strong><small class="hardware-index-result-note${benchmark.status === "error" ? " is-error" : ""}">${escapeHtml(resultNote)}</small></div>
        <dl class="hardware-index-metrics">
          <div><dt>Proof throughput</dt><dd><strong>${escapeHtml(formatMineIronRate(result))}</strong><small>higher is faster / one hour ÷ observed proof duration / not a percentile or synthetic score</small></dd></div>
          <div><dt>Observed window</dt><dd><strong>craft-rocket::MineIron</strong><small>generateProof/running "Generating proof" → generateProof/done "Proof generation complete"</small></dd></div>
          <div><dt>Driver binding</dt><dd><strong>${escapeHtml(result.driverVersion || "Version unavailable")}</strong><small>${escapeHtml(result.driverUrl)} / action ${escapeHtml(shortText(result.actionHash, 10, 7))} / ${escapeHtml(timingSourceLabel)}</small></dd></div>
          <div><dt>Action settlement</dt><dd><strong>${escapeHtml(settlementLabel)}</strong><small>${escapeHtml(settlementDetail)}</small></dd></div>
        </dl>
        ${settling ? hardwareIndexProgressMarkup("hardware-index-track") : ""}`;
    } else if (settling) {
      readout = `
        <div class="hardware-index-score is-error"><span>Client work index / Generate Proof window</span><strong>${HARDWARE_INDEX_LABEL} --</strong><small>No trustworthy start-to-stop window was captured, so no score was saved. MineIron settlement continues and remains excluded.</small></div>
        ${hardwareIndexProgressMarkup("hardware-index-track")}`;
    } else {
      const emptyDetail = pending
        ? hardwareIndexPendingHasRun(pending)
          ? `Accepted run ${shortText(pending.runId)} is saved locally and must be followed to completion.`
          : hardwareIndexPendingLockCopy(pending)
        : benchmark.error || "No completed MineIron benchmark for this Driver and action build.";
      readout = `
        <div class="hardware-index-score${benchmark.status === "error" ? " is-error" : ""}">
          <span>Client work index / selected Driver proof window</span><strong>${HARDWARE_INDEX_LABEL} --</strong><small>${escapeHtml(emptyDetail)}</small>
        </div>`;
    }
    return `
      <div class="hardware-index-heading">
        ${readout}
        ${buttonMarkup}
      </div>
      <p class="hardware-index-note"><strong>${HARDWARE_INDEX_LABEL}</strong> measures one exact Driver event window: <code>generateProof/running</code> with message <code>Generating proof</code> through <code>generateProof/done</code> with message <code>Proof generation complete</code>. Transaction submission, commit, confirmation, and live-output verification are excluded. The submitted MineIron still settles and may create one retained Iron. Proof baselines/hr is one hour divided by the observed proof duration, so higher is faster when the Driver version and MineIron action hash match. Action and planner estimates scale this baseline with PoW, VDF, and I/O workload, then add ${escapeHtml(formatProofDuration(ACTION_COMMIT_ALLOWANCE_MS))} for commit and a ${Math.round(ACTION_OPERATIONAL_CONTINGENCY * 100)}% operational allowance per action.</p>`;
  }

  function hardwareIndexAnnouncement() {
    const benchmark = state.hardwareIndex;
    const result = currentHardwareIndex();
    const pending = hardwareIndexPendingForConnection();
    if (benchmark.status === "settling" && result) return `Client work index proof timing complete at ${formatProofDuration(result.durationMs)}. The timer is frozen. MineIron settlement continues and is excluded from the score.`;
    if (benchmark.status === "settling") return "No trustworthy Generate Proof timing window was captured. No score was saved. MineIron settlement continues outside CWI.";
    if (benchmark.status === "running") {
      const progress = benchmark.progress || {};
      return progress.proofStartedAt
        ? `Client work index Generate Proof measurement is in progress. ${formatProofDuration(hardwareIndexProgressElapsedMs(progress))} elapsed. Commit will be excluded.`
        : `MineIron was accepted. Waiting for generateProof/running with message Generating proof before starting the CWI timer.`;
    }
    if (benchmark.status === "error" && result) return `Client work index tracking failed. The last observed Generate Proof window of ${formatProofDuration(result.durationMs)} is retained. ${benchmark.error}`;
    if (benchmark.status === "error") return `Client work index failed. ${benchmark.error}`;
    if (pending) return hardwareIndexPendingHasRun(pending)
      ? `A previously accepted MineIron benchmark run is waiting to be tracked. Run id ${pending.runId}.`
      : hardwareIndexPendingLockCopy(pending);
    if (result) return `Client work index ready. The observed MineIron Generate Proof window took ${formatProofDuration(result.durationMs)} on the selected Driver. Commit was excluded. ${benchmark.persistent ? "Saved locally." : "Available for this tab only."}`;
    return "";
  }

  function patchHardwareIndex() {
    const focusReturnPending = state.hardwareIndex.restoreFocus && state.hardwareIndex.status !== "running";
    const focusedElement = document.activeElement;
    const focusedInIndex = focusedElement?.closest?.("[data-hardware-index]");
    const focusedControlWillBeReplaced = Boolean(focusedInIndex && focusedElement !== focusedInIndex);
    const focusRunningStatus = Boolean(
      state.hardwareIndex.restoreFocus &&
      state.hardwareIndex.status === "running" &&
      focusedInIndex
    );
    const restoreFocus = focusReturnPending && (
      !focusedElement ||
      focusedElement === document.body ||
      focusedElement === document.documentElement ||
      !focusedElement.isConnected ||
      focusedInIndex
    );
    let removedFocusedHome = false;
    document.querySelectorAll("[data-hardware-index]").forEach((region) => {
      const view = region.dataset.hardwareIndexView;
      if (view === "home" && currentHardwareIndex() && !hardwareIndexUiIsActive()) {
        removedFocusedHome ||= focusedInIndex === region;
        region.remove();
        return;
      }
      const content = region.querySelector("[data-hardware-index-content]");
      const announcement = region.querySelector("[data-hardware-index-announcement]");
      const proofAction = view === "action-proof" ? actionByKey(region.dataset.actionKey || "") : null;
      if (content) {
        content.innerHTML = view === "home"
          ? homeHardwareIndexContentMarkup()
          : view === "action-proof" && proofAction
            ? actionProofRequirementsContentMarkup(proofAction)
            : hardwareIndexContentMarkup();
      }
      if (announcement) {
        announcement.textContent = view === "action-proof" && proofAction
          ? actionProofTimingAnnouncement(proofAction)
          : hardwareIndexAnnouncement();
      }
      region.dataset.cwiState = state.hardwareIndex.status;
    });
    if (focusRunningStatus) {
      requestAnimationFrame(() => {
        focusedInIndex.querySelector("[data-hardware-index-focus]")?.focus({ preventScroll: true });
      });
    }
    if (focusReturnPending) state.hardwareIndex.restoreFocus = false;
    const restorePatchedControl = focusedControlWillBeReplaced && !removedFocusedHome && state.hardwareIndex.status !== "running";
    if (restoreFocus || removedFocusedHome || restorePatchedControl) {
      requestAnimationFrame(() => {
        const button = removedFocusedHome
          ? document.querySelector(".home-menu-list .menu-focusable")
          : document.querySelector("[data-hardware-index] [data-hardware-index-focus]");
        const target = button && !button.disabled
          ? button
          : !removedFocusedHome && focusedInIndex?.isConnected
            ? focusedInIndex
            : null;
        target?.focus({ preventScroll: true });
      });
    }
    if (state.screen === "planner") patchPlanner({ replan: false });
  }

  function hardwareIndexRunPhase(snapshot) {
    const status = String(snapshot?.status || "queued").toLowerCase();
    if (status === "generateproof" || status === "running") return "Generate Proof in progress";
    if (status === "committing") return "MineIron settlement continuing";
    if (status === "succeeded") return "MineIron settlement complete";
    if (status === "failed") return "MineIron action failed";
    return "Waiting for Generate Proof";
  }

  function hardwareIndexRunMatchesCurrentWorkspace(run) {
    const connection = activeConnection();
    return Boolean(
      connection &&
      state.workspace.connectionId === connection.id &&
      connection.id === run.connectionId &&
      hardwareIndexConnectionKey(connection) === run.driverUrl
    );
  }

  function hardwareIndexRunConnection(run) {
    return {
      id: run.connectionId || `cwi-${run.driverUrl}`,
      name: run.connectionName || "Benchmark Driver",
      driverUrl: run.driverUrl,
    };
  }

  function validateHardwareIndexRunSnapshot(snapshot, run) {
    if (!snapshot || typeof snapshot !== "object") throw new Error("The Driver returned an invalid benchmark run snapshot.");
    if (String(snapshot.runId || "") !== run.runId) {
      throw new Error(`The Driver returned run ${shortText(snapshot.runId)} while tracking ${shortText(run.runId)}; the benchmark remains locked.`);
    }
    if (!sameQualified(snapshot.action, HARDWARE_INDEX_ACTION)) {
      throw new Error(`Run ${shortText(run.runId)} does not identify craft-rocket::MineIron; the benchmark remains locked.`);
    }
    return snapshot;
  }

  function hardwareIndexProgressMatches(progress, expected) {
    return Boolean(
      progress &&
      progress.phase === expected.phase &&
      progress.status === expected.status &&
      progress.message === expected.message
    );
  }

  function hardwareIndexProgressEntries(snapshot, observedAt = new Date().toISOString()) {
    return (Array.isArray(snapshot?.progress) ? snapshot.progress : []).map((progress, index) => ({
      index,
      progress,
      observedAt,
    }));
  }

  function updateHardwareIndexProgressState(run, progress, snapshot = null) {
    const latest = progress || (Array.isArray(snapshot?.progress) && snapshot.progress.length
      ? snapshot.progress[snapshot.progress.length - 1]
      : null);
    state.hardwareIndex.activeRun = run;
    state.hardwareIndex.progress = {
      phase: run.phase === "settling"
        ? "Proof timing complete / settlement continuing"
        : run.phase === "proof-running"
          ? "Generate Proof timing active"
          : hardwareIndexRunPhase(snapshot),
      message: String(latest?.message || (run.proofStartedAt ? "Generate Proof timing is active." : "Waiting for the exact Generating proof event.")).slice(0, 300),
      proofStartedAt: run.proofStartedAt,
      proofCompletedAt: run.proofCompletedAt,
      elapsedMs: run.proofStartedAt ? Math.max(0, Date.now() - new Date(run.proofStartedAt).valueOf()) : 0,
    };
    updateHardwareIndexProgressUi();
  }

  function markHardwareIndexMeasurementUnavailable(run, message, lastProgressIndex = run.lastProgressIndex) {
    return normalizeHardwareIndexRun({
      ...run,
      phase: "settling",
      lastProgressIndex,
      measurementError: message,
    });
  }

  function observeHardwareIndexProgressBatch(run, entries, { replayBatch = false, timingSource = "poll-observed" } = {}) {
    let current = normalizeHardwareIndexRun(run);
    if (!current) throw new Error("The retained MineIron benchmark record is invalid.");
    const unseen = entries
      .filter((entry) => Number.isInteger(entry.index) && entry.index > current.lastProgressIndex)
      .sort((left, right) => left.index - right.index);
    if (!unseen.length) return { kind: "waiting", run: current, latest: null };
    if (unseen[0].index > current.lastProgressIndex + 1) return { kind: "recover", run: current, latest: null };

    const startedBeforeBatch = Boolean(current.proofStartedAt);
    const startEntry = unseen.find((entry) => hardwareIndexProgressMatches(entry.progress, HARDWARE_INDEX_PROOF_START));
    const stopEntry = unseen.find((entry) => hardwareIndexProgressMatches(entry.progress, HARDWARE_INDEX_PROOF_STOP));
    if (
      replayBatch &&
      !startedBeforeBatch &&
      startEntry &&
      stopEntry &&
      stopEntry.index > startEntry.index
    ) {
      const lastProgressIndex = unseen[unseen.length - 1].index;
      current = markHardwareIndexMeasurementUnavailable(
        current,
        "The Generate Proof start and stop were both already buffered before live timing began. No CWI score was fabricated.",
        lastProgressIndex,
      );
      if (!current) throw new Error("The unmeasurable MineIron run could not be retained safely.");
      persistHardwareIndexRun(current);
      return { kind: "inconclusive", run: current, latest: unseen[unseen.length - 1].progress };
    }

    let kind = "waiting";
    let latest = null;
    for (const entry of unseen) {
      if (entry.index > current.lastProgressIndex + 1) return { kind: "recover", run: current, latest };
      const progress = entry.progress;
      if (String(progress?.runId || current.runId) !== current.runId) {
        throw new Error(`The Driver mixed progress from another run into ${shortText(current.runId)}; CWI remains locked.`);
      }
      latest = progress;
      const observedAt = String(entry.observedAt || new Date().toISOString());
      if (hardwareIndexProgressMatches(progress, HARDWARE_INDEX_PROOF_START) && !current.proofStartedAt) {
        current = normalizeHardwareIndexRun({
          ...current,
          phase: "proof-running",
          proofStartedAt: observedAt,
          proofStartProgressIndex: entry.index,
          lastProgressIndex: entry.index,
          timingSource,
        });
        kind = "started";
      } else if (hardwareIndexProgressMatches(progress, HARDWARE_INDEX_PROOF_STOP)) {
        if (!current.proofStartedAt || current.proofStartProgressIndex < 0) {
          current = markHardwareIndexMeasurementUnavailable(
            current,
            "Proof generation completed without a previously observed Generating proof start event. No CWI score was fabricated.",
            entry.index,
          );
          kind = "inconclusive";
        } else {
          const startedTimestamp = new Date(current.proofStartedAt).valueOf();
          const observedTimestamp = new Date(observedAt).valueOf();
          const completedTimestamp = Math.max(startedTimestamp + 1, observedTimestamp);
          current = normalizeHardwareIndexRun({
            ...current,
            phase: "settling",
            proofCompletedAt: new Date(completedTimestamp).toISOString(),
            proofStopProgressIndex: entry.index,
            lastProgressIndex: entry.index,
            timingSource: current.timingSource || timingSource,
          });
          kind = "complete";
        }
      } else {
        current = normalizeHardwareIndexRun({ ...current, lastProgressIndex: entry.index });
      }
      if (!current) throw new Error("The MineIron proof observation could not be recorded safely.");
      if (kind === "complete" || kind === "inconclusive") break;
    }
    if (kind !== "complete") persistHardwareIndexRun(current);
    return { kind, run: current, latest };
  }

  function createHardwareIndexProofStream(run) {
    if (typeof EventSource !== "function") return null;
    const connection = hardwareIndexRunConnection(run);
    const queue = [];
    const waiters = new Set();
    let failed = false;
    let source;
    const wake = () => {
      for (const waiter of waiters) waiter();
      waiters.clear();
    };
    try {
      source = new EventSource(endpointUrl(connection, `/actions/runs/${encodeURIComponent(run.runId)}/events`), { withCredentials: false });
    } catch {
      return null;
    }
    source.onmessage = (event) => {
      let progress;
      try {
        progress = JSON.parse(event.data);
      } catch {
        failed = true;
        wake();
        return;
      }
      const id = String(event.lastEventId ?? "");
      if (!/^\d+$/.test(id)) {
        failed = true;
        wake();
        return;
      }
      queue.push({ index: Number(id), progress, observedAt: new Date().toISOString() });
      wake();
    };
    source.onerror = () => {
      failed = true;
      wake();
    };
    return {
      drain() {
        return queue.splice(0, queue.length);
      },
      async next(timeoutMs) {
        if (queue.length || failed) return { entries: this.drain(), failed };
        await new Promise((resolve) => {
          let timer = null;
          const done = () => {
            if (timer) clearTimeout(timer);
            waiters.delete(done);
            resolve();
          };
          waiters.add(done);
          timer = setTimeout(done, timeoutMs);
        });
        return { entries: this.drain(), failed };
      },
      close() {
        source.close();
        wake();
      },
      get failed() {
        return failed;
      },
      source,
    };
  }

  function buildHardwareIndexProofResult(run) {
    const startedTimestamp = new Date(run.proofStartedAt || "").valueOf();
    const completedTimestamp = new Date(run.proofCompletedAt || "").valueOf();
    return normalizeHardwareIndex({
      version: HARDWARE_INDEX_VERSION,
      benchmarkId: HARDWARE_INDEX_BENCHMARK_ID,
      scope: HARDWARE_INDEX_SCOPE,
      algorithm: HARDWARE_INDEX_ALGORITHM,
      driverUrl: run.driverUrl,
      driverVersion: run.driverVersion,
      action: HARDWARE_INDEX_ACTION,
      actionHash: run.actionHash,
      runId: run.runId,
      durationMs: completedTimestamp - startedTimestamp,
      requestedAt: run.requestedAt,
      acceptedAt: run.acceptedAt,
      proofStartedAt: run.proofStartedAt,
      proofCompletedAt: run.proofCompletedAt,
      timingSource: run.timingSource,
      proofStartProgressIndex: run.proofStartProgressIndex,
      proofStopProgressIndex: run.proofStopProgressIndex,
      settlementStatus: "pending",
    });
  }

  function persistHardwareIndexMeasurement(result, run) {
    state.config.clientWorkIndexes[result.driverUrl] = result;
    state.config.clientWorkIndexRuns[run.driverUrl] = run;
    state.hardwareIndex.result = result;
    return persistConfig(false, false);
  }

  async function readHardwareIndexRunSnapshot(run) {
    const connection = hardwareIndexRunConnection(run);
    const snapshot = validateHardwareIndexRunSnapshot(
      await driverRequest(connection, `/actions/runs/${encodeURIComponent(run.runId)}`, { timeout: 10000 }),
      run,
    );
    if (hardwareIndexRunMatchesCurrentWorkspace(run)) {
      mergeRun(snapshot);
      scheduleLivePatch({ activity: true, runId: run.runId });
    }
    return snapshot;
  }

  function terminalHardwareIndexStatus(snapshot) {
    const status = String(snapshot?.status || "").toLowerCase();
    return TERMINAL_RUNS.has(status) ? status : "";
  }

  async function followHardwareIndexRun(run, token) {
    let current = normalizeHardwareIndexRun(run);
    if (!current) throw new Error("The retained MineIron benchmark record is invalid.");
    let stream = createHardwareIndexProofStream(current);
    if (stream) state.hardwareIndex.proofEventSource = stream.source;
    const deadline = Date.now() + HARDWARE_INDEX_MAX_RUN_MS;
    let snapshot = null;
    try {
      snapshot = await readHardwareIndexRunSnapshot(current);
      let outcome = observeHardwareIndexProgressBatch(current, hardwareIndexProgressEntries(snapshot), {
        replayBatch: true,
        timingSource: current.proofStartedAt ? "resumed-client-clock" : "poll-observed",
      });
      current = outcome.run;
      updateHardwareIndexProgressState(current, outcome.latest, snapshot);
      if (outcome.kind === "complete" || outcome.kind === "inconclusive") return { ...outcome, snapshot };
      if (terminalHardwareIndexStatus(snapshot)) {
        current = markHardwareIndexMeasurementUnavailable(
          current,
          current.measurementError || "The MineIron run ended before a trustworthy Generate Proof stop event was observed.",
          Math.max(current.lastProgressIndex, (snapshot.progress?.length || 0) - 1),
        );
        if (current) persistHardwareIndexRun(current);
        return { kind: "inconclusive", run: current, snapshot };
      }

      if (stream) {
        const buffered = stream.drain();
        if (buffered.length) {
          outcome = observeHardwareIndexProgressBatch(current, buffered, {
            replayBatch: true,
            timingSource: current.proofStartedAt ? "resumed-client-clock" : "live-run-sse",
          });
          current = outcome.run;
          updateHardwareIndexProgressState(current, outcome.latest, snapshot);
          if (outcome.kind === "complete" || outcome.kind === "inconclusive") return { ...outcome, snapshot };
        }
      }

      while (Date.now() < deadline) {
        if (token !== state.hardwareIndex.runToken) throw new Error("Benchmark tracking was superseded in this tab.");
        let entries = [];
        let recover = !stream;
        if (stream) {
          const next = await stream.next(5_000);
          entries = next.entries;
          recover = next.failed || !entries.length;
        } else {
          await new Promise((resolve) => setTimeout(resolve, HARDWARE_INDEX_POLL_MS));
        }
        if (entries.length) {
          outcome = observeHardwareIndexProgressBatch(current, entries, { timingSource: "live-run-sse" });
          current = outcome.run;
          updateHardwareIndexProgressState(current, outcome.latest, snapshot);
          if (outcome.kind === "complete" || outcome.kind === "inconclusive") return { ...outcome, snapshot };
          recover ||= outcome.kind === "recover";
        }
        if (!recover) continue;
        snapshot = await readHardwareIndexRunSnapshot(current);
        outcome = observeHardwareIndexProgressBatch(current, hardwareIndexProgressEntries(snapshot), {
          replayBatch: true,
          timingSource: current.proofStartedAt ? "resumed-client-clock" : "poll-observed",
        });
        current = outcome.run;
        updateHardwareIndexProgressState(current, outcome.latest, snapshot);
        if (outcome.kind === "complete" || outcome.kind === "inconclusive") return { ...outcome, snapshot };
        if (terminalHardwareIndexStatus(snapshot)) {
          current = markHardwareIndexMeasurementUnavailable(
            current,
            current.measurementError || "The MineIron run ended before a trustworthy Generate Proof stop event was observed.",
            Math.max(current.lastProgressIndex, (snapshot.progress?.length || 0) - 1),
          );
          if (current) persistHardwareIndexRun(current);
          return { kind: "inconclusive", run: current, snapshot };
        }
        if (stream?.failed) {
          stream.close();
          if (state.hardwareIndex.proofEventSource === stream.source) state.hardwareIndex.proofEventSource = null;
          stream = null;
        }
      }
      throw new Error(`The exact Generate Proof stop event was not observed within ${formatProofDuration(HARDWARE_INDEX_MAX_RUN_MS)}. The run id and any observed start are saved; resume this run instead of submitting another Iron.`);
    } finally {
      stream?.close();
      if (state.hardwareIndex.proofEventSource === stream?.source) state.hardwareIndex.proofEventSource = null;
    }
  }

  function persistHardwareIndexTerminal(run, snapshot) {
    const terminalStatus = terminalHardwareIndexStatus(snapshot);
    if (!terminalStatus) return null;
    const settledAt = new Date().toISOString();
    const settledRun = normalizeHardwareIndexRun({
      ...run,
      phase: "settled",
      settledAt,
      terminalStatus,
      terminalError: terminalStatus === "failed" ? String(snapshot?.error || "MineIron settlement failed.") : "",
      lastProgressIndex: Math.max(run.lastProgressIndex, (snapshot?.progress?.length || 0) - 1),
    });
    if (!settledRun) throw new Error("The terminal MineIron run could not be recorded safely.");
    const existing = normalizeHardwareIndex(state.config.clientWorkIndexes[run.driverUrl]);
    let settledResult = existing;
    if (existing?.runId === run.runId) {
      settledResult = normalizeHardwareIndex({
        ...existing,
        settlementStatus: terminalStatus,
        settledAt,
        settlementError: terminalStatus === "failed" ? String(snapshot?.error || "MineIron settlement failed.") : "",
      });
      if (settledResult) state.config.clientWorkIndexes[run.driverUrl] = settledResult;
    }
    state.config.clientWorkIndexRuns[run.driverUrl] = settledRun;
    persistConfig(false, false);
    return { run: settledRun, result: settledResult, terminalStatus };
  }

  function finishHardwareIndexSettlement(run, snapshot) {
    const settled = persistHardwareIndexTerminal(run, snapshot);
    if (!settled) return false;
    const sameActiveRun = state.hardwareIndex.activeRun?.runId === run.runId;
    if (sameActiveRun) {
      clearInterval(state.hardwareIndex.progressTimer);
      state.hardwareIndex.progressTimer = null;
      state.hardwareIndex.progress = null;
      state.hardwareIndex.activeRun = null;
      const selectedResult = currentHardwareIndex();
      const selectedRun = hardwareIndexConnectionKey(activeConnection()) === run.driverUrl;
      const measuredThisRun = selectedResult?.runId === run.runId;
      state.hardwareIndex.status = measuredThisRun || (!selectedRun && selectedResult) ? "ready" : selectedRun ? "error" : "idle";
      state.hardwareIndex.error = selectedRun && !measuredThisRun
        ? run.measurementError || "MineIron settled, but no trustworthy CWI proof window was captured."
        : "";
      patchHardwareIndex();
    }
    if (hardwareIndexRunMatchesCurrentWorkspace(run)) {
      const connection = activeConnection();
      if (connection) void refreshCatalogAndObjects(connection, state.workspaceGeneration);
    }
    const detail = settled.terminalStatus === "succeeded"
      ? "The benchmark Iron settled. The saved proof duration did not change."
      : `${snapshot?.error || "MineIron settlement failed."} The proof measurement, if captured, is still valid.`;
    toast(settled.terminalStatus === "succeeded" ? "MineIron settlement complete" : "MineIron settlement failed", detail, settled.terminalStatus === "succeeded" ? "success" : "warning", 8000);
    return true;
  }

  function beginHardwareIndexSettlement(run, initialSnapshot = null) {
    const current = normalizeHardwareIndexRun(run);
    if (!current?.runId || current.phase === "settled") return;
    const key = `${current.driverUrl}:${current.runId}`;
    if (state.hardwareIndex.settlementWatchers.has(key)) return;
    state.hardwareIndex.settlementWatchers.add(key);
    void (async () => {
      let snapshot = initialSnapshot;
      let lastError = null;
      const deadline = Date.now() + HARDWARE_INDEX_MAX_RUN_MS;
      try {
        for (;;) {
          if (!snapshot) {
            try {
              snapshot = await readHardwareIndexRunSnapshot(current);
              lastError = null;
            } catch (error) {
              lastError = error;
            }
          }
          if (snapshot) {
            const latest = Array.isArray(snapshot.progress) && snapshot.progress.length
              ? snapshot.progress[snapshot.progress.length - 1]
              : null;
            if (state.hardwareIndex.activeRun?.runId === current.runId) {
              state.hardwareIndex.progress = {
                ...state.hardwareIndex.progress,
                phase: hardwareIndexRunPhase(snapshot),
                message: String(latest?.message || `Driver status: ${snapshot.status || "committing"}`).slice(0, 300),
                proofStartedAt: current.proofStartedAt,
                proofCompletedAt: current.proofCompletedAt,
              };
              updateHardwareIndexProgressUi();
            }
            if (terminalHardwareIndexStatus(snapshot)) {
              finishHardwareIndexSettlement(current, snapshot);
              return;
            }
          }
          if (Date.now() >= deadline) break;
          snapshot = null;
          await new Promise((resolve) => setTimeout(resolve, HARDWARE_INDEX_POLL_MS));
        }
        if (state.hardwareIndex.activeRun?.runId === current.runId) {
          clearInterval(state.hardwareIndex.progressTimer);
          state.hardwareIndex.progressTimer = null;
          state.hardwareIndex.progress = null;
          state.hardwareIndex.activeRun = null;
          state.hardwareIndex.status = currentHardwareIndex() ? "ready" : "error";
          state.hardwareIndex.error = currentHardwareIndex()
            ? ""
            : current.measurementError || "MineIron settlement tracking paused before a terminal result was available.";
          patchHardwareIndex();
        }
        toast("MineIron settlement still pending", `${lastError?.message || "The run is still non-terminal."} Its saved proof duration is frozen; resume tracking from Menu Config or Activity.`, "warning", 9000);
      } finally {
        state.hardwareIndex.settlementWatchers.delete(key);
      }
    })();
  }

  function enterHardwareIndexSettlement(run, result, snapshot = null) {
    state.hardwareIndex.status = "settling";
    state.hardwareIndex.error = "";
    state.hardwareIndex.activeRun = run;
    state.hardwareIndex.progress = {
      phase: "Proof timing complete / settlement continuing",
      message: result
        ? "Proof generation complete. Transaction and commit time are excluded from CWI."
        : run.measurementError || "The exact proof window was missed; settlement continues without a new score.",
      proofStartedAt: run.proofStartedAt,
      proofCompletedAt: run.proofCompletedAt,
      elapsedMs: result?.durationMs || 0,
    };
    clearInterval(state.hardwareIndex.progressTimer);
    state.hardwareIndex.progressTimer = setInterval(updateHardwareIndexProgressUi, 500);
    patchHardwareIndex();
    beginHardwareIndexSettlement(run, snapshot);
  }

  async function trackHardwareIndexRun(run, { resumed = false } = {}) {
    let normalizedRun = normalizeHardwareIndexRun(run);
    if (!normalizedRun) return;
    if (resumed && normalizedRun.proofStartedAt && normalizedRun.phase === "proof-running") {
      normalizedRun = normalizeHardwareIndexRun({ ...normalizedRun, timingSource: "resumed-client-clock" });
      if (normalizedRun) persistHardwareIndexRun(normalizedRun);
    }
    if (normalizedRun.phase === "settling") {
      enterHardwareIndexSettlement(normalizedRun, normalizeHardwareIndex(state.config.clientWorkIndexes[normalizedRun.driverUrl]));
      return;
    }
    if (normalizedRun.phase === "settled" || state.hardwareIndex.status === "running") return;
    const token = ++state.hardwareIndex.runToken;
    state.hardwareIndex.proofEventSource?.close();
    state.hardwareIndex.status = "running";
    state.hardwareIndex.error = "";
    state.hardwareIndex.activeRun = normalizedRun;
    state.hardwareIndex.progress = {
      phase: normalizedRun.proofStartedAt
        ? "Generate Proof timing resumed"
        : resumed ? "Resuming retained MineIron run" : "Waiting for Generate Proof",
      message: normalizedRun.proofStartedAt
        ? "A saved Generating proof start was found; waiting for Proof generation complete."
        : resumed ? "Reading the retained run; no new action was submitted." : "The timer has not started yet.",
      proofStartedAt: normalizedRun.proofStartedAt,
      proofCompletedAt: "",
      elapsedMs: 0,
    };
    clearInterval(state.hardwareIndex.progressTimer);
    state.hardwareIndex.progressTimer = setInterval(updateHardwareIndexProgressUi, 500);
    patchHardwareIndex();
    try {
      const outcome = await followHardwareIndexRun(normalizedRun, token);
      if (token !== state.hardwareIndex.runToken) return;
      let trackedRun = outcome.run;
      if (outcome.kind === "complete") {
        const result = buildHardwareIndexProofResult(trackedRun);
        if (!result) {
          trackedRun = markHardwareIndexMeasurementUnavailable(
            trackedRun,
            "The observed Generate Proof timestamps were invalid, so no CWI score was saved.",
          );
          if (!trackedRun) throw new Error("The completed proof observation could not be retained safely.");
          persistHardwareIndexRun(trackedRun);
          toast("CWI timing unavailable", trackedRun.measurementError, "warning", 8000);
          enterHardwareIndexSettlement(trackedRun, null, outcome.snapshot);
          return;
        }
        state.hardwareIndex.status = "settling";
        const persisted = persistHardwareIndexMeasurement(result, trackedRun);
        state.hardwareIndex.persistent = persisted;
        toast("Client work index ready", `${formatProofDuration(result.durationMs)} Generate Proof window / commit excluded / ${persisted ? "saved locally" : "this tab only"}`, "success", 7000);
        enterHardwareIndexSettlement(trackedRun, result, outcome.snapshot);
        return;
      }
      persistHardwareIndexRun(trackedRun);
      toast("CWI timing unavailable", trackedRun.measurementError || "The exact proof event window was not observed, so no score was saved.", "warning", 9000);
      enterHardwareIndexSettlement(trackedRun, null, outcome.snapshot);
    } catch (error) {
      if (token !== state.hardwareIndex.runToken) return;
      state.hardwareIndex.status = "error";
      state.hardwareIndex.error = error.message;
      toast("Client work index not saved", `${error.message} The retained run remains locked; resume it rather than creating another Iron.`, "error", 9000);
    } finally {
      if (token === state.hardwareIndex.runToken && state.hardwareIndex.status !== "settling") {
        clearInterval(state.hardwareIndex.progressTimer);
        state.hardwareIndex.progressTimer = null;
        state.hardwareIndex.progress = null;
        state.hardwareIndex.activeRun = null;
        patchHardwareIndex();
      }
    }
  }

  async function resumePendingHardwareIndexForConnection(connection = activeConnection()) {
    if (!connection || hardwareIndexUiIsActive()) return;
    const pending = hardwareIndexPendingForConnection(connection);
    if (!pending) return;
    if (pending.phase === "settling") {
      enterHardwareIndexSettlement(pending, normalizeHardwareIndex(state.config.clientWorkIndexes[pending.driverUrl]));
      return;
    }
    if (hardwareIndexPendingHasRun(pending)) {
      await trackHardwareIndexRun(pending, { resumed: true });
      return;
    }
    state.hardwareIndex.status = "error";
    state.hardwareIndex.error = hardwareIndexPendingLockCopy(pending);
    patchHardwareIndex();
  }

  async function runHardwareIndex() {
    if (hardwareIndexUiIsActive()) return;
    if (goalWorkflowOwnsSubmissions()) {
      toast("Goal workflow is active", "Pause or exit the automated flow before starting a CWI action.", "warning", 7000);
      return;
    }
    if (document.activeElement?.closest?.('[data-command="run-hardware-index"]')) state.hardwareIndex.restoreFocus = true;
    const connection = activeConnection();
    if (!connection) return;
    const pending = hardwareIndexPendingForConnection(connection);
    if (pending) {
      if (pending.phase === "settling") enterHardwareIndexSettlement(pending, normalizeHardwareIndex(state.config.clientWorkIndexes[pending.driverUrl]));
      else if (hardwareIndexPendingHasRun(pending)) await trackHardwareIndexRun(pending, { resumed: true });
      else {
        state.hardwareIndex.status = "error";
        state.hardwareIndex.error = hardwareIndexPendingLockCopy(pending);
        patchHardwareIndex();
      }
      return;
    }
    const action = mineIronBenchmarkAction();
    const status = connectionStatus(connection.id).state;
    if (status !== "online" || state.workspace.connectionId !== connection.id) {
      state.hardwareIndex.status = "error";
      state.hardwareIndex.error = "The selected Driver must be online and loaded before CWI can run.";
      patchHardwareIndex();
      return;
    }
    const preflightError = mineIronBenchmarkPreflight(action);
    if (preflightError) {
      state.hardwareIndex.status = "error";
      state.hardwareIndex.error = preflightError;
      patchHardwareIndex();
      return;
    }
    const capturedConnection = { ...connection };
    const capturedWorkspaceGeneration = state.workspaceGeneration;
    const requestedAt = new Date().toISOString();
    const submission = normalizeHardwareIndexRun({
      version: HARDWARE_INDEX_VERSION,
      benchmarkId: HARDWARE_INDEX_BENCHMARK_ID,
      scope: HARDWARE_INDEX_SCOPE,
      algorithm: HARDWARE_INDEX_ALGORITHM,
      driverUrl: capturedConnection.driverUrl,
      driverVersion: String(state.workspace.health?.version || ""),
      connectionId: capturedConnection.id,
      connectionName: capturedConnection.name,
      action: HARDWARE_INDEX_ACTION,
      actionHash: action.hash,
      runId: "",
      phase: "submitting",
      submissionId: newId("cwi-submit"),
      requestedAt,
      acceptedAt: "",
    });
    if (!submission || !persistHardwareIndexRun(submission)) {
      state.hardwareIndex.status = "error";
      state.hardwareIndex.error = "The console could not save a durable MineIron submission lock, so no action was sent.";
      patchHardwareIndex();
      return;
    }
    state.hardwareIndex.status = "running";
    state.hardwareIndex.error = "";
    state.hardwareIndex.progress = {
      phase: "Submitting MineIron action",
      message: "Waiting for the selected Driver to return a retained run id. The proof timer has not started.",
      proofStartedAt: "",
      proofCompletedAt: "",
      elapsedMs: 0,
    };
    patchHardwareIndex();
    let requestStarted = false;
    let acceptedByDriver = false;
    try {
      requestStarted = true;
      const accepted = await driverRequest(
        capturedConnection,
        "/actions/run",
        jsonOptions("POST", { input: { action: HARDWARE_INDEX_ACTION, inputObjectPaths: [] } }, 30000),
      );
      if (!accepted?.runId) {
        const error = new Error("The Driver returned success without a run id. The submission outcome is locked; inspect Activity before clearing local console data.");
        error.hardwareIndexOutcomeUnknown = true;
        throw error;
      }
      acceptedByDriver = true;
      const run = normalizeHardwareIndexRun({
        ...submission,
        runId: accepted.runId,
        phase: "accepted",
        acceptedAt: new Date().toISOString(),
      });
      if (!run) {
        const error = new Error("The accepted MineIron run could not be recorded safely. Check Activity before trying again.");
        error.hardwareIndexOutcomeUnknown = true;
        throw error;
      }
      const acceptedRunSaved = persistHardwareIndexRun(run);
      if (!acceptedRunSaved) {
        toast("Keep this tab open", `Run ${shortText(run.runId)} was accepted, but its recovery id could not be saved. Tracking will continue in this tab.`, "warning", 9000);
      }
      rememberRun(capturedConnection.id, run.runId);
      if (isCurrentWorkspace(capturedConnection, capturedWorkspaceGeneration) && hardwareIndexRunMatchesCurrentWorkspace(run)) {
        mergeRun({ ...accepted, action: HARDWARE_INDEX_ACTION, result: null, error: null, progress: [] });
        void watchRun(run.runId, capturedConnection, capturedWorkspaceGeneration);
      }
      state.hardwareIndex.status = "idle";
      state.hardwareIndex.progress = null;
      await trackHardwareIndexRun(run);
    } catch (error) {
      const outcomeUnknown = requestStarted && (acceptedByDriver || error?.status === 0 || error.hardwareIndexOutcomeUnknown);
      if (outcomeUnknown) {
        persistHardwareIndexRun(normalizeHardwareIndexRun({ ...submission, phase: "outcome-unknown" }) || submission);
      } else if (!state.config.clientWorkIndexRuns[submission.driverUrl]?.runId) {
        clearHardwareIndexRun(submission.driverUrl);
      }
      state.hardwareIndex.status = "error";
      state.hardwareIndex.error = outcomeUnknown
        ? `${error.message} No second benchmark can be started from this console while the persisted outcome lock remains.`
        : error.message;
      state.hardwareIndex.progress = null;
      patchHardwareIndex();
      toast("MineIron benchmark was not tracked", state.hardwareIndex.error, "error", 9000);
    }
  }
  function techTreeClassId(value, explicitHash = "") {
    const qualified = value?.class?.pluginName ? value.class : value;
    const hash = explicitHash || value?.hash || value?.classHash || "unhashed";
    return `place:${qualifiedKey(qualified)}@${hash}`;
  }

  function techTreeActionId(action) {
    return `transition:${qualifiedKey(action?.action)}@${action?.hash || "unhashed"}`;
  }

  function techTreeEdgeId(source, target, role) {
    return `edge:${role}:${encodeURIComponent(source)}>${encodeURIComponent(target)}`;
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
        edge = { id: techTreeEdgeId(source, target, role), source, target, role, count: 0, slotIndexes: [] };
        edgeMap.set(key, edge);
      }
      edge.count += 1;
      edge.slotIndexes.push(slotIndex);
    };

    for (const action of cartridge.actions) {
      const id = techTreeActionId(action);
      const flow = actionDependencyFlow(action);
      const transition = {
        id,
        kind: "transition",
        key: qualifiedKey(action.action),
        label: action.action?.name || "Unnamed action",
        emoji: action.emoji || "\u2699",
        description: action.description || "",
        hash: action.hash || "",
        action,
        flow,
        ready: actionReady(action),
        source: !(action.totalInputs || []).length,
        sink: !(action.totalOutputs || []).length,
      };
      transitions.set(id, transition);
      flow.inputs.forEach((required, index) => {
        const place = ensurePlace(required.class, required.hash);
        addEdge(place.id, id, "input", index);
      });
      flow.outputs.forEach((produced, index) => {
        const place = ensurePlace(produced.class, produced.hash);
        addEdge(id, place.id, "output", index);
      });
      flow.opaqueInputs.forEach((required, index) => {
        const place = ensurePlace(required.class, required.hash);
        addEdge(place.id, id, "opaque-input", index);
      });
      flow.opaqueOutputs.forEach((produced, index) => {
        const place = ensurePlace(produced.class, produced.hash);
        addEdge(id, place.id, "opaque-output", index);
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
    const producerTransitionsByPlace = new Map([...places.keys()].map((id) => [id, new Map()]));
    const transitionWorkloads = new Map();
    for (const edge of allEdges) {
      if (edge.role !== "output" && edge.role !== "opaque-output") continue;
      const transition = transitions.get(edge.source);
      if (!transition || !places.has(edge.target)) continue;
      producerTransitionsByPlace.get(edge.target).set(transition.id, transition);
    }
    for (const place of places.values()) {
      const producers = [...(producerTransitionsByPlace.get(place.id)?.values() || [])];
      const workloads = producers.map((transition) => {
        if (!transitionWorkloads.has(transition.id)) transitionWorkloads.set(transition.id, actionProofWorkload(transition.action));
        return transitionWorkloads.get(transition.id);
      });
      place.proofDifficulty = proofDifficultySummary(workloads, {
        producerCount: producers.length,
        unknownReason: "no producing action in this cartridge",
      });
    }
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
      const hasSameRankEdges = componentEdges.some(
        (edge) => rankByNode.get(edge.source) === rankByNode.get(edge.target),
      );
      graphWidth = Math.max(graphWidth, componentWidth + (hasSameRankEdges ? 90 : 38));
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
    const difficulty = node.kind === "place" && node.proofDifficulty ? `, ${node.proofDifficulty.text}` : "";
    return `${kind}, ${node.label}, ${techTreeNodeStatus(node)}${difficulty}`;
  }

  function techTreeLineage(model, nodeId) {
    if (!model?.nodeById.has(nodeId)) return null;
    const incoming = new Map(model.nodes.map((node) => [node.id, []]));
    for (const edge of model.edges) {
      incoming.get(edge.target)?.push(edge);
    }

    const nodeIds = new Set([nodeId]);
    const edgeIds = new Set();
    const directNodeIds = new Set();
    const directEdgeIds = new Set();
    for (const edge of incoming.get(nodeId) || []) {
      directEdgeIds.add(edge.id);
      directNodeIds.add(edge.source);
    }

    const visited = new Set([nodeId]);
    const queue = [nodeId];
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const current = queue[cursor];
      for (const edge of incoming.get(current) || []) {
        edgeIds.add(edge.id);
        nodeIds.add(edge.source);
        if (visited.has(edge.source)) continue;
        visited.add(edge.source);
        queue.push(edge.source);
      }
    }
    return { nodeIds, edgeIds, directNodeIds, directEdgeIds };
  }

  function applyTechTreeRelationshipFocus(model = state.techTree.model) {
    const svg = byId("tech-tree-svg");
    if (!svg || !model) return;
    const selectedId = model.nodeById.has(state.techTree.selectedNodeId)
      ? state.techTree.selectedNodeId
      : "";
    const lineage = selectedId ? techTreeLineage(model, selectedId) : null;
    svg.classList.toggle("has-relationship-focus", Boolean(lineage));

    svg.querySelectorAll("[data-tree-node-id]").forEach((element) => {
      const id = element.dataset.treeNodeId;
      const selected = id === selectedId;
      const related = Boolean(lineage?.nodeIds.has(id));
      element.classList.toggle("is-selected", selected);
      element.classList.toggle("is-direct", Boolean(lineage?.directNodeIds.has(id)));
      element.classList.toggle("is-related", related);
      element.classList.toggle("is-dimmed", Boolean(lineage) && !related);
      element.setAttribute("aria-pressed", String(selected));
    });

    svg.querySelectorAll("[data-tree-edge-id]").forEach((element) => {
      const id = element.dataset.treeEdgeId;
      const related = Boolean(lineage?.edgeIds.has(id));
      element.classList.toggle("is-direct", Boolean(lineage?.directEdgeIds.has(id)));
      element.classList.toggle("is-related", related);
      element.classList.toggle("is-dimmed", Boolean(lineage) && !related);
    });
  }

  function clearTechTreeRelationshipFocus() {
    if (!state.techTree.selectedNodeId) return false;
    state.techTree.selectedNodeId = "";
    applyTechTreeRelationshipFocus();
    updateTechTreeDetails();
    return true;
  }

  const TECH_TREE_EDGE_ROLE_ORDER = {
    input: 0,
    "opaque-input": 1,
    "opaque-output": 2,
    output: 3,
  };

  function techTreeEdgeSides(edge, positions) {
    const source = positions.get(edge.source);
    const target = positions.get(edge.target);
    if (!source || !target) return null;
    if (source.rank === target.rank) {
      return { sourceSide: "right", targetSide: "right" };
    }
    const forward = target.x >= source.x;
    return {
      sourceSide: forward ? "right" : "left",
      targetSide: forward ? "left" : "right",
    };
  }

  function techTreeEdgeRoutes(edges, positions) {
    const routes = new Map();
    const ports = new Map();
    const pairs = new Map();
    const addPort = (nodeId, side, edge, endpoint, otherPosition) => {
      const key = `${nodeId}:${side}`;
      if (!ports.has(key)) ports.set(key, []);
      ports.get(key).push({
        edge,
        endpoint,
        otherY: otherPosition.y + otherPosition.height / 2,
      });
    };

    for (const edge of edges) {
      const source = positions.get(edge.source);
      const target = positions.get(edge.target);
      const sides = techTreeEdgeSides(edge, positions);
      if (!source || !target || !sides) continue;
      const route = {
        ...sides,
        sourceOffsetY: 0,
        targetOffsetY: 0,
        laneOffset: 0,
      };
      routes.set(edge.id, route);
      addPort(edge.source, sides.sourceSide, edge, "source", target);
      addPort(edge.target, sides.targetSide, edge, "target", source);
      const pairKey = [edge.source, edge.target].sort().join("\u0000");
      if (!pairs.has(pairKey)) pairs.set(pairKey, []);
      pairs.get(pairKey).push(edge);
    }

    for (const [key, entries] of ports) {
      const nodeId = key.slice(0, key.lastIndexOf(":"));
      const node = positions.get(nodeId);
      if (!node) continue;
      entries.sort((left, right) =>
        left.otherY - right.otherY ||
        (TECH_TREE_EDGE_ROLE_ORDER[left.edge.role] ?? 9) - (TECH_TREE_EDGE_ROLE_ORDER[right.edge.role] ?? 9) ||
        left.edge.id.localeCompare(right.edge.id),
      );
      const usableHeight = Math.max(0, node.height - 20);
      const spacing = entries.length > 1 ? Math.min(10, usableHeight / (entries.length - 1)) : 0;
      entries.forEach((entry, index) => {
        const route = routes.get(entry.edge.id);
        if (!route) return;
        route[`${entry.endpoint}OffsetY`] = (index - (entries.length - 1) / 2) * spacing;
      });
    }

    for (const pairEdges of pairs.values()) {
      if (pairEdges.length < 2) continue;
      pairEdges.sort((left, right) =>
        (TECH_TREE_EDGE_ROLE_ORDER[left.role] ?? 9) - (TECH_TREE_EDGE_ROLE_ORDER[right.role] ?? 9) ||
        left.id.localeCompare(right.id),
      );
      pairEdges.forEach((edge, index) => {
        const route = routes.get(edge.id);
        if (route) route.laneOffset = (index - (pairEdges.length - 1) / 2) * 10;
      });
    }
    return routes;
  }

  function techTreeEdgeRoleLabel(role) {
    return ({
      input: "CONSUME",
      output: "CREATE",
      "opaque-input": "INPUT?",
      "opaque-output": "OUTPUT?",
    })[role] || "FLOW";
  }

  function techTreeEdgeLabelMarkup(role, count, x, y) {
    const label = `${techTreeEdgeRoleLabel(role)} x${Math.max(1, Number(count) || 1)}`;
    const width = Math.max(42, label.length * 5.2 + 12);
    return `
      <g class="tech-tree-edge-label tech-tree-edge-label-${role}" transform="translate(${x} ${y})" aria-hidden="true">
        <rect x="${-width / 2}" y="-8" width="${width}" height="16"></rect>
        <text y="3">${escapeHtml(label)}</text>
      </g>`;
  }

  function techTreeEdgeGeometry(edge, positions, route = {}) {
    const source = positions.get(edge.source);
    const target = positions.get(edge.target);
    if (!source || !target) return null;
    const sourceSide = route.sourceSide || "right";
    const targetSide = route.targetSide || "left";
    const sourceX = sourceSide === "right" ? source.x + source.width : source.x;
    const targetX = targetSide === "right" ? target.x + target.width : target.x;
    const sourceY = source.y + source.height / 2 + (route.sourceOffsetY || 0);
    const targetY = target.y + target.height / 2 + (route.targetOffsetY || 0);
    const laneOffset = route.laneOffset || 0;
    if (source.rank === target.rank) {
      const rightSide = sourceSide === "right";
      const outerX = rightSide ? Math.max(sourceX, targetX) : Math.min(sourceX, targetX);
      const bendDistance = 52 + Math.min(40, Math.abs(sourceY - targetY) * 0.12) + laneOffset;
      const bend = outerX + (rightSide ? bendDistance : -bendDistance);
      return {
        path: `M ${sourceX} ${sourceY} C ${bend} ${sourceY}, ${bend} ${targetY}, ${targetX} ${targetY}`,
        labelX: bend,
        labelY: (sourceY + targetY) / 2 + laneOffset,
      };
    }
    const forward = targetX >= sourceX;
    const control = Math.max(44, Math.abs(targetX - sourceX) * 0.46);
    const firstControl = sourceX + (forward ? control : -control);
    const secondControl = targetX + (forward ? -control : control);
    const firstControlY = sourceY + laneOffset;
    const secondControlY = targetY + laneOffset;
    return {
      path: `M ${sourceX} ${sourceY} C ${firstControl} ${firstControlY}, ${secondControl} ${secondControlY}, ${targetX} ${targetY}`,
      labelX: (sourceX + targetX) / 2,
      labelY: (sourceY + targetY) / 2 + laneOffset * 0.75,
    };
  }

  function drawTechTreeSvg(model, layout) {
    const parts = [`
      <defs>
        <marker id="tree-arrow-input" class="tech-tree-marker tech-tree-marker-input" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z"></path></marker>
        <marker id="tree-arrow-output" class="tech-tree-marker tech-tree-marker-output" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 5 L 5 0 L 10 5 L 5 10 z"></path></marker>
        <marker id="tree-arrow-opaque-input" class="tech-tree-marker tech-tree-marker-opaque tech-tree-marker-opaque-input" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 1 1 L 9 5 L 1 9 z"></path></marker>
        <marker id="tree-arrow-opaque-output" class="tech-tree-marker tech-tree-marker-opaque tech-tree-marker-opaque-output" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 1 5 L 5 1 L 9 5 L 5 9 z"></path></marker>
      </defs>`];

    for (const box of layout.componentBoxes) {
      const label = `NETWORK ${String(box.index + 1).padStart(2, "0")} / ${box.nodes} NODES / ${box.actions} TRANSITIONS`;
      parts.push(`
        <g class="tech-tree-component" aria-hidden="true">
          <rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}"></rect>
          <text x="${box.x + 12}" y="${box.y + 18}">${escapeHtml(label)}</text>
        </g>`);
    }

    const edgeRoutes = techTreeEdgeRoutes(model.edges, layout.positions);
    for (const edge of model.edges) {
      const geometry = techTreeEdgeGeometry(edge, layout.positions, edgeRoutes.get(edge.id));
      if (!geometry) continue;
      parts.push(`
        <g class="tech-tree-edge tech-tree-edge-${edge.role}" data-tree-edge-id="${escapeHtml(edge.id)}" data-tree-source="${escapeHtml(edge.source)}" data-tree-target="${escapeHtml(edge.target)}" data-tree-role="${edge.role}" aria-hidden="true">
          <path class="tech-tree-edge-halo" d="${geometry.path}"></path>
          <path class="tech-tree-edge-line" d="${geometry.path}" marker-end="url(#tree-arrow-${edge.role})"></path>
          ${techTreeEdgeLabelMarkup(edge.role, edge.count, geometry.labelX, geometry.labelY)}
        </g>`);
    }

    for (const node of model.nodes) {
      const position = layout.positions.get(node.id);
      if (!position) continue;
      const lines = techTreeNodeLabelLines(node.label, node.kind === "place" ? 15 : 18);
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
      const difficultyMarkup = node.kind === "place"
        ? proofDifficultySvgMarkup(node.proofDifficulty, position.width - 20, 4, 2)
        : "";
      parts.push(`
        <g class="${classes}" transform="${transform}" data-tree-node-id="${escapeHtml(node.id)}" data-tree-kind="${node.kind}" role="button" tabindex="0" aria-pressed="${selected}" aria-label="${escapeHtml(techTreeNodeAria(node))}">
          <title>${escapeHtml(`${node.label}: ${status}${node.proofDifficulty ? `. ${node.proofDifficulty.text}` : ""}`)}</title>
          ${shape}
          ${difficultyMarkup}
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
    const outputs = techTreeGroupedRefs([
      ...(transition.flow?.outputs || []),
      ...(transition.flow?.opaqueOutputs || []),
    ])
      .map(({ ref, count }) => `${ref.class?.name || "?"}${count > 1 ? ` x${count}` : ""}`)
      .join(" + ");
    const updates = techTreeGroupedRefs(transition.flow?.mutations || [])
      .map(({ ref, count }) => `${ref.class?.name || "?"}${count > 1 ? ` x${count}` : ""}`)
      .join(" + ");
    if (!outputs && updates) return `${transition.label} \u21bb update ${updates}`;
    return `${transition.label} \u2192 ${outputs || "terminal"}${updates ? ` / updates ${updates}` : ""}`;
  }

  function techTreeDetailsMarkup(model) {
    if (!model.nodes.length) {
      return `
        <div class="tech-tree-detail-heading"><div><span class="tech-tree-detail-kind">Graph inspector</span><h2>No graph nodes</h2></div></div>
        <p class="tech-tree-detail-copy">This cartridge does not currently expose any public class states or action transitions.</p>`;
    }
    const selected = model.nodeById.get(state.techTree.selectedNodeId) || null;
    const allNodeById = new Map(model.allNodes.map((node) => [node.id, node]));
    const focusObject = model.focusObject;
    if (!selected) {
      if (focusObject) {
        const place = allNodeById.get(model.focusPlaceId);
        const edgeBranches = model.allEdges
          .filter((edge) => edge.source === model.focusPlaceId)
          .map((edge) => allNodeById.get(edge.target))
          .filter((node) => node?.kind === "transition");
        const mutationBranches = model.allNodes.filter(
          (node) => node.kind === "transition" && node.flow?.mutations.some((ref) => techTreeClassId(ref.class, ref.hash) === model.focusPlaceId),
        );
        const branches = [...new Map([...edgeBranches, ...mutationBranches].map((node) => [node.id, node])).values()];
        return `
          <div class="tech-tree-detail-heading">
            <div><span class="tech-tree-detail-kind">Selected object</span><h2>${escapeHtml(`${focusObject.emoji || ""} ${focusObject.class?.name || "Object"}`)}</h2></div>
            ${gameButton("Open object", "view-object", { extra: ` data-id="${escapeHtml(focusObject.fileName)}"` })}
          </div>
          <p class="tech-tree-detail-copy">Current state: ${escapeHtml(place?.label || focusObject.class?.name || "Unknown")} / ${escapeHtml(focusObject.status || "unknown")}. ${branches.length} possible outgoing transition${branches.length === 1 ? "" : "s"} use this class.</p>`;
      }
      return `
        <div class="tech-tree-detail-heading"><div><span class="tech-tree-detail-kind">Graph inspector</span><h2>Select a node</h2></div></div>
        <p class="tech-tree-detail-copy">Choose a class state or action transition to isolate only the prerequisite steps that can lead to it. Choose it again to clear the trace.</p>`;
    }

    if (selected.kind === "transition") {
      return `
        <div class="tech-tree-detail-heading">
          <div><span class="tech-tree-detail-kind">Action transition / ${selected.ready ? "locally ready" : "needs tokens"}</span><h2>${escapeHtml(`${selected.emoji || ""} ${selected.label}`)}</h2></div>
          ${gameButton("Set up action", "setup-action", { tone: "primary", extra: ` data-id="${escapeHtml(selected.key)}"` })}
        </div>
        <p class="tech-tree-detail-copy">${escapeHtml(selected.description || "No description")}</p>
        <div class="tech-tree-detail-io">
          <div><span>Consumed states</span><div class="chip-list">${techTreeRefsMarkup(selected.flow?.inputs, "No direct consumes")}</div></div>
          <div><span>Created states</span><div class="chip-list">${techTreeRefsMarkup(selected.flow?.outputs, "No direct creates")}</div></div>
          ${selected.flow?.mutations.length ? `<div><span>Explicit updates / not mapped</span><div class="chip-list">${techTreeRefsMarkup(selected.flow.mutations, "")}</div></div>` : ""}
          ${selected.flow?.opaqueInputs.length ? `<div><span>Unresolved inputs / dashed</span><div class="chip-list">${techTreeRefsMarkup(selected.flow.opaqueInputs, "")}</div></div>` : ""}
          ${selected.flow?.opaqueOutputs.length ? `<div><span>Unresolved outputs / dashed</span><div class="chip-list">${techTreeRefsMarkup(selected.flow.opaqueOutputs, "")}</div></div>` : ""}
        </div>`;
    }

    const incoming = model.allEdges
      .filter((edge) => edge.target === selected.id)
      .map((edge) => allNodeById.get(edge.source))
      .filter((node) => node?.kind === "transition");
    const edgeOutgoing = model.allEdges
      .filter((edge) => edge.source === selected.id)
      .map((edge) => allNodeById.get(edge.target))
      .filter((node) => node?.kind === "transition");
    const mutationOutgoing = model.allNodes.filter(
      (node) => node.kind === "transition" && node.flow?.mutations.some((ref) => techTreeClassId(ref.class, ref.hash) === selected.id),
    );
    const outgoing = [...new Map([...edgeOutgoing, ...mutationOutgoing].map((node) => [node.id, node])).values()];
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
          "Tech Tree",
          "Explore every public class and action signature as a dependency graph, including disconnected networks.",
        )}
        ${cartridgeNavigation("tree")}
        <div class="tech-tree-toolbar">
          <div class="game-toolbar-group" role="group" aria-label="Tree view">
            ${gameButton("Full Net", "tree-mode", { tone: allMode ? "primary" : "", extra: ` data-value="all" aria-pressed="${allMode}"` })}
            ${gameButton("Object Neighborhood", "tree-mode", { tone: !allMode ? "primary" : "", extra: ` data-value="object" aria-pressed="${!allMode}"${objects.length ? "" : " disabled"}` })}
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
            <span><i class="legend-edge legend-input" aria-hidden="true"></i>Consume</span>
            <span><i class="legend-edge legend-output" aria-hidden="true"></i>Create</span>
            <span><i class="legend-edge legend-opaque" aria-hidden="true"></i>Unresolved I/O</span>
            <span class="work-gate-key"><b class="gate-symbol" aria-hidden="true">⛏</b>PoW <b class="gate-symbol" aria-hidden="true">⌛</b>VDF <small><i class="gate-tone is-green" aria-hidden="true"></i>low <i class="gate-tone is-yellow" aria-hidden="true"></i>mid/? <i class="gate-tone is-red" aria-hidden="true"></i>high</small></span>
            <span class="tech-tree-counts"><b data-tree-place-count>0</b> states / <b data-tree-action-count>0</b> transitions / <b data-tree-network-count>0</b> networks</span>
          </div>
          <div id="tech-tree-canvas" class="tech-tree-canvas">
            <button class="tech-tree-fullscreen-button" type="button" data-command="tree-fullscreen" aria-label="Enter graph fullscreen" title="Enter graph fullscreen" aria-pressed="false">
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="M14 4h6v6 M20 4l-7 7 M10 20H4v-6 M4 20l7-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter"></path></svg>
            </button>
            <svg id="tech-tree-svg" role="group" aria-labelledby="tech-tree-svg-title tech-tree-svg-description" preserveAspectRatio="xMidYMid meet">
              <title id="tech-tree-svg-title">${escapeHtml(cartridge.name)} action dependency graph</title>
              <desc id="tech-tree-svg-description">Class states connect to action transitions through labelled consume and create arcs. Consume arcs use triangle markers, create arcs use diamond markers, and dashed open markers identify unresolved input or output arcs. Object badges show PoW with a pick and VDF with an hourglass; green is low, yellow is medium or unknown, and red is high. Explicit mutations are excluded.</desc>
            </svg>
            <span class="tech-tree-map-help" aria-hidden="true">Click: trace prerequisites / again: clear / drag: pan / wheel: zoom</span>
          </div>
          <div id="tech-tree-details" class="tech-tree-details" aria-live="polite"></div>
          <div class="terminal-note tech-tree-truth-note">Solid arcs are direct TxDelete consumes and TxInsert creates. Dashed neutral arcs are flattened I/O that the public predicate could not classify; hidden subactions are one possible cause. Explicit TxMutate updates are listed in the inspector but intentionally excluded from this dependency map.</div>
        </div>
      </section>`;
  }

  function techTreeFullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }

  function syncTechTreeFullscreenUi() {
    const canvas = byId("tech-tree-canvas");
    const nativeActive = Boolean(canvas && techTreeFullscreenElement() === canvas);
    if (nativeActive) state.techTree.fullscreenFallback = false;
    const fallbackActive = Boolean(canvas && state.techTree.fullscreenFallback && !nativeActive);
    const active = nativeActive || fallbackActive;
    canvas?.classList.toggle("is-pseudo-fullscreen", fallbackActive);
    document.documentElement.classList.toggle("has-tech-tree-fullscreen", active);
    const button = canvas?.querySelector("[data-command='tree-fullscreen']");
    if (button) {
      const label = active ? "Exit graph fullscreen" : "Enter graph fullscreen";
      button.setAttribute("aria-label", label);
      button.setAttribute("title", label);
      button.setAttribute("aria-pressed", String(active));
    }
  }

  function enableTechTreeFullscreenFallback() {
    if (state.screen !== "tree" || !byId("tech-tree-canvas")) return;
    state.techTree.fullscreenRequestPending = false;
    state.techTree.fullscreenFallback = true;
    syncTechTreeFullscreenUi();
  }

  async function toggleTechTreeFullscreen() {
    const canvas = byId("tech-tree-canvas");
    if (!canvas) return;
    const nativeElement = techTreeFullscreenElement();
    if (nativeElement === canvas) {
      state.techTree.fullscreenRequestPending = false;
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      try {
        const result = exit?.call(document);
        if (result?.then) await result;
      } catch {
        // The fullscreenchange event remains authoritative if exit rejects.
      }
      syncTechTreeFullscreenUi();
      return;
    }
    if (state.techTree.fullscreenFallback) {
      state.techTree.fullscreenFallback = false;
      syncTechTreeFullscreenUi();
      return;
    }

    const request = canvas.requestFullscreen || canvas.webkitRequestFullscreen;
    if (!request) {
      enableTechTreeFullscreenFallback();
      return;
    }
    state.techTree.fullscreenRequestPending = true;
    try {
      const result = request.call(canvas);
      if (result?.then) {
        await result;
        state.techTree.fullscreenRequestPending = false;
        if (techTreeFullscreenElement() !== canvas) enableTechTreeFullscreenFallback();
        else syncTechTreeFullscreenUi();
      } else {
        window.setTimeout(() => {
          if (!state.techTree.fullscreenRequestPending) return;
          if (techTreeFullscreenElement() === byId("tech-tree-canvas")) {
            state.techTree.fullscreenRequestPending = false;
            syncTechTreeFullscreenUi();
          } else {
            enableTechTreeFullscreenFallback();
          }
        }, 500);
      }
    } catch {
      enableTechTreeFullscreenFallback();
    }
  }

  function cleanupTechTreeFullscreen() {
    state.techTree.fullscreenFallback = false;
    state.techTree.fullscreenRequestPending = false;
    state.techTree.drag = null;
    byId("tech-tree-canvas")?.classList.remove("is-pseudo-fullscreen");
    document.documentElement.classList.remove("has-tech-tree-fullscreen");
    const nativeElement = techTreeFullscreenElement();
    if (nativeElement?.id === "tech-tree-canvas") {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      try {
        const result = exit?.call(document);
        if (result?.catch) result.catch(() => {});
      } catch {
        // Removing the fullscreen element also asks the browser to exit.
      }
    }
  }

  function handleTechTreeFullscreenChange() {
    state.techTree.fullscreenRequestPending = false;
    syncTechTreeFullscreenUi();
  }

  function handleTechTreeFullscreenError() {
    if (state.techTree.fullscreenRequestPending) enableTechTreeFullscreenFallback();
  }

  function trapTechTreeFullscreenFocus(event) {
    if (!state.techTree.fullscreenFallback || event.key !== "Tab") return false;
    const canvas = byId("tech-tree-canvas");
    if (!canvas) return false;
    const focusable = [...canvas.querySelectorAll("button:not([disabled]), [tabindex]:not([tabindex='-1'])")]
      .filter((element) => element.getAttribute("aria-disabled") !== "true");
    if (!focusable.length) return false;
    const current = focusable.indexOf(document.activeElement);
    if (current < 0 || (!event.shiftKey && current === focusable.length - 1) || (event.shiftKey && current === 0)) {
      event.preventDefault();
      focusable[event.shiftKey ? focusable.length - 1 : 0].focus({ preventScroll: true });
      return true;
    }
    return false;
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
    if (!model) return;
    const layout = layoutTechTree(model);
    state.techTree.model = model;
    state.techTree.layout = layout;
    if (state.techTree.selectedNodeId && !model.nodeById.has(state.techTree.selectedNodeId)) {
      state.techTree.selectedNodeId = "";
    }
    if (state.techTree.viewKey !== model.fingerprint || !state.techTree.viewBox) {
      state.techTree.viewKey = model.fingerprint;
      state.techTree.viewBox = fittedTechTreeView(layout);
    }
    root.dataset.treeFingerprint = model.fingerprint;
    const accessibleMarkup = `
      <title id="tech-tree-svg-title">${escapeHtml(model.cartridge.name)} action dependency graph</title>
      <desc id="tech-tree-svg-description">Class states connect to action transitions through labelled required-input and produced-output arcs. Consume arcs use triangle markers, create arcs use diamond markers, and dashed open markers identify unresolved relationships. Object badges show PoW with a pick and VDF with an hourglass; green is low, yellow is medium or unknown, and red is high. Select a node to emphasize only the prerequisite steps that can lead to it; select it again to clear the emphasis.</desc>`;
    svg.innerHTML = accessibleMarkup + (model.nodes.length
      ? drawTechTreeSvg(model, layout)
      : '<text class="tech-tree-empty" x="20" y="40">No classes or actions are available for this cartridge.</text>');
    applyTechTreeViewBox();
    applyTechTreeRelationshipFocus(model);
    syncTechTreeFullscreenUi();
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
    state.techTree.selectedNodeId = state.techTree.selectedNodeId === id ? "" : id;
    applyTechTreeRelationshipFocus(model);
    updateTechTreeDetails(model);
    if (focus && state.techTree.selectedNodeId) {
      [...main.querySelectorAll("[data-tree-node-id]")]
        .find((element) => element.dataset.treeNodeId === state.techTree.selectedNodeId)
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
    if (state.techTree.selectedNodeId && !model.nodeById.has(state.techTree.selectedNodeId)) {
      state.techTree.selectedNodeId = "";
    }
    main.querySelectorAll("[data-tree-node-id]").forEach((element) => {
      const node = model.nodeById.get(element.dataset.treeNodeId);
      if (!node) return;
      element.classList.toggle("is-ready", node.kind === "transition" && node.ready);
      element.classList.toggle("has-live", node.kind === "place" && Boolean(node.counts.live));
      element.setAttribute("aria-label", techTreeNodeAria(node));
      const status = element.querySelector("[data-tree-node-status]");
      if (status) status.textContent = techTreeNodeStatus(node);
      const title = element.querySelector("title");
      if (title) title.textContent = `${node.label}: ${techTreeNodeStatus(node)}`;
    });
    applyTechTreeRelationshipFocus(model);
    updateTechTreeCounts(model, state.techTree.layout);
    updateTechTreeDetails(model);
  }

  function plannerGoalTargetForAction(catalog, action) {
    const normalized = catalog?.actionById?.get(plannerActionId(action));
    if (!normalized) return null;
    const positiveNetByClass = new Map(normalized.positiveNetOutputs.map((output) => [output.classId, output.net]));
    const candidates = [];
    const seen = new Set();
    for (const output of normalized.outputSlots) {
      const net = positiveNetByClass.get(output.classId) || 0;
      if (net <= 0 || seen.has(output.classId)) continue;
      seen.add(output.classId);
      const objectClass = catalog.classById.get(output.classId);
      candidates.push({
        classId: output.classId,
        label: objectClass?.label || output.ref?.class?.name || "output",
        net,
        slotIndex: output.slotIndex,
      });
    }
    candidates.sort((left, right) => right.net - left.net || left.slotIndex - right.slotIndex || plannerCompareText(left.classId, right.classId));
    return candidates[0] || null;
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
    let plannerCatalog = null;
    try {
      plannerCatalog = buildPlannerCatalog(cartridge, state.workspace);
    } catch {
      // Action Setup remains available if the planner catalog cannot be built.
    }
    const visible = filtered.slice(0, state.actionLimit);
    const cards = visible.map((action, index) => {
      const ready = actionReady(action);
      const inputCount = (action.totalInputs || []).length;
      const outputCount = (action.totalOutputs || []).length;
      const name = action.action?.name || "Unnamed action";
      const goalTarget = ready ? null : plannerGoalTargetForAction(plannerCatalog, action);
      const opensPlanner = Boolean(goalTarget);
      const ariaLabel = `${name}. ${ready ? "Ready" : "Needs items"}. ${inputCount} input${inputCount === 1 ? "" : "s"}, ${outputCount} output${outputCount === 1 ? "" : "s"}. ${opensPlanner ? `Open Goal Planner for ${goalTarget.label}.` : "Open action setup."}`;
      const descriptionId = `action-card-${index}-description`;
      const inputNames = techTreeGroupedRefs(action.totalInputs || []).map(({ ref, count }) => `${ref.class?.name || "unknown"}${count > 1 ? ` x${count}` : ""}`).join(", ") || "none";
      const outputNames = techTreeGroupedRefs(action.totalOutputs || []).map(({ ref, count }) => `${ref.class?.name || "unknown"}${count > 1 ? ` x${count}` : ""}`).join(", ") || "none";
      const command = opensPlanner ? "plan-goal" : "setup-action";
      const commandId = opensPlanner ? goalTarget.classId : qualifiedKey(action.action);
      const meta = opensPlanner
        ? `<span>Goal</span><span class="compact-card-goal">${escapeHtml(goalTarget.label)}</span>`
        : `<span>${inputCount} in</span><span class="compact-card-arrow">→</span><span>${outputCount} out</span>`;
      return `
        <button class="action-card compact-card menu-focusable${ready ? "" : " is-unavailable"}" type="button" data-command="${command}" data-id="${escapeHtml(commandId)}" aria-label="${escapeHtml(ariaLabel)}" aria-describedby="${descriptionId}" title="${escapeHtml(ariaLabel)}">
          <span class="compact-card-top">
            <span class="card-orb" aria-hidden="true">${escapeHtml(action.emoji || "ACT")}</span>
            <span class="card-status ${ready ? "is-ready" : "is-needs"}">${ready ? "Ready" : opensPlanner ? "Plan" : "Needs"}</span>
          </span>
          <span class="card-title">${escapeHtml(name)}</span>
          <span class="compact-card-meta" aria-hidden="true">${meta}</span>
          <span id="${descriptionId}" class="sr-only">${escapeHtml(`${action.description || "No description"} Inputs: ${inputNames}. Outputs: ${outputNames}.`)}</span>
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
        )}
        ${cartridgeNavigation("actions")}
        <div class="game-toolbar">
          <input id="action-search" class="game-input game-search" type="search" placeholder="Search actions" value="${escapeHtml(state.actionSearch)}" aria-label="Search actions" />
          <div class="game-toolbar-group">${filters}</div>
        </div>
        <div data-catalog-region="actions">${actionCatalogMarkup(cartridge)}</div>
      </section>`;
  }

  function plannerContext(cartridge = selectedCartridge(), settings = {}) {
    if (!cartridge) return { cartridge: null, catalog: null, inventory: null, options: [], result: null, error: null };
    const sourceError = state.workspace.errors.actions || state.workspace.errors.objects;
    if (sourceError) {
      const source = state.workspace.errors.actions ? "action catalog" : "object inventory";
      return {
        cartridge,
        catalog: null,
        inventory: null,
        options: [],
        result: null,
        error: `Planner unavailable because the Driver ${source} could not be loaded: ${sourceError}`,
      };
    }
    try {
      const catalog = buildPlannerCatalog(cartridge, state.workspace);
      const inventory = buildPlannerInventory(state.workspace.objects);
      const goalOptions = plannerGoalOptions(catalog);
      const optionIds = new Set(goalOptions.map((option) => option.classId));
      if (!optionIds.has(state.planner.goalClassId)) {
        state.planner.goalClassId = goalOptions[0]?.classId || "";
      }
      const request = plannerStateRequest();
      const cachedResult = settings.reuseResult &&
        state.planner.result?.goal?.classId === request.classId &&
        state.planner.result?.goal?.semantics === request.semantics &&
        state.planner.result?.goal?.quantity === request.quantity
        ? state.planner.result
        : null;
      const result = cachedResult || (state.planner.goalClassId
        ? planGoalCraftRequest(catalog, inventory, request)
        : null);
      state.planner.result = result;
      return { cartridge, catalog, inventory, options: goalOptions, result, error: null };
    } catch (error) {
      state.planner.result = null;
      return { cartridge, catalog: null, inventory: null, options: [], result: null, error: error.message };
    }
  }

  function plannerActionForStep(step, catalog) {
    return catalog?.actionById?.get(step.actionId)?.raw || actionByKey(step.actionKey);
  }

  function plannerStepSlotRole(step, classId, slotIndex, endpoint, catalog) {
    const action = catalog?.actionById?.get(step.actionId);
    const turnover = action?.sameClassTurnover?.find((item) => item.classId === classId);
    if (!turnover) return endpoint;
    const slots = endpoint === "input" ? action.inputSlots : action.outputSlots;
    const position = slots.filter((slot) => slot.classId === classId).findIndex((slot) => slot.slotIndex === slotIndex);
    const pairedCount = Math.min(turnover.inputs, turnover.outputs);
    return position >= 0 && position < pairedCount ? `update-${endpoint}` : endpoint;
  }

  function plannerTimingLabel(summary, emptyLabel = "0 sec") {
    if (!summary.count) return emptyLabel;
    if (summary.requiresCwi) return "Run CWI";
    if (!summary.knownCount) return "Time unknown";
    const duration = formatProofDuration(summary.knownMilliseconds);
    return summary.complete ? `~${duration}` : `>= ${duration}`;
  }

  function plannerExecutionMultiplier(result) {
    if (result?.execution?.mode !== "repeat-unit") return 1;
    return Math.max(
      1,
      Math.trunc(Number(result.execution.estimatedBatchCount || result.execution.quantity || result.goal?.quantity) || 1),
    );
  }

  function plannerTimingSummary(stepIds, timingByStep, multiplier = 1) {
    const ids = [...new Set(stepIds || [])];
    const repeats = Math.max(1, Math.trunc(Number(multiplier) || 1));
    let knownMilliseconds = 0;
    let knownCount = 0;
    let directWorkCount = 0;
    let observedCount = 0;
    let calibratedCount = 0;
    let lowerBoundCount = 0;
    let nominalMilliseconds = 0;
    let operationalAllowanceMilliseconds = 0;
    let complete = true;
    let requiresCwi = false;
    for (const id of ids) {
      const timing = timingByStep.get(id);
      if (!timing) {
        complete = false;
        continue;
      }
      if (timing.totalMilliseconds != null) {
        knownMilliseconds += timing.totalMilliseconds;
        knownCount += 1;
      }
      if (timing.hasKnownWork) directWorkCount += 1;
      if (timing.estimateKind === "observed") observedCount += 1;
      if (timing.estimateKind === "calibrated") calibratedCount += 1;
      if (timing.estimateKind === "lower-bound") lowerBoundCount += 1;
      if (timing.nominalMilliseconds != null) nominalMilliseconds += timing.nominalMilliseconds;
      if (timing.operationalAllowanceMilliseconds != null) operationalAllowanceMilliseconds += timing.operationalAllowanceMilliseconds;
      if (!timing.complete || timing.totalMilliseconds == null) complete = false;
      requiresCwi ||= timing.requiresCwi;
    }
    return {
      count: ids.length * repeats,
      knownMilliseconds: knownMilliseconds * repeats,
      knownCount: knownCount * repeats,
      directWorkCount: directWorkCount * repeats,
      observedCount: observedCount * repeats,
      calibratedCount: calibratedCount * repeats,
      lowerBoundCount: lowerBoundCount * repeats,
      nominalMilliseconds: nominalMilliseconds * repeats,
      operationalAllowanceMilliseconds: operationalAllowanceMilliseconds * repeats,
      complete,
      requiresCwi,
    };
  }

  function plannerWorkloadSummary(stepIds, timingByStep, multiplier = 1) {
    const ids = [...new Set(stepIds || [])];
    const repeats = BigInt(Math.max(1, Math.trunc(Number(multiplier) || 1)));
    let powExpectedAttempts = 0n;
    let vdfIterations = 0n;
    let readableStepCount = 0;
    let complete = true;
    for (const id of ids) {
      const workload = timingByStep.get(id)?.workload;
      if (!workload) {
        complete = false;
        continue;
      }
      powExpectedAttempts += workload.pow?.expectedAttempts || 0n;
      vdfIterations += workload.vdf?.totalIterations || 0n;
      if ((workload.pow?.knownCount || 0) + (workload.vdf?.knownCount || 0) > 0) readableStepCount += 1;
      if (!workload.complete) complete = false;
    }
    return {
      count: ids.length * Number(repeats),
      powExpectedAttempts: powExpectedAttempts * repeats,
      vdfIterations: vdfIterations * repeats,
      readableStepCount: readableStepCount * Number(repeats),
      complete,
    };
  }

  function plannerWorkloadLabel(summary) {
    if (!summary.count) return "No action proof work";
    if (!summary.readableStepCount) return summary.complete ? "No direct PoW/VDF gates" : "Direct proof counts unreadable";
    const prefix = summary.complete ? "~" : ">= ";
    return `${prefix}${summary.powExpectedAttempts.toLocaleString()} PoW trials / ${summary.vdfIterations.toLocaleString()} VDF iterations`;
  }

  function plannerDirectTimingLabel(timing) {
    if (!timing) return "Time unknown";
    if (timing.requiresCwi) return "Run CWI";
    if (timing.totalMilliseconds == null) return "Time unknown";
    return `${timing.lowerBound ? ">= " : "~"}${formatProofDuration(timing.totalMilliseconds)} total`;
  }

  function plannerDirectTimingBreakdown(timing) {
    if (!timing?.workload) return "PoW unknown / VDF unknown";
    if (timing.requiresCwi) return `PoW ${timing.workload.pow.level} / VDF ${timing.workload.vdf.level} / proof baseline requires CWI`;
    const source = timing.estimateKind === "observed" ? "proof observed" : timing.lowerBound ? "proof lower bound" : "scaled proof";
    const proof = timing.proofMilliseconds == null ? "proof unknown" : `${formatProofDuration(timing.proofMilliseconds)} ${source}`;
    return `PoW ${timing.workload.pow.level} / VDF ${timing.workload.vdf.level} / ${proof} + ${formatProofDuration(timing.commitAllowanceMilliseconds)} commit + ${Math.round(timing.operationalContingency * 100)}% operations`;
  }

  function buildPlannerDisplayTree(result, timingByStep, catalog) {
    if (!result?.goal) return null;
    const stepById = new Map(result.steps.map((step) => [step.id, step]));
    const tokenById = new Map(result.tokens.map((token) => [token.tokenId, token]));
    const expandedSteps = new Set();
    const goalTokenIds = new Set(result.goalTokenIds || []);
    const reachableTokenIds = new Set(goalTokenIds);
    const reachableQueue = [...goalTokenIds];
    for (let cursor = 0; cursor < reachableQueue.length; cursor += 1) {
      const token = tokenById.get(reachableQueue[cursor]);
      const step = token?.producedByStepId ? stepById.get(token.producedByStepId) : null;
      for (const input of step?.inputs || []) {
        if (reachableTokenIds.has(input.tokenId)) continue;
        reachableTokenIds.add(input.tokenId);
        reachableQueue.push(input.tokenId);
      }
    }
    const preferredOutputTokenByStepId = new Map();
    for (const step of result.steps) {
      let preferred = null;
      for (const output of step.outputs) {
        if (!reachableTokenIds.has(output.tokenId)) continue;
        const token = tokenById.get(output.tokenId);
        const consumerStep = token?.consumedByStepId ? stepById.get(token.consumedByStepId) : null;
        const consumerInput = consumerStep?.inputs.find((input) => input.tokenId === output.tokenId);
        const consumerRole = consumerStep && consumerInput
          ? plannerStepSlotRole(consumerStep, consumerInput.classId, consumerInput.slotIndex, "input", catalog)
          : "";
        const score = goalTokenIds.has(output.tokenId) ? 3 : consumerInput ? (consumerRole.startsWith("update-") ? 1 : 2) : 0;
        if (!preferred || score > preferred.score) preferred = { tokenId: output.tokenId, score };
      }
      if (preferred) preferredOutputTokenByStepId.set(step.id, preferred.tokenId);
    }

    const blockedRoot = (status) => {
      const missingClassIds = [...new Set(
        (result.diagnostics || [])
          .filter((diagnostic) => diagnostic.code === "missing-seed")
          .flatMap((diagnostic) => diagnostic.classIds || []),
      )].filter((classId) => classId !== result.goal.classId);
      return {
        id: "goal",
        kind: "object",
        label: result.goal.label,
        state: status,
        isRoot: true,
        stepIds: new Set(),
        children: missingClassIds.slice(0, 12).map((classId) => {
          const item = catalog?.classById?.get(classId);
          return {
            id: `missing:${classId}`,
            kind: "object",
            label: item?.label || classId,
            state: "blocked",
            diagnostic: true,
            diagnosticHash: item?.hash || "",
            inputRole: "missing",
            stepIds: new Set(),
            children: [],
          };
        }),
      };
    };

    const buildToken = (tokenId, path = new Set()) => {
      const token = tokenById.get(tokenId);
      if (!token) return {
        id: `missing:${tokenId}`,
        kind: "object",
        label: "Missing component",
        state: "blocked",
        stepIds: new Set(),
        children: [],
      };
      const base = {
        id: `object:${token.tokenId}`,
        kind: "object",
        label: token.classLabel || token.classId,
        token,
        state: token.kind === "inventory" ? "inventory" : "planned",
        stepIds: new Set(),
        children: [],
      };
      if (token.kind === "inventory" || !token.producedByStepId) return base;
      const step = stepById.get(token.producedByStepId);
      if (!step) return { ...base, state: "blocked" };
      // Co-produced outputs share one action subtree. Give that subtree to the
      // goal output first, then a consumed component, and only then a reusable
      // UPDATE token. This keeps component branches intact without dropping the
      // tool/equipment action when it is the only meaningful output.
      const preferredOutputTokenId = preferredOutputTokenByStepId.get(step.id);
      if (!expandedSteps.has(step.id) && preferredOutputTokenId && preferredOutputTokenId !== token.tokenId) {
        return { ...base, state: "shared", aliasStep: step };
      }
      if (path.has(step.id)) return { ...base, state: "cycle", aliasStep: step };
      if (expandedSteps.has(step.id)) return { ...base, state: "shared", aliasStep: step };
      expandedSteps.add(step.id);
      const nextPath = new Set(path).add(step.id);
      // Put consumed components before reusable/update equipment so a tool chain
      // never visually outranks the components the selected object consumes.
      const orderedInputs = [...step.inputs].sort((left, right) => {
        const leftRole = plannerStepSlotRole(step, left.classId, left.slotIndex, "input", catalog);
        const rightRole = plannerStepSlotRole(step, right.classId, right.slotIndex, "input", catalog);
        return Number(leftRole.startsWith("update-")) - Number(rightRole.startsWith("update-")) || left.slotIndex - right.slotIndex;
      });
      const inputNodes = orderedInputs.map((input) => {
        const role = plannerStepSlotRole(step, input.classId, input.slotIndex, "input", catalog);
        const inputNode = buildToken(input.tokenId, nextPath);
        inputNode.inputRole = role;
        return inputNode;
      });
      const stepIds = new Set([step.id]);
      for (const input of inputNodes) for (const id of input.stepIds) stepIds.add(id);
      const output = step.outputs.find((item) => item.tokenId === token.tokenId);
      const actionNode = {
        id: `action:${step.id}`,
        kind: "action",
        label: step.label,
        step,
        state: "planned",
        stepIds,
        outputRole: plannerStepSlotRole(step, token.classId, output?.slotIndex, "output", catalog),
        children: inputNodes,
      };
      return { ...base, stepIds, children: [actionNode] };
    };

    if (result.status === "unreachable") return blockedRoot("blocked");
    if (result.status === "search-limit") return blockedRoot("search-limit");
    if (result.status === "invalid-goal") return blockedRoot("blocked");
    const goalTokenIdList = result.goalTokenIds || [];
    const repeatedUnit = result.execution?.mode === "repeat-unit" && result.goal.quantity > 1;
    let root;
    if (repeatedUnit && goalTokenIdList.length) {
      const child = buildToken(goalTokenIdList[0]);
      child.inputRole = "output";
      child.label = `One ${result.goal.label}`;
      root = {
        id: "goal:quantity",
        kind: "object",
        label: `${result.goal.quantity} × ${result.goal.label}`,
        state: "planned",
        aggregate: true,
        repeatQuantity: result.goal.quantity,
        stepIds: new Set(result.steps.map((step) => step.id)),
        children: [child],
      };
    } else if (goalTokenIdList.length > 1) {
      const children = goalTokenIdList.map((tokenId) => {
        const child = buildToken(tokenId);
        child.inputRole = "output";
        return child;
      });
      root = {
        id: "goal:quantity",
        kind: "object",
        label: `${result.goal.quantity} × ${result.goal.label}`,
        state: "planned",
        aggregate: true,
        stepIds: new Set(result.steps.map((step) => step.id)),
        children,
      };
    } else {
      const goalTokenId = goalTokenIdList[0];
      root = goalTokenId ? buildToken(goalTokenId) : blockedRoot(result.status === "satisfied" ? "inventory" : "blocked");
    }
    root.isRoot = true;
    if (!root.aggregate) root.label = result.goal.label;
    // The target reports the complete action-set estimate even when UPDATE/tool
    // turnover is presented as a compact reference elsewhere in the visual.
    root.timing = plannerTimingSummary(
      result.steps.map((step) => step.id),
      timingByStep,
      plannerExecutionMultiplier(result),
    );
    return root;
  }

  function layoutPlannerDisplayTree(root) {
    if (!root) return null;
    const HORIZONTAL_GAP = 18;
    const LEVEL_GAP = 70;
    const TOP = 24;
    const NODE_SIZES = {
      object: { width: 164, height: 64 },
      action: { width: 152, height: 58 },
    };
    const nodes = [];
    const edges = [];
    const layers = [];
    let maximumDepth = 0;
    const collect = (node, depth) => {
      maximumDepth = Math.max(maximumDepth, depth);
      node.size = NODE_SIZES[node.kind];
      node.span = node.size.width;
      node.depth = depth;
      nodes.push(node);
      if (!layers[depth]) layers[depth] = [];
      layers[depth].push(node);
      node.children.forEach((child, index) => {
        collect(child, depth + 1);
        edges.push({
          id: `${child.id}>${node.id}`,
          source: child,
          target: node,
          role: child.kind === "object" ? child.inputRole || "input" : child.outputRole || "output",
          targetIndex: index,
          targetCount: node.children.length,
        });
      });
    };
    collect(root, 0);
    const layerWidths = layers.map((layer) =>
      layer.reduce((sum, node) => sum + node.size.width, 0) + Math.max(0, layer.length - 1) * HORIZONTAL_GAP,
    );
    const width = Math.max(720, Math.max(...layerWidths) + 60);
    layers.forEach((layer, depth) => {
      let left = (width - layerWidths[depth]) / 2;
      for (const node of layer) {
        node.x = left;
        node.y = TOP + depth * (64 + LEVEL_GAP);
        left += node.size.width + HORIZONTAL_GAP;
      }
    });
    const height = Math.max(190, TOP + maximumDepth * (64 + LEVEL_GAP) + 64 + 30);
    const left = Math.min(...nodes.map((node) => node.x));
    const top = Math.min(...nodes.map((node) => node.y));
    const right = Math.max(...nodes.map((node) => node.x + node.size.width));
    const bottom = Math.max(...nodes.map((node) => node.y + node.size.height));
    const bounds = {
      x: left,
      y: top,
      width: Math.max(1, right - left),
      height: Math.max(1, bottom - top),
    };
    return { root, nodes, edges, width, height, bounds, maximumDepth };
  }

  function plannerTreeViewKey(layout) {
    return JSON.stringify([
      state.planner.goalClassId,
      state.planner.goalQuantity,
      layout.nodes.map((node) => [node.id, node.kind, node.state, node.depth, node.x, node.y]),
      layout.edges.map((edge) => [edge.source.id, edge.target.id, edge.role]),
    ]);
  }

  function fittedPlannerTreeView(layout = state.planner.layout) {
    if (!layout?.bounds) return null;
    const padding = 28;
    return {
      x: layout.bounds.x - padding,
      y: layout.bounds.y - padding,
      width: layout.bounds.width + padding * 2,
      height: layout.bounds.height + padding * 2,
    };
  }

  function plannerTreeViewBoxValue(view = state.planner.viewBox) {
    if (!view) return "";
    return [view.x, view.y, view.width, view.height]
      .map((value) => Number(value.toFixed(3)))
      .join(" ");
  }

  function plannerNodeStatus(node, timingByStep) {
    if (node.kind === "action") {
      return `STEP ${node.step.index + 1} / ${plannerDirectTimingLabel(timingByStep.get(node.step.id))}`;
    }
    if (node.state === "inventory") return node.isRoot ? "TARGET / LIVE INVENTORY" : "LIVE INVENTORY / NO ACTION";
    if (node.state === "shared") return `FROM STEP ${(node.aliasStep?.index ?? 0) + 1} / SHARED`;
    if (node.state === "cycle") return "CYCLE REFERENCE";
    if (node.state === "search-limit") return "SEARCH LIMIT";
    if (node.diagnostic) return `MISSING / ${node.diagnosticHash ? shortText(node.diagnosticHash, 5, 3) : "NO SOURCE"}`;
    if (node.state === "blocked") return "BLOCKED";
    const summary = node.timing || plannerTimingSummary(node.stepIds, timingByStep);
    return `${node.isRoot ? "TARGET" : "READY"} / ${plannerTimingLabel(summary)}`;
  }

  function plannerObjectDifficulty(node, timingByStep) {
    if (node.kind !== "object") return null;
    if (node.aggregate) return null;
    if (node.state === "inventory") return proofDifficultySummary([], { inventory: true });
    const producerStepId = node.token?.producedByStepId || node.aliasStep?.id || "";
    const workload = producerStepId ? timingByStep.get(producerStepId)?.workload : null;
    return proofDifficultySummary(workload ? [workload] : [], {
      producerCount: workload ? 1 : 0,
      unknownReason: producerStepId ? "producer proof metadata unavailable" : "no producing step selected in this plan",
    });
  }

  function plannerTreeSvg(root, timingByStep, cartridgeName) {
    const layout = layoutPlannerDisplayTree(root);
    if (!layout) return "";
    const viewKey = plannerTreeViewKey(layout);
    state.planner.layout = layout;
    if (state.planner.viewKey !== viewKey || !state.planner.viewBox) {
      state.planner.viewKey = viewKey;
      state.planner.viewBox = fittedPlannerTreeView(layout);
      state.planner.viewMode = "fit";
      state.planner.drag = null;
    }
    const aspect = layout.bounds.width / layout.bounds.height;
    const canvasShape = aspect >= 4 ? "is-wide" : aspect <= 1.35 ? "is-deep" : "is-balanced";
    const denseGraph = layout.nodes.length > 120;
    const edgeMarkup = layout.edges.map((edge) => {
      const sourceX = edge.source.x + edge.source.size.width / 2;
      const sourceY = edge.source.y;
      const targetX = edge.target.x + edge.target.size.width * ((edge.targetIndex + 1) / (edge.targetCount + 1));
      const targetY = edge.target.y + edge.target.size.height;
      const gap = sourceY - targetY;
      const laneWindow = edge.targetCount > 1 ? Math.min(gap * 0.46, (edge.targetCount - 1) * 10) : 0;
      const laneOffset = edge.targetCount > 1
        ? (edge.targetIndex / (edge.targetCount - 1) - 0.5) * laneWindow
        : 0;
      const midY = targetY + gap / 2 + laneOffset;
      const path = denseGraph
        ? `M ${sourceX} ${sourceY} C ${sourceX} ${midY} ${targetX} ${midY} ${targetX} ${targetY}`
        : `M ${sourceX} ${sourceY} V ${midY} H ${targetX} V ${targetY}`;
      const label = ({
        input: "USE",
        output: "MAKE",
        "update-input": "UPDATE IN",
        "update-output": "UPDATE OUT",
        missing: "MISSING",
      })[edge.role] || "FLOW";
      const markerRole = edge.role.startsWith("update-") ? "update" : edge.role;
      const labelWidth = Math.max(38, label.length * 5.2 + 12);
      const labelX = sourceX + (targetX - sourceX) * 0.5;
      const showLabel = !denseGraph || edge.target.depth <= 2;
      return `
        <g class="planner-edge planner-edge-${edge.role}" aria-hidden="true">
          <path class="planner-edge-halo" d="${path}"></path>
          <path class="planner-edge-line" d="${path}" marker-end="url(#planner-arrow-${markerRole})"></path>
          ${showLabel ? `<g class="planner-edge-label" transform="translate(${labelX} ${midY})"><rect x="${-labelWidth / 2}" y="-7" width="${labelWidth}" height="14"></rect><text y="3">${label}</text></g>` : ""}
        </g>`;
    }).join("");
    const nodeMarkup = layout.nodes.map((node) => {
      const classes = ["planner-node", `planner-node-${node.kind}`, `is-${node.state}`];
      if (node.isRoot) classes.push("is-target");
      const lines = techTreeNodeLabelLines(node.label, 18);
      const status = plannerNodeStatus(node, timingByStep);
      const difficulty = plannerObjectDifficulty(node, timingByStep);
      const inventorySource = node.state === "inventory" && node.token
        ? ` Driver object: ${node.token.fileName || node.token.contentHash || node.token.tokenId}.`
        : "";
      const shape = node.kind === "action"
        ? `<path class="planner-node-frame" d="M ${node.x + 12} ${node.y} H ${node.x + node.size.width - 12} L ${node.x + node.size.width} ${node.y + 12} V ${node.y + node.size.height - 12} L ${node.x + node.size.width - 12} ${node.y + node.size.height} H ${node.x + 12} L ${node.x} ${node.y + node.size.height - 12} V ${node.y + 12} Z"></path>`
        : `<rect class="planner-node-frame" x="${node.x}" y="${node.y}" width="${node.size.width}" height="${node.size.height}"></rect><rect class="planner-object-tab" x="${node.x + 12}" y="${node.y - 4}" width="34" height="7"></rect>`;
      const textX = node.x + node.size.width / 2;
      const firstY = node.y + (lines.length > 1 ? 20 : 25);
      const difficultyMarkup = difficulty
        ? proofDifficultySvgMarkup(difficulty, node.x + node.size.width - 20, node.y + 5, 2)
        : "";
      return `
        <g class="${classes.join(" ")}" aria-hidden="true">
          <title>${escapeHtml(`${node.label}: ${status}.${inventorySource}${difficulty ? ` ${difficulty.text}.` : ""}`)}</title>
          ${shape}
          ${difficultyMarkup}
          ${lines.map((line, index) => `<text class="planner-node-label" x="${textX}" y="${firstY + index * 12}">${escapeHtml(line)}</text>`).join("")}
          <text class="planner-node-status" x="${textX}" y="${node.y + node.size.height - 9}">${escapeHtml(status)}</text>
        </g>`;
    }).join("");
    const accessibleDifficulty = layout.nodes
      .filter((node) => node.kind === "object" && !node.aggregate)
      .map((node) => {
        const difficulty = plannerObjectDifficulty(node, timingByStep);
        return `<li>${escapeHtml(`${node.label}: ${difficulty?.text || "PoW unknown, VDF unknown"}`)}</li>`;
      }).join("");
    return `
      <div id="planner-tree-canvas" class="planner-tree-canvas ${canvasShape}" data-plan-node-count="${layout.nodes.length}">
        <div class="planner-tree-control-bar">
          <div class="planner-tree-control-copy" aria-hidden="true"><strong>Plan map</strong><span>Drag to pan / wheel to zoom</span></div>
          <div class="game-toolbar-group planner-tree-view-controls" role="group" aria-label="Plan map view controls">
            ${gameButton("-", "planner-tree-zoom-out", { extra: ' aria-label="Zoom out plan map" title="Zoom out" aria-keyshortcuts="-"' })}
            ${gameButton("Fit", "planner-tree-fit", { extra: ' aria-label="Fit complete plan path" title="Fit complete plan path" aria-keyshortcuts="0 Home"' })}
            ${gameButton("+", "planner-tree-zoom-in", { extra: ' aria-label="Zoom in plan map" title="Zoom in" aria-keyshortcuts="+"' })}
            <output class="planner-tree-zoom-label" data-planner-tree-zoom aria-live="polite">100%</output>
            <button class="game-button planner-tree-fullscreen-button" type="button" data-command="planner-tree-fullscreen" aria-label="Enter plan map fullscreen" title="Enter plan map fullscreen" aria-pressed="false">
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path d="M14 4h6v6 M20 4l-7 7 M10 20H4v-6 M4 20l7-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter"></path></svg>
              <span data-planner-fullscreen-label>Full</span>
            </button>
          </div>
        </div>
        <div id="planner-tree-viewport" class="planner-tree-viewport" role="region" aria-label="Goal dependency map. Drag to pan, use the mouse wheel or plus and minus keys to zoom, and press zero to fit the complete plan.">
          <svg id="planner-tree-svg" class="planner-tree-svg" viewBox="${plannerTreeViewBoxValue()}" preserveAspectRatio="xMidYMid meet" role="img" tabindex="0" aria-labelledby="planner-tree-title planner-tree-description">
            <title id="planner-tree-title">${escapeHtml(cartridgeName)} goal plan</title>
            <desc id="planner-tree-description">The target object is at the top. Created objects flow upward from actions; required objects flow upward into the actions that use them. Object badges show PoW with a pick and VDF with an hourglass; green is low, yellow is medium or unknown, and red is high. Dashed update arcs mark paired same-class input and output turnover whose post-state is not simulated. Dotted missing lines summarize unresolved prerequisite diagnostics rather than direct input or output relationships. The complete path is fitted automatically; drag to pan and zoom for detail.</desc>
            <defs>
              <marker id="planner-arrow-input" class="planner-marker-input" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M 0 0 L 10 5 L 0 10 Z"></path></marker>
              <marker id="planner-arrow-output" class="planner-marker-output" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M 1 5 L 5 1 L 9 5 L 5 9 Z"></path></marker>
              <marker id="planner-arrow-update" class="planner-marker-update" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M 1 1 H 9 V 9 H 1 Z"></path></marker>
              <marker id="planner-arrow-missing" class="planner-marker-missing" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><circle cx="5" cy="5" r="3.5"></circle></marker>
            </defs>
            ${edgeMarkup}
            ${nodeMarkup}
          </svg>
          <div class="sr-only"><span>Object proof difficulty in this plan:</span><ul>${accessibleDifficulty}</ul></div>
        </div>
      </div>`;
  }

  function plannerStepListMarkup(context, timingByStep) {
    const steps = context.result?.steps || [];
    if (!steps.length) return "";
    const repeatQuantity = plannerExecutionMultiplier(context.result);
    const executionLabel = context.result?.execution?.mode === "repeat-unit"
      ? `One goal-batch path / ~${repeatQuantity} live-replanned batches`
      : "Execution order";
    return `
      <section class="game-panel planner-step-panel" aria-labelledby="planner-steps-title">
        <div class="game-panel-header"><h2 id="planner-steps-title">Action set</h2><span>${escapeHtml(executionLabel)}</span></div>
        <div class="planner-step-list">
          ${steps.map((step) => {
            const timing = timingByStep.get(step.id);
            const inputEntries = step.inputs.map((input) => {
              const role = plannerStepSlotRole(step, input.classId, input.slotIndex, "input", context.catalog);
              const source = input.sourceKind === "inventory" ? "on hand" : `step ${Number(input.sourceStepId?.split(":")[1]) || "?"}`;
              return { text: `${input.classLabel} / ${source}`, update: role === "update-input" };
            });
            const outputEntries = step.outputs.map((output) => {
              const role = plannerStepSlotRole(step, output.classId, output.slotIndex, "output", context.catalog);
              return { text: output.classLabel, update: role === "update-output" };
            });
            const inputs = inputEntries.filter((item) => !item.update).map((item) => item.text).join("; ") || "none";
            const outputs = outputEntries.filter((item) => !item.update).map((item) => item.text).join("; ") || "none";
            const updateInputs = inputEntries.filter((item) => item.update).map((item) => item.text).join("; ");
            const updateOutputs = outputEntries.filter((item) => item.update).map((item) => item.text).join("; ");
            const flowLines = [
              `Use: ${inputs}`,
              `Make: ${outputs}`,
              updateInputs || updateOutputs ? `Update: ${updateInputs || "unknown input"} -> ${updateOutputs || "unknown output"}` : "",
            ].filter(Boolean).map(escapeHtml).join("<br />");
            return `
              <button id="planner-${escapeHtml(step.id)}" class="planner-step-row" type="button" data-command="setup-action" data-id="${escapeHtml(step.actionKey)}">
                <span class="planner-step-number">${String(step.index + 1).padStart(2, "0")}</span>
                <span class="planner-step-copy"><strong>${escapeHtml(step.label)}</strong><small>${flowLines}</small></span>
                <span class="planner-step-time"><strong>${escapeHtml(plannerDirectTimingLabel(timing))}</strong><small>${escapeHtml(plannerDirectTimingBreakdown(timing))}</small></span>
              </button>`;
          }).join("")}
        </div>
      </section>`;
  }

  function plannerGoalWorkflowFingerprint(context) {
    const workflow = state.goalWorkflow;
    return JSON.stringify([
      workflow?.id || "",
      workflow?.status || "",
      goalWorkflowCompletedCount(workflow),
      Boolean(state.goalWorkflowPreparing),
      connectionStatus(activeConnection()?.id).state,
      hardwareIndexUiIsActive(),
      context?.result?.status || "",
      context?.result?.steps?.length || 0,
      context?.result?.goal?.classId || "",
      context?.result?.goal?.quantity || 0,
    ]);
  }

  function plannerGoalWorkflowMarkup(context) {
    const result = context?.result;
    const workflow = state.goalWorkflow;
    const blockingWorkflow = goalWorkflowBlocksNewPlan(workflow);
    const online = connectionStatus(activeConnection()?.id).state === "online";
    const fingerprint = escapeHtml(plannerGoalWorkflowFingerprint(context));
    if (blockingWorkflow) {
      const completed = goalWorkflowCompletedCount(workflow);
      const actionTotalLabel = goalWorkflowActionTotalLabel(workflow);
      return `
        <section class="planner-workflow-launch is-active" data-goal-workflow-launch data-goal-workflow-fingerprint="${fingerprint}" aria-label="Goal workflow">
          <div><span>Action flow</span><strong>${escapeHtml(goalWorkflowStatusLabel(workflow))}</strong><small>${escapeHtml(goalWorkflowGoalLabel(workflow))} / ${completed} of ${actionTotalLabel} actions verified</small></div>
          <button class="game-button game-button-primary" type="button" data-command="manage-goal-workflow">Open workflow</button>
        </section>`;
    }
    if (state.goalWorkflowPreparing) {
      return `
        <section class="planner-workflow-launch" data-goal-workflow-launch data-goal-workflow-fingerprint="${fingerprint}" aria-label="Goal workflow" aria-busy="true">
          <div><span>Action flow</span><strong>Refreshing live plan</strong><small>Rechecking the selected Driver before the workflow is frozen.</small></div>
          <button class="game-button game-button-primary" type="button" disabled>Preparing...</button>
        </section>`;
    }
    if (result?.status === "planned" && result.steps?.length) {
      const disabled = !online || hardwareIndexUiIsActive();
      const reason = !online
        ? "The selected Driver must be online."
        : hardwareIndexUiIsActive()
          ? "Wait for the CWI action to finish before starting an automated flow."
          : "Open a preflight manager, then press Play to submit the action set one step at a time.";
      return `
        <section class="planner-workflow-launch" data-goal-workflow-launch data-goal-workflow-fingerprint="${fingerprint}" aria-label="Goal workflow">
          <div><span>Action flow</span><strong>Run this plan</strong><small>${escapeHtml(reason)}</small></div>
          <button class="game-button game-button-primary" type="button" data-command="prepare-goal-workflow"${disabled ? " disabled" : ""}><span aria-hidden="true">&#9654;</span> <span>Run action set</span></button>
        </section>`;
    }
    const satisfied = result?.status === "satisfied";
    return `
      <section class="planner-workflow-launch is-disabled" data-goal-workflow-launch data-goal-workflow-fingerprint="${fingerprint}" aria-label="Goal workflow">
        <div><span>Action flow</span><strong>${satisfied ? "Goal already available" : "No executable flow"}</strong><small>${satisfied ? "This plan needs no Driver actions." : "Resolve the planner diagnostics before starting a workflow."}</small></div>
        <button class="game-button" type="button" disabled>${satisfied ? "Already complete" : "Flow unavailable"}</button>
      </section>`;
  }

  function plannerResultMarkup(context) {
    if (context.error) return `<div class="terminal-note error" role="alert">${escapeHtml(context.error)}</div>`;
    const result = context.result;
    if (!result) return '<div class="game-panel"><div class="game-empty"><h2>No goal outputs</h2><p>This cartridge has no action with a positive net object output.</p></div></div>';
    const timingByStep = new Map();
    for (const step of result.steps) {
      const action = plannerActionForStep(step, context.catalog);
      timingByStep.set(step.id, action ? estimateActionProofTiming(action) : null);
    }
    const executionMultiplier = plannerExecutionMultiplier(result);
    const totalTiming = plannerTimingSummary(result.steps.map((step) => step.id), timingByStep, executionMultiplier);
    const totalWorkload = plannerWorkloadSummary(result.steps.map((step) => step.id), timingByStep, executionMultiplier);
    const cwi = currentHardwareIndex();
    const hasExecutablePlan = result.status === "planned" || result.status === "satisfied";
    const totalLabel = hasExecutablePlan ? plannerTimingLabel(totalTiming) : "No plan";
    const totalBasis = !hasExecutablePlan
      ? "No executable action set"
      : !totalTiming.count
        ? "Already available / no actions"
        : totalTiming.requiresCwi
          ? "Run CWI to apply the MineIron proof-window baseline"
          : `${totalTiming.count} action${totalTiming.count === 1 ? "" : "s"} / ${formatProofDuration(totalTiming.nominalMilliseconds)} nominal + ${formatProofDuration(totalTiming.operationalAllowanceMilliseconds)} operational allowance`;
    const tree = buildPlannerDisplayTree(result, timingByStep, context.catalog);
    const stateLabel = {
      satisfied: "Already on hand",
      planned: "Plan ready",
      unreachable: "Blocked",
      "search-limit": "Search limit",
      "invalid-goal": "Invalid goal",
    }[result.status] || result.status;
    const cwiControl = !cwi && totalTiming.requiresCwi
      ? hardwareIndexUiIsActive()
        ? `<button class="game-button primary" type="button" disabled>${state.hardwareIndex.status === "settling" ? "MineIron settling" : "CWI measuring"}</button>`
        : gameButton("Run CWI", "run-hardware-index", { tone: "primary" })
      : "";
    const groundingNote = cwi
      ? `Observed MineIron proof window ${formatProofDuration(cwi.durationMs)} / workload and I/O scaled / ${formatProofDuration(ACTION_COMMIT_ALLOWANCE_MS)} commit per action / ${Math.round(ACTION_OPERATIONAL_CONTINGENCY * 100)}% operations / ${formatDate(cwi.measuredAt)}`
      : totalTiming.requiresCwi
        ? hardwareIndexUiIsActive()
          ? state.hardwareIndex.status === "settling"
            ? "MineIron is settling, but no trustworthy proof window was saved"
            : `Measuring a real MineIron proof window on ${state.hardwareIndex.activeRun?.connectionName || "another Driver"}`
          : "Required for a selected-Driver proof-window baseline"
        : totalTiming.directWorkCount
          ? "Timing coverage incomplete"
          : "No readable timed gates";
    const actionSetBasis = result.execution?.mode === "repeat-unit"
      ? `${result.totals.unitActionCount} action${result.totals.unitActionCount === 1 ? "" : "s"} in the first goal batch / live replan until ${result.goal.quantity} objects are verified`
      : result.strategy === "goal-directed-fallback"
      ? `${result.totals.expandedStates.toLocaleString()} shortest-search states / valid fallback`
      : result.strategy === "inventory"
        ? "No actions required"
        : `${result.totals.expandedStates.toLocaleString()} states checked`;
    const hasMissingBranches = tree?.children?.some((child) => child.inputRole === "missing");
    const startingInventory = result.tokens.filter(
      (token) => token.kind === "inventory" && (token.consumedByStepId || result.goalTokenIds.includes(token.tokenId)),
    );
    const startingCounts = new Map();
    for (const token of startingInventory) {
      startingCounts.set(token.classLabel, (startingCounts.get(token.classLabel) || 0) + 1);
    }
    const startingItems = [...startingCounts]
      .sort(([left], [right]) => plannerCompareText(left, right))
      .map(([label, count]) => `${count} ${label}`);
    const visibleStartingItems = startingItems.slice(0, 5);
    if (startingItems.length > visibleStartingItems.length) {
      visibleStartingItems.push(`+${startingItems.length - visibleStartingItems.length} more types`);
    }
    const inventoryKey = startingItems.length
      ? `<span title="${escapeHtml(`Current live Driver objects used by this plan: ${startingItems.join(", ")}`)}"><i class="planner-key-inventory" aria-hidden="true"></i>LIVE DRIVER / ${escapeHtml(visibleStartingItems.join(", "))}</span>`
      : "";
    const treeGuide = result.execution?.mode === "repeat-unit"
      ? `One exact goal-batch path is shown; the ${result.goal.quantity}-object total is scaled here, and the controller replans from live inventory between batches.`
      : result.steps.length > 40
      ? "The complete path is fitted; zoom for detail and drag to pan. UPDATE tools remain compact references."
      : "The complete path is fitted. Read down for requirements; arrows flow up toward the target.";
    const goalRule = `craft ${result.goal.quantity} new / ${result.goal.initialCount} on hand / finish with at least ${result.goal.targetCount}`;
    const diagnosticMarkup = (result.diagnostics || []).map((diagnostic) => {
      const classIds = [...new Set(diagnostic.classIds || [])];
      const actionIds = [...new Set(diagnostic.actionIds || [])];
      const classRefs = classIds.slice(0, 6).map((classId) => {
        const item = context.catalog?.classById?.get(classId);
        return item ? `${item.label} / ${shortText(item.hash, 6, 4)}` : classId;
      });
      if (classIds.length > classRefs.length) classRefs.push(`+${classIds.length - classRefs.length} more`);
      const actionRefs = actionIds.slice(0, 6).map((actionId) => context.catalog?.actionById?.get(actionId)?.label || actionId);
      if (actionIds.length > actionRefs.length) actionRefs.push(`+${actionIds.length - actionRefs.length} more`);
      const references = [
        classRefs.length ? `Objects: ${classRefs.join("; ")}` : "",
        actionRefs.length ? `Actions: ${actionRefs.join("; ")}` : "",
      ].filter(Boolean).join(" / ");
      return `<li><span>${escapeHtml(diagnostic.message)}</span>${references ? `<small>${escapeHtml(references)}</small>` : ""}</li>`;
    });
    const warningMarkup = [...new Set([
      ...(result.warnings || []),
      ...result.steps.flatMap((step) => step.warnings || []),
    ])].filter(Boolean).map((message) => `<li><span>${escapeHtml(message)}</span></li>`);
    return `
      <div class="planner-summary" aria-label="Plan summary">
        <div class="planner-summary-item"><span>Goal state</span><strong>${escapeHtml(stateLabel)}</strong><small>${escapeHtml(result.goal.label)} / ${escapeHtml(shortText(result.goal.hash, 6, 4))} / ${escapeHtml(goalRule)}</small></div>
        <div class="planner-summary-item"><span>Estimated total time</span><strong aria-live="polite" aria-atomic="true">${escapeHtml(totalLabel)}</strong><small>${escapeHtml(totalBasis)}<br />${escapeHtml(plannerWorkloadLabel(totalWorkload))}</small></div>
        <div class="planner-summary-item"><span>Action set</span><strong>${result.totals.actionCount}</strong><small>${escapeHtml(actionSetBasis)}</small></div>
        <div class="planner-summary-item"><span>Grounding</span><strong>${cwi ? `${HARDWARE_INDEX_LABEL} ${formatProofDuration(cwi.durationMs)}` : "No CWI"}</strong><small>${escapeHtml(groundingNote)}</small>${cwiControl}</div>
      </div>
      ${plannerGoalWorkflowMarkup(context)}
      <div class="planner-flow-key" aria-label="Plan relationship legend"><span><i class="planner-key-input" aria-hidden="true"></i>USE / consumed input</span><span><i class="planner-key-output" aria-hidden="true"></i>MAKE / created output</span><span><i class="planner-key-update" aria-hidden="true"></i>UPDATE / paired turnover</span>${inventoryKey}${hasMissingBranches ? '<span><i class="planner-key-missing" aria-hidden="true"></i>MISSING / unresolved prerequisite</span>' : ""}<span class="work-gate-key"><b class="gate-symbol" aria-hidden="true">⛏</b>PoW <b class="gate-symbol" aria-hidden="true">⌛</b>VDF <small><i class="gate-tone is-green" aria-hidden="true"></i>low <i class="gate-tone is-yellow" aria-hidden="true"></i>mid/? <i class="gate-tone is-red" aria-hidden="true"></i>high</small></span><span>${escapeHtml(treeGuide)}</span></div>
      ${plannerTreeSvg(tree, timingByStep, context.cartridge.name)}
      ${plannerStepListMarkup(context, timingByStep)}
      ${diagnosticMarkup.length || warningMarkup.length ? `<div class="terminal-note warning planner-diagnostics"><strong>Plan limits</strong><ul>${[...diagnosticMarkup, ...warningMarkup].slice(0, 8).join("")}</ul></div>` : ""}`;
  }

  function plannerGoalOptionsMarkup(context) {
    return `<option value="">Choose an object to craft</option>${context.options.map((option) => {
      const selected = option.classId === state.planner.goalClassId ? " selected" : "";
      const plugin = option.qualified?.pluginName && option.qualified.pluginName !== context.cartridge?.id
        ? ` / ${option.qualified.pluginName}`
        : "";
      const onHand = context.inventory?.counts?.get(option.classId) || 0;
      return `<option value="${escapeHtml(option.classId)}"${selected}>${escapeHtml(`${option.label}${plugin} / ${shortText(option.hash, 6, 4)} / ${onHand} live`)}</option>`;
    }).join("")}`;
  }

  function renderPlanner() {
    const cartridge = selectedCartridge();
    if (!cartridge) {
      return `
        <section class="game-screen" aria-labelledby="planner-title">
          ${screenHeading("Goal planner", "No cartridge selected", "Choose a cartridge before building an action plan.", backButton())}
          ${errorPanel("Select a cartridge", "The planner works from one cartridge's flattened action signatures.", "cartridges")}
        </section>`;
    }
    const context = plannerContext(cartridge);
    return `
      <section class="game-screen game-screen-wide planner-screen" aria-labelledby="planner-title">
        ${screenHeading(
          `${cartridge.name} cartridge`,
          "Goal Planner",
          "Choose the object you want to craft, and the quantity you need",
        )}
        ${cartridgeNavigation("planner")}
        <div class="planner-toolbar">
          <label for="planner-goal-select"><span>Target object</span><select id="planner-goal-select" class="game-select"${context.options.length ? "" : " disabled"}>${plannerGoalOptionsMarkup(context)}</select></label>
          <label for="planner-goal-quantity"><span>Quantity</span><input id="planner-goal-quantity" class="game-input planner-quantity-input" type="number" min="1" max="${PLANNER_MAX_QUANTITY}" step="1" inputmode="numeric" value="${state.planner.goalQuantity}"${context.options.length ? "" : " disabled"} aria-describedby="planner-quantity-help" /><small id="planner-quantity-help" class="sr-only">Whole number from 1 to ${PLANNER_MAX_QUANTITY}.</small></label>
        </div>
        <div data-catalog-region="planner" data-planner-result>${plannerResultMarkup(context)}</div>
      </section>`;
  }

  function syncPlannerTreeFullscreenUi() {
    const canvas = byId("planner-tree-canvas");
    const nativeActive = Boolean(canvas && techTreeFullscreenElement() === canvas);
    if (nativeActive) state.planner.fullscreenFallback = false;
    const fallbackActive = Boolean(canvas && state.planner.fullscreenFallback && !nativeActive);
    const active = nativeActive || fallbackActive;
    canvas?.classList.toggle("is-pseudo-fullscreen", fallbackActive);
    document.documentElement.classList.toggle("has-planner-tree-fullscreen", active);
    const button = canvas?.querySelector("[data-command='planner-tree-fullscreen']");
    if (button) {
      const label = active ? "Exit plan map fullscreen" : "Enter plan map fullscreen";
      button.setAttribute("aria-label", label);
      button.setAttribute("title", label);
      button.setAttribute("aria-pressed", String(active));
      const visibleLabel = button.querySelector("[data-planner-fullscreen-label]");
      if (visibleLabel) visibleLabel.textContent = active ? "Exit" : "Full";
    }
  }

  function enablePlannerTreeFullscreenFallback() {
    if (state.screen !== "planner" || !byId("planner-tree-canvas")) return;
    state.planner.fullscreenRequestPending = false;
    state.planner.fullscreenFallback = true;
    syncPlannerTreeFullscreenUi();
  }

  async function togglePlannerTreeFullscreen() {
    const canvas = byId("planner-tree-canvas");
    if (!canvas) return;
    const nativeElement = techTreeFullscreenElement();
    if (nativeElement === canvas) {
      state.planner.fullscreenRequestPending = false;
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      try {
        const result = exit?.call(document);
        if (result?.then) await result;
      } catch {
        // The fullscreenchange event remains authoritative if exit rejects.
      }
      syncPlannerTreeFullscreenUi();
      return;
    }
    if (state.planner.fullscreenFallback) {
      state.planner.fullscreenFallback = false;
      syncPlannerTreeFullscreenUi();
      return;
    }

    const request = canvas.requestFullscreen || canvas.webkitRequestFullscreen;
    if (!request) {
      enablePlannerTreeFullscreenFallback();
      return;
    }
    state.planner.fullscreenRequestPending = true;
    try {
      const result = request.call(canvas);
      if (result?.then) {
        await result;
        state.planner.fullscreenRequestPending = false;
        if (techTreeFullscreenElement() !== canvas) enablePlannerTreeFullscreenFallback();
        else syncPlannerTreeFullscreenUi();
      } else {
        window.setTimeout(() => {
          if (!state.planner.fullscreenRequestPending) return;
          if (techTreeFullscreenElement() === byId("planner-tree-canvas")) {
            state.planner.fullscreenRequestPending = false;
            syncPlannerTreeFullscreenUi();
          } else {
            enablePlannerTreeFullscreenFallback();
          }
        }, 500);
      }
    } catch {
      enablePlannerTreeFullscreenFallback();
    }
  }

  function cleanupPlannerTreeFullscreen() {
    state.planner.fullscreenFallback = false;
    state.planner.fullscreenRequestPending = false;
    state.planner.deferredReplan = null;
    cancelPlannerTreePan();
    byId("planner-tree-canvas")?.classList.remove("is-pseudo-fullscreen");
    document.documentElement.classList.remove("has-planner-tree-fullscreen");
    const nativeElement = techTreeFullscreenElement();
    if (nativeElement?.id === "planner-tree-canvas") {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      try {
        const result = exit?.call(document);
        if (result?.catch) result.catch(() => {});
      } catch {
        // Removing the fullscreen element also asks the browser to exit.
      }
    }
  }

  function handlePlannerTreeFullscreenChange() {
    state.planner.fullscreenRequestPending = false;
    syncPlannerTreeFullscreenUi();
    if (techTreeFullscreenElement()?.id === "planner-tree-canvas" || state.planner.deferredReplan === null) return;
    const replan = state.planner.deferredReplan;
    state.planner.deferredReplan = null;
    requestAnimationFrame(() => patchPlanner({ replan }));
  }

  function handlePlannerTreeFullscreenError() {
    if (state.planner.fullscreenRequestPending) enablePlannerTreeFullscreenFallback();
  }

  function trapPlannerTreeFullscreenFocus(event) {
    if (!state.planner.fullscreenFallback || event.key !== "Tab") return false;
    const canvas = byId("planner-tree-canvas");
    if (!canvas) return false;
    const focusable = [...canvas.querySelectorAll("button:not([disabled]), [tabindex]:not([tabindex='-1'])")]
      .filter((element) => element.getAttribute("aria-disabled") !== "true");
    if (!focusable.length) return false;
    const current = focusable.indexOf(document.activeElement);
    if (current < 0 || (!event.shiftKey && current === focusable.length - 1) || (event.shiftKey && current === 0)) {
      event.preventDefault();
      focusable[event.shiftKey ? focusable.length - 1 : 0].focus({ preventScroll: true });
      return true;
    }
    return false;
  }

  function plannerTreeZoomLimits() {
    const layout = state.planner.layout;
    const fitted = fittedPlannerTreeView(layout);
    if (!layout || !fitted) return null;
    return {
      fitted,
      minimumWidth: Math.max(90, layout.bounds.width * 0.04),
      maximumWidth: Math.max(1200, fitted.width * 4),
    };
  }

  function updatePlannerTreeViewControls() {
    const canvas = byId("planner-tree-canvas");
    const current = state.planner.viewBox;
    const limits = plannerTreeZoomLimits();
    if (!canvas || !current || !limits) return;
    const percent = Math.max(1, Math.round((limits.fitted.width / current.width) * 100));
    const output = canvas.querySelector("[data-planner-tree-zoom]");
    if (output) output.textContent = `${percent}%`;
    const zoomIn = canvas.querySelector("[data-command='planner-tree-zoom-in']");
    const zoomOut = canvas.querySelector("[data-command='planner-tree-zoom-out']");
    if (zoomIn) zoomIn.disabled = current.width <= limits.minimumWidth * 1.001;
    if (zoomOut) zoomOut.disabled = current.width >= limits.maximumWidth * 0.999;
  }

  function applyPlannerTreeViewBox() {
    const svg = byId("planner-tree-svg");
    const value = plannerTreeViewBoxValue();
    if (!svg || !value) return;
    svg.setAttribute("viewBox", value);
    updatePlannerTreeViewControls();
  }

  function mountPlannerTree() {
    if (state.screen !== "planner" || !byId("planner-tree-svg") || !state.planner.layout) return;
    applyPlannerTreeViewBox();
    syncPlannerTreeFullscreenUi();
  }

  function fitPlannerTree() {
    const fitted = fittedPlannerTreeView();
    if (!fitted) return;
    state.planner.viewBox = fitted;
    state.planner.viewMode = "fit";
    applyPlannerTreeViewBox();
  }

  function zoomPlannerTree(factor, anchor = null) {
    const current = state.planner.viewBox;
    const limits = plannerTreeZoomLimits();
    if (!current || !limits || !Number.isFinite(factor) || factor <= 0) return;
    const anchorX = anchor?.x ?? current.x + current.width / 2;
    const anchorY = anchor?.y ?? current.y + current.height / 2;
    const nextWidth = Math.min(limits.maximumWidth, Math.max(limits.minimumWidth, current.width * factor));
    if (Math.abs(nextWidth - current.width) < 0.0001) return;
    const scale = nextWidth / current.width;
    const nextHeight = current.height * scale;
    const anchorRatioX = (anchorX - current.x) / current.width;
    const anchorRatioY = (anchorY - current.y) / current.height;
    state.planner.viewBox = {
      x: anchorX - nextWidth * anchorRatioX,
      y: anchorY - nextHeight * anchorRatioY,
      width: nextWidth,
      height: nextHeight,
    };
    state.planner.viewMode = "manual";
    applyPlannerTreeViewBox();
  }

  function panPlannerTree(horizontal, vertical) {
    const current = state.planner.viewBox;
    if (!current) return;
    state.planner.viewBox = {
      ...current,
      x: current.x + current.width * horizontal,
      y: current.y + current.height * vertical,
    };
    state.planner.viewMode = "manual";
    applyPlannerTreeViewBox();
  }

  function plannerTreeInverseScreenMatrix(svg) {
    try {
      return svg.getScreenCTM?.()?.inverse?.() || null;
    } catch {
      return null;
    }
  }

  function plannerTreePointFromClient(svg, clientX, clientY, inverse = null) {
    const matrix = inverse || plannerTreeInverseScreenMatrix(svg);
    if (matrix) {
      try {
        if (typeof DOMPoint === "function") {
          const point = new DOMPoint(clientX, clientY).matrixTransform(matrix);
          return { x: point.x, y: point.y };
        }
        const point = svg.createSVGPoint?.();
        if (point) {
          point.x = clientX;
          point.y = clientY;
          const transformed = point.matrixTransform(matrix);
          return { x: transformed.x, y: transformed.y };
        }
      } catch {
        // Fall through to preserveAspectRatio-aware rectangle conversion.
      }
    }
    const rect = svg.getBoundingClientRect();
    const view = state.planner.viewBox;
    if (!rect.width || !rect.height || !view) return null;
    const scale = Math.min(rect.width / view.width, rect.height / view.height);
    if (!Number.isFinite(scale) || scale <= 0) return null;
    const insetX = (rect.width - view.width * scale) / 2;
    const insetY = (rect.height - view.height * scale) / 2;
    return {
      x: view.x + (clientX - rect.left - insetX) / scale,
      y: view.y + (clientY - rect.top - insetY) / scale,
    };
  }

  function beginPlannerTreePan(event) {
    const svg = event.target.closest?.("#planner-tree-svg");
    if (!svg || event.button !== 0 || !state.planner.viewBox) return;
    const inverse = plannerTreeInverseScreenMatrix(svg);
    const start = plannerTreePointFromClient(svg, event.clientX, event.clientY, inverse);
    if (!start) return;
    state.planner.drag = {
      pointerId: event.pointerId,
      inverse,
      start,
      viewBox: { ...state.planner.viewBox },
    };
    state.planner.viewMode = "manual";
    svg.classList.add("is-dragging");
    svg.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  function cancelPlannerTreePan() {
    const drag = state.planner.drag;
    const svg = byId("planner-tree-svg");
    state.planner.drag = null;
    svg?.classList.remove("is-dragging");
    if (drag && svg?.hasPointerCapture?.(drag.pointerId)) svg.releasePointerCapture(drag.pointerId);
  }

  function movePlannerTreePan(event) {
    const drag = state.planner.drag;
    const svg = byId("planner-tree-svg");
    if (!drag || !svg || drag.pointerId !== event.pointerId) return;
    const point = plannerTreePointFromClient(svg, event.clientX, event.clientY, drag.inverse);
    if (!point) return;
    state.planner.viewBox = {
      ...drag.viewBox,
      x: drag.viewBox.x - (point.x - drag.start.x),
      y: drag.viewBox.y - (point.y - drag.start.y),
    };
    applyPlannerTreeViewBox();
    event.preventDefault();
  }

  function endPlannerTreePan(event) {
    const drag = state.planner.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    cancelPlannerTreePan();
  }

  function wheelPlannerTree(event) {
    const svg = event.target.closest?.("#planner-tree-svg");
    if (!svg || !state.planner.viewBox) return;
    const anchor = plannerTreePointFromClient(svg, event.clientX, event.clientY);
    if (!anchor) return;
    const factor = Math.min(1.35, Math.max(0.74, Math.exp(event.deltaY * 0.0014)));
    zoomPlannerTree(factor, anchor);
    event.preventDefault();
  }

  function handlePlannerTreeKeydown(event) {
    if (!event.target.closest?.("#planner-tree-svg")) return false;
    if (event.key === "+" || event.key === "=") zoomPlannerTree(0.78);
    else if (event.key === "-" || event.key === "_") zoomPlannerTree(1.28);
    else if (event.key === "0" || event.key === "Home") fitPlannerTree();
    else if (event.key === "ArrowLeft") panPlannerTree(-0.1, 0);
    else if (event.key === "ArrowRight") panPlannerTree(0.1, 0);
    else if (event.key === "ArrowUp") panPlannerTree(0, -0.1);
    else if (event.key === "ArrowDown") panPlannerTree(0, 0.1);
    else return false;
    event.preventDefault();
    event.stopPropagation();
    return true;
  }

  function patchPlanner({ replan = true } = {}) {
    if (state.screen !== "planner") return;
    if (techTreeFullscreenElement()?.id === "planner-tree-canvas") {
      state.planner.deferredReplan = state.planner.deferredReplan === null
        ? replan
        : state.planner.deferredReplan || replan;
      return;
    }
    const region = main.querySelector("[data-planner-result]");
    const focusToken = captureFocus(region);
    const drawerReturnToken = region?.contains(state.drawerReturnFocus)
      ? focusTokenForElement(state.drawerReturnFocus)
      : null;
    const context = plannerContext(selectedCartridge(), { reuseResult: !replan });
    const select = byId("planner-goal-select");
    if (select) {
      select.innerHTML = plannerGoalOptionsMarkup(context);
      select.value = state.planner.goalClassId;
      select.disabled = !context.options.length;
    }
    const quantityInput = byId("planner-goal-quantity");
    if (quantityInput) {
      quantityInput.value = String(state.planner.goalQuantity);
      quantityInput.disabled = !context.options.length;
    }
    if (!region) return;
    cancelPlannerTreePan();
    region.innerHTML = plannerResultMarkup(context);
    mountPlannerTree();
    if (drawerReturnToken) {
      state.drawerReturnFocus = findCapturedFocus(region, drawerReturnToken);
    }
    if (focusToken) {
      requestAnimationFrame(() => {
        const focusTarget = findCapturedFocus(region, focusToken);
        if (focusTarget && !focusTarget.disabled) focusTarget.focus({ preventScroll: true });
        else select?.focus({ preventScroll: true });
      });
    }
  }

  function actionByKey(key) {
    return state.workspace.actions.find((action) => qualifiedKey(action.action) === key) || null;
  }

  function actionSubmissionKey(connection, action, selections) {
    if (!connection || !action) return "";
    return JSON.stringify([
      connection.id,
      qualifiedKey(action.action),
      action.hash || "",
      [...(selections || [])].map(String),
    ]);
  }

  function visibleActionSubmissionKey() {
    if (state.drawer?.type !== "action") return "";
    return actionSubmissionKey(activeConnection(), actionByKey(state.drawer.key), state.drawer.selections);
  }

  function visibleActionMatches(connection, action) {
    return Boolean(
      state.drawer?.type === "action" &&
      activeConnection()?.id === connection?.id &&
      state.drawer.key === qualifiedKey(action?.action),
    );
  }

  async function openActionSetup(key) {
    const action = actionByKey(key);
    if (!action) return toast("Action unavailable", "Refresh the Driver catalog and try again.", "error");
    state.drawer = {
      type: "action",
      key,
      report: null,
      error: null,
      submitError: null,
      loading: true,
      selections: [],
      submitting: false,
      outcomeUnknown: false,
    };
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

  function renderActionTechTreePortal(action, runState = {}) {
    const dependencyFlow = actionDependencyFlow(action);
    const selectedWorkload = actionProofWorkload(action);
    const producerWorkloadsByClass = new Map();
    for (const candidate of selectedCartridge()?.actions || []) {
      const flow = actionDependencyFlow(candidate);
      const workload = actionProofWorkload(candidate);
      for (const ref of [...flow.outputs, ...flow.opaqueOutputs]) {
        const key = classRefKey(ref);
        if (!producerWorkloadsByClass.has(key)) producerWorkloadsByClass.set(key, new Map());
        producerWorkloadsByClass.get(key).set(techTreeActionId(candidate), workload);
      }
    }
    const placeMap = new Map();
    const addPlaces = (refs, role) => {
      for (const { ref, count } of techTreeGroupedRefs(refs)) {
        const key = `${qualifiedKey(ref.class)}@${ref.hash || ""}`;
        const place = placeMap.get(key) || {
          key,
          ref,
          inputCount: 0,
          outputCount: 0,
          opaqueInputCount: 0,
          opaqueOutputCount: 0,
        };
        place[`${role}Count`] += count;
        placeMap.set(key, place);
      }
    };
    addPlaces(dependencyFlow.inputs, "input");
    addPlaces(dependencyFlow.outputs, "output");
    addPlaces(dependencyFlow.opaqueInputs, "opaqueInput");
    addPlaces(dependencyFlow.opaqueOutputs, "opaqueOutput");
    const comparePlaces = (left, right) =>
      (left.ref.class?.name || "").localeCompare(right.ref.class?.name || "") || left.key.localeCompare(right.key);
    const places = [...placeMap.values()].sort(comparePlaces);
    const inputTotal = (place) => place.inputCount + place.opaqueInputCount;
    const outputTotal = (place) => place.outputCount + place.opaqueOutputCount;
    const inputs = places.filter((place) => inputTotal(place) && !outputTotal(place));
    const outputs = places.filter((place) => outputTotal(place) && !inputTotal(place));
    const shared = places.filter((place) => inputTotal(place) && outputTotal(place));
    for (const place of places) {
      const producerWorkloads = outputTotal(place)
        ? [selectedWorkload]
        : [...(producerWorkloadsByClass.get(place.key)?.values() || [])];
      place.proofDifficulty = proofDifficultySummary(producerWorkloads, {
        producerCount: producerWorkloads.length,
        unknownReason: "no producing action in this cartridge",
      });
    }
    const placeWidth = 142;
    const placeHeight = 50;
    const transitionWidth = 146;
    const transitionHeight = 56;
    const sharedGap = 18;
    const width = Math.max(560, shared.length * placeWidth + (shared.length + 1) * sharedGap);
    const inputX = 8;
    const transitionX = (width - transitionWidth) / 2;
    const outputX = width - placeWidth - 8;
    const sideTop = 30;
    const sideRows = Math.max(inputs.length, outputs.length, 1);
    const sideHeight = Math.max(170, sideTop + (sideRows - 1) * 58 + placeHeight + 12);
    const sharedStartY = sideHeight + 96;
    const height = sideHeight + (shared.length ? 96 + placeHeight + 12 : 0);
    const transitionY = sideTop + (sideHeight - sideTop - transitionHeight) / 2;
    const markerScope = newId("action-tree").replace(/[^a-zA-Z0-9_-]/g, "");
    const inputMarkerId = `${markerScope}-input`;
    const outputMarkerId = `${markerScope}-output`;
    const opaqueInputMarkerId = `${markerScope}-opaque-input`;
    const opaqueOutputMarkerId = `${markerScope}-opaque-output`;
    const titleId = `${markerScope}-title`;
    const descriptionId = `${markerScope}-description`;

    const rowY = (index, count) => {
      if (count <= 1) return sideTop + (sideHeight - sideTop - placeHeight) / 2;
      const available = sideHeight - sideTop - placeHeight - 12;
      return sideTop + (available * index) / (count - 1);
    };
    const sharedPosition = (index) => {
      const gap = (width - shared.length * placeWidth) / (shared.length + 1);
      return {
        x: gap + index * (placeWidth + gap),
        y: sharedStartY,
      };
    };
    const placeMarkup = (place, x, y) => {
      const live = compatibleObjects(place.ref).length;
      const lines = techTreeNodeLabelLines(place.ref.class?.name || "Unknown", 12);
      const labelX = 35;
      const lineStart = lines.length > 1 ? 17 : 23;
      const roles = [];
      if (inputTotal(place) && outputTotal(place)) {
        roles.push(`IN x${inputTotal(place)}`, `OUT x${outputTotal(place)}`);
        const unresolved = place.opaqueInputCount + place.opaqueOutputCount;
        if (unresolved) roles.push(`? x${unresolved}`);
      } else {
        if (place.inputCount) roles.push(`CONSUME x${place.inputCount}`);
        if (place.opaqueInputCount) roles.push(`INPUT? x${place.opaqueInputCount}`);
        if (place.outputCount) roles.push(`CREATE x${place.outputCount}`);
        if (place.opaqueOutputCount) roles.push(`OUTPUT? x${place.opaqueOutputCount}`);
      }
      const status = `${roles.join(" / ")}${live ? ` / LIVE x${live}` : ""}`;
      return `
        <g class="tech-tree-node-place${live ? " has-live" : ""}" transform="translate(${x} ${y})" aria-hidden="true">
          <title>${escapeHtml(`${place.ref.class?.name || "Unknown"}: ${place.proofDifficulty.text}`)}</title>
          <rect class="tech-tree-node-frame" width="${placeWidth}" height="${placeHeight}"></rect>
          <rect class="tech-tree-token-well" x="7" y="9" width="22" height="22"></rect>
          <text class="tech-tree-node-emoji" x="18" y="25" text-anchor="middle">${escapeHtml(place.ref.class?.name?.slice(0, 1) || "?")}</text>
          ${proofDifficultySvgMarkup(place.proofDifficulty, placeWidth - 20, 3, 1)}
          <text class="tech-tree-node-label" x="${labelX}" y="${lineStart}">${lines.map((line, index) => `<tspan x="${labelX}" dy="${index ? 11 : 0}">${escapeHtml(line)}</tspan>`).join("")}</text>
          <text class="tech-tree-node-status" x="${placeWidth / 2}" y="44" text-anchor="middle">${escapeHtml(status)}</text>
        </g>`;
    };
    const edgeMarkup = (sourceX, sourceY, targetX, targetY, role, count) => {
      if (!count) return "";
      const offset = ({ input: -9, "opaque-input": 9, output: -9, "opaque-output": 9 })[role] || 0;
      sourceY += offset;
      targetY += offset;
      const control = Math.max(28, Math.abs(targetX - sourceX) * 0.45);
      const markerId = ({
        input: inputMarkerId,
        output: outputMarkerId,
        "opaque-input": opaqueInputMarkerId,
        "opaque-output": opaqueOutputMarkerId,
      })[role];
      const labelX = (sourceX + targetX) / 2;
      const labelY = (sourceY + targetY) / 2;
      const path = `M ${sourceX} ${sourceY} C ${sourceX + control} ${sourceY}, ${targetX - control} ${targetY}, ${targetX} ${targetY}`;
      return `
        <g class="tech-tree-edge tech-tree-edge-${role}" aria-hidden="true">
          <path class="tech-tree-edge-halo" d="${path}"></path>
          <path class="tech-tree-edge-line" d="${path}" marker-end="url(#${markerId})"></path>
          ${techTreeEdgeLabelMarkup(role, count, labelX, labelY)}
        </g>`;
    };
    const sharedEdgeMarkup = (place, x, y, role) => {
      const isInput = role.endsWith("input");
      const markerId = role === "input"
        ? inputMarkerId
        : role === "output"
          ? outputMarkerId
          : role === "opaque-input"
            ? opaqueInputMarkerId
            : opaqueOutputMarkerId;
      const count = role === "input"
        ? place.inputCount
        : role === "output"
          ? place.outputCount
          : role === "opaque-input"
            ? place.opaqueInputCount
            : place.opaqueOutputCount;
      if (!count) return "";
      const transitionCenterX = transitionX + transitionWidth / 2;
      const transitionBottomY = transitionY + transitionHeight;
      const placeCenterX = x + placeWidth / 2;
      const placeTopY = y;
      const sourceX = isInput ? placeCenterX : transitionCenterX;
      const sourceY = isInput ? placeTopY : transitionBottomY;
      const targetX = isInput ? transitionCenterX : placeCenterX;
      const targetY = isInput ? transitionBottomY : placeTopY;
      const busY = sideHeight + 35;
      const lane = ({ input: -18, "opaque-input": -7, output: 7, "opaque-output": 18 })[role] || 0;
      const labelX = (sourceX + targetX) / 2 + lane;
      const labelY = busY + ({ input: -27, "opaque-input": -9, output: 9, "opaque-output": 27 })[role];
      const path = `M ${sourceX} ${sourceY} C ${sourceX + lane} ${busY}, ${targetX + lane} ${busY}, ${targetX} ${targetY}`;
      return `
        <g class="tech-tree-edge tech-tree-edge-${role}" aria-hidden="true">
          <path class="tech-tree-edge-halo" d="${path}"></path>
          <path class="tech-tree-edge-line" d="${path}" marker-end="url(#${markerId})"></path>
          ${techTreeEdgeLabelMarkup(role, count, labelX, labelY)}
        </g>`;
    };

    const parts = [`
      <svg class="action-tech-tree-portal" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-labelledby="${titleId} ${descriptionId}" preserveAspectRatio="xMidYMid meet">
        <title id="${titleId}">${escapeHtml(action.action?.name || "Action")} direct action relationships</title>
        <desc id="${descriptionId}">Only this action transition and its adjacent class states are shown. Consumed inputs are in the left column with triangle markers. Created outputs are in the right column with diamond markers. Dashed open markers identify unresolved slots, and explicit mutations are excluded. Object badges show PoW with a pick and VDF with an hourglass; green is low, yellow is medium or unknown, and red is high. ${escapeHtml(places.map((place) => `${place.ref.class?.name || "Unknown"}: ${place.proofDifficulty.text}`).join("; "))}</desc>
        <defs>
          <marker id="${inputMarkerId}" class="tech-tree-marker tech-tree-marker-input" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z"></path></marker>
          <marker id="${outputMarkerId}" class="tech-tree-marker tech-tree-marker-output" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M 0 5 L 5 0 L 10 5 L 5 10 z"></path></marker>
          <marker id="${opaqueInputMarkerId}" class="tech-tree-marker tech-tree-marker-opaque tech-tree-marker-opaque-input" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M 1 1 L 9 5 L 1 9 z"></path></marker>
          <marker id="${opaqueOutputMarkerId}" class="tech-tree-marker tech-tree-marker-opaque tech-tree-marker-opaque-output" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M 1 5 L 5 1 L 9 5 L 5 9 z"></path></marker>
        </defs>`];

    inputs.forEach((place, index) => {
      const y = rowY(index, inputs.length);
      parts.push(edgeMarkup(inputX + placeWidth, y + placeHeight / 2, transitionX, transitionY + transitionHeight / 2, "input", place.inputCount));
      parts.push(edgeMarkup(inputX + placeWidth, y + placeHeight / 2, transitionX, transitionY + transitionHeight / 2, "opaque-input", place.opaqueInputCount));
    });
    outputs.forEach((place, index) => {
      const y = rowY(index, outputs.length);
      parts.push(edgeMarkup(transitionX + transitionWidth, transitionY + transitionHeight / 2, outputX, y + placeHeight / 2, "output", place.outputCount));
      parts.push(edgeMarkup(transitionX + transitionWidth, transitionY + transitionHeight / 2, outputX, y + placeHeight / 2, "opaque-output", place.opaqueOutputCount));
    });
    shared.forEach((place, index) => {
      const position = sharedPosition(index);
      parts.push(sharedEdgeMarkup(place, position.x, position.y, "input"));
      parts.push(sharedEdgeMarkup(place, position.x, position.y, "opaque-input"));
      parts.push(sharedEdgeMarkup(place, position.x, position.y, "output"));
      parts.push(sharedEdgeMarkup(place, position.x, position.y, "opaque-output"));
    });

    parts.push(`
      <text class="action-tech-tree-column-label is-input" x="${inputX + placeWidth / 2}" y="17" text-anchor="middle">CONSUMED INPUTS</text>
      <text class="action-tech-tree-column-label is-action" x="${transitionX + transitionWidth / 2}" y="17" text-anchor="middle">ACTION TRANSITION</text>
      <text class="action-tech-tree-column-label is-output" x="${outputX + placeWidth / 2}" y="17" text-anchor="middle">CREATED OUTPUTS</text>
      ${shared.length ? `<text class="action-tech-tree-column-label is-shared" x="${width / 2}" y="${sharedStartY - 12}" text-anchor="middle">CONSUMED + CREATED STATES</text>` : ""}`);

    inputs.forEach((place, index) => parts.push(placeMarkup(place, inputX, rowY(index, inputs.length))));
    outputs.forEach((place, index) => parts.push(placeMarkup(place, outputX, rowY(index, outputs.length))));
    shared.forEach((place, index) => {
      const position = sharedPosition(index);
      parts.push(placeMarkup(place, position.x, position.y));
    });
    if (!dependencyFlow.inputs.length && !dependencyFlow.opaqueInputs.length) parts.push(`<text class="tech-tree-empty" x="${inputX + placeWidth / 2}" y="${sideTop + (sideHeight - sideTop) / 2}" text-anchor="middle">NO CONSUMED INPUTS</text>`);
    if (!dependencyFlow.outputs.length && !dependencyFlow.opaqueOutputs.length) parts.push(`<text class="tech-tree-empty" x="${outputX + placeWidth / 2}" y="${sideTop + (sideHeight - sideTop) / 2}" text-anchor="middle">NO CREATED OUTPUTS</text>`);

    const transitionLines = techTreeNodeLabelLines(action.action?.name || "Action", 16);
    const transitionLineStart = transitionLines.length > 1 ? 19 : 25;
    const tokensAvailable = actionReady(action);
    const transitionStatus = runState.loading
      ? "CHECKING DRIVER"
      : runState.error
        ? "DRIVER CHECK FAILED"
        : runState.canRun
          ? "READY TO RUN"
          : runState.feasible === false
            ? "NOT FEASIBLE"
            : tokensAvailable
              ? "INPUTS AVAILABLE"
              : "NEEDS INPUTS";
    parts.push(`
      <g class="tech-tree-node-transition${runState.canRun ? " is-ready" : ""}" transform="translate(${transitionX} ${transitionY})" aria-hidden="true">
        <path class="tech-tree-node-frame" d="M 8 0 H ${transitionWidth - 8} L ${transitionWidth} 8 V ${transitionHeight - 8} L ${transitionWidth - 8} ${transitionHeight} H 8 L 0 ${transitionHeight - 8} V 8 Z"></path>
        <text class="tech-tree-node-label" x="${transitionWidth / 2}" y="${transitionLineStart}" text-anchor="middle">${transitionLines.map((line, index) => `<tspan x="${transitionWidth / 2}" dy="${index ? 12 : 0}">${escapeHtml(line)}</tspan>`).join("")}</text>
        <text class="tech-tree-node-status" x="${transitionWidth / 2}" y="${transitionHeight - 7}" text-anchor="middle">${transitionStatus}</text>
      </g>
      </svg>`);

    const unresolvedRelationships = dependencyFlow.opaqueInputs.length + dependencyFlow.opaqueOutputs.length;
    const notes = [];
    if (dependencyFlow.mutations.length) notes.push(`${dependencyFlow.mutations.length} explicit object update${dependencyFlow.mutations.length === 1 ? " is" : "s are"} excluded; mutations need a separate identity-preserving view.`);
    if (unresolvedRelationships) notes.push(`${unresolvedRelationships} unresolved flattened I/O slot${unresolvedRelationships === 1 ? " is" : "s are"} shown with dashed neutral arcs; the public predicate does not expose enough detail to classify the operation.`);
    const omittedNote = notes.length ? `<div class="terminal-note action-tech-tree-note">${escapeHtml(notes.join(" "))}</div>` : "";
    return `
      <div class="game-panel action-tech-tree-panel">
        <div class="game-panel-header"><h3>Action I/O map</h3><span>Consume / Create</span></div>
        <div class="game-panel-body"><div class="action-tech-tree-viewport" tabindex="0" role="region" aria-label="Scrollable action consume and create relationship graph">${parts.join("")}</div></div>
        ${omittedNote}
      </div>`;
  }

  function actionProofComponentTimingLabel(value) {
    if (value.complete && value.callCount === 0) return "No direct gate";
    if (value.complete) return `${value.knownCount} readable`;
    if (value.knownCount > 0) return `${value.knownCount}/${value.callCount} readable`;
    return "Metadata unknown";
  }

  function actionProofTotalTimingLabel(timing) {
    if (timing.totalMilliseconds != null) {
      return `${timing.lowerBound ? ">= " : "~"}${formatProofDuration(timing.totalMilliseconds)}`;
    }
    if (timing.requiresCwi) return hardwareIndexUiIsActive() ? "CWI ACTIVE" : "CWI REQUIRED";
    return "UNKNOWN";
  }

  function actionEstimateTargetLabel(action) {
    const outputs = [...new Set(
      (Array.isArray(action?.totalOutputs) ? action.totalOutputs : [])
        .map((output) => String(output?.class?.name || "").trim())
        .filter(Boolean),
    )];
    return outputs.length === 1 ? `Estimated total / ${outputs[0]}` : "Estimated total action time";
  }

  function actionProofEstimateSummary(action, timing) {
    const stateLabel = timing.estimateKind === "observed"
      ? "OBSERVED PROOF + PLANNING ALLOWANCES"
      : timing.estimateKind === "calibrated"
        ? "CWI-SCALED WORKLOAD ESTIMATE"
        : timing.estimateKind === "lower-bound"
          ? "KNOWN-WORK LOWER BOUND"
          : "CALIBRATION REQUIRED";
    const detail = timing.estimateKind === "observed"
      ? `This MineIron proof component was observed. The total adds ${formatProofDuration(timing.commitAllowanceMilliseconds)} for commit and ${Math.round(timing.operationalContingency * 100)}% for operational variance.`
      : timing.estimateKind === "calibrated"
        ? `PoW, VDF, and ${timing.ioSlotCount} I/O slot${timing.ioSlotCount === 1 ? "" : "s"} scale this Driver's CWI; commit and a ${Math.round(timing.operationalContingency * 100)}% retry/settlement allowance are included.`
        : timing.estimateKind === "lower-bound"
          ? `Some proof metadata is unreadable. This includes only known workload, I/O structure, commit, and the ${Math.round(timing.operationalContingency * 100)}% operational allowance.`
          : "Run one real MineIron Generate Proof window on the selected Driver to ground the workload estimate.";
    const stateClass = timing.complete ? "is-complete" : timing.hasCwi ? "is-partial" : "is-unknown";
    return `
      <div class="proof-estimate-summary ${stateClass}">
        <div><span>${escapeHtml(actionEstimateTargetLabel(action))}</span><strong>${escapeHtml(actionProofTotalTimingLabel(timing))}</strong></div>
        <div><span>${escapeHtml(stateLabel)}</span><small>${escapeHtml(detail)}</small></div>
      </div>`;
  }

  function actionProofCwiSourceMarkup(timing) {
    if (!timing.hasCwi) return "";
    const cwi = timing.cwi;
    const liveState = state.hardwareIndex.status === "running"
      ? " / measuring another proof now"
      : state.hardwareIndex.status === "settling"
        ? " / saved proof frozen; MineIron settling"
      : state.hardwareIndex.status === "error"
        ? " / last valid result retained"
        : "";
    return `
      <div class="proof-cwi-source">
        <span>Raw ${HARDWARE_INDEX_LABEL} proof baseline <b>${escapeHtml(formatProofDuration(cwi.durationMs))}</b>${escapeHtml(liveState)}</span>
        <small>Proof only / estimates scale workload and add ${escapeHtml(formatProofDuration(ACTION_COMMIT_ALLOWANCE_MS))} commit + ${Math.round(ACTION_OPERATIONAL_CONTINGENCY * 100)}% operations / ${escapeHtml(cwi.driverUrl)} / ${escapeHtml(shortText(cwi.actionHash, 10, 7))} / ${escapeHtml(formatDate(cwi.measuredAt))}</small>
      </div>`;
  }

  function actionProofCwiCalloutMarkup(timing) {
    if (!timing.requiresCwi) return "";
    const measuring = state.hardwareIndex.status === "running";
    const settling = state.hardwareIndex.status === "settling";
    const active = measuring || settling;
    const failed = state.hardwareIndex.status === "error";
    const pending = hardwareIndexPendingForConnection();
    const resumable = hardwareIndexPendingHasRun(pending);
    const locked = Boolean(pending && !resumable);
    const activeRunName = state.hardwareIndex.activeRun?.connectionName || "selected Driver";
    const activeHere = Boolean(
      active && state.hardwareIndex.activeRun?.driverUrl === hardwareIndexConnectionKey(activeConnection())
    );
    const title = settling
      ? `MineIron settling on ${activeRunName}`
      : measuring
        ? `Measuring MineIron proof on ${activeRunName}`
      : locked
        ? "Submission outcome locked"
        : failed
          ? "Driver calibration needs attention"
          : resumable
            ? "Accepted MineIron needs tracking"
            : "Driver calibration required";
    const copy = active
      ? activeHere
        ? settling
          ? "The proof timer is frozen. MineIron settlement continues in Activity and is excluded; no score is fabricated if the exact event window was missed."
          : `Timing generateProof/running "Generating proof" through generateProof/done "Proof generation complete". Commit is excluded.`
        : `The active MineIron belongs to ${activeRunName}, not this selected Driver. It continues even after switching connections.`
      : locked
        ? hardwareIndexPendingLockCopy(pending)
        : failed
          ? state.hardwareIndex.error || "The selected Driver could not complete CWI."
          : resumable
            ? `Resume retained run ${shortText(pending.runId)}; no new action will be submitted.`
            : "Run one real craft-rocket::MineIron action and measure only its Generate Proof window. Settlement continues separately and may keep one Iron.";
    const control = active || locked
      ? active
        ? `<button class="game-button" type="button" data-hardware-index-focus aria-disabled="true">${settling ? "Settling" : "Measuring"}</button>`
        : '<button class="game-button" type="button" data-command="activity" data-hardware-index-focus>Review Activity</button>'
      : `<button class="game-button" type="button" data-command="run-hardware-index" data-hardware-index-focus>${resumable ? "Resume CWI" : failed ? "Retry CWI" : "Run CWI"}</button>`;
    return `
      <div class="proof-cwi-callout${failed ? " is-error" : ""}">
        <div><span>${active ? "Active MineIron" : "Selected Driver"} / ${HARDWARE_INDEX_LABEL}</span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(copy)}</small></div>
        ${control}
        ${active ? hardwareIndexProgressMarkup("proof-cwi-track") : ""}
      </div>`;
  }

  function actionProofRequirementsContentMarkup(action) {
    const workload = actionProofWorkload(action);
    const timing = estimateActionProofTiming(action, currentHardwareIndex(), workload);
    const rating = (kind, value) => `
      <div class="proof-rating proof-rating-${value.level.toLowerCase()}">
        <span>${kind}</span>
        <strong>${escapeHtml(value.level)}</strong>
        <b class="proof-rating-time">${escapeHtml(actionProofComponentTimingLabel(value))}</b>
        <small>${escapeHtml(value.detail)}</small>
      </div>`;
    return `
      ${actionProofEstimateSummary(action, timing)}
      <div class="proof-rating-grid">
        ${rating("PoW / inferred search", workload.pow)}
        ${rating("VDF / literal chain", workload.vdf)}
      </div>
      ${actionProofCwiCalloutMarkup(timing)}
      ${actionProofCwiSourceMarkup(timing)}`;
  }

  function actionProofTimingAnnouncement(action) {
    const timing = estimateActionProofTiming(action);
    if (timing.requiresCwi && state.hardwareIndex.status === "settling") return "MineIron settlement is in progress, but no trustworthy Generate Proof timing window was saved.";
    if (timing.requiresCwi && state.hardwareIndex.status === "running") return "A real MineIron Generate Proof measurement is in progress.";
    if (timing.requiresCwi) return "Client work index is required for the selected-Driver proof-window baseline.";
    if (timing.totalMilliseconds == null) return "Action timing is unknown.";
    const proofSource = timing.estimateKind === "observed" ? "observed MineIron proof" : timing.lowerBound ? "known-work proof lower bound" : "CWI-scaled proof";
    const prefix = timing.lowerBound ? "Estimated action-time lower bound" : "Estimated total action time";
    return `${prefix}: ${formatProofDuration(timing.totalMilliseconds)}. Includes ${formatProofDuration(timing.proofMilliseconds)} ${proofSource}, ${formatProofDuration(timing.commitAllowanceMilliseconds)} commit allowance, and ${formatProofDuration(timing.operationalAllowanceMilliseconds)} operational allowance.`;
  }

  function actionProofRequirementsMarkup(action) {
    const key = qualifiedKey(action.action);
    return `
      <section class="game-panel action-proof-panel" data-hardware-index data-hardware-index-view="action-proof" data-action-key="${escapeHtml(key)}" data-cwi-state="${escapeHtml(state.hardwareIndex.status)}" tabindex="-1" aria-labelledby="action-proof-title">
        <span class="sr-only" data-hardware-index-announcement aria-live="polite" aria-atomic="true">${escapeHtml(actionProofTimingAnnouncement(action))}</span>
        <div class="game-panel-header"><h3 id="action-proof-title">Direct work gates</h3><span>Action estimate</span></div>
        <div class="game-panel-body" data-hardware-index-content>${actionProofRequirementsContentMarkup(action)}</div>
      </section>`;
  }

  function renderActionDrawer(action, model) {
    const dependencyFlow = actionDependencyFlow(action);
    const submissionKey = actionSubmissionKey(activeConnection(), action, model.selections);
    const submissionInFlight = state.inFlightActionSubmissions.has(submissionKey);
    const outcomeUnknown = model.outcomeUnknown || state.ambiguousActionSubmissions.has(submissionKey);
    const workflowLocked = goalWorkflowOwnsSubmissions();
    const submissionLocked = submissionInFlight || outcomeUnknown || workflowLocked;
    const used = new Set(model.selections.filter(Boolean));
    const slots = (action.totalInputs || []).map((required, index) => {
      const usedElsewhere = new Set([...used].filter((fileName) => fileName !== model.selections[index]));
      const candidates = actionCandidates(required, model.report, usedElsewhere);
      return `
        <div class="game-field">
          <label for="action-input-${index}">Input ${index + 1} / ${escapeHtml(required.class?.name || "Object")}</label>
          <select id="action-input-${index}" class="game-select" data-action-input="${index}"${model.submitting ? " disabled" : ""}>
            <option value="">Choose an object</option>
            ${candidates.map((object) => `<option value="${escapeHtml(object.fileName)}"${model.selections[index] === object.fileName ? " selected" : ""}>${escapeHtml(`${object.emoji || ""} ${object.class?.name || "Object"} / ${shortText(object.contentHash)}`)}</option>`).join("")}
          </select>
          ${candidates.length ? "" : "<small>No compatible live object is available.</small>"}
        </div>`;
    }).join("");
    const outputs = techTreeRefsMarkup(dependencyFlow.outputs, "No direct creates");
    const unresolvedOutputs = dependencyFlow.opaqueOutputs.length
      ? `<div class="game-panel proof-update-panel"><div class="game-panel-header"><h3>Unresolved outputs</h3><span>Dashed in graph</span></div><div class="game-panel-body"><div class="chip-list">${techTreeRefsMarkup(dependencyFlow.opaqueOutputs, "")}</div><p class="action-proof-note">The flattened signature exposes these outputs, but the public predicate does not identify their exact operation.</p></div></div>`
      : "";
    const updates = dependencyFlow.mutations.length
      ? `<div class="game-panel proof-update-panel"><div class="game-panel-header"><h3>Updated objects</h3><span>Not dependency outputs</span></div><div class="game-panel-body"><div class="chip-list">${techTreeRefsMarkup(dependencyFlow.mutations, "")}</div></div></div>`
      : "";
    const opaque = dependencyFlow.opaqueInputs.length
      ? `<div class="terminal-note">${techTreeRefsMarkup(dependencyFlow.opaqueInputs, "")} remains required by the flattened signature, but its exact operation is unresolved. Hidden subactions or unavailable predicate detail can cause this.</div>`
      : "";
    const unique = new Set(model.selections.filter(Boolean)).size === (action.totalInputs || []).length;
    const complete = model.selections.filter(Boolean).length === (action.totalInputs || []).length;
    const canRun = !model.loading && !model.error && !model.submitting && !submissionLocked && model.report?.feasible === true && complete && unique;
    const showProofRequirements = !(action.totalInputs || []).length || model.selections.some(Boolean);
    return `
      <div class="drawer-header">
        <div><p class="screen-kicker">Action setup</p><h2 class="drawer-title" id="drawer-title">${escapeHtml(action.action?.name || "Action")}</h2></div>
        <button class="game-button" type="button" data-command="close-drawer">Close</button>
      </div>
      <div class="drawer-body">
        <p class="screen-copy">${escapeHtml(action.description || "")}</p>
        ${model.loading ? '<div class="terminal-note">Checking feasibility with the Driver...</div>' : ""}
        ${model.error ? `<div class="terminal-note error">${escapeHtml(model.error)}</div>` : ""}
        <div data-action-submit-error aria-live="polite" aria-atomic="true">${model.submitError ? `<div class="terminal-note ${outcomeUnknown ? "warning" : "error"}" tabindex="-1">${escapeHtml(model.submitError)}</div>` : outcomeUnknown ? '<div class="terminal-note warning" tabindex="-1">A matching submission had an unknown outcome in this browser session. Review Activity before retrying; choose different input objects or reload only after you have reconciled the prior request.</div>' : submissionInFlight ? '<div class="terminal-note" tabindex="-1">A matching request is already in flight in this browser session. You can close this drawer safely; duplicate submission remains locked.</div>' : workflowLocked ? '<div class="terminal-note warning">A Goal Planner workflow currently owns sequential Driver submissions. Pause or exit that flow before running a manual action.</div>' : ""}</div>
        <form id="action-run-form" class="game-form">
          ${(action.totalInputs || []).length ? slots : '<div class="terminal-note">This action requires no input objects.</div>'}
          ${showProofRequirements ? actionProofRequirementsMarkup(action) : ""}
          <div class="game-panel">
            <div class="game-panel-header"><h3>Expected outputs</h3></div>
            <div class="game-panel-body"><div class="chip-list">${outputs}</div></div>
          </div>
          ${unresolvedOutputs}
          ${updates}
          ${opaque}
          <div class="terminal-note warning">Submitting starts a state-changing action directly on the selected Driver. If the browser loses the response, check Activity before retrying.</div>
          <div data-action-submit-meter aria-live="polite" aria-atomic="true">${model.submitting ? runSubmissionProgressMarkup() : ""}</div>
          <div class="game-form-actions">
            <button id="action-run-submit" class="game-button game-button-primary" type="submit"${canRun ? "" : " disabled"}>${model.submitting ? "Starting..." : outcomeUnknown ? "Session safety lock" : submissionInFlight ? "Request in flight" : workflowLocked ? "Workflow active" : "Run action"}</button>
          </div>
        </form>
        ${renderActionTechTreePortal(action, { canRun, loading: model.loading, error: Boolean(model.error), feasible: model.report?.feasible })}
      </div>`;
  }

  async function submitActionRun() {
    const model = state.drawer;
    if (model?.type !== "action" || model.submitting) return;
    if (goalWorkflowOwnsSubmissions()) {
      toast("Goal workflow is active", "Pause or exit the automated flow before starting a manual action.", "warning", 7000);
      return;
    }
    const action = actionByKey(model.key);
    const connection = activeConnection();
    const generation = state.workspaceGeneration;
    if (!action || !connection) return;
    const selections = model.selections || [];
    const complete = selections.filter(Boolean).length === (action.totalInputs || []).length;
    const unique = new Set(selections.filter(Boolean)).size === (action.totalInputs || []).length;
    const submissionKey = actionSubmissionKey(connection, action, selections);
    if (state.inFlightActionSubmissions.has(submissionKey) || state.ambiguousActionSubmissions.has(submissionKey)) {
      const inFlight = state.inFlightActionSubmissions.has(submissionKey);
      toast("Submission locked", inFlight ? "A matching request is already in flight." : "Review the earlier unknown outcome in Activity before retrying these inputs.", "warning");
      return;
    }
    if (model.loading || model.error || model.report?.feasible !== true || !complete || !unique) return;
    state.inFlightActionSubmissions.add(submissionKey);
    model.submitting = true;
    model.submitError = null;
    const previousError = drawerContent.querySelector("[data-action-submit-error]");
    if (previousError) previousError.innerHTML = "";
    drawerContent.querySelectorAll("[data-action-input]").forEach((select) => {
      select.disabled = true;
    });
    const submit = drawerContent.querySelector('#action-run-form button[type="submit"]');
    if (submit) {
      submit.disabled = true;
      submit.textContent = "Starting...";
    }
    const submitMeter = drawerContent.querySelector("[data-action-submit-meter]");
    if (submitMeter) submitMeter.innerHTML = runSubmissionProgressMarkup();
    try {
      const accepted = await driverRequest(
        connection,
        "/actions/run",
        jsonOptions("POST", { input: { action: action.action, inputObjectPaths: selections } }, 30000),
      );
      if (!accepted?.runId) throw new DriverError("Driver accepted the request without returning a run id.");
      state.inFlightActionSubmissions.delete(submissionKey);
      rememberRun(connection.id, accepted.runId);
      if (!isCurrentWorkspace(connection, generation)) {
        const currentConnection = activeConnection();
        if (currentConnection?.id === connection.id) {
          const currentGeneration = state.workspaceGeneration;
          mergeRun({ ...accepted, action: action.action, result: null, error: null, progress: [] });
          void watchRun(accepted.runId, currentConnection, currentGeneration);
          if (visibleActionMatches(currentConnection, action)) {
            state.drawer = { type: "run", runId: accepted.runId };
            renderDrawer(false);
            requestAnimationFrame(() => {
              drawerContent.scrollTop = 0;
              drawerContent.querySelector("[data-run-focus]")?.focus({ preventScroll: true });
            });
          }
        } else if (state.drawer === model) {
          closeDrawer();
        }
        toast("Action started", `${action.action.name} started on ${connection.name}. Switch back to follow ${shortText(accepted.runId)}.`, "success");
        return;
      }
      mergeRun({ ...accepted, action: action.action, result: null, error: null, progress: [] });
      void watchRun(accepted.runId, connection, generation);
      if (visibleActionMatches(connection, action)) {
        state.drawer = { type: "run", runId: accepted.runId };
        renderDrawer(false);
        requestAnimationFrame(() => {
          drawerContent.scrollTop = 0;
          drawerContent.querySelector("[data-run-focus]")?.focus({ preventScroll: true });
        });
      }
      toast("Action started", `${action.action.name} / ${shortText(accepted.runId)}`, "success");
    } catch (error) {
      const ambiguous = error.status === 0;
      state.inFlightActionSubmissions.delete(submissionKey);
      if (ambiguous) state.ambiguousActionSubmissions.add(submissionKey);
      if (visibleActionSubmissionKey() === submissionKey) {
        const visibleModel = state.drawer;
        visibleModel.submitting = false;
        visibleModel.outcomeUnknown = ambiguous;
        visibleModel.submitError = ambiguous
          ? `${error.message} The request may have reached the Driver; this action stays locked to prevent a duplicate submission.`
          : error.message;
        drawerContent.querySelectorAll("[data-action-input]").forEach((select) => {
          select.disabled = false;
        });
        const errorRegion = drawerContent.querySelector("[data-action-submit-error]");
        if (errorRegion) {
          errorRegion.innerHTML = `<div class="terminal-note ${ambiguous ? "warning" : "error"}" tabindex="-1">${escapeHtml(visibleModel.submitError)}</div>`;
          requestAnimationFrame(() => errorRegion.firstElementChild?.focus());
        }
        const meter = drawerContent.querySelector("[data-action-submit-meter]");
        if (meter) meter.innerHTML = "";
        const retry = drawerContent.querySelector("#action-run-submit");
        if (retry) {
          retry.disabled = ambiguous;
          retry.textContent = ambiguous ? "Session safety lock" : "Run action";
        }
      }
      toast(
        ambiguous ? "Outcome unknown" : "Action was not started",
        ambiguous ? `${error.message} Check Activity before retrying; the Driver may have accepted the action.` : error.message,
        "error",
        9000,
      );
      if (ambiguous && isCurrentWorkspace(connection, generation)) {
        void loadRetainedRuns(connection, generation).then(() => {
          if (isCurrentWorkspace(connection, generation)) scheduleLivePatch({ activity: true });
        });
      }
    }
  }

  const GOAL_WORKFLOW_BLOCKING_STATUSES = new Set([
    "ready",
    "running",
    "pausing",
    "paused",
    "error",
    "needs-review",
    "stopping",
  ]);
  const GOAL_WORKFLOW_AUTOMATION_STATUSES = new Set(["running", "pausing", "stopping"]);

  function goalWorkflowBlocksNewPlan(workflow = state.goalWorkflow) {
    return Boolean(workflow && GOAL_WORKFLOW_BLOCKING_STATUSES.has(workflow.status));
  }

  function goalWorkflowAutomationActive(workflow = state.goalWorkflow) {
    return Boolean(workflow && GOAL_WORKFLOW_AUTOMATION_STATUSES.has(workflow.status));
  }

  function goalWorkflowOwnedByOtherTab(workflow = state.goalWorkflow) {
    return Boolean(
      workflow &&
      goalWorkflowAutomationActive(workflow) &&
      workflow.ownerTabId !== state.goalWorkflowTabId &&
      !state.goalWorkflowLoopPromise
    );
  }

  function goalWorkflowOwnsSubmissions(workflow = state.goalWorkflow) {
    if (!workflow) return false;
    if (goalWorkflowAutomationActive(workflow) || workflow.status === "needs-review") return true;
    const current = goalWorkflowCurrentStepState(workflow);
    return Boolean(current && new Set(["submitting", "running", "verifying", "needs-review"]).has(current.status));
  }

  function goalWorkflowCurrentBatchCompletedCount(workflow = state.goalWorkflow) {
    return workflow?.stepStates?.filter((step) => step.status === "complete").length || 0;
  }

  function goalWorkflowCompletedCount(workflow = state.goalWorkflow) {
    return (Number(workflow?.completedActionCount) || 0) + goalWorkflowCurrentBatchCompletedCount(workflow);
  }

  function goalWorkflowEstimatedActionCount(workflow = state.goalWorkflow) {
    if (!workflow) return 0;
    if (workflow.executionMode !== "repeat-unit") return workflow.steps?.length || 0;
    const completedQuantity = Math.max(0, Number(workflow.completedQuantity) || 0);
    const remainingQuantity = Math.max(0, (Number(workflow.goal?.quantity) || 1) - completedQuantity);
    const remainingBatches = Math.ceil(remainingQuantity / Math.max(1, Number(workflow.batchGoalIncrease) || 1));
    return Math.max(
      goalWorkflowCompletedCount(workflow),
      (Number(workflow.completedActionCount) || 0) + (workflow.steps?.length || 0) * remainingBatches,
    );
  }

  function goalWorkflowActionTotalLabel(workflow = state.goalWorkflow) {
    const total = goalWorkflowEstimatedActionCount(workflow);
    return workflow?.executionMode === "repeat-unit" ? `~${total}` : String(total);
  }

  function goalWorkflowCurrentStepState(workflow = state.goalWorkflow) {
    return workflow?.stepStates?.[workflow.currentStepIndex] || null;
  }

  function goalWorkflowCurrentStep(workflow = state.goalWorkflow) {
    return workflow?.steps?.[workflow.currentStepIndex] || null;
  }

  function goalWorkflowStatusLabel(workflow = state.goalWorkflow) {
    if (!workflow) return "No workflow";
    if (goalWorkflowOwnedByOtherTab(workflow)) return "Active in another tab";
    return ({
      ready: "Ready to play",
      running: "Running",
      pausing: "Pausing after step",
      paused: "Paused",
      error: "Action stopped",
      "needs-review": "Review required",
      stopping: "Stopping after step",
      stopped: "Exited",
      complete: "Goal complete",
    })[workflow.status] || workflow.status || "Unknown";
  }

  function goalWorkflowGoalLabel(workflow = state.goalWorkflow) {
    const label = workflow?.goal?.label || "Goal";
    const quantity = Number(workflow?.goal?.quantity) || 1;
    return quantity > 1 ? `${quantity} × ${label}` : label;
  }

  function goalWorkflowElapsedMilliseconds(workflow = state.goalWorkflow) {
    const started = new Date(workflow?.startedAt || 0).valueOf();
    if (!Number.isFinite(started) || started <= 0) return 0;
    const ended = new Date(workflow?.completedAt || workflow?.stoppedAt || 0).valueOf();
    return Math.max(0, (Number.isFinite(ended) && ended > 0 ? ended : Date.now()) - started);
  }

  function goalWorkflowRemainingMilliseconds(workflow = state.goalWorkflow) {
    if (!workflow?.steps?.length) return 0;
    let total = 0;
    for (let index = workflow.currentStepIndex; index < workflow.steps.length; index += 1) {
      const rawValue = workflow.steps[index]?.estimatedMilliseconds;
      if (rawValue == null || rawValue === "") return null;
      const value = Number(rawValue);
      if (!Number.isFinite(value) || value < 0) return null;
      total += value;
    }
    if (workflow.executionMode === "repeat-unit") {
      const completedQuantity = Math.max(0, Number(workflow.completedQuantity) || 0);
      const batchGoalIncrease = Math.max(1, Number(workflow.batchGoalIncrease) || 1);
      const futureQuantity = Math.max(0, (Number(workflow.goal?.quantity) || 1) - completedQuantity - batchGoalIncrease);
      const futureBatches = Math.ceil(futureQuantity / batchGoalIncrease);
      if (futureBatches) {
        let unitTotal = 0;
        for (const step of workflow.steps) {
          const value = Number(step?.estimatedMilliseconds);
          if (!Number.isFinite(value) || value < 0) return null;
          unitTotal += value;
        }
        total += unitTotal * futureBatches;
      }
    }
    return total;
  }

  function goalWorkflowRunIds(workflow = state.goalWorkflow) {
    return new Set((workflow?.stepStates || []).map((step) => step.runId).filter(Boolean));
  }

  function compactGoalWorkflowRun(run) {
    if (!run) return null;
    const progress = Array.isArray(run.progress) ? run.progress.slice(-8) : [];
    return {
      runId: String(run.runId || ""),
      action: run.action || null,
      status: String(run.status || "queued"),
      result: run.result || null,
      error: run.error || null,
      progress,
    };
  }

  function updateGoalWorkflowHud() {
    const button = byId("workflow-monitor");
    if (!button) return;
    const workflow = state.goalWorkflow;
    button.hidden = !workflow;
    if (!workflow) return;
    const completed = goalWorkflowCompletedCount(workflow);
    const actionTotal = goalWorkflowEstimatedActionCount(workflow);
    const label = byId("workflow-monitor-label");
    const icon = button.querySelector(".workflow-hud-icon");
    const iconByStatus = {
      ready: "\u25b7",
      running: "\u25b6",
      pausing: "\u2016",
      paused: "\u2016",
      error: "!",
      "needs-review": "!",
      stopping: "\u25a0",
      stopped: "\u25a0",
      complete: "\u2713",
    };
    if (icon) icon.textContent = iconByStatus[workflow.status] || "\u25b7";
    if (label) label.textContent = workflow.status === "complete"
      ? "Goal ready"
      : new Set(["error", "needs-review"]).has(workflow.status)
        ? "Flow alert"
        : workflow.status === "paused"
          ? `Paused ${completed}/${actionTotal}`
          : `Flow ${completed}/${actionTotal}`;
    button.dataset.workflowStatus = workflow.status;
    button.classList.toggle("is-alert", new Set(["error", "needs-review"]).has(workflow.status));
    button.classList.toggle("is-complete", workflow.status === "complete");
    const totalPhrase = workflow.executionMode === "repeat-unit" ? `approximately ${actionTotal}` : String(actionTotal);
    const description = `${goalWorkflowStatusLabel(workflow)}. ${goalWorkflowGoalLabel(workflow)}. ${completed} of ${totalPhrase} actions verified.`;
    button.setAttribute("aria-label", `Open goal workflow monitor. ${description}`);
    button.title = description;
  }

  function patchGoalWorkflowLauncher() {
    if (state.screen !== "planner") return;
    const launch = main.querySelector("[data-goal-workflow-launch]");
    if (!launch) return;
    const context = plannerContext(selectedCartridge(), { reuseResult: true });
    if (launch.dataset.goalWorkflowFingerprint === plannerGoalWorkflowFingerprint(context)) return;
    const focusToken = captureFocus(launch);
    const drawerReturnToken = launch.contains(state.drawerReturnFocus)
      ? focusTokenForElement(state.drawerReturnFocus)
      : null;
    launch.outerHTML = plannerGoalWorkflowMarkup(context);
    const replacement = main.querySelector("[data-goal-workflow-launch]");
    if (drawerReturnToken) {
      state.drawerReturnFocus = findCapturedFocus(replacement, drawerReturnToken)
        || replacement?.querySelector("button:not(:disabled)")
        || byId("workflow-monitor");
    }
    if (focusToken) {
      requestAnimationFrame(() => {
        const target = findCapturedFocus(replacement, focusToken)
          || replacement?.querySelector("button:not(:disabled)");
        target?.focus({ preventScroll: true });
      });
    }
  }

  function notifyGoalWorkflowChange(options = {}) {
    updateGoalWorkflowHud();
    if (options.structure !== false) patchGoalWorkflowLauncher();
    patchGoalWorkflowDrawer();
  }

  function persistGoalWorkflow(required = false) {
    const workflow = state.goalWorkflow;
    try {
      if (workflow) {
        workflow.revision = Math.max(0, Number(workflow.revision) || 0) + 1;
        workflow.updatedAt = new Date().toISOString();
        localStorage.setItem(GOAL_WORKFLOW_STORAGE_KEY, JSON.stringify(workflow));
      } else {
        localStorage.removeItem(GOAL_WORKFLOW_STORAGE_KEY);
      }
      notifyGoalWorkflowChange();
      return true;
    } catch (error) {
      notifyGoalWorkflowChange();
      if (required) {
        throw new Error(`The workflow recovery checkpoint could not be saved, so no new action was sent. ${error.message}`);
      }
      toast("Workflow checkpoint not saved", error.message, "error", 9000);
      return false;
    }
  }

  function readGoalWorkflowStorageRecord() {
    const raw = localStorage.getItem(GOAL_WORKFLOW_STORAGE_KEY);
    if (!raw) return null;
    const record = JSON.parse(raw);
    return record && record.version === GOAL_WORKFLOW_VERSION && record.id ? record : null;
  }

  function adoptPersistedGoalWorkflow(recoverInterrupted = false) {
    state.goalWorkflow = loadGoalWorkflowSnapshot({ recoverInterrupted });
    notifyGoalWorkflowChange();
    return state.goalWorkflow;
  }

  function assertNoPersistedBlockingWorkflow() {
    const persisted = readGoalWorkflowStorageRecord();
    if (!persisted || !GOAL_WORKFLOW_BLOCKING_STATUSES.has(persisted.status)) return;
    const adopted = adoptPersistedGoalWorkflow();
    throw new Error(
      adopted
        ? `A saved ${goalWorkflowStatusLabel(adopted).toLowerCase()} workflow already owns this console. Open its monitor before preparing another plan.`
        : "Another tab saved an active workflow. Reload this console before preparing another plan.",
    );
  }

  function plannerRefSnapshot(ref) {
    return {
      class: {
        pluginName: String(ref?.class?.pluginName || ""),
        name: String(ref?.class?.name || ""),
      },
      hash: String(ref?.hash || ""),
    };
  }

  function createGoalWorkflowPlanBatch(context) {
    const result = context?.result;
    if (result?.status !== "planned" || !result.steps?.length) {
      throw new Error("The refreshed goal does not have an executable action set.");
    }
    if (result.steps.length > GOAL_WORKFLOW_MAX_STEPS) {
      throw new Error(`This plan needs ${result.steps.length} actions; the safe workflow limit is ${GOAL_WORKFLOW_MAX_STEPS}. Reduce the quantity and try again.`);
    }
    if (!Array.isArray(result.goalTokenIds) || result.goalTokenIds.length !== 1) {
      throw new Error("The refreshed craft batch did not materialize one distinct goal object.");
    }
    const timingByStep = new Map();
    const steps = result.steps.map((step) => {
      const normalized = context.catalog?.actionById?.get(step.actionId);
      if (!normalized?.raw || normalized.id !== step.actionId) {
        throw new Error(`The exact action version for ${step.label} is no longer installed.`);
      }
      const timing = estimateActionProofTiming(normalized.raw);
      timingByStep.set(step.id, timing);
      return {
        id: step.id,
        index: step.index,
        order: step.order,
        actionId: step.actionId,
        actionKey: step.actionKey,
        action: {
          pluginName: normalized.qualified.pluginName,
          name: normalized.qualified.name,
        },
        actionHash: normalized.hash,
        label: step.label,
        emoji: step.emoji,
        inputs: step.inputs.map((input) => ({
          tokenId: input.tokenId,
          classId: input.classId,
          slotIndex: input.slotIndex,
          classLabel: input.classLabel,
          sourceKind: input.sourceKind,
          sourceStepId: input.sourceStepId || null,
          fileName: input.fileName || null,
          contentHash: input.contentHash || null,
        })),
        outputs: step.outputs.map((output) => ({
          tokenId: output.tokenId,
          classId: output.classId,
          slotIndex: output.slotIndex,
          classLabel: output.classLabel,
          sourceKind: output.sourceKind,
          sourceStepId: output.sourceStepId || null,
        })),
        totalInputs: (normalized.raw.totalInputs || []).map(plannerRefSnapshot),
        totalOutputs: (normalized.raw.totalOutputs || []).map(plannerRefSnapshot),
        warnings: [...(step.warnings || [])],
        estimatedMilliseconds: timing.totalMilliseconds,
        estimateLowerBound: timing.lowerBound,
      };
    });
    const totalTiming = plannerTimingSummary(result.steps.map((step) => step.id), timingByStep);
    const tokenBindings = {};
    for (const token of result.tokens || []) {
      if (token.kind !== "inventory") continue;
      tokenBindings[token.tokenId] = {
        tokenId: token.tokenId,
        classId: token.classId,
        fileName: token.fileName || "",
        contentHash: token.contentHash || "",
      };
    }
    return {
      goalTokenIds: [...result.goalTokenIds],
      goalIncrease: Math.max(
        1,
        Number(result.execution?.unitGoalIncrease) ||
          ((Number(result.goal?.finalCount) || 0) - (Number(result.goal?.initialCount) || 0)),
      ),
      steps,
      stepStates: steps.map((step) => ({
        stepId: step.id,
        status: "pending",
        runId: "",
        runStatus: "",
        runSnapshot: null,
        inputObjectPaths: [],
        outputFiles: [],
        startedAt: "",
        completedAt: "",
        error: "",
        retryable: true,
        outcomeUnknown: false,
      })),
      tokenBindings,
      estimatedMilliseconds: totalTiming.knownCount === steps.length ? totalTiming.knownMilliseconds : null,
      estimateComplete: totalTiming.complete,
    };
  }

  function createGoalWorkflowSnapshot(context, connection) {
    const result = context?.result;
    if (
      !Number.isInteger(result?.goal?.quantity) ||
      result.goal.quantity < 1 ||
      result.goal.quantity > GOAL_WORKFLOW_MAX_QUANTITY
    ) {
      throw new Error("The refreshed plan does not have a valid craft quantity.");
    }
    const repeatUnit = result.execution?.mode === "repeat-unit";
    if (result.goal.quantity > 1 && !repeatUnit) {
      throw new Error("Multi-object workflows must use recoverable live-replan batches.");
    }
    const batch = createGoalWorkflowPlanBatch(context);
    const now = new Date().toISOString();
    const estimatedBatchCount = Math.ceil(result.goal.quantity / batch.goalIncrease);
    const estimatedTotalMilliseconds = batch.estimatedMilliseconds == null
      ? null
      : batch.estimatedMilliseconds * estimatedBatchCount;
    return {
      version: GOAL_WORKFLOW_VERSION,
      id: newId("goal-flow"),
      status: "ready",
      connection: {
        id: connection.id,
        name: connection.name,
        driverUrl: connection.driverUrl,
      },
      driverVersion: String(state.workspace.health?.version || ""),
      cartridgeId: context.cartridge.id,
      cartridgeName: context.cartridge.name,
      goal: {
        classId: result.goal.classId,
        label: result.goal.label,
        hash: result.goal.hash,
        quantity: result.goal.quantity,
        semantics: result.goal.semantics,
        initialCount: result.goal.initialCount,
        targetCount: result.goal.targetCount,
      },
      executionMode: repeatUnit ? "repeat-unit" : "fixed-plan",
      completedQuantity: 0,
      completedActionCount: 0,
      batchGoalIncrease: batch.goalIncrease,
      estimatedActionCount: batch.steps.length * estimatedBatchCount,
      goalTokenIds: batch.goalTokenIds,
      steps: batch.steps,
      stepStates: batch.stepStates,
      tokenBindings: batch.tokenBindings,
      currentStepIndex: 0,
      estimatedTotalMilliseconds,
      estimateComplete: batch.estimateComplete,
      pauseRequested: false,
      exitRequested: false,
      recoveryRequired: false,
      ownerTabId: "",
      message: "Review the preflight, then press Play to begin sequential Driver submissions.",
      error: "",
      createdAt: now,
      updatedAt: now,
      startedAt: "",
      completedAt: "",
      stoppedAt: "",
    };
  }

  function openGoalWorkflowManager() {
    if (!state.goalWorkflow) {
      toast("No saved workflow", "Build an action set in Goal Planner first.", "warning");
      return;
    }
    const fallbackReturnFocus = main.querySelector("[data-goal-workflow-launch] button:not(:disabled)")
      || byId("workflow-monitor");
    state.drawer = { type: "workflow" };
    openDrawer();
    if (
      !state.drawerReturnFocus ||
      !state.drawerReturnFocus.isConnected ||
      state.drawerReturnFocus === document.body ||
      state.drawerReturnFocus === document.documentElement
    ) {
      state.drawerReturnFocus = fallbackReturnFocus;
    }
    renderDrawer();
  }

  function goalWorkflowLockName(connection) {
    return `don-goal-workflow:${normalizedDriverUrl(connection?.driverUrl)}`;
  }

  async function recoverInterruptedGoalWorkflowAtStartup() {
    const initial = state.goalWorkflow;
    if (!goalWorkflowAutomationActive(initial)) return;
    if (!globalThis.navigator?.locks?.request) {
      initial.message = "A saved workflow may still be active in another tab. Safe takeover requires browser Web Locks; manage it in its owning tab.";
      notifyGoalWorkflowChange();
      return;
    }
    const initialId = initial.id;
    try {
      await navigator.locks.request(goalWorkflowLockName(initial.connection), { ifAvailable: true }, async (lock) => {
        if (!lock) {
          notifyGoalWorkflowChange();
          return;
        }
        const persisted = readGoalWorkflowStorageRecord();
        if (!persisted) {
          state.goalWorkflow = null;
          notifyGoalWorkflowChange();
          return;
        }
        if (persisted.id !== initialId || !goalWorkflowAutomationActive(persisted)) {
          state.goalWorkflow = loadGoalWorkflowSnapshot({ recoverInterrupted: false });
          notifyGoalWorkflowChange();
          return;
        }
        const recovered = loadGoalWorkflowSnapshot();
        if (!recovered || recovered.id !== initialId) {
          state.goalWorkflow = recovered;
          notifyGoalWorkflowChange();
          return;
        }
        recovered.ownerTabId = "";
        state.goalWorkflow = recovered;
        persistGoalWorkflow(true);
        toast(
          "Workflow recovered",
          recovered.status === "paused"
            ? "The prior tab released its Driver lock. The flow is paused and will not submit until you resume it."
            : recovered.message,
          recovered.status === "needs-review" ? "warning" : "success",
          8000,
        );
      });
    } catch (error) {
      if (state.goalWorkflow?.id === initialId) {
        state.goalWorkflow.message = `Safe workflow recovery could not be checked. No action was submitted. ${error.message}`;
        notifyGoalWorkflowChange();
      }
    }
  }

  async function prepareGoalWorkflow() {
    if (goalWorkflowBlocksNewPlan()) {
      openGoalWorkflowManager();
      return;
    }
    if (state.goalWorkflowPreparing) return;
    const connection = activeConnection();
    const cartridge = selectedCartridge();
    const generation = state.workspaceGeneration;
    if (!connection || !cartridge || connectionStatus(connection.id).state !== "online") {
      toast("Workflow unavailable", "Choose an online Driver and cartridge first.", "error");
      return;
    }
    if (hardwareIndexUiIsActive()) {
      toast("CWI action is active", "Wait for the benchmark action to settle before starting a workflow.", "warning");
      return;
    }
    try {
      assertNoPersistedBlockingWorkflow();
    } catch (error) {
      toast("Workflow already active", error.message, "warning", 8500);
      if (state.goalWorkflow) openGoalWorkflowManager();
      return;
    }
    state.goalWorkflowPreparing = true;
    patchGoalWorkflowLauncher();
    const previousWorkflow = state.goalWorkflow;
    let createdWorkflowId = "";
    try {
      const prepareWhileLocked = async (lock) => {
        if (!lock && globalThis.navigator?.locks) {
          throw new Error("Another browser tab currently owns this Driver workflow. Open that tab or wait for it to finish.");
        }
        assertNoPersistedBlockingWorkflow();
        const refreshed = await refreshCatalogAndObjects(connection, generation);
        if (
          !refreshed ||
          !isCurrentWorkspace(connection, generation) ||
          activeCartridgeId() !== cartridge.id
        ) throw new Error("The selected Driver or cartridge changed while the workflow was being prepared.");
        const context = plannerContext(selectedCartridge(), { reuseResult: false });
        if (context.error) throw new Error(context.error);
        const workflow = createGoalWorkflowSnapshot(context, connection);
        assertNoPersistedBlockingWorkflow();
        createdWorkflowId = workflow.id;
        state.goalWorkflow = workflow;
        persistGoalWorkflow(true);
        return workflow;
      };
      const workflow = globalThis.navigator?.locks?.request
        ? await navigator.locks.request(goalWorkflowLockName(connection), { ifAvailable: true }, prepareWhileLocked)
        : await prepareWhileLocked({ name: goalWorkflowLockName(connection) });
      if (!workflow) throw new Error("The workflow preparation lock was not available.");
      openGoalWorkflowManager();
      const readyDetail = workflow.executionMode === "repeat-unit"
        ? `${workflow.steps.length} actions frozen for the first goal batch; the controller will replan live until ${workflow.goal.quantity} objects are verified.`
        : `${workflow.steps.length} actions frozen for ${goalWorkflowGoalLabel(workflow)}.`;
      toast("Workflow ready", `${readyDetail} Press Play when ready.`, "success", 6500);
    } catch (error) {
      if (state.goalWorkflow?.id === createdWorkflowId || !goalWorkflowBlocksNewPlan(state.goalWorkflow)) {
        state.goalWorkflow = previousWorkflow;
      }
      notifyGoalWorkflowChange();
      toast("Workflow was not prepared", error.message, "error", 9000);
    } finally {
      state.goalWorkflowPreparing = false;
      patchGoalWorkflowLauncher();
    }
  }

  function goalWorkflowError(message, options = {}) {
    const error = new Error(message);
    error.workflowNeedsReview = Boolean(options.needsReview);
    error.workflowRetryable = options.retryable !== false;
    return error;
  }

  function goalWorkflowContextError(workflow = state.goalWorkflow) {
    const connection = activeConnection();
    if (
      !connection ||
      connection.id !== workflow?.connection?.id ||
      normalizedDriverUrl(connection.driverUrl) !== normalizedDriverUrl(workflow?.connection?.driverUrl)
    ) return `Switch back to ${workflow?.connection?.name || "the workflow Driver"} before continuing.`;
    if (activeCartridgeId() !== workflow.cartridgeId) {
      return `Select the ${workflow.cartridgeName || workflow.cartridgeId} cartridge before continuing.`;
    }
    if (connectionStatus(connection.id).state !== "online") return "The workflow Driver is offline.";
    if (state.workspace.connectionId !== connection.id || state.workspace.loading) {
      return "Wait for the selected Driver workspace to finish loading.";
    }
    if (hardwareIndexUiIsActive()) return "Wait for the CWI action to finish before continuing this flow.";
    return "";
  }

  function workflowRefsMatch(actual, expected) {
    if (!Array.isArray(actual) || !Array.isArray(expected) || actual.length !== expected.length) return false;
    return actual.every((ref, index) => classRefKey(ref) === classRefKey(expected[index]));
  }

  function applyGoalWorkflowDriverSnapshot(workflow, snapshot) {
    const current = activeConnection();
    if (
      !current ||
      current.id !== workflow.connection.id ||
      normalizedDriverUrl(current.driverUrl) !== normalizedDriverUrl(workflow.connection.driverUrl) ||
      state.workspace.connectionId !== current.id
    ) return;
    state.workspace.health = snapshot.health;
    state.workspace.actions = snapshot.actions;
    state.workspace.objects = snapshot.objects;
    delete state.workspace.errors.health;
    delete state.workspace.errors.actions;
    delete state.workspace.errors.objects;
    state.statuses.set(current.id, {
      state: snapshot.health?.ok === false ? "offline" : "online",
      checkedAt: new Date(),
      health: snapshot.health,
      error: null,
    });
    scheduleLivePatch({ catalog: true });
    updateHeader();
  }

  async function fetchGoalWorkflowDriverSnapshot(workflow) {
    const connection = workflow.connection;
    const [health, actions, objects] = await Promise.all([
      driverRequest(connection, "/healthz", { timeout: 8000 }),
      driverRequest(connection, "/actions", { timeout: 15000 }),
      driverRequest(connection, "/objects", { timeout: 30000 }),
    ]);
    if (!Array.isArray(actions) || !Array.isArray(objects)) {
      throw goalWorkflowError("The Driver returned an incompatible action catalog or object inventory.", { retryable: true });
    }
    if (health?.ok === false) throw goalWorkflowError("The Driver reported that it is not ready.", { retryable: true });
    if (workflow.driverVersion && health?.version && String(health.version) !== workflow.driverVersion) {
      throw goalWorkflowError(
        `The Driver version changed from ${workflow.driverVersion} to ${health.version}. Replan before submitting another action.`,
        { retryable: false },
      );
    }
    const snapshot = { health, actions, objects };
    applyGoalWorkflowDriverSnapshot(workflow, snapshot);
    return snapshot;
  }

  function workflowObjectForBinding(objects, binding) {
    if (!binding?.contentHash && !binding?.fileName) return null;
    return objects.find((object) =>
      (!binding.contentHash || object.contentHash === binding.contentHash) &&
      (!binding.fileName || object.fileName === binding.fileName)) || null;
  }

  function workflowObjectClassId(object) {
    return classRefKey({ class: object?.class, hash: object?.classHash });
  }

  function goalWorkflowUnrelatedActiveRun(workflow) {
    if (state.workspace.connectionId !== workflow.connection.id) return null;
    const owned = goalWorkflowRunIds(workflow);
    return [...state.workspace.runs.values()].find(
      (run) => run?.runId && !owned.has(run.runId) && !TERMINAL_RUNS.has(run.status),
    ) || null;
  }

  async function preflightGoalWorkflowStep(workflow, step, stepState) {
    const contextError = goalWorkflowContextError(workflow);
    if (contextError) throw goalWorkflowError(contextError, { retryable: true });
    const unrelatedRun = goalWorkflowUnrelatedActiveRun(workflow);
    if (unrelatedRun) {
      throw goalWorkflowError(
        `Driver run ${shortText(unrelatedRun.runId)} is still active outside this workflow. Wait for it to finish, then retry the live check.`,
        { retryable: true },
      );
    }
    stepState.status = "preflight";
    stepState.error = "";
    workflow.error = "";
    workflow.message = `Checking exact action and token bindings for step ${step.order}: ${step.label}.`;
    persistGoalWorkflow();
    const snapshot = await fetchGoalWorkflowDriverSnapshot(workflow);
    const action = snapshot.actions.find((candidate) => plannerActionId(candidate) === step.actionId);
    if (!action || action.hash !== step.actionHash || !sameQualified(action.action, step.action)) {
      throw goalWorkflowError(
        `${step.label} no longer matches the action hash frozen in this plan. Rebuild the plan from the live catalog.`,
        { retryable: false },
      );
    }
    if (!workflowRefsMatch(action.totalInputs || [], step.totalInputs) || !workflowRefsMatch(action.totalOutputs || [], step.totalOutputs)) {
      throw goalWorkflowError(
        `${step.label} changed its flattened input or output slots. Rebuild the plan before continuing.`,
        { retryable: false },
      );
    }
    const orderedInputs = [...step.inputs].sort((left, right) => left.slotIndex - right.slotIndex);
    if (orderedInputs.length !== (action.totalInputs || []).length) {
      throw goalWorkflowError(`${step.label} has an incomplete materialized input map. Replan this goal.`, { retryable: false });
    }
    const objects = [];
    for (const input of orderedInputs) {
      const binding = workflow.tokenBindings[input.tokenId];
      if (!binding) {
        throw goalWorkflowError(`The planned ${input.classLabel} input is not bound to a verified object. Replan from live inventory.`, { retryable: false });
      }
      const object = workflowObjectForBinding(snapshot.objects, binding);
      if (!object || object.status !== "live" || workflowObjectClassId(object) !== input.classId) {
        throw goalWorkflowError(
          `${input.classLabel} for input slot ${input.slotIndex + 1} is no longer live at the exact planned class version.`,
          { retryable: true },
        );
      }
      if (!binding.fileName) binding.fileName = object.fileName || "";
      if (!binding.contentHash) binding.contentHash = object.contentHash || "";
      binding.classId = input.classId;
      objects.push(object);
    }
    const inputObjectPaths = objects.map((object) => object.fileName);
    if (inputObjectPaths.some((fileName) => !fileName) || new Set(inputObjectPaths).size !== inputObjectPaths.length) {
      throw goalWorkflowError(`${step.label} could not resolve distinct file paths for every input slot.`, { retryable: true });
    }
    const report = await driverRequest(
      workflow.connection,
      `/actions/${encodeURIComponent(step.actionKey)}/feasibility`,
      { timeout: 15000 },
    );
    const available = new Set((report?.availableInputs || []).map((candidate) => candidate.fileName));
    if (report?.feasible !== true || inputObjectPaths.some((fileName) => !available.has(fileName))) {
      throw goalWorkflowError(
        `${step.label} is not feasible with the exact objects reserved by this plan. Refresh inventory or replan before retrying.`,
        { retryable: true },
      );
    }
    stepState.inputObjectPaths = inputObjectPaths;
    persistGoalWorkflow(true);
    return { action, inputObjectPaths };
  }

  function mergeGoalWorkflowRun(workflow, run) {
    const current = activeConnection();
    if (
      current?.id !== workflow.connection.id ||
      normalizedDriverUrl(current.driverUrl) !== normalizedDriverUrl(workflow.connection.driverUrl) ||
      state.workspace.connectionId !== current.id
    ) return;
    if (mergeRun(run)) scheduleLivePatch({ activity: true, runId: run.runId });
  }

  async function waitForGoalWorkflowRun(workflow, step, stepState, token) {
    let pollErrors = 0;
    let checkpointFingerprint = "";
    while (token === state.goalWorkflowLoopToken && state.goalWorkflow?.id === workflow.id) {
      try {
        const run = await driverRequest(
          workflow.connection,
          `/actions/runs/${encodeURIComponent(stepState.runId)}`,
          { timeout: 10000 },
        );
        pollErrors = 0;
        if (!run?.runId || run.runId !== stepState.runId) {
          throw goalWorkflowError("The Driver returned a mismatched retained run while this step was being tracked.", { needsReview: true, retryable: false });
        }
        mergeGoalWorkflowRun(workflow, run);
        stepState.runStatus = String(run.status || "queued");
        stepState.runSnapshot = compactGoalWorkflowRun(run);
        const latest = Array.isArray(run.progress) && run.progress.length ? run.progress[run.progress.length - 1] : null;
        const fingerprint = JSON.stringify([run.status, latest?.phase || "", latest?.status || "", latest?.message || ""]);
        workflow.message = latest?.message || `Driver run ${shortText(run.runId)} is ${run.status || "active"}.`;
        if (fingerprint !== checkpointFingerprint || TERMINAL_RUNS.has(run.status)) {
          checkpointFingerprint = fingerprint;
          persistGoalWorkflow();
        } else {
          notifyGoalWorkflowChange({ structure: false });
        }
        if (TERMINAL_RUNS.has(run.status)) return run;
      } catch (error) {
        if (error.workflowNeedsReview) throw error;
        if (error.status === 404) {
          throw goalWorkflowError(
            `Retained run ${shortText(stepState.runId)} is no longer available. Its outcome cannot be inferred or safely retried.`,
            { needsReview: true, retryable: false },
          );
        }
        pollErrors += 1;
        workflow.message = `Run tracking interrupted (${pollErrors}/${GOAL_WORKFLOW_MAX_POLL_ERRORS}). No new action will be submitted.`;
        notifyGoalWorkflowChange({ structure: false });
        if (pollErrors >= GOAL_WORKFLOW_MAX_POLL_ERRORS) {
          workflow.status = "paused";
          workflow.recoveryRequired = true;
          workflow.error = `Tracking ${shortText(stepState.runId)} failed repeatedly. The accepted action remains locked to this run id.`;
          workflow.message = workflow.exitRequested
            ? "Exit remains armed. Resume tracking after the Driver connection is stable; the run will be reconciled and then the flow will stop."
            : "Resume tracking after the Driver connection is stable. The action will not be submitted again.";
          persistGoalWorkflow();
          toast("Run tracking paused", workflow.error, "warning", 9000);
          return null;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, GOAL_WORKFLOW_POLL_MS));
    }
    return null;
  }

  function goalWorkflowRunResultError(run, step, inputObjectPaths) {
    if (!run || run.status !== "succeeded") return run?.error || `${step.label} did not succeed.`;
    if (!run.action || !sameQualified(run.action, step.action)) return "The retained run does not report the exact planned action.";
    const outputFiles = run.result?.outputFiles;
    const nullifiedFiles = run.result?.nullifiedFiles;
    if (!Array.isArray(outputFiles) || outputFiles.length !== step.totalOutputs.length) {
      return `The Driver returned ${Array.isArray(outputFiles) ? outputFiles.length : "no"} output files; ${step.totalOutputs.length} were expected.`;
    }
    if (!Array.isArray(nullifiedFiles)) return "The Driver did not return its consumed-object list.";
    const expectedConsumed = [...inputObjectPaths].sort();
    const actualConsumed = [...nullifiedFiles].sort();
    if (JSON.stringify(expectedConsumed) !== JSON.stringify(actualConsumed)) {
      return "The Driver's consumed-object list does not exactly match the submitted input slots.";
    }
    if (new Set(outputFiles).size !== outputFiles.length) return "The Driver returned duplicate output file paths.";
    return "";
  }

  async function verifyGoalWorkflowStep(workflow, step, stepState, run, token) {
    const resultError = goalWorkflowRunResultError(run, step, stepState.inputObjectPaths || []);
    if (resultError) {
      throw goalWorkflowError(`${step.label}: ${resultError}`, {
        needsReview: run?.status === "succeeded",
        retryable: run?.status !== "succeeded",
      });
    }
    if (run.status === "failed") {
      throw goalWorkflowError(`${step.label} failed: ${run.error || "The Driver rejected the action."}`, { retryable: true });
    }
    stepState.status = "verifying";
    stepState.runStatus = run.status;
    stepState.runSnapshot = compactGoalWorkflowRun(run);
    workflow.message = `Verifying ${step.label} outputs as live exact-version objects.`;
    persistGoalWorkflow();
    let lastError = "The Driver inventory did not expose the committed outputs.";
    for (let attempt = 0; attempt < GOAL_WORKFLOW_OUTPUT_ATTEMPTS; attempt += 1) {
      if (token !== state.goalWorkflowLoopToken || state.goalWorkflow?.id !== workflow.id) return false;
      try {
        const objects = await driverRequest(workflow.connection, "/objects", { timeout: 30000 });
        if (!Array.isArray(objects)) throw new Error("The object inventory response is incompatible.");
        const outputFiles = run.result.outputFiles;
        const orderedOutputs = [...step.outputs].sort((left, right) => left.slotIndex - right.slotIndex);
        const boundOutputs = [];
        for (const output of orderedOutputs) {
          const fileName = outputFiles[output.slotIndex];
          const object = objects.find((candidate) => candidate.fileName === fileName);
          if (!object) throw new Error(`${output.classLabel} output ${fileName || output.slotIndex + 1} is not in inventory yet.`);
          if (object.status !== "live") throw new Error(`${fileName} is ${object.status || "not live"}.`);
          if (workflowObjectClassId(object) !== output.classId) {
            throw new Error(`${fileName} does not match the exact ${output.classLabel} class version.`);
          }
          boundOutputs.push({ output, object });
        }
        const stillLiveInput = (stepState.inputObjectPaths || []).find((fileName) =>
          objects.some((object) => object.fileName === fileName && object.status === "live"));
        if (stillLiveInput) throw new Error(`Consumed input ${stillLiveInput} is still reported live.`);
        for (const { output, object } of boundOutputs) {
          workflow.tokenBindings[output.tokenId] = {
            tokenId: output.tokenId,
            classId: output.classId,
            fileName: object.fileName || "",
            contentHash: object.contentHash || "",
          };
        }
        const current = activeConnection();
        if (current?.id === workflow.connection.id && state.workspace.connectionId === current.id) {
          state.workspace.objects = objects;
          delete state.workspace.errors.objects;
          scheduleLivePatch({ catalog: true });
        }
        stepState.status = "complete";
        stepState.outputFiles = [...outputFiles];
        stepState.completedAt = new Date().toISOString();
        stepState.error = "";
        workflow.currentStepIndex += 1;
        workflow.recoveryRequired = false;
        workflow.message = `${step.label} verified. ${goalWorkflowCompletedCount(workflow)} of ${goalWorkflowActionTotalLabel(workflow)} actions complete.`;
        try {
          persistGoalWorkflow(true);
        } catch (error) {
          throw goalWorkflowError(error.message, { needsReview: true, retryable: false });
        }
        return true;
      } catch (error) {
        if (error.workflowNeedsReview) throw error;
        lastError = error.message || lastError;
        workflow.message = `Verifying outputs (${attempt + 1}/${GOAL_WORKFLOW_OUTPUT_ATTEMPTS}): ${lastError}`;
        notifyGoalWorkflowChange({ structure: false });
        if (attempt + 1 < GOAL_WORKFLOW_OUTPUT_ATTEMPTS) {
          await new Promise((resolve) => setTimeout(resolve, GOAL_WORKFLOW_OUTPUT_POLL_MS));
        }
      }
    }
    throw goalWorkflowError(
      `${step.label} succeeded, but its outputs could not be verified: ${lastError} The action must not be retried.`,
      { needsReview: true, retryable: false },
    );
  }

  async function verifyGoalWorkflowGoal(workflow) {
    const quantity = Number(workflow.goal?.quantity);
    const repeatUnit = workflow.executionMode === "repeat-unit";
    const expectedGoalTokens = repeatUnit ? 1 : quantity;
    if (
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > GOAL_WORKFLOW_MAX_QUANTITY ||
      workflow.goalTokenIds.length !== expectedGoalTokens
    ) {
      throw goalWorkflowError("The workflow goal-token count no longer matches the requested craft quantity.", { needsReview: true, retryable: false });
    }
    const goalLabel = goalWorkflowGoalLabel(workflow);
    const nextCompletedQuantity = repeatUnit
      ? Math.min(quantity, (Number(workflow.completedQuantity) || 0) + Math.max(1, Number(workflow.batchGoalIncrease) || 1))
      : quantity;
    workflow.message = repeatUnit
      ? `Verifying goal-object progress: ${nextCompletedQuantity} of ${quantity}.`
      : `All actions are complete. Verifying ${goalLabel}.`;
    persistGoalWorkflow();
    const snapshot = await fetchGoalWorkflowDriverSnapshot(workflow);
    const objects = snapshot.objects;
    const usedGoalFiles = new Set();
    const usedGoalHashes = new Set();
    for (const tokenId of workflow.goalTokenIds) {
      const binding = workflow.tokenBindings[tokenId];
      const object = workflowObjectForBinding(objects, binding);
      if (!binding || !object || object.status !== "live" || workflowObjectClassId(object) !== workflow.goal.classId) {
        throw goalWorkflowError(
          `A final ${workflow.goal.label} output is not live at the exact planned class version. Review the completed runs before replanning.`,
          { needsReview: true, retryable: false },
        );
      }
      if (
        (object.fileName && usedGoalFiles.has(object.fileName)) ||
        (object.contentHash && usedGoalHashes.has(object.contentHash))
      ) {
        throw goalWorkflowError(
          `Multiple planned goal tokens resolve to the same ${workflow.goal.label} object. The requested quantity was not verified.`,
          { needsReview: true, retryable: false },
        );
      }
      if (object.fileName) usedGoalFiles.add(object.fileName);
      if (object.contentHash) usedGoalHashes.add(object.contentHash);
    }
    if (repeatUnit) {
      const requiredLiveCount = (Number(workflow.goal.initialCount) || 0) + nextCompletedQuantity;
      const liveGoalCount = objects.filter(
        (object) => object.status === "live" && workflowObjectClassId(object) === workflow.goal.classId,
      ).length;
      if (liveGoalCount < requiredLiveCount) {
        throw goalWorkflowError(
          `The current batch was verified, but only ${liveGoalCount} live ${workflow.goal.label} objects remain; at least ${requiredLiveCount} are required for this quantity.`,
          { needsReview: true, retryable: false },
        );
      }
      const completedBatchActions = workflow.steps.length;
      if (nextCompletedQuantity < quantity) {
        const cartridge = selectedCartridge();
        if (!cartridge || cartridge.id !== workflow.cartridgeId) {
          throw goalWorkflowError(`Select the ${workflow.cartridgeName} cartridge before the next craft is planned.`, { retryable: true });
        }
        const catalog = buildPlannerCatalog(cartridge, state.workspace);
        const inventory = buildPlannerInventory(objects);
        const result = planGoalOutput(catalog, inventory, {
          classId: workflow.goal.classId,
          quantity: 1,
          semantics: "additional",
          maxSteps: GOAL_WORKFLOW_MAX_STEPS,
        });
        if (result.status !== "planned" || !result.steps.length) {
          throw goalWorkflowError(
            `${nextCompletedQuantity} of ${quantity} goal objects are complete, but the next batch could not be planned from live inventory (${result.status || "no plan"}). Retry to recheck live state.`,
            { retryable: true },
          );
        }
        const batch = createGoalWorkflowPlanBatch({ result, catalog });
        workflow.completedQuantity = nextCompletedQuantity;
        workflow.completedActionCount = (Number(workflow.completedActionCount) || 0) + completedBatchActions;
        workflow.goalTokenIds = batch.goalTokenIds;
        workflow.steps = batch.steps;
        workflow.stepStates = batch.stepStates;
        workflow.tokenBindings = batch.tokenBindings;
        workflow.batchGoalIncrease = batch.goalIncrease;
        workflow.currentStepIndex = 0;
        workflow.estimatedActionCount = goalWorkflowEstimatedActionCount(workflow);
        workflow.estimateComplete &&= batch.estimateComplete;
        workflow.recoveryRequired = false;
        workflow.error = "";
        workflow.message = `${nextCompletedQuantity} of ${quantity} goal objects verified. The next batch was replanned from live inventory.`;
        persistGoalWorkflow(true);
        return false;
      }
      workflow.completedQuantity = nextCompletedQuantity;
      workflow.estimatedActionCount = (Number(workflow.completedActionCount) || 0) + completedBatchActions;
    }
    workflow.status = "complete";
    workflow.completedAt = new Date().toISOString();
    workflow.message = `${goalLabel} is live and verified.`;
    workflow.error = "";
    persistGoalWorkflow();
    toast("Goal workflow complete", `${goalLabel} / ${goalWorkflowCompletedCount(workflow)} actions verified`, "success", 9000);
    return true;
  }

  function stopGoalWorkflowBetweenSteps(workflow, reason) {
    if (workflow.exitRequested) {
      workflow.status = "stopped";
      workflow.stoppedAt = new Date().toISOString();
      workflow.message = reason || "Workflow exited before another action was submitted.";
      workflow.error = "";
      persistGoalWorkflow();
      toast("Workflow exited", "No further actions will be submitted.", "warning", 6500);
      return true;
    }
    if (workflow.pauseRequested) {
      workflow.status = "paused";
      workflow.message = reason || "Paused between actions. Press Play to continue from a fresh live preflight.";
      persistGoalWorkflow();
      toast("Workflow paused", "No new action will be submitted until you resume.", "info", 5000);
      return true;
    }
    return false;
  }

  function failGoalWorkflow(workflow, stepState, error) {
    const needsReview = Boolean(error?.workflowNeedsReview);
    const exitRequested = Boolean(workflow.exitRequested);
    workflow.status = needsReview ? "needs-review" : "error";
    workflow.pauseRequested = false;
    workflow.exitRequested = exitRequested;
    workflow.error = error?.message || "The workflow stopped unexpectedly.";
    workflow.message = exitRequested
      ? "Exit remains armed. No later action will be submitted. Review this result, then acknowledge the stopped flow."
      : needsReview
        ? "Automation is safety-locked. No later action will be submitted."
        : "The workflow is stopped. Retry performs a fresh live preflight and never skips this step.";
    if (stepState) {
      stepState.status = needsReview ? "needs-review" : "failed";
      stepState.error = workflow.error;
      stepState.retryable = !exitRequested && !needsReview && error?.workflowRetryable !== false;
      stepState.outcomeUnknown ||= needsReview && !stepState.runId;
    }
    persistGoalWorkflow();
    toast(needsReview ? "Workflow needs review" : "Workflow stopped", workflow.error, "error", 10000);
  }

  async function runGoalWorkflowLoop(workflow, token) {
    try {
      while (token === state.goalWorkflowLoopToken && state.goalWorkflow?.id === workflow.id) {
        if (workflow.currentStepIndex >= workflow.steps.length) {
          if (stopGoalWorkflowBetweenSteps(workflow, "All submitted actions finished; final goal verification was skipped because Exit was requested.")) return;
          const complete = await verifyGoalWorkflowGoal(workflow);
          if (complete) return;
          continue;
        }
        const step = goalWorkflowCurrentStep(workflow);
        const stepState = goalWorkflowCurrentStepState(workflow);
        if (!step || !stepState) {
          throw goalWorkflowError("The saved workflow step map is incomplete.", { needsReview: true, retryable: false });
        }
        if (stepState.status === "complete") {
          workflow.currentStepIndex += 1;
          persistGoalWorkflow();
          continue;
        }
        if (!stepState.runId && stopGoalWorkflowBetweenSteps(workflow)) return;
        let run = stepState.runSnapshot && TERMINAL_RUNS.has(stepState.runSnapshot.status)
          ? stepState.runSnapshot
          : null;
        if (!run && stepState.runId) {
          workflow.recoveryRequired = true;
          workflow.message = `Reconciling retained run ${shortText(stepState.runId)} before any new submission.`;
          persistGoalWorkflow();
          run = await waitForGoalWorkflowRun(workflow, step, stepState, token);
          if (!run) return;
        }
        if (!run) {
          const preflight = await preflightGoalWorkflowStep(workflow, step, stepState);
          if (stopGoalWorkflowBetweenSteps(workflow)) return;
          const postPreflightContextError = goalWorkflowContextError(workflow);
          if (postPreflightContextError) {
            throw goalWorkflowError(`${postPreflightContextError} No action was submitted.`, { retryable: true });
          }
          const submissionKey = actionSubmissionKey(workflow.connection, preflight.action, preflight.inputObjectPaths);
          if (state.inFlightActionSubmissions.has(submissionKey) || state.ambiguousActionSubmissions.has(submissionKey)) {
            throw goalWorkflowError(
              "A matching action submission is already in flight or has an unknown outcome in this browser session.",
              { needsReview: state.ambiguousActionSubmissions.has(submissionKey), retryable: false },
            );
          }
          state.inFlightActionSubmissions.add(submissionKey);
          stepState.status = "submitting";
          stepState.startedAt ||= new Date().toISOString();
          stepState.error = "";
          workflow.message = `Submitting step ${step.order}: ${step.label}.`;
          try {
            persistGoalWorkflow(true);
          } catch (error) {
            state.inFlightActionSubmissions.delete(submissionKey);
            throw goalWorkflowError(error.message, { retryable: true });
          }
          let accepted;
          try {
            accepted = await driverRequest(
              workflow.connection,
              "/actions/run",
              jsonOptions("POST", { input: { action: step.action, inputObjectPaths: preflight.inputObjectPaths } }, 30000),
            );
            if (!accepted?.runId) {
              throw goalWorkflowError(
                "The Driver accepted the request without a run id. Its outcome is unknown and the action cannot be retried safely.",
                { needsReview: true, retryable: false },
              );
            }
          } catch (error) {
            state.inFlightActionSubmissions.delete(submissionKey);
            const status = Number(error?.status) || 0;
            const explicitDeterministicRejection = status >= 400 && status < 500 && !new Set([408, 425, 429]).has(status);
            const ambiguous = error.workflowNeedsReview || !explicitDeterministicRejection;
            if (ambiguous) state.ambiguousActionSubmissions.add(submissionKey);
            throw ambiguous
              ? goalWorkflowError(
                  `${error.message} The request may have reached the Driver; no retry or later step will be attempted.`,
                  { needsReview: true, retryable: false },
                )
              : goalWorkflowError(error.message, { retryable: true });
          }
          state.inFlightActionSubmissions.delete(submissionKey);
          stepState.runId = accepted.runId;
          stepState.runStatus = String(accepted.status || "queued");
          stepState.status = "running";
          stepState.runSnapshot = compactGoalWorkflowRun({
            ...accepted,
            action: step.action,
            result: null,
            error: null,
            progress: [],
          });
          workflow.recoveryRequired = true;
          workflow.status = workflow.exitRequested ? "stopping" : workflow.pauseRequested ? "pausing" : "running";
          workflow.message = `${step.label} accepted as run ${shortText(accepted.runId)}.`;
          try {
            persistGoalWorkflow(true);
          } catch (error) {
            throw goalWorkflowError(
              `${error.message} Run ${shortText(accepted.runId)} was accepted; keep this tab open and review Activity if tracking stops.`,
              { needsReview: true, retryable: false },
            );
          }
          rememberRun(workflow.connection.id, accepted.runId);
          mergeGoalWorkflowRun(workflow, stepState.runSnapshot);
          run = await waitForGoalWorkflowRun(workflow, step, stepState, token);
          if (!run) return;
        }
        if (run.status === "failed" && workflow.exitRequested) {
          stopGoalWorkflowBetweenSteps(workflow, `${step.label} reached terminal failure after Exit was requested. No later action was submitted.`);
          return;
        }
        if (run.status === "failed") {
          throw goalWorkflowError(`${step.label} failed: ${run.error || "The Driver reported a terminal failure."}`, { retryable: true });
        }
        await verifyGoalWorkflowStep(workflow, step, stepState, run, token);
        if (stopGoalWorkflowBetweenSteps(workflow)) return;
        const contextError = goalWorkflowContextError(workflow);
        if (contextError) {
          workflow.status = "paused";
          workflow.message = `${contextError} The completed action is saved; no next step was submitted.`;
          persistGoalWorkflow();
          toast("Workflow paused", contextError, "warning", 7500);
          return;
        }
      }
    } catch (error) {
      if (token !== state.goalWorkflowLoopToken || state.goalWorkflow?.id !== workflow.id) return;
      failGoalWorkflow(workflow, goalWorkflowCurrentStepState(workflow), error);
    }
  }

  function launchGoalWorkflowEngine(options = {}) {
    const workflow = state.goalWorkflow;
    if (!workflow || state.goalWorkflowLoopPromise) return;
    if (workflow.status === "needs-review") {
      toast("Review required", "This workflow cannot submit another action until the unknown outcome is reconciled.", "warning", 7500);
      return;
    }
    const contextError = goalWorkflowContextError(workflow);
    const currentState = goalWorkflowCurrentStepState(workflow);
    const hasRetainedRun = Boolean(currentState?.runId);
    if (contextError && !hasRetainedRun) {
      toast("Workflow cannot continue", contextError, "error", 7500);
      return;
    }
    if (workflow.status === "ready" && !options.skipConfirmation) {
      showGoalWorkflowStartConfirmation();
      return;
    }
    const token = ++state.goalWorkflowLoopToken;
    const execute = async (lock) => {
      if (!lock && globalThis.navigator?.locks) {
        toast("Workflow is active in another tab", "Use the tab that owns the Driver workflow, or wait for it to close before resuming here.", "warning", 9000);
        return;
      }
      if (state.goalWorkflow?.id !== workflow.id) return;
      let persisted;
      try {
        persisted = readGoalWorkflowStorageRecord();
      } catch (error) {
        toast("Workflow recovery check failed", `No action was sent. ${error.message}`, "error", 9000);
        return;
      }
      if (
        !persisted ||
        persisted.id !== workflow.id ||
        (Number(persisted.revision) || 0) !== (Number(workflow.revision) || 0)
      ) {
        adoptPersistedGoalWorkflow();
        toast("Workflow changed in another tab", "The latest saved workflow was loaded. No action was sent from this stale copy.", "warning", 9000);
        return;
      }
      if (
        !globalThis.navigator?.locks &&
        GOAL_WORKFLOW_AUTOMATION_STATUSES.has(persisted.status) &&
        persisted.ownerTabId &&
        persisted.ownerTabId !== state.goalWorkflowTabId
      ) {
        adoptPersistedGoalWorkflow();
        toast("Workflow is owned by another tab", "This browser cannot safely take over without Web Locks. No action was sent.", "warning", 9000);
        return;
      }
      if (!options.preserveExitRequest) workflow.exitRequested = false;
      workflow.pauseRequested = false;
      workflow.ownerTabId = state.goalWorkflowTabId;
      workflow.status = workflow.exitRequested ? "stopping" : "running";
      workflow.startedAt ||= new Date().toISOString();
      workflow.error = "";
      workflow.message = hasRetainedRun
        ? `Resuming retained run ${shortText(currentState.runId)}. No duplicate action will be submitted.`
        : "Workflow running. Performing a fresh Driver preflight before each action.";
      try {
        persistGoalWorkflow(true);
      } catch (error) {
        failGoalWorkflow(workflow, currentState, goalWorkflowError(error.message, { retryable: true }));
        return;
      }
      await runGoalWorkflowLoop(workflow, token);
    };
    const lockName = goalWorkflowLockName(workflow.connection);
    const promise = globalThis.navigator?.locks?.request
      ? navigator.locks.request(lockName, { ifAvailable: true }, execute)
      : execute({ name: lockName });
    state.goalWorkflowLoopPromise = Promise.resolve(promise)
      .catch((error) => {
        if (state.goalWorkflow?.id === workflow.id) {
          failGoalWorkflow(workflow, goalWorkflowCurrentStepState(workflow), goalWorkflowError(error.message, { retryable: true }));
        }
      })
      .finally(() => {
        if (token === state.goalWorkflowLoopToken) state.goalWorkflowLoopPromise = null;
        notifyGoalWorkflowChange();
      });
  }

  function showGoalWorkflowStartConfirmation() {
    const workflow = state.goalWorkflow;
    if (!workflow || workflow.status !== "ready") return;
    if (state.drawer?.type !== "workflow") openGoalWorkflowManager();
    if (state.drawer?.type !== "workflow") return;
    state.drawer.workflowStartConfirmation = true;
    renderDrawer();
  }

  function cancelGoalWorkflowStartConfirmation() {
    if (state.drawer?.type !== "workflow" || !state.drawer.workflowStartConfirmation) return false;
    state.drawer.workflowStartConfirmation = false;
    renderDrawer();
    return true;
  }

  function confirmGoalWorkflowStart() {
    const workflow = state.goalWorkflow;
    if (
      !workflow ||
      workflow.status !== "ready" ||
      state.drawer?.type !== "workflow" ||
      !state.drawer.workflowStartConfirmation
    ) return;
    state.drawer.workflowStartConfirmation = false;
    renderDrawer(false);
    launchGoalWorkflowEngine({ skipConfirmation: true });
  }

  function pauseGoalWorkflow() {
    const workflow = state.goalWorkflow;
    if (goalWorkflowOwnedByOtherTab(workflow)) {
      toast("Workflow is active in another tab", "Use the tab that owns this flow to pause it.", "warning", 7000);
      return;
    }
    if (!workflow || !new Set(["running", "stopping"]).has(workflow.status)) return;
    workflow.pauseRequested = true;
    workflow.exitRequested = false;
    workflow.status = "pausing";
    const current = goalWorkflowCurrentStepState(workflow);
    workflow.message = current?.runId || current?.status === "submitting"
      ? "Pause requested. The current accepted/requested Driver action will be reconciled, then automation will pause."
      : "Pause requested. No action will be submitted after the current live preflight.";
    persistGoalWorkflow();
  }

  function resumeGoalWorkflow() {
    const workflow = state.goalWorkflow;
    if (!workflow) return;
    if (state.goalWorkflowLoopPromise && workflow.status === "pausing") {
      workflow.pauseRequested = false;
      workflow.status = "running";
      workflow.message = "Pause request cancelled. The workflow will continue after the current action.";
      persistGoalWorkflow();
      return;
    }
    if (!new Set(["ready", "paused"]).has(workflow.status)) return;
    launchGoalWorkflowEngine({ preserveExitRequest: Boolean(workflow.exitRequested) });
  }

  function retryGoalWorkflowStep() {
    const workflow = state.goalWorkflow;
    const step = goalWorkflowCurrentStep(workflow);
    const stepState = goalWorkflowCurrentStepState(workflow);
    if (!workflow || workflow.status !== "error" || state.goalWorkflowLoopPromise) return;
    if (!step && workflow.currentStepIndex >= workflow.steps.length) {
      const awaitingNextCraft = workflow.executionMode === "repeat-unit" && workflow.completedQuantity < workflow.goal.quantity;
      const approved = globalThis.confirm(
        awaitingNextCraft
          ? `Retry the live check and next-batch plan for ${goalWorkflowGoalLabel(workflow)}?\n\nThe completed batch will be verified again. If a new exact plan is available, the workflow will continue toward the requested quantity.`
          : `Retry final verification for ${goalWorkflowGoalLabel(workflow)}?\n\nNo action will be submitted. The console will only refresh live objects and verify the planned goal objects.`,
      );
      if (!approved) return;
      workflow.status = "paused";
      workflow.error = "";
      workflow.message = awaitingNextCraft
        ? `Retrying the live goal check and next-batch plan for ${goalWorkflowGoalLabel(workflow)}.`
        : `Retrying final live-object verification for ${goalWorkflowGoalLabel(workflow)}.`;
      persistGoalWorkflow();
      launchGoalWorkflowEngine({ skipConfirmation: true });
      return;
    }
    if (!step || !stepState?.retryable) return;
    const approved = globalThis.confirm(
      `Retry ${step.label}?\n\nThe console will discard only this failed attempt's local step state, perform a fresh exact-object feasibility check, and submit again only if that check succeeds. Earlier completed actions remain committed.`,
    );
    if (!approved) return;
    stepState.status = "pending";
    stepState.runId = "";
    stepState.runStatus = "";
    stepState.runSnapshot = null;
    stepState.inputObjectPaths = [];
    stepState.outputFiles = [];
    stepState.error = "";
    stepState.outcomeUnknown = false;
    workflow.status = "paused";
    workflow.error = "";
    workflow.message = `Retry armed for ${step.label}; a fresh live preflight is required.`;
    persistGoalWorkflow();
    launchGoalWorkflowEngine({ skipConfirmation: true });
  }

  function exitGoalWorkflow() {
    const workflow = state.goalWorkflow;
    if (goalWorkflowOwnedByOtherTab(workflow)) {
      toast("Workflow is active in another tab", "Use the tab that owns this flow to exit it.", "warning", 7000);
      return;
    }
    if (!workflow || new Set(["complete", "stopped"]).has(workflow.status)) return;
    const current = goalWorkflowCurrentStepState(workflow);
    const activeAction = Boolean(current?.runId && !TERMINAL_RUNS.has(current.runSnapshot?.status)) || current?.status === "submitting";
    const approved = globalThis.confirm(
      `Exit the ${goalWorkflowGoalLabel(workflow)} workflow?\n\nNo later actions will be submitted. ` +
        (activeAction
          ? "The current Driver action cannot be cancelled; the console will keep tracking and verifying it, then stop."
          : "Already completed actions remain committed and cannot be undone."),
    );
    if (!approved) return;
    if (workflow.status === "needs-review") {
      workflow.exitRequested = true;
      workflow.message = "Automation is exited, but the unknown action outcome remains safety-locked for review.";
      persistGoalWorkflow();
      return;
    }
    workflow.exitRequested = true;
    workflow.pauseRequested = false;
    if (state.goalWorkflowLoopPromise || activeAction) {
      workflow.status = "stopping";
      workflow.message = activeAction
        ? "Exit requested. Tracking and output verification continue for the current action; no next action will start."
        : "Exit requested. The workflow will stop before the next submission.";
      persistGoalWorkflow();
      if (!state.goalWorkflowLoopPromise) launchGoalWorkflowEngine({ skipConfirmation: true, preserveExitRequest: true });
      return;
    }
    stopGoalWorkflowBetweenSteps(workflow, "Workflow exited before another action was submitted.");
  }

  function dismissGoalWorkflow() {
    const workflow = state.goalWorkflow;
    if (!workflow || !new Set(["complete", "stopped"]).has(workflow.status)) return;
    state.goalWorkflow = null;
    persistGoalWorkflow();
    if (state.drawer?.type === "workflow") closeDrawer();
  }

  async function acknowledgeGoalWorkflowReview() {
    const workflow = state.goalWorkflow;
    if (!workflow || workflow.status !== "needs-review") return;
    const step = goalWorkflowCurrentStep(workflow);
    const stepState = goalWorkflowCurrentStepState(workflow);
    const approved = globalThis.confirm(
      `Clear the safety lock for ${goalWorkflowGoalLabel(workflow)}?\n\nOnly continue after checking Driver Activity and live objects for the uncertain run. Clearing this monitor does not undo any accepted action. The planner will refresh from live state before another workflow can be prepared.`,
    );
    if (!approved) return;
    if (step && stepState?.inputObjectPaths) {
      const submissionKey = actionSubmissionKey(
        workflow.connection,
        { action: step.action, hash: step.actionHash },
        stepState.inputObjectPaths,
      );
      state.ambiguousActionSubmissions.delete(submissionKey);
    }
    workflow.status = "stopped";
    workflow.exitRequested = true;
    workflow.stoppedAt = new Date().toISOString();
    workflow.reviewAcknowledgedAt = new Date().toISOString();
    workflow.message = "Review acknowledged. Automation is stopped; refresh/replan from live Driver state before continuing.";
    workflow.error = "";
    persistGoalWorkflow();
    closeDrawer();
    await refreshEverything();
    if (selectedCartridge()?.id === workflow.cartridgeId) navigate("planner");
    toast("Workflow review acknowledged", "Live Driver state was refreshed. Replan before starting another action set.", "warning", 8000);
  }

  function objectCatalogMarkup(cartridge = selectedCartridge()) {
    if (!cartridge) return errorPanel("Select a cartridge", "Choose a cartridge before opening its inventory.", "cartridges");
    const query = state.objectSearch.trim().toLowerCase();
    const filtered = state.workspace.objects.filter((object) => {
      if (object.class?.pluginName !== cartridge.id) return false;
      if (state.objectStatus !== "all" && (object.status || "unknown") !== state.objectStatus) return false;
      return !query || object.class?.name?.toLowerCase().includes(query) || object.fileName?.toLowerCase().includes(query) || object.contentHash?.toLowerCase().includes(query);
    });
    const visible = filtered.slice(0, state.objectLimit);
    const cards = visible.map((object) => {
      const status = String(object.status || "unknown").toLowerCase();
      const statusKey = new Set(["live", "pending", "nullified", "unknown"]).has(status) ? status : "unknown";
      const name = object.class?.name || "Unknown object";
      const shortHash = shortText(object.contentHash, 7, 5);
      const accessibleHash = shortText(object.contentHash, 10, 7);
      const ariaLabel = `${name}. ${statusKey}. Object ${accessibleHash}. Open object details.`;
      return `
        <button class="object-card compact-card menu-focusable" type="button" data-command="view-object" data-id="${escapeHtml(object.fileName)}" aria-label="${escapeHtml(ariaLabel)}" title="${escapeHtml(object.fileName || ariaLabel)}">
          <span class="compact-card-top">
            <span class="card-orb" aria-hidden="true">${escapeHtml(object.emoji || "OBJ")}</span>
            <span class="card-status is-${statusKey}">${escapeHtml(statusKey)}</span>
          </span>
          <span class="card-title">${escapeHtml(name)}</span>
          <span class="compact-card-meta mono" aria-hidden="true"><span>${escapeHtml(shortHash)}</span><span>Open</span></span>
        </button>`;
    }).join("");
    return `${state.workspace.errors.objects
      ? errorPanel("Inventory unavailable", state.workspace.errors.objects)
      : visible.length
        ? `<div class="object-grid">${cards}</div>`
        : '<div class="game-panel"><div class="game-empty"><h2>No inventory matches</h2><p>Change the search, status, or selected cartridge.</p></div></div>'}
      ${filtered.length > visible.length ? `<div class="load-more">${gameButton(`Show ${Math.min(90, filtered.length - visible.length)} more`, "more-objects")}</div>` : ""}`;
  }

  function renderObjects() {
    const cartridge = selectedCartridge();
    if (!cartridge) {
      return `
        <section class="game-screen" aria-labelledby="objects-title">
          ${screenHeading("Inventory menu", "No cartridge selected", "Inventory is shown only for the selected cartridge.", backButton())}
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
          "Inventory",
          "Your current inventory compatible with the selected cartridge.",
        )}
        ${cartridgeNavigation("objects", gameButton("Import .dobj", "import-object", { tone: "primary", disabled: connectionStatus(activeConnection()?.id).state !== "online" }))}
        <div class="game-toolbar">
          <input id="object-search" class="game-input game-search" type="search" placeholder="Search inventory" value="${escapeHtml(state.objectSearch)}" aria-label="Search inventory" />
          <div class="game-toolbar-group">
            <label class="sr-only" for="object-status">Inventory status</label>
            <select id="object-status" class="game-select">${statusOptions}</select>
          </div>
        </div>
        <div data-catalog-region="objects">${objectCatalogMarkup(cartridge)}</div>
      </section>`;
  }

  function patchCatalogScreen() {
    const screen = state.screen;
    if (!new Set(["actions", "objects", "cartridges", "planner", "tree"]).has(screen)) return;
    if (screen === "tree") {
      patchTechTree();
      return;
    }
    if (screen === "planner") {
      patchPlanner();
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
          ${object ? gameButton("View neighborhood", "object-tree", { extra: ` data-id="${escapeHtml(object.fileName)}"` }) : ""}
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
    const cartridge = selectedCartridge();
    const refreshButton = gameButton("Refresh runs", "refresh-runs");
    return `
      <section class="game-screen game-screen-wide" aria-labelledby="activity-title">
        ${screenHeading(
          cartridge ? `${cartridge.name} cartridge` : "Driver telemetry",
          "Activity",
          "Retained runs come from dobjd; the live event list exists only in this browser tab.",
          cartridge ? "" : `${backButton()}${refreshButton}`,
        )}
        ${cartridge ? cartridgeNavigation("activity", refreshButton) : ""}
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

  const RUN_STAGE_LABELS = ["Queue", "Prepare", "Commit", "Complete"];

  function runStageView(run) {
    if (!run) {
      return { activeIndex: -1, value: 0, label: "Loading run", message: "Reading retained Driver state.", failed: false, succeeded: false };
    }
    const status = String(run.status || "queued").toLowerCase();
    const latest = Array.isArray(run.progress) && run.progress.length ? run.progress[run.progress.length - 1] : null;
    const latestPhase = String(latest?.phase || "").toLowerCase();
    const message = latest?.message || run.error || (status === "succeeded" ? "The Driver reported a successful action run." : "Waiting for the Driver to report its next stage.");
    if (status === "succeeded") {
      return { activeIndex: -1, value: 4, label: "Action complete", message, failed: false, succeeded: true };
    }
    if (status === "failed") {
      const activeIndex = latestPhase.includes("commit") ? 2 : latestPhase.includes("proof") ? 1 : 0;
      return { activeIndex, value: activeIndex + 1, label: `${RUN_STAGE_LABELS[activeIndex]} failed`, message, failed: true, succeeded: false };
    }
    if (status === "committing") {
      return { activeIndex: 2, value: 3, label: "Finalize & commit", message, failed: false, succeeded: false };
    }
    if (status === "generateproof" || status === "running") {
      return { activeIndex: 1, value: 2, label: "Prepare & prove", message, failed: false, succeeded: false };
    }
    return { activeIndex: 0, value: 1, label: "Queued by Driver", message, failed: false, succeeded: false };
  }

  function runStageClasses(view, index) {
    const complete = view.succeeded || index < view.activeIndex;
    const active = index === view.activeIndex;
    return [
      "run-meter-segment",
      complete ? "is-complete" : "",
      active ? "is-active" : "",
      active && view.failed ? "is-failed" : "",
    ].filter(Boolean).join(" ");
  }

  function runProgressMeterMarkup(run, options = {}) {
    const view = runStageView(run);
    const segments = RUN_STAGE_LABELS.map((label, index) => {
      return `<li class="${runStageClasses(view, index)}" data-run-stage-index="${index}"><span aria-hidden="true">${index + 1}</span><b>${label}</b></li>`;
    }).join("");
    return `
      <div class="run-meter${view.failed ? " is-failed" : view.succeeded ? " is-succeeded" : ""}" data-run-meter-shell>
        <div class="run-meter-copy">
          <span>Driver pipeline</span>
          <strong data-run-meter-label>${escapeHtml(view.label)}</strong>
          <small data-run-meter-unit>Stage ${view.value} of 4 / not elapsed time</small>
        </div>
        <ol class="run-meter-track" data-run-meter-track role="progressbar" aria-label="Action pipeline stage" aria-valuemin="0" aria-valuemax="4" aria-valuenow="${view.value}" aria-valuetext="${escapeHtml(view.label)}">${segments}</ol>
        <p data-run-meter-message>${escapeHtml(view.message)}</p>
        ${options.announce === false ? "" : `<span class="sr-only" data-run-meter-announcement aria-live="polite" aria-atomic="true">${escapeHtml(`${view.label}. ${view.message}`)}</span>`}
      </div>`;
  }

  function patchRunMeter(run) {
    const shell = drawerContent.querySelector("[data-run-meter-shell]");
    if (!shell) return;
    const view = runStageView(run);
    shell.className = `run-meter${view.failed ? " is-failed" : view.succeeded ? " is-succeeded" : ""}`;
    const label = shell.querySelector("[data-run-meter-label]");
    const unit = shell.querySelector("[data-run-meter-unit]");
    const track = shell.querySelector("[data-run-meter-track]");
    const message = shell.querySelector("[data-run-meter-message]");
    const announcement = shell.querySelector("[data-run-meter-announcement]");
    if (label) label.textContent = view.label;
    if (unit) unit.textContent = `Stage ${view.value} of 4 / not elapsed time`;
    if (track) {
      track.setAttribute("aria-valuenow", String(view.value));
      track.setAttribute("aria-valuetext", view.label);
    }
    shell.querySelectorAll("[data-run-stage-index]").forEach((segment) => {
      segment.className = runStageClasses(view, Number(segment.dataset.runStageIndex));
    });
    if (message && message.textContent !== view.message) message.textContent = view.message;
    const announcementText = `${view.label}. ${view.message}`;
    if (announcement && announcement.textContent !== announcementText) announcement.textContent = announcementText;
  }

  function runSubmissionProgressMarkup() {
    return `
      <div class="run-meter is-requesting">
        <div class="run-meter-copy"><span>Action request</span><strong>Contacting Driver</strong><small>Awaiting a run id / not yet queued</small></div>
        <div class="run-request-track" role="progressbar" aria-label="Submitting action" aria-valuetext="Contacting Driver"><span></span></div>
      </div>`;
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
        <div><p class="screen-kicker">Action run</p><h2 class="drawer-title" id="drawer-title" data-run-title data-run-focus tabindex="-1">${escapeHtml(run?.action?.name || shortText(model.runId))}</h2></div>
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
        <div class="game-panel"><div class="game-panel-header"><h3>Progress</h3><span data-run-badge>${badge(run?.status || "loading")}</span></div><div class="game-panel-body run-progress-body"><div data-run-meter>${runProgressMeterMarkup(run)}</div><div class="run-progress-log" data-run-progress>${runProgressMarkup(run)}</div></div></div>
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
    patchRunMeter(run);
    setHtml("[data-run-progress]", runProgressMarkup(run));
    setHtml("[data-run-result]", runResultMarkup(run));
  }

  function goalWorkflowBadgeMarkup(workflow) {
    const tone = workflow.status === "complete"
      ? "badge-success"
      : new Set(["error", "needs-review"]).has(workflow.status)
        ? "badge-failed"
        : new Set(["running", "pausing", "stopping"]).has(workflow.status)
          ? "badge-running"
          : "badge-neutral";
    return `<span class="badge ${tone}">${escapeHtml(goalWorkflowStatusLabel(workflow))}</span>`;
  }

  function goalWorkflowStepStatusLabel(stepState) {
    return ({
      pending: "Queued",
      preflight: "Live check",
      submitting: "Submitting",
      running: stepState.runStatus || "Driver active",
      verifying: "Verifying outputs",
      complete: "Verified",
      failed: "Stopped",
      "needs-review": "Review",
    })[stepState?.status] || stepState?.status || "Queued";
  }

  function goalWorkflowCurrentRun(workflow) {
    const stepState = goalWorkflowCurrentStepState(workflow);
    if (!stepState?.runId) return null;
    const current = activeConnection();
    const workspaceRun = current?.id === workflow.connection.id && state.workspace.connectionId === current.id
      ? state.workspace.runs.get(stepState.runId)
      : null;
    return workspaceRun || stepState.runSnapshot || null;
  }

  function goalWorkflowQueueMarkup(workflow) {
    const current = Math.min(workflow.currentStepIndex, Math.max(0, workflow.steps.length - 1));
    const start = Math.max(0, current - 3);
    const end = Math.min(workflow.steps.length, Math.max(current + 7, 8));
    const hiddenBefore = start;
    const hiddenAfter = workflow.steps.length - end;
    const rows = [];
    if (hiddenBefore) rows.push(`<li class="workflow-queue-summary">${hiddenBefore} earlier verified action${hiddenBefore === 1 ? "" : "s"}</li>`);
    for (let index = start; index < end; index += 1) {
      const step = workflow.steps[index];
      const stepState = workflow.stepStates[index];
      const currentAttribute = index === workflow.currentStepIndex ? ' aria-current="step"' : "";
      const timing = step.estimatedMilliseconds != null && step.estimatedMilliseconds !== "" && Number.isFinite(Number(step.estimatedMilliseconds))
        ? `${step.estimateLowerBound ? ">= " : "~"}${formatProofDuration(Number(step.estimatedMilliseconds))}`
        : "Time unknown";
      rows.push(`
        <li class="workflow-queue-row is-${escapeHtml(stepState.status)}"${currentAttribute}>
          <span class="planner-step-number">${String(index + 1).padStart(2, "0")}</span>
          <span><strong>${escapeHtml(step.label)}</strong><small>${escapeHtml(goalWorkflowStepStatusLabel(stepState))}</small></span>
          <span class="workflow-queue-time">${escapeHtml(timing)}</span>
        </li>`);
    }
    if (hiddenAfter) rows.push(`<li class="workflow-queue-summary">${hiddenAfter} later action${hiddenAfter === 1 ? "" : "s"}</li>`);
    return `<ul class="workflow-queue-list">${rows.join("")}</ul>`;
  }

  function goalWorkflowCurrentActionMarkup(workflow) {
    const step = goalWorkflowCurrentStep(workflow);
    const stepState = goalWorkflowCurrentStepState(workflow);
    if (!step || !stepState) {
      return `
        <div class="workflow-current-copy"><span>Final check</span><strong>${escapeHtml(goalWorkflowGoalLabel(workflow))}</strong><small>All planned actions have been processed.</small></div>
        <div class="terminal-note">${escapeHtml(workflow.message || "Verifying final goal output.")}</div>`;
    }
    const inputLabels = step.inputs.map((input) => input.classLabel).join(", ") || "None";
    const outputLabels = step.outputs.map((output) => output.classLabel).join(", ") || "None";
    const craftLabel = workflow.executionMode === "repeat-unit"
      ? `Goal objects ${Number(workflow.completedQuantity) || 0} of ${workflow.goal.quantity} / current batch / `
      : "";
    const run = goalWorkflowCurrentRun(workflow);
    const canOpenRun = activeConnection()?.id === workflow.connection.id && state.workspace.connectionId === workflow.connection.id;
    let meter = "";
    if (stepState.status === "submitting") meter = runSubmissionProgressMarkup();
    else if (stepState.status === "preflight" || stepState.status === "pending") {
      meter = `
        <div class="workflow-check-meter">
          <span>${stepState.status === "preflight" ? "LIVE PREFLIGHT" : "WAITING"}</span>
          <strong>${escapeHtml(workflow.message)}</strong>
          <div class="run-request-track" aria-hidden="true"><span></span></div>
        </div>`;
    } else if (stepState.status === "verifying") {
      meter = `
        <div class="workflow-check-meter is-verifying">
          <span>OUTPUT RECONCILIATION</span>
          <strong>${escapeHtml(workflow.message)}</strong>
          <div class="run-request-track" aria-hidden="true"><span></span></div>
        </div>`;
    } else if (run) {
      meter = `${runProgressMeterMarkup(run, { announce: false })}<div class="run-progress-log" data-workflow-run-progress>${runProgressMarkup(run)}</div>`;
    } else {
      meter = `<div class="terminal-note">${escapeHtml(workflow.message || goalWorkflowStepStatusLabel(stepState))}</div>`;
    }
    return `
      <div class="workflow-current-copy">
        <span>${escapeHtml(craftLabel)}Step ${step.order} of ${workflow.steps.length} / ${escapeHtml(goalWorkflowStepStatusLabel(stepState))}</span>
        <strong>${escapeHtml(step.label)}</strong>
        <small>Use: ${escapeHtml(inputLabels)} / Make: ${escapeHtml(outputLabels)}</small>
      </div>
      <div class="workflow-run-stage" data-workflow-run-stage>${meter}</div>
      ${stepState.runId ? canOpenRun
        ? `<button class="game-button workflow-run-link" type="button" data-command="view-run" data-id="${escapeHtml(stepState.runId)}">Open run ${escapeHtml(shortText(stepState.runId))}</button>`
        : `<div class="terminal-note">Run ${escapeHtml(shortText(stepState.runId))} belongs to ${escapeHtml(workflow.connection.name)}. Use View Activity to switch back safely.</div>`
        : ""}`;
  }

  function goalWorkflowControlsMarkup(workflow) {
    const stepState = goalWorkflowCurrentStepState(workflow);
    const controls = [];
    const control = (label, command, options = {}) => {
      const classes = [
        "game-button",
        options.primary ? "game-button-primary" : "",
        options.danger ? "game-button-danger" : "",
      ].filter(Boolean).join(" ");
      return `<button class="${classes}" type="button"${command ? ` data-command="${escapeHtml(command)}"` : ""}${options.primary ? " data-workflow-primary" : ""}${options.disabled ? " disabled" : ""}>${options.glyph ? `<span aria-hidden="true">${escapeHtml(options.glyph)}</span>` : ""}<span>${escapeHtml(label)}</span></button>`;
    };
    if (goalWorkflowOwnedByOtherTab(workflow)) {
      controls.push(control("Active in another tab", "", { disabled: true }));
      controls.push(control("Close monitor", "close-drawer"));
      return controls.join("");
    }
    if (workflow.status === "ready") {
      controls.push(control("Play", "workflow-resume", { primary: true, glyph: "\u25b6" }));
      controls.push(control("Exit flow", "workflow-exit", { danger: true, glyph: "\u25a0" }));
    } else if (workflow.status === "running") {
      controls.push(control("Pause after step", "workflow-pause", { primary: true, glyph: "\u2016" }));
      controls.push(control("Exit flow", "workflow-exit", { danger: true, glyph: "\u25a0" }));
    } else if (workflow.status === "pausing") {
      controls.push(control("Keep running", "workflow-resume", { primary: true, glyph: "\u25b6" }));
      controls.push(control("Exit flow", "workflow-exit", { danger: true, glyph: "\u25a0" }));
    } else if (workflow.status === "paused") {
      controls.push(control(workflow.exitRequested ? "Resume tracking to exit" : stepState?.runId ? "Resume tracking" : "Resume flow", "workflow-resume", { primary: true, glyph: "\u25b6" }));
      controls.push(control("Exit flow", "workflow-exit", { danger: true, glyph: "\u25a0" }));
    } else if (workflow.status === "error") {
      if (!stepState && workflow.currentStepIndex >= workflow.steps.length) {
        const label = workflow.executionMode === "repeat-unit" && workflow.completedQuantity < workflow.goal.quantity
          ? "Retry live replan"
          : "Retry goal check";
        controls.push(control(label, "workflow-retry", { primary: true, glyph: "\u21bb" }));
      }
      else if (stepState?.retryable) controls.push(control("Retry live check", "workflow-retry", { primary: true, glyph: "\u21bb" }));
      controls.push(control("View activity", "workflow-activity"));
      controls.push(control("Exit flow", "workflow-exit", { danger: true, glyph: "\u25a0" }));
    } else if (workflow.status === "needs-review") {
      controls.push(control("View activity", "workflow-activity", { primary: true }));
      if (!workflow.exitRequested) controls.push(control("Exit automation", "workflow-exit", { danger: true, glyph: "\u25a0" }));
      controls.push(control("Acknowledge & replan", "workflow-acknowledge", { danger: true }));
    } else if (workflow.status === "stopping") {
      controls.push(control("Current action must finish", "", { disabled: true }));
    } else if (new Set(["complete", "stopped"]).has(workflow.status)) {
      controls.push(control("Clear monitor", "workflow-dismiss", { primary: true }));
    }
    controls.push(control("Close monitor", "close-drawer"));
    return controls.join("");
  }

  function goalWorkflowDrawerFingerprint(workflow) {
    const stepState = goalWorkflowCurrentStepState(workflow);
    return JSON.stringify([
      workflow.id,
      workflow.status,
      workflow.currentStepIndex,
      goalWorkflowCompletedCount(workflow),
      workflow.completedQuantity || 0,
      goalWorkflowEstimatedActionCount(workflow),
      workflow.steps?.[0]?.actionId || "",
      stepState?.status || "",
      stepState?.runStatus || "",
      stepState?.error || "",
      Boolean(stepState?.retryable),
      Boolean(stepState?.outcomeUnknown),
      Boolean(workflow.pauseRequested),
      Boolean(workflow.exitRequested),
      workflow.error || "",
      workflow.estimatedTotalMilliseconds,
      goalWorkflowOwnedByOtherTab(workflow),
    ]);
  }

  function renderGoalWorkflowStartConfirmation(workflow) {
    const actionTotalLabel = goalWorkflowActionTotalLabel(workflow);
    const estimate = workflow.estimatedTotalMilliseconds == null
      ? "Unknown"
      : `${workflow.estimateComplete ? "~" : ">= "}${formatProofDuration(workflow.estimatedTotalMilliseconds)}`;
    const batchNote = workflow.executionMode === "repeat-unit"
      ? "The controller replans from live inventory between goal batches until the requested quantity is verified."
      : "The saved action set will run in its displayed order.";
    return `
      <div data-workflow-start-confirmation data-workflow-fingerprint="${escapeHtml(goalWorkflowDrawerFingerprint(workflow))}">
        <p id="workflow-dialog-description" class="sr-only">Confirm the state-changing Driver workflow for ${escapeHtml(goalWorkflowGoalLabel(workflow))}, or cancel to return to its workflow monitor.</p>
        <div class="drawer-header workflow-drawer-header">
          <div><p class="screen-kicker">Workflow launch</p><h2 class="drawer-title" id="drawer-title" data-workflow-focus tabindex="-1">Start this workflow?</h2><small>${escapeHtml(goalWorkflowGoalLabel(workflow))}</small></div>
          <button class="game-button" type="button" data-command="workflow-start-cancel">Back</button>
        </div>
        <div class="drawer-body workflow-confirm-body">
          <section class="game-panel workflow-start-confirm-card" aria-labelledby="workflow-start-goal">
            <div class="game-panel-header"><h3 id="workflow-start-goal">${escapeHtml(goalWorkflowGoalLabel(workflow))}</h3><span>Ready</span></div>
            <div class="game-panel-body">
              <div class="workflow-start-hero">
                <span class="workflow-start-glyph" aria-hidden="true">&#9654;</span>
                <div><strong>Authorize sequential actions</strong><p>Starting this flow allows the console to submit each planned action to the selected Driver after a fresh live preflight.</p></div>
              </div>
              <div class="summary-strip workflow-start-summary">
                <div class="summary-stat"><span>Driver</span><strong>${escapeHtml(workflow.connection.name)}</strong></div>
                <div class="summary-stat"><span>Actions</span><strong>${escapeHtml(actionTotalLabel)}</strong></div>
                <div class="summary-stat"><span>Estimate</span><strong>${escapeHtml(estimate)}</strong></div>
                <div class="summary-stat"><span>Cartridge</span><strong>${escapeHtml(workflow.cartridgeName)}</strong></div>
              </div>
              <p class="workflow-start-batch-note">${escapeHtml(batchNote)}</p>
              <div class="terminal-note warning workflow-start-warning"><strong>Committed steps cannot be undone.</strong><br />Inputs are consumed. Pause or Exit stops later submissions only; an action already accepted by the Driver always finishes.</div>
            </div>
          </section>
        </div>
        <div class="drawer-footer workflow-controls workflow-start-controls">
          <button class="game-button" type="button" data-command="workflow-start-cancel">Cancel</button>
          <button class="game-button game-button-primary" type="button" data-command="workflow-start-confirm" data-workflow-primary><span aria-hidden="true">&#9654;</span><span>Start workflow</span></button>
        </div>
      </div>`;
  }

  function renderGoalWorkflowDrawer(workflow) {
    const completed = goalWorkflowCompletedCount(workflow);
    const actionTotal = goalWorkflowEstimatedActionCount(workflow);
    const actionTotalLabel = goalWorkflowActionTotalLabel(workflow);
    const hasCurrentAction = workflow.currentStepIndex < workflow.steps.length;
    const currentNumber = Math.min(actionTotal, completed + (hasCurrentAction ? 1 : 0));
    const remaining = goalWorkflowRemainingMilliseconds(workflow);
    const estimate = workflow.estimatedTotalMilliseconds == null
      ? "Unknown"
      : `${workflow.estimateComplete ? "~" : ">= "}${formatProofDuration(workflow.estimatedTotalMilliseconds)}`;
    const errorMarkup = workflow.error
      ? `<div class="terminal-note ${workflow.status === "needs-review" ? "warning" : "error"}" role="alert" tabindex="-1"><strong>${workflow.status === "needs-review" ? "Safety lock" : "Flow stopped"}</strong><br />${escapeHtml(workflow.error)}</div>`
      : "";
    return `
      <div data-workflow-drawer data-workflow-fingerprint="${escapeHtml(goalWorkflowDrawerFingerprint(workflow))}">
        <p id="workflow-dialog-description" class="sr-only">Sequential Driver actions for ${escapeHtml(goalWorkflowGoalLabel(workflow))}. Completed steps cannot be undone, and Pause or Exit takes effect only before the next action.</p>
        <div class="drawer-header workflow-drawer-header">
          <div><p class="screen-kicker">Goal workflow</p><h2 class="drawer-title" id="drawer-title" data-workflow-focus tabindex="-1">${escapeHtml(goalWorkflowGoalLabel(workflow))}</h2><small>${escapeHtml(workflow.connection.name)} / ${escapeHtml(workflow.cartridgeName)}</small></div>
          <div class="drawer-header-actions"><span data-workflow-badge>${goalWorkflowBadgeMarkup(workflow)}</span><button class="game-button" type="button" data-command="close-drawer">Close</button></div>
        </div>
        <div class="drawer-body workflow-drawer-body" aria-describedby="workflow-safety-note">
          <div class="summary-strip workflow-summary">
            <div class="summary-stat"><span>Status</span><strong data-workflow-status>${escapeHtml(goalWorkflowStatusLabel(workflow))}</strong></div>
            <div class="summary-stat"><span>Action</span><strong data-workflow-step>${currentNumber} / ${actionTotalLabel}</strong></div>
            <div class="summary-stat"><span>Elapsed</span><strong data-workflow-elapsed>${escapeHtml(formatProofDuration(goalWorkflowElapsedMilliseconds(workflow)))}</strong></div>
            <div class="summary-stat"><span>Plan estimate</span><strong>${escapeHtml(estimate)}</strong></div>
          </div>
          <section class="workflow-overall" aria-labelledby="workflow-overall-title">
            <div><span id="workflow-overall-title">Verified action progress</span><strong data-workflow-count>${completed} of ${actionTotalLabel}</strong></div>
            <progress data-workflow-progress aria-labelledby="workflow-overall-title" max="${actionTotal}" value="${completed}">${completed} of ${actionTotal}</progress>
            <small><span data-workflow-remaining>${remaining == null ? "Remaining time unknown" : `~${formatProofDuration(remaining)} planned work remaining`}</span> / action count is authoritative; time is an estimate.</small>
          </section>
          <p class="workflow-message" data-workflow-message aria-live="polite" aria-atomic="true">${escapeHtml(workflow.message || "")}</p>
          ${errorMarkup}
          <div class="workflow-layout">
            <section class="game-panel workflow-current-panel" aria-labelledby="workflow-current-title" aria-busy="${new Set(["running", "pausing", "stopping"]).has(workflow.status)}">
              <div class="game-panel-header"><h3 id="workflow-current-title">Current action</h3><span>${escapeHtml(workflow.status === "ready" ? "Preflight" : "Driver lifecycle")}</span></div>
              <div class="game-panel-body" data-workflow-current>${goalWorkflowCurrentActionMarkup(workflow)}</div>
            </section>
            <section class="game-panel workflow-queue-panel" aria-labelledby="workflow-queue-title">
              <div class="game-panel-header"><h3 id="workflow-queue-title">Action queue</h3><span>Sequential</span></div>
              <div class="game-panel-body flush" data-workflow-queue>${goalWorkflowQueueMarkup(workflow)}</div>
            </section>
          </div>
          <div id="workflow-safety-note" class="terminal-note warning workflow-safety-note">
            This flow is non-atomic: each verified step is already committed and consumes its selected inputs. Pause and Exit stop future submissions only; an accepted Driver action cannot be paused or cancelled. The planner models exact class-token flow, but predicate fields such as tool durability are not simulated, so the Driver may stop a structurally valid plan. Keep this tab open. Reload recovery never submits automatically.
          </div>
        </div>
        <div class="drawer-footer workflow-controls" data-workflow-controls>${goalWorkflowControlsMarkup(workflow)}</div>
      </div>`;
  }

  function patchGoalWorkflowDrawer() {
    if (state.drawer?.type !== "workflow" || !state.goalWorkflow) return;
    const workflow = state.goalWorkflow;
    if (state.drawer.workflowStartConfirmation) {
      const confirmation = drawerContent.querySelector("[data-workflow-start-confirmation]");
      if (workflow.status !== "ready") {
        state.drawer.workflowStartConfirmation = false;
        renderDrawer(false);
      } else if (!confirmation || confirmation.dataset.workflowFingerprint !== goalWorkflowDrawerFingerprint(workflow)) {
        renderDrawer(false);
      }
      return;
    }
    const root = drawerContent.querySelector("[data-workflow-drawer]");
    if (!root || root.dataset.workflowFingerprint !== goalWorkflowDrawerFingerprint(workflow)) {
      renderDrawer(false);
      return;
    }
    const setText = (selector, value) => {
      const element = root.querySelector(selector);
      if (element && element.textContent !== String(value ?? "")) element.textContent = String(value ?? "");
    };
    const completed = goalWorkflowCompletedCount(workflow);
    const actionTotal = goalWorkflowEstimatedActionCount(workflow);
    const actionTotalLabel = goalWorkflowActionTotalLabel(workflow);
    const hasCurrentAction = workflow.currentStepIndex < workflow.steps.length;
    const currentNumber = Math.min(actionTotal, completed + (hasCurrentAction ? 1 : 0));
    const remaining = goalWorkflowRemainingMilliseconds(workflow);
    setText("[data-workflow-status]", goalWorkflowStatusLabel(workflow));
    setText("[data-workflow-step]", `${currentNumber} / ${actionTotalLabel}`);
    setText("[data-workflow-elapsed]", formatProofDuration(goalWorkflowElapsedMilliseconds(workflow)));
    setText("[data-workflow-count]", `${completed} of ${actionTotalLabel}`);
    setText("[data-workflow-remaining]", remaining == null ? "Remaining time unknown" : `~${formatProofDuration(remaining)} planned work remaining`);
    setText("[data-workflow-message]", workflow.message || "");
    const progress = root.querySelector("[data-workflow-progress]");
    if (progress) {
      progress.max = actionTotal;
      progress.value = completed;
    }
    const run = goalWorkflowCurrentRun(workflow);
    if (run && root.querySelector("[data-run-meter-shell]")) {
      patchRunMeter(run);
      const log = root.querySelector("[data-workflow-run-progress]");
      if (log) log.innerHTML = runProgressMarkup(run);
    }
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
        <div class="game-panel hardware-index-panel">
          <div class="game-panel-header"><h2>Client work index</h2><span>Selected Driver proof baseline</span></div>
          <div class="game-panel-body">
            <p class="screen-copy hardware-index-intro">Run one real zero-input <code>craft-rocket::MineIron</code> action and measure one exact Driver event window: <code>generateProof/running</code> with message <code>Generating proof</code> through <code>generateProof/done</code> with message <code>Proof generation complete</code>. The timer freezes at the stop event, and proof baselines/hr reports relative machine throughput: higher is faster when the Driver version and MineIron action hash match. Transaction submission, chain commit, confirmation, and live-output verification continue as settlement but are excluded from CWI. Action and planner estimates scale that hardware result with readable PoW, VDF, and I/O workload, then add ${escapeHtml(formatProofDuration(ACTION_COMMIT_ALLOWANCE_MS))} for commit and ${Math.round(ACTION_OPERATIONAL_CONTINGENCY * 100)}% for operational variance per action. The submitted action may create one retained Iron and cannot be cancelled by closing this page. Allow several minutes on slower hardware. The run id is saved immediately, and completed proof measurements are stored locally per Driver URL, Driver version, and MineIron action hash for 30 days.</p>
            <div class="hardware-index" id="config-cwi-panel" tabindex="-1" data-hardware-index data-hardware-index-view="full">
              <span class="sr-only" data-hardware-index-announcement aria-live="polite" aria-atomic="true">${escapeHtml(hardwareIndexAnnouncement())}</span>
              <div data-hardware-index-content>${hardwareIndexContentMarkup()}</div>
            </div>
          </div>
        </div>
        <div class="game-panel">
          <div class="game-panel-header"><h2>Current configuration</h2><span>version ${CONFIG_VERSION}</span></div>
          <div class="game-panel-body"><pre class="code-block" data-current-config>${safeJson(state.config)}</pre></div>
        </div>
        <div class="terminal-note warning">
          Browser sandbox rule: HTML cannot write arbitrary files silently. Choose a destination in the Save dialog once; Chromium-based browsers can then keep that selected config file updated while permission remains granted. Other browsers download the JSON and retain an automatic localStorage copy when storage is available. The client work index stays in this browser's local config when possible and is not copied into portable config files.
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
    delete drawer.dataset.drawerType;
    drawer.removeAttribute("aria-describedby");
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
    const previousScrollTop = drawerContent.scrollTop;
    let html = "";
    if (state.drawer.type === "action") {
      const action = actionByKey(state.drawer.key);
      html = action ? renderActionDrawer(action, state.drawer) : '<div class="drawer-body"><div class="game-error"><h2 id="drawer-title">Action unavailable</h2></div></div>';
    } else if (state.drawer.type === "object") {
      html = renderObjectDrawer(state.drawer);
    } else if (state.drawer.type === "run") {
      html = renderRunDrawer(state.drawer);
    } else if (state.drawer.type === "workflow") {
      html = state.goalWorkflow
        ? state.drawer.workflowStartConfirmation
          ? renderGoalWorkflowStartConfirmation(state.goalWorkflow)
          : renderGoalWorkflowDrawer(state.goalWorkflow)
        : '<div class="drawer-body"><div class="game-error"><h2 id="drawer-title">Workflow unavailable</h2></div></div>';
    }
    drawer.dataset.drawerType = state.drawer.type;
    drawerContent.innerHTML = html;
    if (state.drawer.type === "workflow") drawer.setAttribute("aria-describedby", "workflow-dialog-description");
    else drawer.removeAttribute("aria-describedby");
    if (!focusFirst) drawerContent.scrollTop = previousScrollTop;
    requestAnimationFrame(() => {
      const captured = !focusFirst ? findCapturedFocus(drawerContent, focusToken) : null;
      const workflowTarget = state.drawer?.type === "workflow"
        ? drawerContent.querySelector("[data-workflow-primary]") || drawerContent.querySelector("[data-workflow-focus]")
        : null;
      const target = captured || workflowTarget || drawerContent.querySelector("button, select, input");
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
    } else if (!focusable.includes(current)) {
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
    state.cartridgeNavOpen = false;
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
      actions: "cartridges",
      planner: "actions",
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
      case "toggle-cartridge-nav": {
        state.cartridgeNavOpen = !state.cartridgeNavOpen;
        const nav = element.closest(".cartridge-nav");
        nav?.classList.toggle("is-open", state.cartridgeNavOpen);
        element.setAttribute("aria-expanded", String(state.cartridgeNavOpen));
        const symbol = element.querySelector("[data-cartridge-nav-symbol]");
        if (symbol) symbol.textContent = state.cartridgeNavOpen ? "−" : "+";
        break;
      }
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
        if (changed && goalWorkflowAutomationActive() && !goalWorkflowOwnedByOtherTab()) {
          state.goalWorkflow.pauseRequested = true;
          state.goalWorkflow.exitRequested = false;
          state.goalWorkflow.status = "pausing";
          state.goalWorkflow.message = "Cartridge selection changed. The current accepted action will be reconciled, then automation will pause.";
          persistGoalWorkflow();
        }
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
          clearTimeout(state.planner.quantityTimer);
          state.planner.goalClassId = "";
          state.planner.goalQuantity = 1;
          state.planner.quantityTimer = null;
          state.planner.result = null;
          state.planner.viewBox = null;
          state.planner.viewKey = "";
          state.planner.layout = null;
          state.planner.drag = null;
          state.planner.viewMode = "fit";
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
        state.techTree.objectFileName = "";
        state.techTree.selectedNodeId = "";
        navigate("tree");
        break;
      case "planner":
        navigate("planner");
        break;
      case "plan-goal":
        clearTimeout(state.planner.quantityTimer);
        state.planner.goalClassId = id || "";
        state.planner.goalQuantity = 1;
        state.planner.quantityTimer = null;
        state.planner.result = null;
        state.planner.viewBox = null;
        state.planner.viewKey = "";
        state.planner.layout = null;
        state.planner.drag = null;
        state.planner.viewMode = "fit";
        navigate("planner");
        break;
      case "prepare-goal-workflow":
        await prepareGoalWorkflow();
        break;
      case "manage-goal-workflow":
        openGoalWorkflowManager();
        break;
      case "tree-mode":
        state.techTree.mode = element.dataset.value === "object" ? "object" : "all";
        if (state.techTree.mode === "all") state.techTree.objectFileName = "";
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
      case "tree-fullscreen":
        await toggleTechTreeFullscreen();
        break;
      case "planner-tree-fit":
        fitPlannerTree();
        break;
      case "planner-tree-zoom-in":
        zoomPlannerTree(0.78);
        break;
      case "planner-tree-zoom-out":
        zoomPlannerTree(1.28);
        break;
      case "planner-tree-fullscreen":
        await togglePlannerTreeFullscreen();
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
      case "workflow-resume":
        resumeGoalWorkflow();
        break;
      case "workflow-start-confirm":
        confirmGoalWorkflowStart();
        break;
      case "workflow-start-cancel":
        cancelGoalWorkflowStartConfirmation();
        break;
      case "workflow-pause":
        pauseGoalWorkflow();
        break;
      case "workflow-retry":
        retryGoalWorkflowStep();
        break;
      case "workflow-exit":
        exitGoalWorkflow();
        break;
      case "workflow-dismiss":
        dismissGoalWorkflow();
        break;
      case "workflow-acknowledge":
        await acknowledgeGoalWorkflowReview();
        break;
      case "workflow-activity":
        {
          const workflowConnectionId = state.goalWorkflow?.connection?.id;
          closeDrawer();
          if (workflowConnectionId && state.config.connections.some((connection) => connection.id === workflowConnectionId)) {
            await selectConnection(workflowConnectionId, "activity");
          } else {
            navigate("activity");
            toast("Workflow Driver profile is missing", "Activity can only be opened for a connection still saved in this console.", "warning", 7500);
          }
        }
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
      case "run-hardware-index":
        await runHardwareIndex();
        break;
      case "open-config":
        await openConfigFile();
        break;
      case "save-config":
        await saveConfigFile();
        break;
      case "reset-config":
        if (globalThis.confirm("Reset all connection profiles and menu selections to the local defaults?")) {
          const localClientWorkIndexes = state.config.clientWorkIndexes;
          const localClientWorkIndexRuns = state.config.clientWorkIndexRuns;
          state.config = defaultConfig();
          state.config.clientWorkIndexes = localClientWorkIndexes;
          state.config.clientWorkIndexRuns = localClientWorkIndexRuns;
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
    if (event.target.id === "planner-goal-quantity") {
      const rawQuantity = Number(event.target.value);
      if (Number.isInteger(rawQuantity) && rawQuantity >= 1 && rawQuantity <= PLANNER_MAX_QUANTITY) {
        state.planner.goalQuantity = rawQuantity;
        state.planner.result = null;
        clearTimeout(state.planner.quantityTimer);
        state.planner.quantityTimer = setTimeout(() => {
          state.planner.quantityTimer = null;
          if (state.screen === "planner") patchPlanner();
        }, 250);
      }
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
    if (event.target.id === "planner-goal-select") {
      clearTimeout(state.planner.quantityTimer);
      state.planner.quantityTimer = null;
      state.planner.goalClassId = event.target.value || "";
      state.planner.result = null;
      patchPlanner();
    }
    if (event.target.id === "planner-goal-quantity") {
      const quantity = normalizePlannerQuantity(event.target.value);
      clearTimeout(state.planner.quantityTimer);
      state.planner.quantityTimer = null;
      event.target.value = String(quantity);
      state.planner.goalQuantity = quantity;
      state.planner.result = null;
      patchPlanner();
    }
  });

  main.addEventListener("keydown", (event) => {
    const nativeFullscreenId = techTreeFullscreenElement()?.id;
    if (event.key === "Escape" && (nativeFullscreenId === "tech-tree-canvas" || nativeFullscreenId === "planner-tree-canvas")) {
      return;
    }
    if (event.key === "Escape" && state.techTree.fullscreenFallback) {
      event.preventDefault();
      event.stopPropagation();
      state.techTree.fullscreenFallback = false;
      state.techTree.fullscreenRequestPending = false;
      syncTechTreeFullscreenUi();
      return;
    }
    if (event.key === "Escape" && state.planner.fullscreenFallback) {
      event.preventDefault();
      event.stopPropagation();
      state.planner.fullscreenFallback = false;
      state.planner.fullscreenRequestPending = false;
      syncPlannerTreeFullscreenUi();
      return;
    }
    if (handlePlannerTreeKeydown(event)) return;
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
      clearTechTreeRelationshipFocus();
    }
  });

  main.addEventListener("pointerdown", beginTechTreePan);
  main.addEventListener("pointerdown", beginPlannerTreePan);
  main.addEventListener("pointermove", moveTechTreePan);
  main.addEventListener("pointermove", movePlannerTreePan);
  main.addEventListener("pointerup", endTechTreePan);
  main.addEventListener("pointerup", endPlannerTreePan);
  main.addEventListener("pointercancel", endTechTreePan);
  main.addEventListener("pointercancel", endPlannerTreePan);
  main.addEventListener("lostpointercapture", endPlannerTreePan);
  main.addEventListener("wheel", wheelTechTree, { passive: false });
  main.addEventListener("wheel", wheelPlannerTree, { passive: false });

  drawerContent.addEventListener("click", (event) => {
    const target = event.target.closest("[data-command]");
    if (target) void handleCommand(target);
  });

  drawerContent.addEventListener("change", (event) => {
    if (event.target.matches("[data-action-input]") && state.drawer?.type === "action") {
      const index = Number(event.target.dataset.actionInput);
      state.drawer.selections[index] = event.target.value;
      state.drawer.outcomeUnknown = false;
      state.drawer.submitError = null;
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

  drawerBackdrop.addEventListener("click", () => {
    if (!cancelGoalWorkflowStartConfirmation()) closeDrawer();
  });
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
  byId("workflow-monitor").addEventListener("click", openGoalWorkflowManager);
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
    state.cartridgeNavOpen = false;
    state.screen = screenFromHash();
    state.config.ui.lastScreen = state.screen;
    persistConfig();
    render();
  });

  window.addEventListener("storage", (event) => {
    if (event.key === LEGACY_HARDWARE_INDEX_STORAGE_KEY) return;
    if (event.key === GOAL_WORKFLOW_STORAGE_KEY) {
      if (state.goalWorkflowLoopPromise) return;
      const workflowDrawerWasOpen = state.drawer?.type === "workflow";
      state.goalWorkflow = event.newValue ? loadGoalWorkflowSnapshot({ recoverInterrupted: false }) : null;
      notifyGoalWorkflowChange();
      if (!state.goalWorkflow && workflowDrawerWasOpen) {
        closeDrawer();
        toast("Workflow cleared", "The saved workflow was cleared in another tab.", "warning", 6500);
      }
      return;
    }
    if (event.key !== STORAGE_KEY || !event.newValue) return;
    try {
      const incomingConfig = JSON.parse(event.newValue);
      synchronizeHardwareIndexFromStorage(incomingConfig, incomingConfig);
    } catch {
      // Ignore malformed or unrelated local config updates from another tab.
    }
  });

  window.addEventListener("keydown", (event) => {
    if (trapTechTreeFullscreenFocus(event) || trapPlannerTreeFullscreenFocus(event)) return;
    const editing = event.target.matches("input, textarea, select, [contenteditable='true']");
    if (event.key === "Escape") {
      const fullscreenId = techTreeFullscreenElement()?.id;
      if (fullscreenId === "tech-tree-canvas" || fullscreenId === "planner-tree-canvas") return;
      event.preventDefault();
      if (state.techTree.fullscreenFallback) {
        state.techTree.fullscreenFallback = false;
        state.techTree.fullscreenRequestPending = false;
        syncTechTreeFullscreenUi();
        return;
      }
      if (state.planner.fullscreenFallback) {
        state.planner.fullscreenFallback = false;
        state.planner.fullscreenRequestPending = false;
        syncPlannerTreeFullscreenUi();
        return;
      }
      if (cancelGoalWorkflowStartConfirmation()) return;
      if (!state.drawer && state.cartridgeNavOpen) {
        state.cartridgeNavOpen = false;
        const nav = main.querySelector(".cartridge-nav");
        const toggle = nav?.querySelector(".cartridge-nav-toggle");
        nav?.classList.remove("is-open");
        toggle?.setAttribute("aria-expanded", "false");
        const symbol = toggle?.querySelector("[data-cartridge-nav-symbol]");
        if (symbol) symbol.textContent = "+";
        toggle?.focus({ preventScroll: true });
        return;
      }
      if (!state.drawer && state.screen === "tree" && clearTechTreeRelationshipFocus()) return;
      navigateBack();
      return;
    }
    if (state.drawer && event.key === "Tab") {
      trapDrawerFocus(event);
      return;
    }
    if (editing || state.drawer || event.target.closest?.(".planner-tree-canvas")) return;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      moveMenuFocus(1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      moveMenuFocus(-1);
    }
  });

  document.addEventListener("fullscreenchange", handleTechTreeFullscreenChange);
  document.addEventListener("webkitfullscreenchange", handleTechTreeFullscreenChange);
  document.addEventListener("fullscreenerror", handleTechTreeFullscreenError);
  document.addEventListener("webkitfullscreenerror", handleTechTreeFullscreenError);
  document.addEventListener("fullscreenchange", handlePlannerTreeFullscreenChange);
  document.addEventListener("webkitfullscreenchange", handlePlannerTreeFullscreenChange);
  document.addEventListener("fullscreenerror", handlePlannerTreeFullscreenError);
  document.addEventListener("webkitfullscreenerror", handlePlannerTreeFullscreenError);

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
    await recoverInterruptedGoalWorkflowAtStartup();
    await probeAllConnections();
    await loadWorkspace();
    setInterval(() => void probeAllConnections(), 15000);
  }

  void start();
})();
