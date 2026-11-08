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
  it("reads a list of known options, in the portal's order, each once; an empty list means Home only", () => {
    assert.deepEqual(rules.permissionsBody({ options: ["sms.view", "members.view", "members.view"] }), { options: ["members.view", "sms.view"] });
    assert.deepEqual(rules.permissionsBody({ options: [] }), { options: [] });
    assert.deepEqual(rules.permissionsBody({ options: [...rules.OPTION_IDS].reverse() }), { options: rules.OPTION_IDS });
    // An option brings the one it needs (Add Member needs the member list)
    assert.deepEqual(rules.permissionsBody({ options: ["members.add", "sms.send"] }), { options: ["members.view", "members.add", "sms.view", "sms.send"] });
    // The older body (whole areas) still works: every option of those areas
    assert.deepEqual(rules.permissionsBody({ areas: ["enquiries"] }), { options: ["enquiries.view", "enquiries.edit", "enquiries.contacts"] });
    assert.deepEqual(rules.permissionsBody({ areas: [] }), { options: [] });
    for (const bad of [null, [], "members", { options: "members.view" }, { options: ["team.view"] }, { options: ["members"] }, { options: ["members.view", 1] }, { options: ["members.view"], kind: "staff" }, { options: [], areas: [] }, { options: Array(40).fill("members.view") }, { areas: ["team"] }, {}]) {
      assert.throws(() => rules.permissionsBody(bad), /JSON|options|areas|fields|use/, JSON.stringify(bad));
    }
    assert.throws(() => rules.permissionsBody({ options: ["members.view' OR 1=1"] }), /portal's options/);
  });

  it("what a team row allows: the gym admin everything, Staff what was saved (nothing saved = everything), a trainer nothing", () => {
    assert.deepEqual(rules.optionsOf({ kind: "owner", permissions: '["sms.view"]' }), rules.OPTION_IDS, "the gym admin is never limited");
    assert.deepEqual(rules.areasOf({ kind: "owner", permissions: '["sms"]' }), rules.AREAS);
    assert.deepEqual(rules.optionsOf({ kind: "staff", permissions: null }), rules.OPTION_IDS);
    assert.deepEqual(rules.areasOf({ kind: "staff", permissions: undefined }), rules.AREAS);
    assert.deepEqual(rules.optionsOf({ kind: "staff", permissions: '["sms.send", "sms.view", "members.view"]' }), ["members.view", "sms.view", "sms.send"], "mysql2 may hand JSON back as a string");
    assert.deepEqual(rules.areasOf({ kind: "staff", permissions: '["sms.view", "members.view"]' }), ["members", "sms"]);
    assert.deepEqual(rules.optionsOf({ kind: "staff", permissions: ["payments.wallet", "bogus", "members.bogus"] }), ["payments.wallet"], "or parsed; unknown entries are dropped");
    assert.deepEqual(rules.optionsOf({ kind: "staff", permissions: ["members.add"] }), [], "an option without the one it needs is dropped on read");
    assert.deepEqual(rules.optionsOf({ kind: "staff", permissions: "[]" }), []);
    assert.deepEqual(rules.optionsOf({ kind: "staff", permissions: "not json" }), [], "a corrupt value locks the login down");
    assert.deepEqual(rules.optionsOf({ kind: "trainer", permissions: null }), []);
  });

  it("a list saved before options (whole areas) still means every option of those areas", () => {
    assert.deepEqual(rules.areasOf({ kind: "staff", permissions: '["sms", "members"]' }), ["members", "sms"]);
    assert.deepEqual(rules.optionsOf({ kind: "staff", permissions: '["sms"]' }), ["sms.view", "sms.send", "sms.auto"]);
    assert.deepEqual(rules.areasOf({ kind: "staff", permissions: ["payments", "bogus"] }), ["payments"]);
  });

  it("the tree: every area once, every option under its own area, needs inside the same area", () => {
    const tree = rules.permissionTree();
    assert.deepEqual(tree.map((t) => t.id), rules.AREAS);
    assert.deepEqual(tree.flatMap((t) => t.options.map((o) => o.id)), rules.OPTION_IDS);
    for (const area of tree) {
      assert.ok(area.options.length > 0, area.id);
      for (const o of area.options) {
        assert.ok(o.id.startsWith(`${area.id}.`), o.id);
        assert.equal(typeof o.label, "string");
        if (o.needs) assert.ok(area.options.some((x) => x.id === o.needs && !x.needs), `${o.id} needs ${o.needs}`);
      }
    }
    assert.equal(rules.optionsSummary([]), "Home only");
    assert.equal(rules.optionsSummary(["members.view", "members.add", ...rules.OPTION_IDS.filter((id) => id.startsWith("enquiries."))]), "Members (2 of 5), Enquiries (all)");
  });

  it("which option a request needs", () => {
    const cases = [
      ["GET", "/members", "members.view"], ["GET", "/members/3", "members.view"], ["GET", "/members/3/photo", "members.view"], ["GET", "/members/3/invoice", "members.view"],
      ["GET", "/trainers", "members.view"], ["GET", "/payments/9/receipt", "members.view"], ["GET", "/payments/9/invoice", "members.view"],
      ["GET", "/members/next-code", "members.add"], ["POST", "/members", "members.add"], ["PUT", "/payments/9/receipt", "members.add"], ["DELETE", "/payments/9/receipt", "members.add"],
      ["PATCH", "/members/3", "members.edit"], ["POST", "/members/3/trainer", "members.edit"], ["POST", "/members/3/renew", "members.renew"],
      ["GET", "/pauses", "members.pause"], ["POST", "/pauses/4/approve", "members.pause"], ["POST", "/members/3/pause", "members.pause"],
      ["POST", "/members/3/due", "payments.collect"], ["POST", "/members/3/pt", "payments.pt"], ["POST", "/members/3/sales", "payments.sales"], ["POST", "/members/3/services", "payments.sales"],
      ["POST", "/sales", "payments.sales"], ["POST", "/services", "payments.sales"], ["GET", "/payments", "payments.transactions"], ["GET", "/wallet", "payments.wallet"],
      ["GET", "/enquiries", "enquiries.view"], ["POST", "/enquiries", "enquiries.edit"], ["PATCH", "/enquiries/4", "enquiries.edit"], ["POST", "/enquiries/4/contacts", "enquiries.contacts"],
      ["GET", "/catalog", "catalog.view"], ["GET", "/catalog/2/image", "catalog.view"], ["POST", "/catalog", "catalog.edit"], ["DELETE", "/catalog/2", "catalog.edit"], ["PUT", "/catalog/2/image", "catalog.edit"],
      ["GET", "/attendance", "attendance.view"], ["GET", "/attendance/visits", "attendance.view"], ["GET", "/attendance/export", "attendance.export"], ["GET", "/attendance/settings", "attendance.settings"],
      ["PUT", "/attendance/location", "attendance.settings"], ["POST", "/attendance/qr", "attendance.settings"], ["POST", "/members/3/check-in", "attendance.checkin"], ["POST", "/members/3/check-out", "attendance.checkin"],
      ["GET", "/sms", "sms.view"], ["GET", "/sms/logs", "sms.view"], ["POST", "/sms/send", "sms.send"], ["POST", "/members/3/sms", "sms.send"], ["PATCH", "/sms/settings", "sms.auto"],
      ["GET", "/predictions/renewals", "predictions.renewals"], ["GET", "/predictions/payments", "predictions.payments"], ["GET", "/predictions/busy-hours", "predictions.busy"], ["GET", "/predictions/revenue", "predictions.revenue"],
      ["GET", "/expenses", "expenses.view"], ["GET", "/expenses/7/bill", "expenses.view"], ["POST", "/expenses", "expenses.edit"], ["PUT", "/expenses/7", "expenses.edit"], ["PUT", "/expenses/7/bill", "expenses.edit"],
      ["HEAD", "/wallet", "payments.wallet"], ["get", "/Members/3/", "members.view"], ["POST", "/SMS/send/", "sms.send"],
    ];
    for (const [method, path, option] of cases) assert.ok(rules.optionsOfRequest(method, path)?.includes(option), `${method} ${path}`);
    // The forms that pick a plan or an item may read the price list, never change it or see its images
    for (const id of ["members.add", "members.renew", "payments.pt", "payments.sales"]) assert.ok(rules.optionsOfRequest("GET", "/catalog").includes(id), id);
    assert.equal(rules.optionsOfRequest("GET", "/catalog").includes("members.view"), false);
    assert.equal(rules.optionsOfRequest("POST", "/catalog").includes("members.add"), false);
    assert.deepEqual(rules.optionsOfRequest("GET", "/catalog/2/image"), ["catalog.view"]);
    // A member's photo may be set by Add Member or by Edit
    assert.deepEqual(rules.optionsOfRequest("PUT", "/members/3/photo"), ["members.add", "members.edit"]);
    // A reading option never covers a change, and nothing unknown is matched
    for (const [method, path] of [["POST", "/wallet"], ["DELETE", "/members/3"], ["POST", "/payments"], ["PATCH", "/attendance"], ["GET", "/membersx"], ["GET", "/members/3/due"]]) {
      assert.equal(rules.optionsOfRequest(method, path), null, `${method} ${path}`);
    }
  });

  it("every route of the gym router in an area is covered by an option (a new route can't go unmapped)", () => {
    const { gymRouter } = require("../gym/routes");
    const routes = gymRouter.stack.filter((layer) => layer.route).flatMap((layer) => Object.keys(layer.route.methods).map((m) => [m.toUpperCase(), layer.route.path]));
    assert.ok(routes.length > 50, `found ${routes.length} routes`);
    for (const [method, pattern] of routes) {
      const path = pattern.replace(/:[A-Za-z]+/g, "7");
      if (!rules.areaOfPath(path)) continue;
      const options = rules.optionsOfRequest(method, path);
      assert.ok(options && options.length > 0, `${method} ${pattern} has no option`);
      const shared = rules.CROSS_AREA.find(([m, p]) => m === method && p === path)?.[2] ?? [];
      for (const id of options) if (!shared.includes(id)) assert.equal(id.split(".")[0], rules.areaOfPath(path), `${method} ${pattern} → ${id} is in another area`);
    }
  });

  it("which area a route under /api/gym needs", () => {
    const cases = {
      "/dashboard": null, "/branches": null, "/branch": null, "/details": null, "/staff": null, "/staff/u1/permissions": null, "/invoice-details": null, "/logo": null, "/templates": null, "/templates/due": null,
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

  it("Home's dashboard carries only what the login may see", () => {
    const full = {
      gym: { name: "Forma" },
      today: "2026-11-08",
      revenue: { online: 500, cash: 200 },
      stats: { admission: 1, renewal: 0, enquiry: 2, duePaid: 0, pt: 0, product: 0 },
      alerts: { dueMembers: 3, expiringToday: 1, attendance: 4, expiringSoon: 2, birthdays: 0, pauseRequests: 1, renewalRisk: 5 },
      recent: [{ id: 1, amount: 500 }],
    };
    // The gym admin (every option) sees everything
    assert.deepEqual(rules.dashboardFor(full, rules.OPTION_IDS), full);
    // Home only: no money, no counts, no names
    const bare = rules.dashboardFor(full, []);
    assert.equal(bare.revenue, null);
    assert.equal(bare.stats, null);
    assert.deepEqual(bare.recent, []);
    assert.deepEqual(Object.values(bare.alerts), [null, null, null, null, null, null, null]);
    // Each part follows its own option
    const some = rules.dashboardFor(full, ["home.today", "attendance.view", "predictions.payments"]);
    assert.equal(some.revenue, null);
    assert.deepEqual(some.stats, full.stats);
    assert.deepEqual(some.recent, []);
    assert.equal(some.alerts.attendance, 4);
    assert.equal(some.alerts.dueMembers, 3, "Due Members opens the payment-on-time list");
    assert.equal(some.alerts.expiringToday, null);
    assert.equal(some.alerts.renewalRisk, null);
  });

  it("Home and Reminder Templates are tiles with their own options", () => {
    const tree = rules.permissionTree();
    assert.deepEqual(tree.find((t) => t.id === "home").options.map((o) => o.id), ["home.revenue", "home.today"]);
    assert.deepEqual(tree.find((t) => t.id === "templates").options.map((o) => o.id), ["templates.view"]);
    // A list saved before these tiles existed doesn't gain them (as with Expenses)
    assert.equal(rules.optionsOf({ kind: "staff", permissions: '["members.view"]' }).includes("home.revenue"), false);
    // Never edited: everything, the new tiles included
    assert.ok(rules.optionsOf({ kind: "staff", permissions: null }).includes("home.revenue"));
  });
});
