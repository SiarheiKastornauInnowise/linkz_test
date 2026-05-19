import { describe, expect, it } from "vitest";
import {
  AppError,
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  errorToResponse
} from "@/lib/errors";

describe("application errors", () => {
  it("keeps stable status codes for HTTP mapping", () => {
    expect(new AppError("Custom error", 418).statusCode).toBe(418);
    expect(new BadRequestError().statusCode).toBe(400);
    expect(new UnauthorizedError().statusCode).toBe(401);
    expect(new NotFoundError().statusCode).toBe(404);
    expect(new ForbiddenError().statusCode).toBe(403);
    expect(new ConflictError().statusCode).toBe(409);
  });

  it("maps application errors to JSON responses", async () => {
    const response = errorToResponse(new ForbiddenError("Reservation is not yours"));

    await expect(response.json()).resolves.toEqual({
      error: "Reservation is not yours"
    });
    expect(response.status).toBe(403);
  });

  it("does not expose unknown error details to clients", async () => {
    const response = errorToResponse(new Error("database password leaked"));

    await expect(response.json()).resolves.toEqual({
      error: "Internal server error"
    });
    expect(response.status).toBe(500);
  });
});
