"use client";

import { useState } from "react";
import { HeroDiagram, type HeroVariant } from "./HeroDiagram";

const MONO = "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace";

const BRANCH = { id: "branch" as const, label: "Branch office", file: "branch-office.design" };
const CAMPUS = { id: "campus" as const, label: "Campus", file: "campus-three-tier.design" };
const VARIANTS = [BRANCH, CAMPUS];

/**
 * The hero mockup card with a segmented control to switch between the design
 * patterns the engine can actually generate today (branch-office and the
 * three-tier campus). Client component so the tabs are interactive; the
 * diagrams themselves stay static hand-drawn SVG (see HeroDiagram).
 */
export function HeroShowcase() {
  const [variant, setVariant] = useState<HeroVariant>("branch");
  const active = variant === "campus" ? CAMPUS : BRANCH;

  return (
    <div className="overflow-hidden rounded-xl border border-[#e6e5e0] bg-white">
      <div className="flex items-center gap-2 border-b border-[#efeee8] bg-[#fafaf7] px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-[#e6e5e0]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#e6e5e0]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#e6e5e0]" />
        <span className="ml-2 text-[12px] text-[#807d72]" style={{ fontFamily: MONO }}>
          {active.file}
        </span>
      </div>

      {/* segmented control */}
      <div className="flex items-center gap-1 border-b border-[#efeee8] px-4 py-2.5" role="tablist" aria-label="Design pattern">
        {VARIANTS.map((v) => {
          const selected = v.id === variant;
          return (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setVariant(v.id)}
              className={
                "rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors " +
                (selected
                  ? "bg-[#26251e] text-white"
                  : "text-[#5a5852] hover:bg-[#f2f1ec]")
              }
            >
              {v.label}
            </button>
          );
        })}
      </div>

      <div className="p-6">
        <HeroDiagram variant={variant} />
      </div>
    </div>
  );
}
