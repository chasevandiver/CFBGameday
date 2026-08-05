import { AppNav } from "../../components/AppNav";
import { SlateView } from "../../components/slate/SlateView";
import { fetchCurrentSeasonWeek, fetchSlateView } from "../../lib/queries";
import { createClient } from "../../lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function SlatePage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { seasonId, week: currentWeek } = await fetchCurrentSeasonWeek(supabase);

  const { week: weekParam } = await searchParams;
  const parsed = Number(weekParam);
  const week =
    Number.isInteger(parsed) && parsed >= 1 && parsed <= 20 ? parsed : currentWeek;

  const initial = await fetchSlateView(supabase, seasonId, week, user?.id ?? null);

  return (
    <>
      <AppNav />
      <main className="w-full flex-1 px-4">
        <SlateView initial={initial} currentWeek={currentWeek} />
      </main>
    </>
  );
}
