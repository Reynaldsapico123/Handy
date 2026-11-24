async function initializeTimer() {
  const mount = document.querySelector("#timerMount");
  const response = await fetch("timer.html");
  if (!response.ok) throw new Error("Could not load the timer");
  mount.innerHTML = await response.text();

  const modal = document.querySelector("#timerModal");
  const display = document.querySelector("#timerTime");
  const duration = document.querySelector("#timerDuration");
  const minutes = document.querySelector("#timerMinutes");
  const seconds = document.querySelector("#timerSeconds");
  const startButton = document.querySelector("#timerStart");
  const status = document.querySelector("#timerStatus");
  let mode = "timer";
  let running = false;
  let interval = null;
  let remaining = 300;
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

  function syncTimerDuration() {
    remaining = (Math.max(0, Number(minutes.value) || 0) * 60) +
      Math.min(59, Math.max(0, Number(seconds.value) || 0));
    localStorage.setItem("handy-timer-duration", JSON.stringify({
      minutes: Math.max(0, Number(minutes.value) || 0),
      seconds: Math.min(59, Math.max(0, Number(seconds.value) || 0))
    }));
    updateDisplay();
  }

  function stop() {
    clearInterval(interval);
    interval = null;
    running = false;
    startButton.textContent = "Start";
    startButton.setAttribute("aria-label", "Start timer");
  }

  function reset() {
    stop();
    if (mode === "timer") syncTimerDuration();
    else remaining = 0;
    updateDisplay();
    announce(mode === "timer" ? "Timer reset." : "Stopwatch reset.");
  }

  function start() {
    if (running) {
      stop();
      announce(`${mode === "timer" ? "Timer" : "Stopwatch"} paused at ${formatTime(remaining)}.`);
      return;
    }
    if (mode === "timer" && remaining <= 0) syncTimerDuration();
    running = true;
    startButton.textContent = "Pause";
    startButton.setAttribute("aria-label", "Pause timer");
    announce(`${mode === "timer" ? "Timer started" : "Stopwatch started"}.`);
    interval = setInterval(() => {
      if (mode === "timer") {
        remaining = Math.max(0, remaining - 1);
        updateDisplay();
        if ([60, 30, 10].includes(remaining)) {
          announce(`${remaining} seconds remaining.`);
        }
        if (remaining === 0) {
          stop();
          startButton.setAttribute("aria-label", "Start timer");
          announce("Timer finished.");
          if ("Notification" in window && Notification.permission === "granted") {
            new Notification("Timer finished");
          }
        }
      } else {
        remaining += 1;
        updateDisplay();
      }
    }, 1000);
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
      remaining = mode === "timer" ? 300 : 0;
      if (mode === "timer") syncTimerDuration();
      else {
        remaining = 0;
        updateDisplay();
      }
      announce(mode === "timer" ? "Timer mode selected." : "Stopwatch mode selected.");
    });
  });

  minutes.addEventListener("input", syncTimerDuration);
  seconds.addEventListener("input", syncTimerDuration);
  startButton.addEventListener("click", start);
  document.querySelector("#timerReset").addEventListener("click", reset);

  window.openTimer = function () {
    window.openAccessibleModal(modal);
    modal.hidden = false;
    document.body.style.overflow = "hidden";
    if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
  };

  function close() {
    stop();
    modal.hidden = true;
    document.body.style.overflow = "";
    document.querySelector('[aria-label="Open Timer and Stopwatch"]').focus();
  }
  modal.querySelectorAll("[data-close-timer]").forEach((element) => element.addEventListener("click", close));
  document.addEventListener("keydown", (event) => {
    if (!modal.hidden && event.key === "Escape") close();
  });

  syncTimerDuration();
}

const timerInitialization = initializeTimer();
window.handyToolInitialization.set("timer", timerInitialization);
timerInitialization.catch((error) => console.error(error));
