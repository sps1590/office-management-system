import { Search } from "lucide-react";

export type FilterSpec = {
  name: string;
  label: string;
  type?: "search" | "select" | "date";
  options?: { value: string; label: string }[];
  value?: string;
  placeholder?: string;
};

/**
 * List filters as a plain GET form. No client JavaScript: submitting puts the
 * values in the URL, the server re-queries, and the resulting page is
 * shareable and back-button friendly. Filtering happens in SQL, never by
 * loading every row and filtering in the browser.
 */
export default function FilterBar({
  filters,
  children,
}: {
  filters: FilterSpec[];
  children?: React.ReactNode;
}) {
  return (
    <form method="get" className="flex flex-wrap items-end gap-3 px-5 py-4 border-b border-border bg-surface-2">
      {filters.map((f) => (
        <div key={f.name} className={f.type === "search" ? "flex-1 min-w-52" : "min-w-40"}>
          <label className="label" htmlFor={`filter-${f.name}`}>
            {f.label}
          </label>
          {f.type === "select" ? (
            <select
              id={`filter-${f.name}`}
              name={f.name}
              defaultValue={f.value ?? ""}
              className="input"
            >
              <option value="">{f.placeholder ?? "All"}</option>
              {f.options?.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : f.type === "date" ? (
            <input
              id={`filter-${f.name}`}
              name={f.name}
              type="date"
              defaultValue={f.value ?? ""}
              className="input"
            />
          ) : (
            <div className="relative">
              <Search
                size={15}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle pointer-events-none"
              />
              <input
                id={`filter-${f.name}`}
                name={f.name}
                defaultValue={f.value ?? ""}
                placeholder={f.placeholder ?? "Search…"}
                className="input pl-9"
              />
            </div>
          )}
        </div>
      ))}
      <button type="submit" className="btn btn-secondary">
        Apply
      </button>
      {children}
    </form>
  );
}
