import React from 'react';
import { TrendingUp, Workflow, Target } from 'lucide-react';
import Radar5DChart, { type RadarDatum } from './Radar5DChart';

type Props = {
  latestScan: any;
  userName?: string;
};

export default function RoadmapTab({ latestScan, userName }: Props) {
  const radarData: RadarDatum[] = latestScan
    ? [
        { subject: 'Logic (TIMSS)', value: latestScan.dimensions?.logic ?? 0 },
        { subject: 'Literacy (PISA)', value: latestScan.dimensions?.literacy ?? 0 },
        { subject: 'Precision (Common Core)', value: latestScan.dimensions?.precision ?? 0 },
        { subject: 'Higher-order (Bloom)', value: latestScan.dimensions?.higherOrder ?? 0 },
        { subject: 'Synthesis', value: latestScan.dimensions?.synthesis ?? 0 }
      ]
    : [
        { subject: 'Logic (TIMSS)', value: 0, full: 100 },
        { subject: 'Literacy (PISA)', value: 0, full: 100 },
        { subject: 'Precision (Common Core)', value: 0, full: 100 },
        { subject: 'Higher-order (Bloom)', value: 0, full: 100 },
        { subject: 'Synthesis', value: 0, full: 100 }
      ];

  return (
    <div className="flex-1 glass-panel flex flex-col overflow-hidden relative p-6">
      <div className="dot-grid opacity-[0.03]" />

      <header className="relative z-10 mb-6 flex items-center justify-between">
        <div>
          <h3 className="text-xs uppercase font-black tracking-[0.3em] italic text-white/90 flex items-center gap-2">
            <Target size={14} className="text-cyan-400" /> Career Roadmap
          </h3>
          <p className="text-[10px] text-white/30 uppercase tracking-wider font-bold mt-1">
            Based on latest scan{latestScan?.topic ? `: ${latestScan.topic}` : ''}
          </p>
        </div>
        <span className="px-4 py-2 bg-cyan-400/10 text-cyan-400 border border-cyan-400/30 text-[9px] rounded-2xl uppercase font-black tracking-widest shadow-lg shadow-cyan-400/5">
          {latestScan ? 'LIVE' : 'NO DATA'}
        </span>
      </header>

      <div className="relative z-10 grid grid-cols-2 gap-6 flex-1 min-h-0">
        <div className="bg-black/40 rounded-3xl border border-white/5 p-4 flex flex-col overflow-hidden shadow-inner">
          <h4 className="text-[10px] text-white/20 uppercase mb-4 font-bold tracking-widest italic">
            5-D Snapshot
          </h4>
          <Radar5DChart data={radarData} name={userName || 'Student'} heightPx={260} />
        </div>

        <div className="space-y-4 overflow-y-auto pr-1 flex flex-col custom-scrollbar">
          <div className="p-4 bg-white/5 rounded-2xl border-l-[3px] border-indigo-500/60 backdrop-blur-2xl">
            <h5 className="text-[10px] text-indigo-400 uppercase font-black mb-2 flex items-center gap-2 tracking-[0.2em]">
              <Workflow size={12} /> Neural Trace Insight
            </h5>
            <p className="text-[11px] text-white/70 leading-relaxed uppercase tracking-tight italic">
              {latestScan?.prerequisiteCorrelation || 'ยังไม่มีข้อมูลจากการสแกนล่าสุด'}
            </p>
          </div>

          <div className="p-4 bg-white/5 rounded-2xl border-l-[3px] border-cyan-500/60 backdrop-blur-2xl">
            <h5 className="text-[10px] text-cyan-400 uppercase font-black mb-2 flex items-center gap-2 tracking-[0.2em]">
              <TrendingUp size={12} /> Temporal Trajectory
            </h5>
            <p className="text-[11px] text-white/70 leading-relaxed uppercase tracking-tight italic font-medium">
              {latestScan?.careerInsight || 'ยังไม่มีข้อมูลเส้นทางอาชีพจากการสแกนล่าสุด'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

