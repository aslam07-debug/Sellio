import * as XLSX from 'xlsx';
import { csvCell } from './reportData.js';

// This module is imported only by Node route handlers, never by Client Components.
export const makeExportFile = (table, descriptor) => {
  const data = [table.columns, ...table.rows];
  const filename = `sellio-${descriptor.report}-${descriptor.start}-${descriptor.end}.${descriptor.format}`;
  if (descriptor.format === 'csv') {
    // A consistent rectangular CSV: explanatory metadata columns repeat on each report row.
    const metaColumns = table.metadata.map(([key]) => `Метаданные: ${key}`), metaValues = table.metadata.map(([, value]) => value);
    const csvRows = [[...table.columns, ...metaColumns], ...(table.rows.length ? table.rows : [Array(table.columns.length).fill(null)]).map(row => [...row, ...metaValues])];
    return { bytes: '\uFEFF' + csvRows.map(row => row.map(v => csvCell(v === null ? '' : v)).join(',')).join('\r\n'), filename, mime: 'text/csv; charset=utf-8' };
  }
  const book = XLSX.utils.book_new();
  for (const [name, values] of [['Report', data], ['Metadata', [['Поле', 'Значение'], ...table.metadata]]]) {
    const sheet = XLSX.utils.aoa_to_sheet(values);
    for (const [key, cell] of Object.entries(sheet)) {
      if (key.startsWith('!')) continue;
      if (typeof cell.v === 'string') cell.t = 's';
      delete cell.f; delete cell.l;
    }
    XLSX.utils.book_append_sheet(book, sheet, name);
  }
  return { bytes: XLSX.write(book, { type: 'buffer', bookType: 'xlsx', compression: true }), filename, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
};
