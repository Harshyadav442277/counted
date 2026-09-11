import { describe, expect, it } from "vitest";
import { col, findByTag, isEligible, parseSnapshot } from "../src/core/dune.js";
import { standingHtml } from "../src/core/format.js";

const rows = [
  { "Attribution tag": "celo_9d71588659ec", Project: "AbaPay", App: "https://abapays.com", Eligible: "DRAFT - not eligible", "Verified users": 79, "Returning (2+ days)": 43 },
  { "Attribution tag": "celo_2a3329b1d57c", Project: "Kobo", App: "", Eligible: "yes", "Verified users": 4, "Returning (2+ days)": 3 },
  { attribution_tag: "celo_3dec652cd977", project: "Leash", eligible: "yes", verified_users: 2, returning_2_days: 2 },
];

describe("dune rows", () => {
  it("finds columns whatever the alias spelling", () => {
    expect(col(rows[0]!, "attribution tag")).toBe("celo_9d71588659ec");
    expect(col(rows[2]!, "attribution tag", "attribution_tag")).toBe("celo_3dec652cd977");
    expect(col(rows[1]!, "verified users")).toBe(4);
    expect(col(rows[2]!, "verified users", "verified_users")).toBe(2);
  });

  it("finds a project by tag, case-insensitively, and reads eligibility", () => {
    expect(findByTag(rows, "CELO_2A3329B1D57C")?.["Project"]).toBe("Kobo");
    expect(findByTag(rows, "celo_3dec652cd977")?.["project"]).toBe("Leash");
    expect(findByTag(rows, "celo_nope")).toBeUndefined();
    expect(isEligible(rows[0]!)).toBe(false);
    expect(isEligible(rows[1]!)).toBe(true);
  });

  it("renders a standing with position among eligible projects", () => {
    const html = standingHtml("celo_2a3329b1d57c", [{ title: "Track 2 — Real World Adoption", row: rows[1], rows, executedAt: "2026-09-09T12:00:00Z" }]);
    expect(html).toMatch(/Kobo · eligible/);
    expect(html).toMatch(/position among eligible: 1 of 2/);
    expect(html).toMatch(/Verified users: <b>4<\/b>/);
    expect(html).toMatch(/eligible leaders: Kobo, Leash/);
  });
});

describe("board snapshot", () => {
  it("accepts the shape the extractor writes and drops unknown tables", () => {
    const snap = parseSnapshot({ capturedAt: "2026-09-11T12:45:00.000Z", boardUpdated: "Updated 23 hours ago", tables: { track1: rows, bogus: rows, track2: [] } });
    expect(snap?.capturedAt).toBe("2026-09-11T12:45:00.000Z");
    expect(snap?.boardUpdated).toBe("Updated 23 hours ago");
    expect(Object.keys(snap?.tables ?? {})).toEqual(["track1", "track2"]);
  });

  it("rejects anything that is not a snapshot", () => {
    expect(parseSnapshot(null)).toBeNull();
    expect(parseSnapshot({ tables: { track1: rows } })).toBeNull();
    expect(parseSnapshot({ capturedAt: "not a date", tables: { track1: rows } })).toBeNull();
    expect(parseSnapshot({ capturedAt: "2026-09-11T12:45:00Z", tables: {} })).toBeNull();
    expect(parseSnapshot({ capturedAt: "2026-09-11T12:45:00Z", tables: { track1: [1, 2] } })).toBeNull();
  });

  it("labels a snapshot-sourced standing with the capture time", () => {
    const html = standingHtml("celo_2a3329b1d57c", [{ title: "Track 2 — Real World Adoption", row: rows[1], rows, executedAt: "2026-09-11T12:45:00.000Z", source: "snapshot" }]);
    expect(html).toMatch(/board snapshot 2026-09-11T12:45Z/);
    expect(html).not.toMatch(/query run/);
  });
});
