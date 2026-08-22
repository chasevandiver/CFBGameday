// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LoginForm } from "./LoginForm";

type AuthResult = { error: unknown };

const signInWithOtp = vi.fn<(...args: unknown[]) => Promise<AuthResult>>();
const verifyOtp = vi.fn<(...args: unknown[]) => Promise<AuthResult>>();

vi.mock("../lib/supabase/client", () => ({
  createClient: () => ({ auth: { signInWithOtp, verifyOtp } }),
}));

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

beforeEach(() => {
  signInWithOtp.mockReset();
  verifyOtp.mockReset().mockResolvedValue({ error: null });
  push.mockReset();
  refresh.mockReset();
  // `emailRedirectTo` is built from it, and jsdom's default is about:blank.
  Object.defineProperty(window, "location", {
    value: { origin: "https://theslate.test" },
    writable: true,
  });
});
afterEach(cleanup);

const unknownAccount = { error: { code: "otp_disabled", message: "Signups not allowed for otp" } };

async function submitEmail() {
  fireEvent.change(screen.getByLabelText(/email address/i), {
    target: { value: "dave@example.com" },
  });
  await act(async () => {
    fireEvent.submit(screen.getByRole("button", { name: /send my link/i }).closest("form")!);
  });
}

async function submitCode(code: string) {
  fireEvent.change(screen.getByLabelText(/code from the sign-in email/i), { target: { value: code } });
  await act(async () => {
    fireEvent.submit(screen.getByRole("button", { name: /sign in/i }).closest("form")!);
  });
}

/**
 * The one thing here that fails a perfectly good code and looks like the user's
 * fault: GoTrue sends the Magic Link template to an existing account and Confirm
 * Signup to a new one, and `verifyOtp` has to be told which. A hardcoded
 * `"email"` works for everyone who already has an account — which is everyone
 * testing it — and rejects every genuinely new invitee on their first attempt.
 */
describe("the code carries the type of the email that was actually sent", () => {
  it("verifies as `email` when the account already existed", async () => {
    signInWithOtp.mockResolvedValueOnce({ error: null });
    render(<LoginForm linkFailed={false} />);
    await submitEmail();
    // Only one send: the probe succeeded, so the account-creating call never ran.
    expect(signInWithOtp).toHaveBeenCalledTimes(1);
    await submitCode("123456");
    expect(verifyOtp).toHaveBeenCalledWith({
      email: "dave@example.com",
      token: "123456",
      type: "email",
    });
    // refresh before push: the router cache still holds a signed-out hub.
    expect(refresh).toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith("/");
  });

  it("verifies as `signup` when the account was created by the second call", async () => {
    signInWithOtp.mockResolvedValueOnce(unknownAccount).mockResolvedValueOnce({ error: null });
    render(<LoginForm linkFailed={false} />);
    await submitEmail();
    expect(signInWithOtp).toHaveBeenCalledTimes(2);
    await submitCode("654321");
    expect(verifyOtp).toHaveBeenCalledWith({
      email: "dave@example.com",
      token: "654321",
      type: "signup",
    });
  });
});

describe("the code form", () => {
  beforeEach(() => signInWithOtp.mockResolvedValue({ error: null }));

  it("does not navigate when the code is refused, and says why", async () => {
    verifyOtp.mockResolvedValueOnce({
      error: { code: "otp_expired", message: "Token has expired or is invalid", status: 403 },
    });
    render(<LoginForm linkFailed={false} />);
    await submitEmail();
    await submitCode("111111");
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toMatch(/send a new email/i);
    // Still on the code step — a bad code must not throw them back to the email
    // form, which would mean requesting a second email to retype the first code.
    expect(screen.getByLabelText(/code from the sign-in email/i)).toBeTruthy();
  });

  it("carries `one-time-code`, which is what makes iOS offer the digits", () => {
    // Without this attribute the whole argument for the code over the link —
    // that it never leaves the app — costs a trip to Mail and back anyway.
    signInWithOtp.mockResolvedValue({ error: null });
    render(<LoginForm linkFailed={false} />);
    return submitEmail().then(() => {
      const input = screen.getByLabelText(/code from the sign-in email/i);
      expect(input.getAttribute("autocomplete")).toBe("one-time-code");
      expect(input.getAttribute("inputmode")).toBe("numeric");
    });
  });

  it("drops anything that is not a digit, so a pasted `123 456` still works", async () => {
    render(<LoginForm linkFailed={false} />);
    await submitEmail();
    const input = screen.getByLabelText(/code from the sign-in email/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "12a3 4b" } });
    expect(input.value).toBe("1234");
  });

  it("says a short code is short instead of greying the button out", async () => {
    // The button stays enabled (Web Interface Guidelines) — a disabled control
    // cannot tell anyone what is wrong with what they typed.
    render(<LoginForm linkFailed={false} />);
    await submitEmail();
    fireEvent.change(screen.getByLabelText(/code from the sign-in email/i), {
      target: { value: "1234" },
    });
    const button = screen.getByRole("button", { name: /sign in/i });
    expect(button.hasAttribute("disabled")).toBe(false);
    await act(async () => {
      fireEvent.submit(button.closest("form")!);
    });
    expect(verifyOtp).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toMatch(/looks short/i);
    expect(document.activeElement).toBe(screen.getByLabelText(/code from the sign-in email/i));
  });

  /**
   * The first cut hardcoded six. Supabase's email-OTP length is a dashboard
   * setting between 6 and 10, this project is set to **8**, and `maxLength={6}`
   * truncated a perfectly good code to something GoTrue would never accept —
   * reported by the owner the first time he opened the email. A form does not
   * get to decide a server-side setting.
   */
  it("takes whatever length the project is configured for, not six", async () => {
    render(<LoginForm linkFailed={false} />);
    await submitEmail();
    const input = screen.getByLabelText(/code from the sign-in email/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "12345678" } });
    expect(input.value).toBe("12345678");
    await act(async () => {
      fireEvent.submit(screen.getByRole("button", { name: /sign in/i }).closest("form")!);
    });
    expect(verifyOtp).toHaveBeenCalledWith({
      email: "dave@example.com",
      token: "12345678",
      type: "email",
    });
  });

  it("accepts the whole 6–10 range GoTrue can be set to", async () => {
    render(<LoginForm linkFailed={false} />);
    await submitEmail();
    const input = screen.getByLabelText(/code from the sign-in email/i) as HTMLInputElement;
    for (const n of [6, 7, 8, 9, 10]) {
      fireEvent.change(input, { target: { value: "1".repeat(n) } });
      expect(input.value.length, `${n}-digit code was truncated`).toBe(n);
    }
    // And no further: an 11th digit is not a length GoTrue offers.
    fireEvent.change(input, { target: { value: "1".repeat(11) } });
    expect(input.value.length).toBe(10);
  });

  it("offers the way back out without stranding a typo'd address", async () => {
    render(<LoginForm linkFailed={false} />);
    await submitEmail();
    fireEvent.click(screen.getByRole("button", { name: /different email/i }));
    expect(screen.getByRole("button", { name: /send my link/i })).toBeTruthy();
  });
});
