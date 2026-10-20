// With output: "export", a dynamic route must generate at least one page. An
// empty list gets a placeholder whose page is the 404 page.
export const PLACEHOLDER = "_";

export function staticParams<K extends string>(key: K, values: string[]): Record<K, string>[] {
  return (values.length > 0 ? values : [PLACEHOLDER]).map((v) => ({ [key]: v }) as Record<K, string>);
}
