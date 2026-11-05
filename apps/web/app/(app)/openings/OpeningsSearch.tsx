"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useRef } from "react";

export function OpeningsSearch() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const timerRef = useRef<ReturnType<typeof setTimeout>>(null);

  const query = searchParams.get("q") ?? "";

  function handleChange(value: string) {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (value.trim()) {
        params.set("q", value.trim());
      } else {
        params.delete("q");
      }
      router.replace(`/openings?${params.toString()}`, { scroll: false });
    }, 300);
  }

  return (
    <div className="max-w-md mx-auto mt-8">
      <div className="relative">
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-cb-text-faint"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
          />
        </svg>
        <input
          type="text"
          defaultValue={query}
          onChange={(e) => handleChange(e.target.value)}
          placeholder="Search by name, ECO code, or moves..."
          style={{ fontFamily: "'Geist', sans-serif" }}
          className="w-full bg-transparent border border-cb-border text-sm text-cb-text-secondary placeholder:text-cb-text-faint pl-10 pr-4 py-2.5 focus:outline-none focus:border-cb-border-strong transition-colors"
        />
      </div>
    </div>
  );
}
