import assert from "node:assert/strict";
import test from "node:test";
import { loadInstaller } from "./installer";

test("a failed module can retry without reloading the app, and concurrent mounts share one load", async () => {
  const originalDocument = Object.getOwnPropertyDescriptor(
    globalThis,
    "document",
  );
  const originalRegistry = Object.getOwnPropertyDescriptor(
    globalThis,
    "customElements",
  );
  let registered = false;
  const scripts: Array<{
    src: string;
    type: string;
    removed: boolean;
    onload: (() => void) | null;
    onerror: (() => void) | null;
    remove(): void;
  }> = [];
  Object.defineProperties(globalThis, {
    document: {
      configurable: true,
      value: {
        createElement: () => {
          const script = {
            src: "",
            type: "",
            removed: false,
            onload: null,
            onerror: null,
            remove() {
              this.removed = true;
            },
          };
          scripts.push(script);
          return script;
        },
        head: { appendChild() {} },
      },
    },
    customElements: {
      configurable: true,
      value: { get: () => (registered ? class {} : undefined) },
    },
  });
  try {
    const failed = loadInstaller();
    assert.equal(loadInstaller(), failed);
    assert.equal(scripts.length, 1);
    scripts[0].onerror?.();
    await assert.rejects(failed, /could not be downloaded/);
    assert.equal(scripts[0].removed, true);

    const retry = loadInstaller();
    assert.equal(scripts.length, 2);
    assert.notEqual(
      scripts[0].src,
      scripts[1].src,
      "retry must bypass the failed module URL cached by the browser",
    );
    registered = true;
    scripts[1].onload?.();
    await retry;
    await loadInstaller();
    assert.equal(
      scripts.length,
      2,
      "an initialized installer does not load again",
    );
  } finally {
    if (originalDocument)
      Object.defineProperty(globalThis, "document", originalDocument);
    else Reflect.deleteProperty(globalThis, "document");
    if (originalRegistry)
      Object.defineProperty(globalThis, "customElements", originalRegistry);
    else Reflect.deleteProperty(globalThis, "customElements");
  }
});
