const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const rules = require("../addresses/rules");

const body = (over = {}) => ({
  kind: "home", receiverName: "Ravi Kumar", receiverPhone: "98765 43210", house: "Flat 4B, Sai Residency", street: "MG Road, Batawadi",
  landmark: "", city: "Tumakuru", pincode: "572103", formattedAddress: "Sai Residency, MG Road, Batawadi, Tumakuru 572103",
  latitude: 13.3392, longitude: 77.1017, instructions: "", ...over,
});

describe("delivery address rules", () => {
  it("cleans a good address: the phone to 10 digits, blanks to null, spaces collapsed", () => {
    const a = rules.addressBody(body({ house: "  Flat   4B ", landmark: " Opp  SIT ", makeDefault: true }));
    assert.equal(a.receiverPhone, "9876543210");
    assert.equal(a.house, "Flat 4B");
    assert.equal(a.landmark, "Opp SIT");
    assert.equal(a.instructions, null);
    assert.equal(a.makeDefault, true);
    assert.equal(rules.addressBody(body()).makeDefault, false);
  });

  it("refuses missing and bad fields with one friendly line", () => {
    const refused = [
      [body({ kind: "office" }), /Home, Work or Other/],
      [body({ receiverName: "R" }), /too short/],
      [body({ receiverPhone: "12345" }), /receiver's 10-digit mobile/],
      [body({ house: "   " }), /Add the house or flat/],
      [body({ street: "ab" }), /too short/],
      [body({ pincode: "072103" }), /6-digit pincode/],
      [body({ pincode: 572103 }), /6-digit pincode/],
      [body({ latitude: "13.3" }), /map again/],
      [body({ latitude: 51.5, longitude: -0.12 }), /India only/],
      [body({ instructions: "x".repeat(201) }), /200 characters/],
      [body({ house: "Flat\u0007 4B" }), /characters we can't use/],
      [body({ makeDefault: "yes" }), /isn't valid/],
      [{ ...body(), userId: "user_other" }, /fields we don't use/],
      [null, /Send the address/],
      [[body()], /Send the address/],
    ];
    for (const [input, message] of refused) assert.throws(() => rules.addressBody(input), message, JSON.stringify(input)?.slice(0, 60));
  });

  it("keeps SQL-looking text as text (the queries are parameterised; nothing is stripped)", () => {
    assert.equal(rules.addressBody(body({ house: "1'; DROP TABLE user_addresses;--" })).house, "1'; DROP TABLE user_addresses;--");
  });

  it("checks ids and the serviceable query", () => {
    assert.equal(rules.addressId("12"), 12);
    for (const bad of ["0", "-1", "1.5", "abc", "1 OR 1=1", undefined]) assert.throws(() => rules.addressId(bad), /doesn't exist/);
    assert.equal(rules.serviceableQuery({ pincode: "572103" }), "572103");
    assert.throws(() => rules.serviceableQuery({ pincode: "57210" }), /6-digit/);
    assert.throws(() => rules.serviceableQuery({ pincode: "572103", userId: "x" }), /fields we don't use/);
  });
});
