# Auth email templates

Branded HTML for the emails Supabase Auth sends. These files are the source of
truth — the Dashboard copy is a deployment target, not a place to edit.

```
_layout.html      the shell: header, CTA, footer, responsive rules
build.mjs         per-email copy + renderer  →  the five files below
confirmation.html   recovery.html   magic_link.html   invite.html   email_change.html
```

GoTrue has no partials — each template is a standalone HTML string — so without
the generator the 180-line shell would be pasted five times and drift the first
time someone edits the footer. Never edit the generated files directly; they
carry a `do not edit` banner and `npm run emails:check` fails if they are stale.

## The five emails, and what actually triggers them

| File | Supabase template | Triggered today by |
| --- | --- | --- |
| `confirmation.html` | Confirm signup | **The app** — the sign-up form in [`auth.tsx`](../../src/routes/auth.tsx) |
| `recovery.html` | Reset password | **The app** — "Forgot password?" on the sign-in page, and "Reset password" in the user menu |
| `invite.html` | Invite user | Dashboard only — Authentication → Users → Invite |
| `magic_link.html` | Magic link | Nothing — the app signs in with a password |
| `email_change.html` | Change email address | Nothing — the app has no change-email UI |

Sign-up and password reset have app-side triggers; the other three are
Dashboard-only today. Both reset entry points go through
[`RequestPasswordResetDialog`](../../src/components/request-password-reset-dialog.tsx)
and land on [`/auth/reset`](../../src/routes/auth_.reset.tsx).

That redirect only works if `/auth/reset` is on the project's allow-list —
Dashboard → Authentication → URL Configuration → Redirect URLs. Without it
Supabase silently falls back to the Site URL and the link drops the user on the
dashboard instead of the reset form.

**The invite flow still has a gap**: an invited user arrives with a session and
no password, and nothing routes them to a page where they can set one.

## Design

Colours come straight from the app's design system in `src/styles.css`, converted
from oklch to the hex that email clients understand:

| Token | oklch | hex | Used for |
| --- | --- | --- | --- |
| `--primary` | `oklch(0.31 0.06 250)` | `#16324d` | Header band (same navy as `public/og-image.png`) |
| `--sidebar` | `oklch(0.28 0.055 250)` | `#112a43` | Footer band |
| `--accent` | `oklch(0.64 0.18 42)` | `#e25d1d` | Hairline rule and the CTA button |
| `--foreground` | `oklch(0.22 0.04 250)` | `#0b1c2c` | Headings |
| `--muted-foreground` | `oklch(0.5 0.03 250)` | `#576574` | Secondary copy |
| `--muted` | `oklch(0.96 0.008 250)` | `#eef2f7` | Page background |
| `--border` | `oklch(0.9 0.012 250)` | `#d8dfe6` | Panel border |

The header image is `public/email-logo.png`, cropped from `public/og-image.png`
and exported at 560px for 280px display (2x for retina). Its navy background is
the same `#16324d` as the header cell, so the crop is seamless and the band still
looks intentional when a client blocks images and shows the alt text instead.

Structural constraints, because this is email and not the app:

- Tables for layout, inline styles for anything that matters. The `<style>` block
  only carries the responsive tweaks and is treated as optional.
- The CTA is a bulletproof button — a VML `roundrect` for Outlook, an anchor for
  everything else. VML cannot size to its text, so every email carries an
  explicit `ctaWidth` measured in a browser. `build.mjs` throws if one is missing;
  a character-count formula is not accurate enough, and too narrow clips the label.
- Fixed light palette with `color-scheme: light`, so clients that auto-invert
  don't mangle the navy.
- 600px wide, collapsing to full width under 620px.

## Template variables

Go `text/template`, evaluated by GoTrue. The ones used here:

- `{{ .ConfirmationURL }}` — the action link, already carrying the `redirect_to`
  that `signUp` passes as `emailRedirectTo` in [`auth.tsx`](../../src/routes/auth.tsx).
- `{{ .Email }}` — the address being acted on (in `email_change`, the *old* one).
- `{{ .NewEmail }}` — only available in `email_change`.
- `{{ .Data.full_name }}` — from `auth.users.user_metadata`. Guarded by a nested
  `{{ if .Data }}`: a template error means the email is never sent at all, and
  `.Data` is nil for users created outside the sign-up form.

The copy says links expire in 24 hours, which is Supabase's `mailer_otp_exp`
default. `EXPIRY_HOURS` in `build.mjs` holds that number and the push script
compares it against the live project, so the emails can't quietly start lying if
someone changes the expiry in the Dashboard.

## Changing an email

1. Edit the copy in `build.mjs`, or the shell in `_layout.html`.
2. `npm run emails` to regenerate.
3. Preview — Go tags render as literal text in a browser, which is enough for
   layout. Substitute them for a realistic look.
4. Deploy the app first if you touched anything under `public/`, so the header
   image URL resolves before the template goes live.
5. Push:

   ```bash
   export SUPABASE_ACCESS_TOKEN='sbp_...'   # supabase.com/dashboard/account/tokens
   ./supabase/maintenance/push_auth_email_templates.sh            # all five
   ./supabase/maintenance/push_auth_email_templates.sh recovery   # just one
   ./supabase/maintenance/push_auth_email_templates.sh --show     # what's live now
   ```

   It PATCHes only the `mailer_*` fields via the Management API, after checking
   the generated files are current and the header image returns 200. Do **not**
   use `supabase config push` — it writes the whole `[auth]` section and resets
   every remote setting absent from `config.toml`.

To add a sixth email, append an entry to `EMAILS` in `build.mjs` (including a
measured `ctaWidth`) and a `[auth.email.template.<key>]` block in
`config.toml`. The push script picks it up from the manifest automatically.

`supabase/config.toml` points at these same files so `supabase start` uses them
locally.

## Sending limits, and why templates may refuse to push at all

The project is still on Supabase's built-in SMTP, which has two separate
restrictions, confirmed directly against Supabase's error messages and docs:

- **Delivery is restricted to the project's Team page.** Anyone else gets
  "Email address not authorized" — silently, with no error surfaced to the
  registering user.
- **On the free tier, the Management API refuses to edit templates at all**
  while a project is on the default mailer — `push_auth_email_templates.sh`
  fails with HTTP 400: *"Email template modification is not available for
  free tier projects using the default email provider. Please upgrade your
  plan or configure a custom SMTP provider."*

[`configure_smtp.sh`](configure_smtp.sh) wires the project up to
[Resend](https://resend.com) and fixes both at once — custom SMTP satisfies
the "or configure a custom SMTP provider" clause above, and once it's live
regular email addresses can actually receive mail. It requires a Resend
account, an API key, and — importantly — **a domain verified in Resend**;
the script checks verification status via Resend's API before touching
Supabase, so it won't wire in a domain that isn't ready yet and would just
bounce every message:

```bash
export SUPABASE_ACCESS_TOKEN='sbp_...'   # supabase.com/dashboard/account/tokens
export RESEND_API_KEY='re_...'           # resend.com/api-keys
export SMTP_FROM_EMAIL='no-reply@yourverifieddomain.com'
./supabase/maintenance/configure_smtp.sh          # preview + confirm + apply
./supabase/maintenance/configure_smtp.sh --show   # read-only: current config
```

Then re-run `push_auth_email_templates.sh` — it should succeed once SMTP is
live. This is tracked as a pending decision in [`CLAUDE.md`](../../CLAUDE.md).
