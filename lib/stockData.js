export const LOW_STOCK_THRESHOLD = 5;
export const MAX_UNITS = 1000000000;
export const MAX_PRICE = 1000000000000;
export const validUnits = value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= MAX_UNITS;
export const validPrice = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_PRICE;
export const validStockVersion = value => typeof value === 'string' && value.length <= 100 && /^(?:\d{4}|[+-]\d{6})-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
export const stockDto = row => {
  const base = validUnits(row.base_stock) ? row.base_stock : null;
  const sold = validUnits(row.sold_since_base) ? row.sold_since_base : null;
  const balance = base !== null && sold !== null ? base - sold : null;
  return { id: String(row.id), storeId: String(row.store_id), sku: typeof row.sku === 'string' ? row.sku : null,
    model: typeof row.model === 'string' ? row.model : null, base, sold, balance,
    price: validPrice(row.price) ? row.price : null, available: typeof row.available === 'boolean' ? row.available : null,
    updatedAt: validStockVersion(row.updated_at) ? row.updated_at : null,
    low: balance !== null && balance <= LOW_STOCK_THRESHOLD,
    percent: balance !== null && base > 0 ? Math.round(Math.max(0, Math.min(100, balance / base * 100))) : null };
};
