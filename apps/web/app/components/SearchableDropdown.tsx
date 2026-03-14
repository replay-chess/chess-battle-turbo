"use client";

import { useState, useRef, useEffect, type ReactNode, type KeyboardEvent } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

const geistFont = { fontFamily: "'Geist', sans-serif" } as const;

interface SearchableDropdownProps<T> {
  items: T[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  getLabel: (item: T) => string;
  getSubLabel?: (item: T) => string;
  getId: (item: T) => string;
  placeholder: string;
  isLoading?: boolean;
  renderItem?: (item: T, isSelected: boolean) => ReactNode;
}

export default function SearchableDropdown<T>({
  items,
  selectedId,
  onSelect,
  getLabel,
  getSubLabel,
  getId,
  placeholder,
  isLoading = false,
  renderItem,
}: SearchableDropdownProps<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedItem = items.find((item) => getId(item) === selectedId) ?? null;

  const filtered = query
    ? items.filter((item) => {
        const label = getLabel(item).toLowerCase();
        const sub = getSubLabel?.(item)?.toLowerCase() ?? "";
        const q = query.toLowerCase();
        return label.includes(q) || sub.includes(q);
      })
    : items;

  // Reset highlight when query or open state changes
  useEffect(() => {
    setHighlightedIndex(-1);
  }, [query, isOpen]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlightedIndex >= 0 && listRef.current) {
      const el = listRef.current.children[highlightedIndex] as HTMLElement | undefined;
      el?.scrollIntoView({ block: "nearest" });
    }
  }, [highlightedIndex]);

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function handleOpen() {
    setIsOpen(true);
    setQuery("");
    // Focus input after animation frame
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function handleSelect(id: string) {
    onSelect(id);
    setIsOpen(false);
    setQuery("");
  }

  function handleClear(e: React.MouseEvent) {
    e.stopPropagation();
    onSelect(null);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setHighlightedIndex((prev) =>
          prev < filtered.length - 1 ? prev + 1 : 0
        );
        break;
      case "ArrowUp":
        e.preventDefault();
        setHighlightedIndex((prev) =>
          prev > 0 ? prev - 1 : filtered.length - 1
        );
        break;
      case "Enter":
        e.preventDefault();
        if (highlightedIndex >= 0 && filtered[highlightedIndex]) {
          handleSelect(getId(filtered[highlightedIndex]));
        }
        break;
      case "Escape":
        e.preventDefault();
        setIsOpen(false);
        setQuery("");
        break;
    }
  }

  // Loading skeleton
  if (isLoading) {
    return (
      <div className="space-y-1.5">
        {[...Array(3)].map((_, i) => (
          <div
            key={i}
            className="h-10 bg-cb-hover border border-cb-border animate-pulse"
            style={{ animationDelay: `${i * 150}ms` }}
          />
        ))}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      {/* Collapsed state: show selected item or open trigger */}
      {!isOpen && (
        <div
          role="button"
          tabIndex={0}
          onClick={handleOpen}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              handleOpen();
            }
          }}
          className={cn(
            "w-full flex items-center gap-3 p-3 border transition-all duration-300 text-left group cursor-pointer",
            selectedItem
              ? "border-cb-border-strong bg-cb-hover"
              : "border-cb-border hover:border-cb-border-strong"
          )}
        >
          <Search
            className="w-3.5 h-3.5 text-cb-text-muted group-hover:text-cb-text-secondary transition-colors shrink-0"
            strokeWidth={1.5}
          />
          {selectedItem ? (
            <div className="flex-1 flex items-center justify-between min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                {getSubLabel && (
                  <span
                    style={geistFont}
                    className="text-[10px] tracking-wider text-cb-text-muted bg-cb-surface-elevated px-1.5 py-0.5 uppercase shrink-0"
                  >
                    {getSubLabel(selectedItem)}
                  </span>
                )}
                <span
                  style={geistFont}
                  className="text-sm text-cb-text truncate"
                >
                  {getLabel(selectedItem)}
                </span>
              </div>
              <button
                onClick={handleClear}
                className="p-1 text-cb-text-muted hover:text-cb-text hover:bg-cb-surface-elevated transition-colors shrink-0"
              >
                <X className="w-3.5 h-3.5" strokeWidth={1.5} />
              </button>
            </div>
          ) : (
            <span style={geistFont} className="text-sm text-cb-text-muted">
              {placeholder}
            </span>
          )}
        </div>
      )}

      {/* Open state: search input + scrollable list */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            {/* Search input */}
            <div className="relative border border-cb-border-strong bg-cb-hover">
              <Search
                className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-cb-text-muted"
                strokeWidth={1.5}
              />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={placeholder}
                style={geistFont}
                className="w-full bg-transparent text-cb-text text-sm pl-9 pr-8 py-3 outline-none placeholder:text-cb-text-muted"
              />
              {query && (
                <button
                  onClick={() => setQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-cb-text-muted hover:text-cb-text transition-colors"
                >
                  <X className="w-3 h-3" strokeWidth={1.5} />
                </button>
              )}
            </div>

            {/* Results list */}
            <div
              ref={listRef}
              className="max-h-60 overflow-y-auto border border-t-0 border-cb-border custom-scrollbar"
            >
              {filtered.length === 0 ? (
                <div className="flex items-center justify-center py-8">
                  <p style={geistFont} className="text-cb-text-muted text-xs tracking-[0.2em] uppercase">
                    No results found
                  </p>
                </div>
              ) : (
                filtered.map((item, index) => {
                  const id = getId(item);
                  const isSelected = id === selectedId;
                  const isHighlighted = index === highlightedIndex;

                  if (renderItem) {
                    return (
                      <div
                        key={id}
                        onClick={() => handleSelect(id)}
                        className={cn(
                          "cursor-pointer transition-colors duration-150",
                          isHighlighted && "bg-cb-surface-elevated",
                          isSelected && "bg-cb-hover"
                        )}
                      >
                        {renderItem(item, isSelected)}
                      </div>
                    );
                  }

                  return (
                    <button
                      key={id}
                      onClick={() => handleSelect(id)}
                      className={cn(
                        "w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors duration-150",
                        isHighlighted
                          ? "bg-cb-accent text-cb-accent-fg"
                          : isSelected
                            ? "bg-cb-surface-elevated text-cb-text"
                            : "text-cb-text-secondary hover:bg-cb-hover hover:text-cb-text"
                      )}
                    >
                      {getSubLabel && (
                        <span
                          style={geistFont}
                          className={cn(
                            "text-[10px] tracking-wider px-1.5 py-0.5 uppercase shrink-0 border",
                            isHighlighted
                              ? "text-cb-accent-fg/60 bg-cb-accent-fg/5 border-cb-accent-fg/20"
                              : "text-cb-text-muted bg-cb-hover border-cb-border"
                          )}
                        >
                          {getSubLabel(item)}
                        </span>
                      )}
                      <span
                        style={geistFont}
                        className={cn(
                          "text-xs truncate",
                          isHighlighted ? "text-cb-accent-fg font-medium" : ""
                        )}
                      >
                        {getLabel(item)}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
