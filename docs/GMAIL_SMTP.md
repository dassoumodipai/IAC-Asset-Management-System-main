# Gmail SMTP setup

The helper prepares and verifies a private Gmail configuration before activation. It never sends a message, starts the email worker, or restarts the app. The existing restriction on external email remains in effect: keep the worker stopped until outbound delivery is explicitly approved. Restarting it after activation can dispatch every eligible pending notification, including earlier invitations.

Google documents `smtp.gmail.com` with SSL on port `465`, a full Google Workspace address and an app password. See [Google Workspace SMTP instructions](https://support.google.com/a/answer/176600?hl=en). Google app passwords require Google Account 2-Step Verification; organization policy, security-key-only configuration or Advanced Protection can make them unavailable. See [Google app-password guidance](https://support.google.com/accounts/answer/185833?hl=en). The Google app password is separate from the IAC portal password and its authenticator code.

Run these commands from the application root in an interactive terminal. Never place a sender address or password in command arguments, chat, screenshots, issue reports or source files.

```powershell
npm run email:gmail -- prepare
npm run email:gmail -- verify
```

`prepare` asks for the approved sender address without displaying it. It creates `.env.smtp.gmail` with an empty password and refuses to overwrite an existing draft. The active `.env` remains unchanged. `verify` prompts privately for the 16-character Google app password when missing; spaces between displayed password groups are accepted. It connects to Gmail using TLS with certificate validation and checks SMTP authentication only. It saves the password in the private draft only after successful verification. No email is sent and active settings stay unchanged. A successful verification confirms connectivity/authentication, not inbox delivery or approved production readiness.

Both `.env` and `.env.smtp.gmail` contain private settings. They are covered by `.gitignore` and `.dockerignore`; exclude them from every delivery archive as well. The helper requests file mode `0600`; Windows file access also depends on the containing folder's access-control permissions. Do not share or archive either file. Keep the Google app password in an approved secret store for production. Error messages exclude sender addresses, passwords and raw SMTP responses.

Only after outbound delivery has been approved, stop the running app/worker and explicitly activate:

```powershell
npm run email:gmail -- activate
```

`activate` requires a complete saved draft, verifies SMTP authentication again, and changes only `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD` and `SMTP_FROM` in `.env`. Existing database, encryption, session and other configuration values are preserved. It sends no message and restarts no process. Review pending/expired invitations before any approved worker restart; activation itself does not renew expired links or cancel old notifications. Once approved, restart the normal app process to load the new environment. Do not start the email worker until the SMTP sender and delivery policy have been approved.

If verification fails, check that Google 2-Step Verification is enabled, app passwords are permitted for the sending account, the generated app password is current, and outbound TLS access to port 465 is available. A normal Google password or an authenticator code will not work. Google revokes app passwords when the Google Account password changes; generate a replacement as needed. Revoke the app password from Google if the private configuration is exposed.

If an operator has already prepared the private draft, skip `prepare` and run `verify` directly. The helper will not overwrite that existing draft during preparation.

Invitation links use `APP_ORIGIN`. A link beginning with `http://127.0.0.1:5173` opens the app only on the host computer; employees on other devices need an approved reachable deployment and application URL. This helper never changes `APP_ORIGIN`, because that value also controls cookie origin and CSRF checks. Configure deployment/origin separately before inviting remote employees.
