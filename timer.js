async function initializeTimer() {
  const mount = document.querySelector("#timerMount");
  const response = await window.handyFetchToolFragment("timer");
  if (!response.ok) throw new Error("Could not load the timer");
  mount.innerHTML = await response.text();

  const modal = document.querySelector("#timerModal");
  const display = document.querySelector("#timerTime");
  const duration = document.querySelector("#timerDuration");
  const minutes = document.querySelector("#timerMinutes");
  const seconds = document.querySelector("#timerSeconds");
  const startButton = document.querySelector("#timerStart");
  const lapButton = document.querySelector("#timerLap");
  const lapsPanel = document.querySelector("#timerLaps");
  const lapList = document.querySelector("#timerLapList");
  const status = document.querySelector("#timerStatus");
  let mode = "timer";
  let running = false;
  let interval = null;
  let endTime = null;
  let stopwatchStartedAt = null;
  let remaining = 300;
  let laps = [];
  const timerStateKey = "handy-timer-state";
  const savedDuration = JSON.parse(localStorage.getItem("handy-timer-duration") || '{"minutes":5,"seconds":0}');
  const savedMinutes = Number(savedDuration.minutes);
  const savedSeconds = Number(savedDuration.seconds);
  minutes.value = Number.isFinite(savedMinutes) ? Math.min(999, Math.max(0, savedMinutes)) : 5;
  seconds.value = Number.isFinite(savedSeconds) ? Math.min(59, Math.max(0, savedSeconds)) : 0;

  function formatTime(totalSeconds) {
    const hours = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    return hours
      ? `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
      : `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  function announce(message) {
    status.textContent = "";
    window.setTimeout(() => { status.textContent = message; }, 30);
  }

  function updateDisplay() {
    const formatted = formatTime(remaining);
    display.textContent = formatted;
    display.setAttribute("aria-label", `${mode === "timer" ? "Timer" : "Stopwatch"} ${formatted}`);
  }

  function updateStartButton() {
    const action = running ? "Pause" : "Start";
    startButton.textContent = action;
    startButton.setAttribute("aria-label", `${action} ${mode}`);
    lapButton.disabled = mode !== "stopwatch" || !running;
  }

  function syncTimerDuration() {
    remaining = (Math.max(0, Number(minutes.value) || 0) * 60) +
      Math.min(59, Math.max(0, Number(seconds.value) || 0));
    localStorage.setItem("handy-timer-duration", JSON.stringify({
      minutes: Math.max(0, Number(minutes.value) || 0),
      seconds: Math.min(59, Math.max(0, Number(seconds.value) || 0))
    }));
    if (running && mode === "timer") {
      endTime = Date.now() + remaining * 1000;
      localStorage.setItem(timerStateKey, JSON.stringify({ endsAt: endTime }));
    }
    updateDisplay();
  }

  function stop() {
    clearInterval(interval);
    interval = null;
    running = false;
    endTime = null;
    stopwatchStartedAt = null;
    localStorage.removeItem(timerStateKey);
    updateStartButton();
  }

  function renderLaps() {
    lapList.replaceChildren(...laps.map((lap, index) => {
      const previousLap = laps[index - 1] || 0;
      const item = document.createElement("li");
      const label = document.createElement("span");
      const times = document.createElement("span");
      label.textContent = `Lap ${index + 1}`;
      times.textContent = `${formatTime(lap)} · Split ${formatTime(lap - previousLap)}`;
      item.append(label, times);
      return item;
    }));
  }

  function clearLaps() {
    laps = [];
    renderLaps();
  }

  function finishTimer() {
    stop();
    remaining = 0;
    updateDisplay();
    announce("Timer finished.");
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification("Timer finished");
    }
  }

  function tick() {
    if (mode === "timer") {
      const previousRemaining = remaining;
      remaining = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));
      updateDisplay();
      if (remaining < previousRemaining && [60, 30, 10].includes(remaining)) {
        announce(`${remaining} seconds remaining.`);
      }
      if (remaining === 0) finishTimer();
      return;
    }
    remaining = Math.floor((Date.now() - stopwatchStartedAt) / 1000);
    updateDisplay();
  }

  function startInterval() {
    clearInterval(interval);
    interval = setInterval(tick, 250);
  }

  function reset() {
    stop();
    if (mode === "timer") syncTimerDuration();
    else {
      remaining = 0;
      clearLaps();
    }
    updateDisplay();
    announce(mode === "timer" ? "Timer reset." : "Stopwatch reset.");
  }

  function start() {
    if (running) {
      if (mode === "timer") {
        remaining = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));
        updateDisplay();
      } else {
        remaining = Math.floor((Date.now() - stopwatchStartedAt) / 1000);
        updateDisplay();
      }
      stop();
      announce(`${mode === "timer" ? "Timer" : "Stopwatch"} paused at ${formatTime(remaining)}.`);
      return;
    }
    if (mode === "timer" && remaining <= 0) syncTimerDuration();
    running = true;
    if (mode === "timer") {
      endTime = Date.now() + remaining * 1000;
      localStorage.setItem(timerStateKey, JSON.stringify({ endsAt: endTime }));
    } else stopwatchStartedAt = Date.now() - remaining * 1000;
    updateStartButton();
    announce(`${mode === "timer" ? "Timer started" : "Stopwatch started"}.`);
    startInterval();
  }

  document.querySelectorAll(".timer-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      stop();
      mode = tab.dataset.mode;
      document.querySelectorAll(".timer-tab").forEach((item) => {
        const selected = item === tab;
        item.classList.toggle("active", selected);
        item.setAttribute("aria-selected", selected.toString());
        item.tabIndex = selected ? 0 : -1;
      });
      duration.classList.toggle("hidden", mode === "stopwatch");
      lapButton.hidden = mode !== "stopwatch";
      lapsPanel.hidden = mode !== "stopwatch";
      clearLaps();
      remaining = mode === "timer" ? 300 : 0;
      if (mode === "timer") syncTimerDuration();
      else {
        remaining = 0;
        updateDisplay();
      }
      updateStartButton();
      announce(mode === "timer" ? "Timer mode selected." : "Stopwatch mode selected.");
    });
  });

  document.querySelectorAll(".timer-preset").forEach((preset) => {
    preset.addEventListener("click", () => {
      stop();
      minutes.value = preset.dataset.minutes;
      seconds.value = "0";
      syncTimerDuration();
      announce(`${preset.textContent.trim()} preset selected.`);
    });
  });

  minutes.addEventListener("input", syncTimerDuration);
  seconds.addEventListener("input", syncTimerDuration);
  startButton.addEventListener("click", start);
  document.querySelector("#timerReset").addEventListener("click", reset);
  lapButton.addEventListener("click", () => {
    if (!running || mode !== "stopwatch") return;
    laps.push(remaining);
    renderLaps();
    announce(`Lap ${laps.length} recorded at ${formatTime(remaining)}.`);
  });

  window.openTimer = function () {
    window.openAccessibleModal(modal);
    modal.hidden = false;
    document.body.style.overflow = "hidden";
    if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
  };

  function close() {
    if (mode === "stopwatch") stop();
    modal.hidden = true;
    document.body.style.overflow = "";
    document.querySelector('[aria-label="Open Timer and Stopwatch"]').focus();
  }
  modal.querySelectorAll("[data-close-timer]").forEach((element) => element.addEventListener("click", close));
  document.addEventListener("keydown", (event) => {
    if (!modal.hidden && event.key === "Escape") close();
  });

  const savedTimerState = JSON.parse(localStorage.getItem(timerStateKey) || "null");
  if (Number.isFinite(savedTimerState?.endsAt)) {
    endTime = savedTimerState.endsAt;
    remaining = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));
    if (remaining > 0) {
      running = true;
      updateStartButton();
      updateDisplay();
      startInterval();
    } else {
      localStorage.removeItem(timerStateKey);
      updateDisplay();
      announce("Timer finished.");
    }
  } else {
    syncTimerDuration();
  }
}

const timerInitialization = initializeTimer();
window.handyToolInitialization.set("timer", timerInitialization);
timerInitialization.catch((error) => console.error(error));
