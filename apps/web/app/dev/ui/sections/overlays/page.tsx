import type { Metadata } from "next";
import { GalleryFrame } from "../../_components/Specimen";
import { OverlaysSection } from "../../_sections/overlays";

export const metadata: Metadata = { title: "UI Gallery · Overlays", robots: { index: false, follow: false } };

export default function Page() {
  return (
    <GalleryFrame title="UI Gallery · Overlays">
      <OverlaysSection />
    </GalleryFrame>
  );
}
