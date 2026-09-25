# Putting Circuit Notebook online

Notes for the first public deployment: **Hetzner** runs the app, **Cloudflare** stands in
front of it. Budget: about **5 €/month** (server) plus **about 10 €/year** (domain).

```
visitor ──HTTPS──▶ Cloudflare (DNS, TLS, CDN cache, WAF, DDoS shield)
                        │  outbound tunnel, started by the server
                        ▼
                 Hetzner VPS ── cloudflared ──▶ circuit-notebook container (:8787)
                                                 └─ /data/circuit-notebook.sqlite
```

Why two layers? Hetzner is the **engine** (cheap, reliable, EU servers, GDPR-friendly), Cloudflare
is the **shield and the shop window**: it hides the server's IP, absorbs attacks, gives free TLS
certificates and caches the static files close to visitors.

## 1. Name and domain

- [x] **`circuitnotebook.com`**, registered at **Hostinger** (renewal happens there: keep
      auto-renew on, and confirm the ICANN verification email within 15 days).
- [ ] Cloudflare → _Add a domain_ → `circuitnotebook.com` → **Free** plan. Delete the imported
      records that point to Hostinger's parking page (A / AAAA / CNAME for `@` and `www`).
- [ ] Hostinger (hPanel → _Domains_ → `circuitnotebook.com` → _DNS / Nameservers_): turn
      **DNSSEC off** if it is on, then _Change nameservers_ → the two `*.ns.cloudflare.com`
      names Cloudflare gives. The domain stays at Hostinger; only the DNS moves to Cloudflare.
- [ ] Wait for Cloudflare's "your domain is now active" email (minutes to 24 h), then turn
      DNSSEC on again **from Cloudflare** (it gives a DS record to paste at Hostinger).
- [ ] Optional, later: transfer the registration to Cloudflare Registrar (at-cost renewals).
      Possible 60 days after the purchase.

## 2. The server (Hetzner)

- [ ] Hetzner Cloud → **CX22** (2 vCPU, 4 GB RAM, 40 GB), Ubuntu 24.04, location Falkenstein or
      Nuremberg. Add your **SSH key** at creation, no password login.
- [ ] Hetzner firewall: allow **SSH (22) only** (with a tunnel, no web port needs to be open).
- [ ] On the server:

  ```bash
  apt update && apt upgrade -y && apt install -y unattended-upgrades
  curl -fsSL https://get.docker.com | sh
  sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/' /etc/ssh/sshd_config
  systemctl restart ssh
  git clone https://github.com/TomROUSSEAU28/Overleagger.git circuit-notebook
  cd circuit-notebook
  ```

- [ ] Server settings go in `docker-compose.override.yml` (not in git, so `git pull` never
      conflicts with them; Docker Compose merges it automatically):

  ```bash
  cat > docker-compose.override.yml <<'EOF'
  services:
    circuit-notebook:
      ports: !override
        - '127.0.0.1:8787:8787' # reachable from the machine only (the tunnel)
      environment:
        PUBLIC_URL: https://circuitnotebook.com
        TRUST_PROXY: 'true'
        # Your account sees the Administration page (menu of your avatar).
        ADMIN_EMAILS: you@example.com
        # Beta limits (these are the defaults): projects per account, MB per project.
        MAX_PROJECTS: '5'
        MAX_PROJECT_MB: '5'
  EOF
  ```

  If you change the limits, also update the FAQ of the homepage (`apps/web/index.html`).

- [ ] `docker compose up -d --build`, then `curl localhost:8787/api/health`.

## 3. Cloudflare in front

**Recommended: Cloudflare Tunnel.** The server opens an outbound connection to Cloudflare, so
no web port is open to the internet and the IP address is never published.

- [ ] Cloudflare dashboard → _Zero Trust → Networks → Tunnels_ → create a tunnel, run the
      `cloudflared` install command it shows on the server.
- [ ] Public hostname: `circuitnotebook.com` → `http://localhost:8787`. WebSockets (`/collab`) work through
      tunnels with no extra setting.
- [ ] _SSL/TLS_: mode **Full (strict)**. Never **Flexible** (the second half of the trip would be
      plain HTTP).
- [ ] _Caching → Cache Rules_: **bypass cache** for `/api/*` and `/collab*`. Static files
      (`/assets/*`, images) can be cached: their names change at each build.
- [ ] _Security → WAF → Rate limiting rule_: `/api/auth/login` and `/api/auth/signup`, e.g.
      10 requests / minute / IP → block for 10 minutes.
- [ ] Bot Fight Mode: on.

Things to know:

- **Under Attack mode** shows a JavaScript challenge page: fine for the homepage, but it breaks
  API calls and the WebSocket. Use it only in an emergency, or via a rule limited to `/`.
- **Waiting Room** is a paid feature (Enterprise / add-on): not needed at this scale.

**Alternative without a tunnel:** Caddy (or nginx) on the server with a **Cloudflare Origin
Certificate**, and a Hetzner firewall that allows ports 80/443 **only from Cloudflare's IP
ranges** (<https://www.cloudflare.com/ips/>). Also set `TRUST_PROXY: 'true'`.

## 4. Backups

Two layers, both automatic:

- **The server copies its database every night** into the data volume
  (`/data/backups/circuit-notebook-YYYY-MM-DD.sqlite`, the last 7 days, `BACKUP_KEEP_DAYS`).
  SQLite makes the copy itself, so it is a clean file even while people are drawing. The
  Administration page shows the last copy and has a "Make one now" button.
- **Hetzner Backups** (Hetzner console → your server → _Backups_ → enable, +20 % of the server
  price): every night Hetzner takes a picture of the whole disk and keeps the last 7, **on
  other machines**. If the server breaks or is erased by mistake, you rebuild it from one of
  those pictures in one click (_Backups_ → _Restore_, or _Create server from backup_), and the
  nightly database copies above come back with it.

To bring back one database copy without restoring the whole server:

```bash
cd ~/circuit-notebook
docker compose stop
docker compose run --rm --entrypoint sh circuit-notebook -c \
  'cp /data/backups/circuit-notebook-2026-09-24.sqlite /data/circuit-notebook.sqlite && rm -f /data/circuit-notebook.sqlite-wal /data/circuit-notebook.sqlite-shm'
docker compose start
```

- [ ] Try a restore once, before anyone relies on it.

### Start again from zero

To erase every account, shared project, friend, team and version history (after tests, for
example), and name the administrator at the same time:

```bash
cd ~/circuit-notebook && git pull
deploy/reset.sh --admin you@example.com
```

It asks you to type `RESET`, writes `ADMIN_EMAILS` in `docker-compose.override.yml`, moves the
old database to `/data/backups/before-reset-<date>/` (nothing is deleted), and starts the latest
version with an empty database. Projects saved in browsers are not touched. The end of its
output shows how to undo.

## 4b. The site's e-mail address and the contact form

Messages written in the form at the bottom of the homepage are always saved in the server's
database: read them on the **Administration** page (_Messages_). Two optional steps make them
reach your mailbox and give the site its address, contact@circuitnotebook.com.

1. **Receive e-mails at contact@** (free, Cloudflare Email Routing)
   - Cloudflare → circuitnotebook.com → **Email** → **Email Routing** → _Get started_ /
     _Enable_: Cloudflare adds the DNS records (MX, TXT) by itself.
   - **Destination addresses** → add your Gmail → click the link Cloudflare sends you.
   - **Routing rules** → _Create address_ → `contact` → action _Send to an email_ → your Gmail.
   - Test: send an e-mail to contact@circuitnotebook.com from another address.
2. **Let the server send the form to you** (free, Brevo: 300 e-mails a day)
   - Create an account on brevo.com → **Senders, domains & dedicated IPs** → **Domains** → add
     `circuitnotebook.com` → Brevo shows a few DNS records: add them in Cloudflare (DNS →
     Records), then _Verify_. Add `contact@circuitnotebook.com` as a sender.
   - **SMTP & API** → **SMTP** → _Generate a new SMTP key_: note the login and the key.
   - In `docker-compose.override.yml` on the server, under `environment:`:

     ```yaml
     CONTACT_EMAIL: contact@circuitnotebook.com
     SMTP_HOST: smtp-relay.brevo.com
     SMTP_PORT: '587'
     SMTP_USER: <the Brevo SMTP login>
     SMTP_PASS: <the Brevo SMTP key>
     SMTP_FROM: Circuit Notebook <contact@circuitnotebook.com>
     ```

   - `deploy/update.sh --force`, then send yourself a message from the homepage.
3. **Answer as contact@ from Gmail** (optional)
   - Gmail → ⚙ → _See all settings_ → **Accounts and Import** → _Send mail as_ → _Add another
     email address_: name `Circuit Notebook`, address `contact@circuitnotebook.com` (keep _Treat
     as an alias_) → SMTP server `smtp-relay.brevo.com`, port `587`, the Brevo SMTP login and
     key, _TLS_ → Gmail e-mails a code to contact@ (it comes back to your Gmail): enter it.
   - Same page, _When replying to a message_: choose **Reply from the same address the message
     was sent to**. Your answers to contact@ (and to the form) then leave as contact@.
4. **Sort them** (optional): search `to:contact@circuitnotebook.com` in Gmail → the settings
   icon at the right of the search box → _Create filter_ → _Apply the label_ → new label
   `Circuit Notebook` (and _Skip the Inbox_ if you want them out of it).

Each person writing through the form gets their own conversation in the mailbox: the subject
holds their address, the sender shows their name ("Léa via Circuit Notebook"), and _Reply_
answers them (Reply-To). Their answers to your reply come to contact@, in the same conversation.

## 5. Updates

```bash
~/circuit-notebook/deploy/update.sh
```

It fetches the latest code, saves a clean copy of the database in
`~/circuit-notebook/backups/cn-<date>.sqlite` (the 5 latest are kept), rebuilds, restarts,
removes the old images and checks `/api/health`. Nothing new on GitHub → it stops there
(`--force` rebuilds anyway).

To go back to one of these copies:

```bash
docker compose stop
docker compose cp backups/cn-<date>.sqlite circuit-notebook:/data/circuit-notebook.sqlite
docker compose run --rm --entrypoint sh circuit-notebook -c 'rm -f /data/circuit-notebook.sqlite-wal /data/circuit-notebook.sqlite-shm'
docker compose start
```

How much room backups take, at most: Hetzner Backups are stored by Hetzner, not on your disk
(7 kept); the nightly copies take 7 × the database; `update.sh` keeps 5 more. With a 100 MB
database that is about 1.2 GB. The Administration page shows the free disk space.

Open projects reconnect by themselves; unsynced edits stay in the browsers and sync afterwards.

## 6. Before announcing it

- [x] **Privacy policy** (GDPR): `apps/web/privacy/index.html`, served at `/privacy/`, linked
      from the footer, the contact form and the sign-up dialog. Keep it true: if you add a
      service (analytics, another e-mail provider…) or change how long data is kept, update it
      and its date. Promises made there: contact messages are gone after one year at most (the
      server deletes them by itself, `MESSAGE_KEEP_DAYS`, default 365), and requests sent by
      e-mail (a copy of one's data…) are answered within a month. People delete their account
      themselves (menu of their name → _Delete my account_).
- [x] **Mentions légales** (France): `apps/web/legal/index.html`, at `/legal/`: publisher, host
      (Hetzner), Cloudflare. If you become a business (premium plan), add its legal details
      there (SIRET…). No tracking cookies → no cookie banner needed.
- [x] Homepage: absolute `og:image` / `twitter:image`, `<link rel="canonical">`, `robots.txt` and
      `sitemap.xml` point to `https://circuitnotebook.com/`.
- [ ] Cloudflare _Rules → Redirect rules_: `www.circuitnotebook.com/*` →
      `https://circuitnotebook.com/$1` (301), so there is one address.
- [ ] `ALLOW_SIGNUP`: keep `true` for a public beta, or `false` + invite links for a closed one.
- [ ] Optional: GitHub sign-in (`GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`, callback
      `https://circuitnotebook.com/api/auth/github/callback`).
- [ ] Uptime monitor (UptimeRobot, free) on `https://circuitnotebook.com/api/health`.

## 7. Getting found

- [ ] **Google Search Console** (+ Bing Webmaster Tools): add the domain, send the sitemap.
- [ ] Post it where the users are: r/ElectricalEngineering, r/PowerElectronics, r/ECE,
      r/LaTeX, **Show HN**, your school's Discord / student associations, LinkedIn.
- [ ] A short demo GIF or video (draw a buck converter, open the controller block, export PDF)
      does more than any text.
