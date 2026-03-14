"use client";

import React, { useState } from "react";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronUp } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

type TimeControl = {
  display: string;
  time: number;
  increment: number;
};

type GameMode = {
  name: string;
  icon: React.ReactNode;
  controls: TimeControl[];
};

const gameModes: GameMode[] = [
  {
    name: "Bullet",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" height="14" width="14">
        <path
          d="M7.17005 15.2999L8.60005 16.7699L0.330049 23.6699L7.17005 15.2999ZM0.300049 17.5999L4.80005 11.5999L5.70005 13.5999L0.300049 17.5999ZM10.77 10.0999C14.24 6.49994 16.7 4.89994 19.47 3.69994C17.07 3.69994 14.17 4.06994 9.67005 8.29994C9.70005 8.79994 10.37 9.76994 10.77 10.0999ZM21.83 2.16994C21.83 2.16994 22.06 3.26994 22.06 4.93994C22.06 7.60994 21.39 11.7699 17.89 15.2699L15.72 17.4399C15.05 18.1099 14.39 18.0399 13.59 17.7099L6.12005 24.0099L15.92 11.8399L10.69 15.8699C10.26 15.4699 9.76005 15.0399 9.36005 14.6399C7.63005 12.9399 5.23005 9.63994 6.59005 8.26994L8.79005 6.13994C12.32 2.63994 16.42 1.93994 19.09 1.93994C20.72 1.93994 21.82 2.16994 21.82 2.16994H21.83Z"
          fill="currentColor"
        />
      </svg>
    ),
    controls: [
      { display: "1 min", time: 60, increment: 0 },
      { display: "1 | 1", time: 60, increment: 1 },
      { display: "2 | 1", time: 120, increment: 1 },
    ],
  },
  {
    name: "Blitz",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" height="14" width="14">
        <path
          d="M5.77002 15C4.74002 15 4.40002 14.6 4.57002 13.6L6.10002 3.4C6.27002 2.4 6.73002 2 7.77002 2H13.57C14.6 2 14.9 2.4 14.64 3.37L11.41 15H5.77002ZM18.83 9C19.86 9 20.03 9.33 19.4 10.13L9.73002 22.86C8.50002 24.49 8.13002 24.33 8.46002 22.29L10.66 8.99L18.83 9Z"
          fill="currentColor"
        />
      </svg>
    ),
    controls: [
      { display: "3 min", time: 180, increment: 0 },
      { display: "3 | 2", time: 180, increment: 2 },
      { display: "5 | 5", time: 300, increment: 5 },
    ],
  },
  {
    name: "Rapid",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" height="14" width="14">
        <path
          d="M11.97 14.63C11.07 14.63 10.1 13.9 10.47 12.4L11.5 8H12.5L13.53 12.37C13.9 13.9 12.9 14.64 11.96 14.64L11.97 14.63ZM12 22.5C6.77 22.5 2.5 18.23 2.5 13C2.5 7.77 6.77 3.5 12 3.5C17.23 3.5 21.5 7.77 21.5 13C21.5 18.23 17.23 22.5 12 22.5ZM12 19.5C16 19.5 18.5 17 18.5 13C18.5 9 16 6.5 12 6.5C8 6.5 5.5 9 5.5 13C5.5 17 8 19.5 12 19.5ZM10.5 5.23V1H13.5V5.23H10.5ZM15.5 2H8.5C8.5 0.3 8.93 0 12 0C15.07 0 15.5 0.3 15.5 2Z"
          fill="currentColor"
        />
      </svg>
    ),
    controls: [
      { display: "10 min", time: 600, increment: 0 },
      { display: "15 | 10", time: 900, increment: 10 },
      { display: "30 min", time: 1800, increment: 0 },
    ],
  },
];

export type TimeControlValue = {
  mode: string;
  control: string;
  time: number;
  increment: number;
};

type TimeControlSelectorProps = {
  value: TimeControlValue;
  onChange: (value: TimeControlValue) => void;
};

export default function TimeControlSelector({ value, onChange }: TimeControlSelectorProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const getCurrentModeIcon = () => {
    const mode = gameModes.find((m) => m.name === value.mode);
    return mode?.icon || null;
  };

  return (
    <div className="w-full border border-cb-border bg-cb-bg overflow-hidden">
      {/* Selected Time Control Header */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className={cn(
          "w-full px-4 py-3 flex items-center justify-between",
          "hover:bg-cb-hover transition-colors"
        )}
      >
        <div className="flex items-center gap-3 text-cb-text">
          <span className="text-cb-text-secondary">{getCurrentModeIcon()}</span>
          <span
            style={{ fontFamily: "'Geist', sans-serif" }}
            className="font-medium"
          >
            {value.control}
          </span>
          <span
            style={{ fontFamily: "'Geist', sans-serif" }}
            className="text-cb-text-muted text-sm"
          >
            {value.mode}
          </span>
        </div>
        {isExpanded ? (
          <ChevronUp className="text-cb-text-muted" size={18} />
        ) : (
          <ChevronDown className="text-cb-text-muted" size={18} />
        )}
      </button>

      {/* Expandable Time Controls */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="border-t border-cb-border"
          >
            {gameModes.map((mode) => (
              <div key={mode.name} className="px-4 py-4 border-b border-cb-hover last:border-b-0">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-cb-text-secondary">{mode.icon}</span>
                  <span
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className="text-sm font-medium text-cb-text-secondary"
                  >
                    {mode.name}
                  </span>
                </div>
                <div className="flex gap-2">
                  {mode.controls.map((control) => {
                    const isSelected = value.mode === mode.name && value.control === control.display;
                    return (
                      <button
                        key={control.display}
                        type="button"
                        onClick={() => {
                          onChange({
                            mode: mode.name,
                            control: control.display,
                            time: control.time,
                            increment: control.increment,
                          });
                          setIsExpanded(false);
                        }}
                        className={cn(
                          "flex-1 px-3 py-2 text-sm font-medium transition-all duration-200",
                          isSelected
                            ? "bg-cb-accent text-cb-accent-fg"
                            : "bg-cb-hover text-cb-text-secondary hover:bg-cb-surface-elevated hover:text-cb-text"
                        )}
                        style={{ fontFamily: "'Geist', sans-serif" }}
                      >
                        {control.display}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
