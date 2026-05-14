import React from 'react';
import { motion } from 'motion/react';
import { Image as ImageIcon } from 'lucide-react';

type Props = {
  onLogin: () => void;
};

export default function LoginScreen({ onLogin }: Props) {
  return (
    <div className="h-screen w-screen flex items-center justify-center bg-[#050505] text-white p-6 overflow-hidden relative">
      <div className="absolute top-[-100px] left-[-100px] w-[500px] h-[500px] rounded-full bg-indigo-600/10 blur-[120px]" />
      <div className="absolute bottom-[-150px] right-[-100px] w-[600px] h-[600px] rounded-full bg-cyan-400/5 blur-[150px]" />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-panel max-w-md w-full p-8 text-center relative z-10 border-white/5"
      >
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-cyan-400 to-indigo-500 mx-auto flex items-center justify-center font-bold text-3xl shadow-2xl mb-8">
          S
        </div>
        <h1 className="text-3xl font-bold tracking-tight mb-2 uppercase italic">
          Synthesis <span className="text-cyan-400">AI</span>
        </h1>
        <p className="text-white/40 text-[10px] uppercase tracking-[0.3em] mb-8">
          พอร์ทัลสิทธิ์การใช้งานโรงเรียน
        </p>

        <button
          onClick={onLogin}
          className="w-full py-4 bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl flex items-center justify-center gap-3 transition-all group active:scale-95"
        >
          <ImageIcon className="text-cyan-400 opacity-50 group-hover:opacity-100 transition-opacity" />
          <span className="text-sm font-medium tracking-widest uppercase">เข้าสู่ระบบด้วย Gmail โรงเรียน</span>
        </button>

        <p className="mt-8 text-[9px] text-white/20 uppercase tracking-widest italic">
          ปกป้องโดย Rayongwit.ac.th Neural Shield
        </p>
      </motion.div>
    </div>
  );
}

