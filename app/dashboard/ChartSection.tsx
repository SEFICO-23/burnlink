"use client";

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

interface DayData {
  day: string;
  clicks: number;
  joins: number;
}

export default function ChartSection({ data }: { data: DayData[] }) {
  if (data.length === 0) return null;

  return (
    <section>
      <h2 className="text-sm uppercase tracking-wide text-muted mb-3">Last 30 days</h2>
      <div className="bg-panel border border-border rounded-xl p-4 md:p-6">
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={data}>
            <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" />
            <XAxis
              dataKey="day"
              tick={{ fill: "var(--color-muted)", fontSize: 11 }}
              tickFormatter={(v: string) => {
                const d = new Date(v);
                return `${d.getMonth() + 1}/${d.getDate()}`;
              }}
              stroke="var(--color-border)"
            />
            <YAxis
              tick={{ fill: "var(--color-muted)", fontSize: 11 }}
              stroke="var(--color-border)"
              allowDecimals={false}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "var(--color-panel)",
                border: "1px solid var(--color-border)",
                borderRadius: 8,
                color: "var(--color-text)",
                fontSize: 12,
              }}
              labelFormatter={(v) => new Date(String(v)).toLocaleDateString()}
            />
            <Line
              type="monotone"
              dataKey="clicks"
              stroke="var(--color-muted)"
              strokeWidth={2}
              dot={false}
              name="Clicks"
            />
            <Line
              type="monotone"
              dataKey="joins"
              stroke="var(--color-accent)"
              strokeWidth={2}
              dot={false}
              name="Joins"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
