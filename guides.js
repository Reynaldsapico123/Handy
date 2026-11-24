async function initializeGuides() {
  const mount = document.querySelector("#guidesMount");
  const response = await fetch("guides.html");
  if (!response.ok) throw new Error("Could not load the guides");
  mount.innerHTML = await response.text();

  const modal = document.querySelector("#guidesModal");
  window.openGuides = function () {
    window.openAccessibleModal(modal);
    modal.hidden = false;
    document.body.style.overflow = "hidden";
  };

  function close() {
    modal.hidden = true;
    document.body.style.overflow = "";
  }

  modal.querySelectorAll("[data-close-guides]").forEach((element) => element.addEventListener("click", close));
  document.addEventListener("keydown", (event) => {
    if (!modal.hidden && event.key === "Escape") close();
  });
}

const guidesInitialization = initializeGuides();
window.handyToolInitialization.set("guides", guidesInitialization);
guidesInitialization.catch((error) => console.error(error));
