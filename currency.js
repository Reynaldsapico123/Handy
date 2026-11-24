async function initializeCurrency() {
  const mount = document.querySelector("#currencyMount");
  const response = await window.handyFetchToolFragment("currency");
  if (!response.ok) throw new Error("Could not load currency exchange");
  mount.innerHTML = await response.text();

  const modal = document.querySelector("#currencyModal");
  const amount = document.querySelector("#currencyAmount");
  const from = document.querySelector("#currencyFrom");
  const to = document.querySelector("#currencyTo");
  const result = document.querySelector("#currencyResult");
  const copyResultButton = document.querySelector("#currencyCopyResult");
  const status = document.querySelector("#currencyStatus");
  const refreshButton = document.querySelector("#currencyRefresh");
  const liveRatesStorageKey = "handy-currency-live-rates";

  const currencies = [
    ["USD", "US Dollar"],
    ["EUR", "Euro"],
    ["GBP", "British Pound"],
    ["JPY", "Japanese Yen"],
    ["AUD", "Australian Dollar"],
    ["CAD", "Canadian Dollar"],
    ["CHF", "Swiss Franc"],
    ["CNY", "Chinese Yuan"],
    ["INR", "Indian Rupee"],
    ["SGD", "Singapore Dollar"],
    ["AED", "UAE Dirham"],
    ["NZD", "New Zealand Dollar"]
  ];

  const fallbackRates = {
    USD: 1,
    EUR: 0.92,
    GBP: 0.79,
    JPY: 156.7,
    AUD: 1.53,
    CAD: 1.37,
    CHF: 0.88,
    CNY: 7.26,
    INR: 83.5,
    SGD: 1.34,
    AED: 3.6725,
    NZD: 1.66
  };

  function readSavedLiveRates() {
    try {
      const saved = JSON.parse(localStorage.getItem(liveRatesStorageKey) || "null");
      if (
        !saved
        || typeof saved.updatedAt !== "string"
        || !Number.isFinite(Date.parse(saved.updatedAt))
        || !saved.rates
        || typeof saved.rates !== "object"
      ) return null;

      const savedRates = {};
      currencies.forEach(([code]) => {
        const rate = saved.rates[code];
        if (typeof rate === "number" && Number.isFinite(rate) && rate > 0) savedRates[code] = rate;
      });
      if (currencies.some(([code]) => !Number.isFinite(savedRates[code]))) return null;
      savedRates.USD = 1;
      return { rates: savedRates, updatedAt: saved.updatedAt };
    } catch (error) {
      console.error("Could not read saved currency rates.", error);
      return null;
    }
  }

  const savedLiveRates = readSavedLiveRates();
  let rates = savedLiveRates?.rates || fallbackRates;
  let liveRatesAvailable = Boolean(savedLiveRates);
  let liveRatesPersisted = Boolean(savedLiveRates);
  let liveRatesUpdatedAt = savedLiveRates?.updatedAt || null;
  let fetchedLiveRatesThisSession = false;
  let loadingRates = false;

  const options = currencies
    .map(([code, name]) => `<option value="${code}">${code} — ${name}</option>`)
    .join("");
  from.innerHTML = options;
  to.innerHTML = options;
  from.value = "USD";
  to.value = "EUR";
  const savedCurrencies = JSON.parse(localStorage.getItem("handy-currency-pair") || "null");
  if (savedCurrencies?.from && savedCurrencies?.to) {
    from.value = savedCurrencies.from;
    to.value = savedCurrencies.to;
    if (Number.isFinite(Number(savedCurrencies.amount))) amount.value = savedCurrencies.amount;
  }

  function formatResult(value) {
    return new Intl.NumberFormat(undefined, {
      maximumFractionDigits: value >= 1000 ? 2 : 4
    }).format(value);
  }

  function convert() {
    const value = Number(amount.value);
    if (!Number.isFinite(value) || value < 0) {
      result.textContent = "—";
      copyResultButton.disabled = true;
      return;
    }
    const converted = value / rates[from.value] * rates[to.value];
    result.textContent = formatResult(converted);
    copyResultButton.disabled = !Number.isFinite(converted);
    localStorage.setItem("handy-currency-pair", JSON.stringify({
      from: from.value,
      to: to.value,
      amount: amount.value
    }));
  }

  function formatUpdatedAt(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "recently";
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(date);
  }

  function showAvailableRatesStatus(prefix) {
    const source = liveRatesPersisted ? "saved rates" : "previously loaded rates";
    const updated = liveRatesUpdatedAt ? ` · Updated ${formatUpdatedAt(liveRatesUpdatedAt)}` : "";
    status.textContent = `${prefix} · Using ${source}${updated}`;
  }

  if (savedLiveRates) {
    status.textContent = `Saved rates · Updated ${formatUpdatedAt(savedLiveRates.updatedAt)}`;
  }

  async function loadLiveRates() {
    if (loadingRates) return;
    loadingRates = true;
    refreshButton.disabled = true;
    refreshButton.setAttribute("aria-busy", "true");
    refreshButton.innerHTML = '<span aria-hidden="true">↻</span> Loading';
    refreshButton.setAttribute("aria-label", "Refresh rates (loading exchange rates)");
    status.className = "currency-status";
    status.classList.add("loading");
    status.textContent = liveRatesAvailable ? "Refreshing live exchange rates…" : "Loading live exchange rates…";
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      let response;
      try {
        response = await fetch("https://open.er-api.com/v6/latest/USD", {
          cache: "no-store",
          signal: controller.signal
        });
      } finally {
        clearTimeout(timeout);
      }
      if (!response.ok) throw new Error("Exchange service unavailable");
      const data = await response.json();
      if (data.result !== "success" || !data.rates) throw new Error("Invalid exchange response");

      const supportedRates = {};
      currencies.forEach(([code]) => {
        const rate = data.rates[code];
        if (Number.isFinite(rate) && rate > 0) supportedRates[code] = rate;
      });
      if (currencies.some(([code]) => !Number.isFinite(supportedRates[code]))) {
        throw new Error("Exchange response is missing supported currency rates");
      }
      supportedRates.USD = 1;

      rates = supportedRates;
      liveRatesAvailable = true;
      fetchedLiveRatesThisSession = true;
      liveRatesUpdatedAt = data.time_last_update_utc || new Date().toISOString();
      try {
        localStorage.setItem(liveRatesStorageKey, JSON.stringify({
          rates: supportedRates,
          updatedAt: liveRatesUpdatedAt
        }));
        liveRatesPersisted = true;
        status.textContent = `Live rates · Updated ${formatUpdatedAt(liveRatesUpdatedAt)}`;
      } catch (error) {
        liveRatesPersisted = false;
        console.error("Could not save live currency rates for offline use.", error);
        status.classList.add("error");
        status.textContent = `Live rates · Updated ${formatUpdatedAt(liveRatesUpdatedAt)} · Not saved for offline use`;
      }
      convert();
    } catch (error) {
      status.className = "currency-status";
      if (liveRatesAvailable) {
        status.classList.add("error");
        showAvailableRatesStatus(
          error.name === "AbortError"
            ? "Refresh timed out"
            : navigator.onLine ? "Refresh failed" : "Offline"
        );
      } else {
        rates = fallbackRates;
        status.classList.add("error");
        status.textContent = !navigator.onLine
          ? "Offline · Using reference rates (may be outdated)"
          : error.name === "AbortError"
            ? "Live rates timed out · Using reference rates · Tap Refresh to retry"
            : "Live rates unavailable · Using reference rates · Tap Refresh to retry";
        convert();
      }
    } finally {
      loadingRates = false;
      refreshButton.disabled = false;
      refreshButton.removeAttribute("aria-busy");
      refreshButton.innerHTML = '<span aria-hidden="true">↻</span> Refresh rates';
      refreshButton.setAttribute("aria-label", "Refresh rates");
    }
  }

  window.openCurrency = function (preset) {
    if (
      preset
      && currencies.some(([code]) => code === preset.from)
      && currencies.some(([code]) => code === preset.to)
    ) {
      from.value = preset.from;
      to.value = preset.to;
      if (Number.isFinite(Number(preset.amount)) && Number(preset.amount) >= 0) {
        amount.value = String(preset.amount);
      }
      convert();
    }
    window.openAccessibleModal(modal);
    modal.hidden = false;
    document.body.style.overflow = "hidden";
    amount.focus();
    if (!navigator.onLine) {
      if (liveRatesAvailable) showAvailableRatesStatus("Offline");
      else status.textContent = "Offline · Using reference rates (may be outdated)";
    } else if (!fetchedLiveRatesThisSession) {
      loadLiveRates();
    }
  };

  function close() {
    modal.hidden = true;
    document.body.style.overflow = "";
  }

  amount.addEventListener("input", convert);
  copyResultButton.addEventListener("click", async () => {
    const value = Number(amount.value);
    if (!Number.isFinite(value) || value < 0 || !Number.isFinite(value / rates[from.value] * rates[to.value])) return;

    const conversion = `${formatResult(value)} ${from.value} = ${result.textContent} ${to.value}`;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard access is unavailable.");
      await navigator.clipboard.writeText(conversion);
      showToast("Conversion copied.");
    } catch (error) {
      console.error("Could not copy the currency conversion.", error);
      showToast("Copy failed. Please copy the displayed values manually.");
    }
  });
  refreshButton.addEventListener("click", loadLiveRates);
  from.addEventListener("change", convert);
  to.addEventListener("change", convert);
  document.querySelector("#currencySwap").addEventListener("click", () => {
    const previousFrom = from.value;
    from.value = to.value;
    to.value = previousFrom;
    convert();
  });
  modal.querySelectorAll("[data-close-currency]").forEach((element) => {
    element.addEventListener("click", close);
  });
  document.addEventListener("keydown", (event) => {
    if (!modal.hidden && event.key === "Escape") close();
  });

  convert();
}

const currencyInitialization = initializeCurrency();
window.handyToolInitialization.set("currency", currencyInitialization);
currencyInitialization.catch((error) => console.error(error));
