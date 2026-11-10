// Icon colours by meaning (constants/iconColors.ts)
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { iconMeaning, iconTint } from "../iconColors.ts";
import { lightColors } from "../../theme/index.ts";

describe("icon colours by meaning", () => {
  it("names each kind of icon", () => {
    assert.equal(iconMeaning("flame.fill"), "calories");
    assert.equal(iconMeaning("drop"), "water");
    assert.equal(iconMeaning("heart.fill"), "favorite");
    assert.equal(iconMeaning("mappin.and.ellipse"), "location");
    assert.equal(iconMeaning("calendar.badge.plus"), "time");
    assert.equal(iconMeaning("checkmark.circle.fill"), "success");
    assert.equal(iconMeaning("exclamationmark.triangle.fill"), "warning");
    assert.equal(iconMeaning("tag"), "offer");
    for (const plain of ["plus", "chevron.right", "sparkles", "checkmark", "mapping", undefined]) assert.equal(iconMeaning(plain), null, String(plain));
  });

  it("recolours only an icon drawn in the brand green", () => {
    assert.equal(iconTint("flame", lightColors.primary), lightColors.iconCalories);
    assert.equal(iconTint("heart.fill", lightColors.leaf), lightColors.iconFavorite);
    assert.equal(iconTint("flame", lightColors.faint), lightColors.faint, "a grey icon stays grey");
    assert.equal(iconTint("flame", "#FFFFFF"), "#FFFFFF");
    assert.equal(iconTint("plus", lightColors.primary), lightColors.primary, "an action stays green");
    assert.equal(iconTint("flame", undefined), undefined);
  });
});
