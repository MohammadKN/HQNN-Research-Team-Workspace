# HQNN Research Team Workspace (Google Sheets edition)

A static website (index.html, styles.css, app.js, config.js) that reads and writes a Google Sheet through a small
Google Apps Script backend (Code.gs). No server and no paid services are needed.

## Setup (about 10 minutes)

1. **Create the sheet.** Go to sheets.google.com and create a blank spreadsheet. Name it, for example, "HQNN Team Workspace".
2. **Add the backend.** In the sheet choose Extensions > Apps Script. Delete the sample code, paste the whole of `Code.gs`,
   and change `TOKEN` at the top to a secret of your own. Save.
3. **Deploy it.** Click Deploy > New deployment > type "Web app".
   Set "Execute as" to **Me** and "Who has access" to **Anyone**. Click Deploy, approve the permissions
   (Advanced > Go to project), and copy the **Web app URL** (it ends in `/exec`).
4. **Connect the site.** Open `config.js`, paste the URL into `API_URL`, and put the same secret into `TOKEN`.
5. **Host the site.** Opening `index.html` directly works for testing. To share it with your four teammates, upload the four
   site files to any static host (GitHub Pages, Netlify Drop, Cloudflare Pages) and send them the link.
6. Each person types one of these names in the "Your name" box: Mustafa, Zaid, Saleem, Moe, or MKN. Names are
   case-insensitive. Editing stays disabled until an approved name is entered.

## How it works

- Tabs `papers`, `gaps`, `qs` and `_meta` are created in your sheet automatically. You can open the sheet and read or
  chart the data there at any time. Do not rename those tabs. Columns beginning with `_` are used by the site.
- The page re-reads the sheet every few seconds (`POLL_MS` in config.js), so teammates see each other's changes shortly after they are saved.
- Adding, renaming or deleting a column in the site updates the sheet header and moves the data accordingly.
- The approved-name check is enforced in both the page and `Code.gs`, so direct mutation requests are rejected too.

## Good to know

- **Security:** The token sits in config.js, so anyone who can open the site can edit the data. Treat it like a shared password
  and keep sensitive data out. Set "Who has access" back to "Only myself" to switch the backend off.
- **Changing Code.gs later:** choose Deploy > Manage deployments > edit > New version, or changes will not go live.
- **Simultaneous edits:** two people editing the same cell at the same moment is last-save-wins.
- **Limits:** Apps Script has daily quotas, which are far above what five people polling every 8 seconds will use.
  If you ever hit them, raise `POLL_MS`.
