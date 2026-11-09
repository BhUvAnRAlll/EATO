import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { addressLines, formProblem, phoneDigits, phoneText, placeFromGeocode, unnamedPlace, type AddressForm } from "../addressRules.ts";

const at = { latitude: 13.3392, longitude: 77.1017 };
const form = (over: Partial<AddressForm> = {}): AddressForm => ({
  receiverName: "Ravi Kumar", receiverPhone: "9876543210", house: "Flat 4B, Sai Residency", street: "MG Road, Batawadi",
  landmark: "", city: "Tumakuru", pincode: "572103", instructions: "", ...over,
});

describe("delivery address rules", () => {
  it("reads the pin's place from the phone's geocoder", () => {
    const place = placeFromGeocode({ name: "Sai Residency", street: "MG Road", district: "Batawadi", city: "Tumakuru", region: "Karnataka", postalCode: "572103", formattedAddress: null }, at);
    assert.equal(place.title, "Sai Residency");
    assert.equal(place.street, "MG Road, Batawadi");
    assert.equal(place.city, "Tumakuru");
    assert.equal(place.pincode, "572103");
    assert.equal(place.formattedAddress, "Sai Residency, MG Road, Batawadi, Tumakuru, Karnataka, 572103");
    assert.deepEqual([place.latitude, place.longitude], [at.latitude, at.longitude]);
  });

  it("skips a house number or plus code as the title, and a pincode that isn't one", () => {
    assert.equal(placeFromGeocode({ name: "12", district: "Batawadi", postalCode: "5721" }, at).title, "Batawadi");
    assert.equal(placeFromGeocode({ name: "7JCQ+4X", street: "MG Road" }, at).title, "MG Road");
    assert.equal(placeFromGeocode({ name: "12", postalCode: "5721" }, at).pincode, "");
    assert.equal(placeFromGeocode({ formattedAddress: "Android's own line" }, at).formattedAddress, "Android's own line");
  });

  it("falls back to coordinates when the phone can't name the place", () => {
    const place = unnamedPlace(at);
    assert.equal(place.title, "Pinned location");
    assert.equal(place.formattedAddress, "13.33920, 77.10170");
  });

  it("keeps a mobile number to its 10 digits", () => {
    assert.equal(phoneDigits("+91 98765 43210"), "9876543210");
    assert.equal(phoneDigits("09876543210"), "9876543210");
    assert.equal(phoneDigits("98765-432"), "98765432");
    assert.equal(phoneText("9876543210"), "+91 98765 43210");
  });

  it("names the form's first problem, in field order", () => {
    assert.equal(formProblem(form()), null);
    assert.equal(formProblem(form({ receiverName: " R " })), "Add the receiver's name.");
    assert.equal(formProblem(form({ receiverPhone: "5876543210" })), "Enter the receiver's 10-digit mobile number.");
    assert.equal(formProblem(form({ house: "  " })), "Add the house, flat or building.");
    assert.equal(formProblem(form({ street: "ab" })), "Add the apartment, street and area.");
    assert.equal(formProblem(form({ pincode: "072103" })), "Enter the 6-digit pincode.");
    assert.equal(formProblem(form({ landmark: "x" })), "The landmark is too short.");
  });

  it("writes a card's lines without repeating the city", () => {
    assert.deepEqual(addressLines({ house: "Flat 4B", street: "MG Road, Tumakuru", landmark: "SIT college", city: "tumakuru", pincode: "572103" }), {
      first: "Flat 4B",
      second: "MG Road, Tumakuru 572103",
      landmark: "Near SIT college",
    });
  });
});
