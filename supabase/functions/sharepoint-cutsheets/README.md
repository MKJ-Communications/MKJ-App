# sharepoint-cutsheets

Reads vendor cutsheets from SharePoint for the Cutsheets page (`/cutsheets`):

- **Library:** `Wiki` on MKJ's root site (`mkjcommunications.sharepoint.com`)
- **Folder:** `Vendor Docs, Cuts & CAD Blocks/Vendor Product Cutsheets & Docs`, with every subfolder

It signs in to Microsoft Graph as its own app (not as the user), with **read-only access to that one site** and nothing
else in the tenant. The folder location is set in [index.ts](index.ts) (`SHAREPOINT_*`). The Microsoft keys live only in
Supabase's Edge Function secrets.

## One-time Microsoft setup

A Microsoft 365 admin does this once. It takes about 15 minutes.

### 1. Register the app

1. Open the [Microsoft Entra admin center](https://entra.microsoft.com), then go to **Identity → Applications → App
   registrations → New registration**.
2. Fill it in:
   - **Name:** `MKJ App – SharePoint reader`
   - **Supported account types:** *Accounts in this organizational directory only (Single tenant)*
   - **Redirect URI:** leave empty
3. Click **Register**. On the app's **Overview** page, write down:
   - **Application (client) ID** : 
   - **Directory (tenant) ID**:

   Neither of these is secret.

This is a separate registration from the one used for "Sign in with Microsoft". Keep them separate, so the login app
never gets SharePoint access and this one never takes part in sign-in.

### 2. Create a client secret

1. In the new app, go to **Certificates & secrets → Client secrets → New client secret**.
2. Set **Description** to `Supabase sharepoint-cutsheets` and **Expires** to 24 months, then click **Add**.
3. Copy the **Value** column right away. It's shown only once. (Don't copy the *Secret ID*.): 
4. Put the expiry date in your calendar. When the secret expires, syncing stops with a Microsoft sign-in error until a
   new secret is created and saved in Supabase (step 5).

### 3. Allow "selected sites" only

1. In the app, go to **API permissions → Add a permission → Microsoft Graph → Application permissions**.
2. Search for **`Sites.Selected`**, tick it, and click **Add permissions**.
3. Click **Grant admin consent for MKJ Communications** and confirm. The status column should show a green tick.

`Sites.Selected` alone gives access to **no** sites. Step 4 grants read access to the one site the app needs.

### 4. Give the app read access to the main site

This uses [Graph Explorer](https://developer.microsoft.com/graph/graph-explorer), Microsoft's own tool for calling the
Graph API. Sign in with your admin account (top right).

1. **Find the site's ID.** Set the method to `GET`, enter this URL, and click **Run query**:

   ```
   https://graph.microsoft.com/v1.0/sites/mkjcommunications.sharepoint.com
   ```

   If it asks for permission, open the **Modify permissions** tab, consent to `Sites.Read.All`, and run it again. Copy
   the `"id"` value from the response. It looks like
   `mkjcommunications.sharepoint.com,1111aaaa-…,2222bbbb-…`, with two commas.: "id": "mkjcommunications.sharepoint.com,29e2e76d-0fdd-411f-ada0-e3a901ce5611,63fc9d04-f463-41f0-b3d5-5de1e30f0e05",

2. **Allow Graph Explorer to grant site access.** On **Modify permissions**, consent to `Sites.FullControl.All`. This is
   only for your own Graph Explorer session, so it can create the grant in the next step. The app doesn't get it.

3. **Grant the app read access.** Set the method to `POST` and the URL to (replace `{site-id}` with the ID from step 1):

   ```
   https://graph.microsoft.com/v1.0/sites/{site-id}/permissions
   ```

   Paste this into **Request body**, with your Application (client) ID in place of `<client-id>`:

   ```json
   {
     "roles": ["read"],
     "grantedToIdentities": [
       { "application": { "id": "<client-id>", "displayName": "MKJ App – SharePoint reader" } }
     ]
   }
   ```

   Click **Run query**. You should get **201 Created**, with `"roles": ["read"]` in the response.

4. *(Optional)* Remove Graph Explorer's extra permission afterwards: **Entra admin center → Identity → Applications →
   Enterprise applications → Graph Explorer → Permissions**.

### 5. Save the keys in Supabase

In the [Supabase dashboard](https://supabase.com/dashboard/project/ujajblobqudgmdcterwe/functions/secrets), go to
**Edge Functions → Secrets** and add:

| Name | Value |
|---|---|
| `MS_TENANT_ID` | Directory (tenant) ID |
| `MS_CLIENT_ID` | Application (client) ID |
| `MS_CLIENT_SECRET` | The secret **Value** from step 2 |

Enter the secret in the dashboard rather than on a command line, so it doesn't end up in your shell history. Never
commit it or paste it into chat.

### 6. Check it

Open **Cutsheets** in the app (admin only) and click **Sync now**. The last-sync panel shows how many folders and files
were found, or the error Microsoft returned:

| Error mentions | Usually means |
|---|---|
| `MS_TENANT_ID` / `MS_CLIENT_ID` / `MS_CLIENT_SECRET` is not set | Step 5 isn't done yet |
| `AADSTS7000215` (invalid client secret) | The secret *ID* was saved instead of its *Value*, or the secret expired |
| `403` / `accessDenied` on the site | Step 3's admin consent or step 4's grant is missing |
| `404` on the library or folder | The folder was renamed or moved: update `SHAREPOINT_*` in [index.ts](index.ts) |

## Actions

All calls are `POST` with a JSON body and the caller's Supabase session (`verify_jwt = true`).

| `action` | Who | What |
|---|---|---|
| `sync` | Admins | Lists the whole cutsheets folder and records it in `sharepoint_files` through `record_sharepoint_sync` (added, changed, removed), with a row in `cutsheet_sync_runs`. Only one sync runs at a time. |
