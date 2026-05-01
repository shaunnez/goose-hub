export const GATE_STATES: Record<string, string> = {
  'factory:prd-review': 'PRD Review pending — human approval required',
  'factory:needs-review': 'Code Review pending — human approval required',
  'factory:approved': 'Approved — ready for retrospecting',
  'factory:needs-human': 'Human intervention required',
};
