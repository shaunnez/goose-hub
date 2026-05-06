import { Minus, TrendingDown, TrendingUp } from 'lucide-react';
import type { QualityScore } from '../../lib/retrospective';

export function TrendIcon({ trend }: { trend: QualityScore['trend'] }) {
  if (trend === 'improving') return <TrendingUp size={13} className="text-green-500" />;
  if (trend === 'declining') return <TrendingDown size={13} className="text-red-400" />;
  return <Minus size={13} className="text-fg-3" />;
}
