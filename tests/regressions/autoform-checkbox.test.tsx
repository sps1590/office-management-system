import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ActionState } from "@/lib/types";

/*
   Regression: a refusal aimed at a checkbox was never rendered.

   `AutoForm`'s field renderer has a branch per field type, and the checkbox
   branch had no `<FieldError>` in it -- so an action returning
   `fieldErrors: { requireGeofencedCheckin: [...] }` had its message dropped
   on the floor. That is exactly the refusal the geofence fix added, which is
   how the two defects were found together: the setting would not turn on and
   the screen would not say why.

   Rendered rather than driven: `state` normally arrives from
   `useActionState`, which needs a form submission to a Server Action. The
   hook is replaced here with the state an action would have returned, so the
   refusal branch renders. Deleting the `<FieldError>` from the checkbox
   branch makes the first assertion fail.

   What this does NOT cover: that the message survives React's reset of an
   uncontrolled form, or that it is visible on screen. There is no DOM here.
*/

/** The state a refused `updateSettingsAction` returns. */
const REFUSED: ActionState = {
  error:
    "Check-in cannot require a location yet: this company has no active office " +
    "or warehouse geofence, so every check-in would be refused.",
  fieldErrors: {
    requireGeofencedCheckin: ["No office geofence exists yet."],
    poPrefix: ["Use 1 to 10 characters."],
  },
};

let injected: ActionState = null;

/*
   Only `useActionState` is replaced; the rest of React is the real thing.
   `useFormStatus` works under renderToStaticMarkup as the idle state, and
   effects do not run in a static render -- which is fine, because what is
   under test is what the first render puts on the page.
*/
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useActionState: () => [injected, () => {}, false] as const,
  };
});

const { default: AutoForm } = await import("@/components/forms/AutoForm");

function render(state: ActionState) {
  injected = state;
  return renderToStaticMarkup(
    <AutoForm
      action={async () => state}
      columns={3}
      fields={[
        {
          name: "requireGeofencedCheckin",
          label: "Require a location inside an office geofence to check in",
          type: "checkbox",
          span: 3,
        },
        { name: "poPrefix", label: "Purchase order prefix", defaultValue: "PO" },
        { name: "invoicePrefix", label: "Invoice prefix", defaultValue: "INV" },
      ]}
    />
  );
}

describe("AutoForm's checkbox branch", () => {
  it("renders a refusal aimed at the checkbox", () => {
    const html = render(REFUSED);
    expect(html).toContain("No office geofence exists yet.");
  });

  it("renders it in the field-error style, beside the control", () => {
    const html = render(REFUSED);
    // One `field-error` paragraph per refused field: the checkbox and the
    // text input. Before the fix there was only ever the text input's.
    const errors = html.match(/class="field-error"/g) ?? [];
    expect(errors).toHaveLength(2);

    // And the checkbox's message sits inside the same block as its input,
    // not at the bottom of the form.
    const checkbox = html.indexOf('name="requireGeofencedCheckin"');
    const message = html.indexOf("No office geofence exists yet.");
    const nextField = html.indexOf('name="poPrefix"');
    expect(checkbox).toBeGreaterThan(-1);
    expect(message).toBeGreaterThan(checkbox);
    expect(message).toBeLessThan(nextField);
  });

  it("marks the checkbox itself invalid", () => {
    const html = render(REFUSED);
    const input = /<input[^>]*name="requireGeofencedCheckin"[^>]*>/.exec(html)?.[0] ?? "";
    expect(input).toContain('type="checkbox"');
    expect(input).toContain('aria-invalid="true"');
  });

  it("renders nothing of the sort when the checkbox was not refused", () => {
    const html = render({ fieldErrors: { poPrefix: ["Use 1 to 10 characters."] } });
    expect(html).not.toContain("No office geofence exists yet.");
    expect(html.match(/class="field-error"/g) ?? []).toHaveLength(1);

    const input = /<input[^>]*name="requireGeofencedCheckin"[^>]*>/.exec(html)?.[0] ?? "";
    expect(input).not.toContain('aria-invalid="true"');
  });

  it("shows the action's overall error too", () => {
    const html = render(REFUSED);
    expect(html).toContain("this company has no active office");
    expect(html).toContain('role="alert"');
  });
});
