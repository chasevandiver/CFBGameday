import { describe, expect, it } from "vitest";
import { CfbdError } from "../../src/lib/cfbd";
import {
  classifyProbe,
  formatProbe,
  probeEmpties,
  probeFailures,
  type ProbeResult,
} from "./probe";

// The one distinction this module exists to make. A 403 and an empty array
// both mean "no data came back", and they call for opposite responses: one is
// a $10 tier upgrade, the other is waiting for CFBD to publish. Conflating
// them is how you spend three weeks waiting for data that was never coming.
describe("classifyProbe", () => {
  it("reads a 403 as DENIED — the tier, not the data", () => {
    const c = classifyProbe({ error: new CfbdError("nope", 403, "/scoreboard") });
    expect(c).toEqual({ status: "DENIED", httpStatus: 403, rows: null });
  });

  it("reads a 401 as DENIED too — a wrong key is still 'you cannot have this'", () => {
    expect(classifyProbe({ error: new CfbdError("nope", 401, "/lines") }).status).toBe(
      "DENIED",
    );
  });

  it("reads a 500 as ERROR, not DENIED — CFBD having a bad day is not a tier problem", () => {
    const c = classifyProbe({ error: new CfbdError("boom", 500, "/games") });
    expect(c).toEqual({ status: "ERROR", httpStatus: 500, rows: null });
  });

  it("reads a non-HTTP failure as ERROR with no status", () => {
    const c = classifyProbe({ error: new Error("getaddrinfo ENOTFOUND") });
    expect(c).toEqual({ status: "ERROR", httpStatus: null, rows: null });
  });

  it("reads rows as OK", () => {
    expect(classifyProbe({ rows: 136 })).toEqual({
      status: "OK",
      httpStatus: null,
      rows: 136,
    });
  });

  it("reads zero rows as EMPTY — access is fine, the data is not published", () => {
    expect(classifyProbe({ rows: 0 }).status).toBe("EMPTY");
  });

  it("has no exemption left — zero rows is EMPTY for every endpoint", () => {
    // This test used to assert the opposite for /scoreboard, on the premise
    // that it "returns [] every day that isn't a Saturday". The Aug 12 probe
    // pulled 889 rows on a Wednesday, so the premise was false and the
    // exemption printed `ok` over the one symptom that says the live layer is
    // dead. EMPTY still never fails the run (see probeFailures) — the change
    // is that the table stops claiming everything is fine.
    expect(classifyProbe({ rows: 0 }).status).toBe("EMPTY");
    expect(classifyProbe({ rows: 1 }).status).toBe("OK");
  });
});

const result = (over: Partial<ProbeResult>): ProbeResult => ({
  endpoint: "/x",
  status: "OK",
  httpStatus: null,
  rows: 1,
  required: true,
  note: "",
  usedFor: "something",
  ...over,
});

describe("probeEmpties", () => {
  it("surfaces a required endpoint that answered with nothing", () => {
    const rs = [
      result({ endpoint: "/scoreboard", required: true, status: "EMPTY" }),
      result({ endpoint: "/optional", required: false, status: "EMPTY" }),
      result({ endpoint: "/games", required: true, status: "OK" }),
    ];
    expect(probeEmpties(rs).map((r) => r.endpoint)).toEqual(["/scoreboard"]);
  });

  it("is not a failure — the run stays green on an empty offseason board", () => {
    const rs = [result({ endpoint: "/scoreboard", required: true, status: "EMPTY" })];
    expect(probeEmpties(rs)).toHaveLength(1);
    expect(probeFailures(rs)).toHaveLength(0);
  });
});

describe("probeFailures", () => {
  it("fails the run on a denied required endpoint", () => {
    const f = probeFailures([result({ endpoint: "/scoreboard", status: "DENIED" })]);
    expect(f.map((r) => r.endpoint)).toEqual(["/scoreboard"]);
  });

  it("ignores a denied OPTIONAL endpoint", () => {
    // /stats/game/advanced is Tier 1+ and epaWeight is 0 — losing it costs a
    // tuner nobody is running, so it must not turn a launch-week run red.
    expect(probeFailures([result({ status: "DENIED", required: false })])).toEqual([]);
  });

  it("does NOT fail on EMPTY — that is build-preseason --check's question", () => {
    expect(probeFailures([result({ status: "EMPTY" })])).toEqual([]);
  });

  it("is quiet when everything is reachable", () => {
    expect(probeFailures([result({}), result({ required: false })])).toEqual([]);
  });
});

describe("formatProbe", () => {
  it("puts the status and the consequence on one line", () => {
    const out = formatProbe([
      result({ endpoint: "/scoreboard", status: "DENIED", httpStatus: 403, rows: null, usedFor: "live scores" }),
    ]);
    expect(out).toContain("/scoreboard");
    expect(out).toContain("DENIED");
    expect(out).toContain("403");
    expect(out).toContain("live scores");
  });

  it("renders a note on its own line when there is one", () => {
    expect(formatProbe([result({ note: "Tier 1+." })])).toContain("↳ Tier 1+.");
  });
});
