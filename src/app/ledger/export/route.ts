import { createClient } from "../../../lib/supabase/server";

// CSV export of the caller's own bets and picks (audit 10/G12): people want
// their history, and it's the only user-controlled backup of the append-only
// ledger. RLS scopes every row to the caller — no user_id filter needed here
// beyond the auth gate, but we pass it anyway for clarity.
export const dynamic = "force-dynamic";

const csvCell = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (headers: string[], rows: Array<Record<string, unknown>>): string =>
  [headers.join(","), ...rows.map((r) => headers.map((h) => csvCell(r[h])).join(","))].join("\n");

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Sign in to export your ledger", { status: 401 });

  const [{ data: bets }, { data: picks }] = await Promise.all([
    supabase
      .from("bets")
      .select(
        "placed_at, season_id, bet_type, description, side, line_taken, odds, units, book, reason_tag, result, closing_line, clv, payout_units, voided_at",
      )
      .eq("user_id", user.id)
      .order("placed_at", { ascending: true }),
    supabase
      .from("picks")
      .select("created_at, season_id, group_id, game_id, market, side, line_at_pick, result, clv")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true }),
  ]);

  const betCsv = toCsv(
    [
      "placed_at", "season_id", "bet_type", "description", "side", "line_taken", "odds",
      "units", "book", "reason_tag", "result", "closing_line", "clv", "payout_units", "voided_at",
    ],
    (bets ?? []) as Array<Record<string, unknown>>,
  );
  const pickCsv = toCsv(
    ["created_at", "season_id", "group_id", "game_id", "market", "side", "line_at_pick", "result", "clv"],
    (picks ?? []) as Array<Record<string, unknown>>,
  );

  const body = `# The CFB Slate — ledger export\n\n## Bets\n${betCsv}\n\n## Pick'em\n${pickCsv}\n`;
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="cfb-slate-ledger.csv"`,
    },
  });
}
