import { describe, expect, it } from "vitest";
import { envNum } from "./env-num";

/** Isolated env, so these never depend on or disturb the real process env. */
const env = (v?: string): Record<string, string | undefined> => (v === undefined ? {} : { KNOB: v });

describe("envNum", () => {
  it("reads a number", () => {
    expect(envNum("KNOB", 7, { env: env("14") })).toBe(14);
    expect(envNum("KNOB", 7, { env: env("0.4") })).toBe(0.4);
    expect(envNum("KNOB", 7, { env: env("-3") })).toBe(-3);
  });

  it("falls back when unset", () => {
    expect(envNum("KNOB", 7, { env: env() })).toBe(7);
  });

  it("treats an empty or whitespace value as unset — the P2-1 bug", () => {
    // Number("") is 0, not NaN, so every `Number.isNaN` / `Number.isFinite`
    // guard in this repo used to wave these through as a deliberate zero.
    expect(envNum("KNOB", 7, { env: env("") })).toBe(7);
    expect(envNum("KNOB", 7, { env: env(" ") })).toBe(7);
    expect(envNum("KNOB", 7, { env: env("\n") })).toBe(7);
    expect(envNum("KNOB", 7, { env: env("\t ") })).toBe(7);
  });

  it("still accepts an explicit zero", () => {
    // The distinction the empty-string fix must not destroy: "" means unset,
    // "0" means the operator asked for zero.
    expect(envNum("KNOB", 7, { env: env("0") })).toBe(0);
    expect(envNum("KNOB", 7, { env: env("0.0") })).toBe(0);
  });

  it("throws on a value that is present but not a number", () => {
    expect(() => envNum("KNOB", 7, { env: env("soon") })).toThrow(/not a number/);
    expect(() => envNum("KNOB", 7, { env: env("14d") })).toThrow(/not a number/);
    expect(() => envNum("KNOB", 7, { env: env("Infinity") })).toThrow(/not a number/);
    expect(() => envNum("KNOB", 7, { env: env("NaN") })).toThrow(/not a number/);
  });

  it("throws outside the allowed range", () => {
    expect(() => envNum("KNOB", 7, { min: 0, env: env("-1") })).toThrow(/below the minimum/);
    expect(() => envNum("KNOB", 7, { max: 1, env: env("2") })).toThrow(/above the maximum/);
    expect(envNum("KNOB", 7, { min: 0, max: 1, env: env("1") })).toBe(1);
    expect(envNum("KNOB", 7, { min: 0, max: 1, env: env("0") })).toBe(0);
  });

  it("names the variable and the offending value in the message", () => {
    // The whole point is that a bad knob says which knob, in a job log nobody
    // is watching live.
    expect(() => envNum("KNOB", 7, { env: env("soon") })).toThrow(/KNOB="soon"/);
  });

  it("does not range-check the fallback", () => {
    // An unset variable takes the caller's default verbatim; the bounds
    // describe what an operator may pass, not what the code may default to.
    expect(envNum("KNOB", -1, { min: 0, env: env() })).toBe(-1);
  });
});
