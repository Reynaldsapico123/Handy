async function initializeCalculator() {
  const mount = document.querySelector("#calculatorMount");
  const response = await window.handyFetchToolFragment("calculator");
  if (!response.ok) throw new Error("Could not load the calculator");
  mount.innerHTML = await response.text();

  const modal = document.querySelector("#calculatorModal");
  const output = document.querySelector("#calculatorOutput");
  const preview = document.querySelector("#calculationPreview");
  const grid = document.querySelector("#calculatorGrid");
  const historyList = document.querySelector("#calculatorHistory");
  const historyKey = "handy-calculator-history";
  let expression = "";
  let justCalculated = false;
  let history = readHistory();

  function readHistory() {
    try {
      const saved = JSON.parse(localStorage.getItem(historyKey));
      return Array.isArray(saved)
        ? saved.filter((item) => typeof item.expression === "string" && typeof item.result === "string").slice(0, 10)
        : [];
    } catch {
      return [];
    }
  }

  function renderHistory() {
    historyList.replaceChildren();
    if (!history.length) {
      const empty = document.createElement("p");
      empty.className = "history-empty";
      empty.textContent = "Your calculations will appear here.";
      historyList.appendChild(empty);
      return;
    }

    history.forEach((item, index) => {
      const row = document.createElement("div");
      row.className = "history-item";

      const entry = document.createElement("button");
      entry.type = "button";
      entry.className = "history-entry";
      entry.dataset.historyIndex = index.toString();
      const shownExpression = document.createElement("span");
      shownExpression.className = "history-expression";
      shownExpression.textContent = item.expression;
      const shownResult = document.createElement("span");
      shownResult.className = "history-result";
      shownResult.textContent = item.result;
      entry.append(shownExpression, shownResult);

      const copy = document.createElement("button");
      copy.type = "button";
      copy.className = "history-copy";
      copy.textContent = "Copy";
      copy.setAttribute("aria-label", `Copy result ${item.result}`);
      copy.dataset.copyResult = item.result;
      row.append(entry, copy);
      historyList.appendChild(row);
    });
  }

  function saveCalculation(source, result) {
    history.unshift({
      expression: source.replaceAll("+", " + ").replaceAll("*", " × ").replaceAll("/", " ÷ ").replaceAll("-", " − "),
      result
    });
    history = history.slice(0, 10);
    localStorage.setItem(historyKey, JSON.stringify(history));
    renderHistory();
  }

  renderHistory();

  function calculate(value) {
    const tokens = value.match(/\d*\.?\d+|[+\-*\/]/g);
    if (!tokens) return null;
    let position = 0;

    function number() {
      if (!tokens[position] || /^[+\-*\/]$/.test(tokens[position])) return null;
      return Number(tokens[position++]);
    }

    function factor() {
      let result = number();
      if (result === null) return null;
      while (tokens[position] === "*" || tokens[position] === "/") {
        const operator = tokens[position++];
        const next = number();
        if (next === null) return null;
        if (operator === "/" && next === 0) return Infinity;
        result = operator === "*" ? result * next : result / next;
      }
      return result;
    }

    let result = factor();
    if (result === null) return null;
    while (tokens[position] === "+" || tokens[position] === "-") {
      const operator = tokens[position++];
      const next = factor();
      if (next === null) return null;
      result = operator === "+" ? result + next : result - next;
    }
    return position === tokens.length ? result : null;
  }

  function format(value) {
    if (!Number.isFinite(value)) return "Cannot divide by zero";
    return Number.parseFloat(value.toPrecision(12)).toString();
  }

  function update() {
    preview.textContent = expression
      .replaceAll("+", " + ")
      .replaceAll("*", " × ")
      .replaceAll("/", " ÷ ")
      .replaceAll("-", " − ");
    const current = expression.match(/(\d*\.?\d+)$/);
    output.textContent = expression ? (current ? current[0] : "0") : "0";
  }

  function append(value) {
    const operators = ["+", "-", "*", "/"];
    if (justCalculated) {
      if (!operators.includes(value)) expression = "";
      justCalculated = false;
    }

    if (operators.includes(value)) {
      if (!expression) return;
      expression = operators.includes(expression.at(-1))
        ? expression.slice(0, -1) + value
        : expression + value;
    } else if (value === ".") {
      const current = expression.split(/[+\-*\/]/).at(-1);
      if (!current.includes(".")) {
        expression += expression && !operators.includes(expression.at(-1)) ? "." : "0.";
      }
    } else {
      if (expression === "0") expression = "";
      expression += value;
    }
    update();
  }

  function act(action) {
    if (action === "clear") {
      expression = "";
      justCalculated = false;
    } else if (action === "backspace") {
      expression = expression.slice(0, -1);
      justCalculated = false;
    } else if (action === "sign") {
      const match = expression.match(/(\d*\.?\d+)$/);
      if (match) {
        const start = match.index;
        const number = match[0];
        if (start > 0 && expression[start - 1] === "-") {
          const before = expression.slice(0, start - 1);
          if (before === "" || /^[+\-*\/]$/.test(before.at(-1))) {
            expression = before + number;
          } else {
            expression = expression.slice(0, start) + `-${number}`;
          }
        } else if (expression.startsWith("-") && start === 0) {
          expression = expression.slice(1);
        } else {
          expression = expression.slice(0, start) + `-${number}`;
        }
      }
    } else if (action === "percent") {
      const match = expression.match(/(\d*\.?\d+)$/);
      if (match) expression = expression.slice(0, match.index) + format(Number(match[0]) / 100);
    } else if (action === "equals") {
      if (!expression) return;
      const result = calculate(expression);
      if (result !== null) {
        const source = expression;
        const formatted = format(result);
        preview.textContent = source.replaceAll("+", " + ").replaceAll("*", " × ").replaceAll("/", " ÷ ").replaceAll("-", " − ") + " =";
        output.textContent = formatted;
        if (Number.isFinite(result)) saveCalculation(source, formatted);
        expression = Number.isFinite(result) ? formatted : "";
        justCalculated = true;
      }
    }
    if (action !== "equals") update();
  }

  window.openCalculator = function openCalculator() {
    window.openAccessibleModal(modal);
    modal.hidden = false;
    document.body.style.overflow = "hidden";
    grid.querySelector("[data-value='7']").focus();
  };

  function closeCalculator() {
    modal.hidden = true;
    document.body.style.overflow = "";
    document.querySelector('[aria-label="Open Calculator"]').focus();
  }

  modal.querySelectorAll("[data-close-modal]").forEach((element) => {
    element.addEventListener("click", closeCalculator);
  });

  grid.addEventListener("click", (event) => {
    const key = event.target.closest("button");
    if (!key) return;
    if (key.dataset.value) append(key.dataset.value);
    if (key.dataset.action) act(key.dataset.action);
  });

  historyList.addEventListener("click", async (event) => {
    const copyButton = event.target.closest("[data-copy-result]");
    if (copyButton) {
      try {
        await navigator.clipboard.writeText(copyButton.dataset.copyResult);
        showToast("Result copied");
      } catch {
        showToast("Clipboard is unavailable in this browser");
      }
      return;
    }

    const entryButton = event.target.closest("[data-history-index]");
    if (entryButton) {
      const item = history[Number(entryButton.dataset.historyIndex)];
      if (!item) return;
      expression = item.result;
      justCalculated = true;
      preview.textContent = item.expression + " =";
      output.textContent = item.result;
    }
  });

  document.querySelector("#clearCalculatorHistory").addEventListener("click", () => {
    history = [];
    localStorage.removeItem(historyKey);
    renderHistory();
  });

  document.addEventListener("keydown", (event) => {
    if (modal.hidden) return;
    if (event.key === "Escape") {
      closeCalculator();
    } else if (/^[0-9.]$/.test(event.key)) {
      append(event.key);
    } else if (["+", "-", "*", "/"].includes(event.key)) {
      append(event.key);
    } else if (event.key === "Enter" || event.key === "=") {
      event.preventDefault();
      act("equals");
    } else if (event.key === "Backspace") {
      act("backspace");
    } else if (event.key === "%") {
      act("percent");
    }
  });
}

const calculatorInitialization = initializeCalculator();
window.handyToolInitialization.set("calculator", calculatorInitialization);
calculatorInitialization.catch((error) => console.error(error));
