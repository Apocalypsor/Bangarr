import { expect, test } from "bun:test";
import { copyText } from "@page/lib/clipboard";

test("clipboard fallback works without secure-context API and restores focus", async () => {
  const originals = ["navigator", "document", "HTMLElement"].map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  );
  let selected = false;
  let removed = false;
  let focused = false;
  let copied = "";
  class Element {
    focus() {
      focused = true;
    }
  }
  const textarea = {
    value: "",
    readOnly: false,
    style: { cssText: "" },
    select: () => {
      selected = true;
    },
    setSelectionRange: () => {},
    remove: () => {
      removed = true;
    },
  };
  const document = {
    activeElement: new Element(),
    getSelection: () => null,
    createElement: () => textarea,
    body: { append: () => {} },
    execCommand: () => {
      copied = textarea.value;
      return true;
    },
  };
  try {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {},
    });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: document,
    });
    Object.defineProperty(globalThis, "HTMLElement", {
      configurable: true,
      value: Element,
    });
    await copyText("http://nas:8000/api/webhooks/plex/test");
    expect(selected && removed && focused).toBe(true);
    expect(copied).toBe("http://nas:8000/api/webhooks/plex/test");
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        clipboard: {
          writeText: async () => {
            throw new Error("Denied");
          },
        },
      },
    });
    await copyText("permission-fallback");
    expect(copied).toBe("permission-fallback");
    document.execCommand = () => false;
    await expect(copyText("failure")).rejects.toThrow("手动复制");
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
