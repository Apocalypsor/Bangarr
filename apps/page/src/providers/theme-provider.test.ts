import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

test("the document sets saved or system theme before loading the application", () => {
  const html = readFileSync(
    new URL("../../index.html", import.meta.url),
    "utf8",
  );
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  if (!script) throw new Error("Missing theme bootstrap");
  expect(html.indexOf(script)).toBeLessThan(html.indexOf("<body>"));
  for (const [saved, system, expected] of [
    ["dark", false, true],
    ["light", true, false],
    ["system", true, true],
    [null, false, false],
  ] as const) {
    let dark = false;
    const root = {
      classList: {
        toggle: (_name: string, value: boolean) => {
          dark = value;
        },
      },
      style: { colorScheme: "" },
    };
    runInNewContext(script, {
      localStorage: { getItem: () => saved },
      matchMedia: () => ({ matches: system }),
      document: { documentElement: root },
    });
    expect(dark).toBe(expected);
    expect(root.style.colorScheme).toBe(expected ? "dark" : "light");
  }
});
