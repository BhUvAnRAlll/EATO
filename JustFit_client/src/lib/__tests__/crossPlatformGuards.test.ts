// Source checks for cross-platform bugs found in the 2026-11-08 audit, so they can't come back
// unnoticed. Android draws the app edge to edge: the window never shrinks for the keyboard, and
// every Modal reaches the bottom of the screen under the navigation bar.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it } from "node:test";

const SRC = join(import.meta.dirname, "..", "..");

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__tests__" || name === "node_modules" ? [] : sourceFiles(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
const files = sourceFiles(SRC).map((path) => ({ path: relative(SRC, path), text: readFileSync(path, "utf8") }));

describe("keyboard on Android (edge to edge)", () => {
  it("no KeyboardAvoidingView leaves Android without a behaviour", () => {
    const offenders = files.filter((f) => /behavior=\{Platform\.OS === "ios" \? "padding" : undefined\}/.test(f.text)).map((f) => f.path);
    assert.deepEqual(offenders, [], "Android doesn't resize the window: use KeyboardAvoider");
  });

  it("no screen relies on the iOS-only automaticallyAdjustKeyboardInsets alone", () => {
    const offenders = files.filter((f) => f.text.includes("automaticallyAdjustKeyboardInsets") && !f.text.includes("KeyboardAvoider")).map((f) => f.path);
    assert.deepEqual(offenders, [], "wrap the form in KeyboardAvoider so Android avoids the keyboard too");
  });

  it("KeyboardAvoider pads by the keyboard's height (in layout points) and adds the Android navigation bar back", () => {
    const text = files.find((f) => f.path === join("components", "KeyboardAvoider.tsx"))?.text ?? "";
    assert.match(text, /Keyboard\.addListener/);
    assert.match(text, /keyboard \+ \(Platform\.OS === "android" \? insets\.bottom : 0\)/);
    assert.doesNotMatch(text, /<KeyboardAvoidingView/, "KeyboardAvoidingView mixes real and scaled coordinates");
  });

  it("the gym sheet lifts itself by the keyboard plus the Android navigation bar", () => {
    const text = files.find((f) => f.path === join("components", "gym", "GymSheet.tsx"))?.text ?? "";
    assert.match(text, /Platform\.OS === "android" \? reported \+ insets\.bottom : reported/);
  });
});

describe("bottom sheets clear the navigation bar and home indicator", () => {
  for (const file of ["ActionSheet.tsx", "VerificationModal.tsx", join("macro", "MonthCalendarSheet.tsx"), join("workout", "WorkoutSheet.tsx")]) {
    it(`${file} pads its bottom with the safe-area inset`, () => {
      const text = files.find((f) => f.path === join("components", file))?.text ?? "";
      assert.match(text, /insets\.bottom/);
    });
  }
});

describe("the voice clip is AAC in an m4a file on Android too", () => {
  it("useVoiceClip doesn't use the preset that records 3GP / AMR on Android", () => {
    const text = files.find((f) => f.path === join("lib", "useVoiceClip.ts"))?.text ?? "";
    assert.doesNotMatch(text, /RecordingPresets\.LOW_QUALITY/);
    assert.match(text, /outputFormat: "mpeg4"/);
    assert.match(text, /audioEncoder: "aac"/);
  });
});

describe("text ignores the phone's text-size setting (the owner's choice, 2026-11-08)", () => {
  it("lib/reactNative.js caps Text and TextInput by the screen width and passes every other export through unread", async () => {
    const Module = (await import("node:module")).default as unknown as { _load: (request: string, ...rest: unknown[]) => unknown };
    const original = Module._load;
    let width = 360;
    const fake: Record<string, unknown> = { Text: function Text() {}, TextInput: function TextInput() {}, View: "View", useWindowDimensions: () => ({ width }) };
    // A removed React Native export throws when read (InteractionManager in 0.88): it must never be read
    Object.defineProperty(fake, "InteractionManager", { enumerable: true, get() { throw new Error("read too early"); } });
    Module._load = function load(request: string, ...rest: unknown[]) {
      if (request === "react-native") return fake;
      if (request === "react") return { createElement: (type: unknown, props: Record<string, unknown>) => ({ type, props }) };
      if (request === "../constants/textScale") return { maxTextScaleFor: () => 1 };
      if (request === "../constants/uiScale") return { uiScaleFor: (w: number) => Math.min(1, Math.max(0.8, w / 430)) };
      return original.call(this, request, ...rest);
    };
    try {
      const { createRequire } = await import("node:module");
      const app = createRequire(import.meta.url)("../reactNative.js") as Record<string, (props: Record<string, unknown>) => { props: Record<string, unknown> }> & { View: string };
      assert.equal(app.View, "View");
      // Text ignores the phone's text-size setting on every width (the owner's choice, 2026-11-08)
      assert.equal(app.Text({ children: "x" }).props.maxFontSizeMultiplier, 1);
      width = 440;
      assert.equal(app.TextInput({}).props.maxFontSizeMultiplier, 1);
      assert.equal(app.Text({ maxFontSizeMultiplier: 1.3 }).props.maxFontSizeMultiplier, 1, "a screen can't raise it");
    } finally {
      Module._load = original;
    }
  });

  it("Metro sends the app's own react-native imports to it", () => {
    const metro = readFileSync(join(SRC, "..", "metro.config.js"), "utf8");
    assert.match(metro, /"src", "lib", "reactNative\.js"/);
    assert.match(metro, /moduleName === "react-native" && context\.originModulePath\.startsWith\(appFolder\)/);
  });
});
