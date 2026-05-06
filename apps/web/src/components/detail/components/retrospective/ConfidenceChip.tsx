import { CONFIDENCE_COLOR, type Confidence } from '../../lib/retrospective';

export function ConfidenceChip({ confidence }: { confidence: Confidence }) {
  return (
    <span
      className={`text-[10px] font-medium uppercase px-1.5 py-0.5 rounded ${CONFIDENCE_COLOR[confidence]}`}
    >
      {confidence}
    </span>
  );
}
