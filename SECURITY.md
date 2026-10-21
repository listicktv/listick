# Security

## Reporting a vulnerability

Please report it privately through GitHub: **Security › Report a vulnerability** on this repository. Don't open a public
issue. Describe what you found, how to reproduce it and what it allows. You'll get an answer within a week.

Only the latest release (the `main` branch and the `latest` image) gets security fixes.

## Running Listick safely

- **Use HTTPS through a reverse proxy, and don't expose port 3000.** Sign-in attempts are rate-limited per IP address,
  read from `X-Forwarded-For`; if more than one proxy sits in front of Listick, set `LISTICK_TRUSTED_PROXIES`.
- **Set `APP_ORIGIN` to your public address.** Listick only accepts changes from its own pages at that address, and
  email links point there.
- **Create your admin account before going public** (`LISTICK_OWNER_NAME`, `LISTICK_OWNER_PASSWORD`). Sign-up is by an
  admin's invite link only.
- **Keep secrets in `.env`.** Data source API keys, `BETTER_AUTH_SECRET` and the database password are read from the
  environment and never sent to the browser.

Users' API keys (Settings › API access) and Stremio session keys are stored in the database, so they can be shown again
and used by the worker. Protect the database and its backups as carefully as Listick itself.
