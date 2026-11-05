import type { Metadata } from "next";
import { GalleryFrame } from "../../_components/Specimen";
import { ControlsSection } from "../../_sections/controls";

export const metadata: Metadata = { title: "UI Gallery · Controls", robots: { index: false, follow: false } };

export default function Page() {
  return (
    <GalleryFrame title="UI Gallery · Controls">
      <ControlsSection />
    </GalleryFrame>
  );
}
