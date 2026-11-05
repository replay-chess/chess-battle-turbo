import type { Metadata } from "next";
import { GalleryFrame } from "../../_components/Specimen";
import { ShellSection } from "../../_sections/shell";

export const metadata: Metadata = { title: "UI Gallery · Shell", robots: { index: false, follow: false } };

export default function Page() {
  return (
    <GalleryFrame title="UI Gallery · Shell">
      <ShellSection />
    </GalleryFrame>
  );
}
