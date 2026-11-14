// Route loading for /train/bank (phase-05 plan §4.3 `loading`; DR/V3BankLoading, V3MistakeBank `loading`): the
// header, a board-sized block and 9 ghost rows, laid out by the screen's own grid.
import { BankSkeleton } from "@/components/train/bank/BankSkeleton";

export default function BankLoading() {
  return <BankSkeleton />;
}
