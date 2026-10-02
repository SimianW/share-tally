

export function clearDeletedDraft(id: string) {
  for (const key of Object.keys(sessionStorage)) {
    if (key.startsWith("receipt-step:") && key.endsWith(`:${id}`))
      sessionStorage.removeItem(key);
    if (!key.startsWith("receipt-draft:")) continue;
    try {
      if (JSON.parse(sessionStorage.getItem(key) ?? "null")?.id === id)
        sessionStorage.removeItem(key);
    } catch {
      /* Ignore unrelated invalid recovery entries. */
    }
  }
}
