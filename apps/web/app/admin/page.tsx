import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Owner-only beta dashboard: waitlist signups vs. testers who actually signed
 * in, so the founder can see the funnel gap without opening the Supabase
 * dashboard. Gated on ADMIN_EMAIL rather than a roles/RBAC system, per
 * CLAUDE.md's scope guard ("no teams/RBAC beyond owner").
 *
 * Always dynamic — it reads per-request auth and must never be cached or
 * prerendered into a static page.
 */
export const dynamic = "force-dynamic";

const ROW_LIMIT = 100;

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

export default async function AdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // 404 rather than 403: don't reveal that this page exists to anyone else.
  // (Middleware already blocks signed-out users from reaching /admin at all.)
  const adminEmail = process.env["ADMIN_EMAIL"]?.toLowerCase();
  if (!user || !adminEmail || user.email?.toLowerCase() !== adminEmail) {
    notFound();
  }

  const admin = createAdminClient();
  if (!admin) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-10">
        <h1 className="mb-4 text-2xl font-semibold">Beta dashboard</h1>
        <p className="rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <code>SUPABASE_SERVICE_ROLE_KEY</code> is not set, so the waitlist and tester list can&apos;t be read.
          Add it in Vercel → Settings → Environment Variables (Supabase → Settings → API → service_role).
        </p>
      </main>
    );
  }

  const [waitlistResult, usersResult] = await Promise.all([
    admin
      .from("waitlist")
      .select("id, email, source, created_at", { count: "exact" })
      .order("created_at", { ascending: false })
      .limit(ROW_LIMIT),
    admin.auth.admin.listUsers({ page: 1, perPage: ROW_LIMIT }),
  ]);

  const waitlist = waitlistResult.data ?? [];
  const waitlistTotal = waitlistResult.count ?? waitlist.length;
  const testers = usersResult.data?.users ?? [];
  const signedInCount = testers.filter((u) => u.last_sign_in_at).length;

  const { count: projectCount } = await admin.from("projects").select("id", { count: "exact", head: true });

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="mb-1 text-2xl font-semibold">Beta dashboard</h1>
      <p className="mb-6 text-sm text-slate-500">
        Owner-only. Full event analytics live in PostHog — this is the raw signup/tester list.
      </p>

      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Waitlist" value={waitlistTotal} />
        <Stat label="Accounts" value={testers.length} />
        <Stat label="Signed in ≥1×" value={signedInCount} />
        <Stat label="Projects" value={projectCount ?? 0} />
      </div>

      {(waitlistResult.error || usersResult.error) && (
        <p className="mb-6 rounded-md bg-red-50 px-4 py-3 text-sm text-red-800">
          {waitlistResult.error?.message ?? usersResult.error?.message}
        </p>
      )}

      <Section title={`Testers (${testers.length})`} empty={testers.length === 0} emptyText="No accounts yet.">
        <Table headers={["Email", "Signed up", "Last sign-in"]}>
          {testers.map((tester) => (
            <tr key={tester.id} className="border-t border-slate-100">
              <Td>{tester.email ?? "—"}</Td>
              <Td>{formatDate(tester.created_at)}</Td>
              <Td>{tester.last_sign_in_at ? formatDate(tester.last_sign_in_at) : "never"}</Td>
            </tr>
          ))}
        </Table>
      </Section>

      <Section
        title={`Waitlist (${waitlistTotal})`}
        empty={waitlist.length === 0}
        emptyText="Nobody on the waitlist yet."
      >
        <Table headers={["Email", "Source", "Joined"]}>
          {waitlist.map((entry) => (
            <tr key={entry.id} className="border-t border-slate-100">
              <Td>{entry.email}</Td>
              <Td>{entry.source ?? "—"}</Td>
              <Td>{formatDate(entry.created_at)}</Td>
            </tr>
          ))}
        </Table>
        {waitlist.length > 0 && (
          <details className="mt-3">
            <summary className="cursor-pointer text-sm text-slate-500">Copy all emails</summary>
            <textarea
              readOnly
              rows={4}
              className="mt-2 w-full rounded-md border border-slate-300 p-2 font-mono text-xs"
              value={waitlist.map((entry) => entry.email).join(", ")}
            />
          </details>
        )}
      </Section>

      {(waitlistTotal > ROW_LIMIT || testers.length === ROW_LIMIT) && (
        <p className="text-xs text-slate-400">Showing the {ROW_LIMIT} most recent of each.</p>
      )}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-200 px-4 py-3">
      <p className="text-2xl font-semibold">{value}</p>
      <p className="text-xs text-slate-500">{label}</p>
    </div>
  );
}

function Section({
  title,
  empty,
  emptyText,
  children,
}: {
  title: string;
  empty: boolean;
  emptyText: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
      {empty ? <p className="text-sm text-slate-500">{emptyText}</p> : children}
    </section>
  );
}

function Table({ headers, children }: { headers: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            {headers.map((header) => (
              <th key={header} className="px-4 py-2 font-medium">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-4 py-2 text-slate-700">{children}</td>;
}
