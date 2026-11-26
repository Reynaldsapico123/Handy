window.handyToolInitialization = new Map();

const themeToggle = document.querySelector("#themeToggle");
const searchForm = document.querySelector("#searchForm");
const searchInput = document.querySelector("#searchInput");
const toolCards = [...document.querySelectorAll(".tool-card")];
const toast = document.querySelector("#toast");
const searchSuggestions = document.querySelector("#searchSuggestions");
const searchSuggestionList = document.querySelector("#searchSuggestionList");
const searchNoResults = document.querySelector("#searchNoResults");
const searchSuggestionStatus = document.querySelector("#searchSuggestionStatus");
const connectionStatus = document.querySelector("#connectionStatus");
const connectionStatusText = document.querySelector("#connectionStatusText");
const offlineNotice = document.querySelector("#offlineNotice");
const offlineNoticeText = document.querySelector("#offlineNoticeText");
const dismissOfflineNotice = document.querySelector("#dismissOfflineNotice");
const installAppContainer = document.querySelector("#installAppContainer");
const installAppButton = document.querySelector("#installApp");
const installAppInstructions = document.querySelector("#installAppInstructions");
const updateNotice = document.querySelector("#updateNotice");
const updateNowButton = document.querySelector("#updateNow");
const updateLaterButton = document.querySelector("#updateLater");
const exportSettingsBackupButton = document.querySelector("#exportSettingsBackup");
const importSettingsBackupButton = document.querySelector("#importSettingsBackup");
const settingsBackupFile = document.querySelector("#settingsBackupFile");
const backupStatus = document.querySelector("#backupStatus");
let selectedSuggestionIndex = -1;
const favoritesKey = "handy-favorite-tools";
const recentKey = "handy-recent-tools";
const toolLayoutKey = "handy-tool-layout";
const toolUsageKey = "handy-tool-usage";
const recentSearchesKey = "handy-recent-searches";
const personalizationPresetKey = "handy-personalization-preset";
const feedbackDraftKey = "handy-feedback-draft";
const backupFormat = "handy-settings-backup";
const travelKitStorageKey = "handy-travel-kit";
const backupKeys = [
  favoritesKey,
  recentKey,
  toolLayoutKey,
  toolUsageKey,
  personalizationPresetKey,
  travelKitStorageKey,
  "handy-theme",
  "handy-currency-pair",
  "handy-currency-live-rates",
  "handy-world-clock",
  "handy-unit-converter",
  "handy-timer-duration"
];
let installPrompt = null;
let updateRegistration = null;
let reloadAfterUpdate = false;
const updateHistoryKey = "handy-update-history";
const welcomeDismissedKey = "handy-welcome-dismissed";
const toolModalObservers = new WeakSet();
const toolLinks = {
  calculator: { opener: "openCalculator", script: "calculator.js", modal: "#calculatorModal", name: "Calculator" },
  "unit-converter": { opener: "openUnitConverter", script: "unit-converter.js", modal: "#unitConverterModal", name: "Unit Converter" },
  timer: { opener: "openTimer", script: "timer.js", modal: "#timerModal", name: "Timer & Stopwatch" },
  "world-clock": { opener: "openWorldClock", script: "world-clock.js", modal: "#worldClockModal", name: "World Clock" },
  currency: { opener: "openCurrency", script: "currency.js", modal: "#currencyModal", name: "Currency Exchange" },
  qr: { opener: "openQrCode", script: "qr-code.js", modal: "#qrModal", name: "QR Code Maker" },
  guides: { opener: "openGuides", script: "guides.js", modal: "#guidesModal", name: "Helpful guides" }
};
const toolIdsByName = Object.fromEntries(
  Object.entries(toolLinks).map(([id, tool]) => [tool.name, id])
);
const toolScriptLoads = new Map();
const scriptLoads = new Map();

window.handyFetchToolFragment = async function (name) {
  const response = await fetch(name);
  return response.status === 404 ? fetch(`${name}.html`) : response;
};

function loadScript(source) {
  const buildId = document.querySelector('meta[name="handy-build"]')?.content || "development";
  const url = new URL(source, window.location.href);
  url.searchParams.set("v", buildId);
  const src = url.toString();
  if (scriptLoads.has(src)) return scriptLoads.get(src);

  const loading = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = resolve;
    script.onerror = () => {
      scriptLoads.delete(src);
      script.remove();
      reject(new Error(`Could not load ${source}`));
    };
    document.head.append(script);
  });
  scriptLoads.set(src, loading);
  return loading;
}

function loadToolModule(toolId) {
  if (toolScriptLoads.has(toolId)) return toolScriptLoads.get(toolId);
  const tool = toolLinks[toolId];
  const loading = (async () => {
    if (toolId === "qr") {
      await Promise.all([
        loadScript("node_modules/qrcode-generator/dist/qrcode.js"),
        loadScript("node_modules/jsqr/dist/jsQR.js")
      ]);
    }
    await loadScript(tool.script);
    const initialization = window.handyToolInitialization.get(toolId);
    if (!initialization) throw new Error(`${tool.name} did not register its initialization.`);
    await initialization;
  })();
  toolScriptLoads.set(toolId, loading);
  return loading;
}

function updateConnectionStatus() {
  const isOnline = navigator.onLine;
  connectionStatus.dataset.state = isOnline ? "online" : "offline";
  connectionStatusText.textContent = isOnline ? "Online" : "Offline";
  connectionStatus.title = isOnline
    ? "Online. Live features can connect to their services."
    : "Offline. Saved tools work; currency exchange uses reference rates.";
  if (isOnline) {
    offlineNotice.hidden = true;
  } else {
    offlineNotice.hidden = false;
    offlineNoticeText.textContent = "You're offline. Calculator, QR, guides, and saved tools remain available.";
  }
}

window.addEventListener("online", updateConnectionStatus);
window.addEventListener("offline", updateConnectionStatus);
dismissOfflineNotice.addEventListener("click", () => {
  offlineNotice.hidden = true;
});
updateConnectionStatus();

function updateToolUrl(toolId, mode) {
  const url = new URL(window.location.href);
  const previous = `${url.searchParams.get("tool") || ""}:${url.searchParams.get("mode") || ""}`;
  url.searchParams.set("tool", toolId);
  if (toolId === "qr" && mode === "scan") url.searchParams.set("mode", "scan");
  else url.searchParams.delete("mode");
  const next = `${toolId}:${mode === "scan" ? "scan" : ""}`;
  if (previous !== next) window.history.pushState({ handyTool: toolId }, "", url);
}

function canonicalToolUrl(toolId, mode) {
  const url = new URL(window.location.origin);
  url.pathname = "/";
  url.searchParams.set("tool", toolId);
  if (toolId === "qr" && mode === "scan") {
    url.searchParams.set("mode", "scan");
  }
  return url.toString();
}

async function shareToolLink(toolId, modal) {
  const tool = toolLinks[toolId];
  const mode = toolId === "qr" && modal.querySelector("#qrScanTab").getAttribute("aria-selected") === "true"
    ? "scan"
    : undefined;
  updateToolUrl(toolId, mode);
  const url = canonicalToolUrl(toolId, mode);
  const shareData = { title: `Handy · ${tool.name}`, text: `Open ${tool.name} in Handy`, url };

  if (typeof navigator.share === "function") {
    try {
      await navigator.share(shareData);
      return;
    } catch (error) {
      if (error.name === "AbortError") return;
      console.error("Could not share the Handy tool link.", error);
    }
  }

  try {
    if (!navigator.clipboard?.writeText) throw new Error("Clipboard access is unavailable.");
    await navigator.clipboard.writeText(url);
    showToast("Tool link copied.");
  } catch (error) {
    console.error("Could not copy the Handy tool link.", error);
    showToast("Could not copy the link. Copy it from the address bar.");
  }
}

function addToolShareButton(toolId) {
  const modal = document.querySelector(toolLinks[toolId].modal);
  const closeButton = modal?.querySelector(".modal-close");
  if (!modal || !closeButton || modal.querySelector(".tool-share")) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "tool-share";
  button.textContent = "Share";
  button.setAttribute("aria-label", `Share link to ${toolLinks[toolId].name}`);
  button.addEventListener("click", () => shareToolLink(toolId, modal));
  closeButton.before(button);

  if (toolId === "qr") {
    modal.querySelector("#qrScanTab").addEventListener("click", () => updateToolUrl("qr", "scan"));
    modal.querySelector("#qrGenerateTab").addEventListener("click", () => updateToolUrl("qr"));
  }
}

function clearToolUrl(toolId) {
  const url = new URL(window.location.href);
  if (url.searchParams.get("tool") !== toolId) return;
  url.searchParams.delete("tool");
  url.searchParams.delete("mode");
  window.history.replaceState(window.history.state, "", url);
}

window.addEventListener("popstate", () => {
  const url = new URL(window.location.href);
  const toolId = url.searchParams.get("tool");
  const mode = toolId === "qr" && url.searchParams.get("mode") === "scan" ? "scan" : undefined;
  if (toolId && toolLinks[toolId]) {
    openLinkedTool(toolId, mode);
    return;
  }
  Object.values(toolLinks).forEach((tool) => {
    const modal = document.querySelector(tool.modal);
    if (modal) modal.hidden = true;
  });
});

function observeToolModal(toolId) {
  const modal = document.querySelector(toolLinks[toolId].modal);
  if (!modal || toolModalObservers.has(modal)) return;
  toolModalObservers.add(modal);
  new MutationObserver(() => {
    if (modal.hidden) clearToolUrl(toolId);
  }).observe(modal, { attributes: true, attributeFilter: ["hidden"] });
}

function showRecoveryReload(recoveryKey, message) {
  showToast(message, {
    label: "Reload",
    onClick: () => {
      try {
        sessionStorage.removeItem(recoveryKey);
      } catch (error) {
        console.error("Could not reset the Handy recovery state.", error);
      }
      window.location.reload();
    }
  });
}

async function openLinkedTool(toolId, mode, settings) {
  const tool = toolLinks[toolId];
  if (!tool) return false;
  try {
    await loadToolModule(toolId);
  } catch (error) {
    console.error(`Could not load ${tool.name}.`, error);
    showToast(`${tool.name} could not be loaded.`);
    return false;
  }
  const open = tool && window[tool.opener];
  if (typeof open !== "function") {
    console.error(`${tool.name} did not provide its open function.`);
    const recoveryKey = "handy-open-recovery";
    updateToolUrl(toolId, mode);
    let recoveredForBuild = null;
    try {
      recoveredForBuild = sessionStorage.getItem(recoveryKey);
    } catch {}
    const buildId = document.querySelector('meta[name="handy-build"]')?.content || "unknown";
    if (recoveredForBuild !== buildId) {
      try {
        sessionStorage.setItem(recoveryKey, buildId);
        if ("serviceWorker" in navigator) {
          const registrations = await navigator.serviceWorker.getRegistrations();
          await Promise.all(registrations
            .filter((registration) => new URL(registration.scope).origin === location.origin)
            .map((registration) => registration.unregister()));
        }
        if ("caches" in window) {
          const cacheNames = await caches.keys();
          await Promise.all(cacheNames
            .filter((name) => name.startsWith("handy-"))
            .map((name) => caches.delete(name)));
        }
        showToast("Refreshing Handy to restore tools…");
        const url = new URL(location.href);
        url.searchParams.set("recovered", buildId);
        location.replace(url);
      } catch (error) {
        console.error("Could not recover the stale Handy app.", error);
        showRecoveryReload(recoveryKey, "Handy could not restore this tool. Try reloading.");
      }
    } else {
      showRecoveryReload(recoveryKey, "This tool still could not start. Try reloading Handy.");
    }
    return false;
  }
  observeToolModal(toolId);
  addToolShareButton(toolId);
  updateToolUrl(toolId, mode);
  if (toolId === "qr") open(mode, settings);
  else open(settings);
  return true;
}

window.addEventListener("load", async () => {
  const url = new URL(window.location.href);
  const rawToolId = url.searchParams.get("tool");
  const toolId = rawToolId?.trim().toLowerCase() || null;
  if (!toolId) {
    if (url.searchParams.has("mode")) {
      url.searchParams.delete("mode");
      window.history.replaceState(window.history.state, "", url);
    }
    return;
  }
  if (!toolLinks[toolId]) {
    url.searchParams.delete("tool");
    url.searchParams.delete("mode");
    window.history.replaceState(window.history.state, "", url);
    showToast("This Handy tool link is not recognized.");
    return;
  }

  const mode = toolId === "qr" && url.searchParams.get("mode") === "scan" ? "scan" : undefined;
  const normalizedMode = mode === "scan" ? "scan" : null;
  if (
    url.searchParams.getAll("tool").length !== 1
    || rawToolId !== toolId
    || url.searchParams.get("mode") !== normalizedMode
    || url.searchParams.getAll("mode").length > (normalizedMode ? 1 : 0)
  ) {
    url.searchParams.set("tool", toolId);
    if (normalizedMode) url.searchParams.set("mode", normalizedMode);
    else url.searchParams.delete("mode");
    window.history.replaceState(window.history.state, "", url);
  }

  await openLinkedTool(toolId, mode);
});

function isInstalledApp() {
  return window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
}

function showManualInstallInstructions() {
  const isAppleMobile = /iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  installAppInstructions.textContent = isAppleMobile
    ? "In Safari, tap Share, then choose Add to Home Screen."
    : "Open your browser menu and choose Install app or Add to Home screen.";
  installAppInstructions.hidden = false;
}

if (isInstalledApp()) installAppContainer.hidden = true;

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPrompt = event;
  installAppInstructions.hidden = true;
});

installAppButton.addEventListener("click", async () => {
  if (!installPrompt) {
    showManualInstallInstructions();
    return;
  }

  const prompt = installPrompt;
  installPrompt = null;
  try {
    await prompt.prompt();
    const choice = await prompt.userChoice;
    if (choice.outcome === "accepted") showToast("Handy is being installed.");
    else showManualInstallInstructions();
  } catch (error) {
    console.error("Could not open the app install prompt.", error);
    showManualInstallInstructions();
  }
});

window.addEventListener("appinstalled", () => {
  installPrompt = null;
  installAppContainer.hidden = true;
  showToast("Handy was installed.");
});

function showUpdateNotice(registration) {
  if (!registration.waiting || !navigator.serviceWorker.controller) return;
  if (sessionStorage.getItem("handy-update-dismissed") === "true") return;
  updateRegistration = registration;
  updateNotice.hidden = false;
}

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register("/sw.js");
      window.dispatchEvent(new CustomEvent("handy-cache-recovery", {
        detail: { state: "ready", message: "Offline recovery ready." }
      }));
      if (registration.waiting) showUpdateNotice(registration);
      registration.addEventListener("updatefound", () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener("statechange", () => {
          if (installing.state === "installed") showUpdateNotice(registration);
        });
      });
    } catch (error) {
      console.error("Could not register the Handy service worker.", error);
      window.dispatchEvent(new CustomEvent("handy-cache-recovery", {
        detail: { state: "blocked", message: "Offline recovery unavailable. Online tools may still work." }
      }));
    }
  });

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!reloadAfterUpdate) return;
    reloadAfterUpdate = false;
    window.location.reload();
  });
}

updateLaterButton.addEventListener("click", () => {
  updateNotice.hidden = true;
  sessionStorage.setItem("handy-update-dismissed", "true");
});

updateNowButton.addEventListener("click", () => {
  const waitingWorker = updateRegistration?.waiting;
  if (!waitingWorker) {
    updateNotice.hidden = true;
    return;
  }

  reloadAfterUpdate = true;
  updateNowButton.disabled = true;
  updateLaterButton.disabled = true;
  updateNowButton.textContent = "Updating…";
  try {
    const incomingBuild =
      document.querySelector('meta[name="handy-build"]')?.content || "unknown";
    let history = [];
    try {
      const saved = JSON.parse(localStorage.getItem(updateHistoryKey) || "[]");
      history = Array.isArray(saved) ? saved : [];
    } catch {
      history = [];
    }
    history.unshift({
      build: incomingBuild,
      at: new Date().toISOString()
    });
    localStorage.setItem(updateHistoryKey, JSON.stringify(history.slice(0, 5)));
    sessionStorage.removeItem("handy-update-dismissed");
    waitingWorker.postMessage("SKIP_WAITING");
  } catch (error) {
    reloadAfterUpdate = false;
    updateNowButton.disabled = false;
    updateLaterButton.disabled = false;
    updateNowButton.textContent = "Refresh";
    console.error("Could not activate the Handy update.", error);
    showToast("Could not apply the update. Please try again.");
  }
});

function readStoredList(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

let activeToolCategory = "all";

function readRecentSearches() {
  return readStoredList(recentSearchesKey)
    .filter((query) => typeof query === "string" && query.trim())
    .slice(0, 5);
}

function saveRecentSearch(query) {
  const normalized = query.trim();
  if (!normalized) return;
  const searches = [normalized, ...readRecentSearches().filter((item) =>
    item.toLowerCase() !== normalized.toLowerCase()
  )].slice(0, 5);
  try {
    localStorage.setItem(recentSearchesKey, JSON.stringify(searches));
  } catch (error) {
    console.error("Could not save recent searches.", error);
  }
}

function escapeSearchHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function applyToolFilters() {
  const query = searchInput.value.trim().toLowerCase();
  let matches = 0;
  toolCards.forEach((card) => {
    const categoryMatches = activeToolCategory === "all"
      || card.dataset.category === activeToolCategory;
    const queryMatches = !query
      || card.dataset.name.includes(query)
      || card.textContent.toLowerCase().includes(query);
    const isMatch = categoryMatches && queryMatches;
    card.classList.toggle("hidden", !isMatch);
    if (isMatch) matches += 1;
  });
  return matches;
}

function saveFavoriteTools() {
  const favorites = toolCards
    .filter((card) => card.querySelector(".favorite-tool")?.classList.contains("active"))
    .map((card) => card.querySelector("h3").textContent);
  localStorage.setItem(favoritesKey, JSON.stringify(favorites));
  renderSavedTools();
}

function saveRecentTool(name) {
  const recent = readStoredList(recentKey).filter((item) => item !== name);
  recent.unshift(name);
  localStorage.setItem(recentKey, JSON.stringify(recent.slice(0, 4)));
  renderSavedTools();
}

const savedFavorites = readStoredList(favoritesKey);
const toolLayoutStorageKey = "handy-tool-layout";
toolCards.forEach((card) => {
  const title = card.querySelector("h3").textContent;
  const favorite = document.createElement("button");
  favorite.type = "button";
  favorite.className = "favorite-tool";
  favorite.setAttribute("aria-label", `Favorite ${title}`);
  favorite.setAttribute("aria-pressed", savedFavorites.includes(title).toString());
  favorite.textContent = "★";
  if (savedFavorites.includes(title)) favorite.classList.add("active");
  favorite.addEventListener("click", (event) => {
    event.stopPropagation();
    favorite.classList.toggle("active");
    favorite.setAttribute("aria-pressed", favorite.classList.contains("active").toString());
    saveFavoriteTools();
  });
  card.prepend(favorite);
});

const customizableToolNames = toolCards.map((card) => card.querySelector("h3").textContent);
const toolLayoutKeySet = new Set(customizableToolNames);

function readToolLayout() {
  try {
    const stored = JSON.parse(localStorage.getItem(toolLayoutStorageKey) || "null");
    if (!stored || !Array.isArray(stored.order) || !Array.isArray(stored.hidden)) return null;
    const order = stored.order.filter((name) => toolLayoutKeySet.has(name));
    const hidden = stored.hidden.filter((name) => toolLayoutKeySet.has(name));
    const completeOrder = [
      ...order,
      ...customizableToolNames.filter((name) => !order.includes(name))
    ];
    return {
      order: completeOrder,
      hidden: [...new Set(hidden)]
    };
  } catch {
    return null;
  }
}

let toolLayout = readToolLayout() || {
  order: customizableToolNames,
  hidden: []
};

const personalizationPresets = {
  work: ["Calculator", "Unit Converter", "Timer & Stopwatch"],
  travel: ["Currency Exchange", "World Clock", "QR Code Maker", "Unit Converter"],
  study: ["Calculator", "Timer & Stopwatch", "World Clock"]
};
const personalizationPresetStatus = document.querySelector("#personalizationPresetStatus");

function readPersonalizationPreset() {
  const preset = localStorage.getItem(personalizationPresetKey);
  return Object.hasOwn(personalizationPresets, preset) ? preset : null;
}

function updatePersonalizationPresetUi() {
  const preset = readPersonalizationPreset();
  document.querySelectorAll("[data-personalization-preset]").forEach((button) => {
    const active = button.dataset.personalizationPreset === preset;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active.toString());
  });
  if (personalizationPresetStatus) {
    personalizationPresetStatus.textContent = preset
      ? `${preset[0].toUpperCase()}${preset.slice(1)} preset is active.`
      : "Using your custom layout.";
  }
}

function applyPersonalizationPreset(presetName) {
  const presetNames = personalizationPresets[presetName];
  if (!presetNames) return;
  toolLayout = {
    order: [
      ...presetNames,
      ...customizableToolNames.filter((name) => !presetNames.includes(name))
    ],
    hidden: customizableToolNames.filter((name) => !presetNames.includes(name))
  };
  try {
    localStorage.setItem(personalizationPresetKey, presetName);
  } catch (error) {
    console.error("Could not save the personalization preset.", error);
  }
  saveToolLayout();
  updatePersonalizationPresetUi();
  showToast(`${presetName[0].toUpperCase()}${presetName.slice(1)} preset applied.`);
}

function saveToolLayout() {
  localStorage.setItem(toolLayoutStorageKey, JSON.stringify(toolLayout));
  applyToolLayout();
  renderToolCustomizer();
  showToast("Tool layout saved.");
}

function applyToolLayout() {
  const grid = document.querySelector("#toolGrid");
  toolLayout.order.forEach((name) => {
    const card = toolCards.find((item) => item.querySelector("h3").textContent === name);
    if (card) grid.appendChild(card);
  });
  toolCards.forEach((card) => {
    const name = card.querySelector("h3").textContent;
    card.hidden = toolLayout.hidden.includes(name);
  });
}

function recordToolUsage(name) {
  let usage = {};
  try {
    const stored = JSON.parse(localStorage.getItem(toolUsageKey) || "{}");
    if (stored && typeof stored === "object" && !Array.isArray(stored)) usage = stored;
  } catch {
    usage = {};
  }
  if (!toolLayoutKeySet.has(name)) return;
  const count = Number.isFinite(usage[name]) ? usage[name] : 0;
  usage[name] = count + 1;
  localStorage.setItem(toolUsageKey, JSON.stringify(usage));
}

function renderToolCustomizer() {
  const list = document.querySelector("#toolCustomizerList");
  list.replaceChildren();
  toolLayout.order.forEach((name, index) => {
    const row = document.createElement("div");
    row.className = "tool-customizer-row";
    row.dataset.toolName = name;

    const visibility = document.createElement("button");
    visibility.type = "button";
    visibility.className = "tool-visibility";
    const hidden = toolLayout.hidden.includes(name);
    visibility.setAttribute("aria-pressed", (!hidden).toString());
    visibility.setAttribute("aria-label", `${hidden ? "Show" : "Hide"} ${name}`);
    visibility.textContent = hidden ? "Hidden" : "Visible";
    visibility.addEventListener("click", () => {
      toolLayout.hidden = hidden
        ? toolLayout.hidden.filter((item) => item !== name)
        : [...toolLayout.hidden, name];
      saveToolLayout();
    });

    const label = document.createElement("span");
    label.className = "tool-customizer-name";
    label.textContent = name;

    const moveUp = document.createElement("button");
    moveUp.type = "button";
    moveUp.className = "tool-order-button";
    moveUp.textContent = "↑";
    moveUp.setAttribute("aria-label", `Move ${name} earlier`);
    moveUp.disabled = index === 0;
    moveUp.addEventListener("click", () => moveTool(name, -1));

    const moveDown = document.createElement("button");
    moveDown.type = "button";
    moveDown.className = "tool-order-button";
    moveDown.textContent = "↓";
    moveDown.setAttribute("aria-label", `Move ${name} later`);
    moveDown.disabled = index === toolLayout.order.length - 1;
    moveDown.addEventListener("click", () => moveTool(name, 1));

    row.append(visibility, label, moveUp, moveDown);
    list.appendChild(row);
  });
}

function moveTool(name, offset) {
  const index = toolLayout.order.indexOf(name);
  const nextIndex = index + offset;
  if (nextIndex < 0 || nextIndex >= toolLayout.order.length) return;
  [toolLayout.order[index], toolLayout.order[nextIndex]] =
    [toolLayout.order[nextIndex], toolLayout.order[index]];
  saveToolLayout();
}

document.querySelector("#resetToolLayout").addEventListener("click", () => {
  const previousToolLayout = {
    order: [...toolLayout.order],
    hidden: [...toolLayout.hidden]
  };
  const previousPreset = localStorage.getItem(personalizationPresetKey);
  toolLayout = { order: [...customizableToolNames], hidden: [] };
  localStorage.removeItem(personalizationPresetKey);
  saveToolLayout();
  updatePersonalizationPresetUi();
  showToast("Tool layout reset.", {
    label: "Undo",
    onClick: () => {
      toolLayout = {
        order: [...previousToolLayout.order],
        hidden: [...previousToolLayout.hidden]
      };
      if (previousPreset === null) localStorage.removeItem(personalizationPresetKey);
      else localStorage.setItem(personalizationPresetKey, previousPreset);
      saveToolLayout();
      updatePersonalizationPresetUi();
      showToast("Tool layout restored.");
    }
  });
});

document.querySelectorAll("[data-personalization-preset]").forEach((button) => {
  button.addEventListener("click", () => {
    applyPersonalizationPreset(button.dataset.personalizationPreset);
  });
});

updatePersonalizationPresetUi();

applyToolLayout();
renderToolCustomizer();

const savedToolsGrid = document.querySelector("#savedToolsGrid");

function renderSavedTools() {
  const favorites = readStoredList(favoritesKey);
  const recent = readStoredList(recentKey);
  let usage = {};
  try {
    usage = JSON.parse(localStorage.getItem(toolUsageKey) || "{}") || {};
  } catch {
    usage = {};
  }
  const names = [...new Set([
    ...favorites,
    ...recent,
    ...toolLayout.order
      .filter((name) => Number.isFinite(usage[name]) && usage[name] > 0)
      .sort((a, b) => usage[b] - usage[a])
  ])];

  if (!names.length) {
    savedToolsGrid.innerHTML = '<div class="saved-tools-empty">Star a tool or open one to create your shortcuts.</div>';
    return;
  }

  const icons = {
    "Calculator": "±",
    "Unit Converter": "⇄",
    "World Clock": "◷",
    "Currency Exchange": "$",
    "Timer & Stopwatch": "◴",
    "QR Code Maker": "▦"
  };

  savedToolsGrid.innerHTML = names.slice(0, 8).map((name) => {
    const isFavorite = favorites.includes(name);
    const isRecent = recent.includes(name);
    const label = isFavorite ? "Favorite" : isRecent ? "Recent" : "Saved";
    return `
      <button type="button" class="saved-tool" data-open-tool="${name}" aria-label="Open ${name}">
        <span class="saved-tool-icon" aria-hidden="true">${icons[name] || "•"}</span>
        <span class="saved-tool-copy">
          <strong>${name}</strong>
          <span>${label}</span>
        </span>
      </button>
    `;
  }).join("");

  savedToolsGrid.querySelectorAll("[data-open-tool]").forEach((button) => {
    button.addEventListener("click", () => {
      const card = toolCards.find((item) =>
        item.querySelector("h3").textContent === button.dataset.openTool
      );
      card?.querySelector(".card-arrow").click();
    });
  });
}

document.querySelector("#clearRecent").addEventListener("click", () => {
  const previousRecentTools = localStorage.getItem(recentKey);
  localStorage.removeItem(recentKey);
  renderSavedTools();
  showToast("Recent tools cleared.", {
    label: "Undo",
    onClick: () => {
      if (previousRecentTools === null) localStorage.removeItem(recentKey);
      else localStorage.setItem(recentKey, previousRecentTools);
      renderSavedTools();
      showToast("Recent tools restored.");
    }
  });
});

document.querySelector("#resetPersonalization").addEventListener("click", () => {
  if (!window.confirm("Reset smart shortcut usage and recent searches? Favorites and tool layout will stay unchanged.")) return;
  try {
    const previousValues = new Map([
      [toolUsageKey, localStorage.getItem(toolUsageKey)],
      [recentSearchesKey, localStorage.getItem(recentSearchesKey)],
      [recentKey, localStorage.getItem(recentKey)],
      [personalizationPresetKey, localStorage.getItem(personalizationPresetKey)]
    ]);
    localStorage.removeItem(toolUsageKey);
    localStorage.removeItem(recentSearchesKey);
    localStorage.removeItem(recentKey);
    localStorage.removeItem(personalizationPresetKey);
    renderSavedTools();
    closeSearchSuggestions();
    showToast("Smart shortcut personalization reset.", {
      label: "Undo",
      onClick: () => {
        previousValues.forEach((value, key) => {
          if (value === null) localStorage.removeItem(key);
          else localStorage.setItem(key, value);
        });
        renderSavedTools();
        updatePersonalizationPresetUi();
        showToast("Smart shortcut personalization restored.");
      }
    });
  } catch (error) {
    console.error("Could not reset smart shortcut personalization.", error);
    showToast("Could not reset smart shortcuts.");
  }
});

renderSavedTools();

const savedTheme = localStorage.getItem("handy-theme");
if (savedTheme === "dark") {
  document.body.classList.add("dark");
  themeToggle.setAttribute("aria-label", "Switch to light mode");
}

themeToggle.addEventListener("click", () => {
  const isDark = document.body.classList.toggle("dark");
  localStorage.setItem("handy-theme", isDark ? "dark" : "light");
  themeToggle.setAttribute("aria-label", isDark ? "Switch to light mode" : "Switch to dark mode");
});

const menuToggle = document.querySelector("#menuToggle");
const mobileMenu = document.querySelector("#mobileMenu");

function closeMobileMenu() {
  mobileMenu.hidden = true;
  menuToggle.classList.remove("open");
  menuToggle.setAttribute("aria-expanded", "false");
  menuToggle.setAttribute("aria-label", "Open navigation menu");
}

menuToggle.addEventListener("click", () => {
  const isOpen = mobileMenu.hidden;
  mobileMenu.hidden = !isOpen;
  menuToggle.classList.toggle("open", isOpen);
  menuToggle.setAttribute("aria-expanded", isOpen.toString());
  menuToggle.setAttribute("aria-label", isOpen ? "Close navigation menu" : "Open navigation menu");
});

mobileMenu.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", closeMobileMenu);
});

document.addEventListener("click", (event) => {
  if (!event.target.closest(".nav-actions") && !event.target.closest(".mobile-menu")) {
    closeMobileMenu();
  }
});

window.addEventListener("resize", () => {
  if (window.innerWidth > 640) closeMobileMenu();
});

const commandPalette = document.querySelector("#commandPalette");
const commandPaletteInput = document.querySelector("#commandPaletteInput");
const commandPaletteList = document.querySelector("#commandPaletteList");
let commandPaletteIndex = 0;
let commandPaletteActions = [];

function openCommandPalette() {
  if (!commandPalette) return;
  commandPalette.hidden = false;
  commandPaletteInput.value = "";
  commandPaletteIndex = 0;
  renderCommandPalette();
  window.openAccessibleModal(commandPalette);
  requestAnimationFrame(() => commandPaletteInput.focus());
}

function closeCommandPalette() {
  if (!commandPalette) return;
  commandPalette.hidden = true;
}

function getCommandPaletteActions(query = "") {
  const normalized = query.trim().toLowerCase();
  const toolActions = Object.entries(toolLinks)
    .filter(([toolId]) => toolId !== "guides")
    .map(([toolId, tool]) => ({
      id: `open:${toolId}`,
      title: tool.name,
      description: toolId === "qr" ? "Create or scan a QR code" : `Open ${tool.name}`,
      icon: toolIdsByName[tool.name]?.slice(0, 1).toUpperCase() || "•",
      key: toolId === "qr" ? "Scan" : "",
      run: () => openLinkedTool(toolId)
    }));
  toolActions.push({
    id: "scan:qr",
    title: "Scan QR code",
    description: "Open the camera/image QR scanner",
    icon: "QR",
    key: "Scan",
    run: () => openLinkedTool("qr", "scan")
  });
  toolActions.push({
    id: "open:guides",
    title: "Helpful guides",
    description: "Open everyday guides",
    icon: "G",
    key: "",
    run: () => openLinkedTool("guides")
  });
  return toolActions.filter((action) =>
    `${action.title} ${action.description}`.toLowerCase().includes(normalized)
  );
}

function renderCommandPalette() {
  commandPaletteActions = getCommandPaletteActions(commandPaletteInput.value);
  if (commandPaletteIndex >= commandPaletteActions.length) {
    commandPaletteIndex = Math.max(0, commandPaletteActions.length - 1);
  }
  commandPaletteList.innerHTML = commandPaletteActions.length
    ? commandPaletteActions.map((action, index) => `
      <button type="button"
        class="command-palette-action${index === commandPaletteIndex ? " selected" : ""}"
        role="option"
        aria-selected="${index === commandPaletteIndex}"
        data-command-index="${index}">
        <span class="command-palette-action-icon" aria-hidden="true">${action.icon}</span>
        <span class="command-palette-action-copy">
          <strong>${action.title}</strong>
          <span>${action.description}</span>
        </span>
        <span class="command-palette-action-key">${action.key}</span>
      </button>
    `).join("")
    : '<p class="search-no-results">No Handy actions found.</p>';

  commandPaletteList.querySelectorAll("[data-command-index]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = commandPaletteActions[Number(button.dataset.commandIndex)];
      closeCommandPalette();
      action?.run();
    });
  });
}

commandPaletteInput.addEventListener("input", () => {
  commandPaletteIndex = 0;
  renderCommandPalette();
});

commandPaletteInput.addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    if (!commandPaletteActions.length) return;
    const direction = event.key === "ArrowDown" ? 1 : -1;
    commandPaletteIndex = (commandPaletteIndex + direction + commandPaletteActions.length) % commandPaletteActions.length;
    renderCommandPalette();
  } else if (event.key === "Enter") {
    event.preventDefault();
    const action = commandPaletteActions[commandPaletteIndex];
    if (!action) return;
    closeCommandPalette();
    action.run();
  } else if (event.key === "Escape") {
    event.preventDefault();
    closeCommandPalette();
  }
});

commandPalette.querySelectorAll("[data-close-command]").forEach((button) => {
  button.addEventListener("click", closeCommandPalette);
});

document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    openCommandPalette();
    return;
  }
  if (event.key === "/" && !event.ctrlKey && !event.metaKey && !event.altKey
    && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) {
    event.preventDefault();
    openCommandPalette();
    return;
  }
  if (event.key === "Escape" && !mobileMenu.hidden) {
    closeMobileMenu();
    menuToggle.focus();
  }
});

searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  closeSearchSuggestions();
  const query = searchInput.value.trim();
  if (query) saveRecentSearch(query);
  const matches = applyToolFilters();

  showToast(query ? `${matches} tool${matches === 1 ? "" : "s"} found` : "Showing all tools");
  document.querySelector("#tools").scrollIntoView({ behavior: "smooth", block: "start" });
});

searchInput.addEventListener("input", () => {
  const query = searchInput.value.trim().toLowerCase();
  if (!query) {
    applyToolFilters();
    const recentSearches = readRecentSearches();
    if (recentSearches.length) {
      searchSuggestionList.innerHTML = recentSearches.map((search, index) => `
        <div
          class="suggestion-button"
          id="recent-search-${index}"
          role="option"
          aria-selected="false"
          data-recent-search="${escapeSearchHtml(search)}"
        ><span>${escapeSearchHtml(search)}</span><span>Recent search</span></div>
      `).join("");
      searchSuggestionList.querySelectorAll("[data-recent-search]").forEach((suggestion) => {
        suggestion.addEventListener("click", () => {
          searchInput.value = suggestion.dataset.recentSearch;
          searchInput.dispatchEvent(new Event("input"));
        });
      });
      searchSuggestions.hidden = false;
      searchInput.setAttribute("aria-expanded", "true");
      searchSuggestionStatus.textContent = "Recent searches.";
    } else {
      closeSearchSuggestions();
    }
    return;
  }

  const matches = toolCards.filter((card) => {
    const categoryMatches = activeToolCategory === "all"
      || card.dataset.category === activeToolCategory;
    return categoryMatches
      && (card.dataset.name.includes(query) || card.textContent.toLowerCase().includes(query));
  });
  renderSearchSuggestions(matches, query);
});

searchInput.addEventListener("keydown", (event) => {
  const suggestions = [...searchSuggestions.querySelectorAll(".suggestion-button[data-suggestion]")];
  if (searchSuggestions.hidden) return;

  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    if (!suggestions.length) return;
    const direction = event.key === "ArrowDown" ? 1 : -1;
    if (selectedSuggestionIndex < 0) {
      selectedSuggestionIndex = direction > 0 ? 0 : suggestions.length - 1;
    } else {
      selectedSuggestionIndex = (selectedSuggestionIndex + direction + suggestions.length) % suggestions.length;
    }
    updateSuggestionSelection(suggestions);
  } else if (event.key === "Enter" && selectedSuggestionIndex >= 0) {
    event.preventDefault();
    suggestions[selectedSuggestionIndex].click();
  } else if (event.key === "Escape") {
    closeSearchSuggestions();
  }
});

function closeSearchSuggestions({ clearStatus = true } = {}) {
  searchSuggestions.hidden = true;
  searchInput.setAttribute("aria-expanded", "false");
  searchInput.removeAttribute("aria-activedescendant");
  selectedSuggestionIndex = -1;
  if (clearStatus) searchSuggestionStatus.textContent = "";
}

function updateSuggestionSelection(suggestions) {
  suggestions.forEach((suggestion, index) => {
    const selected = index === selectedSuggestionIndex;
    suggestion.classList.toggle("selected", selected);
    suggestion.setAttribute("aria-selected", selected.toString());
  });
  const selected = suggestions[selectedSuggestionIndex];
  if (selected) {
    searchInput.setAttribute("aria-activedescendant", selected.id);
    selected.scrollIntoView({ block: "nearest" });
  } else {
    searchInput.removeAttribute("aria-activedescendant");
  }
}

document.querySelectorAll(".card-arrow").forEach((button) => {
  button.addEventListener("click", () => {
    const name = button.closest(".tool-card").querySelector("h3").textContent;
    const toolId = toolIdsByName[name];
    if (toolId) {
      saveRecentTool(name);
      recordToolUsage(name);
      openLinkedTool(toolId);
    } else {
      showToast(`${name} is ready to open`);
    }
  });
});

document.querySelector("#qrScanShortcut").addEventListener("click", () => {
  saveRecentTool("QR Code Maker");
  recordToolUsage("QR Code Maker");
  openLinkedTool("qr", "scan");
});

document.querySelector(".view-all").addEventListener("click", () => {
  searchInput.value = "";
  activeToolCategory = "all";
  document.querySelectorAll(".tool-category-filter").forEach((button) => {
    const active = button.dataset.toolCategory === "all";
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active.toString());
  });
  closeSearchSuggestions();
  applyToolFilters();
  showToast("Showing all popular tools");
});

document.querySelectorAll(".tool-category-filter").forEach((button) => {
  button.addEventListener("click", () => {
    activeToolCategory = button.dataset.toolCategory;
    document.querySelectorAll(".tool-category-filter").forEach((filter) => {
      const active = filter === button;
      filter.classList.toggle("active", active);
      filter.setAttribute("aria-pressed", active.toString());
    });
    applyToolFilters();
  });
});

function renderSearchSuggestions(matches, query) {
  selectedSuggestionIndex = -1;
  let usage = {};
  try {
    usage = JSON.parse(localStorage.getItem(toolUsageKey) || "{}") || {};
  } catch {
    usage = {};
  }
  matches = [...matches].sort((a, b) => {
    const aName = a.querySelector("h3").textContent;
    const bName = b.querySelector("h3").textContent;
    return (Number(usage[bName]) || 0) - (Number(usage[aName]) || 0);
  });
  searchInput.removeAttribute("aria-activedescendant");
  searchSuggestionList.innerHTML = matches.map((card, index) => {
    const title = card.querySelector("h3").textContent;
    const description = card.querySelector("p").textContent;
    return `<div
      class="suggestion-button"
      id="tool-suggestion-${index}"
      role="option"
      aria-selected="false"
      data-suggestion="${title}"
    ><span>${title}</span><span>${description}</span></div>`;
  }).join("");
  searchNoResults.hidden = matches.length > 0;
  searchNoResults.textContent = matches.length ? "" : `No tools found for "${query}". Try another search.`;

  const searchRect = document.querySelector(".search-bar").getBoundingClientRect();
  searchSuggestions.style.left = `${searchRect.left}px`;
  searchSuggestions.style.top = `${searchRect.bottom + 8}px`;
  searchSuggestions.hidden = false;
  searchInput.setAttribute("aria-expanded", "true");
  searchSuggestionStatus.textContent = matches.length
    ? `${matches.length} tool suggestion${matches.length === 1 ? "" : "s"} available. Use the up and down arrow keys to navigate.`
    : `No tools found for "${query}". Try another search.`;

  searchSuggestionList.querySelectorAll("[data-suggestion]").forEach((suggestion) => {
    suggestion.addEventListener("click", () => {
      const selectedName = suggestion.dataset.suggestion;
      searchInput.value = selectedName;
      closeSearchSuggestions({ clearStatus: false });
      searchSuggestionStatus.textContent = `${selectedName} selected.`;
      const card = toolCards.find((item) =>
        item.querySelector("h3").textContent === selectedName
      );
      toolCards.forEach((item) => item.classList.toggle("hidden", item !== card));
      document.querySelector("#tools").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

document.addEventListener("click", (event) => {
  if (!event.target.closest(".search-bar") && !event.target.closest(".search-suggestions")) {
    closeSearchSuggestions();
  }
});

let toastTimer;
function showToast(message, action) {
  toast.replaceChildren();
  const text = document.createElement("span");
  text.textContent = message;
  toast.append(text);
  if (action) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "toast-action";
    button.textContent = action.label;
    button.addEventListener("click", action.onClick, { once: true });
    toast.append(button);
  }
  toast.classList.toggle("has-action", Boolean(action));
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), action ? 10000 : 2200);
}

const travelKitForm = document.querySelector("#travelKitForm");
const travelKitStatus = document.querySelector("#travelKitStatus");
const travelKitSelector = document.querySelector("#travelKitSelector");
const saveTravelKitButton = document.querySelector("#saveTravelKit");
const newTravelKitButton = document.querySelector("#newTravelKit");
const duplicateTravelKitButton = document.querySelector("#duplicateTravelKit");
const deleteTravelKitButton = document.querySelector("#deleteTravelKit");
const mobileTravelSave = document.querySelector("#mobileTravelSave");
const travelKitEmpty = document.querySelector("#travelKitEmpty");
const startFirstTravelKit = document.querySelector("#startFirstTravelKit");
const travelDateSummary = document.querySelector("#travelDateSummary");
const travelPlanningSuggestion = document.querySelector("#travelPlanningSuggestion");
const travelPlanningSuggestionTitle = document.querySelector("#travelPlanningSuggestionTitle");
const travelPlanningSuggestionText = document.querySelector("#travelPlanningSuggestionText");
const applyTravelPlanningSuggestion = document.querySelector("#applyTravelPlanningSuggestion");
const travelKitActionButtons = [...document.querySelectorAll("[data-travel-action]")];
const copySharedTripButton = document.querySelector("#copySharedTrip");
const shareSharedTripButton = document.querySelector("#shareSharedTrip");
const qrSharedTripButton = document.querySelector("#qrSharedTrip");
const printSharedTripButton = document.querySelector("#printSharedTrip");
const travelShareStatus = document.querySelector("#travelShareStatus");
const travelChecklistList = document.querySelector("#travelChecklistList");
const travelChecklistProgress = document.querySelector("#travelChecklistProgress");
const travelChecklistStatus = document.querySelector("#travelChecklistStatus");
const travelChecklistItem = document.querySelector("#travelChecklistItem");
const addTravelChecklistItem = document.querySelector("#addTravelChecklistItem");
const travelChecklistTemplateButtons = [...document.querySelectorAll("[data-checklist-template]")];
const resetTravelChecklistButton = document.querySelector("#resetTravelChecklist");
const travelTimeline = document.querySelector("#travelTimeline");
const travelItineraryStatus = document.querySelector("#travelItineraryStatus");
const travelEventTitle = document.querySelector("#travelEventTitle");
const travelEventDateTime = document.querySelector("#travelEventDateTime");
const travelEventLocation = document.querySelector("#travelEventLocation");
const travelEventNotes = document.querySelector("#travelEventNotes");
const addTravelEvent = document.querySelector("#addTravelEvent");
const exportTravelCalendarButton = document.querySelector("#exportTravelCalendar");
const travelBudgetLimit = document.querySelector("#travelBudgetLimit");
const travelBudgetCurrency = document.querySelector("#travelBudgetCurrency");
const travelBudgetSpent = document.querySelector("#travelBudgetSpent");
const travelBudgetRemaining = document.querySelector("#travelBudgetRemaining");
const travelBudgetStatus = document.querySelector("#travelBudgetStatus");
const exportTravelExpensesButton = document.querySelector("#exportTravelExpenses");
const travelExpenseTitle = document.querySelector("#travelExpenseTitle");
const travelExpenseAmount = document.querySelector("#travelExpenseAmount");
const travelExpenseCategory = document.querySelector("#travelExpenseCategory");
const addTravelExpense = document.querySelector("#addTravelExpense");
const travelExpenseList = document.querySelector("#travelExpenseList");
const travelExpenseBreakdownEmpty = document.querySelector("#travelExpenseBreakdownEmpty");
const travelExpenseCategoryList = document.querySelector("#travelExpenseCategoryList");
const travelBudgetProgress = document.querySelector("#travelBudgetProgress");
const travelBudgetProgressBar = document.querySelector("#travelBudgetProgressBar");
const maximumTravelKits = 10;
const maximumChecklistItems = 40;
const maximumItineraryEvents = 30;
const maximumBudgetExpenses = 100;
let travelKitStore = { activeId: null, trips: [] };
let activeTravelKitId = null;
let travelKitDraftDirty = false;
let travelKitLoadError = "";
let activeTravelPlanningSuggestion = null;

const travelChecklistTemplates = {
  essentials: ["Passport", "Travel tickets", "Wallet and cards", "Phone charger", "Medication"],
  documents: ["Passport copies", "Insurance details", "Booking confirmations", "Emergency contacts"],
  electronics: ["Phone", "Travel adapter", "Power bank", "Headphones", "Camera"]
};

const travelDestinationProfiles = [
  { terms: ["tokyo", "japan"], timeZone: "Asia/Tokyo", currency: "JPY", label: "Tokyo, Japan" },
  { terms: ["singapore"], timeZone: "Asia/Singapore", currency: "SGD", label: "Singapore" },
  { terms: ["dubai", "united arab emirates", "uae"], timeZone: "Asia/Dubai", currency: "AED", label: "Dubai" },
  { terms: ["new delhi", "delhi", "india"], timeZone: "Asia/Kolkata", currency: "INR", label: "India" },
  { terms: ["london", "united kingdom", "uk", "england"], timeZone: "Europe/London", currency: "GBP", label: "United Kingdom" },
  { terms: ["paris", "france"], timeZone: "Europe/Paris", currency: "EUR", label: "France" },
  { terms: ["new york"], timeZone: "America/New_York", currency: "USD", label: "New York" },
  { terms: ["los angeles", "san francisco"], timeZone: "America/Los_Angeles", currency: "USD", label: "California" },
  { terms: ["united states", "usa", "america"], timeZone: "America/New_York", currency: "USD", label: "United States" },
  { terms: ["sydney", "australia"], timeZone: "Australia/Sydney", currency: "AUD", label: "Australia" },
  { terms: ["auckland", "new zealand"], timeZone: "Pacific/Auckland", currency: "NZD", label: "New Zealand" },
  { terms: ["johannesburg", "south africa"], timeZone: "Africa/Johannesburg", currency: null, label: "South Africa" },
  { terms: ["são paulo", "sao paulo", "brazil"], timeZone: "America/Sao_Paulo", currency: null, label: "Brazil" },
];

function getTravelKitFormValues() {
  return {
    name: document.querySelector("#travelKitName").value,
    destination: document.querySelector("#travelKitDestination").value,
    homeCurrency: document.querySelector("#travelKitHomeCurrency").value,
    destinationCurrency: document.querySelector("#travelKitDestinationCurrency").value,
    timeZone: document.querySelector("#travelKitTimeZone").value,
    startDate: document.querySelector("#travelKitStartDate").value,
    endDate: document.querySelector("#travelKitEndDate").value,
    qrNote: document.querySelector("#travelKitQrNote").value
  };
}

function inferTravelDestination(destination) {
  const normalized = destination.trim().toLowerCase();
  if (!normalized) return null;
  return travelDestinationProfiles.find((profile) =>
    profile.terms.some((term) => normalized.includes(term))
  ) || null;
}

function updateTravelPlanningSuggestion() {
  const destination = document.querySelector("#travelKitDestination").value;
  const profile = inferTravelDestination(destination);
  const homeCurrency = document.querySelector("#travelKitHomeCurrency").value;
  const destinationCurrency = profile?.currency
    ? profile.currency
    : document.querySelector("#travelKitDestinationCurrency").value;
  activeTravelPlanningSuggestion = profile
    ? { timeZone: profile.timeZone, destinationCurrency, profile }
    : null;

  if (!profile) {
    travelPlanningSuggestion.hidden = true;
    return;
  }

  const parts = [
    `Likely destination: ${profile.label}.`,
    `Suggested time zone: ${profile.timeZone}.`
  ];
  if (profile.currency) parts.push(`Suggested destination currency: ${profile.currency}.`);
  const selectedDestinationCurrency = document.querySelector("#travelKitDestinationCurrency").value;
  if (homeCurrency === selectedDestinationCurrency) {
    parts.push(`Home and destination both use ${homeCurrency}; no currency conversion may be needed.`);
  }
  travelPlanningSuggestionTitle.textContent = "Planning suggestion";
  travelPlanningSuggestionText.textContent = parts.join(" ");
  travelPlanningSuggestion.hidden = false;
}

applyTravelPlanningSuggestion.addEventListener("click", () => {
  if (!activeTravelPlanningSuggestion) return;
  document.querySelector("#travelKitTimeZone").value =
    activeTravelPlanningSuggestion.timeZone;
  if (activeTravelPlanningSuggestion.destinationCurrency) {
    document.querySelector("#travelKitDestinationCurrency").value =
      activeTravelPlanningSuggestion.destinationCurrency;
  }
  const destinationName = document.querySelector("#travelKitDestination").value.trim();
  if (!document.querySelector("#travelKitName").value.trim()) {
    document.querySelector("#travelKitName").value =
      `${destinationName.split(",")[0]} trip`.slice(0, 50);
  }
  if (!document.querySelector("#travelEventTitle").value.trim()) {
    document.querySelector("#travelEventTitle").value =
      `Arrival in ${activeTravelPlanningSuggestion.profile.label}`;
  }
  if (!document.querySelector("#travelEventLocation").value.trim()) {
    document.querySelector("#travelEventLocation").value =
      activeTravelPlanningSuggestion.profile.label;
  }
  travelPlanningSuggestionTitle.textContent = "Suggestions applied";
  travelPlanningSuggestionText.textContent =
    "Time zone and destination currency are filled. Add a date/time for the suggested arrival event.";
  handleTravelKitFormChange();
});

function setTravelKitFormValues(kit) {
  document.querySelector("#travelKitName").value = kit.name;
  document.querySelector("#travelKitDestination").value = kit.destination;
  document.querySelector("#travelKitHomeCurrency").value = kit.homeCurrency;
  document.querySelector("#travelKitDestinationCurrency").value = kit.destinationCurrency;
  document.querySelector("#travelKitTimeZone").value = kit.timeZone;
  document.querySelector("#travelKitStartDate").value = kit.startDate || "";
  document.querySelector("#travelKitEndDate").value = kit.endDate || "";
  document.querySelector("#travelKitQrNote").value = kit.qrNote;
  updateTravelPlanningSuggestion();
  updateTripDateSummary();
}

function getActiveTravelKit() {
  return travelKitStore.trips.find((trip) => trip.id === activeTravelKitId) || null;
}

function travelKitFormMatchesSaved() {
  const activeTrip = getActiveTravelKit();
  if (!activeTrip) return false;
  try {
    const savedFields = { ...activeTrip };
    delete savedFields.id;
    delete savedFields.checklist;
    delete savedFields.itinerary;
    delete savedFields.budget;
    return JSON.stringify(validateTravelKit(getTravelKitFormValues())) === JSON.stringify(savedFields);
  } catch {
    return false;
  }
}

function updateTravelKitActions() {
  const activeTrip = getActiveTravelKit();
  const ready = Boolean(activeTrip && travelKitFormMatchesSaved());
  travelKitActionButtons.forEach((button) => { button.disabled = !ready; });
  [copySharedTripButton, shareSharedTripButton, qrSharedTripButton, printSharedTripButton]
    .forEach((button) => { button.disabled = !ready; });
  duplicateTravelKitButton.disabled = !activeTrip;
  saveTravelKitButton.textContent = activeTrip ? "Save changes" : "Save new trip";
  if (mobileTravelSave) mobileTravelSave.textContent = activeTrip ? "Save changes" : "Save trip";
  deleteTravelKitButton.disabled = !activeTrip;
  travelKitEmpty.hidden = travelKitStore.trips.length > 0 || Boolean(activeTrip);
  if (travelKitLoadError && !travelKitDraftDirty) {
    travelKitStatus.textContent = travelKitLoadError;
  } else if (activeTrip && !ready) {
    travelKitStatus.textContent = "Save your changes before opening these tools.";
  } else if (ready) {
    travelKitStatus.textContent = `${activeTrip.name} is saved on this device.`;
  } else if (travelKitDraftDirty) {
    travelKitStatus.textContent = "Save this trip to add it to your Travel Kits.";
  } else {
    travelKitStatus.textContent = "Enter trip details and save as a new trip.";
  }
}

function renderTravelKitSelector() {
  travelKitSelector.replaceChildren();
  const newTripOption = document.createElement("option");
  newTripOption.value = "";
  newTripOption.textContent = "New trip";
  travelKitSelector.append(newTripOption);
  travelKitStore.trips.forEach((trip) => {
    const option = document.createElement("option");
    option.value = trip.id;
    option.textContent = `${trip.name} — ${trip.destination}`;
    travelKitSelector.append(option);
  });
  travelKitSelector.value = activeTravelKitId || "";
}

function showTravelKit(id) {
  activeTravelKitId = id;
  travelKitDraftDirty = false;
  const activeTrip = getActiveTravelKit();
  if (activeTrip) setTravelKitFormValues(activeTrip);
  else {
    travelKitForm.reset();
    updateTravelPlanningSuggestion();
    updateTripDateSummary();
  }
  travelKitEmpty.hidden = travelKitStore.trips.length > 0 || Boolean(id);
  renderTravelKitSelector();
  renderTravelChecklist();
  renderTravelItinerary();
  renderTravelBudget();
  updateTravelKitActions();
}

function hasUnsavedTravelKitChanges() {
  return getActiveTravelKit() ? !travelKitFormMatchesSaved() : travelKitDraftDirty;
}

function persistTravelKitStore(store) {
  try {
    localStorage.setItem(travelKitStorageKey, JSON.stringify(store));
    travelKitStore = store;
    travelKitLoadError = "";
    return true;
  } catch (error) {
    console.error("Could not save Travel Kits on this device.", error);
    travelKitStatus.textContent = "Could not save Travel Kits on this device.";
    return false;
  }
}

function loadSavedTravelKitStore() {
  try {
    const saved = localStorage.getItem(travelKitStorageKey);
    if (!saved) return { activeId: null, trips: [] };
    const parsed = JSON.parse(saved);
    const store = validateTravelKitStore(parsed);
    if (!Array.isArray(parsed.trips)) {
      try {
        localStorage.setItem(travelKitStorageKey, JSON.stringify(store));
      } catch (error) {
        console.error("Could not migrate the saved Travel Kit.", error);
        travelKitLoadError = "Travel Kit loaded, but its updated format could not be saved.";
      }
    }
    return store;
  } catch (error) {
    console.error("Could not load saved Travel Kits.", error);
    travelKitLoadError = "Saved Travel Kits could not be loaded. Review the details and save again.";
    return { activeId: null, trips: [] };
  }
}

function selectTravelKit(id) {
  if (hasUnsavedTravelKitChanges() && !window.confirm("Discard your unsaved Travel Kit changes?")) {
    travelKitSelector.value = activeTravelKitId || "";
    return;
  }
  if (id) {
    const store = { ...travelKitStore, activeId: id };
    if (!persistTravelKitStore(store)) {
      travelKitSelector.value = activeTravelKitId || "";
      return;
    }
  }
  showTravelKit(id || null);
}

function createTravelKitId() {
  let id;
  do {
    id = globalThis.crypto?.randomUUID?.()
      || `trip-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  } while (travelKitStore.trips.some((trip) => trip.id === id));
  return id;
}

function getTravelQrText(kit) {
  return [
    kit.name,
    kit.destination,
    `Local time zone: ${kit.timeZone}`,
    `Currency: ${kit.homeCurrency} to ${kit.destinationCurrency}`,
    kit.qrNote
  ].filter(Boolean).join("\n");
}

function createSharedTripPayload(kit) {
  const checklistDone = (kit.checklist || []).filter((item) => item.done).length;
  const checklistTotal = (kit.checklist || []).length;
  const spent = (kit.budget?.expenses || []).reduce((sum, expense) => sum + expense.amount, 0);
  return {
    v: 1,
    n: kit.name,
    d: kit.destination,
    h: kit.homeCurrency,
    c: kit.destinationCurrency,
    z: kit.timeZone,
    s: kit.startDate || "",
    e: kit.endDate || "",
    q: kit.qrNote,
    cl: [checklistDone, checklistTotal],
    b: {
      limit: kit.budget?.limit || 0,
      currency: kit.budget?.currency || kit.homeCurrency,
      spent
    },
    i: (kit.itinerary || [])
      .slice()
      .sort((a, b) => a.dateTime.localeCompare(b.dateTime))
      .slice(0, 10)
      .map((event) => ({
        title: event.title,
        dateTime: event.dateTime,
        location: event.location
      }))
  };
}

function encodeSharedTrip(kit) {
  const bytes = new TextEncoder().encode(JSON.stringify(createSharedTripPayload(kit)));
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeSharedTrip(encoded) {
  if (!encoded || encoded.length > 12000) throw new Error("Shared trip is too large or invalid.");
  const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) throw new Error("Shared trip encoding is invalid.");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const payload = JSON.parse(new TextDecoder().decode(bytes));
  if (
    !payload
    || payload.v !== 1
    || typeof payload.n !== "string"
    || typeof payload.d !== "string"
    || typeof payload.z !== "string"
    || typeof payload.h !== "string"
    || typeof payload.c !== "string"
    || typeof payload.q !== "string"
    || !Array.isArray(payload.cl)
    || payload.cl.length !== 2
  ) throw new Error("Shared trip format is invalid.");
  if (payload.n.length > 50 || payload.d.length > 80) throw new Error("Shared trip is invalid.");
  if (payload.q.length > 500) throw new Error("Shared trip note is invalid.");
  payload.s = typeof payload.s === "string" ? payload.s : "";
  payload.e = typeof payload.e === "string" ? payload.e : "";
  if (
    (payload.s && !/^\d{4}-\d{2}-\d{2}$/.test(payload.s))
    || (payload.e && !/^\d{4}-\d{2}-\d{2}$/.test(payload.e))
    || (payload.s && payload.e && payload.e < payload.s)
  ) throw new Error("Shared trip dates are invalid.");
  if (
    payload.cl.some((count) => !Number.isInteger(count) || count < 0)
    || payload.cl[0] > payload.cl[1]
  ) throw new Error("Shared trip checklist is invalid.");
  if (
    !payload.b
    || typeof payload.b.currency !== "string"
    || !Number.isFinite(payload.b.limit)
    || payload.b.limit < 0
    || !Number.isFinite(payload.b.spent)
    || payload.b.spent < 0
  ) throw new Error("Shared trip budget is invalid.");
  if (!Array.isArray(payload.i) || payload.i.length > 10) throw new Error("Shared trip timeline is invalid.");
  payload.i.forEach((event) => {
    if (
      typeof event.title !== "string"
      || typeof event.dateTime !== "string"
      || typeof event.location !== "string"
      || event.title.length > 80
      || event.location.length > 100
      || Number.isNaN(new Date(event.dateTime).getTime())
    ) throw new Error("Shared trip timeline is invalid.");
  });
  return payload;
}

function getSharedTripUrl(kit) {
  const url = new URL(window.location.origin);
  url.pathname = "/";
  url.searchParams.set("trip", encodeSharedTrip(kit));
  return url.toString();
}

async function copyText(text) {
  if (!navigator.clipboard?.writeText) throw new Error("Clipboard access is unavailable.");
  await navigator.clipboard.writeText(text);
}

async function shareActiveTrip() {
  const kit = getActiveTravelKit();
  if (!kit || !travelKitFormMatchesSaved()) return;
  const url = getSharedTripUrl(kit);
  const shareData = {
    title: `Handy · ${kit.name}`,
    text: `Trip summary for ${kit.destination}`,
    url
  };
  if (typeof navigator.share === "function") {
    try {
      await navigator.share(shareData);
      travelShareStatus.textContent = "Trip summary shared.";
      return;
    } catch (error) {
      if (error.name === "AbortError") return;
      console.error("Could not share the Travel Kit.", error);
    }
  }
  try {
    await copyText(url);
    travelShareStatus.textContent = "Trip summary link copied.";
  } catch (error) {
    console.error("Could not copy the shared Travel Kit.", error);
    travelShareStatus.textContent = "Could not copy the link.";
  }
}

async function copyActiveTripLink() {
  const kit = getActiveTravelKit();
  if (!kit || !travelKitFormMatchesSaved()) return;
  try {
    await copyText(getSharedTripUrl(kit));
    travelShareStatus.textContent = "Trip summary link copied.";
  } catch (error) {
    console.error("Could not copy the shared Travel Kit.", error);
    travelShareStatus.textContent = "Could not copy the link.";
  }
}

async function createActiveTripQr() {
  const kit = getActiveTravelKit();
  if (!kit || !travelKitFormMatchesSaved()) return;
  await openLinkedTool("qr", "create", { qrText: getSharedTripUrl(kit) });
  travelShareStatus.textContent = "Share QR opened.";
}

function printActiveTrip() {
  const kit = getActiveTravelKit();
  if (!kit || !travelKitFormMatchesSaved()) return;

  document.querySelector("#printTripName").textContent = kit.name;
  document.querySelector("#printTripDestination").textContent = kit.destination;
  document.querySelector("#printTripTimeZone").textContent = kit.timeZone;
  document.querySelector("#printTripDates").textContent =
    kit.startDate && kit.endDate
      ? `${formatTripDate(kit.startDate)} – ${formatTripDate(kit.endDate)}`
      : kit.startDate
        ? `Starts ${formatTripDate(kit.startDate)}`
        : kit.endDate
          ? `Ends ${formatTripDate(kit.endDate)}`
          : "Not set";
  document.querySelector("#printTripCurrency").textContent =
    `${kit.homeCurrency} to ${kit.destinationCurrency}`;

  const budget = kit.budget || { limit: 0, currency: kit.homeCurrency, expenses: [] };
  const spent = budget.expenses.reduce((sum, expense) => sum + expense.amount, 0);
  const remaining = budget.limit - spent;
  document.querySelector("#printTripBudget").textContent =
    `${formatBudgetAmount(spent, budget.currency)} spent · ${formatBudgetAmount(remaining, budget.currency)} remaining`;

  const checklist = kit.checklist || [];
  const done = checklist.filter((item) => item.done).length;
  document.querySelector("#printTripChecklist").textContent =
    `${done} of ${checklist.length} complete`;
  const checklistList = document.querySelector("#printTripChecklistList");
  checklistList.replaceChildren();
  if (!checklist.length) {
    const empty = document.createElement("li");
    empty.textContent = "No checklist items";
    checklistList.append(empty);
  } else {
    checklist.forEach((item) => {
      const listItem = document.createElement("li");
      listItem.textContent = `${item.done ? "☑" : "☐"} ${item.text}`;
      checklistList.append(listItem);
    });
  }

  const timeline = document.querySelector("#printTripTimeline");
  timeline.replaceChildren();
  const events = (kit.itinerary || []).slice().sort((a, b) => a.dateTime.localeCompare(b.dateTime));
  if (!events.length) {
    const empty = document.createElement("li");
    empty.textContent = "No timeline events";
    timeline.append(empty);
  } else {
    events.forEach((event) => {
      const listItem = document.createElement("li");
      listItem.textContent =
        `${formatItineraryDateTime(event.dateTime)} — ${event.title}` +
        `${event.location ? ` · ${event.location}` : ""}` +
        `${event.notes ? ` · ${event.notes}` : ""}`;
      timeline.append(listItem);
    });
  }

  const noteSection = document.querySelector("#printTripNoteSection");
  if (kit.qrNote) {
    document.querySelector("#printTripNote").textContent = kit.qrNote;
    noteSection.hidden = false;
  } else {
    noteSection.hidden = true;
  }

  travelShareStatus.textContent = "Opening printable trip summary.";
  window.print();
}

function formatSharedBudget(payload) {
  const budget = payload.b;
  if (!budget || !budget.currency) return "Not set";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: budget.currency,
    maximumFractionDigits: 2
  }).format(Number.isFinite(budget.limit - budget.spent) ? budget.limit - budget.spent : 0);
}

function renderSharedTrip(payload) {
  document.querySelector("#sharedTripName").textContent = payload.n;
  document.querySelector("#sharedTripDestination").textContent = payload.d;
  const sharedDates =
    payload.s && payload.e
      ? `${formatTripDate(payload.s)} – ${formatTripDate(payload.e)}`
      : payload.s
        ? `Starts ${formatTripDate(payload.s)}`
        : payload.e
          ? `Ends ${formatTripDate(payload.e)}`
          : "Dates not set";
  document.querySelector("#sharedTripDates").textContent = sharedDates;
  document.querySelector("#sharedTripChecklist").textContent =
    `${payload.cl[0]} of ${payload.cl[1]} complete`;
  document.querySelector("#sharedTripBudget").textContent = formatSharedBudget(payload);
  document.querySelector("#sharedTripTimeZone").textContent = payload.z;
  const timeline = document.querySelector("#sharedTripTimeline");
  timeline.replaceChildren();
  if (!payload.i.length) {
    const empty = document.createElement("li");
    empty.textContent = "No timeline events shared.";
    timeline.append(empty);
  } else {
    payload.i.forEach((event) => {
      const item = document.createElement("li");
      item.textContent = `${formatItineraryDateTime(event.dateTime)} — ${event.title}${event.location ? ` · ${event.location}` : ""}`;
      timeline.append(item);
    });
  }
  document.querySelector("#sharedTripView").hidden = false;
  document.querySelector("#sharedTripView").scrollIntoView({ behavior: "smooth", block: "start" });
}

function openSharedTripFromLocation() {
  const encoded = new URL(window.location.href).searchParams.get("trip");
  if (!encoded) return;
  try {
    renderSharedTrip(decodeSharedTrip(encoded));
  } catch (error) {
    console.error("Could not read the shared Travel Kit.", error);
    document.querySelector("#sharedTripName").textContent = "Invalid shared trip";
    document.querySelector("#sharedTripDestination").textContent =
      "This link may be damaged or incomplete.";
    document.querySelector("#sharedTripChecklist").textContent = "Unavailable";
    document.querySelector("#sharedTripBudget").textContent = "Unavailable";
    document.querySelector("#sharedTripTimeZone").textContent = "Unavailable";
    document.querySelector("#sharedTripTimeline").replaceChildren();
    document.querySelector("#sharedTripView").hidden = false;
    document.querySelector("#sharedTripView").scrollIntoView({ behavior: "smooth", block: "start" });
    showToast("This shared trip link is invalid.");
  }
}

window.addEventListener("load", openSharedTripFromLocation);
window.addEventListener("popstate", openSharedTripFromLocation);

function createChecklistItem(text) {
  const normalized = text.trim();
  if (!normalized) return null;
  return {
    id: globalThis.crypto?.randomUUID?.()
      || `item-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    text: normalized,
    done: false
  };
}

function getActiveChecklist() {
  return getActiveTravelKit()?.checklist || [];
}

function persistActiveChecklist(checklist) {
  const activeTrip = getActiveTravelKit();
  if (!activeTrip) return false;
  const trips = travelKitStore.trips.map((trip) =>
    trip.id === activeTrip.id ? { ...trip, checklist } : trip
  );
  if (!persistTravelKitStore({ ...travelKitStore, trips })) return false;
  renderTravelChecklist();
  return true;
}

function renderTravelChecklist() {
  const activeTrip = getActiveTravelKit();
  const checklist = activeTrip?.checklist || [];
  const completeCount = checklist.filter((item) => item.done).length;
  travelChecklistProgress.textContent = `${completeCount} of ${checklist.length} complete`;
  travelChecklistList.replaceChildren();
  checklist.forEach((item) => {
    const listItem = document.createElement("li");
    listItem.className = `travel-checklist-item${item.done ? " completed" : ""}`;
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = item.done;
    const label = document.createElement("label");
    label.textContent = item.text;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "travel-checklist-remove";
    remove.setAttribute("aria-label", `Remove ${item.text}`);
    remove.textContent = "×";
    checkbox.addEventListener("change", (event) => {
      persistActiveChecklist(checklist.map((entry) =>
        entry.id === item.id ? { ...entry, done: event.target.checked } : entry
      ));
    });
    remove.addEventListener("click", () => {
      persistActiveChecklist(checklist.filter((entry) => entry.id !== item.id));
    });
    listItem.append(checkbox, label, remove);
    travelChecklistList.append(listItem);
  });
  const isReady = Boolean(activeTrip);
  resetTravelChecklistButton.disabled = !isReady || checklist.length === 0;
  travelChecklistItem.disabled = !isReady;
  addTravelChecklistItem.disabled = !isReady;
  travelChecklistTemplateButtons.forEach((button) => { button.disabled = !isReady; });
  if (isReady && checklist.length === 0) {
    travelChecklistStatus.textContent = "Checklist is empty. Add a template or custom item.";
  } else {
    travelChecklistStatus.textContent = isReady
      ? "Checklist changes save automatically."
      : "Save the trip before adding checklist items.";
  }
}

function addChecklistItems(items) {
  if (!getActiveTravelKit()) return;
  const checklist = getActiveChecklist();
  const existingTexts = new Set(checklist.map((item) => item.text.toLowerCase()));
  const additions = [];
  items.forEach((text) => {
    if (
      existingTexts.has(text.toLowerCase())
      || checklist.length + additions.length >= maximumChecklistItems
    ) return;
    const item = createChecklistItem(text);
    if (item) additions.push(item);
  });
  if (!additions.length) {
    travelChecklistStatus.textContent = "Those checklist items are already included or the limit was reached.";
    return;
  }
  persistActiveChecklist([...checklist, ...additions]);
  travelChecklistStatus.textContent = `Added ${additions.length} checklist item${additions.length === 1 ? "" : "s"}.`;
}

function getActiveItinerary() {
  return getActiveTravelKit()?.itinerary || [];
}

function persistActiveItinerary(itinerary) {
  const activeTrip = getActiveTravelKit();
  if (!activeTrip) return false;
  const trips = travelKitStore.trips.map((trip) =>
    trip.id === activeTrip.id ? { ...trip, itinerary } : trip
  );
  if (!persistTravelKitStore({ ...travelKitStore, trips })) return false;
  renderTravelItinerary();
  return true;
}

function formatItineraryDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function formatTripDate(value) {
  if (!value) return "";
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

function escapeIcsText(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function formatIcsLocalDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const pad = (number) => String(number).padStart(2, "0");
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `T${pad(date.getHours())}${pad(date.getMinutes())}00`
  );
}

function formatIcsUtcStamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function createIcsCalendar(kit, events) {
  const stamp = formatIcsUtcStamp();
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Handy//Travel Kit//EN",
    "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${escapeIcsText(kit.name)}`,
    `X-WR-TIMEZONE:${escapeIcsText(kit.timeZone)}`
  ];
  events.forEach((event) => {
    const start = formatIcsLocalDateTime(event.dateTime);
    if (!start) return;
    const startDate = new Date(event.dateTime);
    const endDate = new Date(startDate.getTime() + 60 * 60 * 1000);
    const end = formatIcsLocalDateTime(endDate);
    if (!end) return;
    const uid = `${String(event.id || start).replace(/[^A-Za-z0-9-]/g, "")}@handy.local`;
    const descriptionParts = [
      event.notes,
      kit.destination ? `Trip: ${kit.destination}` : ""
    ].filter(Boolean);
    lines.push(
      "BEGIN:VEVENT",
      `UID:${escapeIcsText(uid)}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;TZID=${escapeIcsText(kit.timeZone)}:${start}`,
      `DTEND;TZID=${escapeIcsText(kit.timeZone)}:${end}`,
      `SUMMARY:${escapeIcsText(event.title)}`,
      `LOCATION:${escapeIcsText(event.location)}`,
      `DESCRIPTION:${escapeIcsText(descriptionParts.join("\\n"))}`,
      "END:VEVENT"
    );
  });
  lines.push("END:VCALENDAR");
  return `${lines.join("\r\n")}\r\n`;
}

function downloadIcsCalendar(filename, kit, events) {
  const calendar = createIcsCalendar(kit, events);
  const blob = new Blob([calendar], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const download = document.createElement("a");
  download.href = url;
  download.download = filename;
  document.body.append(download);
  download.click();
  download.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function safeDownloadName(value) {
  return String(value || "handy-trip")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "handy-trip";
}

function escapeCsvValue(value) {
  let text = String(value ?? "");
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function createTravelExpenseCsv(kit, budget) {
  const spent = budget.expenses.reduce((sum, expense) => sum + expense.amount, 0);
  const rows = [
    ["Trip", "Destination", "Budget", "Budget currency", "Spent", "Expense", "Amount", "Category"],
    [
      kit.name,
      kit.destination,
      budget.limit,
      budget.currency,
      spent,
      "",
      "",
      ""
    ],
    ...budget.expenses.map((expense) => [
      "",
      "",
      "",
      "",
      "",
      expense.title,
      expense.amount,
      expense.category
    ])
  ];
  return `\ufeff${rows.map((row) => row.map(escapeCsvValue).join(",")).join("\r\n")}\r\n`;
}

function downloadTravelExpenseCsv(kit, budget) {
  const csv = createTravelExpenseCsv(kit, budget);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const download = document.createElement("a");
  download.href = url;
  download.download = `${safeDownloadName(kit.name)}-expenses.csv`;
  document.body.append(download);
  download.click();
  download.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function getTripDateDuration(startDate, endDate) {
  if (!startDate || !endDate) return "";
  const start = new Date(`${startDate}T12:00:00`);
  const end = new Date(`${endDate}T12:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return "";
  const days = Math.round((end - start) / 86400000) + 1;
  return `${days} day${days === 1 ? "" : "s"}`;
}

function updateTripDateSummary() {
  const startDate = document.querySelector("#travelKitStartDate").value;
  const endDate = document.querySelector("#travelKitEndDate").value;
  if (startDate && endDate && endDate < startDate) {
    travelDateSummary.textContent = "End date must be on or after the start date.";
    return;
  }
  if (startDate && endDate) {
    const duration = getTripDateDuration(startDate, endDate);
    travelDateSummary.textContent =
      `${formatTripDate(startDate)} – ${formatTripDate(endDate)} · ${duration}`;
  } else if (startDate) {
    travelDateSummary.textContent = `Starts ${formatTripDate(startDate)}.`;
  } else if (endDate) {
    travelDateSummary.textContent = `Ends ${formatTripDate(endDate)}.`;
  } else {
    travelDateSummary.textContent = "Add dates to define the trip range.";
  }
}

function renderTravelItinerary() {
  const activeTrip = getActiveTravelKit();
  const itinerary = getActiveItinerary()
    .slice()
    .sort((a, b) => a.dateTime.localeCompare(b.dateTime));
  travelTimeline.replaceChildren();
  if (activeTrip && itinerary.length === 0) {
    const empty = document.createElement("li");
    empty.className = "travel-timeline-empty";
    empty.textContent = "No timeline events yet. Add a flight, check-in, or activity.";
    travelTimeline.append(empty);
  }
  itinerary.forEach((event) => {
    const item = document.createElement("li");
    item.className = "travel-timeline-item";
    const copy = document.createElement("div");
    copy.className = "travel-timeline-copy";
    const title = document.createElement("strong");
    title.textContent = event.title;
    const dateTime = document.createElement("span");
    dateTime.textContent = formatItineraryDateTime(event.dateTime);
    copy.append(title, dateTime);
    if (event.location) {
      const location = document.createElement("p");
      location.textContent = `Location: ${event.location}`;
      copy.append(location);
    }
    if (event.notes) {
      const notes = document.createElement("p");
      notes.textContent = event.notes;
      copy.append(notes);
    }
    const actions = document.createElement("div");
    actions.className = "travel-timeline-actions";
    const calendarButton = document.createElement("button");
    calendarButton.type = "button";
    calendarButton.className = "travel-timeline-calendar";
    calendarButton.textContent = "Calendar";
    calendarButton.setAttribute("aria-label", `Add ${event.title} to calendar`);
    calendarButton.addEventListener("click", () => {
      const activeTrip = getActiveTravelKit();
      if (!activeTrip) return;
      downloadIcsCalendar(
        `${safeDownloadName(event.title)}.ics`,
        activeTrip,
        [event]
      );
      travelItineraryStatus.textContent = `Calendar file created for "${event.title}".`;
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "travel-timeline-remove";
    remove.setAttribute("aria-label", `Remove ${event.title}`);
    remove.textContent = "×";
    remove.addEventListener("click", () =>
      persistActiveItinerary(getActiveItinerary().filter((entry) => entry.id !== event.id))
    );
    actions.append(calendarButton, remove);
    item.append(copy, actions);
    travelTimeline.append(item);
  });
  const isReady = Boolean(activeTrip);
  [travelEventTitle, travelEventDateTime, travelEventLocation, travelEventNotes, addTravelEvent]
    .forEach((element) => { element.disabled = !isReady; });
  exportTravelCalendarButton.disabled = !isReady || itinerary.length === 0;
  if (!isReady) {
    travelItineraryStatus.textContent = "Save the trip before adding events.";
  } else {
    const now = Date.now();
    let outsideRange = 0;
    if (activeTrip.startDate || activeTrip.endDate) {
      outsideRange = itinerary.filter((event) => {
        const eventDate = new Date(event.dateTime);
        if (Number.isNaN(eventDate.getTime())) return false;
        if (activeTrip.startDate) {
          const start = new Date(`${activeTrip.startDate}T00:00:00`);
          if (eventDate < start) return true;
        }
        if (activeTrip.endDate) {
          const end = new Date(`${activeTrip.endDate}T23:59:59`);
          if (eventDate > end) return true;
        }
        return false;
      }).length;
    }
    const upcoming = itinerary
      .map((event) => ({ event, time: new Date(event.dateTime).getTime() }))
      .filter((entry) => Number.isFinite(entry.time) && entry.time >= now)
      .sort((a, b) => a.time - b.time)[0];
    let conflictCount = 0;
    for (let index = 1; index < itinerary.length; index += 1) {
      const previous = new Date(itinerary[index - 1].dateTime).getTime();
      const current = new Date(itinerary[index].dateTime).getTime();
      if (Number.isFinite(previous) && Number.isFinite(current) && Math.abs(current - previous) <= 30 * 60 * 1000) {
        conflictCount += 1;
      }
    }
    if (outsideRange) {
      travelItineraryStatus.textContent =
        `${itinerary.length} saved · ${outsideRange} outside trip dates · ` +
        (upcoming ? `Next: ${upcoming.event.title}` : "No upcoming events");
    } else if (conflictCount) {
      travelItineraryStatus.textContent =
        `${itinerary.length} saved · ${conflictCount} timing conflict${conflictCount === 1 ? "" : "s"} · ` +
        (upcoming ? `Next: ${upcoming.event.title}` : "No upcoming events");
    } else {
      travelItineraryStatus.textContent =
        `${itinerary.length} event${itinerary.length === 1 ? "" : "s"} saved · ` +
        (upcoming ? `Next: ${upcoming.event.title}` : "No upcoming events");
    }
  }
}

function addTravelTimelineEvent() {
  const activeTrip = getActiveTravelKit();
  if (!activeTrip) return;
  const title = travelEventTitle.value.trim();
  const dateTime = travelEventDateTime.value;
  if (!title) {
    travelItineraryStatus.textContent = "Enter an event title.";
    return;
  }
  if (!dateTime || Number.isNaN(new Date(dateTime).getTime())) {
    travelItineraryStatus.textContent = "Choose a valid date and time.";
    return;
  }
  const itinerary = getActiveItinerary();
  if (itinerary.length >= maximumItineraryEvents) {
    travelItineraryStatus.textContent = `You can save up to ${maximumItineraryEvents} timeline events.`;
    return;
  }
  const event = {
    id: globalThis.crypto?.randomUUID?.()
      || `event-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    title,
    dateTime,
    location: travelEventLocation.value.trim(),
    notes: travelEventNotes.value.trim()
  };
  if (!persistActiveItinerary([...itinerary, event])) return;
  travelEventTitle.value = "";
  travelEventDateTime.value = "";
  travelEventLocation.value = "";
  travelEventNotes.value = "";
  travelItineraryStatus.textContent = "Timeline event added.";
}

function getActiveBudget() {
  return getActiveTravelKit()?.budget || { limit: 0, currency: "USD", expenses: [] };
}

function formatBudgetAmount(amount, currency) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 2
  }).format(Number.isFinite(amount) ? amount : 0);
}

function persistActiveBudget(budget) {
  const activeTrip = getActiveTravelKit();
  if (!activeTrip) return false;
  const trips = travelKitStore.trips.map((trip) =>
    trip.id === activeTrip.id ? { ...trip, budget } : trip
  );
  if (!persistTravelKitStore({ ...travelKitStore, trips })) return false;
  renderTravelBudget();
  return true;
}

function renderTravelBudget() {
  const activeTrip = getActiveTravelKit();
  const budget = getActiveBudget();
  exportTravelExpensesButton.disabled = !activeTrip;
  travelBudgetLimit.value = budget.limit ? String(budget.limit) : "";
  travelBudgetCurrency.value = budget.currency;
  const spent = budget.expenses.reduce((sum, expense) => sum + expense.amount, 0);
  const remaining = budget.limit - spent;
  travelBudgetSpent.textContent = formatBudgetAmount(spent, budget.currency);
  travelBudgetRemaining.textContent = formatBudgetAmount(remaining, budget.currency);
  const usage = budget.limit > 0 ? Math.min(100, Math.max(0, (spent / budget.limit) * 100)) : 0;
  travelBudgetProgressBar.style.width = `${usage}%`;
  travelBudgetProgress.setAttribute("aria-valuenow", String(Math.round(usage)));
  travelBudgetProgress.classList.toggle("over-budget", spent > budget.limit && budget.limit > 0);
  travelExpenseList.replaceChildren();
  const categoryTotals = new Map();
  budget.expenses.forEach((expense) => {
    categoryTotals.set(expense.category, (categoryTotals.get(expense.category) || 0) + expense.amount);
  });
  const categoryLabels = {
    transport: "Transport",
    lodging: "Lodging",
    food: "Food",
    activities: "Activities",
    shopping: "Shopping",
    other: "Other"
  };
  travelExpenseCategoryList.replaceChildren();
  travelExpenseBreakdownEmpty.hidden = categoryTotals.size > 0;
  [...categoryTotals.entries()]
    .sort(([, amountA], [, amountB]) => amountB - amountA)
    .forEach(([category, amount]) => {
      const percentage = spent > 0 ? (amount / spent) * 100 : 0;
      const item = document.createElement("li");
      item.className = "travel-expense-category";
      item.dataset.category = category;
      const label = document.createElement("span");
      label.textContent = categoryLabels[category] || category;
      const bar = document.createElement("div");
      bar.className = "travel-expense-category-bar";
      bar.setAttribute("role", "progressbar");
      bar.setAttribute("aria-label", `${label.textContent} spending`);
      bar.setAttribute("aria-valuemin", "0");
      bar.setAttribute("aria-valuemax", "100");
      bar.setAttribute("aria-valuenow", String(Math.round(percentage)));
      const barFill = document.createElement("span");
      barFill.style.width = `${percentage}%`;
      bar.append(barFill);
      const total = document.createElement("strong");
      total.textContent = `${formatBudgetAmount(amount, budget.currency)} · ${Math.round(percentage)}%`;
      item.append(label, bar, total);
      travelExpenseCategoryList.append(item);
    });
  if (activeTrip && budget.expenses.length === 0) {
    const empty = document.createElement("li");
    empty.className = "travel-expense-empty";
    empty.textContent = "No expenses yet. Add one when you spend.";
    travelExpenseList.append(empty);
  }
  budget.expenses.forEach((expense) => {
    const item = document.createElement("li");
    item.className = "travel-expense-item";
    const copy = document.createElement("div");
    copy.className = "travel-expense-copy";
    const title = document.createElement("strong");
    title.textContent = expense.title;
    const category = document.createElement("span");
    category.textContent = expense.category;
    copy.append(title, category);
    const amount = document.createElement("strong");
    amount.className = "travel-expense-amount";
    amount.textContent = formatBudgetAmount(expense.amount, budget.currency);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "travel-expense-remove";
    remove.setAttribute("aria-label", `Remove ${expense.title}`);
    remove.textContent = "×";
    remove.addEventListener("click", () =>
      persistActiveBudget({
        ...budget,
        expenses: budget.expenses.filter((entry) => entry.id !== expense.id)
      })
    );
    item.append(copy, amount, remove);
    travelExpenseList.append(item);
  });
  const isReady = Boolean(activeTrip);
  [
    travelBudgetLimit,
    travelBudgetCurrency,
    travelExpenseTitle,
    travelExpenseAmount,
    travelExpenseCategory,
    addTravelExpense
  ].forEach((element) => { element.disabled = !isReady; });
  travelBudgetStatus.textContent = isReady
    ? `${budget.expenses.length} expense${budget.expenses.length === 1 ? "" : "s"} saved`
    : "Save the trip before tracking expenses.";
}

travelBudgetLimit.addEventListener("change", () => {
  const budget = getActiveBudget();
  const limit = Number(travelBudgetLimit.value);
  if (!Number.isFinite(limit) || limit < 0) {
    travelBudgetStatus.textContent = "Enter a valid budget.";
    return;
  }
  persistActiveBudget({ ...budget, limit });
});

travelBudgetCurrency.addEventListener("change", () => {
  persistActiveBudget({ ...getActiveBudget(), currency: travelBudgetCurrency.value });
});

function addTravelBudgetExpense() {
  const activeTrip = getActiveTravelKit();
  if (!activeTrip) return;
  const title = travelExpenseTitle.value.trim();
  const amount = Number(travelExpenseAmount.value);
  if (!title) {
    travelBudgetStatus.textContent = "Enter an expense title.";
    return;
  }
  if (!Number.isFinite(amount) || amount < 0) {
    travelBudgetStatus.textContent = "Enter a valid expense amount.";
    return;
  }
  const budget = getActiveBudget();
  if (budget.expenses.length >= maximumBudgetExpenses) {
    travelBudgetStatus.textContent = `You can save up to ${maximumBudgetExpenses} expenses.`;
    return;
  }
  const expense = {
    id: globalThis.crypto?.randomUUID?.()
      || `expense-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    title,
    amount,
    category: travelExpenseCategory.value
  };
  if (!persistActiveBudget({ ...budget, expenses: [...budget.expenses, expense] })) return;
  travelExpenseTitle.value = "";
  travelExpenseAmount.value = "";
  travelBudgetStatus.textContent = "Expense added.";
}

travelKitForm.addEventListener("submit", (event) => {
  event.preventDefault();
  let trip;
  try {
    trip = validateTravelKit(getTravelKitFormValues());
  } catch (error) {
    travelKitStatus.textContent = error.message;
    return;
  }
  const existingTrip = getActiveTravelKit();
  if (!existingTrip && travelKitStore.trips.length >= maximumTravelKits) {
    travelKitStatus.textContent = `You can save up to ${maximumTravelKits} trips. Delete one to add another.`;
    return;
  }
  const id = existingTrip?.id || createTravelKitId();
  const savedTrip = {
    id,
    ...trip,
    checklist: existingTrip?.checklist || (
      activeTravelPlanningSuggestion
        ? travelChecklistTemplates.essentials
          .map((item) => createChecklistItem(item))
          .filter(Boolean)
        : []
    ),
    itinerary: existingTrip?.itinerary || [],
    budget: existingTrip?.budget || {
      limit: 0,
      currency: trip.destinationCurrency || trip.homeCurrency || "USD",
      expenses: []
    }
  };
  const trips = existingTrip
    ? travelKitStore.trips.map((item) => item.id === id ? savedTrip : item)
    : [...travelKitStore.trips, savedTrip];
  if (!persistTravelKitStore({ activeId: id, trips })) return;
  activeTravelKitId = id;
  travelKitDraftDirty = false;
  renderTravelKitSelector();
  setTravelKitFormValues(savedTrip);
  renderTravelChecklist();
  renderTravelItinerary();
  renderTravelBudget();
  updateTravelKitActions();
});

function handleTravelKitFormChange() {
  if (!getActiveTravelKit()) travelKitDraftDirty = true;
  updateTravelKitActions();
}

travelKitForm.addEventListener("input", handleTravelKitFormChange);
travelKitForm.addEventListener("change", handleTravelKitFormChange);
document.querySelector("#travelKitDestination").addEventListener("input", updateTravelPlanningSuggestion);
document.querySelector("#travelKitHomeCurrency").addEventListener("change", updateTravelPlanningSuggestion);
document.querySelector("#travelKitDestinationCurrency").addEventListener("change", updateTravelPlanningSuggestion);
document.querySelector("#travelKitStartDate").addEventListener("change", () => {
  updateTripDateSummary();
  handleTravelKitFormChange();
});
document.querySelector("#travelKitEndDate").addEventListener("change", () => {
  updateTripDateSummary();
  handleTravelKitFormChange();
});
travelKitSelector.addEventListener("change", () => selectTravelKit(travelKitSelector.value));
travelChecklistTemplateButtons.forEach((button) => {
  button.addEventListener("click", () => {
    addChecklistItems(travelChecklistTemplates[button.dataset.checklistTemplate] || []);
  });
});
addTravelChecklistItem.addEventListener("click", () => {
  const item = travelChecklistItem.value;
  travelChecklistItem.value = "";
  addChecklistItems([item]);
});
travelChecklistItem.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  addTravelChecklistItem.click();
});
addTravelEvent.addEventListener("click", addTravelTimelineEvent);
travelEventTitle.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    addTravelTimelineEvent();
  }
});
exportTravelCalendarButton.addEventListener("click", () => {
  const kit = getActiveTravelKit();
  if (!kit || !getActiveItinerary().length) return;
  downloadIcsCalendar(
    `${safeDownloadName(kit.name)}-itinerary.ics`,
    kit,
    getActiveItinerary()
  );
  travelItineraryStatus.textContent = "Trip calendar downloaded.";
});
exportTravelExpensesButton.addEventListener("click", () => {
  const kit = getActiveTravelKit();
  if (!kit) return;
  downloadTravelExpenseCsv(kit, getActiveBudget());
  travelBudgetStatus.textContent = "Expense CSV downloaded.";
});
addTravelExpense.addEventListener("click", addTravelBudgetExpense);
travelExpenseTitle.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    addTravelBudgetExpense();
  }
});
mobileTravelSave.addEventListener("click", () => travelKitForm.requestSubmit());
newTravelKitButton.addEventListener("click", () => {
  if (hasUnsavedTravelKitChanges() && !window.confirm("Discard your unsaved Travel Kit changes?")) return;
  showTravelKit(null);
});
startFirstTravelKit.addEventListener("click", () => {
  travelKitEmpty.hidden = true;
  travelKitForm.querySelector("#travelKitName").focus();
});
duplicateTravelKitButton.addEventListener("click", () => {
  const activeTrip = getActiveTravelKit();
  if (!activeTrip) return;
  if (travelKitStore.trips.length >= maximumTravelKits) {
    travelKitStatus.textContent = `You can save up to ${maximumTravelKits} trips.`;
    return;
  }
  if (travelKitFormMatchesSaved() === false) {
    travelKitStatus.textContent = "Save your changes before duplicating this trip.";
    return;
  }
  const id = createTravelKitId();
  const copy = {
    ...activeTrip,
    id,
    name: `${activeTrip.name} copy`.slice(0, 50),
    checklist: (activeTrip.checklist || []).map((item) => ({ ...item, done: false })),
    itinerary: (activeTrip.itinerary || []).map((event) => ({ ...event, id: createChecklistItem(event.title)?.id || event.id })),
    budget: {
      ...activeTrip.budget,
      expenses: (activeTrip.budget?.expenses || []).map((expense) => ({ ...expense }))
    }
  };
  const trips = [...travelKitStore.trips, copy];
  if (!persistTravelKitStore({ activeId: id, trips })) return;
  showTravelKit(id);
  travelKitStatus.textContent = `Duplicated as "${copy.name}".`;
});
resetTravelChecklistButton.addEventListener("click", () => {
  const checklist = getActiveChecklist();
  if (!checklist.length) return;
  if (!window.confirm("Reset all checklist items to incomplete?")) return;
  persistActiveChecklist(checklist.map((item) => ({ ...item, done: false })));
});
deleteTravelKitButton.addEventListener("click", () => {
  const activeTrip = getActiveTravelKit();
  if (!activeTrip) return;
  const message = hasUnsavedTravelKitChanges()
    ? `Delete "${activeTrip.name}" and discard your unsaved changes?`
    : `Delete "${activeTrip.name}"?`;
  if (!window.confirm(message)) return;
  const trips = travelKitStore.trips.filter((trip) => trip.id !== activeTrip.id);
  const nextId = trips[0]?.id || null;
  if (!persistTravelKitStore({ activeId: nextId, trips })) return;
  showTravelKit(nextId);
  travelKitStatus.textContent = `Deleted "${activeTrip.name}".`;
});

travelKitActionButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    if (!travelKitFormMatchesSaved()) return;
    const kit = getActiveTravelKit();
    const action = button.dataset.travelAction;
    const actions = {
      currency: ["currency", undefined, {
        from: kit.homeCurrency,
        to: kit.destinationCurrency,
        amount: "100"
      }],
      clock: ["world-clock", undefined, { timeZone: kit.timeZone }],
      units: ["unit-converter", undefined, {
        category: "length",
        from: "kilometer",
        to: "mile",
        value: "1"
      }],
      qr: ["qr", "create", { qrText: getTravelQrText(kit) }]
    };
    const selectedAction = actions[action];
    if (!selectedAction) return;
    const opened = await openLinkedTool(...selectedAction);
    if (opened) travelKitStatus.textContent = `Opened ${button.textContent.toLowerCase()} using "${kit.name}".`;
  });
});

copySharedTripButton.addEventListener("click", copyActiveTripLink);
shareSharedTripButton.addEventListener("click", shareActiveTrip);
qrSharedTripButton.addEventListener("click", createActiveTripQr);
printSharedTripButton.addEventListener("click", printActiveTrip);
document.querySelector("#closeSharedTrip").addEventListener("click", () => {
  const url = new URL(window.location.href);
  url.searchParams.delete("trip");
  window.history.replaceState(window.history.state, "", url);
  document.querySelector("#sharedTripView").hidden = true;
  document.querySelector("#travelKit").scrollIntoView({ behavior: "smooth", block: "start" });
});

travelKitStore = loadSavedTravelKitStore();
activeTravelKitId = travelKitStore.activeId;
renderTravelKitSelector();
if (activeTravelKitId) {
  const activeTrip = getActiveTravelKit();
  if (activeTrip) setTravelKitFormValues(activeTrip);
}
updateTravelPlanningSuggestion();
updateTripDateSummary();
renderTravelChecklist();
renderTravelItinerary();
renderTravelBudget();
updateTravelKitActions();
if (!travelKitStatus.textContent) {
  travelKitStatus.textContent = travelKitStore.trips.length
    ? "Select a saved trip or start a new one."
    : "Save a trip to keep its details on this device.";
}

function isBackupRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateTravelKit(value) {
  const currencyCodes = new Set(["USD", "EUR", "GBP", "JPY", "AUD", "CAD", "CHF", "CNY", "INR", "SGD", "AED", "NZD"]);
  const timeZones = new Set([
    "Asia/Tokyo",
    "Asia/Singapore",
    "Asia/Dubai",
    "Asia/Kolkata",
    "Europe/London",
    "Europe/Paris",
    "America/New_York",
    "America/Los_Angeles",
    "Australia/Sydney",
    "Pacific/Auckland",
    "Africa/Johannesburg",
    "America/Sao_Paulo"
  ]);
  if (!isBackupRecord(value)) throw new Error("Travel Kit settings are invalid.");
  if (typeof value.name !== "string" || !value.name.trim() || value.name.trim().length > 50) {
    throw new Error("Enter a kit name up to 50 characters.");
  }
  if (
    typeof value.destination !== "string"
    || !value.destination.trim()
    || value.destination.trim().length > 80
  ) throw new Error("Enter a destination up to 80 characters.");
  if (!currencyCodes.has(value.homeCurrency) || !currencyCodes.has(value.destinationCurrency)) {
    throw new Error("Choose supported currencies for your Travel Kit.");
  }
  if (!timeZones.has(value.timeZone)) throw new Error("Choose a supported destination time zone.");
  const startDate = value.startDate ?? "";
  const endDate = value.endDate ?? "";
  if (typeof startDate !== "string" || typeof endDate !== "string") {
    throw new Error("Trip dates are invalid.");
  }
  if (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    throw new Error("Trip start date is invalid.");
  }
  if (endDate && !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    throw new Error("Trip end date is invalid.");
  }
  if (startDate && endDate && endDate < startDate) {
    throw new Error("Trip end date cannot be before the start date.");
  }
  const qrNote = value.qrNote ?? "";
  if (typeof qrNote !== "string" || qrNote.length > 500) {
    throw new Error("Keep the QR note under 500 characters.");
  }
  return {
    name: value.name.trim(),
    destination: value.destination.trim(),
    homeCurrency: value.homeCurrency,
    destinationCurrency: value.destinationCurrency,
    timeZone: value.timeZone,
    startDate,
    endDate,
    qrNote: qrNote.trim()
  };
}

function validateTravelChecklist(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maximumChecklistItems) {
    throw new Error("Travel checklist data is invalid.");
  }
  const ids = new Set();
  return value.map((item) => {
    if (
      !isBackupRecord(item)
      || typeof item.id !== "string"
      || !item.id
      || item.id.length > 80
      || typeof item.text !== "string"
      || !item.text.trim()
      || item.text.trim().length > 80
      || typeof item.done !== "boolean"
    ) throw new Error("A travel checklist item is invalid.");
    if (ids.has(item.id)) throw new Error("Travel checklist item IDs must be unique.");
    ids.add(item.id);
    return { id: item.id, text: item.text.trim(), done: item.done };
  });
}

function validateTravelItinerary(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maximumItineraryEvents) {
    throw new Error("Trip timeline data is invalid.");
  }
  const ids = new Set();
  return value.map((event) => {
    if (
      !isBackupRecord(event)
      || typeof event.id !== "string"
      || !event.id
      || event.id.length > 80
      || typeof event.title !== "string"
      || !event.title.trim()
      || event.title.trim().length > 80
      || typeof event.dateTime !== "string"
      || Number.isNaN(new Date(event.dateTime).getTime())
      || typeof event.location !== "string"
      || event.location.length > 100
      || typeof event.notes !== "string"
      || event.notes.length > 200
    ) throw new Error("A trip timeline event is invalid.");
    if (ids.has(event.id)) throw new Error("Trip timeline event IDs must be unique.");
    ids.add(event.id);
    return {
      id: event.id,
      title: event.title.trim(),
      dateTime: event.dateTime,
      location: event.location.trim(),
      notes: event.notes.trim()
    };
  });
}

function validateTravelBudget(value) {
  const currencyCodes = new Set(["USD", "EUR", "GBP", "JPY", "AUD", "CAD", "CHF", "CNY", "INR", "SGD", "AED", "NZD"]);
  const categories = new Set(["transport", "lodging", "food", "activities", "shopping", "other"]);
  if (value === undefined) return { limit: 0, currency: "USD", expenses: [] };
  if (!isBackupRecord(value) || !Number.isFinite(value.limit) || value.limit < 0 || value.limit > 100000000) {
    throw new Error("Trip budget limit is invalid.");
  }
  if (!currencyCodes.has(value.currency) || !Array.isArray(value.expenses) || value.expenses.length > maximumBudgetExpenses) {
    throw new Error("Trip budget data is invalid.");
  }
  const ids = new Set();
  const expenses = value.expenses.map((expense) => {
    if (
      !isBackupRecord(expense)
      || typeof expense.id !== "string"
      || !expense.id
      || expense.id.length > 80
      || typeof expense.title !== "string"
      || !expense.title.trim()
      || expense.title.trim().length > 80
      || !Number.isFinite(expense.amount)
      || expense.amount < 0
      || expense.amount > 100000000
      || !categories.has(expense.category)
    ) throw new Error("A trip expense is invalid.");
    if (ids.has(expense.id)) throw new Error("Trip expense IDs must be unique.");
    ids.add(expense.id);
    return {
      id: expense.id,
      title: expense.title.trim(),
      amount: expense.amount,
      category: expense.category
    };
  });
  return { limit: value.limit, currency: value.currency, expenses };
}

function validateTravelKitStore(value) {
  if (!isBackupRecord(value)) throw new Error("Travel Kits are missing or invalid.");
  if (!Array.isArray(value.trips)) {
    const legacyId = "legacy-travel-kit";
    return {
      activeId: legacyId,
      trips: [{
        id: legacyId,
        ...validateTravelKit(value),
        checklist: [],
        itinerary: [],
        budget: { limit: 0, currency: "USD", expenses: [] }
      }]
    };
  }
  if (value.trips.length > maximumTravelKits) {
    throw new Error(`Travel Kits can contain up to ${maximumTravelKits} trips.`);
  }
  const trips = value.trips.map((trip) => {
    if (!isBackupRecord(trip) || typeof trip.id !== "string" || !trip.id || trip.id.length > 80) {
      throw new Error("A saved Travel Kit has an invalid ID.");
    }
    return {
      id: trip.id,
      ...validateTravelKit(trip),
      checklist: validateTravelChecklist(trip.checklist),
      itinerary: validateTravelItinerary(trip.itinerary),
      budget: validateTravelBudget(trip.budget)
    };
  });
  const ids = new Set(trips.map((trip) => trip.id));
  if (ids.size !== trips.length) throw new Error("Travel Kits must have unique IDs.");
  const activeId = value.activeId ?? null;
  if (activeId !== null && (typeof activeId !== "string" || !ids.has(activeId))) {
    throw new Error("The selected Travel Kit is invalid.");
  }
  return { activeId, trips };
}

function validateBackupData(data) {
  if (!isBackupRecord(data)) throw new Error("Backup settings are missing or invalid.");
  if (Object.keys(data).some((key) => !backupKeys.includes(key))) {
    throw new Error("This backup contains unsupported settings.");
  }

  const toolNames = new Set(toolCards.map((card) => card.querySelector("h3").textContent));
  const currencyCodes = new Set(["USD", "EUR", "GBP", "JPY", "AUD", "CAD", "CHF", "CNY", "INR", "SGD", "AED", "NZD"]);
  const converterUnits = {
    length: new Set(["meter", "kilometer", "centimeter", "mile", "foot", "inch"]),
    weight: new Set(["kilogram", "gram", "pound", "ounce"]),
    temperature: new Set(["celsius", "fahrenheit", "kelvin"]),
    area: new Set(["squareMeter", "squareKilometer", "squareFoot", "acre"])
  };
  const validated = {};

  for (const [key, value] of Object.entries(data)) {
    if (key === favoritesKey || key === recentKey) {
      const maximum = key === favoritesKey ? toolNames.size : 4;
      if (
        !Array.isArray(value)
        || value.length > maximum
        || value.some((name) => typeof name !== "string" || !toolNames.has(name))
        || new Set(value).size !== value.length
      ) throw new Error("Backup favorites or recent tools are invalid.");
      validated[key] = [...value];
    } else if (key === "handy-theme") {
      if (value !== "light" && value !== "dark") throw new Error("Backup theme is invalid.");
      validated[key] = value;
    } else if (key === toolLayoutKey) {
      if (
        !isBackupRecord(value)
        || !Array.isArray(value.order)
        || !Array.isArray(value.hidden)
        || value.order.length > customizableToolNames.length
        || value.hidden.length > customizableToolNames.length
        || value.order.some((name) => !toolLayoutKeySet.has(name))
        || value.hidden.some((name) => !toolLayoutKeySet.has(name))
        || new Set(value.order).size !== value.order.length
        || new Set(value.hidden).size !== value.hidden.length
      ) throw new Error("Backup tool layout is invalid.");
      validated[key] = { order: [...value.order], hidden: [...value.hidden] };
    } else if (key === toolUsageKey) {
      if (!isBackupRecord(value)) throw new Error("Backup tool usage is invalid.");
      const usage = {};
      for (const [name, count] of Object.entries(value)) {
        if (!toolLayoutKeySet.has(name) || !Number.isInteger(count) || count < 0 || count > 100000) {
          throw new Error("Backup tool usage is invalid.");
        }
        usage[name] = count;
      }
      validated[key] = usage;
    } else if (key === personalizationPresetKey) {
      if (value !== "work" && value !== "travel" && value !== "study") {
        throw new Error("Backup personalization preset is invalid.");
      }
      validated[key] = value;
    } else if (key === "handy-currency-pair") {
      if (
        !isBackupRecord(value)
        || !currencyCodes.has(value.from)
        || !currencyCodes.has(value.to)
        || (typeof value.amount !== "string" && typeof value.amount !== "number")
        || String(value.amount).length > 64
        || (String(value.amount).trim() !== "" && (!Number.isFinite(Number(value.amount)) || Number(value.amount) < 0))
      ) throw new Error("Backup currency preferences are invalid.");
      validated[key] = { from: value.from, to: value.to, amount: String(value.amount) };
    } else if (key === "handy-currency-live-rates") {
      if (
        !isBackupRecord(value)
        || typeof value.updatedAt !== "string"
        || !Number.isFinite(Date.parse(value.updatedAt))
        || !isBackupRecord(value.rates)
        || [...currencyCodes].some((code) => !Number.isFinite(value.rates[code]) || value.rates[code] <= 0)
      ) throw new Error("Backup currency rates are invalid.");
      validated[key] = { rates: { ...value.rates, USD: 1 }, updatedAt: value.updatedAt };
    } else if (key === "handy-world-clock") {
      if (!Array.isArray(value) || value.length < 1 || value.length > 12) {
        throw new Error("Backup world clock preferences are invalid.");
      }
      try {
        value.forEach((timeZone) => new Intl.DateTimeFormat("en-US", { timeZone }));
      } catch {
        throw new Error("Backup contains an invalid world clock time zone.");
      }
      validated[key] = [...value];
    } else if (key === "handy-unit-converter") {
      if (
        !isBackupRecord(value)
        || !Object.hasOwn(converterUnits, value.category)
        || !converterUnits[value.category].has(value.from)
        || !converterUnits[value.category].has(value.to)
        || (typeof value.value !== "string" && typeof value.value !== "number")
        || String(value.value).length > 64
        || (String(value.value).trim() !== "" && !Number.isFinite(Number(value.value)))
      ) throw new Error("Backup unit converter preferences are invalid.");
      validated[key] = {
        category: value.category,
        from: value.from,
        to: value.to,
        value: String(value.value)
      };
    } else if (key === "handy-timer-duration") {
      if (
        !isBackupRecord(value)
        || !Number.isFinite(value.minutes)
        || value.minutes < 0
        || value.minutes > 999
        || !Number.isFinite(value.seconds)
        || value.seconds < 0
        || value.seconds > 59
      ) throw new Error("Backup timer settings are invalid.");
      validated[key] = { minutes: value.minutes, seconds: value.seconds };
    } else if (key === travelKitStorageKey) {
      validated[key] = validateTravelKitStore(value);
    }
  }

  return validated;
}

function readSettingsBackupData() {
  const data = {};
  for (const key of backupKeys) {
    const stored = localStorage.getItem(key);
    if (stored === null) continue;
    data[key] = key === "handy-theme" ? stored : JSON.parse(stored);
  }
  return validateBackupData(data);
}

function restoreSettingsBackup(data) {
  const previous = new Map(backupKeys.map((key) => [key, localStorage.getItem(key)]));
  try {
    backupKeys.forEach((key) => localStorage.removeItem(key));
    Object.entries(data).forEach(([key, value]) => {
      localStorage.setItem(key, key === "handy-theme" ? value : JSON.stringify(value));
    });
  } catch (error) {
    for (const [key, value] of previous) {
      try {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      } catch (restoreError) {
        console.error(`Could not restore the previous ${key} setting.`, restoreError);
      }
    }
    throw error;
  }
}

exportSettingsBackupButton.addEventListener("click", () => {
  try {
    const backup = {
      format: backupFormat,
      version: 1,
      exportedAt: new Date().toISOString(),
      data: readSettingsBackupData()
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const download = document.createElement("a");
    download.href = url;
    download.download = `handy-backup-${backup.exportedAt.slice(0, 10)}.json`;
    document.body.append(download);
    download.click();
    download.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    backupStatus.textContent = "Backup downloaded. Calculator history and QR text were not included.";
    showToast("Handy backup downloaded.");
  } catch (error) {
    console.error("Could not create the Handy settings backup.", error);
    backupStatus.textContent = "Backup could not be created. Check your saved settings and try again.";
  }
});

importSettingsBackupButton.addEventListener("click", () => settingsBackupFile.click());

settingsBackupFile.addEventListener("change", async () => {
  const file = settingsBackupFile.files[0];
  settingsBackupFile.value = "";
  if (!file) return;

  try {
    if (file.size > 1024 * 1024) throw new Error("Backup file is too large.");
    let backup;
    try {
      backup = JSON.parse(await file.text());
    } catch {
      throw new Error("Backup file is not valid JSON.");
    }
    if (
      !isBackupRecord(backup)
      || backup.format !== backupFormat
      || backup.version !== 1
      || typeof backup.exportedAt !== "string"
      || !Number.isFinite(Date.parse(backup.exportedAt))
    ) throw new Error("This is not a supported Handy backup.");
    const data = validateBackupData(backup.data);
    if (!window.confirm("Restore these favorites and preferences? Calculator history and QR text will remain unchanged.")) {
      backupStatus.textContent = "Restore canceled.";
      return;
    }
    restoreSettingsBackup(data);
    backupStatus.textContent = "Backup restored. Reloading to apply your settings…";
    showToast("Backup restored.");
    setTimeout(() => window.location.reload(), 500);
  } catch (error) {
    backupStatus.textContent = error instanceof Error ? error.message : "Backup could not be restored.";
  }
});

const clearLocalDataButton = document.querySelector("#clearLocalData");
const privacyStatus = document.querySelector("#privacyStatus");
const feedbackCategory = document.querySelector("#feedbackCategory");
const feedbackDetails = document.querySelector("#feedbackDetails");
const saveFeedbackButton = document.querySelector("#saveFeedback");
const exportFeedbackButton = document.querySelector("#exportFeedback");
const openFeedbackIssueButton = document.querySelector("#openFeedbackIssue");
const feedbackStatus = document.querySelector("#feedbackStatus");

clearLocalDataButton.addEventListener("click", () => {
  if (!window.confirm("Clear all Handy preferences, favorites, history, and cached tool data stored in this browser?")) {
    privacyStatus.textContent = "Local data was not cleared.";
    return;
  }

  try {
    const handyKeys = [
      ...backupKeys,
      "handy-calculator-history",
      "handy-qr-settings",
      recentSearchesKey,
      personalizationPresetKey,
      feedbackDraftKey
    ];
    handyKeys.forEach((key) => localStorage.removeItem(key));
    privacyStatus.textContent = "Handy local data cleared. Reloading…";
    showToast("Handy local data cleared.");
    setTimeout(() => window.location.reload(), 500);
  } catch (error) {
    console.error("Could not clear Handy local data.", error);
    privacyStatus.textContent = "Local data could not be cleared. Please check browser storage settings.";
  }
});

function readFeedbackDraft() {
  try {
    const draft = JSON.parse(localStorage.getItem(feedbackDraftKey) || "null");
    if (!draft || typeof draft !== "object") return null;
    if (!["bug", "feature", "accessibility", "praise"].includes(draft.category)) return null;
    if (typeof draft.details !== "string") return null;
    return draft;
  } catch {
    return null;
  }
}

function getFeedbackText() {
  return [
    "Handy feedback",
    `Category: ${feedbackCategory.value}`,
    "",
    feedbackDetails.value.trim() || "(No details provided)"
  ].join("\n");
}

const savedFeedback = readFeedbackDraft();
if (savedFeedback) {
  feedbackCategory.value = savedFeedback.category;
  feedbackDetails.value = savedFeedback.details;
  feedbackStatus.textContent = "Feedback draft restored.";
}

saveFeedbackButton.addEventListener("click", () => {
  try {
    localStorage.setItem(feedbackDraftKey, JSON.stringify({
      category: feedbackCategory.value,
      details: feedbackDetails.value.slice(0, 2000)
    }));
    feedbackStatus.textContent = "Feedback draft saved on this device.";
  } catch (error) {
    console.error("Could not save the feedback draft.", error);
    feedbackStatus.textContent = "The feedback draft could not be saved.";
  }
});

exportFeedbackButton.addEventListener("click", () => {
  const blob = new Blob([getFeedbackText()], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const download = document.createElement("a");
  download.href = url;
  download.download = "handy-feedback.txt";
  document.body.append(download);
  download.click();
  download.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  feedbackStatus.textContent = "Feedback text exported.";
});

openFeedbackIssueButton.addEventListener("click", () => {
  const title = encodeURIComponent(`Handy feedback: ${feedbackCategory.value}`);
  const body = encodeURIComponent(getFeedbackText());
  window.open(
    `https://github.com/Reynaldsapico123/Handy/issues/new?title=${title}&body=${body}`,
    "_blank",
    "noopener,noreferrer"
  );
  feedbackStatus.textContent = "GitHub issue form opened. Nothing was sent automatically.";
});

const diagnosticConnection = document.querySelector("#diagnosticConnection");
const diagnosticMode = document.querySelector("#diagnosticMode");
const diagnosticWorker = document.querySelector("#diagnosticWorker");
const diagnosticCache = document.querySelector("#diagnosticCache");
const diagnosticCacheVersion = document.querySelector("#diagnosticCacheVersion");
const diagnosticVersion = document.querySelector("#diagnosticVersion");
const diagnosticBuild = document.querySelector("#diagnosticBuild");
const diagnosticProduction = document.querySelector("#diagnosticProduction");
const diagnosticUpdateHistory = document.querySelector("#diagnosticUpdateHistory");
const diagnosticsStatus = document.querySelector("#diagnosticsStatus");
const offlineRecoveryStatus = document.querySelector("#offlineRecoveryStatus");
const refreshDiagnosticsButton = document.querySelector("#refreshDiagnostics");
const copyDiagnosticsButton = document.querySelector("#copyDiagnostics");
const clearUpdateHistoryButton = document.querySelector("#clearUpdateHistory");

async function refreshDiagnostics() {
  diagnosticVersion.textContent =
    document.querySelector('meta[name="handy-version"]')?.content || "Unknown";
  diagnosticBuild.textContent =
    document.querySelector('meta[name="handy-build"]')?.content || "Unknown";
  diagnosticProduction.textContent =
    document.querySelector('meta[name="handy-production-url"]')?.content || "Unknown";
  let updateHistory = [];
  try {
    const saved = JSON.parse(localStorage.getItem(updateHistoryKey) || "[]");
    updateHistory = Array.isArray(saved) ? saved.slice(0, 5) : [];
  } catch {
    updateHistory = [];
  }
  diagnosticUpdateHistory.textContent = updateHistory.length
    ? updateHistory.map((entry) => `${entry.build} · ${entry.at}`).join("; ")
    : "No updates recorded";
  diagnosticConnection.textContent = navigator.onLine ? "Online" : "Offline";
  diagnosticMode.textContent = isInstalledApp()
    ? "Installed PWA"
    : window.matchMedia("(display-mode: browser)").matches
      ? "Browser"
      : "Standard web";

  if (!("serviceWorker" in navigator)) {
    diagnosticWorker.textContent = "Unavailable";
  } else {
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      diagnosticWorker.textContent = navigator.serviceWorker.controller
        ? registration?.active
          ? "Active and controlling"
          : "Controlling"
        : registration
          ? "Registered, waiting for activation"
          : "Not registered";
    } catch (error) {
      console.error("Could not read service-worker diagnostics.", error);
      diagnosticWorker.textContent = "Status unavailable";
    }
  }

  if (!("caches" in window)) {
    diagnosticCache.textContent = "Unavailable";
    diagnosticCacheVersion.textContent = "Unavailable";
  } else {
    try {
      const cacheNames = await caches.keys();
      const handyCaches = cacheNames.filter((name) => name.startsWith("handy-"));
      diagnosticCache.textContent = handyCaches.length
        ? `${handyCaches.length} Handy cache${handyCaches.length === 1 ? "" : "s"} found`
        : "No Handy cache found";
      diagnosticCacheVersion.textContent = handyCaches.join(", ") || "None";
      offlineRecoveryStatus.textContent = handyCaches.length
        ? "Offline recovery ready. A cached app version is available."
        : "Offline recovery missing. Refresh while online to create the cache.";
    } catch (error) {
      console.error("Could not read offline-cache diagnostics.", error);
      diagnosticCache.textContent = "Status unavailable";
      diagnosticCacheVersion.textContent = "Status unavailable";
      offlineRecoveryStatus.textContent = "Offline recovery status unavailable.";
    }
  }
}

refreshDiagnosticsButton.addEventListener("click", async () => {
  await refreshDiagnostics();
  diagnosticsStatus.textContent = "Diagnostics refreshed.";
});

copyDiagnosticsButton.addEventListener("click", async () => {
  await refreshDiagnostics();
  const summary = [
    `Handy diagnostics`,
    `App version: ${diagnosticVersion.textContent}`,
    `Build: ${diagnosticBuild.textContent}`,
    `Production: ${diagnosticProduction.textContent}`,
    `Connection: ${diagnosticConnection.textContent}`,
    `App mode: ${diagnosticMode.textContent}`,
    `Service worker: ${diagnosticWorker.textContent}`,
    `Offline cache: ${diagnosticCache.textContent}`,
    `Cache version: ${diagnosticCacheVersion.textContent}`,
    `Update history: ${diagnosticUpdateHistory.textContent}`
  ].join("\n");

  try {
    if (!navigator.clipboard?.writeText) throw new Error("Clipboard access is unavailable.");
    await navigator.clipboard.writeText(summary);
    diagnosticsStatus.textContent = "Diagnostics copied.";
  } catch (error) {
    console.error("Could not copy diagnostics.", error);
    diagnosticsStatus.textContent = "Clipboard unavailable.";
  }
});

clearUpdateHistoryButton.addEventListener("click", () => {
  localStorage.removeItem(updateHistoryKey);
  sessionStorage.removeItem("handy-update-dismissed");
  diagnosticUpdateHistory.textContent = "No updates recorded";
  diagnosticsStatus.textContent = "Update history cleared.";
});

const welcomeModal = document.querySelector("#welcomeModal");
const welcomeBack = document.querySelector("#welcomeBack");
const welcomeNext = document.querySelector("#welcomeNext");
const welcomeSkip = document.querySelector("#welcomeSkip");
const welcomeSteps = [...document.querySelectorAll("[data-welcome-step]")];
const welcomeProgress = welcomeModal.querySelectorAll(".welcome-progress span");
let welcomeStepIndex = 0;

function dismissWelcome({ completed = false } = {}) {
  localStorage.setItem(welcomeDismissedKey, "true");
  if (completed) {
    localStorage.removeItem("handy-welcome-skipped");
  } else {
    localStorage.setItem("handy-welcome-skipped", "true");
  }
  welcomeModal.hidden = true;
}

function renderWelcomeStep() {
  welcomeSteps.forEach((step, index) => {
    step.hidden = index !== welcomeStepIndex;
  });
  welcomeProgress.forEach((dot, index) => {
    dot.classList.toggle("active", index === welcomeStepIndex);
  });
  welcomeBack.disabled = welcomeStepIndex === 0;
  welcomeNext.textContent = welcomeStepIndex === welcomeSteps.length - 1
    ? "Start using Handy"
    : "Next";
}

welcomeBack.addEventListener("click", () => {
  welcomeStepIndex = Math.max(0, welcomeStepIndex - 1);
  renderWelcomeStep();
});

welcomeNext.addEventListener("click", () => {
  if (welcomeStepIndex < welcomeSteps.length - 1) {
    welcomeStepIndex += 1;
    renderWelcomeStep();
  } else {
    dismissWelcome({ completed: true });
  }
});

welcomeModal.querySelectorAll("[data-close-welcome]").forEach((button) => {
  button.addEventListener("click", () => dismissWelcome());
});

welcomeSkip.addEventListener("click", () => dismissWelcome());

window.addEventListener("load", () => {
  const directTool = new URL(window.location.href).searchParams.has("tool");
  const sharedTrip = new URL(window.location.href).searchParams.has("trip");
  if (directTool || sharedTrip || localStorage.getItem(welcomeDismissedKey) === "true") return;
  welcomeStepIndex = 0;
  renderWelcomeStep();
  window.openAccessibleModal(welcomeModal);
  welcomeModal.hidden = false;
});

window.addEventListener("online", refreshDiagnostics);
window.addEventListener("offline", refreshDiagnostics);
window.addEventListener("load", refreshDiagnostics);
window.addEventListener("handy-cache-recovery", (event) => {
  if (offlineRecoveryStatus) {
    offlineRecoveryStatus.textContent =
      `Offline recovery: ${event.detail?.message || "Status unavailable."}`;
  }
  if (event.detail?.state === "blocked") refreshDiagnostics();
});
refreshDiagnostics();

document.querySelector(".learn-link").addEventListener("click", (event) => {
  event.preventDefault();
  openLinkedTool("guides");
});

