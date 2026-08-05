"use client";

import { Moon, Sun } from "lucide-react";
import { useLightTheme } from "../lib/client-store";

export function ThemeToggle() {
  const [light, setLight] = useLightTheme();

  return (
    <button
      onClick={() => setLight(!light)}
      aria-label={light ? "Switch to dark mode" : "Switch to light mode"}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-chalk/10 text-dim transition-colors hover:border-chalk/25 hover:text-chalk"
    >
      {light ? <Moon size={15} /> : <Sun size={15} />}
    </button>
  );
}
