// Phone sign-in in the app: the number and code input rules, the launch check of the saved
// session, signing out (what it clears, offline, answers that arrive late), where each account
// lands, and the resend countdown. (The server's own rules are
// tested in JustFit_server/__tests__/auth-rules.test.js and e2e/auth.e2e.test.js.)
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { clearAccountData, onAccountCleared, sameAccount } from "../accountScope.ts";
import { devServerHost } from "../apiHost.ts";
import { codeInput, formatIndianMobile, normalizeIndianMobile, phoneInput } from "../phone.ts";
import { afterAccountCheck, afterSignOut, checkSavedSession, homeRouteFor, secondsLeft, UNCONFIRMED_SIGN_OUT } from "../sessionRules.ts";

describe("phone numbers", () => {
  it("accept the usual ways of typing an Indian mobile number, like the server", () => {
    for (const typed of ["9876543210", "98765 43210", "98765-43210", "+919876543210", "+91 98765 43210", "919876543210", "09876543210"]) {
      assert.equal(normalizeIndianMobile(typed), "9876543210", typed);
    }
  });

  it("refuse what isn't one", () => {
    for (const typed of ["", "12345", "98765432", "98765432101", "5876543210", "+1 9876543210", "98765abcde", "' OR '1'='1"]) {
      assert.equal(normalizeIndianMobile(typed), null, typed);
    }
  });

  it("keep the field to 10 digits, dropping a pasted +91 and anything that isn't a digit", () => {
    assert.equal(phoneInput("98765 43210"), "9876543210");
    assert.equal(phoneInput("+91 98765-43210"), "9876543210");
    assert.equal(phoneInput("987654321099"), "9876543210");
    assert.equal(phoneInput("abc"), "");
    assert.equal(formatIndianMobile("9876543210"), "98765 43210");
    assert.equal(formatIndianMobile("+919876543210"), "98765 43210");
    assert.equal(formatIndianMobile(null), "");
  });

  it("codes are six digits from whatever was typed or pasted", () => {
    assert.equal(codeInput("123456"), "123456");
    assert.equal(codeInput(" 12 34 56 "), "123456");
    assert.equal(codeInput("1234567"), "123456");
    assert.equal(codeInput("G-123456"), "123456");
  });
});

describe("the saved session at launch", () => {
  const user = { id: "user_abc", role: "user" as const, profileComplete: false };
  const fakes = (overrides: Partial<Parameters<typeof checkSavedSession>[0]> = {}) => {
    const calls = { fetched: 0, cleared: 0 };
    const deps = {
      readToken: async () => "jfs_saved",
      fetchAccount: async () => { calls.fetched++; return { ok: true as const, data: { user } }; },
      clearToken: async () => { calls.cleared++; },
      ...overrides,
    };
    return { deps, calls };
  };

  it("no saved token: signed out, and the server isn't asked", async () => {
    const { deps, calls } = fakes({ readToken: async () => null });
    assert.deepEqual(await checkSavedSession(deps), { status: "signedOut", token: null, user: null });
    assert.equal(calls.fetched, 0);
  });

  it("a token the server accepts: signed in as the server describes the account", async () => {
    const { deps } = fakes();
    assert.deepEqual(await checkSavedSession(deps), { status: "signedIn", token: "jfs_saved", user });
  });

  it("a token the server refuses (expired, revoked, logged out everywhere): forgotten", async () => {
    const { deps, calls } = fakes({ fetchAccount: async () => ({ ok: false as const, status: 401 }) });
    assert.deepEqual(await checkSavedSession(deps), { status: "signedOut", token: null, user: null });
    assert.equal(calls.cleared, 1);
  });

  it("offline, a server error or a rate limit: the token is kept and nothing is decided about the account", async () => {
    for (const failure of [{ ok: false as const }, { ok: false as const, status: 500 }, { ok: false as const, status: 503 }, { ok: false as const, status: 429 }]) {
      const { deps, calls } = fakes({ fetchAccount: async () => failure });
      assert.deepEqual(await checkSavedSession(deps), { status: "unreachable", token: "jfs_saved", user: null }, JSON.stringify(failure));
      assert.equal(calls.cleared, 0, "a session that may still be valid is never deleted");
    }
  });

  it("a storage that can't be read counts as no saved session", async () => {
    const { deps } = fakes({ readToken: async () => { throw new Error("keychain locked"); } });
    assert.equal((await checkSavedSession(deps)).status, "signedOut");
  });

  it("the answer alone decides: ok → signed in, 401 → signed out, anything else → unreachable", () => {
    assert.equal(afterAccountCheck({ ok: true }), "signedIn");
    assert.equal(afterAccountCheck({ ok: false, status: 401 }), "signedOut");
    assert.equal(afterAccountCheck({ ok: false, status: 403 }), "unreachable");
    assert.equal(afterAccountCheck({ ok: false }), "unreachable");
  });
});

describe("where an account opens", () => {
  it("by the server's role and setup state", () => {
    assert.equal(homeRouteFor({ role: "admin", profileComplete: false }), "/admin");
    assert.equal(homeRouteFor({ role: "user", profileComplete: false }), "/setup/personal");
    assert.equal(homeRouteFor({ role: "user", profileComplete: true }), "/home");
  });
});

describe("the resend countdown", () => {
  it("counts whole seconds down to zero, never below", () => {
    assert.equal(secondsLeft(61_000, 1_000), 60);
    assert.equal(secondsLeft(61_000, 60_500), 1);
    assert.equal(secondsLeft(61_000, 61_000), 0);
    assert.equal(secondsLeft(61_000, 90_000), 0);
  });
});

describe("signing out", () => {
  // A stand-in for a store: what it holds for the signed-in account, and its clear function
  function fakeStore(name: string) {
    const store = { data: null as string | null, load: (value: string) => { store.data = value; } };
    onAccountCleared(() => { store.data = null; });
    store.load(`${name} of account A`);
    return store;
  }

  it("empties every store that registered, whichever way the account ends (sign out, everywhere, a refused token, offline)", () => {
    const feed = fakeStore("feed");
    const intake = fakeStore("coach intake");
    const ownerGym = fakeStore("owner's gym");
    clearAccountData();
    assert.deepEqual([feed.data, intake.data, ownerGym.data], [null, null, null]);
  });

  it("switching accounts: nothing of account A is left once B signs in", () => {
    const cart = fakeStore("cart");
    clearAccountData(); // the auth store does this before keeping B's token
    cart.load("cart of account B");
    assert.equal(cart.data, "cart of account B");
  });

  it("an answer to a request started before the sign-out is dropped, not written into the next account", async () => {
    const home = fakeStore("home targets");
    let answer!: (value: string) => void;
    const request = new Promise<string>((resolve) => { answer = resolve; });
    // What a store does: note the account, wait for the server, keep the answer only if still current
    const loading = (async () => {
      const stillCurrent = sameAccount();
      const value = await request;
      if (stillCurrent()) home.load(value);
    })();
    clearAccountData(); // signed out while the request was on its way
    home.load("home targets of account B");
    answer("home targets of account A (late)");
    await loading;
    assert.equal(home.data, "home targets of account B");
  });

  it("an answer for the same account is kept", async () => {
    const stillCurrent = sameAccount();
    await Promise.resolve();
    assert.equal(stillCurrent(), true);
  });

  it("this device: always signs out; confirmed only when the server answered (a 401 means it had already ended)", () => {
    assert.deepEqual(afterSignOut({ ok: true }, false), { signOut: true, confirmed: true });
    assert.deepEqual(afterSignOut({ ok: false, status: 401 }, false), { signOut: true, confirmed: true });
    assert.deepEqual(afterSignOut({ ok: false }, false), { signOut: true, confirmed: false }, "offline");
    assert.deepEqual(afterSignOut({ ok: false, status: 503 }, false), { signOut: true, confirmed: false }, "server error");
  });

  it("every device: nothing is signed out unless the server confirms", () => {
    assert.deepEqual(afterSignOut({ ok: true }, true), { signOut: true, confirmed: true });
    assert.deepEqual(afterSignOut({ ok: false, status: 401 }, true), { signOut: true, confirmed: true });
    assert.deepEqual(afterSignOut({ ok: false }, true), { signOut: false, confirmed: false });
    assert.deepEqual(afterSignOut({ ok: false, status: 429 }, true), { signOut: false, confirmed: false });
  });

  it("the offline notice says the server side couldn't be confirmed and how to end it", () => {
    assert.match(UNCONFIRMED_SIGN_OUT, /signed out on this device/);
    assert.match(UNCONFIRMED_SIGN_OUT, /couldn't reach justFit/);
    assert.match(UNCONFIRMED_SIGN_OUT, /Sign out of all devices/);
  });
});

describe("finding the development server", () => {
  it("uses hostUri when Expo provides it", () => {
    assert.equal(devServerHost("10.20.0.121:8081", "http://192.168.1.5:8081/index.bundle"), "10.20.0.121");
  });

  it("a local debug build (no hostUri): the computer its JavaScript came from", () => {
    assert.equal(devServerHost(undefined, "http://10.20.0.121:8081/node_modules/expo-router/entry.bundle?platform=ios&dev=true"), "10.20.0.121");
    assert.equal(devServerHost(null, "http://192.168.29.105:8081/index.bundle"), "192.168.29.105");
    assert.equal(devServerHost("", "https://mac.local/index.bundle"), "mac.local");
  });

  it("a release build (bundle inside the app) or nothing at all: no host, so the caller uses its fallback", () => {
    assert.equal(devServerHost(undefined, "file:///var/containers/Bundle/Application/main.jsbundle"), null);
    assert.equal(devServerHost(undefined, undefined), null);
    assert.equal(devServerHost(null, null), null);
  });
});
