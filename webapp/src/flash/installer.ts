let pending: Promise<void> | undefined;
let attempts = 0;

/** Load ESP Web Tools only when a firmware panel needs it, including in-app navigation. */
export function loadInstaller(): Promise<void> {
  if (customElements.get("esp-web-install-button")) return Promise.resolve();
  if (pending) return pending;
  pending = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.type = "module";
    // Browsers retain failed module fetches for the life of the document.
    // A retry needs a fresh URL to make another network request.
    script.src = `/flash/install-button.js${attempts > 0 ? `?retry=${attempts}` : ""}`;
    attempts++;
    script.onload = () => {
      if (customElements.get("esp-web-install-button")) resolve();
      else {
        script.remove();
        reject(new Error("The installer did not initialize."));
      }
    };
    script.onerror = () => {
      script.remove();
      reject(new Error("The installer could not be downloaded."));
    };
    document.head.appendChild(script);
  }).catch((error) => {
    pending = undefined;
    throw error;
  });
  return pending;
}
