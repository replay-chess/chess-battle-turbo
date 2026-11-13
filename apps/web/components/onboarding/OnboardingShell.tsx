// The onboarding frame (phase-04 plan §4.0): one viewport in P1's lock mode (`data-rc-lock`; the document never
// scrolls), the headers, and the stage the step pages fill. Rendered once by app/onboarding/(flow)/layout.tsx, so
// the header and its stepper stay mounted while the steps change. Outside the app shell: no command palette, no
// `?` sheet, no tab bar.
import "./onboarding.css";
import type { OnbPage } from "@/lib/onboarding/steps";
import { OnbHeader } from "./OnbHeader";
import { OnbNavProvider } from "./OnbNav";

/** `page` and `demo` are for the /dev/ui demo routes only; the real routes read the (flow) layout's segment. */
export function OnboardingShell({ children, page, demo }: { children: React.ReactNode; page?: OnbPage; demo?: boolean }) {
  return (
    <OnbNavProvider page={page} demo={demo}>
      <div className="onb" data-rc-lock="" data-testid="onboarding-frame">
        <OnbHeader />
        <main id="main" className="onb-main" tabIndex={-1}>
          {children}
        </main>
      </div>
    </OnbNavProvider>
  );
}
