import { createFileRoute } from "@tanstack/react-router";
import { WelcomePage } from "@/features/public-pages";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [
    { title: "FUTAMOVE — Smarter campus rides" },
    { name: "description", content: "Find and share keke rides with verified FUTA students and staff." },
    { property: "og:title", content: "FUTAMOVE — Smarter campus rides" },
    { property: "og:description", content: "Find and share keke rides with verified FUTA students and staff." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: WelcomePage,
});
