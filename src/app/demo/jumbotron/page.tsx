import { JumbotronView } from "../../../components/jumbotron/JumbotronView";
import { demoSlateData } from "../../../lib/demo-data";
import { demoNow } from "../../../lib/demo-now";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Demo Jumbotron",
  description: "The stadium board, against the sample Saturday.",
};

/**
 * The Jumbotron over the sample slate — the three posed live games rotate,
 * nothing polls, nothing subscribes (the `demo` flag, same contract as
 * /demo/slate). The screenshot surface for R5-A's layout.
 */
export default async function DemoJumbotronPage() {
  const now = await demoNow();
  const slate = demoSlateData(now);
  const live = { ...slate, games: slate.games.filter((g) => g.status === "in_progress") };
  const upcoming = slate.games.filter((g) => g.status === "scheduled");
  return <JumbotronView initial={live} upcoming={upcoming} demo />;
}
