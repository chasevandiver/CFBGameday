import { DeleteWagerButton } from "./DeleteWagerButton";

/**
 * ADM-1's reach: the most recent wagers across every user, with a delete on
 * each.
 *
 * The ledger and the game page already carry the same control, but both are
 * scoped to the viewer's own rows. This is the only surface that reaches
 * somebody else's — which is the actual request ("I'm doing test bets so i want
 * to be able to cancel them"), because a test account's rows are not the
 * operator's own.
 *
 * Deliberately capped and deliberately says so. A full audit browser is a
 * different feature; this is a cleanup tool, and a truncated list that reads as
 * "everything" is the failure mode `docs/STATUS.md` keeps recording.
 */

export interface AdminWagerView {
  id: number;
  kind: "bet" | "pick";
  who: string;
  what: string;
  when: string;
  /** Graded result, or null while open. Rendered so the operator can see that
   *  deleting a settled row is deliberate rather than accidental. */
  result: string | null;
  voided: boolean;
  /** Sort key, not rendered — `when` is already formatted for a human. */
  at: string;
}

export function WagersPanel({
  wagers,
  total,
}: {
  wagers: AdminWagerView[];
  total: number;
}) {
  return (
    <section className="card mb-4 p-4">
      <h2 className="mb-1 text-sm text-accent">Wagers</h2>
      <p className="mb-3 text-xs text-dim">
        Deleting removes the row outright — it is not a void, and it does not stay on the ledger.
        The deleted row is copied to an archive first, so it can be reconstructed by hand.
      </p>

      {wagers.length === 0 ? (
        <p className="text-sm text-dim">No bets or picks yet.</p>
      ) : (
        <ul className="flex flex-col">
          {wagers.map((w) => (
            <li
              key={`${w.kind}-${w.id}`}
              className={`flex items-center justify-between gap-3 border-b border-chalk/5 py-2 last:border-0 ${
                w.voided ? "opacity-45" : ""
              }`}
            >
              <span className="min-w-0">
                <span className="stat text-[10px] uppercase tracking-wider text-dim">
                  {w.kind}
                </span>
                <span className="block truncate text-sm text-chalk">{w.what}</span>
                <span className="block truncate text-xs text-dim">
                  {w.who} · {w.when}
                  {w.result ? ` · ${w.result}` : ""}
                </span>
              </span>
              <span className="shrink-0">
                <DeleteWagerButton kind={w.kind} id={w.id} label={`${w.kind} — ${w.what}`} />
              </span>
            </li>
          ))}
        </ul>
      )}

      {total > wagers.length && (
        <p className="mt-3 text-xs text-chalk/50">
          Showing the {wagers.length} most recent of {total}. This is a cleanup tool, not an audit
          browser — older rows are reachable from the ledger and the game pages.
        </p>
      )}
    </section>
  );
}
