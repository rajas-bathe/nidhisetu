/**
 * New submission wizard (college only). Two steps:
 *  1. Instrument details -> draft is created (or updated) server-side.
 *  2. Confirm -> submit atomically (version snapshot + review tasks).
 * When opened with ?replacesFdrId=N the wizard titles itself as a replacement
 * and shows the instrument being replaced; the supersession itself is only
 * established when the approving authority accepts the replacement.
 */
import { useState, type FormEvent } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { createFdrDraft, fetchCase, submitFdr, updateFdrDraft } from "../../services/portal";
import { errorToMessage, useToasts } from "../../components/ui/Toasts";
import { Card, CardBody, CardHeader } from "../../components/ui/Card";
import { ErrorState, PageHeader, Spinner, SuccessNote } from "../../components/ui/States";
import { Button } from "../../components/ui/Button";
import { formatLocalDate, formatMoney } from "../../utils/format";
import { INSTRUMENT_TYPE_LABELS } from "@sih26265/contracts";
import type { CaseDetail } from "@sih26265/contracts";

interface FormState {
  instrumentType: "SECURITY_DEPOSIT" | "BANK_GUARANTEE";
  bankName: string;
  bankBranch: string;
  referenceNo: string;
  amountRupees: string;
  issueDate: string;
  maturityDate: string;
  ifsc: string;
  beneficiaryName: string;
  remarks: string;
}

const EMPTY_FORM: FormState = {
  instrumentType: "SECURITY_DEPOSIT",
  bankName: "",
  bankBranch: "",
  referenceNo: "",
  amountRupees: "",
  issueDate: "",
  maturityDate: "",
  ifsc: "",
  beneficiaryName: "",
  remarks: "",
};

function clientValidate(form: FormState): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  if (form.bankName.trim().length < 2) errors.bankName = ["Bank name is required"];
  if (form.bankBranch.trim().length < 2) errors.bankBranch = ["Branch is required"];
  if (form.referenceNo.trim().length < 1) errors.referenceNo = ["Receipt/reference number is required"];
  if (!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(form.amountRupees)) {
    errors.amountRupees = ["Enter the amount in rupees (for example 500000 or 500000.55)"];
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.issueDate)) errors.issueDate = ["Pick the issue date"];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.maturityDate)) errors.maturityDate = ["Pick the maturity date"];
  if (
    /^\d{4}-\d{2}-\d{2}$/.test(form.issueDate) &&
    /^\d{4}-\d{2}-\d{2}$/.test(form.maturityDate) &&
    form.maturityDate <= form.issueDate
  ) {
    errors.maturityDate = ["The maturity date must be after the issue date"];
  }
  if (form.ifsc.trim().length > 0 && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(form.ifsc.trim().toUpperCase())) {
    errors.ifsc = ["Use a valid IFSC code, or leave empty"];
  }
  return errors;
}

export function SubmitWizardPage() {
  const [searchParams] = useSearchParams();
  const replacesParam = searchParams.get("replacesFdrId");
  const replacesFdrId = replacesParam != null && /^\d+$/.test(replacesParam) ? Number(replacesParam) : undefined;

  const queryClient = useQueryClient();
  const toasts = useToasts();

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [createdFdrId, setCreatedFdrId] = useState<number | null>(null);
  const [submitted, setSubmitted] = useState<{ publicCode: string } | null>(null);

  const isReplacement = replacesFdrId != null;

  const replacedCase = useQuery({
    queryKey: ["case", replacesFdrId],
    queryFn: () => fetchCase(replacesFdrId as number),
    enabled: isReplacement,
    retry: false,
  });

  const draft = useQuery({
    queryKey: ["case", createdFdrId],
    queryFn: () => fetchCase(createdFdrId as number),
    enabled: createdFdrId != null,
    placeholderData: keepPreviousData,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        instrumentType: form.instrumentType,
        bankName: form.bankName.trim(),
        bankBranch: form.bankBranch.trim(),
        referenceNo: form.referenceNo.trim(),
        amountRupees: form.amountRupees,
        issueDate: form.issueDate,
        maturityDate: form.maturityDate,
        ifsc: form.ifsc.trim().toUpperCase(),
        beneficiaryName: form.beneficiaryName.trim(),
        remarks: form.remarks.trim(),
      };
      const created = await createFdrDraft(payload, replacesFdrId);
      if (form.ifsc.trim().length > 0 || form.beneficiaryName.trim().length > 0 || form.remarks.trim().length > 0) {
        // Optional fields are saved through the draft patch so the create
        // payload stays minimal; server accepts both shapes.
        await updateFdrDraft(created.id, {
          ifsc: payload.ifsc.length > 0 ? payload.ifsc : undefined,
          beneficiaryName: payload.beneficiaryName.length > 0 ? payload.beneficiaryName : undefined,
          remarks: payload.remarks.length > 0 ? payload.remarks : undefined,
        });
      }
      return created;
    },
    onSuccess: (created) => {
      setCreatedFdrId(created.id);
      setFieldErrors({});
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (error) => toasts.error(errorToMessage(error)),
  });

  const patchMutation = useMutation({
    mutationFn: (id: number) => updateFdrDraft(id, { ...form, baseUpdatedAt: draft.data?.draft?.updatedAt ?? undefined }),
    onSuccess: () => {
      setFieldErrors({});
      void queryClient.invalidateQueries({ queryKey: ["case", createdFdrId] });
    },
    onError: (error) => toasts.error(errorToMessage(error)),
  });

  const submitMutation = useMutation({
    mutationFn: (id: number) => submitFdr(id),
    onSuccess: (result) => {
      setSubmitted({ publicCode: result.publicCode });
      void queryClient.invalidateQueries();
      toasts.success(`Submitted: ${result.publicCode} is now with the reviewing officer.`);
    },
    onError: (error) => toasts.error(errorToMessage(error)),
  });

  const busy = createMutation.isPending || patchMutation.isPending || submitMutation.isPending;

  const step = submitted != null ? 3 : createdFdrId != null ? 2 : 1;

  const onSubmitForm = (event: FormEvent) => {
    event.preventDefault();
    const errors = clientValidate(form);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    if (createdFdrId == null) {
      createMutation.mutate();
    } else {
      patchMutation.mutate(createdFdrId);
    }
  };

  const field = (key: keyof FormState, label: string, opts?: { type?: string; placeholder?: string; hint?: string }) => (
    <label>
      <span className="app-label">{label}</span>
      <input
        type={opts?.type ?? "text"}
        className="app-input"
        value={form[key]}
        placeholder={opts?.placeholder}
        onChange={(e) => setForm((current) => ({ ...current, [key]: e.target.value }))}
        aria-invalid={fieldErrors[key] != null}
      />
      {opts?.hint != null && <p className="mt-1 text-xs text-slate-400">{opts.hint}</p>}
      {fieldErrors[key] != null && <p className="mt-1 text-xs text-rose-600">{fieldErrors[key].join(" ")}</p>}
    </label>
  );

  if (submitted != null) {
    return (
      <div className="mx-auto max-w-xl">
        <SuccessNote>
          <p className="font-medium">Submission complete.</p>
          <p className="mt-1">
            {submitted.publicCode} has been recorded and is now with the reviewing officer. You will be notified
            about checks, corrections and the verification outcome.
          </p>
        </SuccessNote>
        <div className="mt-4 flex gap-2">
          <Link to={`/fdrs/${createdFdrId}`} className="app-btn-primary">
            Open the case workspace
          </Link>
          <Link to="/fdrs" className="app-btn-secondary">
            Back to my instruments
          </Link>
        </div>
      </div>
    );
  }

  const replacedDetail = replacedCase.data as CaseDetail | undefined;
  const title = isReplacement ? "Submit a replacement instrument" : "New submission";
  const description = isReplacement
    ? "Record the new instrument that will renew a matured/approaching one. The supersession is established only when the approving authority accepts it."
    : "Record a security deposit or bank guarantee, then submit it for review. Entries cannot be edited after submission - corrections go through the reviewing officer.";

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={title} description={description} />

      <ol className="mb-6 flex gap-2 text-xs" aria-label="Progress">
        {["Instrument details", "Save & confirm", "Submitted"].map((label, index) => (
          <li
            key={label}
            className={`flex-1 rounded-lg border px-3 py-2 ${
              step === index + 1
                ? "border-teal-300 bg-teal-50 font-medium text-teal-800"
                : step > index + 1
                  ? "border-teal-200 bg-white text-teal-700"
                  : "border-slate-200 bg-white text-slate-400"
            }`}
          >
            Step {index + 1}: {label}
          </li>
        ))}
      </ol>

      {isReplacement && (
        <Card className="mb-4">
          <CardHeader title="Instrument being replaced" subtitle="The new case links to this one at acceptance." />
          <CardBody>
            {replacedCase.isPending ? (
              <Spinner label="Loading the replaced instrument..." />
            ) : replacedCase.isError ? (
              <ErrorState title="Could not load the replaced instrument" detail={errorToMessage(replacedCase.error)} />
            ) : replacedDetail != null ? (
              <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-xs text-slate-500">Case</dt>
                  <dd className="font-medium text-slate-900">{replacedDetail.publicCode}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Bank</dt>
                  <dd className="text-slate-800">{replacedDetail.currentVersion.bankName}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Amount</dt>
                  <dd className="tabular-nums text-slate-800">{formatMoney(replacedDetail.currentVersion.amount)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Matures</dt>
                  <dd className="text-slate-800">{formatLocalDate(replacedDetail.currentVersion.maturityDate)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Status</dt>
                  <dd className="text-slate-800">{replacedDetail.status.replace(/_/g, " ")}</dd>
                </div>
              </dl>
            ) : null}
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader
          title={createdFdrId == null ? "Step 1 - instrument details" : `Draft ${draft.data?.publicCode ?? ""} saved`}
          subtitle={createdFdrId == null ? "Nothing is recorded until you save the draft." : "Saved as a draft; edit freely, submit when ready."}
        />
        <CardBody>
          <form className="grid gap-4 sm:grid-cols-2" onSubmit={onSubmitForm} noValidate>
            <label>
              <span className="app-label">Instrument type</span>
              <select
                className="app-input"
                value={form.instrumentType}
                onChange={(e) => setForm((current) => ({ ...current, instrumentType: e.target.value as FormState["instrumentType"] }))}
              >
                {(Object.entries(INSTRUMENT_TYPE_LABELS) as Array<[FormState["instrumentType"], string]>).map(
                  ([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ),
                )}
              </select>
            </label>
            {field("referenceNo", "Receipt / reference number", { placeholder: "e.g. FD-2026-0451" })}

            {field("bankName", "Bank name", { placeholder: "e.g. State Bank of India" })}
            {field("bankBranch", "Branch", { placeholder: "e.g. Bandra East" })}

            {field("amountRupees", "Amount (rupees)", { type: "text", placeholder: "500000.00", hint: "Exact rupee amount, up to two decimals." })}
            {field("ifsc", "IFSC code (optional)", { placeholder: "SBIN0001234" })}

            {field("issueDate", "Issue date", { type: "date" })}
            {field("maturityDate", "Maturity date", { type: "date" })}

            {field("beneficiaryName", "Beneficiary name (optional)", { placeholder: "As printed on the instrument" })}

            <label className="sm:col-span-2">
              <span className="app-label">Remarks (optional)</span>
              <textarea
                className="app-input"
                rows={3}
                value={form.remarks}
                maxLength={1500}
                onChange={(e) => setForm((current) => ({ ...current, remarks: e.target.value }))}
              />
            </label>

            <div className="flex items-center justify-between gap-3 sm:col-span-2">
              {createdFdrId != null ? (
                <Link to={`/fdrs/${createdFdrId}`} className="text-sm font-medium text-teal-700 hover:underline">
                  Open the case workspace instead
                </Link>
              ) : (
                <Link to="/fdrs" className="text-sm font-medium text-slate-500 hover:underline">
                  Cancel
                </Link>
              )}
              <Button type="submit" disabled={busy}>
                {createMutation.isPending || patchMutation.isPending
                  ? "Saving..."
                  : createdFdrId == null
                    ? "Save draft"
                    : "Save changes"}
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>

      {createdFdrId != null && (
        <Card className="mt-4">
          <CardHeader
            title="Step 2 - submit for review"
            subtitle="Submission is atomic: the case, its first immutable version, review tasks and audit are recorded together."
          />
          <CardBody>
            {draft.data?.draft != null && draft.data.draft.updatedAt != null && (
              <p className="mb-3 text-xs text-slate-500">
                Draft last saved {formatLocalDate(draft.data.draft.updatedAt.slice(0, 10))}. Everything above is
                editable until submission; afterwards changes happen only through officer-requested corrections.
              </p>
            )}
            {submitMutation.isError && (
              <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {errorToMessage(submitMutation.error)}
              </div>
            )}
            <Button type="button" disabled={busy} onClick={() => submitMutation.mutate(createdFdrId)}>
              {submitMutation.isPending ? "Submitting..." : "Submit for review"}
            </Button>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
