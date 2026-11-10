import type { Metadata } from "next";
import "./tv.css";

/* The Fire TV overlay surfaces. Navless, footerless and see-through: the
   overlay app (tv-overlay/) draws these on top of live TV. */
export const metadata: Metadata = {
  title: "TV",
  robots: { index: false, follow: false },
};

export default function TvLayout({ children }: LayoutProps<"/tv">) {
  return children;
}
