'use client';

import { useState } from 'react';
import { Monitor, Wifi, Copy, Check } from 'lucide-react';

interface Props {
  myId: string;
  onConnect: (id: string) => void;
  error: string;
}

export default function ConnectScreen({ myId, onConnect, error }: Props) {
  const [targetId, setTargetId] = useState('');
  const [copied, setCopied] = useState(false);

  function handleInput(e: React.ChangeEvent<HTMLInputElement>) {
    // Auto-format as "XXX XXX XXX"
    let val = e.target.value.replace(/\D/g, '').slice(0, 9);
    if (val.length > 6) val = `${val.slice(0,3)} ${val.slice(3,6)} ${val.slice(6)}`;
    else if (val.length > 3) val = `${val.slice(0,3)} ${val.slice(3)}`;
    setTargetId(val);
  }

  function handleConnect(e: React.FormEvent) {
    e.preventDefault();
    if (targetId.replace(/\s/g, '').length === 9) onConnect(targetId);
  }

  function copyId() {
    navigator.clipboard.writeText(myId.replace(/\s/g, ''));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex flex-col items-center justify-center h-full px-4 gap-6">

      {/* Logo */}
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center">
          <Monitor size={22} color="white" />
        </div>
        <span className="text-2xl font-bold text-white">ConnectPro</span>
      </div>

      {/* My ID card */}
      <div className="w-full max-w-sm bg-slate-800 border border-slate-700 rounded-2xl p-6">
        <p className="text-xs uppercase tracking-widest text-slate-400 mb-2 text-center">
          Votre ID
        </p>
        <div className="text-4xl font-black text-indigo-400 text-center tracking-wider tabular-nums mb-4">
          {myId || '--- --- ---'}
        </div>
        <button
          onClick={copyId}
          className="w-full flex items-center justify-center gap-2 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-xl py-2.5 text-sm font-medium transition-colors"
        >
          {copied ? <Check size={16} /> : <Copy size={16} />}
          {copied ? 'Copié !' : 'Copier mon ID'}
        </button>
      </div>

      {/* Connect to remote */}
      <div className="w-full max-w-sm bg-slate-800 border border-slate-700 rounded-2xl p-6">
        <p className="text-xs uppercase tracking-widest text-slate-400 mb-4 text-center">
          Se connecter à
        </p>
        <form onSubmit={handleConnect} className="flex flex-col gap-3">
          <input
            type="text"
            inputMode="numeric"
            placeholder="483 291 734"
            value={targetId}
            onChange={handleInput}
            className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-3 text-center text-xl font-bold text-white tracking-widest placeholder:text-slate-600 focus:outline-none focus:border-indigo-500 transition-colors"
          />
          {error && (
            <p className="text-red-400 text-sm text-center bg-red-950/40 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={targetId.replace(/\s/g,'').length !== 9}
            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-bold py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            <Wifi size={18} />
            Connecter
          </button>
        </form>
      </div>

      <p className="text-xs text-slate-600 text-center max-w-xs">
        Entrez l&apos;ID de l&apos;appareil hôte. La connexion est chiffrée de bout en bout.
      </p>
    </div>
  );
}
