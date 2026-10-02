
export function fieldsValid(container: HTMLElement | null) {
  const invalid = container?.querySelector<HTMLInputElement>("input:invalid");
  if (!invalid) return true;
  invalid.reportValidity();
  invalid.focus();
  return false;
}
