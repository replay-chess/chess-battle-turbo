import type { Metadata } from "next";
import { GalleryFrame } from "./_components/Specimen";
import { FoundationsSection } from "./_sections/foundations";
import { ControlsSection } from "./_sections/controls";
import { OverlaysSection } from "./_sections/overlays";
import { ShellSection } from "./_sections/shell";
import { LayoutSection } from "./_sections/layout";

export const metadata: Metadata = { title: "UI Gallery", robots: { index: false, follow: false } };

/** Gallery index (SPEC 3.7): all five sections. The document scrolls normally (no .rc-vs). */
export default function Page() {
  return (
    <GalleryFrame title="UI Gallery">
      <FoundationsSection />
      <ControlsSection />
      <OverlaysSection />
      <ShellSection />
      <LayoutSection />
    </GalleryFrame>
  );
}
