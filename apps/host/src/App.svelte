<script lang="ts">
  import { onMount } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { listen } from '@tauri-apps/api/event';
  import IncomingRequest from './components/IncomingRequest.svelte';
  import SessionActive from './components/SessionActive.svelte';
  import HomePanel from './components/HomePanel.svelte';

  type SessionState =
    | { type: 'Idle' }
    | { type: 'WaitingApproval'; from_id: string; from_name: string }
    | { type: 'Active'; session_id: string; controller_id: string };

  let deviceInfo: { device_id: string; hostname: string; os: string } | null = null;
  let sessionState: SessionState = { type: 'Idle' };
  let pendingRequest: { requestId: string; fromId: string; fromName: string } | null = null;

  onMount(async () => {
    deviceInfo = await invoke('get_device_info');

    // Listen for incoming connection request → show popup
    await listen('incoming-request', (event: any) => {
      pendingRequest = event.payload;
    });

    // Listen for session accepted
    await listen('session-accepted', (event: any) => {
      pendingRequest = null;
      sessionState = {
        type: 'Active',
        session_id: event.payload.session_id,
        controller_id: '',
      };
    });

    // Listen for session ended
    await listen('session-ended', () => {
      sessionState = { type: 'Idle' };
      pendingRequest = null;
    });
  });

  async function acceptRequest(permissions: any) {
    if (!pendingRequest) return;
    await invoke('accept_connection', {
      requestId: pendingRequest.requestId,
      permissions,
    });
  }

  async function rejectRequest() {
    if (!pendingRequest) return;
    await invoke('reject_connection', { requestId: pendingRequest.requestId });
    pendingRequest = null;
  }

  async function endSession() {
    await invoke('end_session');
    sessionState = { type: 'Idle' };
  }
</script>

<main class="app">
  {#if pendingRequest}
    <IncomingRequest
      request={pendingRequest}
      on:accept={(e) => acceptRequest(e.detail)}
      on:reject={rejectRequest}
    />
  {:else if sessionState.type === 'Active'}
    <SessionActive
      sessionId={sessionState.session_id}
      on:end={endSession}
    />
  {:else}
    <HomePanel {deviceInfo} />
  {/if}
</main>

<style>
  :global(*) { box-sizing: border-box; margin: 0; padding: 0; }
  :global(body) {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: #0f172a;
    color: #f1f5f9;
    height: 100vh;
    overflow: hidden;
  }
  .app {
    width: 100%;
    height: 100vh;
  }
</style>
