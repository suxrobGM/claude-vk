import "reflect-metadata";
import { describe, expect, it } from "bun:test";
import { generateCode } from "./pairing";

describe("generateCode", () => {
  it("produces a 6-character code from the 32-char alphabet", () => {
    const allowed = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/;
    for (let i = 0; i < 1000; i++) {
      const code = generateCode();
      expect(code).toMatch(allowed);
    }
  });

  it("never produces visually confusable chars (0/O/1/I/L)", () => {
    const forbidden = /[01OIL]/;
    for (let i = 0; i < 1000; i++) {
      expect(generateCode()).not.toMatch(forbidden);
    }
  });

  it("has reasonable entropy: 10k samples produce many distinct codes", () => {
    const set = new Set<string>();
    for (let i = 0; i < 10_000; i++) set.add(generateCode());
    // 32^6 ≈ 1.07e9 codes; collisions in 10k samples should be vanishingly rare.
    expect(set.size).toBeGreaterThan(9_950);
  });
});
