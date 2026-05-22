# POSHIVE — Gap List

## Critical
- [x] 1. Auto overdue status update — daily cron flips active → overdue when nextDueDate passes
- [x] 2. "Send Reminders Now" UI button — dashboard triggers POST /api/reminders/send

## Test coverage
- [x] 3. Cashiers route tests — CRUD, auth, multi-tenancy
- [x] 4. Upload route tests — file upload, auth, type validation

## Production-readiness
- [x] 5. PUBLIC_URL in .env — updated to https://pos.3speak.tv
- [x] 6. Rate limiting on auth — express-rate-limit on /api/auth (20 req / 15 min, skipped in tests)
- [ ] 7. Password reset — currently stubbed; low priority for small admin-managed user base

## Polish
- [x] 8. Superadmin stores table — emailReminders column added
- [x] 9. Cashier access tests — covered in cashiers.test.js
