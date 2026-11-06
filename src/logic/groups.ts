/**
 * iNaturalist sorts every sighting into an "iconic taxon" (the export's
 * iconic_taxon_name column). These are the values it uses, in the order the
 * report lists them, with plain names for a landowner.
 */
export const GROUPS = [
  { id: "Aves", label: "Birds" },
  { id: "Mammalia", label: "Mammals" },
  { id: "Reptilia", label: "Reptiles" },
  { id: "Amphibia", label: "Amphibians" },
  { id: "Actinopterygii", label: "Fish" },
  { id: "Insecta", label: "Insects" },
  { id: "Arachnida", label: "Spiders and other arachnids" },
  { id: "Mollusca", label: "Snails, slugs and other molluscs" },
  { id: "Animalia", label: "Other animals" },
  { id: "Plantae", label: "Plants" },
  { id: "Fungi", label: "Fungi and lichens" },
  { id: "Chromista", label: "Seaweeds, water molds and kin" },
  { id: "Protozoa", label: "Slime molds and other protozoa" },
  { id: "", label: "Group not known" },
] as const;

export type GroupId = (typeof GROUPS)[number]["id"];

const ORDER = new Map<string, number>(GROUPS.map((g, i) => [g.id, i]));
const LABEL = new Map<string, string>(GROUPS.map((g) => [g.id, g.label]));

export function groupOrder(id: string): number {
  return ORDER.get(id) ?? ORDER.get("")!;
}

export function groupLabel(id: string): string {
  return LABEL.get(id) ?? LABEL.get("")!;
}

/** Normalises an iconic taxon name ("aves", " Aves ") to a known group id, or "" if unknown. */
export function toGroupId(name: string): GroupId {
  const t = name.trim().toLowerCase();
  const hit = GROUPS.find((g) => g.id.toLowerCase() === t);
  return hit ? hit.id : "";
}

/**
 * When the file has no iconic_taxon_name column, work the group out from the
 * "Taxon Extras" columns (kingdom, phylum, class), if those were exported.
 */
export function groupFromRanks(rec: Record<string, string>): GroupId {
  const cls = toGroupId(rec["taxon_class_name"] ?? "");
  if (cls && ["Aves", "Mammalia", "Reptilia", "Amphibia", "Actinopterygii", "Insecta", "Arachnida"].includes(cls)) return cls;
  if ((rec["taxon_phylum_name"] ?? "").trim().toLowerCase() === "mollusca") return "Mollusca";
  const kingdom = toGroupId(rec["taxon_kingdom_name"] ?? "");
  if (kingdom && ["Animalia", "Plantae", "Fungi", "Chromista", "Protozoa"].includes(kingdom)) return kingdom;
  return "";
}
