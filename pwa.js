(() => {
  // The storefront keeps installation instructions out of the shopping UI.
  // Users can still install from the browser's native Share / Install menu.
  const isSecureOrigin = location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1";
  if ("serviceWorker" in navigator && isSecureOrigin) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register(new URL("./service-worker.js", location.href), {
        scope: new URL("./", location.href).pathname
      }).catch((error) => console.warn("Clivelle offline support could not be enabled:", error));
    });
  }
})();
