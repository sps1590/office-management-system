import { DAY_NAMES } from "@/lib/work-pattern";

/**
 * Seven day toggles that post as repeated `workDay` values.
 *
 * `formData.getAll("workDay")` on the other side gives the ticked days, which
 * is why every box shares one name. Rendered as labelled checkboxes rather
 * than a multi-select: a `<select multiple>` needs ctrl-click to add a second
 * option, which almost nobody discovers.
 */
export default function DayCheckboxes({
  selected,
  legend,
  help,
}: {
  selected: number[];
  legend: string;
  help?: string;
}) {
  return (
    <fieldset>
      <legend className="label">{legend}</legend>
      <div className="flex flex-wrap gap-1.5 mt-1">
        {DAY_NAMES.map((name, day) => (
          <label
            key={day}
            className="relative cursor-pointer"
            title={name}
          >
            <input
              type="checkbox"
              name="workDay"
              value={day}
              defaultChecked={selected.includes(day)}
              className="peer sr-only"
            />
            <span
              className="block rounded-lg border border-border px-3 py-1.5 text-sm select-none
                         transition-colors hover:bg-surface-hover
                         peer-checked:bg-primary peer-checked:text-primary-fg
                         peer-checked:border-primary
                         peer-focus-visible:ring-2 peer-focus-visible:ring-ring"
            >
              {name.slice(0, 3)}
            </span>
          </label>
        ))}
      </div>
      {help && <p className="help mt-2">{help}</p>}
    </fieldset>
  );
}
