import { describe, expect, it } from "vitest";
import type { AuthError } from "@supabase/supabase-js";
import { explainAuthError, explainCodeError } from "./LoginForm";

/** `auth-js` throws real AuthError instances; only these three fields matter. */
const err = (over: Partial<AuthError>): AuthError =>
  ({ name: "AuthApiError", message: "", status: 400, ...over }) as AuthError;

describe("explainAuthError", () => {
  it("never shows the raw `{}` a 500 produces", () => {
    // `auth-js` builds a 5xx message with JSON.stringify(Response), which is
    // literally "{}" — the exact string the owner saw in red under the form.
    const out = explainAuthError(err({ message: "{}", status: 500 }), false);
    expect(out).not.toContain("{}");
    expect(out).toMatch(/sign-in service/i);
  });

  it("blames the allowlist when the signup call is the one that failed", () => {
    const out = explainAuthError(err({ message: "{}", status: 500 }), true);
    expect(out).toMatch(/invite-only/i);
    // And names the other cause, because a 500 cannot tell them apart.
    expect(out).toMatch(/failed to send/i);
  });

  it("says so plainly when the rate limit is the problem", () => {
    expect(
      explainAuthError(err({ status: 429, message: "over_email_send_rate_limit" }), false),
    ).toMatch(/wait a minute/i);
    expect(
      explainAuthError(
        err({ code: "over_email_send_rate_limit", message: "too many", status: 400 }),
        false,
      ),
    ).toMatch(/wait a minute/i);
  });

  it("recognises the allowlist message when GoTrue does pass one through", () => {
    expect(explainAuthError(err({ message: "Signups not allowed for otp" }), false)).toMatch(
      /invite-only/i,
    );
  });

  it("passes a real, readable message through untouched", () => {
    expect(explainAuthError(err({ message: "Unable to validate email address" }), false)).toBe(
      "Unable to validate email address",
    );
  });

  it("does not render an empty error as empty", () => {
    expect(explainAuthError(err({ message: "" }), false)).toMatch(/sign-in service/i);
  });
});

describe("explainCodeError", () => {
  it("never shows the raw `{}` a 500 produces", () => {
    // The same auth-js defect the link path has: a 5xx message is built with
    // JSON.stringify(Response), which is literally "{}". verifyOtp is not
    // exempt from it just because explainAuthError was written first.
    const out = explainCodeError(err({ message: "{}", status: 500 }));
    expect(out).not.toContain("{}");
    expect(out).toMatch(/sign-in service/i);
  });

  it("says wait when the rate limit is the problem", () => {
    expect(explainCodeError(err({ status: 429, message: "too many" }))).toMatch(/wait a minute/i);
  });

  it("gives one actionable answer for every flavour of bad code", () => {
    // GoTrue spells this several ways and the distinction changes nothing
    // about what the person should do, so all of them land on "send a new one".
    for (const e of [
      err({ code: "otp_expired", message: "Token has expired or is invalid", status: 403 }),
      err({ message: "Token has expired or is invalid", status: 403 }),
      err({ message: "Invalid token", status: 400 }),
    ]) {
      expect(explainCodeError(e)).toMatch(/send a new email/i);
    }
  });

  it("quotes no expiry duration, since that is a project setting this file cannot see", () => {
    const out = explainCodeError(err({ code: "otp_expired", message: "expired", status: 403 }));
    expect(out).not.toMatch(/\d+\s*(second|minute|hour|day)/i);
  });
});
