import { describe, expect, it } from "vitest";
import { parseHeightmapDraft, serializeHeightmapDraft } from "./heightmap-draft";

const draft = () => ({
  seed: "123456789",
  graphWidth: 1920,
  graphHeight: 969,
  cellsDesired: 10000,
  heights: Uint8Array.from({ length: 10007 }, (_, i) => (i * 7) % 101)
});

describe("heightmap draft", () => {
  it("round-trips seed, dimensions and heights byte-for-byte", () => {
    const original = draft();
    const restored = parseHeightmapDraft(serializeHeightmapDraft(original));

    expect(restored.seed).toBe(original.seed);
    expect(restored.graphWidth).toBe(original.graphWidth);
    expect(restored.graphHeight).toBe(original.graphHeight);
    expect(restored.cellsDesired).toBe(original.cellsDesired);
    expect(restored.heights).toBeInstanceOf(Uint8Array);
    expect(Array.from(restored.heights)).toEqual(Array.from(original.heights));
  });

  it("rejects content that is not valid JSON", () => {
    expect(() => parseHeightmapDraft("not a draft")).toThrow(/draft/i);
  });

  it("rejects a draft with missing fields", () => {
    expect(() => parseHeightmapDraft(JSON.stringify({ seed: "1" }))).toThrow(/draft/i);
  });

  it("rejects a draft with an unsupported version", () => {
    const text = serializeHeightmapDraft(draft()).replace('"version":1', '"version":99');
    expect(() => parseHeightmapDraft(text)).toThrow(/version/i);
  });
});
