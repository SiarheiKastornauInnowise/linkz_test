import { BadRequestError } from "@/lib/errors";

export type JsonBodyResult =
  | { ok: true; data: unknown }
  | { ok: false; error: BadRequestError };

export async function readJsonBody(request: Request): Promise<JsonBodyResult> {
  try {
    return {
      ok: true,
      data: await request.json()
    };
  } catch {
    return {
      ok: false,
      error: new BadRequestError("Invalid JSON body")
    };
  }
}
