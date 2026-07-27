import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { HeroDiagram } from "@/components/landing/HeroDiagram";
import { TryFreeButton } from "@/components/landing/TryFreeButton";
import { WaitlistForm } from "@/components/landing/WaitlistForm";

const MONO = "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace";

// The pipeline stages, marked with the AI-timeline pastel palette (peach ->
// blue -> gold): our prose-to-design flow is a genuine agent-action timeline.
const STEPS = [
  {
    dot: "#dfa88f",
    title: "Describe it in plain English",
    body: '"Branch office, dual routers with HSRP, guest and corporate VLANs, FortiGate at the edge." No templates, no wizards.',
  },
  {
    dot: "#9fbbe0",
    title: "The engine designs it",
    body: "IP addressing, VLANs, and redundancy are computed deterministically and validated against a schema — no overlapping subnets, no guesswork.",
  },
  {
    dot: "#c08532",
    title: "Download the deliverables",
    body: "An interactive diagram, an editable Visio (.vsdx) file, a High-Level Design doc, and vendor base configs — in minutes, not days.",
  },
];

const DELIVERABLES = [
  "Interactive topology diagram",
  "Editable Visio (.vsdx) export",
  "HLD specification document",
  "Cisco IOS base configurations",
];

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/projects");
  }

  return (
    <div className="min-h-screen bg-[#f7f7f4] text-[#26251e]">
      {/* Top bar */}
      <header className="border-b border-[#e6e5e0]">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-[3px] bg-[#f54e00]" aria-hidden />
            <span className="text-[15px] font-medium tracking-tight">NetDesign AI</span>
          </div>
          <a href="/login" className="text-sm font-medium text-[#5a5852] hover:text-[#26251e]">
            Sign in
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6">
        {/* Hero */}
        <section className="grid items-center gap-12 py-20 md:grid-cols-2 md:py-28">
          <div>
            <p className="mb-5 text-[11px] font-semibold uppercase tracking-[0.088em] text-[#807d72]">
              Network design, automated
            </p>
            <h1
              className="mb-6 text-[44px] font-normal leading-[1.08] md:text-[64px]"
              style={{ letterSpacing: "-0.03em" }}
            >
              Plain-English requirement in. Validated network design out.
            </h1>
            <p className="mb-8 max-w-md text-[17px] leading-relaxed text-[#5a5852]">
              Describe the network you need and get a schema-validated design, an interactive diagram, a Visio
              file, an HLD document, and base configs — in minutes. Addressing is computed by a deterministic
              engine, not guessed by a chatbot.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <TryFreeButton location="hero" variant="primary">
                Try it free
              </TryFreeButton>
              <a
                href="#waitlist"
                className="inline-flex items-center justify-center rounded-lg border border-[#cfcdc4] bg-white px-5 py-2.5 text-sm font-medium text-[#26251e] hover:border-[#26251e]"
              >
                Join the beta waitlist
              </a>
            </div>
          </div>

          {/* IDE-style mockup card holding the topology */}
          <div className="overflow-hidden rounded-xl border border-[#e6e5e0] bg-white">
            <div className="flex items-center gap-2 border-b border-[#efeee8] bg-[#fafaf7] px-4 py-2.5">
              <span className="h-2.5 w-2.5 rounded-full bg-[#e6e5e0]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#e6e5e0]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#e6e5e0]" />
              <span className="ml-2 text-[12px] text-[#807d72]" style={{ fontFamily: MONO }}>
                branch-office.design
              </span>
            </div>
            <div className="p-6">
              <HeroDiagram />
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="border-t border-[#e6e5e0] py-20">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.088em] text-[#807d72]">
            How it works
          </p>
          <h2 className="mb-12 max-w-lg text-[36px] font-normal leading-tight" style={{ letterSpacing: "-0.02em" }}>
            From a sentence to a documented design.
          </h2>
          <ol className="grid gap-10 md:grid-cols-3">
            {STEPS.map((step, index) => (
              <li key={step.title}>
                <div className="mb-4 flex items-center gap-2.5">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: step.dot }} aria-hidden />
                  <span className="text-[12px] text-[#807d72]" style={{ fontFamily: MONO }}>
                    0{index + 1}
                  </span>
                </div>
                <h3 className="mb-2 text-[18px] font-semibold">{step.title}</h3>
                <p className="text-[15px] leading-relaxed text-[#5a5852]">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Deliverables */}
        <section className="border-t border-[#e6e5e0] py-20">
          <div className="grid items-center gap-10 md:grid-cols-2">
            <div>
              <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.088em] text-[#807d72]">
                The output
              </p>
              <h2 className="mb-4 text-[36px] font-normal leading-tight" style={{ letterSpacing: "-0.02em" }}>
                Everything you&rsquo;d hand a client.
              </h2>
              <p className="max-w-md text-[15px] leading-relaxed text-[#5a5852]">
                One prompt produces a complete, documented starting point — reviewed by you, lab-validated before
                production. The difference between a rough draft and a senior engineer&rsquo;s deliverable.
              </p>
            </div>
            <ul className="grid gap-3">
              {DELIVERABLES.map((item) => (
                <li
                  key={item}
                  className="flex items-center gap-3 rounded-lg border border-[#e6e5e0] bg-white px-4 py-3.5 text-[15px] text-[#26251e]"
                >
                  <span className="text-[#f54e00]">→</span>
                  <span style={{ fontFamily: MONO }} className="text-[13px]">
                    {item}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Waitlist */}
        <section id="waitlist" className="border-t border-[#e6e5e0] py-24 text-center">
          <h2 className="mb-3 text-[36px] font-normal leading-tight" style={{ letterSpacing: "-0.02em" }}>
            Be a beta tester.
          </h2>
          <p className="mx-auto mb-8 max-w-xl text-[15px] leading-relaxed text-[#5a5852]">
            We&rsquo;re onboarding network engineers in small batches. Join the waitlist and bring your gnarliest
            real-world scenario — free lifetime Pro for testers who give weekly feedback.
          </p>
          <div className="flex justify-center">
            <WaitlistForm />
          </div>
          <p className="mt-6 text-sm text-[#807d72]">
            Or{" "}
            <TryFreeButton location="waitlist_section" variant="text">
              try it right now
            </TryFreeButton>{" "}
            — no waiting.
          </p>
        </section>
      </main>

      <footer className="border-t border-[#e6e5e0]">
        <div className="mx-auto max-w-6xl px-6 py-8 text-center text-[13px] text-[#807d72]">
          NetDesign AI — base configurations are a starting point; validate in a lab before production.
        </div>
      </footer>
    </div>
  );
}
