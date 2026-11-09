import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { barShare, basedOnText, forecastLines, hourText, liveText, peopleText, slotText, type CrowdForecast, type LiveCrowd } from "../gymCrowdRules.ts";

const live = (over: Partial<LiveCrowd>): LiveCrowd => ({ kind: "live", available: true, reason: null, inside: 14, leftWithoutCheckout: 0, capacity: 20, percent: 70, level: "busy", updatedAt: "2026-11-10T12:00:00.000Z", lastCheckInAt: null, ...over });

describe("Gym crowd words", () => {
  it("names hours and slots", () => {
    assert.deepEqual([0, 6, 12, 18].map(hourText), ["12 am", "6 am", "12 pm", "6 pm"]);
    assert.equal(slotText(18), "6–7 pm");
    assert.equal(slotText(11), "11 am–12 pm");
    assert.equal(slotText(23), "11 pm–12 am");
  });

  it("says how many people, never a made-up level", () => {
    assert.equal(peopleText(0), "usually no one");
    assert.equal(peopleText(0.3), "a person now and then");
    assert.equal(peopleText(3.4), "about 3 people");
    assert.deepEqual(liveText(live({})), { title: "14 people inside", line: "70% of 20 · Busy" });
    assert.match(liveText(live({ available: false, reason: "no_capacity", capacity: null, percent: null, level: null })).line, /capacity/);
    assert.match(liveText(live({ available: false, reason: "no_attendance" })).title, /isn't available/);
  });

  it("lists the forecast's facts only when there is enough history", () => {
    const thin: CrowdForecast = { kind: "forecast", enough: false, basedOnDays: 6, relativeLevels: false, today: null, tomorrow: null, week: [] };
    assert.deepEqual(forecastLines(thin), []);
    const h = (hour: number, expected: number) => ({ hour, expected, level: "low" as const });
    const f: CrowdForecast = {
      ...thin,
      enough: true,
      today: { date: "2026-11-10", weekday: "tue", enough: true, hours: [h(6, 1), h(18, 4)], quietest: h(6, 1), busiest: h(18, 4), bestLeft: h(18, 4) },
      tomorrow: { date: "2026-11-11", weekday: "wed", enough: false, hours: [], quietest: null, busiest: null },
    };
    assert.deepEqual(forecastLines(f).map((l) => l.label), ["Quietest today", "Busiest today", "Best time left today"]);
    assert.equal(basedOnText(28), "Based on the last 4 weeks of check-ins");
    assert.equal(basedOnText(9), "Based on the last 9 days of check-ins");
    assert.equal(barShare(2, 4), 0.5);
    assert.equal(barShare(1, 0), 0);
  });
});
