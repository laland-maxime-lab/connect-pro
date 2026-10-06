<script lang="ts">
  export let deviceInfo: { device_id: string; hostname: string; os: string } | null = null;

  let copied = false;

  function copyId() {
    if (!deviceInfo) return;
    navigator.clipboard.writeText(deviceInfo.device_id.replace(/\s/g, ''));
    copied = true;
    setTimeout(() => copied = false, 2000);
  }
</script>

<div class="home">
  <div class="logo">
    <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
      <rect width="40" height="40" rx="10" fill="#6366f1"/>
      <path d="M8 14h24M8 20h16M8 26h20" stroke="white" stroke-width="2.5" stroke-linecap="round"/>
    </svg>
    <span>ConnectPro</span>
  </div>

  <div class="card id-card">
    <div class="label">Votre ID</div>
    <div class="device-id">{deviceInfo?.device_id ?? '--- --- ---'}</div>
    <button class="copy-btn" on:click={copyId}>
      {copied ? '✓ Copié' : 'Copier l\'ID'}
    </button>
  </div>

  <div class="card info-card">
    <div class="row">
      <span class="key">Appareil</span>
      <span class="val">{deviceInfo?.hostname ?? '...'}</span>
    </div>
    <div class="row">
      <span class="key">Système</span>
      <span class="val">{deviceInfo?.os ?? '...'}</span>
    </div>
    <div class="row">
      <span class="key">Statut</span>
      <span class="val online">● En ligne</span>
    </div>
  </div>

  <p class="hint">
    Partagez votre ID avec quelqu'un pour lui permettre de se connecter à cet ordinateur.
  </p>
</div>

<style>
  .home {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100vh;
    gap: 20px;
    padding: 24px;
  }

  .logo {
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 22px;
    font-weight: 700;
    color: #f1f5f9;
    margin-bottom: 8px;
  }

  .card {
    background: #1e293b;
    border: 1px solid #334155;
    border-radius: 16px;
    padding: 24px;
    width: 100%;
    max-width: 380px;
  }

  .id-card {
    text-align: center;
  }

  .label {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: #94a3b8;
    margin-bottom: 8px;
  }

  .device-id {
    font-size: 36px;
    font-weight: 800;
    letter-spacing: 0.12em;
    color: #6366f1;
    font-variant-numeric: tabular-nums;
    margin-bottom: 16px;
  }

  .copy-btn {
    background: #6366f1;
    color: white;
    border: none;
    border-radius: 8px;
    padding: 10px 24px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.2s;
  }
  .copy-btn:hover { background: #4f46e5; }

  .info-card .row {
    display: flex;
    justify-content: space-between;
    padding: 8px 0;
    border-bottom: 1px solid #1e293b;
    font-size: 14px;
  }
  .info-card .row:last-child { border-bottom: none; }
  .key { color: #94a3b8; }
  .val { color: #f1f5f9; font-weight: 500; }
  .online { color: #22c55e; }

  .hint {
    font-size: 13px;
    color: #64748b;
    text-align: center;
    max-width: 320px;
    line-height: 1.5;
  }
</style>
