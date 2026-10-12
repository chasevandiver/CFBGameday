"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { logBet } from "../app/actions/bets";
import {
  autoDescription,
  joinSigned,
  prefillFor,
  NO_PREFILL,
  type BetFormLines,
  type Prefill,
  type Sign,
} from "../lib/bet-form-prefill";
import {
  BET_TYPES,
  BET_TYPE_LABELS,
  CONFIDENCE_TIERS,
  CONFIDENCE_TIER_LABELS,
  TEAM_SIDED,
  TOTAL_SIDED,
} from "../lib/db-types";

export interface BetFormGame {
  id: number;
  label: string;
  /** "Sun Oct 11 · NFL" — the `<optgroup>` it files under. Absent: one flat list. */
  group?: string;
  homeAbbr: string;
  awayAbbr: string;
  /** Full names, for the search box and the written description. */
  homeName?: string;
  awayName?: string;
  /** The consensus the slate shows for this game, to suggest a number from. */
  lines?: BetFormLines;
}

/** One person the form can log for (LOGF-7). The caller's own id means "me". */
export interface BetFormBettor {
  id: string;
  name: string;
}

/** Does a game match what was typed in the search box? Every word must hit. */
export function gameMatches(g: BetFormGame, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = [g.label, g.group, g.homeAbbr, g.awayAbbr, g.homeName, g.awayName]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return words.every((w) => hay.includes(w));
}

/** "Hayden", "Hayden and Eric", "Hayden, Eric and Chase". */
const nameList = (names: string[]): string =>
  names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

/**
 * Manual ledger entry with real labels — the old form was placeholder-only
 * (labels vanish the moment you type; classic form a11y failure, audit §17).
 */
export function BetForm({
  seasonId,
  games = [],
  forUserId = null,
  bettors = [],
  defaultBettorIds = [],
}: {
  seasonId: number;
  games?: BetFormGame[];
  /** 0083: log as this member of a betting group you run, not as yourself. */
  forUserId?: string | null;
  /**
   * LOGF-7: everyone this form may log for — a betting-group admin and the
   * members they run. With more than one, the form asks "who" and writes a
   * row for each person ticked, so a bet Hayden tailed off Eric is one entry,
   * not the same form filled twice. Each id is re-checked in the action.
   */
  bettors?: BetFormBettor[];
  /** Who is ticked when the form opens, and again after each bet is logged. */
  defaultBettorIds?: string[];
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [betType, setBetType] = useState("spread");
  const [gameId, setGameId] = useState("");
  const [side, setSide] = useState("");
  /* The line and the odds are held as sign + magnitude rather than one typed
     string: a phone's decimal keypad has no minus key, so "-6.5" — every
     favorite — could not be entered at all. The sign is a button; the keypad
     types the number. Joined back together for the action, which reads them
     exactly as it always did. */
  const [fill, setFill] = useState<Prefill>(NO_PREFILL);
  const [query, setQuery] = useState("");
  const [who, setWho] = useState<string[]>(defaultBettorIds);
  const choosing = bettors.length > 1;

  const game = games.find((g) => String(g.id) === gameId) ?? null;
  const auto = autoDescription(game, betType, side, fill);

  /* The list is eight days back and nine forward across both leagues — well
     over a hundred games — so it is filed by day and league, and the search box
     narrows it. The chosen game always stays in the list, or a narrowing
     search would silently change the select's value under the person. */
  const grouped = useMemo(() => {
    const shown = games.filter((g) => String(g.id) === gameId || gameMatches(g, query));
    const order: string[] = [];
    const byGroup = new Map<string, BetFormGame[]>();
    for (const g of shown) {
      const key = g.group ?? "";
      if (!byGroup.has(key)) {
        byGroup.set(key, []);
        order.push(key);
      }
      byGroup.get(key)!.push(g);
    }
    return { count: shown.length, groups: order.map((k) => ({ key: k, games: byGroup.get(k)! })) };
  }, [games, gameId, query]);

  /* Re-suggest whenever the selection changes: picking a game, a market or a
     side is the moment the number is wanted, and a hand-edited number survives
     until the next selection — "just click whatever the closing line is unless
     I want to change it". */
  const reselect = (next: { gameId?: string; betType?: string; side?: string }) => {
    const g = games.find((x) => String(x.id) === (next.gameId ?? gameId)) ?? null;
    const t = next.betType ?? betType;
    const sd = next.side ?? side;
    if (next.gameId !== undefined) setGameId(next.gameId);
    if (next.betType !== undefined) setBetType(next.betType);
    if (next.side !== undefined) setSide(next.side);
    setFill(prefillFor(g?.lines ?? null, t, sd));
  };
  const edit = (patch: Partial<Prefill>) => setFill((f) => ({ ...f, ...patch, source: null }));
  const flip = (which: "lineSign" | "oddsSign") =>
    edit({ [which]: fill[which] === "-" ? "+" : "-" } as Partial<Prefill>);

  function submit(formData: FormData) {
    // Typed wins; otherwise the form writes what it already knows (LOGF-7).
    if (String(formData.get("description") ?? "").trim() === "" && auto) {
      formData.set("description", auto);
    }
    if (choosing && who.length === 0) {
      setMessage("Pick who this bet is for");
      return;
    }
    const names = bettors.filter((b) => who.includes(b.id)).map((b) => b.name.split(" ")[0]);
    startTransition(async () => {
      setMessage(null);
      const res = await logBet(formData);
      if (!res.ok) setMessage(res.message ?? "Something went wrong");
      else {
        formRef.current?.reset();
        setBetType("spread");
        setGameId("");
        setSide("");
        setFill(NO_PREFILL);
        setQuery("");
        /* Back to whoever the form opened on: the next text in the thread is
           usually the same person's, and a tail ticked for one bet should not
           ride along onto the next one unasked. */
        setWho(defaultBettorIds);
        setMessage(choosing ? `Logged for ${nameList(names)} ✓` : "Logged ✓");
      }
    });
  }

  const input =
    "w-full rounded-lg border border-chalk/12 bg-elev px-3 py-2 text-sm text-chalk placeholder:text-chalk/35 focus:border-accent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent";

  const sideOptions: Array<[string, string]> = TEAM_SIDED.has(betType)
    ? [
        ["away", game ? game.awayAbbr : "Away"],
        ["home", game ? game.homeAbbr : "Home"],
      ]
    : TOTAL_SIDED.has(betType)
      ? [
          ["over", "Over"],
          ["under", "Under"],
        ]
      : [];

  return (
    <form ref={formRef} action={submit} className="flex flex-col gap-3">
      <input type="hidden" name="season_id" value={seasonId} />
      {choosing
        ? who.map((id) => <input key={id} type="hidden" name="for_user" value={id} />)
        : forUserId && <input type="hidden" name="for_user" value={forUserId} />}

      {choosing && (
        /* LOGF-7: who this bet is for. Several can be ticked — a tail is the
           same bet on two ledgers — and each becomes its own row, signed by
           the admin who typed it. Toggle buttons rather than checkboxes so
           every target is 44px on a phone. */
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-chalk/55">
            Who
            <span className="ml-1.5 font-normal normal-case tracking-normal text-chalk/40">
              tick everyone on it
            </span>
          </legend>
          <div className="flex flex-wrap gap-1.5">
            {bettors.map((b) => {
              const on = who.includes(b.id);
              return (
                <button
                  key={b.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    setWho((cur) => (on ? cur.filter((x) => x !== b.id) : [...cur, b.id]))
                  }
                  className={`stat flex min-h-11 items-center rounded-full border px-3 text-xs font-semibold ${
                    on
                      ? "border-accent bg-accent/15 text-accent"
                      : "border-chalk/20 text-dim hover:border-chalk/50"
                  }`}
                >
                  {on ? "✓ " : ""}
                  {b.name}
                </button>
              );
            })}
          </div>
        </fieldset>
      )}

      {games.length > 0 && (
        <>
          <Field label="Find game" htmlFor="bet-game-search" hint="team, e.g. packers or gb">
            <input
              id="bet-game-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search teams"
              autoComplete="off"
              className={input}
            />
          </Field>
          <Field label="Game" htmlFor="bet-game" hint="linking enables auto-grading + live tracking">
            <select
              id="bet-game"
              name="game_id"
              value={gameId}
              onChange={(e) => reselect({ gameId: e.target.value })}
              className={input}
            >
              <option value="">
                {query.trim() === ""
                  ? "No game — future / other"
                  : `${grouped.count} ${grouped.count === 1 ? "match" : "matches"} — choose one`}
              </option>
              {grouped.groups.map(({ key, games: list }) =>
                key === "" ? (
                  list.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.label}
                    </option>
                  ))
                ) : (
                  <optgroup key={key} label={key}>
                    {list.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.label}
                      </option>
                    ))}
                  </optgroup>
                ),
              )}
            </select>
          </Field>
        </>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Type" htmlFor="bet-type">
          <select
            id="bet-type"
            name="bet_type"
            value={betType}
            onChange={(e) => reselect({ betType: e.target.value })}
            className={input}
          >
            {BET_TYPES.map((v) => (
              <option key={v} value={v}>
                {BET_TYPE_LABELS[v]}
              </option>
            ))}
          </select>
        </Field>
        {sideOptions.length > 0 && (
          <Field label="Side" htmlFor="bet-side">
            <select
              id="bet-side"
              name="side"
              className={input}
              value={side}
              onChange={(e) => reselect({ side: e.target.value })}
            >
              <option value="">Side…</option>
              {sideOptions.map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        )}
        {betType === "team_total" && (
          // R2-A4: the subject of a team total, structured so the grader can
          // settle it — before 0055 the team lived only in the description.
          <Field label="Whose total" htmlFor="bet-team-side">
            <select id="bet-team-side" name="team_side" className={input} defaultValue="">
              <option value="">Team…</option>
              <option value="away">{game ? game.awayAbbr : "Away"}</option>
              <option value="home">{game ? game.homeAbbr : "Home"}</option>
            </select>
          </Field>
        )}
        <Field
          label="Line"
          htmlFor="bet-line"
          hint={fill.source ? `${fill.source} line` : "as your ticket reads"}
        >
          <SignedInput
            id="bet-line"
            name="line_taken"
            sign={fill.lineSign}
            mag={fill.lineMag}
            /* Totals have no sign to flip; the button would only confuse. */
            signed={!TOTAL_SIDED.has(betType)}
            inputMode="decimal"
            pattern="[0-9]+(\.[05])?"
            title="The number your side holds, half-point increments — e.g. 6.5 for the dog, 3.5 for the favorite, 48.5 for a total. Tap the sign to flip it."
            placeholder="3.5"
            className={input}
            onSign={() => flip("lineSign")}
            onMag={(v) => edit({ lineMag: v })}
          />
        </Field>
        <Field label="Odds" htmlFor="bet-odds">
          <SignedInput
            id="bet-odds"
            name="odds"
            sign={fill.oddsSign}
            mag={fill.oddsMag}
            signed
            inputMode="numeric"
            pattern="[0-9]{3,4}"
            title="American odds, e.g. 110 with the sign on minus, or 145 with it on plus"
            placeholder="110"
            className={input}
            onSign={() => flip("oddsSign")}
            onMag={(v) => edit({ oddsMag: v })}
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label="Units" htmlFor="bet-units">
          <input
            id="bet-units"
            name="units"
            required
            inputMode="decimal"
            pattern="[0-9]+(\.[0-9]+)?"
            title="Units staked, e.g. 1 or 0.5"
            placeholder="1"
            className={input}
          />
        </Field>
        {/* The required "Why" reason-tag picker stood here (LEDGER-1). Two of
            its eight values, tail and fade, are facts the database already
            knows — `src/lib/tailing.ts` derives them from arrival order — and
            the other six were a self-report standing between a person and
            logging a bet. The ledger's audit is rebuilt on the derived
            relation, which answers the same question without asking it. */}
        {/* Conviction, which is a different thing from reason and is the one
            worth keeping: how strongly, not why. Defaults to the neutral rung
            so the field is skippable — it only earns its place on the card
            when someone reaches for it. */}
        <Field label="Confidence" htmlFor="bet-confidence">
          <select
            id="bet-confidence"
            name="confidence"
            className={input}
            defaultValue="bet"
          >
            {[...CONFIDENCE_TIERS].reverse().map((tier) => (
              <option key={tier} value={tier}>
                {CONFIDENCE_TIER_LABELS[tier]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Book" htmlFor="bet-book" hint="optional">
          <input id="bet-book" name="book" placeholder="DK, FD…" className={input} />
        </Field>
      </div>

      {/* After the numbers, not before them (LOGF-7): with a game and a side
          chosen the form writes this itself, and the placeholder shows exactly
          what it will write. Typed text still wins — a parlay leg, a prop, a
          future has no game to describe it from. */}
      <Field label="Bet" htmlFor="bet-description" hint={auto ? "optional — filled in for you" : undefined}>
        <input
          id="bet-description"
          name="description"
          required={!auto}
          placeholder={auto ?? "Michigan -3.5 vs Ohio State"}
          className={input}
        />
      </Field>

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-ink transition-opacity disabled:opacity-60"
      >
        {pending ? "Logging…" : "Log bet"}
      </button>
      {message && (
        <p className={`text-xs ${message === "Logged ✓" ? "text-win" : "text-loss"}`}>{message}</p>
      )}
    </form>
  );
}

/**
 * A number with its sign on a button. The hidden input carries the joined
 * value under the form's original field name, so the action reads "-6.5" or
 * "+145" exactly as it did when the sign was typed.
 */
function SignedInput({
  id,
  name,
  sign,
  mag,
  signed,
  inputMode,
  pattern,
  title,
  placeholder,
  className,
  onSign,
  onMag,
}: {
  id: string;
  name: string;
  sign: Sign;
  mag: string;
  signed: boolean;
  inputMode: "decimal" | "numeric";
  pattern: string;
  title: string;
  placeholder: string;
  className: string;
  onSign: () => void;
  onMag: (v: string) => void;
}) {
  return (
    <div className="flex items-stretch gap-1">
      {signed && (
        <button
          type="button"
          onClick={onSign}
          aria-label={`Sign: ${sign === "-" ? "minus" : "plus"}. Tap to flip`}
          className="stat min-h-11 w-11 shrink-0 rounded-lg border border-chalk/12 bg-elev text-base text-chalk hover:border-accent"
        >
          {sign === "-" ? "−" : "+"}
        </button>
      )}
      <input
        id={id}
        value={mag}
        onChange={(e) => onMag(e.target.value)}
        inputMode={inputMode}
        pattern={pattern}
        title={title}
        placeholder={placeholder}
        className={className}
      />
      <input type="hidden" name={name} value={signed ? joinSigned(sign, mag) : mag.trim()} />
    </div>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label
        htmlFor={htmlFor}
        className="text-[10.5px] font-semibold uppercase tracking-wider text-chalk/55"
      >
        {label}
        {hint && <span className="ml-1.5 font-normal normal-case tracking-normal text-chalk/40">{hint}</span>}
      </label>
      {children}
    </div>
  );
}
