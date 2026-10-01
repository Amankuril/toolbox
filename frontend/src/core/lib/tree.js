/**
 * Flattens a nested category tree into depth-first rows with a readable path,
 * e.g. "Power Tools › Drills & Drivers › Impact Drills".
 */
export function flattenTree(nodes, depth = 0, trail = []) {
  return (nodes ?? []).flatMap((n) => {
    const path = [...trail, n.name]
    return [{ ...n, depth, path: path.join(' › ') }, ...flattenTree(n.children, depth + 1, path)]
  })
}

/** Builds a nested tree from a flat list with `parent` ids (vendor category list). */
export function buildTree(rows) {
  const byId = new Map(rows.map((r) => [String(r._id), { ...r, children: [] }]))
  const roots = []
  for (const node of byId.values()) {
    const parent = node.parent && byId.get(String(node.parent?._id ?? node.parent))
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  return roots
}
