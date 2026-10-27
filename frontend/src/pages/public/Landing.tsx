import { Link } from "react-router-dom";
import { ArrowRight, Building2, CalendarClock, FileSearch, Landmark, ShieldCheck } from "lucide-react";

const STEPS = [
  {
    icon: Building2,
    title: "1 · Institution submits",
    detail: "The college records the deposit: bank, receipt reference, amount in exact minor units, dates and documents.",
  },
  {
    icon: FileSearch,
    title: "2 · Officer reviews",
    detail: "A reviewing officer inspects the case, records field-level evidence and requests corrections when details disagree.",
  },
  {
    icon: CalendarClock,
    title: "3 · Dates are monitored",
    detail: "Maturity and renewal timelines produce tasks and reminders automatically — nothing depends on someone opening a dashboard.",
  },
  {
    icon: ShieldCheck,
    title: "4 · Authorised release",
    detail: "Release decisions pass an evidence-based readiness check, a recording officer recommendation and an approving-authority decision.",
  },
];

export function LandingPage() {
  return (
    <div className="min-h-screen bg-surface">
      <header className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-navy-900 text-white">
            <Landmark className="h-4 w-4" aria-hidden />
          </span>
          <div>
            <p className="text-sm font-semibold text-slate-900">Security Deposit &amp; FDR Portal</p>
            <p className="text-xs text-slate-500">SIH26265 prototype</p>
          </div>
        </div>
        <p className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800 ring-1 ring-amber-200">
          Prototype · uses synthetic sample data · not affiliated with AICTE
        </p>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-16">
        <section className="grid gap-8 py-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
              Track security deposits and fixed deposit receipts from submission to authorised release
            </h1>
            <p className="mt-4 max-w-xl text-slate-600">
              A working prototype that keeps pending work visible and every decision explainable:
              submission, review with recorded evidence, discrepancy handling, date monitoring,
              replacement continuity and an audit trail you can replay. Sample policies are
              clearly labelled — no official regulator rules are implied.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Link
              to="/login/college"
              className="app-card group p-5 transition-colors hover:border-teal-300 hover:shadow-md"
            >
              <Building2 className="h-6 w-6 text-teal-700" aria-hidden />
              <p className="mt-3 font-semibold text-slate-900">College Login</p>
              <p className="mt-1 text-sm text-slate-500">Submit and correct your institution's deposit records.</p>
              <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-teal-700">
                Go to college login <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
              </span>
            </Link>
            <Link
              to="/login/officer"
              className="app-card group p-5 transition-colors hover:border-teal-300 hover:shadow-md"
            >
              <ShieldCheck className="h-6 w-6 text-navy-900" aria-hidden />
              <p className="mt-3 font-semibold text-slate-900">AICTE Officer Login</p>
              <p className="mt-1 text-sm text-slate-500">Reviewing officers and the approving authority share this entry point.</p>
              <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-teal-700">
                Go to officer login <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
              </span>
            </Link>
          </div>
        </section>

        <section aria-labelledby="process-heading" className="py-6">
          <h2 id="process-heading" className="text-lg font-semibold text-slate-900">
            Four steps from receipt to release
          </h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map(({ icon: Icon, title, detail }) => (
              <div key={title} className="app-card p-4">
                <Icon className="h-5 w-5 text-teal-700" aria-hidden />
                <p className="mt-2 text-sm font-semibold text-slate-900">{title}</p>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">{detail}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-900">What this prototype does (and does not do)</h2>
          <ul className="mt-3 grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
            <li className="flex gap-2"><span aria-hidden>✓</span> Persists real workflows in PostgreSQL</li>
            <li className="flex gap-2"><span aria-hidden>✓</span> Server-enforced roles, institutions and jurisdiction</li>
            <li className="flex gap-2"><span aria-hidden>✓</span> Records verification evidence and corrections</li>
            <li className="flex gap-2"><span aria-hidden>✗</span> Does not move money or act as a bank system</li>
            <li className="flex gap-2"><span aria-hidden>✗</span> Contains no real credentials or personal data</li>
            <li className="flex gap-2"><span aria-hidden>✗</span> Does not claim regulations, amounts or timelines</li>
          </ul>
        </section>
      </main>
    </div>
  );
}
