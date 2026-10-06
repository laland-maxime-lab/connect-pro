# ConnectPro V2 — Clone AnyDesk

Application de contrôle à distance production-ready.
Architecture identique à RustDesk / AnyDesk.

```
apps/
├── host/        → App desktop Tauri + Rust (PC à contrôler)
├── client/      → PWA Next.js (télécommande web/mobile)
└── signaling/   → Serveur Fastify + Socket.IO (Railway)
```

---

## Prérequis

### Rust + Tauri (pour le HOST)
```bash
# 1. Installer Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source ~/.cargo/env

# 2. Installer les dépendances système Tauri

# macOS
xcode-select --install

# Ubuntu/Debian
sudo apt install libwebkit2gtk-4.1-dev libssl-dev libgtk-3-dev \
  libayatana-appindicator3-dev librsvg2-dev

# Windows → installer Visual Studio Build Tools + WebView2
# https://tauri.app/start/prerequisites/

# 3. Installer Tauri CLI
cargo install tauri-cli --version "^2"
# ou via npm:
npm install -g @tauri-apps/cli@latest
```

### Node.js (pour le CLIENT et SIGNALING)
```bash
# Node.js >= 18
node --version

# Installer les dépendances
cd apps/signaling && npm install
cd apps/client    && npm install
cd apps/host      && npm install
```

---

## 1. SIGNALING SERVER — Déploiement Railway

### Local (dev)
```bash
cd apps/signaling
cp .env.example .env
npm run dev
# → http://localhost:3001
# → /health pour vérifier
```

### Déploiement Railway
```bash
# 1. Créer un compte sur railway.app
# 2. Installer le CLI
npm install -g @railway/cli
railway login

# 3. Déployer depuis apps/signaling
cd apps/signaling
railway init          # Lier au projet Railway
railway up            # Déployer

# 4. Récupérer l'URL publique
railway domain        # → https://connectpro-signaling-xxxx.up.railway.app
```

Variables d'environnement Railway (auto-injectées) :
- `PORT` → Railway l'injecte automatiquement
- `NODE_ENV=production`
- `RAILWAY_STATIC_URL` → URL publique (pour le keep-alive)

---

## 2. HOST — Build de l'app desktop

### Dev (hot-reload)
```bash
cd apps/host

# Configurer l'URL du signaling
echo "SIGNALING_URL=https://connectpro-signaling-xxxx.up.railway.app" > .env

# Lancer en mode développement
npm run tauri dev
```

### Build production

**macOS → .dmg**
```bash
cd apps/host
npm run tauri build
# Output: src-tauri/target/release/bundle/dmg/ConnectPro Host_2.0.0_aarch64.dmg
```

**Windows → .exe / .msi**
```bash
# Sur Windows ou via cross-compilation
npm run tauri build
# Output: src-tauri/target/release/bundle/msi/ConnectPro Host_2.0.0_x64_en-US.msi
#     ou: src-tauri/target/release/bundle/nsis/ConnectPro Host_2.0.0_x64-setup.exe
```

**Linux → .AppImage / .deb**
```bash
npm run tauri build
# Output: src-tauri/target/release/bundle/appimage/connect-pro-host_2.0.0_amd64.AppImage
```

### Cross-compilation (GitHub Actions)
Utiliser le workflow officiel Tauri :
```yaml
# .github/workflows/build.yml
uses: tauri-apps/tauri-action@v0
with:
  projectPath: apps/host
```

---

## 3. CLIENT PWA — Déploiement

### Local (dev)
```bash
cd apps/client
cp .env.example .env.local
# Éditer NEXT_PUBLIC_SIGNALING_URL=http://localhost:3001
npm run dev
# → http://localhost:3000
```

### Déploiement Vercel (recommandé — gratuit)
```bash
npm install -g vercel
cd apps/client
vercel deploy

# Variable d'environnement à configurer sur Vercel :
# NEXT_PUBLIC_SIGNALING_URL=https://connectpro-signaling-xxxx.up.railway.app
```

### Déploiement Railway (alternative)
```bash
cd apps/client
railway init
railway up
```

---

## Architecture de la connexion

```
HOST (Tauri/Rust)                    CONTROLLER (Browser/PWA)
       │                                        │
       │──── register-device ────────────────►  │
       │◄─── registered (ID: 483 291 734) ───── │
       │                                        │
       │                          ◄── request-connection (ID) ───
       │◄─── incoming-request ──────────────────│
       │                                        │
       │  [Popup Accept/Reject]                 │
       │──── respond (accept) ──────────────────►
       │                                        │
       │◄══════ session-started (both) ════════►│
       │                                        │
       │◄──── WebRTC offer ─────────────────────│  (via signaling)
       │──── WebRTC answer ─────────────────────►
       │◄══► ICE candidates échangés ═══════════│
       │                                        │
       │◄════════════ P2P WebRTC ══════════════►│
       │   Video (scrap → VP8)  DataChannel     │
       │   Host → Controller    Input events    │
       │                        Controller →    │
       │                        Host (enigo)    │
```

---

## Flux WebRTC détaillé

| Étape | Description |
|-------|-------------|
| 1 | Controller crée `RTCPeerConnection` + `DataChannel` |
| 2 | Controller envoie **SDP Offer** via Socket.IO |
| 3 | Host reçoit l'offer, ajoute la track vidéo (`scrap` → JPEG/VP8) |
| 4 | Host envoie **SDP Answer** |
| 5 | Échange ICE candidates (STUN Google + TURN openrelay) |
| 6 | Si P2P établi → **DataChannel direct** (<50ms) |
| 7 | Si NAT bloque → **relay via Socket.IO** (fallback auto à 15s) |

---

## Crates Rust utilisées

| Crate | Usage |
|-------|-------|
| `scrap 0.5` | Capture écran OS-level (DXGI/CGDisplay/X11) 60fps |
| `enigo 0.2` | Contrôle souris/clavier (Win32/CGEvent/X11) |
| `webrtc 0.11` | Stack WebRTC complète en Rust |
| `rust-socketio 0.5` | Client Socket.IO async |
| `tauri 2` | Shell desktop cross-platform |
| `aes-gcm 0.10` | Chiffrement AES-256-GCM |
| `machine-uid 0.5` | ID hardware persistant |

---

## TURN server maison (optionnel — pour meilleure performance)

Pour la 4G Cameroun ou réseaux restrictifs, déployer `coturn` sur Railway :

```bash
# railway.toml dans un projet coturn
[build]
builder = "dockerfile"

# Dockerfile
FROM coturn/coturn:latest
EXPOSE 3478 3478/udp 5349 5349/udp
CMD ["turnserver", \
  "--listening-port=3478", \
  "--tls-listening-port=5349", \
  "--realm=connectpro", \
  "--user=connectpro:secret123", \
  "--lt-cred-mech", \
  "--no-stdout-log"]
```

Puis dans `apps/host/src-tauri/src/session.rs` et `apps/client/src/lib/webrtc.ts`, ajouter :
```json
{
  "urls": "turn:ton-coturn.up.railway.app:3478",
  "username": "connectpro",
  "credential": "secret123"
}
```

---

## Sécurité

- **Chiffrement E2E** : WebRTC chiffre toutes les données avec DTLS-SRTP
- **Autorisation** : Pop-up d'approbation obligatoire côté host
- **Permissions granulaires** : Contrôle / Fichiers / Presse-papier
- **Mot de passe** : Accès sans surveillance possible via hash AES
- **ID éphémère** : Régénérable à tout moment

---

## Troubleshooting

**`scrap` ne compile pas sur Linux**
```bash
sudo apt install libxcb-shm0-dev libxcb-randr0-dev
```

**`enigo` erreur sur Linux**
```bash
sudo apt install libxtst-dev
```

**WebRTC bloqué (P2P échoue)**
→ Vérifier que TURN openrelay répond :
```bash
# Tester le TURN
npx @coturn/coturn-client --host openrelay.metered.ca --port 80 \
  --user openrelayproject --pass openrelayproject
```
→ Si ça échoue, déployer `coturn` maison (voir section ci-dessus)

**Build Tauri échoue sur macOS Apple Silicon**
```bash
rustup target add aarch64-apple-darwin
npm run tauri build -- --target aarch64-apple-darwin
```
