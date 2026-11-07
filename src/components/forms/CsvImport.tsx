"use client";

import { useActionState, useRef } from "react";
import { AlertCircle, CheckCircle2, Download, FileSpreadsheet, Upload } from "lucide-react";
import SubmitButton from "@/components/SubmitButton";
import type { ImportState } from "@/lib/types";

/**
 * Download a template, fill it in Excel, upload it back.
 *
 * Shared by the employee directory and the leave allotment screen, because
 * the hard parts are the same either way: reporting per-row problems without
 * throwing the good rows away, and showing the new passwords exactly once.
 *
 * It does not use `AutoForm`. AutoForm renders one success alert and one
 * error alert from an `ActionState`, and an import's answer is a table — a
 * count, a list of line numbers, and sometimes forty credentials to hand
 * over. Forcing that through a single string was the wrong shape.
 */
export default function CsvImport({
  action,
  templateHref,
  templateLabel = "Download template",
  submitLabel = "Upload and import",
  children,
  note,
}: {
  action: (state: ImportState, formData: FormData) => Promise<ImportState>;
  templateHref: string;
  templateLabel?: string;
  submitLabel?: string;
  /** Extra inputs rendered between the file picker and the button. */
  children?: React.ReactNode;
  note?: React.ReactNode;
}) {
  const [state, formAction] = useActionState(action, null);
  const fileRef = useRef<HTMLInputElement>(null);

  /*
     The credentials come back once and are never stored in readable form, so
     this builds the CSV in the browser from what is already on screen rather
     than asking the server for them again -- there is nothing to ask for.
  */
  function downloadCredentials() {
    const rows = state?.credentials ?? [];
    const esc = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const csv =
      "﻿" +
      ["name,email,temporary_password", ...rows.map((r) => [r.name, r.email, r.password].map(esc).join(","))].join(
        "\r\n"
      );
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "new-employee-passwords.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const problems = state?.problems ?? [];
  const credentials = state?.credentials ?? [];
  const wrote = (state?.created ?? 0) + (state?.updated ?? 0);

  return (
    <div className="grid gap-4">
      <a href={templateHref} className="btn btn-secondary justify-self-start" download>
        <Download size={15} />
        {templateLabel}
      </a>

      <form action={formAction} className="grid gap-3">
        <div>
          <label className="label" htmlFor="csv-file">
            Filled-in spreadsheet
          </label>
          <input
            id="csv-file"
            ref={fileRef}
            type="file"
            name="file"
            // .csv is what the templates are; Excel offers "CSV UTF-8" on save
            // and both land here with the same media type on some platforms
            // and none at all on others, so the extension is listed too.
            accept=".csv,text/csv,application/vnd.ms-excel"
            required
            className="input file:mr-3 file:rounded-md file:border-0 file:bg-surface-2 file:px-3 file:py-1.5 file:text-sm file:text-fg file:cursor-pointer"
          />
        </div>

        {children}

        <SubmitButton className="btn-primary justify-self-start" pendingLabel="Importing…">
          <Upload size={15} />
          {submitLabel}
        </SubmitButton>
      </form>

      {note && <p className="help">{note}</p>}

      {state?.error && (
        <div className="alert alert-error">
          <AlertCircle size={16} />
          <span>{state.error}</span>
        </div>
      )}

      {wrote > 0 && (
        <div className="alert alert-success">
          <CheckCircle2 size={16} />
          <span>{state?.summary}</span>
        </div>
      )}

      {problems.length > 0 && (
        <div>
          <p className="text-sm font-medium mb-2">
            {problems.length} row{problems.length === 1 ? "" : "s"} need{problems.length === 1 ? "s" : ""} attention
          </p>
          <div className="table-wrap max-h-64 overflow-y-auto scroll-thin">
            <table className="data">
              <thead>
                <tr>
                  <th className="w-20">Row</th>
                  <th>What is wrong</th>
                </tr>
              </thead>
              <tbody>
                {problems.map((p, i) => (
                  <tr key={`${p.row}-${i}`}>
                    <td className="tabular-nums">{p.row}</td>
                    <td className="text-fg-muted">{p.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="help mt-2">
            Row numbers are the spreadsheet&rsquo;s own, counting the header. Fix those
            rows and upload the file again — everything that already went in is
            skipped as a duplicate rather than doubled.
          </p>
        </div>
      )}

      {credentials.length > 0 && (
        <div className="panel p-4">
          <div className="flex items-center justify-between gap-3 mb-3">
            <p className="text-sm font-medium flex items-center gap-2">
              <FileSpreadsheet size={15} />
              {credentials.length} temporary password{credentials.length === 1 ? "" : "s"}
            </p>
            <button type="button" onClick={downloadCredentials} className="btn btn-secondary btn-sm">
              <Download size={14} />
              Download as CSV
            </button>
          </div>
          <div className="table-wrap max-h-64 overflow-y-auto scroll-thin">
            <table className="data">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Temporary password</th>
                </tr>
              </thead>
              <tbody>
                {credentials.map((c) => (
                  <tr key={c.email}>
                    <td>{c.name}</td>
                    <td className="text-fg-muted">{c.email}</td>
                    <td className="font-mono text-xs">{c.password}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="help mt-3">
            Shown once and never again — the system keeps only a bcrypt hash. Hand each
            one over directly and ask the person to change it on their profile. Delete
            the downloaded file once you have.
          </p>
        </div>
      )}
    </div>
  );
}
