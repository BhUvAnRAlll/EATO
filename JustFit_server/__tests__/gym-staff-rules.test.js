// Staff / Admin Login's pure rules (gym/staffRules.js): the add body, who may join a branch's team,
// who may be invited, who may be removed, and the role left after leaving.
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const rules = require("../gym/staffRules.js");

const forma = { id: 1, brandId: 10 };
const member = { role: "user" };

describe("gym staff rules", () => {
  it("reads only a phone and Staff or Trainer", () => {
    assert.deepEqual(rules.addBody({ phone: "98765 43210", kind: "staff" }), { phone: "9876543210", kind: "staff" });
    assert.deepEqual(rules.addBody({ phone: "+919876543210", kind: "trainer" }), { phone: "9876543210", kind: "trainer" });
    for (const kind of ["owner", "admin", "gym_admin", "", undefined, "STAFF"]) assert.throws(() => rules.addBody({ phone: "9876543210", kind }), /Staff or Trainer/, String(kind));
    for (const phone of ["12345", "5876543210", "9876' OR 1=1 --", 9876543210, null]) assert.throws(() => rules.addBody({ phone, kind: "staff" }), { status: 400 }, String(phone));
    assert.throws(() => rules.addBody({ phone: "9876543210", kind: "staff", gymId: 2 }), /fields we don't use/);
    assert.deepEqual(rules.addBody({ phone: "9876543210", kind: "staff", branchId: 7 }), { phone: "9876543210", kind: "staff", branchId: 7 }, "a branch to add them to");
    assert.deepEqual(rules.addBody({ phone: "9876543210", kind: "staff", branchId: null }), { phone: "9876543210", kind: "staff" }, "null: the open branch");
    for (const branchId of [0, -1, 1.5, "7", "7 OR 1=1", [], {}]) assert.throws(() => rules.addBody({ phone: "9876543210", kind: "staff", branchId }), /one of your branches/, JSON.stringify(branchId));
    assert.throws(() => rules.addBody({ phone: "9876543210", kind: "staff", role: "admin" }), /fields we don't use/);
    for (const body of [null, [], "9876543210"]) assert.throws(() => rules.addBody(body), /JSON/);
  });

  it("takes only an account id in the path", () => {
    assert.equal(rules.userIdParam("user_Ab12"), "user_Ab12");
    for (const bad of ["", "user-1", "1 OR 1=1", "../x", "a".repeat(65), undefined]) assert.throws(() => rules.userIdParam(bad), { status: 400 }, String(bad));
  });

  it("lets a member join as Staff or Trainer", () => {
    assert.equal(rules.joinProblem(member, [], forma, "staff"), null);
    assert.equal(rules.joinProblem(member, [], forma, "trainer"), null);
    assert.deepEqual(rules.ROLE_FOR, { owner: "gym_admin", staff: "gym_admin", trainer: "trainer" });
  });

  it("refuses a Super Admin, another gym's people and someone already on the team", () => {
    assert.match(rules.joinProblem({ role: "admin" }, [], forma, "staff"), /can't be added/);
    assert.match(rules.joinProblem({ role: "gym_admin" }, [{ gymId: 5, brandId: 99, kind: "owner" }], forma, "staff"), /another gym/);
    assert.match(rules.joinProblem({ role: "trainer" }, [{ gymId: 1, brandId: 10, kind: "trainer" }], forma, "trainer"), /already on your team/);
    assert.match(rules.joinProblem({ role: "gym_admin" }, [{ gymId: 1, brandId: 10, kind: "owner" }], forma, "staff"), /already on your team/, "the gym admin themselves");
    assert.throws(() => rules.checkJoin({ role: "admin" }, [], forma, "trainer"), { status: 409 });
  });

  it("keeps an account to one kind: portal staff or a trainer, never both", () => {
    const otherBranch = { id: 2, brandId: 10 };
    assert.equal(rules.joinProblem({ role: "gym_admin" }, [{ gymId: 1, brandId: 10, kind: "staff" }], otherBranch, "staff"), null, "Staff at another branch of the same gym");
    assert.equal(rules.joinProblem({ role: "trainer" }, [{ gymId: 1, brandId: 10, kind: "trainer" }], otherBranch, "trainer"), null);
    assert.match(rules.joinProblem({ role: "gym_admin" }, [{ gymId: 1, brandId: 10, kind: "staff" }], otherBranch, "trainer"), /Add them as Staff/);
    assert.match(rules.joinProblem({ role: "trainer" }, [{ gymId: 1, brandId: 10, kind: "trainer" }], otherBranch, "staff"), /Add them as a Trainer/);
    assert.match(rules.joinProblem({ role: "gym_admin" }, [], forma, "trainer"), /Add them as Staff/, "a gym_admin from set-role");
  });

  it("invites a number once per branch, from one gym, as one kind", () => {
    assert.equal(rules.inviteProblem([], forma, "staff"), null);
    assert.equal(rules.inviteProblem([{ gymId: 2, brandId: 10, kind: "staff" }], forma, "staff"), null, "another branch of the same gym");
    assert.match(rules.inviteProblem([{ gymId: 1, brandId: 10, kind: "trainer" }], forma, "staff"), /already been invited/);
    assert.match(rules.inviteProblem([{ gymId: 7, brandId: 70, kind: "staff" }], forma, "staff"), /another gym/);
    assert.match(rules.inviteProblem([{ gymId: 2, brandId: 10, kind: "trainer" }], forma, "staff"), /as Trainer/);
  });

  it("never removes the caller or the gym admin", () => {
    assert.equal(rules.removeProblem("me", { userId: "them", kind: "staff" }), null);
    assert.equal(rules.removeProblem("me", { userId: "them", kind: "trainer" }), null);
    assert.match(rules.removeProblem("me", { userId: "me", kind: "owner" }), /yourself/);
    assert.match(rules.removeProblem("me", { userId: "other_owner", kind: "owner" }), /justFit team/);
  });

  it("makes someone a member again only when no branch is left", () => {
    assert.equal(rules.roleAfterLeaving("gym_admin", 1), "gym_admin");
    assert.equal(rules.roleAfterLeaving("gym_admin", 0), "user");
    assert.equal(rules.roleAfterLeaving("trainer", 0), "user");
    assert.equal(rules.roleAfterLeaving("admin", 0), "admin");
  });

  it("shows only the last three digits of a number", () => {
    assert.equal(rules.maskPhone("9876543210"), "+91 ••••• ••210");
    assert.equal(rules.maskPhone(null), null);
    assert.equal(rules.maskPhone("123"), null);
  });
});

describe("gym staff rules: Role & Permission", () => {
  it("reads a list of known areas, in the portal's order, each once; an empty list means Home only", () => {
    assert.deepEqual(rules.permissionsBody({ areas: ["sms", "members", "members"] }), { areas: ["members", "sms"] });
    assert.deepEqual(rules.permissionsBody({ areas: [] }), { areas: [] });
    assert.deepEqual(rules.permissionsBody({ areas: [...rules.AREAS].reverse() }), { areas: rules.AREAS });
    for (const bad of [null, [], "members", { areas: "members" }, { areas: ["team"] }, { areas: ["members", 1] }, { areas: ["members"], kind: "staff" }, { areas: Array(20).fill("members") }]) {
      assert.throws(() => rules.permissionsBody(bad), /JSON|areas|fields|portal's areas/, JSON.stringify(bad));
    }
    assert.throws(() => rules.permissionsBody({ areas: ["members' OR 1=1"] }), /portal's areas/);
  });

  it("what a team row allows: the gym admin everything, Staff what was saved (nothing saved = everything), a trainer nothing", () => {
    assert.deepEqual(rules.areasOf({ kind: "owner", permissions: '["sms"]' }), rules.AREAS, "the gym admin is never limited");
    assert.deepEqual(rules.areasOf({ kind: "staff", permissions: null }), rules.AREAS);
    assert.deepEqual(rules.areasOf({ kind: "staff", permissions: undefined }), rules.AREAS);
    assert.deepEqual(rules.areasOf({ kind: "staff", permissions: '["sms", "members"]' }), ["members", "sms"], "mysql2 may hand JSON back as a string");
    assert.deepEqual(rules.areasOf({ kind: "staff", permissions: ["payments", "bogus"] }), ["payments"], "or parsed; unknown entries are dropped");
    assert.deepEqual(rules.areasOf({ kind: "staff", permissions: "[]" }), []);
    assert.deepEqual(rules.areasOf({ kind: "trainer", permissions: null }), []);
  });

  it("which area a route under /api/gym needs", () => {
    const cases = {
      "/dashboard": null, "/branches": null, "/branch": null, "/details": null, "/staff": null, "/staff/u1/permissions": null, "/invoice-details": null, "/logo": null,
      "/members": "members", "/members/next-code": "members", "/members/3": "members", "/members/3/renew": "members", "/members/3/photo": "members", "/members/3/trainer": "members", "/trainers": "members",
      "/members/3/due": "payments", "/members/3/pt": "payments", "/members/3/sales": "payments", "/members/3/services": "payments",
      "/payments": "payments", "/sales": "payments", "/services": "payments", "/wallet": "payments", "/payments/9/receipt": "members", "/payments/9/invoice": "members", "/members/3/invoice": "members",
      "/members/3/sms": "sms", "/sms": "sms", "/sms/settings": "sms", "/sms/send": "sms", "/sms/logs": "sms",
      "/members/3/check-in": "attendance", "/members/3/check-out": "attendance", "/attendance": "attendance", "/attendance/qr": "attendance", "/attendance/export": "attendance",
      "/enquiries": "enquiries", "/enquiries/4": "enquiries", "/enquiries/4/contacts": "enquiries",
      "/catalog": "catalog", "/catalog/2": "catalog",
      "/predictions/renewals": "predictions", "/predictions/busy-hours": "predictions", "/predictions/revenue": "predictions",
      "/expenses": "expenses", "/expenses/7": "expenses", "/expenses/7/bill": "expenses",
    };
    for (const [path, area] of Object.entries(cases)) assert.equal(rules.areaOfPath(path), area, path);
    assert.equal(rules.areaOfPath("/membersx"), null, "a prefix is not a match");
    // A changed case or a trailing slash reads as the same area (QA 2026-11-07: the router used to
    // accept both while the map read them as "no area", so Staff could reach any area that way)
    for (const [path, area] of [["/Payments", "payments"], ["/payments/", "payments"], ["/members/5/due/", "payments"], ["/Members/5/DUE", "payments"], ["/SMS/send/", "sms"], ["/Attendance/export", "attendance"], ["/Expenses/", "expenses"], ["/EXPENSES/7/Bill", "expenses"]]) {
      assert.equal(rules.areaOfPath(path), area, path);
    }
  });

  it("whose permissions may be changed: a Staff login other than yourself", () => {
    assert.equal(rules.permissionsProblem("u1", { userId: "u2", kind: "staff" }), null);
    assert.match(rules.permissionsProblem("u1", { userId: "u1", kind: "staff" }), /your own/);
    assert.match(rules.permissionsProblem("u1", { userId: "u2", kind: "owner" }), /Only Staff/);
    assert.match(rules.permissionsProblem("u1", { userId: "u2", kind: "trainer" }), /Only Staff/);
  });

  it("every area has a label for the audit log and the app", () => {
    for (const area of rules.AREAS) assert.equal(typeof rules.AREA_LABEL[area], "string", area);
  });
});
