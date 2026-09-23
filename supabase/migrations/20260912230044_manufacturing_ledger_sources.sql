-- ============ MANUFACTURING, PHASE 2a: STOCK HISTORY SOURCES ============
-- Stock movements caused by manufacturing, used from phases 3-4:
--   manufacturing_consume  parts leave the project when a build starts, or
--                          when pending parts are installed
--   manufacturing_return   parts come back when an in-progress build is cancelled
--   manufacturing_output   finished units enter the project at Completed
-- Added in their own migration because a new enum value can't be used in the
-- same transaction that adds it (same pattern as ticket_status_add_closed).

ALTER TYPE public.ledger_source ADD VALUE IF NOT EXISTS 'manufacturing_consume';
ALTER TYPE public.ledger_source ADD VALUE IF NOT EXISTS 'manufacturing_return';
ALTER TYPE public.ledger_source ADD VALUE IF NOT EXISTS 'manufacturing_output';
