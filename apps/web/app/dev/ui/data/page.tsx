import type { Metadata } from "next";
import { Suspense } from "react";
import { GalleryFrame } from "../_components/Specimen";
import { DataDemo } from "./DataDemo";

export const metadata: Metadata = { title: "UI Gallery · Data Layer", robots: { index: false, follow: false } };

/**
 * /dev/ui/data (plan §4.11; T13–T16). The root layout's <Providers sessionWatcher={<SessionWatcher />}> (1B·J)
 * supplies the QueryClient and the one SessionWatcher; this page must not add a second.
 */
export default function Page() {
  return (
    <GalleryFrame title="UI Gallery · Data Layer">
      <Suspense fallback={null}>
        <DataDemo />
      </Suspense>
    </GalleryFrame>
  );
}
