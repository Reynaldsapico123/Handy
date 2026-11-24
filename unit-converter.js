async function initializeUnitConverter() {
  const mount = document.querySelector("#unitConverterMount");
  const response = await fetch("unit-converter.html");
  if (!response.ok) throw new Error("Could not load the unit converter");
  mount.innerHTML = await response.text();

  const modal = document.querySelector("#unitConverterModal");
  const category = document.querySelector("#unitCategory");
  const from = document.querySelector("#unitFrom");
  const to = document.querySelector("#unitTo");
  const fromValue = document.querySelector("#unitFromValue");
  const toValue = document.querySelector("#unitToValue");
  const savedUnit = JSON.parse(localStorage.getItem("handy-unit-converter") || "null");

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
    toValue.value = Number(result.toPrecision(12)).toLocaleString();
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
    convert();
  });
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
