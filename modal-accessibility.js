(() => {
  const modalSelectors = [
    "#calculatorModal",
    "#unitConverterModal",
    "#timerModal",
    "#guidesModal",
    "#worldClockModal",
    "#currencyModal",
    "#qrModal",
    "#commandPalette",
    "#welcomeModal"
  ];
  const closeButtonSelector = [
    "[data-close-modal]",
    "[data-close-unit]",
    "[data-close-timer]",
    "[data-close-guides]",
    "[data-close-world-clock]",
    "[data-close-currency]",
    "[data-close-qr]",
    "[data-close-command]",
    "[data-close-welcome]"
  ].join(", ");

  let activeModal = null;
  let opener = null;
  const observedModals = new WeakSet();

  function visibleModals() {
    return modalSelectors
      .map((selector) => document.querySelector(selector))
      .filter((modal) => modal && !modal.hidden);
  }

  function focusableElements(modal) {
    return [...modal.querySelectorAll(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], summary, [tabindex]:not([tabindex="-1"])'
    )].filter((element) =>
      element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden"
    );
  }

  function openModal(modal) {
    if (!modal) return;
    if (activeModal !== modal) {
      const focused = document.activeElement;
      opener = focused instanceof HTMLElement && focused !== document.body && focused !== document.documentElement
        ? focused
        : null;
    }

    activeModal = modal;
    document.body.style.overflow = "hidden";
    modal.tabIndex = -1;

    requestAnimationFrame(() => {
      if (activeModal !== modal || modal.contains(document.activeElement)) return;
      (focusableElements(modal)[0] || modal).focus();
    });
  }

  function restoreFocus() {
    const target = opener?.isConnected && !opener.disabled
      ? opener
      : document.querySelector("#tools");
    opener = null;
    target?.focus();
  }

  function closeModal(modal) {
    if (!modal) return;
    modal.hidden = true;
    if (activeModal !== modal) return;
    activeModal = null;
    document.body.style.overflow = "";
    restoreFocus();
  }

  function observeModal(modal) {
    if (observedModals.has(modal)) return;
    observedModals.add(modal);
    modal.tabIndex = -1;

    new MutationObserver(() => {
      if (modal.hidden) {
        if (activeModal === modal) closeModal(modal);
      } else {
        openModal(modal);
      }
    }).observe(modal, { attributes: true, attributeFilter: ["hidden"] });
  }

  function observeInsertedModals(root) {
    if (!(root instanceof Element)) return;
    if (modalSelectors.some((selector) => root.matches(selector))) observeModal(root);
    modalSelectors.forEach((selector) => {
      root.querySelectorAll(selector).forEach(observeModal);
    });
  }

  const existingModals = modalSelectors.flatMap((selector) => [...document.querySelectorAll(selector)]);
  existingModals.forEach(observeModal);
  new MutationObserver((records) => {
    records.forEach((record) => record.addedNodes.forEach(observeInsertedModals));
  }).observe(document.body, { childList: true, subtree: true });

  document.addEventListener("keydown", (event) => {
    const modal = visibleModals().at(-1);
    if (!modal) return;

    if (event.key === "Escape") {
      event.preventDefault();
      const closeButton = modal.querySelector(closeButtonSelector);
      if (closeButton) closeButton.click();
      else closeModal(modal);
      return;
    }

    if (event.key !== "Tab") return;
    const elements = focusableElements(modal);
    if (!elements.length) {
      event.preventDefault();
      modal.focus();
      return;
    }

    const first = elements[0];
    const last = elements.at(-1);
    if (!modal.contains(document.activeElement)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  window.openAccessibleModal = openModal;
  window.closeAccessibleModal = closeModal;
})();
