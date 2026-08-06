import { notFound } from "next/navigation";
import { SlatePreviewClient } from "./PreviewClient";

export const metadata = { title: "Card states preview" };

/**
 * Design-review page — dev only. In production it 404s: it renders sample
 * data, and its bet slip would otherwise attempt real ledger writes with a
 * bogus season id (audit bug #10).
 */
export default function SlatePreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <SlatePreviewClient />;
}
