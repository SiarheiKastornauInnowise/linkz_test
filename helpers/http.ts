export async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };

    if (typeof body.error === "string") {
      return body.error;
    }
  } catch {
    return fallback;
  }

  return fallback;
}
