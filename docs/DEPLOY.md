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
  EOF
  ```

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

- [ ] Hetzner **automatic backups** (+20 % of the server price) or weekly snapshots.
- [ ] Nightly copy of the database, consistent while the server runs (`VACUUM INTO`):

  ```bash
  # /root/backup.sh — run every night: echo '30 3 * * * root /root/backup.sh' > /etc/cron.d/cn-backup
  set -e
  cd /root/circuit-notebook
  docker compose exec -T circuit-notebook node -e \
    "new (require('node:sqlite').DatabaseSync)('/data/circuit-notebook.sqlite').exec(\"VACUUM INTO '/data/backup.sqlite'\")"
  mkdir -p /root/backups
  docker compose cp circuit-notebook:/data/backup.sqlite /root/backups/cn-$(date +%F).sqlite
  docker compose exec -T circuit-notebook rm /data/backup.sqlite
  find /root/backups -name 'cn-*.sqlite' -mtime +30 -delete
  ```

  Then send `/root/backups` off the machine (**Hetzner Storage Box** with `rsync`, or
  **Backblaze B2** with `rclone`).

- [ ] Try a restore once, before anyone relies on it.

## 5. Updates

```bash
~/circuit-notebook/deploy/update.sh
```

It fetches the latest code, saves a copy of the data in `~/circuit-notebook/backups/` (the 5
latest are kept), rebuilds, restarts, removes the old images and checks `/api/health`. Nothing
new on GitHub → it stops there (`--force` rebuilds anyway).

To go back to a copy: `docker compose stop`, then
`docker compose cp backups/data-<date>/. circuit-notebook:/data`, then `docker compose start`.

Open projects reconnect by themselves; unsynced edits stay in the browsers and sync afterwards.

## 6. Before announcing it

- [ ] **Legal (France / EU)**: _mentions légales_ (who publishes the site, the host's address)
      and a **privacy policy** (GDPR: which data — email, name, projects —, why, how long, how to
      delete an account). No tracking cookies → no cookie banner needed.
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
