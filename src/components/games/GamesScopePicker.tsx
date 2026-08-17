"use client";

import { Globe, Users } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import { setGamesScope } from "../../app/actions/daily-games";
import { EVERYONE } from "../../lib/games-scope";

/**
 * Which pool you're competing in, on any game page (R3-E1).
 *
 * Chip styling and the transition are `GroupSwitcher`'s, with one deliberate
 * difference: this renders for a signed-in viewer with a SINGLE group, where
 * `GroupSwitcher` hides below two. With one group the Everyone chip is the
 * only way to reach the wider board, and hiding the control would make a
 * documented feature invisible.
 *
 * Tapping a chip writes the cookie (a choice) and re-renders the page you're
 * on — never navigating away from the game you were playing.
 */
export function GamesScopePicker({
  groups,
  activeParam,
}: {
  groups: Array<{ slug: string; name: string }>;
  /** The current scope's `?g=` value: a slug, or the everyone sentinel. */
  activeParam: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, start] = useTransition();

  const choose = (value: string) =>
    start(async () => {
      await setGamesScope(value);
      // Stay on this page, drop any ?g= so the fresh cookie is what decides.
      router.push(pathname);
      router.refresh();
    });

  const chip = (value: string, label: string, Icon: typeof Users, srSuffix: string) => {
    const active = value === activeParam;
    return (
      <button
        key={value}
        onClick={() => choose(value)}
        disabled={pending}
        aria-current={active ? "true" : undefined}
        className={`flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-xs font-semibold transition-colors disabled:opacity-60 ${
          active
            ? "border-accent bg-accent/15 text-accent"
            : "border-chalk/20 text-dim hover:border-chalk/50"
        }`}
      >
        <Icon size={12} aria-hidden className="shrink-0" />
        {label}
        <span className="sr-only"> — {srSuffix}</span>
      </button>
    );
  };

  return (
    <div
      role="group"
      aria-label="Compete in"
      className="scroll-thin -mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1"
    >
      {groups.map((g) => chip(g.slug, g.name, Users, "compete in this pool"))}
      {chip(EVERYONE, "Everyone", Globe, "compete against everyone")}
    </div>
  );
}
