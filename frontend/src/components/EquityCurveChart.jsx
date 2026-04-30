import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { useMemo } from 'react'

/**
 * EquityCurveChart.jsx
 * --------------------
 * Line chart comparing normalized portfolio performance against a benchmark.
 * 
 * @param {object} props
 * @param {Array<{ date: string, portfolio_value: number, benchmark_value: number }>} props.data
 */
export default function EquityCurveChart({ data }) {
  if (!data || data.length === 0) {
    return (
      <div className="card p-6 flex flex-col items-center justify-center h-72 text-center">
        <svg className="w-8 h-8 text-gray-700 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
        </svg>
        <p className="text-sm text-gray-500">
          Equity curve data not available. Run a price refresh.
        </p>
      </div>
    )
  }

  const chartData = useMemo(() => {
    return data.map(d => ({
      ...d,
      displayDate: new Date(d.date).toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
    }))
  }, [data])

  return (
    <div className="card p-5 space-y-4">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
        Historical Performance (Base 100) vs S&P 500
      </h3>
      <p className="text-xs text-gray-400">
        Hypothetical backwards performance assuming your current holdings and weights were held continuously.
      </p>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
            <XAxis 
              dataKey="displayDate" 
              tick={{ fill: '#64748b', fontSize: 12 }} 
              axisLine={false} 
              tickLine={false}
              minTickGap={30}
            />
            <YAxis 
              tick={{ fill: '#64748b', fontSize: 12 }} 
              axisLine={false} 
              tickLine={false}
              domain={['auto', 'auto']}
            />
            <Tooltip 
              contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
              itemStyle={{ fontSize: '13px' }}
              labelStyle={{ color: '#94a3b8', fontSize: '12px', marginBottom: '4px' }}
            />
            <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
            <Line 
              name="Portfolio"
              type="monotone" 
              dataKey="portfolio_value" 
              stroke="#6366f1" 
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
            <Line 
              name="S&P 500 (^GSPC)"
              type="monotone" 
              dataKey="benchmark_value" 
              stroke="#10b981" 
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
