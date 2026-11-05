import type { Metadata } from "next";
import { GalleryFrame } from "../../_components/Specimen";
import { LayoutSection } from "../../_sections/layout";

export const metadata: Metadata = { title: "UI Gallery · Layout", robots: { index: false, follow: false } };

export default function Page() {
  return (
    <GalleryFrame title="UI Gallery · Layout">
      <LayoutSection />
    </GalleryFrame>
  );
}
