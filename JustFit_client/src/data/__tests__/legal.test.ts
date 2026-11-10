// The Terms & Conditions and Privacy Policy (data/legal.ts, shown by app/legal/[doc].tsx)
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { LEGAL_DOCS, isLegalDoc } from "../legal.ts";

describe("legal documents", () => {
  it("only the two known pages open", () => {
    assert.equal(isLegalDoc("terms"), true);
    assert.equal(isLegalDoc("privacy"), true);
    for (const other of ["Terms", "", "../terms", undefined, null, ["terms"]]) assert.equal(isLegalDoc(other), false);
  });

  it("every section has a unique heading, words and only https links", () => {
    for (const doc of Object.values(LEGAL_DOCS)) {
      assert.ok(doc.title && doc.intro && doc.sections.length > 0);
      const headings = doc.sections.map((section) => section.heading);
      assert.equal(new Set(headings).size, headings.length, `${doc.title}: repeated heading`);
      for (const section of doc.sections) {
        assert.ok(section.paragraphs.length > 0 && section.paragraphs.every((p) => p.trim().length > 0), section.heading);
        for (const link of section.links ?? []) assert.match(link.url, /^https:\/\//);
      }
    }
  });

  it("the privacy policy names YouTube API Services and links Google's policy (YouTube's rules)", () => {
    const privacy = LEGAL_DOCS.privacy.sections;
    assert.ok(privacy.some((s) => s.paragraphs.some((p) => p.includes("YouTube API Services"))));
    assert.ok(privacy.some((s) => s.links?.some((l) => l.url === "https://policies.google.com/privacy")));
  });
});
