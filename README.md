# Patogh (پاتوق)

A self-hosted place for one community: text channels, voice and video, roles,
friends and direct messages, all on a single server you run yourself.

The first person to open a fresh install sets it up: they name the server and
become its owner. Everyone who registers after that joins the same server.

## Run it locally

Requirements: Node.js 22.12 or newer.

```bash
npm install
npm run dev
```

The web app runs on http://127.0.0.1:5173 and the API on port 3005.

Voice and video need a LiveKit server. Point `LIVEKIT_URL`, `LIVEKIT_API_KEY`
and `LIVEKIT_API_SECRET` in `.env` at one (see `.env.example`).

## patogh-setup.sh

Installs Patogh on a Linux server (Ubuntu / Debian) with Docker, behind nginx
with a Let's Encrypt certificate, with voice and video (LiveKit):

- asks for the domain and checks that it points to the server
- installs Docker and the compose plugin (from download.docker.com, or from
  the distro packages if that is unreachable)
- on a server in Iran, Docker Hub, npm and Debian are blocked: the script
  tests local mirrors on the spot and uses the ones that answer
- clones the repository to `/opt/patogh`, generates the secrets and LiveKit
  keys once (kept on re-runs), builds the image and starts it on 127.0.0.1
- nginx on the host in front of it (websockets, `/livekit`), a Let's Encrypt
  certificate that renews automatically, and a 2 GB swap file on servers with
  less than 3 GB of RAM (for the build)

```bash
bash <(curl -Ls https://raw.githubusercontent.com/FarzinNs83/discord-alt/main/patogh-setup.sh)
```

If raw.githubusercontent.com is blocked, the same through the ghfast.top GitHub mirror:

```bash
bash <(curl -Ls https://ghfast.top/https://raw.githubusercontent.com/FarzinNs83/discord-alt/main/patogh-setup.sh)
```

Then open `https://<domain>` right away: the first visitor names the server
and becomes its owner.

Update to the latest commit: run the same command again. It takes a database
snapshot, pulls, rebuilds and restarts; settings and secrets are kept.

Or, from `/opt/patogh`, update only the app (no nginx, certificate or Docker
changes) with a rollback if the new build does not come up healthy:

```bash
./update.sh --check   # list new commits, change nothing
./update.sh           # snapshot, pull, rebuild, restart; --yes skips the question
```

Or run the newest `update.sh` straight from GitHub, from anywhere:

```bash
cd /opt/patogh && bash -c "$(curl -Ls https://raw.githubusercontent.com/FarzinNs83/discord-alt/main/update.sh)" update.sh
```

Through the ghfast.top mirror:

```bash
cd /opt/patogh && bash -c "$(curl -Ls https://ghfast.top/https://raw.githubusercontent.com/FarzinNs83/discord-alt/main/update.sh)" update.sh
```

Options go at the end, e.g. `... update.sh --check`.

Show all options:

```bash
bash <(curl -Ls https://raw.githubusercontent.com/FarzinNs83/discord-alt/main/patogh-setup.sh) --help
```

By default, web traffic uses TCP 80/443. Next to `dns-setup.sh` from my-scripts,
Patogh's HTTPS listener sits behind its relay on `127.0.0.1:10446`.

To leave both ports available for other projects, choose a public HTTPS port
and supply a certificate for your hostname (or IPv4 address):

```bash
sudo PS_TLS_DIR=/etc/patogh/tls bash patogh-setup.sh \
  --domain chat.example.com --https-port 8443 --open-firewall
```

Before running this command, place `fullchain.pem` and `privkey.pem` in
`/etc/patogh/tls/chat.example.com/`. A certificate issued using DNS validation
works without opening either standard web port. Renew the certificate through
its issuer and reload nginx after renewal. Open TCP 8443 in the provider
firewall and visit `https://chat.example.com:8443`. The script remembers the
port and certificate directory on updates. `--port` sets the separate
loopback port for the app behind nginx.

Voice uses UDP 3478, TCP 7881 and UDP 7882 in either mode. Open those in the
provider firewall as well. `--open-firewall` opens the selected ports in an
active ufw or firewalld.

## backup.sh / restore.sh

From `/opt/patogh`:

```bash
./backup.sh                 # database snapshot to data/backups/
./restore.sh                # list the snapshots, newest first
./restore.sh <snapshot.db>  # restore one; the current database is saved first
```

## deploy.sh

Pushes this checkout from your machine to a server set up with `install.sh`
and rebuilds the image there, for running unreleased code. The server keeps
its `.env`, `data/`, `livekit.yaml` and certificates.

```bash
./deploy.sh                 # asks for the server (user@host)
```

Put `DEPLOY_HOST` and `DEPLOY_PATH` in `./.deploy.local` (git-ignored) to skip
the question.

## hostbuild.sh

Builds `dist-host/patogh-host.zip` for a shared host with "Setup Node.js App"
(cPanel / DirectAdmin, Linux x64, Node 22.12+). Create the app, extract the zip
in its root, set the startup file to `app.js`, add `JWT_SECRET` (and `DOMAIN`)
as environment variables and restart. Do not press "Run NPM Install": the
dependencies are already in the zip. Voice and video need an external LiveKit
server (`LIVEKIT_*`), and video thumbnails need `ffmpeg` on the host.

## Other scripts

- `renew-cert.sh`: renews the certificate and reloads nginx. `install.sh` runs
  it daily from `/etc/cron.d/patogh-certbot`
- `electronbuild.sh`: desktop installers for macOS, Windows and Linux in
  `packages/desktop/installers/`

Each script has `--help`. See `.env.example` for every setting.

## License

AGPL-3.0-only. If you run a modified version for other people, you must offer
them its source code.

**✨ Forked, redesigned & enhanced** from [Backspace](https://github.com/TheZwiss/backspace) by [TheZwiss](https://github.com/TheZwiss).
