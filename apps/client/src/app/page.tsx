'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { connectSocket, disconnectSocket } from '@/lib/signaling';
import { WebRTCClient } from '@/lib/webrtc';
import { InputSender } from '@/lib/inputSender';
import ConnectScreen from '@/components/ConnectScreen';
import SessionView from '@/components/SessionView';
import WaitingScreen from '@/components/WaitingScreen';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

type AppState =
  | { phase: 'connect' }
  | { phase: 'waiting'; requestId: string; targetName: string; targetId: string }
  | { phase: 'session'; sessionId: string; partnerName: string; permissions: any };

// ─────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────

export default function Home() {
  const [state, setState] = useState<AppState>({ phase: 'connect' });
  const [myId, setMyId] = useState<string>('');
  const [connState, setConnState] = useState<string>('connecting');
  const [latency, setLatency] = useState<number>(0);
  const [error, setError] = useState<string>('');

  const webrtcRef = useRef<WebRTCClient | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const inputRef = useRef<InputSender | null>(null);
  const sessionIdRef = useRef<string>('');
  const myIdRef = useRef<string>('');

  // ── Init Socket.IO ─────────────────────────

  useEffect(() => {
    const socket = connectSocket();

    // Register as a browser device
    socket.on('connect', () => {
      const storedId = localStorage.getItem('connectpro_device_id') || '';
      socket.emit('register-device', {
        deviceId: storedId,
        name: navigator.platform || 'Browser',
        os: 'browser',
        version: '2.0.0',
      });
    });

    socket.on('registered', (data: any) => {
      const id = data.deviceId;
      myIdRef.current = id;
      setMyId(data.displayId || formatId(id));
      localStorage.setItem('connectpro_device_id', id);
    });

    // Controller receives these after host accepts
    socket.on('session-started', async (data: any) => {
      sessionIdRef.current = data.sessionId;
      setState({
        phase: 'session',
        sessionId: data.sessionId,
        partnerName: data.partnerName,
        permissions: data.permissions,
      });
      setConnState('connecting');

      // Start WebRTC as initiator (controller always initiates)
      const client = new WebRTCClient({
        sessionId: data.sessionId,
        myDeviceId: myIdRef.current,
        partnerDeviceId: data.partnerDeviceId,
        onRemoteStream: (stream) => {
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            videoRef.current.play().catch(() => {});
          }
        },
        onConnectionState: setConnState,
        onLatency: setLatency,
        sendSignal: (payload) => socket.emit('webrtc-signal', payload),
        sendRelay: (d) => socket.emit('relay-data', { sessionId: sessionIdRef.current, data: d }),
      });

      webrtcRef.current = client;
      await client.initiate();
    });

    // WebRTC signals from host
    socket.on('webrtc-signal', (payload: any) => {
      webrtcRef.current?.handleSignal(payload);
    });

    // Relay data (fallback)
    socket.on('relay-data', ({ data }: any) => {
      webrtcRef.current?.handleRelay(data);
    });

    // Connection rejected by host
    socket.on('connection-rejected', ({ reason }: any) => {
      setError(reason || 'Connexion refusée.');
      setState({ phase: 'connect' });
    });

    // Connection error
    socket.on('connection-error', ({ message }: any) => {
      setError(message);
      setState({ phase: 'connect' });
    });

    // Session ended by host
    socket.on('session-ended', () => {
      endSession();
    });

    return () => {
      disconnectSocket();
    };
  }, []);

  // ── Connect to a device ────────────────────

  const connect = useCallback((targetId: string) => {
    setError('');
    const socket = connectSocket();
    socket.emit('request-connection', {
      targetId: targetId.replace(/\s/g, ''),
      mode: 'full_control',
    });

    socket.once('connection-request-pending', (data: any) => {
      setState({
        phase: 'waiting',
        requestId: data.requestId,
        targetName: data.targetName,
        targetId: data.targetId,
      });
    });
  }, []);

  // ── End session ────────────────────────────

  const endSession = useCallback(() => {
    if (sessionIdRef.current) {
      connectSocket().emit('end-session', { sessionId: sessionIdRef.current });
    }
    webrtcRef.current?.cleanup();
    webrtcRef.current = null;
    inputRef.current?.destroy();
    inputRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    sessionIdRef.current = '';
    setState({ phase: 'connect' });
  }, []);

  // ── Setup InputSender once video plays ────

  const onVideoPlay = useCallback((canvas: HTMLCanvasElement, remoteW: number, remoteH: number) => {
    inputRef.current?.destroy();
    inputRef.current = new InputSender({
      canvas,
      remoteWidth: remoteW,
      remoteHeight: remoteH,
      send: (event) => webrtcRef.current?.sendInput(event),
    });
  }, []);

  // ─────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────

  return (
    <main className="w-full h-screen overflow-hidden bg-slate-900">
      {state.phase === 'connect' && (
        <ConnectScreen myId={myId} onConnect={connect} error={error} />
      )}

      {state.phase === 'waiting' && (
        <WaitingScreen
          targetName={state.targetName}
          targetId={state.targetId}
          onCancel={() => setState({ phase: 'connect' })}
        />
      )}

      {state.phase === 'session' && (
        <SessionView
          sessionId={state.sessionId}
          partnerName={state.partnerName}
          permissions={state.permissions}
          connState={connState}
          latency={latency}
          videoRef={videoRef}
          onVideoReady={onVideoPlay}
          onEnd={endSession}
          sendInput={(e) => webrtcRef.current?.sendInput(e)}
        />
      )}
    </main>
  );
}

function formatId(id: string): string {
  if (id.length === 9) return `${id.slice(0,3)} ${id.slice(3,6)} ${id.slice(6,9)}`;
  return id;
}
