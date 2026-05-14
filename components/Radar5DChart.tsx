import React from 'react';
import {
  Radar as RechartsRadar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  ResponsiveContainer
} from 'recharts';

export type RadarDatum = {
  subject: string;
  value: number;
  full?: number;
};

type Props = {
  data: RadarDatum[];
  name?: string;
  /** Fixes "width(0) and height(0)" console warnings by giving the container a real height. */
  heightPx?: number;
};

export default function Radar5DChart({ data, name = 'Student', heightPx = 260 }: Props) {
  return (
    <div style={{ width: '100%', height: heightPx }}>
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart cx="50%" cy="50%" outerRadius="80%" data={data}>
          <PolarGrid stroke="rgba(34,211,238,0.1)" />
          <PolarAngleAxis
            dataKey="subject"
            tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 9, fontWeight: 700 }}
          />
          <RechartsRadar
            name={name}
            dataKey="value"
            stroke="#22d3ee"
            fill="#22d3ee"
            fillOpacity={0.2}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}

