import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { HeroDiagram } from "@/components/landing/HeroDiagram";
import { TryFreeButton } from "@/components/landing/TryFreeButton";
import { WaitlistForm } from "@/components/landing/WaitlistForm";

const STEPS = [
  {
    title: "Describe it in plain English",
    body: '"Branch office, dual routers with HSRP, guest and corporate VLANs, FortiGate at the edge." No templates, no wizards.',
  },
  {
    title: "The engine designs it",
    body: "IP addressing, VLANs, and redundancy are computed deterministically and validated against a schema — no overlapping subnets, no guesswork.",
  },
  {
    title: "Download the deliverables",
    body: "An interactive diagram, an editable Visio (.vsdx) file, a High-Level Design doc, and vendor base configs — in minutes, not days.",
  },
];

const DELIVERABLES = [
  { label: "Interactive topology diagram" },
  { label: "Editable Visio (.vsdx) export" },
  { label: "HLD specification document" },
  { label: "Cisco IOS base configurations" },
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
    <main className="mx-auto max-w-5xl px-4">
      {/* Hero */}
      <section className="grid items-center gap-10 py-16 md:grid-cols-2 md:py-24">
        <div>
          <p className="mb-3 text-sm font-medium uppercase tracking-wide text-indigo-600 dark:text-indigo-400">
            NetDesign AI
          </p>
          <h1 className="mb-4 text-4xl font-semibold leading-tight text-slate-900 dark:text-slate-50 md:text-5xl">
            Plain-English requirement in. Validated network design out.
          </h1>
          <p className="mb-8 text-lg text-slate-600 dark:text-slate-300">
            Describe the network you need and get a schema-validated design, an interactive diagram, a Visio file,
            an HLD document, and base configs — in minutes. The addressing is computed by a deterministic engine,
            not guessed by a chatbot.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <TryFreeButton
              location="hero"
              className="rounded-md bg-slate-900 px-5 py-3 text-sm font-medium text-white dark:bg-white dark:text-slate-900"
            >
              Try it free
            </TryFreeButton>
            <a
              href="#waitlist"
              className="rounded-md border border-slate-300 px-5 py-3 text-sm font-medium text-slate-700 dark:border-slate-600 dark:text-slate-200"
            >
              Join the beta waitlist
            </a>
          </div>
        </div>
        <div className="flex justify-center text-slate-900 dark:text-slate-100">
          <HeroDiagram />
        </div>
      </section>

      {/* How it works */}
      <section className="border-t border-slate-200 py-16 dark:border-slate-800">
        <h2 className="mb-10 text-center text-2xl font-semibold text-slate-900 dark:text-slate-50">How it works</h2>
        <ol className="grid gap-8 md:grid-cols-3">
          {STEPS.map((step, index) => (
            <li key={step.title}>
              <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-full bg-indigo-600 text-sm font-semibold text-white">
                {index + 1}
              </div>
              <h3 className="mb-1 font-medium text-slate-900 dark:text-slate-100">{step.title}</h3>
              <p className="text-sm text-slate-600 dark:text-slate-300">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Deliverables */}
      <section className="border-t border-slate-200 py-16 dark:border-slate-800">
        <div className="grid items-center gap-8 md:grid-cols-2">
          <div>
            <h2 className="mb-3 text-2xl font-semibold text-slate-900 dark:text-slate-50">
              Everything you&rsquo;d hand a client
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              One prompt produces a complete, documented starting point — reviewed by you, lab-validated before
              production. It&rsquo;s the difference between a rough draft and a senior engineer&rsquo;s deliverable.
            </p>
          </div>
          <ul className="grid gap-3">
            {DELIVERABLES.map((item) => (
              <li
                key={item.label}
                className="flex items-center gap-3 rounded-md border border-slate-200 px-4 py-3 text-sm text-slate-700 dark:border-slate-700 dark:text-slate-200"
              >
                <span className="text-indigo-600 dark:text-indigo-400">✓</span>
                {item.label}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Waitlist */}
      <section id="waitlist" className="border-t border-slate-200 py-16 text-center dark:border-slate-800">
        <h2 className="mb-2 text-2xl font-semibold text-slate-900 dark:text-slate-50">Be a beta tester</h2>
        <p className="mx-auto mb-6 max-w-xl text-sm text-slate-600 dark:text-slate-300">
          We&rsquo;re onboarding network engineers in small batches. Join the waitlist and bring your gnarliest
          real-world scenario — free lifetime Pro for testers who give weekly feedback.
        </p>
        <div className="flex justify-center">
          <WaitlistForm />
        </div>
        <p className="mt-6 text-sm text-slate-500 dark:text-slate-400">
          Or{" "}
          <TryFreeButton
            location="waitlist_section"
            className="font-medium text-indigo-600 underline dark:text-indigo-400"
          >
            try it right now
          </TryFreeButton>{" "}
          — no waiting.
        </p>
      </section>

      <footer className="border-t border-slate-200 py-8 text-center text-xs text-slate-400 dark:border-slate-800">
        NetDesign AI — base configurations are a starting point; validate in a lab before production.
      </footer>
    </main>
  );
}
