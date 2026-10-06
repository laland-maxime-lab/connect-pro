'use client';

import { useEffect, useRef, useState, RefObject, useCallback } from 'react';
import {
  X, Wifi, WifiOff, Zap, Maximize2, Minimize2,
  MessageSquare, FolderUp, Clipboard, Signal
} from 'lucide-react';
import clsx from 'clsx';

interface Props {
  sessionId: string;
  partnerName: string;
  permissions: { allowControl: boolean; allowFileTransfer: boolean; allowClipboard: boolean };
  connState: string;
  latency: number;
  videoRef: RefObject<HTMLVideoElement | null>;
  onVideoReady: (canvas: HTMLCanvasElement, w: number, h: number) => void;
  onEnd: () => void;
  sendInput: (e: object) => void;
}

export default function SessionView({
  sessionId, partnerName, permissions,
  connState, latency, videoRef,
  onVideoReady, onEnd, sendInput,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number>(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [showToolbar, setShowToolbar] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const [quality, setQuality] = useState<'original' | 'balanced' | 'low'>('balanced');

  // Draw video frames to canvas
  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    function draw() {
      if (video && canvas && ctx && !video.paused && !video.ended) {
        canvas.width = video.videoWidth || canvas.offsetWidth;
        canvas.height = video.videoHeight || canvas.offsetHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      }
      animRef.current = requestAnimationFrame(draw);
    }

    video.onplay = () => {
      draw();
      if (canvas) {
        onVideoReady(canvas, video.videoWidth, video.videoHeight);
      }
    };

    return () => cancelAnimationFrame(animRef.current);
  }, [videoRef, onVideoReady]);

  // Session timer
  useEffect(() => {
    const t = setInterval(() => setElapsed(s => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // Auto-hide toolbar after 3s
  useEffect(() => {
    if (!fullscreen) return;
    const t = setTimeout(() => setShowToolbar(false), 3000);
    return () => clearTimeout(t);
  }, [fullscreen, showToolbar]);

  function formatTime(s: number) {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  }

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen();
      setFullscreen(true);
    } else {
      document.exitFullscreen();
      setFullscreen(false);
    }
    setShowToolbar(true);
  }

  async function pasteClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      sendInput({ type: 'clipboard_sync', content: text });
    } catch { /* permission denied */ }
  }

  const stateColor = {
    connecting: 'text-yellow-400',
    connected: 'text-green-400',
    relay: 'text-orange-400',
    failed: 'text-red-400',
  }[connState] || 'text-slate-400';

  const stateLabel = {
    connecting: 'Connexion...',
    connected: 'P2P Direct',
    relay: 'Via relais',
    failed: 'Déconnecté',
  }[connState] || connState;

  return (
    <div
      ref={containerRef}
      className="relative w-full h-screen bg-black overflow-hidden"
      onMouseMove={() => { if (fullscreen) setShowToolbar(true); }}
    >
      {/* Hidden video element — used as source for canvas */}
      <video
        ref={videoRef as RefObject<HTMLVideoElement>}
        className="hidden"
        playsInline
        muted
        autoPlay
      />

      {/* Canvas — renders the remote screen */}
      <canvas
        ref={canvasRef}
        className="w-full h-full object-contain"
        style={{ cursor: 'none', touchAction: 'none' }}
      />

      {/* Top toolbar */}
      <div
        className={clsx(
          'absolute top-0 left-0 right-0 flex items-center gap-3 px-4 py-3',
          'bg-gradient-to-b from-black/80 to-transparent transition-opacity duration-300',
          fullscreen && !showToolbar ? 'opacity-0 pointer-events-none' : 'opacity-100',
        )}
      >
        {/* Partner name */}
        <div className="flex items-center gap-2 flex-1">
          <div className="w-7 h-7 bg-indigo-600 rounded-lg flex items-center justify-center text-xs font-bold text-white">
            {partnerName[0]?.toUpperCase()}
          </div>
          <div>
            <div className="text-white text-sm font-semibold leading-none">{partnerName}</div>
            <div className="text-slate-400 text-xs">{formatTime(elapsed)}</div>
          </div>
        </div>

        {/* Connection status */}
        <div className={clsx('flex items-center gap-1.5 text-xs font-medium', stateColor)}>
          <Signal size={13} />
          <span>{stateLabel}</span>
          {connState === 'connected' && (
            <span className="text-slate-500">· {latency}ms</span>
          )}
        </div>

        {/* Quality selector */}
        <select
          value={quality}
          onChange={e => {
            setQuality(e.target.value as any);
            sendInput({ type: 'set_quality', quality: e.target.value });
          }}
          className="bg-slate-800/80 text-slate-300 text-xs rounded-lg px-2 py-1 border border-slate-700 focus:outline-none"
        >
          <option value="original">Original</option>
          <option value="balanced">Équilibré</option>
          <option value="low">Faible débit</option>
        </select>

        {/* Actions */}
        {permissions.allowClipboard && (
          <button
            onClick={pasteClipboard}
            title="Envoyer le presse-papier"
            className="p-2 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 transition-colors"
          >
            <Clipboard size={16} />
          </button>
        )}

        <button
          onClick={toggleFullscreen}
          className="p-2 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 transition-colors"
        >
          {fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </button>

        <button
          onClick={onEnd}
          className="flex items-center gap-1.5 bg-red-600 hover:bg-red-500 text-white text-xs font-semibold px-3 py-2 rounded-lg transition-colors"
        >
          <X size={14} />
          Terminer
        </button>
      </div>

      {/* Connecting overlay */}
      {connState === 'connecting' && (
        <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-3">
          <div className="w-10 h-10 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-white font-medium">Connexion au flux vidéo...</p>
          <p className="text-slate-400 text-sm">Négociation WebRTC P2P en cours</p>
        </div>
      )}

      {/* Relay badge */}
      {connState === 'relay' && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-orange-900/80 border border-orange-700 rounded-full px-4 py-1.5 text-orange-300 text-xs flex items-center gap-2">
          <WifiOff size={12} />
          P2P indisponible — relais actif (latence plus élevée)
        </div>
      )}
    </div>
  );
}
