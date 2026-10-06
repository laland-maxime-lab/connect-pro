'use client';

import { Loader2 } from 'lucide-react';

interface Props {
  targetName: string;
  targetId: string;
  onCancel: () => void;
}

export default function WaitingScreen({ targetName, targetId, onCancel }: Props) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 px-4">
      <div className="bg-slate-800 border border-slate-700 rounded-2xl p-8 w-full max-w-sm text-center">
        <Loader2 size={40} className="text-indigo-400 animate-spin mx-auto mb-4" />
        <h2 className="text-lg font-bold text-white mb-1">En attente d&apos;approbation</h2>
        <p className="text-slate-400 text-sm mb-4">
          Demande envoyée à <span className="text-white font-semibold">{targetName}</span>
          <br />
          <span className="text-indigo-400 font-mono">{targetId}</span>
        </p>
        <p className="text-slate-500 text-xs mb-6">
          L&apos;hôte doit accepter la connexion sur son appareil.
        </p>
        <button
          onClick={onCancel}
          className="w-full bg-slate-700 hover:bg-slate-600 text-slate-200 font-medium py-2.5 rounded-xl transition-colors"
        >
          Annuler
        </button>
      </div>
    </div>
  );
}
