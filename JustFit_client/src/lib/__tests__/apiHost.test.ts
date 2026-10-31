// Where the app finds the server (lib/apiHost.ts): the development host, and the rule that a
// release build only ever talks HTTPS.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { devServerHost, requireHttpsInRelease } from "../apiHost.ts";

describe("development server host", () => {
  it("prefers Expo's hostUri, then the bundle's address, else nothing", () => {
    assert.equal(devServerHost("10.20.0.121:8081", null), "10.20.0.121");
    assert.equal(devServerHost(null, "http://10.20.0.9:8081/index.bundle?platform=ios"), "10.20.0.9");
    assert.equal(devServerHost(undefined, undefined), null);
  });
});

describe("HTTPS in a release build", () => {
  it("a development build may use a plain-HTTP address (the Mac on the local network)", () => {
    assert.equal(requireHttpsInRelease("http://10.20.0.121:4000", true), "http://10.20.0.121:4000");
  });

  it("a release build accepts only https://", () => {
    assert.equal(requireHttpsInRelease("https://api.justfit.example", false), "https://api.justfit.example");
    assert.equal(requireHttpsInRelease("HTTPS://api.justfit.example", false), "HTTPS://api.justfit.example");
    assert.throws(() => requireHttpsInRelease("http://api.justfit.example", false), /https:\/\/ in a release build/);
    assert.throws(() => requireHttpsInRelease("api.justfit.example", false), /https:\/\/ in a release build/);
  });
});
