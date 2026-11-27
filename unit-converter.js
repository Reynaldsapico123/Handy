async function initializeUnitConverter() {
  const mount = document.querySelector("#unitConverterMount");
  const response = await window.handyFetchToolFragment("unit-converter");
  if (!response.ok) throw new Error("Could not load the unit converter");
  mount.innerHTML = await response.text();

  const modal = document.querySelector("#unitConverterModal");
  const category = document.querySelector("#unitCategory");
  const from = document.querySelector("#unitFrom");
  const to = document.querySelector("#unitTo");
  const fromValue = document.querySelector("#unitFromValue");
  const toValue = document.querySelector("#unitToValue");
  const copyValue = document.querySelector("#unitCopy");
  const savePair = document.querySelector("#unitSavePair");
  const favoritesList = document.querySelector("#unitFavorites");
  const favoritesEmpty = document.querySelector("#unitFavoritesEmpty");
  const recentList = document.querySelector("#unitRecentList");
  const recentEmpty = document.querySelector("#unitRecentEmpty");
  const clearRecent = document.querySelector("#unitClearRecent");
  const favoritesKey = "handy-unit-converter-favorites";
  const recentKey = "handy-unit-converter-recent";
  const savedUnit = JSON.parse(localStorage.getItem("handy-unit-converter") || "null");
  let favorites = readJsonArray(favoritesKey);
  let recent = readJsonArray(recentKey);

  const units = {
    length: {
      meter: { label: "Meters", factor: 1 },
      kilometer: { label: "Kilometers", factor: 1000 },
      centimeter: { label: "Centimeters", factor: 0.01 },
      mile: { label: "Miles", factor: 1609.344 },
      foot: { label: "Feet", factor: 0.3048 },
      inch: { label: "Inches", factor: 0.0254 }
    },
    weight: {
      kilogram: { label: "Kilograms", factor: 1 },
      gram: { label: "Grams", factor: 0.001 },
      pound: { label: "Pounds", factor: 0.45359237 },
      ounce: { label: "Ounces", factor: 0.028349523125 }
    },
    temperature: {
      celsius: { label: "Celsius" },
      fahrenheit: { label: "Fahrenheit" },
      kelvin: { label: "Kelvin" }
    },
    area: {
      squareMeter: { label: "Square meters", factor: 1 },
      squareKilometer: { label: "Square kilometers", factor: 1000000 },
      squareFoot: { label: "Square feet", factor: 0.09290304 },
      acre: { label: "Acres", factor: 4046.8564224 }
    }
  };

  function readJsonArray(key) {
    try {
      const saved = JSON.parse(localStorage.getItem(key));
      return Array.isArray(saved) ? saved : [];
    } catch {
      return [];
    }
  }

  function validPair(pair) {
    return pair
      && typeof pair.category === "string"
      && units[pair.category]?.[pair.from]
      && units[pair.category]?.[pair.to]
      && String(pair.category).length <= 20
      && String(pair.from).length <= 30
      && String(pair.to).length <= 30;
  }

  favorites = favorites.filter(validPair).slice(0, 8);
  recent = recent.filter((item) =>
    validPair(item)
    && typeof item.value === "string"
    && item.value.length <= 64
  ).slice(0, 8);

  function pairKey(pair) {
    return `${pair.category}:${pair.from}:${pair.to}`;
  }

  function pairLabel(pair) {
    return `${units[pair.category][pair.from].label} → ${units[pair.category][pair.to].label}`;
  }

  function renderFavorites() {
    favoritesList.replaceChildren();
    favoritesEmpty.hidden = favorites.length > 0;
    favorites.forEach((pair, index) => {
      const item = document.createElement("div");
      item.className = "unit-favorite";
      const apply = document.createElement("button");
      apply.type = "button";
      apply.dataset.favoriteIndex = String(index);
      apply.textContent = pairLabel(pair);
      apply.setAttribute("aria-label", `Apply saved pair ${pairLabel(pair)}`);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "unit-favorite-remove";
      remove.dataset.removeFavoriteIndex = String(index);
      remove.textContent = "×";
      remove.setAttribute("aria-label", `Remove saved pair ${pairLabel(pair)}`);
      item.append(apply, remove);
      favoritesList.append(item);
    });
  }

  function renderRecent() {
    recentList.replaceChildren();
    recentEmpty.hidden = recent.length > 0;
    clearRecent.disabled = recent.length === 0;
    recent.forEach((entry, index) => {
      const item = document.createElement("div");
      item.className = "unit-recent-item";
      const apply = document.createElement("button");
      apply.type = "button";
      apply.className = "unit-recent-copy";
      apply.dataset.recentIndex = String(index);
      apply.setAttribute("aria-label", `Repeat conversion ${entry.value} ${pairLabel(entry)}`);
      const headline = document.createElement("strong");
      headline.textContent = `${entry.value} ${units[entry.category][entry.from].label} → ${entry.result}`;
      const detail = document.createElement("span");
      detail.textContent = pairLabel(entry);
      apply.append(headline, detail);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "unit-recent-remove";
      remove.dataset.removeRecentIndex = String(index);
      remove.textContent = "×";
      remove.setAttribute("aria-label", `Remove recent conversion ${entry.value} ${pairLabel(entry)}`);
      item.append(apply, remove);
      recentList.append(item);
    });
  }

  function saveRecent(pair) {
    const entry = { ...pair, value: fromValue.value, result: toValue.value };
    if (!validPair(entry) || !entry.value.trim() || !entry.result.trim()) return;
    recent = recent.filter((item) => !(
      pairKey(item) === pairKey(entry) && item.value === entry.value
    ));
    recent.unshift(entry);
    recent = recent.slice(0, 8);
    localStorage.setItem(recentKey, JSON.stringify(recent));
    renderRecent();
  }

  function populate() {
    const options = Object.entries(units[category.value])
      .map(([value, unit]) => `<option value="${value}">${unit.label}</option>`).join("");
    from.innerHTML = options;
    to.innerHTML = options;
    to.selectedIndex = Math.min(1, to.options.length - 1);
    if (savedUnit?.category === category.value) {
      if (savedUnit.from) from.value = savedUnit.from;
      if (savedUnit.to) to.value = savedUnit.to;
    }
    convert();
  }

  function convert() {
    const value = Number(fromValue.value);
    copyValue.disabled = true;
    if (!Number.isFinite(value)) {
      toValue.value = "";
      return;
    }
    let result;
    if (category.value === "temperature") {
      let celsius = value;
      if (from.value === "fahrenheit") celsius = (value - 32) * 5 / 9;
      if (from.value === "kelvin") celsius = value - 273.15;
      if (to.value === "fahrenheit") result = celsius * 9 / 5 + 32;
      else if (to.value === "kelvin") result = celsius + 273.15;
      else result = celsius;
    } else {
      result = value * units[category.value][from.value].factor /
        units[category.value][to.value].factor;
    }
    if (!Number.isFinite(result)) {
      toValue.value = "Result is too large";
      return;
    }
    toValue.value = Number(result.toPrecision(12)).toLocaleString();
    copyValue.disabled = false;
    localStorage.setItem("handy-unit-converter", JSON.stringify({
      category: category.value,
      from: from.value,
      to: to.value,
      value: fromValue.value
    }));
  }

  window.openUnitConverter = function (preset) {
    if (
      preset
      && units[preset.category]?.[preset.from]
      && units[preset.category]?.[preset.to]
      && Number.isFinite(Number(preset.value))
    ) {
      category.value = preset.category;
      populate();
      from.value = preset.from;
      to.value = preset.to;
      fromValue.value = String(preset.value);
      convert();
    }
    window.openAccessibleModal(modal);
    modal.hidden = false;
    document.body.style.overflow = "hidden";
    fromValue.focus();
  };

  function close() {
    modal.hidden = true;
    document.body.style.overflow = "";
    document.querySelector('[aria-label="Open Unit Converter"]').focus();
  }

  modal.querySelectorAll("[data-close-unit]").forEach((element) => element.addEventListener("click", close));
  category.addEventListener("change", populate);
  from.addEventListener("change", convert);
  to.addEventListener("change", convert);
  fromValue.addEventListener("input", convert);
  document.querySelector("#unitSwap").addEventListener("click", () => {
    const fromUnit = from.value;
    from.value = to.value;
    to.value = fromUnit;
    if (!copyValue.disabled && toValue.value) {
      const convertedValue = toValue.value.replace(/,/g, "");
      if (Number.isFinite(Number(convertedValue))) fromValue.value = convertedValue;
    }
    convert();
  });
  copyValue.addEventListener("click", async () => {
    if (copyValue.disabled) return;
    saveRecent({
      category: category.value,
      from: from.value,
      to: to.value
    });
    try {
      await navigator.clipboard.writeText(toValue.value);
      showToast("Converted value copied.");
    } catch {
      showToast("Clipboard is unavailable in this browser");
    }
  });

  savePair.addEventListener("click", () => {
    const pair = { category: category.value, from: from.value, to: to.value };
    if (favorites.some((item) => pairKey(item) === pairKey(pair))) {
      showToast("This unit pair is already saved.");
      return;
    }
    if (favorites.length >= 8) {
      showToast("You can save up to 8 unit pairs.");
      return;
    }
    favorites.push(pair);
    localStorage.setItem(favoritesKey, JSON.stringify(favorites));
    renderFavorites();
    showToast("Unit pair saved.");
  });

  favoritesList.addEventListener("click", (event) => {
    const removeButton = event.target.closest("[data-remove-favorite-index]");
    if (removeButton) {
      const index = Number(removeButton.dataset.removeFavoriteIndex);
      const removed = favorites[index];
      if (!removed) return;
      favorites.splice(index, 1);
      localStorage.setItem(favoritesKey, JSON.stringify(favorites));
      renderFavorites();
      showToast("Saved pair removed.", {
        label: "Undo",
        onClick: () => {
          favorites.splice(Math.min(index, favorites.length), 0, removed);
          localStorage.setItem(favoritesKey, JSON.stringify(favorites));
          renderFavorites();
          showToast("Saved pair restored.");
        }
      });
      return;
    }
    const applyButton = event.target.closest("[data-favorite-index]");
    if (!applyButton) return;
    const pair = favorites[Number(applyButton.dataset.favoriteIndex)];
    if (!pair) return;
    category.value = pair.category;
    populate();
    from.value = pair.from;
    to.value = pair.to;
    convert();
  });

  recentList.addEventListener("click", (event) => {
    const removeButton = event.target.closest("[data-remove-recent-index]");
    if (removeButton) {
      const index = Number(removeButton.dataset.removeRecentIndex);
      const removed = recent[index];
      if (!removed) return;
      recent.splice(index, 1);
      localStorage.setItem(recentKey, JSON.stringify(recent));
      renderRecent();
      showToast("Recent conversion removed.", {
        label: "Undo",
        onClick: () => {
          recent.splice(Math.min(index, recent.length), 0, removed);
          localStorage.setItem(recentKey, JSON.stringify(recent));
          renderRecent();
          showToast("Recent conversion restored.");
        }
      });
      return;
    }
    const applyButton = event.target.closest("[data-recent-index]");
    if (!applyButton) return;
    const entry = recent[Number(applyButton.dataset.recentIndex)];
    if (!entry) return;
    category.value = entry.category;
    populate();
    from.value = entry.from;
    to.value = entry.to;
    fromValue.value = entry.value;
    convert();
  });

  clearRecent.addEventListener("click", () => {
    if (!recent.length) return;
    const previous = [...recent];
    recent = [];
    localStorage.removeItem(recentKey);
    renderRecent();
    showToast("Recent conversions cleared.", {
      label: "Undo",
      onClick: () => {
        recent = previous;
        localStorage.setItem(recentKey, JSON.stringify(recent));
        renderRecent();
        showToast("Recent conversions restored.");
      }
    });
  });

  renderFavorites();
  renderRecent();
  document.addEventListener("keydown", (event) => {
    if (!modal.hidden && event.key === "Escape") close();
  });
  if (savedUnit?.category) category.value = savedUnit.category;
  if (savedUnit?.value !== undefined) fromValue.value = savedUnit.value;
  populate();
}

const unitConverterInitialization = initializeUnitConverter();
window.handyToolInitialization.set("unit-converter", unitConverterInitialization);
unitConverterInitialization.catch((error) => console.error(error));
