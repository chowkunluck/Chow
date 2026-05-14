import React from 'react';

export default function ConnectingScreen() {
  return (
    <div className="h-screen w-screen flex flex-col items-center justify-center bg-[#050505] text-white gap-4">
      <div className="w-12 h-12 rounded-2xl border-2 border-cyan-400/30 border-t-cyan-400 animate-spin" />
      <p className="text-[10px] uppercase tracking-[0.35em] text-white/40">กำลังเชื่อมต่อบัญชีโรงเรียน…</p>
    </div>
  );
}

