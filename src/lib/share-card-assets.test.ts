import { describe, expect, it } from "vitest";
import { isAllowedLogoUrl } from "./share-card-assets";

/**
 * The allowlist shipped without `cdn.collegefootballdata.com` and sent all 264
 * college teams to the monogram fallback. Nothing failed — the card just drew
 * coloured discs, which is what the fallback is *for*, so it looked deliberate
 * until someone shared a real slip.
 *
 * The hosts below were counted in production, not inferred. That is the point
 * of the first two cases.
 */
describe("isAllowedLogoUrl", () => {
  it("allows the host every college logo is actually on", () => {
    expect(isAllowedLogoUrl("https://cdn.collegefootballdata.com/logos/500/153.png")).toBe(true);
  });

  it("allows the host every NFL logo is actually on", () => {
    expect(isAllowedLogoUrl("https://a.espncdn.com/i/teamlogos/nfl/500/dal.png")).toBe(true);
  });

  it("refuses plaintext http even on an allowed host", () => {
    expect(isAllowedLogoUrl("http://cdn.collegefootballdata.com/logos/500/153.png")).toBe(false);
  });

  // The reason this list exists: satori would fetch these server-side, from
  // inside the deployment, and a failed probe is indistinguishable from a
  // broken logo.
  it("refuses the cloud metadata endpoint", () => {
    expect(isAllowedLogoUrl("http://169.254.169.254/latest/meta-data/")).toBe(false);
    expect(isAllowedLogoUrl("https://169.254.169.254/latest/meta-data/")).toBe(false);
  });

  it("refuses internal addresses and unrelated hosts", () => {
    for (const url of [
      "https://localhost/x.png",
      "https://10.0.0.5/x.png",
      "https://evil.test/x.png",
      "file:///etc/passwd",
      "not a url",
    ]) {
      expect(isAllowedLogoUrl(url), url).toBe(false);
    }
  });

  it("matches on the domain boundary, not on a substring", () => {
    // Both of these end with the allowed text and neither is the allowed host.
    expect(isAllowedLogoUrl("https://evilcollegefootballdata.com/x.png")).toBe(false);
    expect(isAllowedLogoUrl("https://notespncdn.com/x.png")).toBe(false);
    // And a suffixed impostor.
    expect(isAllowedLogoUrl("https://cdn.collegefootballdata.com.evil.test/x.png")).toBe(false);
  });
});
