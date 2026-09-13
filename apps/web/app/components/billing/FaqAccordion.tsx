"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

export function FaqAccordion({
  items,
  heading,
}: {
  items: { question: string; answer: string }[];
  heading?: string;
}) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <div>
      {heading && (
        <h2
          style={{ fontFamily: "'Instrument Serif', serif" }}
          className="text-3xl sm:text-4xl lg:text-5xl mb-12 text-center text-cb-text"
        >
          {heading}
        </h2>
      )}
      <div className="space-y-3">
        {items.map((faq, index) => {
          const open = openIndex === index;
          return (
            <motion.div
              key={faq.question}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.1 }}
              className="border border-cb-border overflow-hidden"
            >
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpenIndex(open ? null : index)}
                className="w-full p-5 text-left flex justify-between items-center bg-cb-hover hover:bg-cb-hover transition-colors"
              >
                <span
                  style={{ fontFamily: "'Geist', sans-serif" }}
                  className="text-sm font-medium text-cb-text"
                >
                  {faq.question}
                </span>
                <ChevronDown
                  className={`w-4 h-4 text-cb-text-muted transition-transform duration-300 ${open ? "rotate-180" : ""}`}
                />
              </button>
              <AnimatePresence>
                {open && (
                  <motion.div
                    initial={{ height: 0 }}
                    animate={{ height: "auto" }}
                    exit={{ height: 0 }}
                    className="overflow-hidden"
                  >
                    <div
                      style={{ fontFamily: "'Geist', sans-serif" }}
                      className="p-5 border-t border-cb-border text-sm text-cb-text-muted leading-relaxed"
                    >
                      {faq.answer}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
