"use client";

// The archive search ("Opponent or opening", 240 px; full width on phones). Controlled by the screen, which
// debounces it (250 ms) into the URL; a 1-character search stays in the box but does not filter.
import { Search } from "lucide-react";
import { Input } from "@/components/ui/field";
import { SEARCH_MAX } from "../model/filter";

export function SearchField({
  value,
  onChange,
  inputRef,
}: {
  value: string;
  onChange: (text: string) => void;
  inputRef?: React.Ref<HTMLInputElement>;
}) {
  return (
    <Input
      ref={inputRef}
      type="search"
      aria-label="Search games"
      placeholder="Opponent or opening"
      autoComplete="off"
      spellCheck={false}
      enterKeyHint="search"
      maxLength={SEARCH_MAX}
      value={value}
      onChange={(e) => onChange(e.currentTarget.value)}
      leadingIcon={<Search />}
      className="w-full"
      data-testid="games-search"
    />
  );
}
