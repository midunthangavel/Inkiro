const COLORS = {
  pending:   'bg-yellow-100 text-yellow-800',
  accepted:  'bg-blue-100 text-blue-800',
  picked_up: 'bg-purple-100 text-purple-800',
  delivered: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-700',
  declined:  'bg-gray-100 text-gray-600',
  expired:   'bg-red-50 text-red-400',
  default:   'bg-gray-100 text-gray-600',
};

export default function Badge({ status }) {
  const cls = COLORS[status] || COLORS.default;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize ${cls}`}>
      {status}
    </span>
  );
}
