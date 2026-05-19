export function buildAppUrl(path: string): string {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL;

  if (!baseUrl) {
    return path;
  }

  return new URL(path, baseUrl).toString();
}
