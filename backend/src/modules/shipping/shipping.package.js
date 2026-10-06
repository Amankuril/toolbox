import { Product } from '#modules/products/product.model.js';

const MAX_SIDE_CM = 500;

/**
 * Package weight and size, computed from the products' own shipping data in the database
 * (never from client input). Items are assumed stacked in one box: the box takes the largest
 * footprint and the summed height. Products without data fall back to the admin's default package.
 *
 * @param {{ product: any, quantity: number }[]} lines
 * @param {{ weightGrams: number, lengthCm: number, widthCm: number, heightCm: number }} fallback
 */
export async function computePackage(lines, fallback) {
  const products = await Product.find({ _id: { $in: lines.map((l) => l.product) } }, 'shipping').lean();
  const byId = new Map(products.map((p) => [String(p._id), p.shipping ?? {}]));

  let weightGrams = 0;
  let lengthCm = 0;
  let widthCm = 0;
  let heightCm = 0;
  for (const line of lines) {
    const s = byId.get(String(line.product)) ?? {};
    const unitGrams = s.weightKg > 0 ? s.weightKg * 1000 : fallback.weightGrams;
    weightGrams += unitGrams * line.quantity;
    lengthCm = Math.max(lengthCm, s.lengthCm > 0 ? s.lengthCm : fallback.lengthCm);
    widthCm = Math.max(widthCm, s.widthCm > 0 ? s.widthCm : fallback.widthCm);
    heightCm += (s.heightCm > 0 ? s.heightCm : fallback.heightCm) * line.quantity;
  }

  const side = (v) => Math.min(MAX_SIDE_CM, Math.max(1, Math.ceil(v)));
  return { weightGrams: Math.max(1, Math.ceil(weightGrams)), lengthCm: side(lengthCm), widthCm: side(widthCm), heightCm: side(heightCm) };
}
