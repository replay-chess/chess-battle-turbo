// /train/weakness/[pattern] guard (phase-06 plan §4.1, §5.2): the slug must name a weakness candidate
// (`patternFromSlug`) that is one of the profile's rows; anything else goes back to the profile. It runs here, before
// the page, so the redirect is a real 307 (P2 FIX-A); the page reuses the same cached read.
import { weaknessPatternGate } from "../load";

export default async function WeaknessPatternLayout({ children, params }: { children: React.ReactNode; params: Promise<{ pattern: string }> }) {
  await weaknessPatternGate((await params).pattern);
  return children;
}
