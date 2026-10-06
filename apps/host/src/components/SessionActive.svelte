<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  export let sessionId: string;

  const dispatch = createEventDispatcher();
  let elapsed = 0;
  let timer = setInterval(() => elapsed++, 1000);

  function formatTime(s: number) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return h > 0
      ? `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`
      : `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  }

  function end() {
    clearInterval(timer);
    dispatch('end');
  }
</script>

<div class="session">
  <div class="banner">
    <div class="indicator"></div>
    <div class="info">
      <div class="title">Session active</div>
      <div class="sub">{formatTime(elapsed)} — ID: {sessionId.slice(0,12)}...</div>
    </div>
    <button class="end-btn" on:click={end}>
      ✕ Terminer
    </button>
  </div>

  <div class="body">
    <div class="screen-icon">🖥️</div>
    <p>Votre écran est partagé en ce moment.</p>
    <p class="hint">Cliquez "Terminer" pour arrêter la session.</p>
  </div>
</div>

<style>
  .session {
    height: 100vh;
    display: flex;
    flex-direction: column;
  }

  .banner {
    background: #dc2626;
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 14px 20px;
  }

  .indicator {
    width: 12px; height: 12px;
    border-radius: 50%;
    background: white;
    animation: pulse 1.5s infinite;
    flex-shrink: 0;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }

  .title { font-size: 15px; font-weight: 700; color: white; }
  .sub { font-size: 12px; color: rgba(255,255,255,0.7); margin-top: 2px; }

  .end-btn {
    margin-left: auto;
    background: rgba(255,255,255,0.2);
    color: white;
    border: 1px solid rgba(255,255,255,0.3);
    border-radius: 8px;
    padding: 8px 16px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.2s;
  }
  .end-btn:hover { background: rgba(255,255,255,0.3); }

  .body {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    background: #0f172a;
  }

  .screen-icon { font-size: 56px; }

  p { font-size: 16px; color: #e2e8f0; }
  .hint { font-size: 13px; color: #64748b; }
</style>
