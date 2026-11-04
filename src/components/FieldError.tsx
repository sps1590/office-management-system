/** Renders the first zod message for one field, if there is one. */
export default function FieldError({
  errors,
  name,
}: {
  errors?: Record<string, string[]>;
  name: string;
}) {
  const message = errors?.[name]?.[0];
  if (!message) return null;
  return <p className="field-error">{message}</p>;
}
