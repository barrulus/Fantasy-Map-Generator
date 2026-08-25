import { describe, expect, it } from "vitest";
import "./markers-generator";

describe("default marker config", () => {
  it("assigns a bundled SVG data-URI icon to every marker type", () => {
    const config = window.Markers.getConfig();
    expect(config.length).toBeGreaterThan(0);
    for (const { type, icon } of config) {
      expect(icon, type).toMatch(/^data:image\/svg\+xml;base64,/);
    }
  });
});
