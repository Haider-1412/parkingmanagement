# Parking Management Implementation Plan

Software Construction PBL

## Implementation status

| Step | Status |
| --- | --- |
| 1. Set up the app and sign-in | Running with hosted Supabase. The initial migration and role-specific sign-in are verified. |
| 2. Build facility registration and layout editing | Running. Facility managers can save parking squares, building blocks, operating hours, rates, and closures. The user reviewed the editor and approved moving on. A browser regression check verified that saving, returning to All facilities, and reopening leaves exactly one grid in the editor. |
| 3. Build the driver interface | Running with hosted migration `0004_driver_bookings`. Drivers can register a vehicle, search the facility map by time, reserve a space, and cancel before arrival. Hosted checks passed for competing requests, adjacent time windows, cancellation, closures, and preservation of booking history. The signed-in browser walkthrough remains part of the demo. |
| 4. Build operator management and facility reports | The operator workspace and reports are running. Hosted checks verified rescheduling, occupancy, a PKR 200 receipt for two hours at PKR 100/hour, and paid revenue reporting. Migration `0006_facility_operators` adds manager-controlled assignments. Assignment, revocation, and cross-facility isolation passed hosted database checks. Supabase Auth accepted the configured key and passed temporary account creation and sign-in. The combined flow still needs verification after intermittent pooler timeouts. |
| 5. Prepare the demo and reports | Pending. |

Build a responsive web app with three dedicated interfaces. Drivers browse facilities and book spaces from the published layouts. Facility managers register their own facilities and build each parking layout by dragging square spots onto a grid. Parking operators use a reservation workspace to manage bookings and parking visits.

## Build sequence

| Step | Implementation | Working result |
| --- | --- | --- |
| 1. Set up the app and sign-in | Create the React and FastAPI apps, connect Supabase Auth and PostgreSQL, and set up SQLAlchemy and Alembic. Add self-registration for drivers and facility managers. Use the same sign-in for manager-created operator accounts and enforce role and ownership permissions on the API. Seed two facilities and demo accounts so work on the three interfaces can overlap. | Each role can open its own interface. |
| 2. Build facility registration and layout editing | Let facility managers register a facility with its name, address, operating hours, and rate. Build a grid editor where they can drag square spots onto cells, move and label them, and save the layout. Provide maintenance closures for individual spots. | A facility manager can publish the layout through Save, reload it, and see the same spot labels and positions. |
| 3. Build the driver interface | Add vehicle management, facility browsing, a date and time selector, and booking history. Render the saved facility layout with each spot's availability for the selected interval. Implement transactional booking, references, and cancellation. | A driver can select a spot on the layout, book it, and cancel. A competing booking receives a conflict and the layout refreshes. |
| 4. Build operator management and facility reports | Add a reservation list with facility, date, and status filters and booking-reference search. Show driver, vehicle, slot, scheduled times, session times, status, and billing details where applicable. Let operators change the slot or time of an unused confirmed booking, cancel it, mark a no-show, check in or out, and record payment. Show facility managers reports for their own facilities. | An operator can manage a driver-created booking through checkout. The driver sees booking updates and the receipt, and the facility manager sees the completed visit and payment in their reports. |
| 5. Prepare the demo and reports | Seed repeatable demo data and document local setup and demo accounts. Use the five features as the outline for Phase 2 use cases and the Phase 3 walkthrough. The proposal lists 3 December 2026 for both submissions. | The team can run the demo end to end and verify it against the six criteria below. |

Frontend and backend work can proceed together once the team agrees on the request and response fields for each workflow. The system analyst can draft use cases alongside those workflows, and QA can run the relevant demo checks as each step works.

## Data and API design

- Use **Supabase Auth** for sessions and a server-managed profile for each account's role. React sends the access token to **FastAPI**, which verifies it and checks the caller's role and record ownership. Drivers can access their own vehicles, bookings, and receipts. Facility managers can configure and view reports for the facilities they registered. From each facility they can create operator accounts, assign an operator they previously created, or revoke that facility's access. Operators can view and manage reservations only at assigned facilities. The Supabase secret key stays in the backend.
- Store **vehicles, facilities, slots, maintenance windows, reservations, parking sessions, and receipts** in PostgreSQL. A reservation links a vehicle to a slot and time interval. A session records actual arrival and departure, and its receipt stores the calculated charge and payment status. Use one session per reservation and one receipt per completed session.
- Store each slot's label and grid coordinates alongside its stable ID. Use one square per spot and one saved layout per facility. Snap spots to cells and allow one spot per cell. Moving or renaming a spot preserves its booking links. Retire removed spots once they have no active visits or upcoming confirmed bookings, and keep their history.
- Use one availability rule for search and booking. Time intervals include their start and exclude their end. Two intervals overlap when each starts before the other ends. Search returns slots available for the entire requested window within operating hours.
- For booking, acquire a PostgreSQL row lock on the selected slot in a `READ COMMITTED` transaction. Query for reservations, sessions, and closures in a separate statement after acquiring the lock, then either insert the reservation or return a conflict. Operator edits use the same availability rule, excluding the booking being edited. When changing slots, lock both rows in ID order. Re-read the booking under the lock before changing it and return a conflict if it has moved or the new interval is unavailable. Use the same slot locks for cancellation, no-show, check-in, checkout, and slot closures or retirement. [PostgreSQL row locks](https://www.postgresql.org/docs/current/explicit-locking.html) · [PostgreSQL transaction isolation](https://www.postgresql.org/docs/current/transaction-iso.html)
- A confirmed reservation can become cancelled, a no-show, or checked in. A checked-in session can be checked out. Checkout records the departure and creates the receipt in one transaction. Payment starts pending and can move to completed independently of checkout.
- The prototype stores the single visit and receipt on the reservation row. Check-in snapshots the hourly rate, and checkout stores the final charge. The report uses checkout and recorded payment timestamps.
- Store timestamps as timezone-aware instants and use Asia/Karachi for demo display and report day boundaries. Count sessions by checkout date and recognize revenue on the date payment is marked complete. Show current recorded occupancy from open sessions and historical occupancy from session time within the selected range.

## Proposed defaults for review

| Rule | Recommended prototype behavior |
| --- | --- |
| Cancellation | Allow drivers to cancel their unused reservations before the start time by default. Store the cutoff as a configurable lead time in minutes. |
| No-shows and arrival | Allow check-in during the reserved window. Let the operator mark a confirmed, unused booking as a no-show after 15 minutes or at the scheduled end, whichever comes first. Marking a no-show releases the remaining time. |
| Partial-hour billing | Prorate by elapsed time and round once to two decimal places in PKR. Capture the facility's hourly rate at check-in so a rate edit cannot change a visit already in progress. |
| Overstays | Use the reserved end as the expected departure while a session is open. Once overdue, keep the slot out of new bookings until checkout. Keep any later confirmed reservation and tell the operator why check-in is blocked while the slot is occupied. |
| Facility changes | Default facilities to 24-hour operation. Apply operating-hour edits to new bookings. Reject a maintenance window if it conflicts with an existing confirmed booking or active session. |

## Demo acceptance criteria

1. **Time-specific search.** A 14:00–16:00 reservation blocks a 15:00–17:00 search for that slot. It can still appear for 16:00–17:00 when otherwise available.
2. **Concurrent booking.** Submit two same-slot, same-interval requests using separate database connections. At most one is confirmed.
3. **Cancellation.** Cancel a confirmed, unused booking and verify its interval becomes available when otherwise eligible.
4. **Session and billing.** Check out a two-hour visit at PKR 100 per hour and verify a PKR 200 receipt. An invalid transition such as checkout before check-in is rejected.
5. **Role-based access.** A driver cannot use facility-management or operator endpoints. A facility manager can edit layouts and manage staff only for their own facilities. An operator can view and change reservations only at assigned facilities. Invalid tokens are rejected.
6. **Reporting.** The daily completed-session count and recorded revenue match the seeded transactions.

Use focused API tests for these rules and one browser walkthrough. Register a facility, drag and save its spots, book one from the driver interface, and use the operator workspace to find and reschedule the booking before completing the visit. View the completed visit in the facility dashboard. Use simulated or offline payments and operator-entered occupancy.
