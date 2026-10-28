/**
 * Case workspace: the single screen for one instrument with seven tabs
 * (Overview / Documents / Verification / Corrections / Versions / Release
 * history / Activity) plus the persistent "Next action" banner.
 */
import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  CircleAlert,
  Download,
  FileUp,
  Info,
} from "lucide-react";
import {
  cancelCorrection,
  createCorrection,
  createReleaseRequest,
  decideRelease,
  fetchCase,
  fetchCaseGuidance,
  fetchDocuments,
  recordCheck,
  respondCorrection,
  startReview,
  uploadDocument,
  verifyCase,
  recommendReplacement,
  fetchDocument,
} from "../../services/portal";
import { errorToMessage, useToasts } from "../../components/ui/Toasts";
import { Card, CardBody, CardHeader } from "../../components/ui/Card";
import { EmptyState, ErrorState, Spinner } from "../../components/ui/States";
import {
  CorrectionStatusBadge,
  DateConditionBadge,
  ReleaseStatusBadge,
  ReviewStatusBadge,
  StatusBadge,
} from "../../components/ui/Badges";
import { Button } from "../../components/ui/Button";
import { formatDateTimeShort, formatLocalDate, formatMoney, formatRelativeDays } from "../../utils/format";
import { CHECK_FIELDS, INSTRUMENT_TYPE_LABELS } from "@sih26265/contracts";
import type { CaseDetail, CheckRecord } from "@sih26265/contracts";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "documents", label: "Documents" },
  { key: "verification", label: "Verification" },
  { key: "corrections", label: "Corrections & versions" },
  { key: "renewal", label: "Renewal history" },
  { key: "release", label: "Release history" },
  { key: "activity", label: "Activity" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

const CHECK_FIELD_LABELS: Record<string, string> = {
  amount: "Deposit amount",
  reference_no: "Receipt / reference number",
  bank_name: "Bank name",
  bank_branch: "Branch",
  maturity_date: "Maturity date",
  issue_date: "Issue date",
  ifsc: "IFSC code",
  beneficiary_name: "Beneficiary name",
  instrument_type: "Instrument type",
};

const CHECK_OUTCOME_LABELS: Record<string, string> = {
  MATCH: "Match",
  MISMATCH: "Mismatch",
  SOURCE_UNAVAILABLE: "Source unavailable",
  MANUAL_REQUIRED: "Manual required",
  NOT_YET_CHECKED: "Not yet checked",
};

const CHECK_OUTCOME_BADGES: Record<string, string> = {
  MATCH: "pass",
  MISMATCH: "fail",
  SOURCE_UNAVAILABLE: "pending",
  MANUAL_REQUIRED: "pending",
  NOT_YET_CHECKED: "na",
};

function readinessDot(status: string): string {
  if (status === "pass") return "bg-teal-500";
  if (status === "fail") return "bg-rose-500";
  if (status === "pending") return "bg-amber-500";
  return "bg-slate-300";
}

function readinessRowClasses(status: string): string {
  if (status === "fail") return "bg-rose-50/50";
  if (status === "pass") return "bg-teal-50/40";
  return "";
}

export function CaseDetailPage() {
  const { fdrId } = useParams<{ fdrId: string }>();
  const id = Number(fdrId);
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const activeTab = (TABS.find((tab) => tab.key === searchParams.get("tab"))?.key ?? "overview") as TabKey;

  const caseQuery = useQuery({
    queryKey: ["case", id],
    queryFn: () => fetchCase(id),
    retry: false,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["case", id] });
    void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    void queryClient.invalidateQueries({ queryKey: ["fdrs"] });
  };

  if (caseQuery.isPending) {
    return <Spinner label="Loading the case workspace..." />;
  }
  if (caseQuery.isError) {
    const status = (caseQuery.error as { status?: number }).status;
    if (status === 403 || status === 404) {
      return (
        <div className="mx-auto max-w-lg">
          <ErrorState
            title={status === 403 ? "This case is outside your access" : "Case not found"}
            detail="The case may belong to another institution or jurisdiction."
          />
          <div className="mt-3 text-center">
            <Link to="/fdrs" className="text-sm font-medium text-teal-700 hover:underline">
              Back to the register
            </Link>
          </div>
        </div>
      );
    }
    return <ErrorState title="Could not load the case" detail={errorToMessage(caseQuery.error)} onRetry={() => void caseQuery.refetch()} />;
  }

  const data = caseQuery.data;
  const p = data.permissions;
  const v = data.currentVersion;

  return (
    <div>
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden /> Back
      </button>

      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">{data.publicCode}</h1>
            <ReviewStatusBadge status={data.status} />
            <DateConditionBadge condition={data.dateCondition} />
            <ReleaseStatusBadge status={data.releaseStatus} />
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {data.institution.name} ({data.institution.code}) &middot;{" "}
            {INSTRUMENT_TYPE_LABELS[v.instrumentType]} &middot; version {data.currentVersionNo}
            {data.verifiedAt != null && ` &middot; verified ${formatDateTimeShort(data.verifiedAt)}`}
          </p>
        </div>
      </div>

      {data.nextAction != null && (
        <div className={`mb-4 rounded-xl border px-4 py-3 ${data.nextAction.actionAvailable ? "border-teal-300 bg-teal-50" : "border-slate-200 bg-slate-50"}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Next action</p>
              <p className="mt-0.5 text-sm text-slate-800">
                <span className="font-medium">{data.nextAction.stage}</span> &middot;{" "}
                {data.nextAction.responsible}: {data.nextAction.action}
                {data.nextAction.dueDate != null && (
                  <span className="ml-1 text-slate-500">(by {formatLocalDate(data.nextAction.dueDate)})</span>
                )}
              </p>
            </div>
            {data.nextAction.actionAvailable && data.nextAction.actionPath != null && (
              <button
                type="button"
                onClick={() => {
                  const path = data.nextAction?.actionPath ?? "";
                  const [, tabQuery] = path.split("?");
                  const tab = new URLSearchParams(tabQuery ?? "").get("tab");
                  if (tab != null) {
                    setSearchParams({ tab }, { replace: true });
                  } else if (path.startsWith("/")) {
                    navigate(path);
                  }
                }}
                className="app-btn-primary !py-1.5"
              >
                Take me there
              </button>
            )}
          </div>
        </div>
      )}

      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200" role="tablist" aria-label="Case sections">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.key}
            onClick={() => setSearchParams({ tab: tab.key }, { replace: true })}
            className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm ${
              activeTab === tab.key
                ? "border-teal-600 font-medium text-teal-700"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "overview" && <OverviewTab data={data} />}
      {activeTab === "documents" && <DocumentsTab fdrId={id} canUpload={p.canUploadDocument} onChange={invalidate} />}
      {activeTab === "verification" && <VerificationTab data={data} onChange={invalidate} />}
      {activeTab === "corrections" && <CorrectionsTab data={data} onChange={invalidate} />}
      {activeTab === "renewal" && <RenewalTab data={data} />}
      {activeTab === "release" && <ReleaseTab data={data} onChange={invalidate} />}
      {activeTab === "activity" && <ActivityTab data={data} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

function OverviewTab({ data }: { data: CaseDetail }) {
  const guidance = useQuery({
    queryKey: ["guidance", data.id],
    queryFn: () => fetchCaseGuidance(data.id),
    staleTime: 60_000,
  });
  const v = data.currentVersion;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title="Recorded instrument details" subtitle={`Version ${v.versionNo} snapshot (immutable)`} />
        <CardBody>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <div>
              <dt className="text-xs text-slate-500">Instrument type</dt>
              <dd className="text-slate-900">{INSTRUMENT_TYPE_LABELS[v.instrumentType]}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Amount</dt>
              <dd className="tabular-nums text-slate-900">{formatMoney(v.amount)}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Bank</dt>
              <dd className="text-slate-900">{v.bankName}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Branch</dt>
              <dd className="text-slate-900">{v.bankBranch}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Reference</dt>
              <dd className="font-mono text-xs text-slate-900">{v.referenceNo}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">IFSC</dt>
              <dd className="font-mono text-xs text-slate-900">{v.ifsc ?? "not recorded"}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Beneficiary</dt>
              <dd className="text-slate-900">{v.beneficiaryName ?? "not recorded"}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Maturity</dt>
              <dd className="text-slate-900">
                {formatLocalDate(v.maturityDate)}{" "}
                <span className={`text-xs ${data.daysToMaturity < 0 ? "text-rose-600" : "text-amber-600"}`}>
                  ({formatRelativeDays(data.daysToMaturity)})
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Issue date</dt>
              <dd className="text-slate-900">{formatLocalDate(v.issueDate)}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Submitted by</dt>
              <dd className="text-slate-900">{v.submittedByName ?? "draft"}</dd>
            </div>
            {v.remarks != null && (
              <div className="col-span-2">
                <dt className="text-xs text-slate-500">Remarks</dt>
                <dd className="text-slate-700">{v.remarks}</dd>
              </div>
            )}
          </dl>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Verification readiness" subtitle={data.readiness.headline} />
        <CardBody className="!pt-2">
          {data.readiness.scorePercent != null && (
            <div className="mb-3">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>Checklist completeness (display only)</span>
                <span className="font-medium text-slate-700">{data.readiness.scorePercent}%</span>
              </div>
              <div className="mt-1 h-1.5 w-full rounded-full bg-slate-100">
                <div
                  className="h-1.5 rounded-full bg-teal-500"
                  style={{ width: `${Math.min(100, Math.max(0, data.readiness.scorePercent))}%` }}
                />
              </div>
            </div>
          )}
          <ul className="space-y-1">
            {data.readiness.items.map((item) => (
              <li key={item.key} className={`rounded-lg px-2.5 py-2 ${readinessRowClasses(item.status)}`}>
                <div className="flex items-start gap-2">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${readinessDot(item.status)}`} aria-hidden />
                  <div className="min-w-0">
                    <p className="text-sm text-slate-800">
                      {item.label}
                      {item.isBlocker && <span className="ml-1.5 text-xs font-medium text-rose-600">blocker</span>}
                    </p>
                    <p className="text-xs text-slate-500">{item.reason}</p>
                    {item.status !== "pass" && item.nextAction != null && (
                      <p className="mt-0.5 text-xs font-medium text-slate-600">Next: {item.nextAction}</p>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-3 border-t border-slate-100 pt-2 text-xs text-slate-400">{data.readiness.policyNote}</p>
        </CardBody>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader title="Case guidance" subtitle={guidance.data?.headline ?? "Deterministic, rule-based summary"} />
        <CardBody>
          {guidance.isPending ? (
            <Spinner label="Preparing guidance..." className="!py-4" />
          ) : guidance.isError ? (
            <p className="text-sm text-slate-500">Guidance is unavailable right now.</p>
          ) : (
            <>
              <ul className="list-inside list-disc space-y-1 text-sm text-slate-700">
                {guidance.data?.bullets.map((bullet, index) => (
                  <li key={index}>{bullet}</li>
                ))}
              </ul>
              <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-slate-50 px-2.5 py-2 text-xs text-slate-500">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                {guidance.data?.disclaimer}
              </p>
            </>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

function DocumentsTab({ fdrId, canUpload, onChange }: { fdrId: number; canUpload: boolean; onChange: () => void }) {
  const toasts = useToasts();
  const documents = useQuery({
    queryKey: ["documents", fdrId],
    queryFn: () => fetchDocuments(fdrId),
  });
  const upload = useMutation({
    mutationFn: (file: File) => uploadDocument(fdrId, file),
    onSuccess: (meta) => {
      toasts.success(`Uploaded ${meta.fileName} (checksum recorded).`);
      onChange();
    },
    onError: (error) => toasts.error(errorToMessage(error)),
  });

  const onDownload = async (docId: number) => {
    try {
      const body = await fetchDocument(docId);
      const bytes = Uint8Array.from(atob(body.contentBase64), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: body.meta.mimeType });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = body.meta.fileName;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      toasts.error(errorToMessage(error));
    }
  };

  return (
    <Card>
      <CardHeader
        title="Instrument documents"
        subtitle="PDF or image scan of the instrument. The file content is checksummed (SHA-256) and stored with the case."
      />
      <CardBody>
        {canUpload && (
          <form
            className="mb-4 flex flex-wrap items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const input = event.currentTarget.elements.namedItem("file");
              const file = input instanceof HTMLInputElement ? input.files?.[0] : undefined;
              if (file != null) {
                upload.mutate(file);
                if (input instanceof HTMLInputElement) input.value = "";
              }
            }}
          >
            <input
              type="file"
              name="file"
              required
              accept="application/pdf,image/jpeg,image/png"
              className="app-input max-w-sm"
              aria-label="Choose a document to upload"
            />
            <Button type="submit" disabled={upload.isPending}>
              <FileUp className="h-4 w-4" aria-hidden /> {upload.isPending ? "Uploading..." : "Upload"}
            </Button>
          </form>
        )}
        {documents.isPending ? (
          <Spinner label="Loading documents..." />
        ) : documents.isError ? (
          <ErrorState title="Could not load documents" detail={errorToMessage(documents.error)} onRetry={() => void documents.refetch()} />
        ) : documents.data == null || documents.data.items.length === 0 ? (
          <EmptyState
            title="No documents uploaded"
            detail={canUpload ? "Upload the instrument scan above." : "The college has not uploaded documents yet."}
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {documents.data.items.map((doc) => (
              <li key={doc.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm text-slate-800">{doc.fileName}</p>
                  <p className="text-xs text-slate-500">
                    {doc.mimeType.replace("application/", "").toUpperCase()} &middot; {Math.max(1, Math.round(doc.sizeBytes / 1024))} KB &middot;{" "}
                    uploaded by {doc.uploadedByName ?? "unknown"} on {formatDateTimeShort(doc.uploadedAt)}
                  </p>
                  <p className="font-mono text-[10px] text-slate-400">sha256: {doc.checksumSha256.slice(0, 16)}...</p>
                </div>
                <button type="button" onClick={() => void onDownload(doc.id)} className="app-btn-secondary !px-3 !py-1.5">
                  <Download className="h-4 w-4" aria-hidden /> Download
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

function VerificationTab({ data, onChange }: { data: CaseDetail; onChange: () => void }) {
  const toasts = useToasts();
  const queryClient = useQueryClient();

  const start = useMutation({
    mutationFn: () => startReview(data.id),
    onSuccess: (result) => {
      toasts.success(result.message ?? "Review started.");
      onChange();
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (error) => toasts.error(errorToMessage(error)),
  });

  const verify = useMutation({
    mutationFn: (note: string) => verifyCase(data.id, note),
    onSuccess: (result) => {
      toasts.success(result.message ?? "Case verified.");
      onChange();
      void queryClient.invalidateQueries({ queryKey: ["approvals"] });
    },
    onError: (error) => toasts.error(errorToMessage(error)),
  });

  return (
    <div className="space-y-4">
      {data.readiness.blockers.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="flex items-center gap-2 font-medium">
            <CircleAlert className="h-4 w-4" aria-hidden /> Verification is blocked until these items clear:
          </p>
          <ul className="mt-1 list-inside list-disc text-xs">
            {data.readiness.blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        </div>
      )}

      <Card>
        <CardHeader
          title="Evidence checks (SIMULATED sources)"
          subtitle="Recorded per immutable version. A SIMULATED bank check compares the submitted value with the observed value you enter; the outcome is derived server-side and never random."
        />
        <CardBody>
          {data.permissions.canStartReview && (
            <div className="mb-4 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2">
              <p className="text-sm text-sky-900">This case has not been picked up for review yet.</p>
              <Button type="button" className="mt-2" disabled={start.isPending} onClick={() => start.mutate()}>
                {start.isPending ? "Starting..." : "Start review"}
              </Button>
            </div>
          )}
          {data.permissions.canRecordCheck && <CheckForm data={data} onChange={onChange} />}

          {data.checks.length === 0 ? (
            <EmptyState
              title="No checks recorded"
              detail={data.permissions.canRecordCheck ? "Record the first check below." : "Checks appear here once the reviewing officer records them."}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="app-table">
                <thead>
                  <tr>
                    <th scope="col">Field</th>
                    <th scope="col">Submitted</th>
                    <th scope="col">Observed</th>
                    <th scope="col">Outcome</th>
                    <th scope="col">Source</th>
                    <th scope="col">Version</th>
                    <th scope="col">Recorded</th>
                  </tr>
                </thead>
                <tbody>
                  {data.checks.map((check) => (
                    <CheckRow key={check.id} check={check} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Verify the case" subtitle={data.readiness.headline} />
        <CardBody>
          {data.permissions.canVerify ? (
            <VerifyForm
              onSubmit={(note) => verify.mutate(note)}
              pending={verify.isPending}
              blocked={data.readiness.blockers.length > 0}
            />
          ) : (
            <p className="text-sm text-slate-500">
              {data.status === "verified"
                ? "This case is verified."
                : "Verification is performed by the reviewing officer once every check is recorded."}
            </p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function CheckRow({ check }: { check: CheckRecord }) {
  return (
    <tr className={check.invalidatedAt != null ? "bg-slate-50/70" : undefined}>
      <td className="font-medium text-slate-800">{CHECK_FIELD_LABELS[check.field] ?? check.field}</td>
      <td className="max-w-40 truncate font-mono text-xs" title={check.submittedValue ?? ""}>
        {check.submittedValue ?? "-"}
      </td>
      <td className="max-w-40 truncate font-mono text-xs" title={check.observedValue ?? ""}>
        {check.observedValue ?? "-"}
      </td>
      <td>
        <StatusBadge value={CHECK_OUTCOME_BADGES[check.outcome] ?? "na"} label={CHECK_OUTCOME_LABELS[check.outcome] ?? check.outcome} />
      </td>
      <td className="text-xs text-slate-600">
        {check.source === "SIMULATED_BANK_CHECK" ? "Simulated bank" : check.source === "MANUAL_OFFICER_REVIEW" ? "Officer review" : "Document"}
      </td>
      <td className="text-xs tabular-nums text-slate-600">v{check.fdrVersionNo}</td>
      <td className="text-xs text-slate-500">
        {formatDateTimeShort(check.checkedAt)}
        {check.invalidatedAt != null && (
          <span className="mt-0.5 block text-amber-700" title={check.invalidatedReason ?? undefined}>
            invalidated at v{check.invalidatedVersionNo ?? "?"} (correction)
          </span>
        )}
      </td>
    </tr>
  );
}

function CheckForm({ data, onChange }: { data: CaseDetail; onChange: () => void }) {
  const toasts = useToasts();
  const [field, setField] = useState<string>("amount");
  const [source, setSource] = useState<"SIMULATED_BANK_CHECK" | "MANUAL_OFFICER_REVIEW" | "DOCUMENT_FINGERPRINT">("SIMULATED_BANK_CHECK");
  const [observedValue, setObservedValue] = useState("");
  const [reason, setReason] = useState("");
  const [evidenceRef, setEvidenceRef] = useState("");
  const [manualOutcome, setManualOutcome] = useState<"MATCH" | "MISMATCH" | "SOURCE_UNAVAILABLE" | "MANUAL_REQUIRED">("MATCH");

  const check = useMutation({
    mutationFn: () =>
      recordCheck(data.id, {
        fdrId: data.id,
        field,
        source,
        observedValue,
        reason,
        evidenceRef,
        outcome: source === "SIMULATED_BANK_CHECK" ? undefined : manualOutcome,
      }),
    onSuccess: () => {
      toasts.success("Check recorded for the current version.");
      setObservedValue("");
      setReason("");
      setEvidenceRef("");
      onChange();
    },
    onError: (error) => toasts.error(errorToMessage(error)),
  });

  const submittedDisplay = submittedValueFor(data, field);

  return (
    <form
      className="mb-5 rounded-lg border border-slate-200 bg-slate-50/60 p-3"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        check.mutate();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label>
          <span className="app-label">Field to check</span>
          <select className="app-input" value={field} onChange={(e) => setField(e.target.value)}>
            {CHECK_FIELDS.map((key) => (
              <option key={key} value={key}>
                {CHECK_FIELD_LABELS[key] ?? key}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-500">Submitted value: {submittedDisplay}</p>
        </label>
        <label>
          <span className="app-label">Source</span>
          <select
            className="app-input"
            value={source}
            onChange={(e) => setSource(e.target.value as typeof source)}
          >
            <option value="SIMULATED_BANK_CHECK">Simulated bank check</option>
            <option value="MANUAL_OFFICER_REVIEW">Manual officer review</option>
            <option value="DOCUMENT_FINGERPRINT">Document fingerprint</option>
          </select>
        </label>
        {source === "SIMULATED_BANK_CHECK" ? (
          <label>
            <span className="app-label">Observed value</span>
            <input
              className="app-input"
              value={observedValue}
              onChange={(e) => setObservedValue(e.target.value)}
              placeholder="Value confirmed from the source"
            />
            <p className="mt-1 text-xs text-slate-500">Outcome is derived: submitted == observed gives Match.</p>
          </label>
        ) : (
          <label>
            <span className="app-label">Outcome</span>
            <select
              className="app-input"
              value={manualOutcome}
              onChange={(e) => setManualOutcome(e.target.value as typeof manualOutcome)}
            >
              <option value="MATCH">Match</option>
              <option value="MISMATCH">Mismatch</option>
              <option value="SOURCE_UNAVAILABLE">Source unavailable</option>
              <option value="MANUAL_REQUIRED">Manual required</option>
            </select>
          </label>
        )}
        <label>
          <span className="app-label">Reason / note (optional)</span>
          <input className="app-input" value={reason} maxLength={600} onChange={(e) => setReason(e.target.value)} />
        </label>
        <label>
          <span className="app-label">Evidence reference (optional)</span>
          <input
            className="app-input"
            value={evidenceRef}
            maxLength={200}
            onChange={(e) => setEvidenceRef(e.target.value)}
            placeholder="e.g. confirmation email id"
          />
        </label>
      </div>
      <div className="mt-3">
        <Button type="submit" disabled={check.isPending}>
          {check.isPending ? "Recording..." : "Record check"}
        </Button>
      </div>
    </form>
  );
}

function submittedValueFor(data: CaseDetail, field: string): string {
  const v = data.currentVersion;
  switch (field) {
    case "amount":
      return formatMoney(v.amount);
    case "reference_no":
      return v.referenceNo;
    case "bank_name":
      return v.bankName;
    case "bank_branch":
      return v.bankBranch;
    case "maturity_date":
      return v.maturityDate;
    case "issue_date":
      return v.issueDate;
    case "ifsc":
      return v.ifsc ?? "(empty)";
    case "beneficiary_name":
      return v.beneficiaryName ?? "(empty)";
    case "instrument_type":
      return v.instrumentType;
    default:
      return "";
  }
}

function VerifyForm({
  onSubmit,
  pending,
  blocked,
}: {
  onSubmit: (note: string) => void;
  pending: boolean;
  blocked: boolean;
}) {
  const [note, setNote] = useState("");
  return (
    <form
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        onSubmit(note);
      }}
    >
      <label className="block">
        <span className="app-label">Verification note (optional)</span>
        <textarea className="app-input" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {blocked && (
        <p className="mt-2 text-xs text-amber-700">
          The readiness blockers above must clear first; the server refuses to verify while any remain.
        </p>
      )}
      <Button type="submit" className="mt-3" disabled={pending}>
        {pending ? "Verifying..." : "Verify case"}
      </Button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Corrections & versions
// ---------------------------------------------------------------------------

function CorrectionsTab({ data, onChange }: { data: CaseDetail; onChange: () => void }) {
  const toasts = useToasts();

  const respond = useMutation({
    mutationFn: (input: { correctionId: number; values: Array<{ field: string; value: string }>; note: string }) =>
      respondCorrection({ correctionId: input.correctionId, values: input.values, note: input.note }),
    onSuccess: (result) => {
      toasts.success(result.message ?? "Response recorded as a new version.");
      onChange();
    },
    onError: (error) => toasts.error(errorToMessage(error)),
  });

  const cancel = useMutation({
    mutationFn: (correctionId: number) => cancelCorrection(correctionId),
    onSuccess: () => {
      toasts.success("Correction request cancelled.");
      onChange();
    },
    onError: (error) => toasts.error(errorToMessage(error)),
  });

  const request = useMutation({
    mutationFn: (input: { fields: Array<{ field: string; reason: string }>; note: string }) =>
      createCorrection({ fdrId: data.id, fields: input.fields, note: input.note }),
    onSuccess: () => {
      toasts.success("Correction request sent to the college.");
      onChange();
    },
    onError: (error) => toasts.error(errorToMessage(error)),
  });

  const openCorrections = data.corrections.filter((c) => c.status === "OPEN");

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Correction requests" subtitle="Officer-requested field corrections; responses create the next immutable version." />
        <CardBody>
          {data.corrections.length === 0 ? (
            <EmptyState title="No correction requests" />
          ) : (
            <ul className="space-y-3">
              {data.corrections.map((correction) => (
                <CorrectionRow
                  key={correction.id}
                  correction={correction}
                  canRespond={data.permissions.canRespondCorrection && correction.status === "OPEN"}
                  canCancel={data.permissions.canRequestCorrection && correction.status === "OPEN"}
                  respond={respond}
                  cancel={cancel}
                />
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {data.permissions.canRequestCorrection && (
        <Card>
          <CardHeader title="Request a correction" subtitle="Pick the fields that must be corrected; a reason is required per field." />
          <CardBody>
            <RequestCorrectionForm
              onSubmit={(fields, note) => request.mutate({ fields, note })}
              pending={request.isPending}
              disabledFields={new Set(
                openCorrections.flatMap((c) => c.fields.map((entry) => entry.field)),
              )}
            />
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader title="Version history" subtitle="Every submitted snapshot; versions are immutable and never overwritten." />
        <CardBody className="!pt-2">
          <ol className="relative space-y-3 border-l border-slate-200 pl-4">
            {data.versions.map((version) => (
              <li key={version.versionNo} className="relative">
                <span
                  className={`absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-white ${
                    version.versionNo === data.currentVersionNo ? "bg-teal-500" : "bg-slate-300"
                  }`}
                  aria-hidden
                />
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <p className="text-sm font-medium text-slate-800">Version {version.versionNo}</p>
                  {version.versionNo === data.currentVersionNo && (
                    <span className="rounded-full bg-teal-50 px-1.5 py-0.5 text-[10px] font-medium text-teal-700 ring-1 ring-teal-200">current</span>
                  )}
                  <span className="text-xs text-slate-400">{formatDateTimeShort(version.createdAt)}</span>
                </div>
                <p className="text-xs text-slate-600">
                  {INSTRUMENT_TYPE_LABELS[version.instrumentType]} &middot; {version.bankName} &middot;{" "}
                  {formatMoney(version.amount)} &middot; matures {formatLocalDate(version.maturityDate)}
                </p>
              </li>
            ))}
          </ol>
        </CardBody>
      </Card>
    </div>
  );
}

function CorrectionRow({
  correction,
  canRespond,
  canCancel,
  respond,
  cancel,
}: {
  correction: CaseDetail["corrections"][number];
  canRespond: boolean;
  canCancel: boolean;
  respond: { isPending: boolean; mutate: (input: { correctionId: number; values: Array<{ field: string; value: string }>; note: string }) => void };
  cancel: { isPending: boolean; mutate: (correctionId: number) => void };
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");

  return (
    <li className="rounded-lg border border-slate-200 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-slate-800">
            Correction #{correction.id} &middot; version {correction.fdrVersionNo}
          </p>
          <p className="text-xs text-slate-500">
            raised by {correction.requestedByName} on {formatDateTimeShort(correction.createdAt)}
          </p>
        </div>
        <CorrectionStatusBadge status={correction.status} />
      </div>
      <ul className="mt-2 space-y-1 text-xs text-slate-600">
        {correction.fields.map((entry) => (
          <li key={entry.field}>
            <span className="font-medium text-slate-800">{entry.label}:</span> {entry.reason}
          </li>
        ))}
      </ul>
      {correction.note != null && <p className="mt-1 text-xs text-slate-500">Officer note: {correction.note}</p>}

      {correction.status === "RESPONDED" && (
        <div className="mt-2 rounded-lg bg-teal-50/60 px-2.5 py-2 text-xs text-teal-900">
          Answered by {correction.respondedByName ?? "the college"} on{" "}
          {correction.respondedAt != null ? formatDateTimeShort(correction.respondedAt) : "-"}; created version{" "}
          {correction.respondedVersionNo ?? "-"}.
          {correction.respondNote != null && <p className="mt-0.5">Note: {correction.respondNote}</p>}
        </div>
      )}
      {correction.status === "CANCELLED" && (
        <p className="mt-2 text-xs text-slate-400">Cancelled by the reviewing officer.</p>
      )}

      {canRespond && (
        <form
          className="mt-3 space-y-2 border-t border-slate-100 pt-3"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            respond.mutate({
              correctionId: correction.id,
              values: correction.fields.map((entry) => ({ field: entry.field, value: values[entry.field] ?? "" })),
              note,
            });
          }}
        >
          {correction.fields.map((entry) => (
            <label key={entry.field} className="block">
              <span className="app-label">
                {entry.label}
                {entry.field === "amount" && " (rupees, e.g. 500000.55)"}
              </span>
              <input
                className="app-input"
                value={values[entry.field] ?? ""}
                onChange={(e) => setValues((current) => ({ ...current, [entry.field]: e.target.value }))}
                required
              />
            </label>
          ))}
          <label className="block">
            <span className="app-label">Note to the officer (optional)</span>
            <input className="app-input" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
          </label>
          <Button type="submit" disabled={respond.isPending}>
            {respond.isPending ? "Recording..." : "Record corrected values"}
          </Button>
        </form>
      )}
      {canCancel && (
        <button
          type="button"
          onClick={() => cancel.mutate(correction.id)}
          disabled={cancel.isPending}
          className="mt-2 text-xs font-medium text-rose-600 hover:underline"
        >
          Cancel this request
        </button>
      )}
    </li>
  );
}

function RequestCorrectionForm({
  onSubmit,
  pending,
  disabledFields,
}: {
  onSubmit: (fields: Array<{ field: string; reason: string }>, note: string) => void;
  pending: boolean;
  disabledFields: Set<string>;
}) {
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");

  const chosen = CHECK_FIELDS.filter((key) => selected[key]);

  return (
    <form
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        onSubmit(
          chosen.map((field) => ({ field, reason: (reasons[field] ?? "").trim() })),
          note,
        );
      }}
    >
      <div className="grid gap-2 sm:grid-cols-3">
        {CHECK_FIELDS.map((key) => (
          <label
            key={key}
            className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${
              selected[key] ? "border-teal-300 bg-teal-50/50" : "border-slate-200"
            } ${disabledFields.has(key) ? "opacity-50" : ""}`}
          >
            <input
              type="checkbox"
              className="mt-0.5"
              checked={selected[key] ?? false}
              disabled={disabledFields.has(key)}
              onChange={(e) => setSelected((current) => ({ ...current, [key]: e.target.checked }))}
            />
            <span className="text-slate-700">
              {CHECK_FIELD_LABELS[key] ?? key}
              {disabledFields.has(key) && <span className="block text-[10px] text-slate-400">already in an open request</span>}
            </span>
          </label>
        ))}
      </div>
      {chosen.map((field) => (
        <label key={field} className="mt-2 block">
          <span className="app-label">Why must {CHECK_FIELD_LABELS[field] ?? field} be corrected?</span>
          <input
            className="app-input"
            value={reasons[field] ?? ""}
            minLength={5}
            maxLength={600}
            required
            onChange={(e) => setReasons((current) => ({ ...current, [field]: e.target.value }))}
          />
        </label>
      ))}
      <label className="mt-2 block">
        <span className="app-label">Overall note to the college (optional)</span>
        <input className="app-input" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
      </label>
      <Button type="submit" className="mt-3" disabled={pending || chosen.length === 0}>
        {pending ? "Sending..." : "Send correction request"}
      </Button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Renewal history
// ---------------------------------------------------------------------------

function RenewalTab({ data }: { data: CaseDetail }) {
  const toasts = useToasts();
  const queryClient = useQueryClient();
  const recommend = useMutation({
    mutationFn: (note: string) => recommendReplacement({ fdrId: data.id, note }),
    onSuccess: () => {
      toasts.success("Replacement recommended for acceptance.");
      void queryClient.invalidateQueries({ queryKey: ["case", data.id] });
      void queryClient.invalidateQueries({ queryKey: ["replacements"] });
      void queryClient.invalidateQueries({ queryKey: ["approvals"] });
    },
    onError: (error) => toasts.error(errorToMessage(error)),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="This instrument's renewal position" subtitle="Sample policy: maturity alone never establishes a supersession." />
        <CardBody>
          <ul className="space-y-2 text-sm">
            {data.previousFdr != null ? (
              <li className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2">
                <span>
                  Replaces <Link to={`/fdrs/${data.previousFdr.id}`} className="font-medium text-teal-700 hover:underline">{data.previousFdr.publicCode}</Link>{" "}
                  (matured {formatLocalDate(data.previousFdr.maturityDate)})
                </span>
                <span className="text-xs text-slate-500">
                  {data.previousFdr.supersededByFdrId === data.id
                    ? "supersession established"
                    : "awaiting authority acceptance"}
                </span>
              </li>
            ) : (
              <li className="rounded-lg bg-slate-50 px-3 py-2 text-slate-600">Not recorded as a replacement of another instrument.</li>
            )}
            {data.successors.length > 0 ? (
              data.successors.map((successor) => (
                <li key={successor.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2">
                  <span>
                    Replaced by{" "}
                    <Link to={`/fdrs/${successor.id}`} className="font-medium text-teal-700 hover:underline">
                      {successor.publicCode}
                    </Link>
                  </span>
                  <ReviewStatusBadge status={successor.status} />
                </li>
              ))
            ) : (
              <li className="rounded-lg bg-slate-50 px-3 py-2 text-slate-600">No replacement submitted for this instrument yet.</li>
            )}
          </ul>

          {data.readinessReplacement != null && (
            <div className="mt-4 rounded-lg border border-slate-200 p-3">
              <p className="mb-1.5 text-sm font-medium text-slate-800">{data.readinessReplacement.headline}</p>
              <ul className="space-y-1">
                {data.readinessReplacement.items.map((item) => (
                  <li key={item.key} className="flex items-start gap-2 text-xs">
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${readinessDot(item.status)}`} aria-hidden />
                    <span className="text-slate-600">
                      <span className="text-slate-800">{item.label}</span> - {item.reason}
                      {item.status !== "pass" && item.nextAction != null && <span className="block font-medium text-slate-600">Next: {item.nextAction}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Replacement recommendation" subtitle="Only the approving authority's acceptance establishes the supersession." />
        <CardBody>
          {data.permissions.canRecommendReplacement ? (
            <RecommendReplacementForm onSubmit={(note) => recommend.mutate(note)} pending={recommend.isPending} />
          ) : (
            <p className="text-sm text-slate-500">
              The reviewing officer recommends a verified replacement here; the recommending action appears for the
              officer once this replacement case is verified.
            </p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function RecommendReplacementForm({ onSubmit, pending }: { onSubmit: (note: string) => void; pending: boolean }) {
  const [note, setNote] = useState("");
  return (
    <form
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        onSubmit(note);
      }}
    >
      <label className="block">
        <span className="app-label">Note to the approving authority (optional)</span>
        <textarea className="app-input" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <Button type="submit" className="mt-3" disabled={pending}>
        {pending ? "Recording..." : "Recommend replacement for acceptance"}
      </Button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Release history
// ---------------------------------------------------------------------------

function ReleaseTab({ data, onChange }: { data: CaseDetail; onChange: () => void }) {
  const toasts = useToasts();
  const queryClient = useQueryClient();

  const requestRelease = useMutation({
    mutationFn: (input: { reason: string; evidenceType: string; evidenceRef: string }) =>
      createReleaseRequest({
        fdrId: data.id,
        reason: input.reason,
        evidenceType: input.evidenceType as "ORIGINAL_FDR_RECEIPT" | "BANK_ACCOUNT_STATEMENT" | "BANK_REFUND_CONFIRMATION" | "BANK_ADVICE_LETTER" | "OTHER_DOCUMENT",
        evidenceRef: input.evidenceRef,
      }),
    onSuccess: () => {
      toasts.success("Release request opened; it is with the reviewing officer.");
      onChange();
      void queryClient.invalidateQueries({ queryKey: ["releases"] });
    },
    onError: (error) => toasts.error(errorToMessage(error)),
  });

  const action = useMutation({
    mutationFn: (input: { releaseId: number; action: "recommend" | "reject" | "approve"; note: string }) =>
      decideRelease({ releaseId: input.releaseId, action: input.action, note: input.note }),
    onSuccess: (result) => {
      toasts.success(result.message ?? "Release action recorded.");
      onChange();
      void queryClient.invalidateQueries({ queryKey: ["releases"] });
      void queryClient.invalidateQueries({ queryKey: ["approvals"] });
    },
    onError: (error) => toasts.error(errorToMessage(error)),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Release requests"
          subtitle="Approval releases funds to the college; a separate completion step records the external refund evidence."
        />
        <CardBody>
          {data.releases.length === 0 ? (
            <EmptyState title="No release requests" detail="The college raises a release with a reason and evidence." />
          ) : (
            <ul className="space-y-3">
              {data.releases.map((release) => (
                <li key={release.id} className="rounded-lg border border-slate-200 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-slate-800">Request #{release.id}</p>
                      <p className="text-xs text-slate-500">
                        raised by {release.requestedByName} on {formatDateTimeShort(release.createdAt)}
                      </p>
                    </div>
                    <ReleaseStatusBadge status={release.decision ?? "requested"} />
                  </div>
                  <p className="mt-1 text-sm text-slate-700">{release.reason}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {data.permissions.canDecideRelease && release.status === "OPEN" && (
                      <>
                        <ReleaseActionButton
                          label="Recommend"
                          tone="primary"
                          pending={action.isPending}
                          requireNote={false}
                          onConfirm={(note) => action.mutate({ releaseId: release.id, action: "recommend", note })}
                        />
                        <ReleaseActionButton
                          label="Reject"
                          tone="danger"
                          pending={action.isPending}
                          requireNote
                          onConfirm={(note) => action.mutate({ releaseId: release.id, action: "reject", note })}
                        />
                        <ReleaseActionButton
                          label="Approve"
                          tone="primary"
                          pending={action.isPending}
                          requireNote={false}
                          onConfirm={(note) => action.mutate({ releaseId: release.id, action: "approve", note })}
                        />
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {data.permissions.canRequestRelease && (
        <Card>
          <CardHeader title="Request a release" subtitle="Explain why the deposit should be released back to the institution." />
          <CardBody>
            <RequestReleaseForm onSubmit={(reason, evidenceType, evidenceRef) => requestRelease.mutate({ reason, evidenceType, evidenceRef })} pending={requestRelease.isPending} />
          </CardBody>
        </Card>
      )}

      {data.readinessRelease != null && (
        <Card>
          <CardHeader title="Release readiness" subtitle={data.readinessRelease.headline} />
          <CardBody>
            <ul className="space-y-1">
              {data.readinessRelease.items.map((item) => (
                <li key={item.key} className="flex items-start gap-2 text-xs">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${readinessDot(item.status)}`} aria-hidden />
                  <span className="text-slate-600">
                    <span className="text-slate-800">{item.label}</span> - {item.reason}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 border-t border-slate-100 pt-2 text-xs text-slate-400">{data.readinessRelease.policyNote}</p>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function ReleaseActionButton({
  label,
  tone,
  pending,
  requireNote,
  onConfirm,
}: {
  label: string;
  tone: "primary" | "danger";
  pending: boolean;
  requireNote: boolean;
  onConfirm: (note: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");

  if (!open) {
    return (
      <Button
        type="button"
        variant={tone === "danger" ? "secondary" : "primary"}
        className={tone === "danger" ? "!border-rose-300 !text-rose-700 hover:!bg-rose-50" : ""}
        onClick={() => setOpen(true)}
        disabled={pending}
      >
        {label}
      </Button>
    );
  }
  return (
    <form
      className="flex flex-1 items-center gap-2"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        if (requireNote && note.trim().length < 5) return;
        onConfirm(note);
        setOpen(false);
      }}
    >
      <input
        className="app-input max-w-xs"
        placeholder={requireNote ? "Reason (required to reject)" : "Note (optional)"}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        required={requireNote}
        minLength={requireNote ? 5 : undefined}
        autoFocus
      />
      <Button type="submit" variant={tone === "danger" ? "secondary" : "primary"} className={tone === "danger" ? "!border-rose-300 !text-rose-700 hover:!bg-rose-50" : ""} disabled={pending}>
        Confirm {label.toLowerCase()}
      </Button>
      <button type="button" className="text-xs text-slate-500 hover:underline" onClick={() => setOpen(false)}>
        Cancel
      </button>
    </form>
  );
}

function RequestReleaseForm({
  onSubmit,
  pending,
}: {
  onSubmit: (reason: string, evidenceType: string, evidenceRef: string) => void;
  pending: boolean;
}) {
  const [reason, setReason] = useState("");
  const [evidenceType, setEvidenceType] = useState("ORIGINAL_FDR_RECEIPT");
  const [evidenceRef, setEvidenceRef] = useState("");
  return (
    <form
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        onSubmit(reason, evidenceType, evidenceRef);
      }}
    >
      <label className="block">
        <span className="app-label">Why is this release needed?</span>
        <textarea
          className="app-input"
          rows={3}
          maxLength={1000}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          required
          minLength={10}
        />
      </label>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <label>
          <span className="app-label">Evidence type</span>
          <select className="app-input" value={evidenceType} onChange={(e) => setEvidenceType(e.target.value)}>
            <option value="ORIGINAL_FDR_RECEIPT">Original FDR receipt</option>
            <option value="BANK_ACCOUNT_STATEMENT">Bank account statement</option>
            <option value="BANK_REFUND_CONFIRMATION">Bank refund confirmation</option>
            <option value="BANK_ADVICE_LETTER">Bank advice/letter</option>
            <option value="OTHER_DOCUMENT">Other document</option>
          </select>
        </label>
        <label>
          <span className="app-label">Evidence reference (optional)</span>
          <input className="app-input" value={evidenceRef} maxLength={100} onChange={(e) => setEvidenceRef(e.target.value)} />
        </label>
      </div>
      <Button type="submit" className="mt-3" disabled={pending}>
        {pending ? "Sending..." : "Open release request"}
      </Button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

function ActivityTab({ data }: { data: CaseDetail }) {
  if (data.activity.length === 0) {
    return (
      <Card>
        <EmptyState title="No recorded activity yet" detail="Workflow events (submission, checks, corrections, releases) appear here." />
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader title="Case activity" subtitle="Chronological workflow history; safe summaries only." />
      <CardBody className="!pt-2">
        <ol className="relative space-y-3 border-l border-slate-200 pl-4">
          {data.activity.map((entry) => (
            <li key={entry.id} className="relative">
              <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-slate-300 ring-4 ring-white" aria-hidden />
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm text-slate-800">
                  {entry.actionLabel}
                  {entry.actorName != null && <span className="ml-1.5 text-xs text-slate-500">by {entry.actorName}</span>}
                </p>
                <span className="text-xs text-slate-400">{formatDateTimeShort(entry.createdAt)}</span>
              </div>
              {entry.summary != null && <p className="mt-0.5 text-xs text-slate-500">{entry.summary}</p>}
            </li>
          ))}
        </ol>
      </CardBody>
    </Card>
  );
}
