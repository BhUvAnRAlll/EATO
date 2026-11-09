// Gym registration and approval (Gym Hub ecosystem phase 1, 2026-11-09): the application's fields,
// what must be there to submit, the review's allowed steps and reasons, and the document checks
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const rules = require("../gym/registrationRules");
const { decodeBase64, sniffMediaType } = require("../bodyComposition/upload");

const PDF = Buffer.from("%PDF-1.4\n%test\n").toString("base64");
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]).toString("base64");
const check = (body) => rules.checkDocument(body, { decodeBase64, sniffMediaType });

describe("Gym registration rules", () => {
  it("starts an application with the gym's name, area and city; the branch defaults to Main", () => {
    assert.deepEqual(rules.applicationBody({ gymName: "Iron House", area: "Indiranagar", city: "Bengaluru" }, { creating: true }), {
      gymName: "Iron House", branch: "Main", area: "Indiranagar", city: "Bengaluru",
    });
    assert.throws(() => rules.applicationBody({ gymName: "Iron House", city: "Bengaluru" }, { creating: true }), /area/);
  });

  it("checks every field and refuses anything else", () => {
    const out = rules.applicationBody({ contactPhone: "+91 98450 12345", pincode: "560038", businessType: "llp", contactEmail: "Owner@Gym.IN", latitude: 12.97, longitude: 77.64 }, { creating: false });
    assert.equal(out.contactPhone, "9845012345");
    assert.equal(out.contactEmail, "owner@gym.in");
    assert.equal(out.businessType, "llp");
    assert.deepEqual([out.latitude, out.longitude], [12.97, 77.64]);
    assert.throws(() => rules.applicationBody({ pincode: "060038" }, { creating: false }), /pincode/);
    assert.throws(() => rules.applicationBody({ businessType: "trust" }, { creating: false }), /type of business/);
    assert.throws(() => rules.applicationBody({ latitude: 51.5, longitude: -0.1 }, { creating: false }), /India/);
    assert.throws(() => rules.applicationBody({ latitude: 12.9 }, { creating: false }), /map/);
    assert.throws(() => rules.applicationBody({ status: "approved" }, { creating: false }), /fields/);
    assert.throws(() => rules.applicationBody({ applicantId: "someone" }, { creating: false }), /fields/);
    assert.throws(() => rules.applicationBody({}, { creating: false }), /at least one/);
  });

  it("lists what is missing before submitting, including an address proof", () => {
    const empty = rules.missing({}, []);
    assert.ok(empty.some((m) => m.text === "An address proof"));
    assert.ok(empty.some((m) => m.key === "business"));
    const full = { businessType: "individual", contactName: "Ravi", contactPhone: "9845012345", address: "12 MG Road", state: "Karnataka", pincode: "560001", about: "A gym", hours: { mon: [] } };
    assert.deepEqual(rules.missing(full, ["address"]), []);
    assert.equal(rules.missing(full, ["registration"]).length, 1);
  });

  it("allows each step only from the right states", () => {
    assert.equal(rules.transitionProblem("submit", "draft"), null);
    assert.equal(rules.transitionProblem("submit", "rejected"), null);
    assert.match(rules.transitionProblem("submit", "pending_review"), /can't/);
    assert.equal(rules.transitionProblem("approve", "pending_review"), null);
    assert.equal(rules.transitionProblem("approve", "submitted"), null);
    assert.match(rules.transitionProblem("approve", "draft"), /can't/);
    assert.match(rules.transitionProblem("approve", "suspended"), /can't/);
    assert.equal(rules.transitionProblem("suspend", "approved"), null);
    assert.match(rules.transitionProblem("suspend", "pending_review"), /can't/);
    assert.equal(rules.transitionProblem("reactivate", "suspended"), null);
    assert.match(rules.transitionProblem("reactivate", "approved"), /can't/);
    assert.match(rules.transitionProblem("delete", "approved"), /isn't something/);
    assert.equal(rules.ACTIONS.request_documents.to, "draft");
  });

  it("needs a reason to reject, suspend or ask for something, and refuses the applicant's own step", () => {
    assert.throws(() => rules.decisionBody({ action: "reject" }), /why/);
    assert.throws(() => rules.decisionBody({ action: "suspend", note: "  " }), /why/);
    assert.throws(() => rules.decisionBody({ action: "request_documents", note: "pls" }), /little more/);
    assert.deepEqual(rules.decisionBody({ action: "reject", note: "The address proof is unreadable." }), { action: "reject", note: "The address proof is unreadable." });
    assert.deepEqual(rules.decisionBody({ action: "approve" }), { action: "approve", note: null });
    assert.throws(() => rules.decisionBody({ action: "submit" }), /Pick/);
    assert.throws(() => rules.decisionBody({ action: "approve", userId: "x" }), /fields/);
  });

  it("accepts photos and PDFs from their bytes only", () => {
    const ok = check({ kind: "address", data: PDF, mediaType: "application/pdf" });
    assert.equal(ok.ok, true);
    assert.equal(ok.mediaType, "application/pdf");
    assert.equal(check({ kind: "address", data: PDF, mediaType: "image/png" }).status, 415);
    assert.equal(check({ kind: "address", data: PNG, mediaType: "image/png" }).ok, true);
    assert.equal(check({ kind: "address", data: Buffer.from("<html>").toString("base64"), mediaType: "text/html" }).status, 415);
    assert.equal(check({ kind: "passport", data: PDF, mediaType: "application/pdf" }).status, 400);
    assert.equal(check({ kind: "address", data: PDF, mediaType: "application/pdf", path: "../x" }).status, 400);
    const big = Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(rules.DOCUMENT_MAX_BYTES)]).toString("base64");
    assert.equal(check({ kind: "address", data: big, mediaType: "application/pdf" }).status, 413);
  });

  it("filters the Super Admin's list by status", () => {
    assert.deepEqual(rules.listQuery({}), { status: "all" });
    assert.deepEqual(rules.statusesFor("review"), ["submitted", "pending_review"]);
    assert.equal(rules.statusesFor("all"), null);
    assert.throws(() => rules.listQuery({ status: "approved' OR 1=1" }), /Pick/);
  });
});
