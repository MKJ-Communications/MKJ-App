-- SECURITY FIX: three earlier migrations (20260721233959, 20260801131217, and
-- individual per-function REVOKEs scattered through later files) tried to
-- strip EXECUTE on public-schema functions from `anon`/`PUBLIC`, but none of
-- it actually took effect on the live project -- confirmed via
-- information_schema.routine_privileges, which showed 29+ SECURITY DEFINER
-- functions still callable by anonymous, unauthenticated requests. Because
-- PostgREST exposes any function with EXECUTE granted as a
-- /rest/v1/rpc/<name> endpoint, this meant anyone with just the public anon
-- key could call e.g. is_admin(<any uuid>) or can_write_project(<any uuid>,
-- <any uuid>) and learn that account's role/access -- an information
-- disclosure hole. The write-RPCs (delete_purchase_order, set_user_role,
-- etc.) were only saved by their own internal auth.uid() checks, which is
-- incidental, not a real lockdown.
--
-- This migration resets every public-schema function to no access at all,
-- then re-grants EXECUTE to `authenticated` ONLY for the two categories that
-- legitimately need it:
--   1. Predicates referenced directly inside RLS policies / views
--      (is_admin, has_role, etc.) -- the querying role must have EXECUTE on
--      these even though they're SECURITY DEFINER.
--   2. RPCs the frontend calls directly via supabase.rpc(...) (confirmed via
--      `grep -rn "\.rpc(" src/`).
-- Trigger-only functions (set_updated_at, handle_new_user,
-- enforce_po_status_transition, sync_user_directory, notify_borrow_request,
-- etc.) and helpers only called from inside another SECURITY DEFINER
-- function (borrow_notify_recipients, gen_ticket_number) are deliberately
-- left with no grants -- Postgres doesn't check EXECUTE privilege to fire a
-- trigger, and an internal call from within a SECURITY DEFINER function body
-- runs as that function's owner, not the invoking role.
--
-- Safe to run more than once.

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
  END LOOP;
END $$;

-- RLS-policy / view predicates -- must stay callable by signed-in users
GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_any_role(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_warehouse_or_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_write(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_write_project(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_see_project(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.manages_project(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_modify_po(uuid, public.po_status) TO authenticated;

-- Frontend RPCs -- confirmed called via supabase.rpc(...) in src/
GRANT EXECUTE ON FUNCTION public.create_purchase_order(uuid, uuid, text, text, date, text, text, text, uuid, numeric, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_shipping_ticket(uuid, date, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_packing_slip(uuid, uuid, date, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_purchase_order(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_shipping_ticket(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_packing_slip(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decide_borrow_request(uuid, text, numeric, text, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.return_borrowed_stock(uuid, numeric, text, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ship_shipping_ticket_inventory(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_shipping_ticket_inventory(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_packing_slip_inventory(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_user_role(uuid, public.app_role) TO authenticated;

-- Verify after running -- should return zero rows:
-- select routine_name, grantee from information_schema.routine_privileges
-- where routine_schema = 'public' and grantee in ('anon', 'PUBLIC');
