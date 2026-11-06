import { groupFromRanks, groupLabel, groupOrder, toGroupId, type GroupId } from "./groups";
import type { Table } from "./csv";

/**
 * Column names come from iNaturalist's own export code (Observation::BASIC_COLUMNS,
 * GEO_COLUMNS, TAXON_COLUMNS and EXTRA_TAXON_COLUMNS in the iNaturalist source).
 * The export page labels each checkbox with exactly these names. The "Taxon
 * Extras" ones (taxon_family_name, taxon_species_name, ...) are unticked by default.
 */
export const COL = {
  scientific: "scientific_name",
  common: "common_name",
  iconic: "iconic_taxon_name",
  quality: "quality_grade",
  observedOn: "observed_on",
  geoprivacy: "geoprivacy",
  taxonGeoprivacy: "taxon_geoprivacy",
  obscured: "coordinates_obscured",
  family: "taxon_family_name",
  species: "taxon_species_name",
} as const;

/** Taxon Extras rank columns, broadest first, used to name the rank of a broad identification. */
const RANKS = [
  "kingdom",
  "phylum",
  "subphylum",
  "superclass",
  "class",
  "subclass",
  "superorder",
  "order",
  "suborder",
  "superfamily",
  "family",
  "subfamily",
  "supertribe",
  "tribe",
  "subtribe",
  "genus",
] as const;

export type Quality = "no-casual" | "research" | "all";

export interface Options {
  /** Include sightings whose location iNaturalist hides (obscured or private). Off by default. */
  includeHidden: boolean;
  /** Which quality grades count. Default leaves out "casual" (planted, captive, no photo or date). */
  quality: Quality;
}

export const DEFAULT_OPTIONS: Options = { includeHidden: false, quality: "no-casual" };

export interface SpeciesRow {
  /** Species-level scientific name, e.g. "Danaus plexippus" (subspecies are folded in). */
  scientific: string;
  common: string;
  family: string;
  group: GroupId;
  sightings: number;
  /** How many of those sightings are research grade (confirmed by the community). */
  research: number;
}

export interface BroadRow {
  /** The broader name the sighting was identified to, e.g. "Bombus" or "Lepidoptera". */
  scientific: string;
  common: string;
  /** "genus", "family", ... when the file says; "" when it can't tell. */
  rank: string;
  family: string;
  group: GroupId;
  sightings: number;
}

export interface GroupCount {
  group: GroupId;
  label: string;
  species: number;
  sightings: number;
}

export interface ColumnCheck {
  missingRequired: boolean;
  /** Helpful columns that aren't in the file, with what the report loses without them. */
  missing: { column: string; effect: string }[];
  /** True when none of the three location-privacy columns are in the file. */
  noPrivacyColumns: boolean;
}

export interface Report {
  columns: ColumnCheck;
  /** Rows in the file. */
  rows: number;
  /** Sightings counted in the report (species-level + broad). */
  counted: number;
  species: SpeciesRow[];
  broad: BroadRow[];
  groups: GroupCount[];
  /** Sightings with no identification at all (counted in `counted`, not listed). */
  unidentified: number;
  /** Left out because iNaturalist hides their location, or the species is sensitive. */
  hiddenLeftOut: number;
  /** Left out by the quality setting. */
  qualityLeftOut: number;
  /** First and last observed_on dates (YYYY-MM-DD) of counted sightings. */
  firstDate: string | null;
  lastDate: string | null;
}

const val = (rec: Record<string, string>, col: string) => (rec[col] ?? "").trim();

export function checkColumns(headers: string[]): ColumnCheck {
  const have = new Set(headers.map((h) => h.trim().toLowerCase()));
  const missing: { column: string; effect: string }[] = [];
  const need = (column: string, effect: string) => {
    if (!have.has(column)) missing.push({ column, effect });
  };
  need(COL.species, "subspecies can't be matched to their species as reliably (the app works it out from the scientific name instead)");
  need(COL.family, "the species list can't be sorted by family");
  need(COL.common, "the list shows scientific names only");
  need(COL.iconic, "sightings can't be sorted into groups like birds and plants (unless the kingdom, phylum and class extras are there)");
  need(COL.quality, "the app can't tell confirmed sightings from planted, captive or unconfirmed ones");
  need(COL.observedOn, "the report can't fill in the date for you");
  const privacy = [COL.geoprivacy, COL.taxonGeoprivacy, COL.obscured];
  for (const c of privacy) need(c, "the app can't tell which sightings iNaturalist keeps hidden");
  return {
    missingRequired: !have.has(COL.scientific) && !have.has(COL.species),
    missing,
    noPrivacyColumns: privacy.every((c) => !have.has(c)),
  };
}

const HIDDEN = new Set(["obscured", "private"]);

/** True when the observer chose to hide this sighting's location. */
export function observerHid(rec: Record<string, string>): boolean {
  return HIDDEN.has(val(rec, COL.geoprivacy).toLowerCase());
}

/**
 * True when iNaturalist hides this sighting's location because of what it is
 * (a threatened or sensitive species). coordinates_obscured is "true" for both
 * reasons, so when the observer didn't choose it, it was the species.
 */
export function speciesIsSensitive(rec: Record<string, string>): boolean {
  if (HIDDEN.has(val(rec, COL.taxonGeoprivacy).toLowerCase())) return true;
  return val(rec, COL.obscured).toLowerCase() === "true" && !observerHid(rec);
}

export function isHidden(rec: Record<string, string>): boolean {
  return observerHid(rec) || speciesIsSensitive(rec);
}

export type Identification =
  | { kind: "species"; name: string }
  | { kind: "broad"; name: string }
  | { kind: "none" };

/**
 * Which species a sighting counts toward. Uses taxon_species_name when the file
 * has it (iNaturalist fills it for species and anything below, like subspecies
 * and varieties). Otherwise the species is the first two words of a scientific
 * name like "Danaus plexippus plexippus". Hybrids ("Quercus × bebbiana") count
 * as their own species-level entry. A one-word name ("Bombus") is a broader group.
 */
export function identify(rec: Record<string, string>, hasSpeciesColumn: boolean): Identification {
  const sci = val(rec, COL.scientific).replace(/\s+/g, " ");
  const isHybrid = /\s×\s|^×/.test(sci);
  if (hasSpeciesColumn) {
    const sp = val(rec, COL.species).replace(/\s+/g, " ");
    if (sp) return { kind: "species", name: sp };
    if (sci && isHybrid) return { kind: "species", name: sci };
    if (sci) return { kind: "broad", name: sci };
    return { kind: "none" };
  }
  if (!sci) return { kind: "none" };
  if (isHybrid) return { kind: "species", name: sci };
  const words = sci.split(" ");
  if (words.length >= 2 && /^[A-Z][a-zë-]+$/.test(words[0]) && /^[a-zë-]+$/.test(words[1])) {
    return { kind: "species", name: `${words[0]} ${words[1]}` };
  }
  return { kind: "broad", name: sci };
}

function groupOf(rec: Record<string, string>): GroupId {
  return toGroupId(val(rec, COL.iconic)) || groupFromRanks(rec);
}

function rankOf(rec: Record<string, string>, name: string): string {
  for (let i = RANKS.length - 1; i >= 0; i--) {
    if (val(rec, `taxon_${RANKS[i]}_name`) === name) return RANKS[i];
  }
  return "";
}

function passesQuality(rec: Record<string, string>, quality: Quality): boolean {
  const q = val(rec, COL.quality).toLowerCase();
  if (quality === "all" || q === "") return true;
  if (quality === "research") return q === "research";
  return q !== "casual";
}

const byName = (a: string, b: string) => a.localeCompare(b, "en", { sensitivity: "base" });

/** Group order, then family (sightings with no family last), then scientific name. */
export function compareRows(a: { group: string; family: string; scientific: string }, b: typeof a): number {
  const g = groupOrder(a.group) - groupOrder(b.group);
  if (g) return g;
  if (a.family !== b.family) {
    if (!a.family) return 1;
    if (!b.family) return -1;
    return byName(a.family, b.family);
  }
  return byName(a.scientific, b.scientific);
}

interface Acc {
  scientific: string;
  common: string;
  commonFromExact: boolean;
  family: string;
  group: GroupId;
  rank: string;
  sightings: number;
  research: number;
}

export function buildReport(table: Table, options: Options = DEFAULT_OPTIONS): Report {
  const columns = checkColumns(table.headers);
  const hasSpecies = table.headers.some((h) => h.trim().toLowerCase() === COL.species);
  const report: Report = {
    columns,
    rows: table.records.length,
    counted: 0,
    species: [],
    broad: [],
    groups: [],
    unidentified: 0,
    hiddenLeftOut: 0,
    qualityLeftOut: 0,
    firstDate: null,
    lastDate: null,
  };
  if (columns.missingRequired) return report;

  const ided = table.records.map((rec) => ({ rec, id: identify(rec, hasSpecies) }));

  // A species iNaturalist treats as sensitive anywhere in the file is left out
  // entirely, so one unhidden sighting can't give away that it grows here.
  const sensitive = new Set<string>();
  if (!options.includeHidden) {
    for (const { rec, id } of ided) {
      if (id.kind !== "none" && speciesIsSensitive(rec)) sensitive.add(`${id.kind}:${id.name}`);
    }
  }

  const species = new Map<string, Acc>();
  const broad = new Map<string, Acc>();

  for (const { rec, id } of ided) {
    if (!options.includeHidden && (isHidden(rec) || (id.kind !== "none" && sensitive.has(`${id.kind}:${id.name}`)))) {
      report.hiddenLeftOut++;
      continue;
    }
    if (!passesQuality(rec, options.quality)) {
      report.qualityLeftOut++;
      continue;
    }
    report.counted++;
    const date = val(rec, COL.observedOn);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      if (!report.firstDate || date < report.firstDate) report.firstDate = date;
      if (!report.lastDate || date > report.lastDate) report.lastDate = date;
    }
    if (id.kind === "none") {
      report.unidentified++;
      continue;
    }
    const map = id.kind === "species" ? species : broad;
    let acc = map.get(id.name);
    if (!acc) {
      acc = {
        scientific: id.name,
        common: "",
        commonFromExact: false,
        family: "",
        group: "",
        rank: id.kind === "broad" ? rankOf(rec, id.name) : "",
        sightings: 0,
        research: 0,
      };
      map.set(id.name, acc);
    }
    acc.sightings++;
    if (val(rec, COL.quality).toLowerCase() === "research") acc.research++;
    if (!acc.family) acc.family = val(rec, COL.family);
    if (!acc.group) acc.group = groupOf(rec);
    if (!acc.rank && id.kind === "broad") acc.rank = rankOf(rec, id.name);
    // The common name belongs to the exact taxon identified, so a subspecies'
    // common name is only used when no sighting names the species itself.
    const common = val(rec, COL.common);
    const exact = val(rec, COL.scientific).replace(/\s+/g, " ") === id.name;
    if (common && (!acc.common || (exact && !acc.commonFromExact))) {
      acc.common = common;
      acc.commonFromExact = exact;
    }
  }

  report.species = [...species.values()]
    .map(({ scientific, common, family, group, sightings, research }) => ({ scientific, common, family, group, sightings, research }))
    .sort(compareRows);
  report.broad = [...broad.values()]
    .map(({ scientific, common, rank, family, group, sightings }) => ({ scientific, common, rank, family, group, sightings }))
    .sort(compareRows);

  const groups = new Map<GroupId, GroupCount>();
  const bump = (group: GroupId, sp: number, n: number) => {
    const g = groups.get(group) ?? { group, label: groupLabel(group), species: 0, sightings: 0 };
    g.species += sp;
    g.sightings += n;
    groups.set(group, g);
  };
  for (const s of report.species) bump(s.group, 1, s.sightings);
  for (const b of report.broad) bump(b.group, 0, b.sightings);
  report.groups = [...groups.values()].sort((a, b) => groupOrder(a.group) - groupOrder(b.group));
  return report;
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "12 October 2026", "12–13 October 2026", "30 September – 1 October 2026", or "" if no dates. */
export function formatDateRange(first: string | null, last: string | null): string {
  if (!first || !last) return "";
  const [y1, m1, d1] = first.split("-").map(Number);
  const [y2, m2, d2] = last.split("-").map(Number);
  if (first === last) return `${d1} ${MONTHS[m1 - 1]} ${y1}`;
  if (y1 === y2 && m1 === m2) return `${d1}–${d2} ${MONTHS[m1 - 1]} ${y1}`;
  if (y1 === y2) return `${d1} ${MONTHS[m1 - 1]} – ${d2} ${MONTHS[m2 - 1]} ${y1}`;
  return `${d1} ${MONTHS[m1 - 1]} ${y1} – ${d2} ${MONTHS[m2 - 1]} ${y2}`;
}
