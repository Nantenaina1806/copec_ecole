/**
 * Normalise une réponse API attendue comme tableau sans masquer une valeur valide.
 * Accepte aussi les enveloppes { rows }, { items } et { data: [] }.
 */
export function toArray(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.rows)) return value.rows;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.data)) return value.data;
  return [];
}
