/**
 * One number in a card, with its name above it.
 *
 * Lifted out of the ledger's season dashboard so the home hub can show the same
 * four figures without becoming an eighth copy of this shape — there are
 * already near-identical private tiles in receipts, recap, edges, the team page
 * and the game page. Those are left alone for now; this is the two screens that
 * show the *same* numbers agreeing on how they look.
 *
 * `tone` colours the value only. It takes the two verdict colours the palette
 * already defines — nothing here introduces a hue.
 */
export function StatTile({
  label,
  value,
  tone,
  sub,
}: {
  label: string;
  value: string;
  tone?: "gold" | "flag";
  /** Optional caption under the value, e.g. what the number is out of. */
  sub?: string;
}) {
  return (
    <div className="card p-3">
      <p className="text-xs uppercase text-chalk/55">{label}</p>
      <p
        className={`stat mt-1 text-xl ${tone === "gold" ? "text-win" : tone === "flag" ? "text-loss" : ""}`}
      >
        {value}
      </p>
      {sub && <p className="stat text-[10.5px] leading-tight text-dim">{sub}</p>}
    </div>
  );
}
