import { describe, it, expect } from "vitest";
import { skyburgGroupFromPopulation } from "./burgs-generator";

describe("skyburgGroupFromPopulation", () => {
  it("assigns 'skyburg' to population >= 0.8", () => {
    expect(skyburgGroupFromPopulation(0.8)).toBe("skyburg");
    expect(skyburgGroupFromPopulation(1.0)).toBe("skyburg");
    expect(skyburgGroupFromPopulation(1.5)).toBe("skyburg");
  });

  it("assigns 'skyburg-mid' to population 0.4–0.799", () => {
    expect(skyburgGroupFromPopulation(0.4)).toBe("skyburg-mid");
    expect(skyburgGroupFromPopulation(0.6)).toBe("skyburg-mid");
    expect(skyburgGroupFromPopulation(0.799)).toBe("skyburg-mid");
  });

  it("assigns 'skyburg-small' to population < 0.4", () => {
    expect(skyburgGroupFromPopulation(0.2)).toBe("skyburg-small");
    expect(skyburgGroupFromPopulation(0.39)).toBe("skyburg-small");
  });

  it("boundary: 0.8 is 'skyburg', 0.799 is 'skyburg-mid'", () => {
    expect(skyburgGroupFromPopulation(0.8)).toBe("skyburg");
    expect(skyburgGroupFromPopulation(0.799)).toBe("skyburg-mid");
  });

  it("boundary: 0.4 is 'skyburg-mid', 0.399 is 'skyburg-small'", () => {
    expect(skyburgGroupFromPopulation(0.4)).toBe("skyburg-mid");
    expect(skyburgGroupFromPopulation(0.399)).toBe("skyburg-small");
  });
});
