import { describe, expect, it } from "vitest";
import { markerIcon } from "./index";

const MARKER_TYPES = [
  "volcanoes",
  "hot-springs",
  "water-sources",
  "mines",
  "bridges",
  "inns",
  "lighthouses",
  "waterfalls",
  "battlefields",
  "dungeons",
  "lake-monsters",
  "sea-monsters",
  "hill-monsters",
  "sacred-mountains",
  "sacred-forests",
  "sacred-pineries",
  "sacred-palm-groves",
  "brigands",
  "pirates",
  "statues",
  "ruins",
  "libraries",
  "circuses",
  "jousts",
  "fairs",
  "canoes",
  "migration",
  "dances",
  "mirage",
  "caves",
  "portals",
  "rifts",
  "disturbed-burials",
  "necropolises",
  "encounters",
  "party"
];

describe("markerIcon", () => {
  it("returns an SVG data URI for every default marker type", () => {
    for (const type of MARKER_TYPES) {
      const icon = markerIcon(type, "❓");
      expect(icon, type).toMatch(/^data:image\/svg\+xml;base64,/);
      const svg = atob(icon.slice("data:image/svg+xml;base64,".length));
      expect(svg, type).toContain("<svg");
    }
  });

  it("returns the fallback for a type with no bundled icon", () => {
    expect(markerIcon("no-such-type", "🌋")).toBe("🌋");
  });
});
