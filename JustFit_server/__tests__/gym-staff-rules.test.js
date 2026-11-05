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
