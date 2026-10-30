(() => {
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true;
  if (isStandalone) return;

  const isIOS = /iphone|ipad|ipod/i.test(window.navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  let installPrompt = null;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "pwa-install-button";
  button.textContent = isIOS ? "Add Clivelle to Home Screen" : "Install Clivelle";
  button.setAttribute("aria-label", "Install Clivelle app");
  button.hidden = !isIOS;
  document.body.appendChild(button);

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
    button.hidden = false;
  });

  window.addEventListener("appinstalled", () => {
    button.hidden = true;
    installPrompt = null;
  });

  button.addEventListener("click", async () => {
    if (isIOS) {
      window.alert('To install Clivelle on iPhone or iPad:\n1. Open this page in Safari.\n2. Tap the Share button.\n3. Choose “Add to Home Screen”.\n4. Tap “Add”.');
      return;
    }
    if (installPrompt) {
      installPrompt.prompt();
      await installPrompt.userChoice;
      installPrompt = null;
      button.hidden = true;
      return;
    }
    window.alert("To install Clivelle, open your browser menu and choose “Install app” or “Add to Home screen”.");
  });

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register(new URL("./service-worker.js", location.href), {
        scope: new URL("./", location.href).pathname
      }).catch((error) => console.warn("Clivelle offline support could not be enabled:", error));
    });
  }
})();
