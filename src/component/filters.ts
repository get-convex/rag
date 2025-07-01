import {
  type GenericId,
  type Infer,
  v,
  type Value,
  type VAny,
  type VArray,
  type VId,
} from "convex/values";

export const vFilterFieldValue = v.array(v.any()) as unknown as VArray<
  [GenericId<"namespaces">, Value],
  VId<"namespaces"> | VAny
>;
export type FilterFieldValue = Infer<typeof vFilterFieldValue>;

export const filterFieldNames = [
  "filter0" as const,
  "filter1" as const,
  "filter2" as const,
  "filter3" as const,
];
export type NamedFilterField = {
  [K in (typeof filterFieldNames)[number]]?: FilterFieldValue;
};

export type NumberedFilter = Record<number, Value>;

export const vAllFilterFields = {
  namespaceId: v.id("namespaces"),
  filter0: v.optional(vFilterFieldValue),
  filter1: v.optional(vFilterFieldValue),
  filter2: v.optional(vFilterFieldValue),
  filter3: v.optional(vFilterFieldValue),
};

export const allFilterFieldNames = [
  "namespaceId" as const,
  ...filterFieldNames,
];

export const vNamedFilter = v.object({
  name: v.string(),
  value: v.any(),
});

export type NamedFilter<K extends string = string, V = Value> = {
  name: K;
  value: V;
};

/**
 * { 1: "foo", 2: "bar" }
 *   -> { filter1: ["namespace", "foo"], filter2: ["namespace", "bar"] }
 */
export function filterFieldsFromNumbers(
  namespaceId: GenericId<"namespaces">,
  filters: NumberedFilter | undefined
): NamedFilterField {
  const filterFields: NamedFilterField = {};
  if (!filters) return filterFields;
  for (const [i, filter] of Object.entries(filters)) {
    const index = Number(i);
    if (isNaN(index) || index < 0 || index >= filterFieldNames.length) {
      console.warn(
        `Unknown filter index: ${index} for value ${JSON.stringify(filter)}`
      );
      break;
    }
    filterFields[filterFieldNames[index]] = [namespaceId, filter];
  }
  return filterFields;
}

/**
 * [{ name: "Foo", value: "foo" }, { name: "Baz", value: "baz" }]
 *   -> { 0: "foo", 2: "baz" }
 */
export function numberedFilterFromNamedFilters(
  namedFilters: Array<{ name: string; value: Value }>,
  filterNames: string[]
): NumberedFilter {
  const numberedFilter: NumberedFilter = {};
  for (const namedFilter of namedFilters) {
    const index = filterNames.indexOf(namedFilter.name);
    if (index === -1) {
      throw new Error(
        `Unknown filter name: ${namedFilter.name} for namespace with names ${filterNames.join(
          ", "
        )}`
      );
    }
    numberedFilter[index] = namedFilter.value;
  }
  return numberedFilter;
}

/**
 * [{ name: "Foo", value: "foo" }, { name: "Baz", value: "baz" }]
 *   -> [{ 0: "foo" }, { 2: "baz" }]
 */
export function numberedFiltersFromNamedFilters(
  filters: NamedFilter[],
  filterNames: string[]
): Array<NumberedFilter> {
  const filterFields: Array<NumberedFilter> = [];
  for (const filter of filters) {
    const index = filterNames.indexOf(filter.name);
    if (index === -1) {
      throw new Error(
        `Unknown filter name: ${filter.name} for namespace with names ${filterNames.join(
          ", "
        )}`
      );
    }
    filterFields.push({ [index]: filter.value });
  }
  return filterFields;
}
