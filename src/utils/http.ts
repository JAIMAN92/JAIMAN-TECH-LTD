export async function safeReadJson<T = Record<string, unknown>>(
  res: Response
): Promise<T & { error?: string }> {
  const raw = await res.text();
  if (!raw) {
    return {} as T & { error?: string };
  }
  try {
    return JSON.parse(raw) as T & { error?: string };
  } catch {
    return {} as T & { error?: string };
  }
}
