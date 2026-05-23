export interface RouteRow {
  pathPattern: string;
  filePath: string;
  line: number;
  component?: string;
}

export interface ComponentUsageRow {
  component: string;
  filePath: string;
  line: number;
}
