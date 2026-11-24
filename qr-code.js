async function initializeQrCode() {
  const mount = document.querySelector("#qrCodeMount");
  const response = await window.handyFetchToolFragment("qr-code");
  if (!response.ok) throw new Error("Could not load the QR code maker");
  mount.innerHTML = await response.text();

  const modal = document.querySelector("#qrModal");
  const text = document.querySelector("#qrText");
  const foreground = document.querySelector("#qrForeground");
  const background = document.querySelector("#qrBackground");
  const canvas = document.querySelector("#qrCanvas");
  const preview = document.querySelector("#qrPreview");
  const creator = document.querySelector("#qrCreator");
  const scanner = document.querySelector("#qrScanner");
  const scanStatus = document.querySelector("#qrScanStatus");
  const scanResult = document.querySelector("#qrScanResult");
  const scanText = document.querySelector("#qrScanText");
  const scanCanvas = document.querySelector("#qrScanCanvas");
  const scanRetry = document.querySelector("#qrScanRetry");
  const imageInput = document.querySelector("#qrImageInput");
  const scanContext = scanCanvas.getContext("2d", { willReadFrequently: true });
  const cameraFrameElement = document.querySelector("#qrCameraFrame");
  const cameraVideo = document.querySelector("#qrCameraVideo");
  const cameraStart = document.querySelector("#qrCameraStart");
  const cameraSwitch = document.querySelector("#qrCameraSwitch");
  const flashlightToggle = document.querySelector("#qrFlashlightToggle");
  const cameraStop = document.querySelector("#qrCameraStop");
  let lastQrDataUrl = "";
  let cameraStream = null;
  let cameraFrame = 0;
  let cameraFacingMode = "environment";
  let flashlightEnabled = false;
  let lastScanAction = "image";
  const savedQr = JSON.parse(localStorage.getItem("handy-qr-settings") || "null");
  if (savedQr) {
    text.value = savedQr.text || text.value;
    foreground.value = savedQr.foreground || foreground.value;
    background.value = savedQr.background || background.value;
  }

  async function generateQr() {
    const value = text.value.trim();
    localStorage.setItem("handy-qr-settings", JSON.stringify({
      text: text.value,
      foreground: foreground.value,
      background: background.value
    }));
    if (!value) {
      preview.classList.remove("generated");
      lastQrDataUrl = "";
      return;
    }
    if (typeof qrcode !== "function") {
      showToast("QR library unavailable");
      return;
    }
    try {
      const qr = qrcode(0, "M");
      qr.addData(value);
      qr.make();

      const context = canvas.getContext("2d");
      const size = 220;
      const margin = 8;
      const moduleCount = qr.getModuleCount();
      const moduleSize = (size - margin * 2) / moduleCount;
      canvas.width = size;
      canvas.height = size;
      context.fillStyle = background.value;
      context.fillRect(0, 0, size, size);
      context.fillStyle = foreground.value;

      for (let row = 0; row < moduleCount; row += 1) {
        for (let column = 0; column < moduleCount; column += 1) {
          if (qr.isDark(row, column)) {
            context.fillRect(
              margin + column * moduleSize,
              margin + row * moduleSize,
              moduleSize,
              moduleSize
            );
          }
        }
      }
      preview.classList.add("generated");
      lastQrDataUrl = canvas.toDataURL("image/png");
    } catch (error) {
      preview.classList.remove("generated");
      lastQrDataUrl = "";
      showToast("Could not generate this QR code");
    }
  }

  document.querySelector("#qrGenerate").addEventListener("click", generateQr);
  text.addEventListener("input", () => {
    if (!text.value.trim()) preview.classList.remove("generated");
  });
  foreground.addEventListener("input", generateQr);
  background.addEventListener("input", generateQr);

  document.querySelector("#qrCopy").addEventListener("click", async () => {
    if (!lastQrDataUrl) await generateQr();
    if (!lastQrDataUrl) return;
    try {
      const response = await fetch(lastQrDataUrl);
      const blob = await response.blob();
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      showToast("QR code copied");
    } catch {
      showToast("Copy unavailable in this browser");
    }
  });

  document.querySelector("#qrDownload").addEventListener("click", async () => {
    if (!lastQrDataUrl) await generateQr();
    if (!lastQrDataUrl) return;
    const link = document.createElement("a");
    link.download = "handy-qr-code.png";
    link.href = lastQrDataUrl;
    link.click();
  });

  function showScanStatus(message, isError = false) {
    scanStatus.textContent = message;
    scanStatus.classList.toggle("error", isError);
    scanRetry.hidden = !isError;
    if (isError) scanRetry.setAttribute("aria-label", "Try again, retry QR scan");
  }

  scanRetry.addEventListener("click", () => {
    if (lastScanAction === "camera") {
      cameraStart.click();
    } else {
      imageInput.click();
    }
  });

  function displayScanResult(value) {
    scanText.textContent = value;
    scanResult.hidden = false;
    showScanStatus("QR code scanned successfully.");
    stopCamera();
  }

  function scanImageData(imageData) {
    if (typeof jsQR !== "function") {
      showScanStatus("QR scanning library is unavailable. Reload the page and try again.", true);
      return;
    }
    const code = jsQR(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: "attemptBoth"
    });
    if (code) displayScanResult(code.data);
    else showScanStatus("No QR code found in that image. Try a clearer image.", true);
  }

  document.querySelector("#qrImageInput").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    lastScanAction = "image";
    scanRetry.hidden = true;
    if (!file.type.startsWith("image/")) {
      showScanStatus("Choose an image file to scan.", true);
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      showScanStatus("Image is too large. Choose an image under 12 MB.", true);
      return;
    }

    try {
      showScanStatus("Scanning image…");
      scanResult.hidden = true;
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
      scanCanvas.width = Math.max(1, Math.round(bitmap.width * scale));
      scanCanvas.height = Math.max(1, Math.round(bitmap.height * scale));
      scanContext.drawImage(bitmap, 0, 0, scanCanvas.width, scanCanvas.height);
      bitmap.close();
      scanImageData(scanContext.getImageData(0, 0, scanCanvas.width, scanCanvas.height));
    } catch (error) {
      showScanStatus("Could not read that image. Try another image.", true);
    }
    event.target.value = "";
  });

  function stopCamera() {
    if (cameraFrame) cancelAnimationFrame(cameraFrame);
    cameraFrame = 0;
    if (cameraStream) {
      cameraStream.getTracks().forEach((track) => track.stop());
      cameraStream = null;
    }
    cameraVideo.pause();
    cameraVideo.srcObject = null;
    cameraFrameElement.hidden = true;
    cameraVideo.hidden = true;
    cameraStart.hidden = false;
    cameraSwitch.hidden = true;
    flashlightEnabled = false;
    flashlightToggle.hidden = true;
    flashlightToggle.textContent = "Turn flashlight on";
    flashlightToggle.setAttribute("aria-pressed", "false");
    cameraStop.hidden = true;
  }

  async function startCamera(facingMode) {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: facingMode } }
    });
    cameraStream = stream;
    cameraFacingMode = facingMode;
    cameraVideo.srcObject = stream;
    const videoTrack = stream.getVideoTracks()[0];
    const supportsFlashlight = typeof videoTrack?.getCapabilities === "function"
      && typeof videoTrack.applyConstraints === "function"
      && videoTrack.getCapabilities().torch === true;
    cameraFrameElement.hidden = false;
    cameraVideo.hidden = false;
    cameraStart.hidden = true;
    cameraSwitch.hidden = false;
    cameraSwitch.setAttribute(
      "aria-label",
      facingMode === "environment" ? "Switch to front camera" : "Switch to rear camera"
    );
    flashlightToggle.hidden = !supportsFlashlight;
    cameraStop.hidden = false;
    await cameraVideo.play();
    showScanStatus("Align the QR code inside the frame.");
    cameraFrame = requestAnimationFrame(scanCameraFrame);
  }

  function scanCameraFrame() {
    if (!cameraStream || cameraVideo.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      cameraFrame = requestAnimationFrame(scanCameraFrame);
      return;
    }

    scanCanvas.width = cameraVideo.videoWidth;
    scanCanvas.height = cameraVideo.videoHeight;
    scanContext.drawImage(cameraVideo, 0, 0, scanCanvas.width, scanCanvas.height);
    const code = jsQR(scanContext.getImageData(0, 0, scanCanvas.width, scanCanvas.height).data, scanCanvas.width, scanCanvas.height, {
      inversionAttempts: "attemptBoth"
    });
    if (code) {
      displayScanResult(code.data);
      return;
    }
    cameraFrame = requestAnimationFrame(scanCameraFrame);
  }

  cameraStart.addEventListener("click", async () => {
    lastScanAction = "camera";
    scanRetry.hidden = true;
    if (!navigator.mediaDevices?.getUserMedia) {
      showScanStatus("Camera scanning requires HTTPS and a supported browser. Upload an image instead.", true);
      return;
    }
    try {
      showScanStatus("Requesting camera access…");
      scanResult.hidden = true;
      await startCamera(cameraFacingMode);
    } catch (error) {
      stopCamera();
      const cameraErrorMessages = {
        NotAllowedError: "Camera permission was denied. Allow camera access or upload an image.",
        NotFoundError: "No camera was found on this device. Upload an image to scan instead.",
        NotReadableError: "Camera is busy or unavailable. Close other camera apps or upload an image.",
        OverconstrainedError: "This camera cannot meet the requested settings. Upload an image to scan instead.",
        SecurityError: "Camera access is blocked. Open this site over HTTPS or upload an image."
      };
      const message = cameraErrorMessages[error.name] || "Could not access a camera. Upload an image to scan instead.";
      showScanStatus(message, true);
    }
  });

  cameraSwitch.addEventListener("click", async () => {
    if (!cameraStream) return;
    const nextFacingMode = cameraFacingMode === "environment" ? "user" : "environment";
    stopCamera();
    cameraStart.hidden = true;
    showScanStatus("Switching cameras…");
    try {
      await startCamera(nextFacingMode);
    } catch (error) {
      stopCamera();
      showScanStatus("Could not switch cameras. Restart the camera or upload an image.", true);
    }
  });

  flashlightToggle.addEventListener("click", async () => {
    const videoTrack = cameraStream?.getVideoTracks()[0];
    if (!videoTrack || flashlightToggle.hidden) return;
    const nextState = !flashlightEnabled;
    try {
      await videoTrack.applyConstraints({ advanced: [{ torch: nextState }] });
      flashlightEnabled = nextState;
      flashlightToggle.textContent = nextState ? "Turn flashlight off" : "Turn flashlight on";
      flashlightToggle.setAttribute("aria-pressed", nextState.toString());
      showScanStatus(
        `${nextState ? "Flashlight on" : "Flashlight off"}. Align the QR code inside the frame.`
      );
    } catch (error) {
      showScanStatus("Could not change the flashlight setting on this camera.", true);
    }
  });

  cameraStop.addEventListener("click", () => {
    stopCamera();
    showScanStatus("Camera stopped. Choose an image or start the camera again.");
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden || !cameraStream) return;
    stopCamera();
    showScanStatus("Camera stopped because you left this tab. Choose Use camera to restart.");
  });

  document.querySelector("#qrGenerateTab").addEventListener("click", () => {
    creator.hidden = false;
    scanner.hidden = true;
    document.querySelector("#qrGenerateTab").classList.add("active");
    document.querySelector("#qrGenerateTab").setAttribute("aria-selected", "true");
    document.querySelector("#qrScanTab").classList.remove("active");
    document.querySelector("#qrScanTab").setAttribute("aria-selected", "false");
    stopCamera();
  });

  document.querySelector("#qrScanTab").addEventListener("click", () => {
    creator.hidden = true;
    scanner.hidden = false;
    document.querySelector("#qrScanTab").classList.add("active");
    document.querySelector("#qrScanTab").setAttribute("aria-selected", "true");
    document.querySelector("#qrGenerateTab").classList.remove("active");
    document.querySelector("#qrGenerateTab").setAttribute("aria-selected", "false");
    showScanStatus("Choose a QR image or start the camera.");
  });

  document.querySelector("#qrScanCopy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(scanText.textContent);
      showToast("Scanned text copied");
    } catch {
      showToast("Clipboard is unavailable in this browser");
    }
  });

  window.openQrCode = function (mode = "create", preset) {
    if (typeof preset?.qrText === "string") text.value = preset.qrText;
    window.openAccessibleModal(modal);
    modal.hidden = false;
    document.body.style.overflow = "hidden";
    if (mode === "scan") {
      document.querySelector("#qrScanTab").click();
      cameraStart.focus();
    } else {
      document.querySelector("#qrGenerateTab").click();
      text.focus();
      generateQr();
    }
  };

  function close() {
    stopCamera();
    modal.hidden = true;
    document.body.style.overflow = "";
  }

  modal.querySelectorAll("[data-close-qr]").forEach((element) => {
    element.addEventListener("click", close);
  });
  document.addEventListener("keydown", (event) => {
    if (!modal.hidden && event.key === "Escape") close();
  });
}

const qrCodeInitialization = initializeQrCode();
window.handyToolInitialization.set("qr", qrCodeInitialization);
qrCodeInitialization.catch((error) => console.error(error));
