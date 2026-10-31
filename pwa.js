(() => {
  // The storefront keeps installation instructions out of the shopping UI.
  // Users can still install from the browser's native Share / Install menu.
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register(new URL("./service-worker.js", location.href), {
        scope: new URL("./", location.href).pathname
      }).catch((error) => console.warn("Clivelle offline support could not be enabled:", error));
    });
  }
})();
