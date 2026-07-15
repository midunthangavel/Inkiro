export default function StatCard({ label, value, sub, color = 'text-gray-900' }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5 flex flex-col gap-1">
      <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{label}</span>
      <span className={`text-3xl font-bold ${color}`}>{value}</span>
      {sub && <span className="text-xs text-gray-400">{sub}</span>}
    </div>
  );
}
