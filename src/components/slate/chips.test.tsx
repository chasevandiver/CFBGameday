// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { EdgeChip, LiveStatusChip, MoveIndicator, ResultChip } from "./chips";

afterEach(cleanup);

describe("ResultChip", () => {
  it("renders label text plus an icon — never color alone", () => {
    const { container } = render(<ResultChip label="ATS" result="pass" />);
    expect(screen.getByText("ATS")).toBeTruthy();
    expect(container.querySelector("svg")).toBeTruthy();
  });
});

describe("LiveStatusChip", () => {
  it("shows prefix and live label together", () => {
    render(
      <LiveStatusChip
        prefix="OSU -3.5"
        status={{ state: "winning", label: "covering by 4", clinched: false }}
      />,
    );
    expect(screen.getByText("OSU -3.5")).toBeTruthy();
    expect(screen.getByText("covering by 4")).toBeTruthy();
  });
});

describe("EdgeChip", () => {
  it("renders nothing without a flag, the magnitude with one", () => {
    const { container } = render(<EdgeChip flag={null} edge={-1} />);
    expect(container.firstChild).toBeNull();
    render(<EdgeChip flag="BIG_EDGE" edge={-4.2} />);
    expect(screen.getByText("Big Edge")).toBeTruthy();
  });
});

describe("MoveIndicator", () => {
  it("renders the magnitude and flips the arrow with direction", () => {
    const { container: up } = render(<MoveIndicator move={{ delta: 0.5, vsModel: null }} open={-6} />);
    expect(up.textContent).toContain("0.5");
    const upPath = up.querySelector("svg")?.innerHTML ?? "";

    const { container: down } = render(
      <MoveIndicator move={{ delta: -2, vsModel: "toward" }} open={-6} />,
    );
    expect(down.textContent).toContain("2");
    expect(down.querySelector("svg")?.innerHTML).not.toBe(upPath);
  });

  it("never borrows the win/loss colors — movement carries no money", () => {
    for (const vsModel of [null, "toward", "away"] as const) {
      const { container } = render(<MoveIndicator move={{ delta: -2, vsModel }} open={-6} />);
      expect(container.querySelector(".text-win, .text-loss")).toBeNull();
      expect(container.querySelector(".text-dim")).toBeTruthy();
      cleanup();
    }
  });

  it("keeps the model-lean read as title text", () => {
    const { container } = render(<MoveIndicator move={{ delta: -2, vsModel: "toward" }} open={-6} />);
    expect(container.querySelector("span")?.getAttribute("title")).toContain("toward the model");
  });
});
