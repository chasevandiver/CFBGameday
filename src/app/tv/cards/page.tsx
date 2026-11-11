import { TvCards } from "../../../components/tv/TvCards";

export const metadata = { title: "TV cards" };

/** Card strip for the Fire TV overlay's ticker layout: still pages, no crawl. */
export default function TvCardsPage() {
  return <TvCards />;
}
