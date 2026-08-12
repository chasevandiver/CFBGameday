"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "../lib/client-store";
import { SlateMark } from "./SlateMark";

/** What each theme's button says it will switch you to next. */
const NEXT_LABEL = {
  dark: "Switch to light mode",
  light: "Switch to Field — the brand palette",
  field: "Switch to dark mode",
} as const;

export function ThemeToggle() {
  const [theme, , cycle] = useTheme();

  return (
    <button
      onClick={cycle}
      aria-label={NEXT_LABEL[theme]}
      title={NEXT_LABEL[theme]}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-chalk/10 text-dim transition-colors hover:border-chalk/25 hover:text-chalk"
    >
      {/* The icon shows where you are, not where you are going — three states
          need a legend, and the mark is the one that needs no explaining. */}
      {theme === "dark" ? (
        <Sun size={15} />
      ) : theme === "light" ? (
        <Moon size={15} />
      ) : (
        <SlateMark size={15} />
      )}
    </button>
  );
}
