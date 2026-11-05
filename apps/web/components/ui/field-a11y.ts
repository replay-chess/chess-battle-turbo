// Pure id and ARIA wiring for <Field> (SPEC 6.2; 02 §5.9). No React, so node:test can load it.

export type FieldIds = { control: string; label: string; hint: string; error: string };

/** Derived ids for a field's control, label, hint and error. */
export function fieldIds(base: string): FieldIds {
  return { control: base, label: `${base}-label`, hint: `${base}-hint`, error: `${base}-error` };
}

export type FieldA11yInput = {
  /** The control id. */
  id: string;
  hasHint: boolean;
  hasError: boolean;
  required?: boolean;
  /** An aria-describedby the control already had; it is kept after the field's own ids. */
  describedBy?: string;
};

export type FieldA11yProps = {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
  "aria-required"?: true;
};

/**
 * Props Field injects into its control: the id, aria-describedby (hint id, then
 * error id, then anything the control already had), aria-invalid only while an
 * error shows, and aria-required.
 */
export function fieldA11yProps({ id, hasHint, hasError, required, describedBy }: FieldA11yInput): FieldA11yProps {
  const ids = fieldIds(id);
  const described = [hasHint ? ids.hint : null, hasError ? ids.error : null, ...(describedBy ?? "").split(/\s+/)]
    .filter((v): v is string => Boolean(v))
    .filter((v, i, all) => all.indexOf(v) === i);
  const out: FieldA11yProps = { id };
  if (described.length) out["aria-describedby"] = described.join(" ");
  if (hasError) out["aria-invalid"] = true;
  if (required) out["aria-required"] = true;
  return out;
}
