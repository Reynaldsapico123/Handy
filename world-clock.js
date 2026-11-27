async function initializeWorldClock() {
  const mount = document.querySelector("#worldClockMount");
  const response = await window.handyFetchToolFragment("world-clock");
  if (!response.ok) throw new Error("Could not load the world clock");
  mount.innerHTML = await response.text();

  const modal = document.querySelector("#worldClockModal");
  const citySelect = document.querySelector("#clockCity");
  const list = document.querySelector("#clockList");
  const meetingForm = document.querySelector("#clockMeetingForm");
  const meetingDate = document.querySelector("#clockMeetingDate");
  const meetingStart = document.querySelector("#clockMeetingStart");
  const meetingEnd = document.querySelector("#clockMeetingEnd");
  const meetingStatus = document.querySelector("#clockMeetingStatus");
  const meetingSlots = document.querySelector("#clockMeetingSlots");
  const meetingCopy = document.querySelector("#clockMeetingCopy");
  const defaultCities = [
    "Asia/Singapore",
    "Europe/London",
    "America/New_York"
  ];

  let cities = loadCities();
  let clockTimer;
  let selectedMeetingAt = null;
  const meetingPartsFormatters = new Map();
  const meetingDisplayFormatters = new Map();

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

  function localDateValue(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function getMeetingDateParts(timeZone, timestamp) {
    if (!meetingPartsFormatters.has(timeZone)) {
      meetingPartsFormatters.set(timeZone, new Intl.DateTimeFormat("en-US-u-nu-latn", {
        timeZone,
        hourCycle: "h23",
        hour: "2-digit",
        minute: "2-digit"
      }));
    }
    return Object.fromEntries(
      meetingPartsFormatters.get(timeZone).formatToParts(new Date(timestamp))
        .map(({ type, value }) => [type, value])
    );
  }

  function formatMeetingDateTime(timeZone, timestamp) {
    if (!meetingDisplayFormatters.has(timeZone)) {
      meetingDisplayFormatters.set(timeZone, new Intl.DateTimeFormat("en-US", {
        timeZone,
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short"
      }));
    }
    return meetingDisplayFormatters.get(timeZone).format(new Date(timestamp));
  }

  function clearMeetingOptions(message) {
    selectedMeetingAt = null;
    meetingSlots.replaceChildren();
    meetingCopy.disabled = true;
    if (message) meetingStatus.textContent = message;
  }

  function timeInWorkday(timeZone, timestamp, workStart, workEnd) {
    const parts = getMeetingDateParts(timeZone, timestamp);
    const minuteOfDay = (Number(parts.hour) % 24) * 60 + Number(parts.minute);
    return minuteOfDay >= workStart && minuteOfDay < workEnd;
  }

  function findMeetingTimes() {
    clearMeetingOptions();
    if (cities.length < 2) {
      meetingStatus.textContent = "Add at least two cities to find shared meeting times.";
      return;
    }

    const dateParts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(meetingDate.value);
    const startParts = /^(\d{2}):(\d{2})$/.exec(meetingStart.value);
    const endParts = /^(\d{2}):(\d{2})$/.exec(meetingEnd.value);
    if (!dateParts || !startParts || !endParts) {
      meetingStatus.textContent = "Choose a valid date and workday range.";
      return;
    }

    const [, year, month, day] = dateParts.map(Number);
    const workStart = Number(startParts[1]) * 60 + Number(startParts[2]);
    const workEnd = Number(endParts[1]) * 60 + Number(endParts[2]);
    if (workStart >= workEnd) {
      meetingStatus.textContent = "Workday end must be later than its start.";
      return;
    }

    const localStart = new Date(year, month - 1, day);
    if (localStart.getFullYear() !== year || localStart.getMonth() !== month - 1 || localStart.getDate() !== day) {
      meetingStatus.textContent = "Choose a valid date.";
      return;
    }
    const localEnd = new Date(year, month - 1, day + 1);
    const duration = 30 * 60 * 1000;
    const localTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const options = [];

    for (let timestamp = localStart.getTime(); timestamp + duration <= localEnd.getTime(); timestamp += duration) {
      const lastMinute = timestamp + duration - 60 * 1000;
      const overlapsAllCities = cities.every((timeZone) =>
        timeInWorkday(timeZone, timestamp, workStart, workEnd)
        && timeInWorkday(timeZone, lastMinute, workStart, workEnd)
      );
      if (overlapsAllCities) options.push(timestamp);
    }

    for (const timestamp of options) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "clock-meeting-slot";
      button.dataset.meetingAt = String(timestamp);
      button.setAttribute("aria-pressed", "false");
      const localTime = formatMeetingDateTime(localTimeZone, timestamp);
      const cityTimes = cities
        .map((timeZone) => `${cityName(timeZone)}: ${formatMeetingDateTime(timeZone, timestamp)}`)
        .join(" · ");
      const heading = document.createElement("strong");
      heading.textContent = `Your time · ${localTime}`;
      const details = document.createElement("span");
      details.textContent = cityTimes;
      button.setAttribute("aria-label", `Select meeting time. Your time: ${localTime}. ${cityTimes}`);
      button.append(heading, details);
      meetingSlots.appendChild(button);
    }

    meetingStatus.textContent = options.length
      ? `${options.length} shared 30-minute start times found. Select one to copy.`
      : "No shared working-time overlap found. Try another date or wider hours.";
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
      clearMeetingOptions("City list changed. Find times again to include it.");
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
    clearMeetingOptions("City list changed. Find times again to include it.");
    showToast(`Removed ${removedName}.`, {
      label: "Undo",
      onClick: () => {
        if (!cities.includes(removedTimeZone)) {
          cities.splice(Math.max(0, removedIndex), 0, removedTimeZone);
          saveCities();
          render();
          clearMeetingOptions("City list changed. Find times again to include it.");
        }
        showToast(`${removedName} restored.`);
      }
    });
  });

  meetingDate.value = localDateValue(new Date());
  meetingForm.addEventListener("input", () => {
    clearMeetingOptions("Update the date or workday, then find times again.");
  });
  meetingForm.addEventListener("submit", (event) => {
    event.preventDefault();
    findMeetingTimes();
  });
  meetingSlots.addEventListener("click", (event) => {
    const button = event.target.closest("[data-meeting-at]");
    if (!button) return;
    selectedMeetingAt = Number(button.dataset.meetingAt);
    meetingSlots.querySelectorAll("[data-meeting-at]").forEach((option) => {
      option.setAttribute("aria-pressed", String(option === button));
    });
    meetingCopy.disabled = false;
    meetingStatus.textContent = "Meeting time selected. Copy it to share the local times.";
  });
  meetingCopy.addEventListener("click", async () => {
    if (!Number.isFinite(selectedMeetingAt)) return;
    const localTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const lines = [
      `Handy meeting time — ${formatMeetingDateTime(localTimeZone, selectedMeetingAt)} (${localTimeZone})`,
      ...cities.map((timeZone) =>
        `${cityName(timeZone)} — ${formatMeetingDateTime(timeZone, selectedMeetingAt)}`
      )
    ];
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard access is unavailable.");
      await navigator.clipboard.writeText(lines.join("\n"));
      showToast("Meeting time copied.");
    } catch (error) {
      console.error("Could not copy the meeting time.", error);
      showToast("Could not copy the meeting time. Check clipboard permissions.");
    }
  });

  window.openWorldClock = function (preset) {
    if (preset?.timeZone && citySelect.querySelector(`option[value="${CSS.escape(preset.timeZone)}"]`)) {
      cities = [preset.timeZone, ...cities.filter((timeZone) => timeZone !== preset.timeZone)];
      saveCities();
      clearMeetingOptions("City list changed. Find times again to include it.");
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
