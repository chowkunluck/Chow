import React from 'react';
import { motion } from 'motion/react';
import { Brain, ChevronRight, MessageSquare, Sparkles, User as UserIcon } from 'lucide-react';

type Props = {
  chatMessages: any[];
  isTyping: boolean;
  pendingMessage: string;
  onPendingMessageChange: (v: string) => void;
  onSend: () => void;
  chatEndRef: React.RefObject<HTMLDivElement>;
  latestScan: any;
};

export default function TutorTab({
  chatMessages,
  isTyping,
  pendingMessage,
  onPendingMessageChange,
  onSend,
  chatEndRef,
  latestScan
}: Props) {
  return (
    <div className="flex-1 glass-panel flex flex-col overflow-hidden relative">
      <div className="dot-grid" />
      <div className="relative z-10 flex flex-col h-full p-6">
        <header className="border-b border-white/5 pb-6 mb-6 flex justify-between items-center -mx-6 -mt-6 p-6 bg-black/20 rounded-t-[32px] backdrop-blur-3xl">
          <div>
            <h3 className="text-xs uppercase font-black tracking-[0.3em] italic text-white/90">
              Socratic Scaffolding Engine
            </h3>
            <p className="text-[10px] text-cyan-400/60 italic uppercase tracking-wider font-bold mt-1">
              {latestScan?.topic ? `Active Scan: ${latestScan.topic}` : 'Active Scan: None'}
            </p>
          </div>
          <div className="flex gap-2">
            <span className="px-4 py-2 bg-cyan-400/10 text-cyan-400 border border-cyan-400/30 text-[9px] rounded-2xl uppercase font-black tracking-widest shadow-lg shadow-cyan-400/5">
              สถานะ: พร้อมใช้งาน
            </span>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto space-y-6 mb-4 pr-2 custom-scrollbar">
          {chatMessages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full opacity-20 gap-4">
              <Brain size={48} className="animate-pulse" />
              <p className="text-[10px] uppercase font-black tracking-[0.4em] italic text-center leading-loose">
                เริ่มใช้งานติวเตอร์โดยอัปโหลด
                <br />
                รูปสแกนในแท็บศูนย์การเติบโต
              </p>
            </div>
          )}

          {chatMessages.map((m, idx) => (
            <motion.div
              key={idx}
              initial={{ opacity: 0, x: m.role === 'user' ? 20 : -20 }}
              animate={{ opacity: 1, x: 0 }}
              className={`flex gap-4 ${m.role === 'user' ? 'flex-row-reverse' : ''} max-w-[90%] ${
                m.role === 'user' ? 'ml-auto' : ''
              }`}
            >
              <div
                className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 border ${
                  m.role === 'user'
                    ? 'bg-indigo-500/10 border-indigo-500/30'
                    : 'bg-cyan-400/10 border-cyan-400/30 shadow-2xl'
                }`}
              >
                {m.role === 'user' ? (
                  <UserIcon size={18} className="text-indigo-400" />
                ) : (
                  <Sparkles size={18} className="text-cyan-400" />
                )}
              </div>
              <div
                className={`rounded-3xl p-5 border shadow-2xl backdrop-blur-3xl ${
                  m.role === 'user'
                    ? 'bg-white/5 border-white/10 rounded-tr-none'
                    : 'bg-white/5 border-white/20 rounded-tl-none relative'
                }`}
              >
                {m.role === 'model' && (
                  <div className="absolute top-2 right-4 opacity-5">
                    <Brain size={48} />
                  </div>
                )}
                <p className="text-sm leading-relaxed text-white/80 font-medium whitespace-pre-wrap">
                  {m.content}
                </p>
                <div className={`mt-4 pt-4 border-t border-white/5 flex items-center justify-between ${m.role === 'user' ? 'hidden' : ''}`}>
                  <span className="text-[10px] text-cyan-400/60 uppercase tracking-widest font-black font-mono italic">
                    Scaffolding: Synchronized
                  </span>
                  <span className="text-[9px] text-white/20 uppercase font-bold tracking-tighter">
                    Verified by RW-Neural
                  </span>
                </div>
              </div>
            </motion.div>
          ))}

          {isTyping && (
            <div className="flex gap-4 max-w-[90%]">
              <div className="w-10 h-10 rounded-2xl bg-cyan-400/10 flex items-center justify-center shrink-0 border border-cyan-400/30">
                <Sparkles size={18} className="text-cyan-400 animate-pulse" />
              </div>
              <div className="bg-white/5 rounded-3xl rounded-tl-none p-5 border border-white/20 flex gap-1">
                <motion.div
                  animate={{ opacity: [0.2, 1, 0.2] }}
                  transition={{ repeat: Infinity, duration: 1 }}
                  className="w-1.5 h-1.5 rounded-full bg-cyan-400"
                />
                <motion.div
                  animate={{ opacity: [0.2, 1, 0.2] }}
                  transition={{ repeat: Infinity, duration: 1, delay: 0.2 }}
                  className="w-1.5 h-1.5 rounded-full bg-cyan-400"
                />
                <motion.div
                  animate={{ opacity: [0.2, 1, 0.2] }}
                  transition={{ repeat: Infinity, duration: 1, delay: 0.4 }}
                  className="w-1.5 h-1.5 rounded-full bg-cyan-400"
                />
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        <div className="mt-auto flex items-center gap-3 bg-[#0a0a0a] rounded-[28px] p-2 border border-white/5 focus-within:border-cyan-400/40 shadow-2xl transition-all group backdrop-blur-3xl">
          <div className="w-10 h-10 rounded-full flex items-center justify-center text-white/10 group-focus-within:text-cyan-400 transition-colors">
            <MessageSquare size={20} />
          </div>
          <input
            type="text"
            value={pendingMessage}
            onChange={(e) => onPendingMessageChange(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onSend()}
            placeholder="พิมพ์คำถามหรือข้อความ..."
            className="flex-1 bg-transparent border-none outline-none px-2 text-sm text-white placeholder:text-white/10 tracking-widest font-medium"
          />
          <button
            onClick={onSend}
            disabled={!pendingMessage.trim() || isTyping}
            className="w-10 h-10 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center shadow-lg shadow-indigo-600/20 transition-all active:scale-95 disabled:opacity-20 disabled:grayscale"
          >
            <ChevronRight size={20} />
          </button>
        </div>
      </div>
    </div>
  );
}

