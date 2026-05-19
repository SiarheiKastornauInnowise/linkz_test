# AI-Assisted Development Guidelines

## 1. Purpose

This is an assessment project.

The goal is to show engineering judgment, reliability thinking, security awareness, operational awareness, and trade-offs.

The goal is not production polish and not over-engineering.

## 2. Core Engineering Principles

Follow Clean Architecture principles where they improve clarity.

Keep domain/business logic in service modules under `lib/`.

Keep API route handlers thin.

Route handlers should mainly:

- authenticate the user
- validate input
- call domain services
- map results/errors to HTTP responses

Do not put business logic directly inside React components.

Do not put business-critical state transitions directly inside route handlers.

Keep domain rules explicit and testable.

## 3. SOLID

Apply SOLID pragmatically.

Prefer small, focused functions.

Avoid unnecessary interfaces or abstractions unless they clearly improve readability or testability.

## 4. DRY

Avoid unnecessary duplication, especially for:

- error handling
- authentication checks
- validation schemas
- reservation/payment state transitions

Do not create premature abstractions.

## 5. YAGNI

Do not add features not required by the assessment.

Do not add:

- microservices
- Redis
- real Stripe integration
- external identity providers
- Kubernetes
- admin panels
- complex role systems
- email notifications
- refund workflows
- background job infrastructure

## 6. KISS

Keep implementation simple and readable.

Prefer explicit state transitions.

Avoid clever abstractions and unnecessary framework magic.

## 7. TypeScript Guidelines

Use TypeScript consistently.

Avoid `any` unless there is a clear reason.

Prefer explicit return types for domain services.

Do not suppress TypeScript errors without a strong reason.

## 8. Node.js and Next.js Guidelines

Use current Next.js App Router patterns.

Do not use deprecated Pages Router patterns.

Prefer server-side protection for authenticated pages.

Keep client components minimal and only for interactivity.

Do not expose secrets to the client.

Use environment variables for configuration.

Keep API route handlers small.

Never expose stack traces to clients.

## 9. Validation and Security

Validate external input with Zod.

Never trust client-provided `userId`.

Always derive current user from authenticated session.

Enforce reservation ownership on payment and cancellation operations.

A cancelled reservation must not later become paid.

A paid reservation must not be downgraded by a failed payment event.

## 10. Database and Transaction Guidelines

PostgreSQL is the source of truth.

Do not store `Seat.status`.

Seat availability must be computed from active reservations.

Use Prisma transactions for business-critical workflows.

Use per-seat PostgreSQL advisory transaction locks when creating reservation holds.

Correctness must not depend on background cleanup jobs.

## 11. Testing Guidelines

Tests should focus on business-critical behavior:

- double booking prevention
- expired holds not blocking seats
- failed payment handling
- payment retry
- cancellation releasing seats
- cancelled reservations not becoming paid
- paid reservations not being downgraded
- ownership checks

## 12. Documentation Guidelines

`README.md` must be written in English.

`AGENTS.md` must be written in English.

Do not document features that are not implemented.

## 13. Context7 Usage

Use Context7 only when needed to verify current APIs or configuration patterns for:

- Next.js App Router
- Clerk
- Prisma
- Vitest
- Zod
- Docker Compose

Do not use Context7 to expand scope or add unnecessary features.

## 14. Priority Order

When requirements appear to conflict, prioritize:

1. Correctness of the reservation/payment workflow
2. Security and ownership checks
3. Simplicity and readability
4. Assessment scope
5. Framework best practices
6. Optional polish
