import type { Metadata } from "next";
import { GalleryFrame } from "../../_components/Specimen";
import { FoundationsSection } from "../../_sections/foundations";

export const metadata: Metadata = { title: "UI Gallery · Foundations", robots: { index: false, follow: false } };

export default function Page() {
  return (
    <GalleryFrame title="UI Gallery · Foundations">
      <FoundationsSection />
    </GalleryFrame>
  );
}
