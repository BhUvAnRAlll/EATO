import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { directionsUrl, distanceText, facilitiesLine, fromPriceText, indiaNow, openNow, planLengthText } from "../gymDiscover.ts";
import type { OpeningHours } from "../gymProfile.ts";

// 2026-11-09 is a Monday; India is UTC+5:30
const at = (time: string) => Date.parse(`2026-11-09T${time}:00+05:30`);
const hours: OpeningHours = { mon: [["05:30", "10:30"], ["16:30", "21:30"]], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [["06:00", "10:00"]] };

describe("Discover Gyms helpers", () => {
  it("writes prices, lengths and distances", () => {
    assert.equal(fromPriceText(1000), "From ₹1,000/month");
    assert.equal(fromPriceText(null), "No plans listed yet");
    assert.equal(planLengthText(1), "1 Month");
    assert.equal(planLengthText(12), "12 Months");
    assert.equal(planLengthText(null, 15), "15 Days");
    assert.equal(distanceText(null), "");
    assert.equal(distanceText(0), "100 m");
    assert.equal(distanceText(0.45), "500 m");
    assert.equal(distanceText(3.24), "3.2 km");
    assert.equal(distanceText(24.4), "24 km");
  });

  it("lists a few facilities, then how many more", () => {
    assert.equal(facilitiesLine([]), "");
    assert.equal(facilitiesLine(["cardio", "parking"]), "Cardio machines · Parking");
    assert.equal(facilitiesLine(["cardio", "parking", "wifi", "yoga", "ac"]), "Cardio machines · Parking · Wi-Fi · +2 more");
  });

  it("reads India's day and time, whatever the phone's zone", () => {
    assert.deepEqual(indiaNow(at("06:15")), { day: "mon", minutes: 375 });
    assert.deepEqual(indiaNow(Date.parse("2026-11-08T20:00:00Z")), { day: "mon", minutes: 90 }, "01:30 Monday in India");
  });

  it("says whether the gym is open now", () => {
    assert.equal(openNow(null, at("06:00")), null);
    assert.deepEqual(openNow(hours, at("06:00")), { open: true, line: "Open now · closes 10:30 am" });
    assert.deepEqual(openNow(hours, at("10:30")), { open: false, line: "Closed now · opens 4:30 pm" });
    assert.deepEqual(openNow(hours, at("05:00")), { open: false, line: "Closed now · opens 5:30 am" });
    assert.deepEqual(openNow(hours, at("22:00")), { open: false, line: "Closed for today" });
    assert.deepEqual(openNow(hours, Date.parse("2026-11-10T09:00:00+05:30")), { open: false, line: "Closed today" });
  });

  it("opens directions by the map place, else the address", () => {
    const gym = { name: "Forma", branch: "Tumkur", area: "SIT Road", city: "Tumakuru", contact: { address: "12, SIT Main Road" } };
    assert.equal(directionsUrl({ ...gym, location: { latitude: 13.3379, longitude: 77.1173 } }), "https://www.google.com/maps/dir/?api=1&destination=13.3379,77.1173");
    assert.equal(directionsUrl({ ...gym, location: null }), "https://www.google.com/maps/search/?api=1&query=Forma%20Tumkur%2C%2012%2C%20SIT%20Main%20Road%2C%20SIT%20Road%2C%20Tumakuru");
  });
});
