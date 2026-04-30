import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import { fmtCurrency, fmtPctSigned } from '../utils/format'



const COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f59e0b', '#10b981', '#3b82f6', '#14b8a6', '#64748b']

export default function SectorDonut({ data }) {
  if (!data || data.length === 0) {
    return (
      <div className="card p-6 flex items-center justify-center h-64 text-sm text-gray-500">
        No sector data available.
      </div>
    )
  }

  // Filter out zero-weight sectors
  const chartData = data.filter((d) => d.weight > 0)

  const CustomTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null
    const { sector, weight, market_value } = payload[0].payload
    return (
      <div className="card px-3 py-2 text-xs shadow-xl border border-surface-border">
        <p className="text-gray-300 font-semibold mb-1">{sector}</p>
        <p className="text-white num">{fmtCurrency(market_value)}</p>
        <p className="text-gray-400 num">{(weight * 100).toFixed(1)}%</p>
      </div>
    )
  }

  return (
    <div className="card p-5 space-y-3 h-full flex flex-col">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
        Sector Allocation
      </h3>
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height={240}>
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              innerRadius={60}
              outerRadius={80}
              paddingAngle={2}
              dataKey="weight"
              stroke="none"
            >
              {chartData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      
      {/* Legend */}
      <div className="grid grid-cols-2 gap-2 mt-4 px-2">
        {chartData.slice(0, 6).map((entry, idx) => (
          <div key={entry.sector} className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 truncate pr-2">
              <span 
                className="w-2.5 h-2.5 rounded-full shrink-0" 
                style={{ backgroundColor: COLORS[idx % COLORS.length] }}
              />
              <span className="text-gray-300 truncate" title={entry.sector}>{entry.sector}</span>
            </div>
            <span className="text-gray-500 num shrink-0">{(entry.weight * 100).toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}
