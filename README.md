# Seat Reservation Assessment

## Overview

This is a small public seat reservation platform built for an engineering assessment. It includes three seeded seats, Clerk-authenticated users, temporary seat holds, mock payment, and successful reservation confirmation after payment completion.

The project intentionally keeps architecture simple and avoids over-engineering. The goal is to demonstrate correctness, security awareness, reliability thinking, and practical trade-offs rather than production-scale infrastructure.

## Tech Stack

- Next.js App Router
- TypeScript
- PostgreSQL
- Prisma
- Clerk
- Vitest
- Docker Compose

## Architecture

This is a small monolithic TypeScript application. Next.js route handlers run server-side and expose the API surface. Domain services live under `lib/` and own reservation, payment, authentication, and error-handling behavior. PostgreSQL is the source of truth.

Clean Architecture is applied pragmatically: route handlers are thin, React components do not contain business-critical state transitions, and business logic stays in the service layer. This is intentionally not microservices because the problem is small, transactional, and easier to reason about inside one deployable app.

## Reservation Lifecycle

Reservation statuses:

- `pending_payment`: a seat is temporarily held while payment is pending.
- `payment_failed`: payment failed, but the hold can still be retried until expiry.
- `paid`: payment succeeded and the seat is reserved.
- `expired`: the hold expired before payment succeeded.
- `cancelled`: the user cancelled a hold or reserved seat.

Selecting a seat creates a temporary hold. The hold expires after 10 minutes. A paid reservation reserves the seat until support-driven/manual intervention (refund flow is out of scope). Cancelled and expired reservations do not block seat availability.

## Seat Availability Model

`Seat.status` intentionally does not exist.

Availability is computed from active reservations:

- `paid` blocks as a final booking state for this assessment scope.
- `pending_payment` and `payment_failed` block only while `expiresAt` is in the future.
- `cancelled` and `expired` do not block.

This avoids duplicated state and keeps seat availability derived from the reservation history. The seats API is user-aware: it marks the current user's own active hold with `heldByCurrentUser` and the current user's own paid reservation with `reservedByCurrentUser`, but it does not expose another user's reservation id.

## Payment Flow

The app uses a mock `PaymentIntent` instead of a real provider. Checkout supports:

- `Pay successfully`
- `Fail payment`
- retry after failed payment

The checkout buttons simulate gateway events, and the same domain service also powers `POST /api/payments/mock-webhook`. Payment state changes are not applied directly in the route handler; they are processed as mock provider events:

- `payment.succeeded`
- `payment.failed`

Gateway events carry a `providerEventId`. The application stores that id in `payment_transactions` and treats repeated events as idempotent. Repeated successful completion keeps the reservation paid, and a failed payment event cannot downgrade an already paid reservation.

Payment state changes are recorded in `payment_transactions` as an audit trail of intent creation, gateway success, gateway failure, cancellation, and expiry-related cancellation. Audit rows include before/after reservation and payment intent statuses, failure reason when present, provider event id when present, and a compact raw payload for gateway events.

## Failed Payment Handling

A failed payment does not immediately release the seat. The reservation becomes `payment_failed`, and the seat remains held until `expiresAt`.

The user can retry payment while the hold is valid. If the hold expires, availability checks stop treating the reservation as blocking, so the seat becomes available again.

## Cancellation

Users can cancel unpaid reservations. Both `pending_payment` and `payment_failed` reservations can be cancelled.

Users can cancel their own active hold directly from `/seats`.

Cancelling an unpaid reservation cancels active payment intents. Paid reservations are not cancellable in this assessment scope (no refund workflow). A cancelled reservation cannot later be marked paid.

## Concurrency and Double Booking Prevention

Creating a reservation hold runs inside a PostgreSQL transaction. The service acquires a per-seat advisory transaction lock, then checks for an active blocking reservation before creating the hold.

At the database level, a partial unique index also enforces that only one `paid` reservation can exist per seat. Hold states (`pending_payment`, `payment_failed`) still rely on transaction-scoped locking and explicit expiry checks; this cannot be safely replaced with a simple partial index based on `now()`.

This prevents concurrent requests from creating two active holds for the same seat. Redis locks were not used because PostgreSQL already owns the reservation data and can provide the required transaction-scoped locking without another operational dependency.

## Authentication

The app uses Clerk for authentication. Passwords are not stored, checked, or mocked by this application. Clerk owns user login, session management, password policy, and account recovery.

The local `users` table stores only the internal application user and the Clerk identity mapping:

- `authProvider`
- `externalUserId`
- `email`
- `name`

The application never accepts `userId` from the client. Server-side code derives the current Clerk identity, maps it to the local user, and then passes the local user id into reservation and payment services.

### Session and Token Model

The app does not issue application-owned access JWTs. Route handlers and server components read the active Clerk session server-side and map Clerk's `userId` to the local user record. This avoids the insecure pattern of putting a 90-day lifetime on an access token.

If reviewers want a long-lived login experience, configure it in Clerk as a session lifetime policy. Clerk remains responsible for session renewal and token rotation; this application only consumes the current server-validated session. A 90-day requirement belongs to the provider-managed session/refresh lifecycle, not to an access JWT generated by this app.

## Security Considerations

- Server-side authentication checks protect pages and API routes.
- Ownership checks enforce that users can only act on their own reservations.
- `userId` is never accepted from the client.
- The seats API does not expose another user's hold or paid reservation id.
- The cancel endpoint still performs server-side ownership checks even if a reservation id is known.
- Clerk-managed sessions keep authentication secrets out of application code.
- Clerk middleware protects authenticated pages and API routes before route handlers run.
- Route input is validated with Zod.
- Production secrets are read from environment variables and are not committed. Example files use explicit dev-only placeholder values that must be replaced outside local development.
- Paid and cancelled state transition protections prevent invalid late payment events.
- Mock payment webhook events can be protected with `MOCK_PAYMENT_WEBHOOK_SECRET`; when configured, callers must send it as `x-mock-payment-signature`.
- Gateway event ids are persisted to make webhook retries idempotent.
- Rate limiting is not implemented for this assessment. In production, the login route and write APIs should be protected with rate limiting or abuse throttling.

## Operational Considerations

- Prisma migrations define the schema.
- Database tables use lowercase plural naming (`users`, `seats`, `reservations`, `payment_intents`, `payment_transactions`).
- All primary and foreign key IDs are UUID (`UUID` in PostgreSQL).
- The seed script creates seats `A1`, `A2`, and `A3`. It also keeps deterministic local test users for service-level tests and local database inspection; interactive login users are provided by Clerk.
- The cleanup expired reservations script marks expired holds as `expired` and cancels active payment intents.
- `GET /api/health` performs a lightweight database connectivity check.
- Docker Compose provides the local PostgreSQL database.
- Full Docker Compose app startup is available as an optional convenience path.
- Correctness does not depend on the cleanup job; availability already ignores expired holds based on `expiresAt`.

## Failure Cases

- Two users reserve the same seat: the second hold is rejected by the transaction lock and active reservation check.
- Payment fails: the reservation becomes `payment_failed` and remains held until expiry.
- Payment is retried: a new mock payment intent is created while the hold is valid.
- Payment gateway event is repeated: the stored provider event id makes it idempotent.
- Late failed payment event after paid: the event is audited, but the reservation remains `paid`.
- Payment after expiry: the reservation is expired and active payment intents are cancelled.
- User cancels reservation from checkout or `/seats`: the reservation becomes `cancelled` and the seat is released.
- User attempts to cancel a paid reservation from `/seats`: the request is rejected and the seat remains reserved.
- Concurrent payment success and cancellation on the same reservation: first terminal transition wins (`paid` or `cancelled`), and the losing operation is rejected.
- Another user's hold or reserved seat is visible as unavailable, but its reservation id is not exposed through the seats API and it cannot be cancelled by the current user.
- Late payment success after cancel: it is rejected and the reservation remains `cancelled`.
- App restart during checkout: reservation and payment state are persisted in PostgreSQL.
- Cleanup job failure: availability remains correct because expiry is checked lazily from reservation timestamps.

## Trade-offs

- Monolith over microservices: simpler and appropriate for the assessment scope.
- PostgreSQL over SQLite: realistic transactions, constraints, and advisory locks.
- Mock payment over Stripe: focuses on workflow correctness without external setup.
- No refund workflow: paid reservations are not cancellable in the current scope.
- Gateway-style mock payments over direct status mutation: a small extra layer, but it demonstrates webhook idempotency and failed event handling without adding Stripe.
- Lazy expiry over mandatory background worker: correctness does not require scheduler infrastructure.
- Clerk over local credentials: avoids storing or validating passwords in the app and keeps the assessment focused on reservation/payment correctness.
- No rate limiter: avoids adding Redis or a fragile in-memory limiter for the assessment scope; production deployments should add edge, gateway, or shared-store throttling.
- Database lock over Redis lock: fewer moving parts and locking near the source of truth.
- Optional Docker app container over mandatory Docker-only workflow: supports both fast local development and container review.
- Clean Architecture without unnecessary abstraction layers: no repositories, factories, or interfaces unless they add clarity.

## Local Setup

### Option 1: Fast local development

Use this when Node.js is installed locally:

```bash
cp .env.example .env
# Fill NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY from Clerk.
docker compose up -d postgres
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

### Option 2: Full Docker Compose

Use this when you want to run the app and database in containers:

```bash
cp .env.example .env
# Fill NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY from Clerk.
docker compose up --build
```

The app is available at `http://localhost:3000`.

The Dockerfile is optimized for local review and development. A production Docker image could use a multi-stage build with `next build`, smaller runtime output, and a non-root user. Docker startup is an optional convenience path, not the only way to run the app.

## Running Tests

Start PostgreSQL before running tests:

```bash
docker compose up -d postgres
npm run test
```

The integration tests use `TEST_DATABASE_URL` and default to `seat_reservation_test`. They create the test database if needed, apply migrations, reset data before each integration test, and seed local service-level users and seats.

Tests cover double booking prevention, expired holds not blocking seats, failed payment retry, successful retry payment, hold cancellation, paid cancellation rejection, ownership checks, cancelled reservations not becoming paid, and paid reservations not being downgraded by failed payment events.

## Environment Variables

- `DATABASE_URL`: PostgreSQL connection string for the app and Prisma migrations.
- `TEST_DATABASE_URL`: PostgreSQL connection string for Vitest integration tests.
- `NEXT_PUBLIC_APP_URL`: public app base URL used to build client-side navigation and API URLs (for example `http://localhost:3000`).
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`: Clerk publishable key used by the browser SDK.
- `CLERK_SECRET_KEY`: Clerk server key used for server-side user lookup.
- `NEXT_PUBLIC_CLERK_SIGN_IN_URL`: local sign-in route, defaults to `/login`.
- `NEXT_PUBLIC_CLERK_SIGN_UP_URL`: local sign-up route, defaults to `/login`.
- `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL`: post-login redirect, defaults to `/seats`.
- `NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL`: post-sign-up redirect, defaults to `/seats`.
- `MOCK_PAYMENT_WEBHOOK_SECRET`: optional shared secret for `POST /api/payments/mock-webhook`; send it as `x-mock-payment-signature` when set.

## Useful Commands

```bash
npm run db:migrate
npm run db:seed
npm run cleanup:expired
npm run test
npm run lint
npm run build
```
