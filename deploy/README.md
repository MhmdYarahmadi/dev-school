# Deploying pgschool to the VPS

It runs as one container, `pgschool-app`, next to the other stacks in `/opt/stacks/`, behind the existing Caddy container on the `proxy` network.

## First time only
1. **DNS:** `school.zilber.tech` → `89.44.243.19` (done).
2. **Admin password:** on the VPS, create the env file:
   ```bash
   mkdir -p /opt/stacks/pgschool
   echo "ADMIN_PASSWORD=$(openssl rand -base64 18)" > /opt/stacks/pgschool/.env
   chmod 600 /opt/stacks/pgschool/.env
   cat /opt/stacks/pgschool/.env      # note the password
   ```
3. **Deploy:** `deploy/deploy.sh` (run it from this PC).
4. **Caddy:** the `school.zilber.tech` block (`deploy/Caddyfile.snippet`) is in `/opt/stacks/proxy/Caddyfile`. It routes `/pg/*` to pgschool-app (prefix stripped) and everything else to the `school-home` container (see `../school-home`).
   ⚠️ The Caddyfile is bind-mounted as a single file. Editors that replace the file (like `sed -i`) aren't seen by the running container. Apply changes with `docker cp Caddyfile caddy:/tmp/Caddyfile.current`, then `caddy validate` / `caddy reload --config /tmp/Caddyfile.current` (see ADMIN_GUIDE.txt §11).

## Updates
`deploy/deploy.sh` runs the tests, builds, uploads `dist/` and `server/`, and restarts the container. Learner data is kept in the `pgschool_data` volume.

## Using it
- Home page: `https://school.zilber.tech`
- Learners: `https://school.zilber.tech/pg/`, where they create an account.
- You: `https://school.zilber.tech/pg/#/admin`, with the ADMIN_PASSWORD.
- The app is built with Vite `base: '/pg/'`, and API calls go to `<base>api`, so the server itself still sees `/api/...` and `/assets/...`.

## Backups
The whole database is a single SQLite file in the `pgschool_data` volume:
```bash
docker exec pgschool-app node -e "new (require('node:sqlite').DatabaseSync)('/data/pgschool.db').exec(\"VACUUM INTO '/data/backup.db'\")"
docker cp pgschool-app:/data/backup.db ./pgschool-backup-$(date +%F).db
```
⚠️ Passwords are stored in plain text (by choice), so keep backups private.
