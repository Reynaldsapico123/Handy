async function initializeWorldClock() {
  const mount = document.querySelector("#worldClockMount");
  const response = await window.handyFetchToolFragment("world-clock");
  if (!response.ok) throw new Error("Could not load the world clock");
  mount.innerHTML = await response.text();

  const modal = document.querySelector("#worldClockModal");
  const citySelect = document.querySelector("#clockCity");
  const list = document.querySelector("#clockList");
  const defaultCities = [
    "Asia/Singapore",
    "Europe/London",
    "America/New_York"
  ];

  let cities = loadCities();
  let clockTimer;

  function loadCities() {
    try {
      const saved = JSON.parse(localStorage.getItem("handy-world-clock"));
      return Array.isArray(saved) && saved.length ? saved : defaultCities;
    } catch {
      return defaultCities;
    }
  }

  function saveCities() {
    localStorage.setItem("handy-world-clock", JSON.stringify(cities));
  }

  function cityName(timeZone) {
    return citySelect.querySelector(`option[value="${CSS.escape(timeZone)}"]`)?.textContent ||
      timeZone.split("/").pop().replaceAll("_", " ");
  }

  function getOffset(timeZone) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "shortOffset"
    }).formatToParts(new Date());
    return parts.find((part) => part.type === "timeZoneName")?.value || "Local time";
  }

  function getZoneLabel(timeZone) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "short"
    }).formatToParts(new Date());
    return parts.find((part) => part.type === "timeZoneName")?.value || getOffset(timeZone);
  }

  function render() {
    list.innerHTML = "";
    const now = new Date();

    cities.forEach((timeZone) => {
      const time = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      }).format(now);

      const date = new Intl.DateTimeFormat("en-US", {
        timeZone,
        weekday: "short",
        month: "short",
        day: "numeric"
      }).format(now);

      const card = document.createElement("article");
      card.className = "clock-card";
      card.innerHTML = `
        <div class="clock-place">
          <strong>${cityName(timeZone)}</strong>
          <span>${date}</span>
        </div>
        <div class="clock-time">${time}</div>
        <div>
          <div class="clock-offset">${getZoneLabel(timeZone)} · ${getOffset(timeZone)}</div>
          <button type="button" class="clock-copy" data-copy-clock="${timeZone}" aria-label="Copy ${cityName(timeZone)} time">Copy</button>
          <button type="button" class="clock-remove" data-remove-clock="${timeZone}" aria-label="Remove ${cityName(timeZone)}">×</button>
        </div>
      `;
      list.appendChild(card);
    });
  }

  document.querySelector("#addClockCity").addEventListener("click", () => {
    if (!cities.includes(citySelect.value)) {
      cities.push(citySelect.value);
      saveCities();
      render();
    }
  });

  list.addEventListener("click", (event) => {
    const copyButton = event.target.closest("[data-copy-clock]");
    if (copyButton) {
      const timeZone = copyButton.dataset.copyClock;
      const time = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
        weekday: "short",
        month: "short",
        day: "numeric"
      }).format(new Date());
      navigator.clipboard?.writeText(`${cityName(timeZone)} · ${time} · ${getZoneLabel(timeZone)} ${getOffset(timeZone)}`)
        .then(() => showToast(`${cityName(timeZone)} time copied.`))
        .catch(() => showToast("Clipboard is unavailable in this browser"));
      return;
    }
    const button = event.target.closest("[data-remove-clock]");
    if (!button) return;
    const removedTimeZone = button.dataset.removeClock;
    const removedIndex = cities.findIndex((timeZone) => timeZone === removedTimeZone);
    const removedName = cityName(removedTimeZone);
    cities = cities.filter((timeZone) => timeZone !== removedTimeZone);
    saveCities();
    render();
    showToast(`Removed ${removedName}.`, {
      label: "Undo",
      onClick: () => {
        if (!cities.includes(removedTimeZone)) {
          cities.splice(Math.max(0, removedIndex), 0, removedTimeZone);
          saveCities();
          render();
        }
        showToast(`${removedName} restored.`);
      }
    });
  });

  window.openWorldClock = function (preset) {
    if (preset?.timeZone && citySelect.querySelector(`option[value="${CSS.escape(preset.timeZone)}"]`)) {
      cities = [preset.timeZone, ...cities.filter((timeZone) => timeZone !== preset.timeZone)];
      saveCities();
    }
    window.openAccessibleModal(modal);
    modal.hidden = false;
    document.body.style.overflow = "hidden";
    render();
    clearInterval(clockTimer);
    clockTimer = setInterval(render, 1000);
  };

  function close() {
    modal.hidden = true;
    document.body.style.overflow = "";
    clearInterval(clockTimer);
  }

  modal.querySelectorAll("[data-close-world-clock]").forEach((element) => {
    element.addEventListener("click", close);
  });
  document.addEventListener("keydown", (event) => {
    if (!modal.hidden && event.key === "Escape") close();
  });

  render();
}

const worldClockInitialization = initializeWorldClock();
window.handyToolInitialization.set("world-clock", worldClockInitialization);
worldClockInitialization.catch((error) => console.error(error));
