export type SymbolKind =
  | 'function'
  | 'class'
  | 'const'
  | 'interface'
  | 'type'
  | 'enum'
  | 'variable';

export interface SymbolRow {
  filePath: string;
  name: string;
  kind: SymbolKind;
  line: number;
  exported: boolean;
}

export interface ImportRow {
  filePath: string;
  sourceModule: string;
  importedName: string;
}
