/*
   `AutoForm` splits the map picker out with next/dynamic so Leaflet is not
   bundled into every form in the product. Outside Next there is no loader to
   run, so this returns a placeholder with the same name. The checkbox branch
   under test never renders it; it only has to not explode at import time.
*/
export default function dynamic(
  _loader: unknown,
  _options?: unknown
): (props: Record<string, unknown>) => React.ReactElement {
  const Dynamic = (props: Record<string, unknown>) => (
    <div data-dynamic-placeholder="true" data-props={Object.keys(props).join(",")} />
  );
  Dynamic.displayName = "DynamicPlaceholder";
  return Dynamic;
}
