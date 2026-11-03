import { Product } from '#modules/products/product.model.js';

const MAX_SIDE_CM = 500;
const side = (v) => Math.min(MAX_SIDE_CM, Math.max(1, Math.ceil(v)));

/**
 * The boxes one unit of a product ships in: its own box list when it goes in parts (2+ boxes), else one
 * box from the single package fields, with the admin's default package filling any gaps.
 */
function boxesOf(product, variantWeightKg, fallback) {
  const s = product?.shipping ?? {};
  if (s.boxes?.length > 1) {
    return s.boxes.map((b) => ({ weightGrams: b.weightKg * 1000, lengthCm: b.lengthCm, widthCm: b.widthCm, heightCm: b.heightCm }));
  }
  // A variant's own weight wins over the product's.
  const weightKg = variantWeightKg > 0 ? variantWeightKg : s.weightKg;
  return [
    {
      weightGrams: weightKg > 0 ? weightKg * 1000 : fallback.weightGrams,
      lengthCm: s.lengthCm > 0 ? s.lengthCm : fallback.lengthCm,
      widthCm: s.widthCm > 0 ? s.widthCm : fallback.widthCm,
      heightCm: s.heightCm > 0 ? s.heightCm : fallback.heightCm,
    },
  ];
}

/**
 * Package weight and size, computed from the products' own shipping data in the database
 * (never from client input). Products that ship in parts count every box.
 *
 * Returns the total weight, a single envelope for APIs that take one size (the largest footprint and
 * the summed heights, as if stacked), and `boxes`: identical boxes grouped with a count, for rate
 * quotes that price each box.
 *
 * @param {{ product: any, quantity: number, variant?: { id: any } }[]} lines
 * @param {{ weightGrams: number, lengthCm: number, widthCm: number, heightCm: number }} fallback
 */
export async function computePackage(lines, fallback) {
  const products = await Product.find({ _id: { $in: lines.map((l) => l.product) } }, 'shipping variants._id variants.weightKg').lean();
  const byId = new Map(products.map((p) => [String(p._id), p]));

  let weightGrams = 0;
  let lengthCm = 0;
  let widthCm = 0;
  let heightCm = 0;
  const groups = new Map();
  for (const line of lines) {
    const product = byId.get(String(line.product));
    const variantWeight = product?.variants?.find((v) => String(v._id) === String(line.variant?.id))?.weightKg;
    for (const box of boxesOf(product, variantWeight, fallback)) {
      weightGrams += box.weightGrams * line.quantity;
      lengthCm = Math.max(lengthCm, box.lengthCm);
      widthCm = Math.max(widthCm, box.widthCm);
      heightCm += box.heightCm * line.quantity;
      const dims = { lengthCm: side(box.lengthCm), widthCm: side(box.widthCm), heightCm: side(box.heightCm) };
      const key = `${dims.lengthCm}x${dims.widthCm}x${dims.heightCm}`;
      const g = groups.get(key) ?? { ...dims, count: 0 };
      g.count += line.quantity;
      groups.set(key, g);
    }
  }

  const boxes = [...groups.values()];
  return {
    weightGrams: Math.max(1, Math.ceil(weightGrams)),
    lengthCm: side(lengthCm),
    widthCm: side(widthCm),
    heightCm: side(heightCm),
    boxCount: boxes.reduce((n, b) => n + b.count, 0),
    boxes,
  };
}
