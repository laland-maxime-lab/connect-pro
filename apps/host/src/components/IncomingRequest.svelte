<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  export let request: { requestId: string; fromId: string; fromName: string };

  const dispatch = createEventDispatcher();

  let allowControl = true;
  let allowFileTransfer = true;
  let allowClipboard = true;

  let countdown = 30;
  let timer = setInterval(() => {
    countdown--;
    if (countdown <= 0) {
      clearInterval(timer);
      dispatch('reject');
    }
  }, 1000);

  function accept() {
    clearInterval(timer);
    dispatch('accept', {
      allow_control: allowControl,
      allow_file_transfer: allowFileTransfer,
      allow_clipboard: allowClipboard,
    });
  }

  function reject() {
    clearInterval(timer);
    dispatch('reject');
  }
</script>

<div class="overlay">
  <div class="modal">
    <div class="header">
      <div class="icon">🔔</div>
      <div>
        <div class="title">Demande de connexion</div>
        <div class="subtitle">Expire dans {countdown}s</div>
      </div>
    </div>

    <div class="requester">
      <div class="avatar">{request.fromName[0]?.toUpperCase()}</div>
      <div>
        <div class="name">{request.fromName}</div>
        <div class="id">ID: {request.fromId}</div>
      </div>
    </div>

    <div class="permissions">
      <div class="perm-title">Autoriser :</div>

      <label class="perm-row">
        <input type="checkbox" bind:checked={allowControl} />
        <div class="perm-info">
          <span class="perm-name">🖱️ Contrôle total</span>
          <span class="perm-desc">Souris, clavier, écran</span>
        </div>
      </label>

      <label class="perm-row">
        <input type="checkbox" bind:checked={allowFileTransfer} />
        <div class="perm-info">
          <span class="perm-name">📁 Transfert de fichiers</span>
          <span class="perm-desc">Envoyer et recevoir des fichiers</span>
        </div>
      </label>

      <label class="perm-row">
        <input type="checkbox" bind:checked={allowClipboard} />
        <div class="perm-info">
          <span class="perm-name">📋 Presse-papier</span>
          <span class="perm-desc">Partage bidirectionnel</span>
        </div>
      </label>
    </div>

    <div class="actions">
      <button class="btn reject" on:click={reject}>Refuser</button>
      <button class="btn accept" on:click={accept}>Accepter</button>
    </div>

    <div class="progress-bar">
      <div class="progress" style="width: {(countdown / 30) * 100}%"></div>
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
    backdrop-filter: blur(4px);
  }

  .modal {
    background: #1e293b;
    border: 1px solid #334155;
    border-radius: 20px;
    padding: 28px;
    width: 360px;
    box-shadow: 0 25px 50px rgba(0,0,0,0.5);
    animation: slideIn 0.2s ease-out;
  }

  @keyframes slideIn {
    from { transform: translateY(-20px); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
  }

  .header {
    display: flex;
    align-items: center;
    gap: 14px;
    margin-bottom: 20px;
  }

  .icon { font-size: 32px; }

  .title {
    font-size: 18px;
    font-weight: 700;
    color: #f1f5f9;
  }

  .subtitle {
    font-size: 12px;
    color: #f59e0b;
    margin-top: 2px;
  }

  .requester {
    display: flex;
    align-items: center;
    gap: 14px;
    background: #0f172a;
    border-radius: 12px;
    padding: 14px;
    margin-bottom: 20px;
  }

  .avatar {
    width: 44px; height: 44px;
    background: #6366f1;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 20px;
    font-weight: 700;
    color: white;
    flex-shrink: 0;
  }

  .name { font-size: 16px; font-weight: 600; color: #f1f5f9; }
  .id { font-size: 12px; color: #64748b; margin-top: 2px; }

  .permissions { margin-bottom: 24px; }
  .perm-title {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #64748b;
    margin-bottom: 10px;
  }

  .perm-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 0;
    cursor: pointer;
    border-bottom: 1px solid #1e293b;
  }
  .perm-row:last-child { border-bottom: none; }

  input[type="checkbox"] {
    width: 18px; height: 18px;
    accent-color: #6366f1;
    cursor: pointer;
  }

  .perm-name { font-size: 14px; font-weight: 500; color: #f1f5f9; display: block; }
  .perm-desc { font-size: 12px; color: #64748b; margin-top: 1px; display: block; }

  .actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin-bottom: 12px;
  }

  .btn {
    padding: 12px;
    border-radius: 10px;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    border: none;
    transition: all 0.15s;
  }

  .reject {
    background: #1e293b;
    color: #94a3b8;
    border: 1px solid #334155;
  }
  .reject:hover { background: #ef4444; color: white; border-color: #ef4444; }

  .accept {
    background: #22c55e;
    color: white;
  }
  .accept:hover { background: #16a34a; }

  .progress-bar {
    height: 3px;
    background: #1e293b;
    border-radius: 2px;
    overflow: hidden;
  }

  .progress {
    height: 100%;
    background: #f59e0b;
    transition: width 1s linear;
  }
</style>
