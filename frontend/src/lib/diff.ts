import type { JSONContent } from '@sirpefoffice/shared';

export interface DiffBlock {
  kind: 'same' | 'added' | 'removed';
  text: string;
}

function plainText(node: JSONContent): string {
  if (node.text) return node.text;
  return (node.content ?? []).map(plainText).join('');
}

/** Extrae los bloques de nivel superior como texto comparable. */
export function extractBlocks(content: JSONContent | null | undefined): string[] {
  const blocks: string[] = [];

  for (const node of content?.content ?? []) {
    switch (node.type) {
      case 'table': {
        const rows = (node.content ?? []).map((row) =>
          (row.content ?? []).map((cell) => plainText(cell).trim()).join(' | '),
        );
        blocks.push(rows.join('\n'));
        break;
      }
      case 'bulletList':
      case 'orderedList': {
        for (const item of node.content ?? []) blocks.push(`• ${plainText(item)}`);
        break;
      }
      case 'horizontalRule':
        blocks.push('———');
        break;
      case 'image':
        blocks.push('[imagen]');
        break;
      default: {
        const text = plainText(node).trim();
        if (text) blocks.push(text);
      }
    }
  }

  return blocks;
}

/**
 * Diff por bloques (LCS). Suficiente para revisar cambios entre versiones y
 * mucho más barato que comparar nodo a nodo con ProseMirror.
 */
export function diffBlocks(
  before: JSONContent | null | undefined,
  after: JSONContent | null | undefined,
): DiffBlock[] {
  const a = extractBlocks(before);
  const b = extractBlocks(after);

  const n = a.length;
  const m = b.length;

  // Protección para documentos enormes
  if (n * m > 400_000) {
    return [
      ...a.map((text) => ({ kind: 'removed' as const, text })),
      ...b.map((text) => ({ kind: 'added' as const, text })),
    ];
  }

  const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));

  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      const row = table[i]!;
      const nextRow = table[i + 1]!;
      row[j] = a[i] === b[j] ? nextRow[j + 1]! + 1 : Math.max(nextRow[j]!, row[j + 1]!);
    }
  }

  const result: DiffBlock[] = [];
  let i = 0;
  let j = 0;

  while (i < n && j < m) {
    if (a[i] === b[j]) {
      result.push({ kind: 'same', text: a[i]! });
      i += 1;
      j += 1;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      result.push({ kind: 'removed', text: a[i]! });
      i += 1;
    } else {
      result.push({ kind: 'added', text: b[j]! });
      j += 1;
    }
  }

  while (i < n) {
    result.push({ kind: 'removed', text: a[i]! });
    i += 1;
  }
  while (j < m) {
    result.push({ kind: 'added', text: b[j]! });
    j += 1;
  }

  return result;
}

export function diffStats(blocks: DiffBlock[]): { added: number; removed: number } {
  return blocks.reduce(
    (acc, block) => {
      if (block.kind === 'added') acc.added += 1;
      if (block.kind === 'removed') acc.removed += 1;
      return acc;
    },
    { added: 0, removed: 0 },
  );
}
