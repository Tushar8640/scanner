import { DocNameFormat } from '@/core/types';

const pad = (n: number) => String(n).padStart(2, '0');

/** Default name for a new document, following the user's chosen format. */
export function formatDocumentName(format: DocNameFormat, date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const h = pad(date.getHours());
  const min = pad(date.getMinutes());
  switch (format) {
    case 'scan_date':
      return `Scan ${d}-${m}-${y} ${h}.${min}`;
    case 'date_only':
      return `${y}-${m}-${d} ${h}.${min}`;
    case 'doc_datetime':
    default:
      return `Doc_${y}${m}${d}_${h}${min}`;
  }
}
