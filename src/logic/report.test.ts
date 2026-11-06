import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCsv, toTable, type Table } from "./csv";
import { buildReport, checkColumns, compareRows, formatDateRange, identify, isHidden } from "./report";

const HEAD = [
  "id",
  "observed_on",
  "user_login",
  "quality_grade",
  "latitude",
  "longitude",
  "geoprivacy",
  "taxon_geoprivacy",
  "coordinates_obscured",
  "scientific_name",
  "common_name",
  "iconic_taxon_name",
  "taxon_family_name",
  "taxon_genus_name",
  "taxon_species_name",
];

type Row = Partial<Record<(typeof HEAD)[number], string>>;

function table(rows: Row[], headers: string[] = HEAD): Table {
  return { headers, records: rows.map((r) => Object.fromEntries(headers.map((h) => [h, (r as Record<string, string>)[h] ?? ""]))) };
}

const robin: Row = { scientific_name: "Turdus migratorius", common_name: "American Robin", iconic_taxon_name: "Aves", taxon_family_name: "Turdidae", taxon_species_name: "Turdus migratorius", quality_grade: "research" };
const monarch: Row = { scientific_name: "Danaus plexippus", common_name: "Monarch", iconic_taxon_name: "Insecta", taxon_family_name: "Nymphalidae", taxon_species_name: "Danaus plexippus", quality_grade: "research" };
const monarchSsp: Row = { scientific_name: "Danaus plexippus plexippus", common_name: "Migratory Monarch", iconic_taxon_name: "Insecta", taxon_family_name: "Nymphalidae", taxon_species_name: "Danaus plexippus", quality_grade: "research" };
const bombus: Row = { scientific_name: "Bombus", common_name: "Bumble Bees", iconic_taxon_name: "Insecta", taxon_family_name: "Apidae", taxon_genus_name: "Bombus", quality_grade: "needs_id" };

describe("identify", () => {
  it("uses taxon_species_name so subspecies fold into their species", () => {
    expect(identify(monarchSsp as Record<string, string>, true)).toEqual({ kind: "species", name: "Danaus plexippus" });
  });
  it("treats a sighting with no species name as a broader group", () => {
    expect(identify({ scientific_name: "Bombus", taxon_species_name: "" }, true)).toEqual({ kind: "broad", name: "Bombus" });
  });
  it("counts a hybrid as its own species-level entry", () => {
    expect(identify({ scientific_name: "Quercus × bebbiana", taxon_species_name: "" }, true)).toEqual({ kind: "species", name: "Quercus × bebbiana" });
  });
  it("works the species out from the scientific name when the extras column is missing", () => {
    expect(identify({ scientific_name: "Danaus plexippus plexippus" }, false)).toEqual({ kind: "species", name: "Danaus plexippus" });
    expect(identify({ scientific_name: "Symphyotrichum novae-angliae" }, false)).toEqual({ kind: "species", name: "Symphyotrichum novae-angliae" });
    expect(identify({ scientific_name: "Lepidoptera" }, false)).toEqual({ kind: "broad", name: "Lepidoptera" });
    expect(identify({ scientific_name: "Bombus (Pyrobombus)" }, false)).toEqual({ kind: "broad", name: "Bombus (Pyrobombus)" });
  });
  it("reports no identification for an empty name", () => {
    expect(identify({ scientific_name: "" }, true)).toEqual({ kind: "none" });
  });
});

describe("buildReport: counting", () => {
  it("counts species once, folding in subspecies, and keeps broad sightings separate", () => {
    const r = buildReport(table([robin, robin, monarch, monarchSsp, bombus, bombus, {}]));
    expect(r.counted).toBe(7);
    expect(r.species.map((s) => [s.scientific, s.sightings])).toEqual([
      ["Turdus migratorius", 2],
      ["Danaus plexippus", 2],
    ]);
    expect(r.broad).toEqual([{ scientific: "Bombus", common: "Bumble Bees", rank: "genus", family: "Apidae", group: "Insecta", sightings: 2 }]);
    expect(r.unidentified).toBe(1);
    expect(r.groups).toEqual([
      { group: "Aves", label: "Birds", species: 1, sightings: 2 },
      { group: "Insecta", label: "Insects", species: 1, sightings: 4 },
    ]);
  });

  it("uses the species' own common name, not a subspecies'", () => {
    expect(buildReport(table([monarchSsp, monarch])).species[0].common).toBe("Monarch");
    // With only the subspecies seen, its common name is better than none.
    expect(buildReport(table([monarchSsp])).species[0].common).toBe("Migratory Monarch");
  });

  it("tracks how many sightings of a species are research grade", () => {
    const r = buildReport(table([{ ...robin, quality_grade: "needs_id" }, robin]));
    expect(r.species[0]).toMatchObject({ sightings: 2, research: 1 });
  });

  it("leaves out casual sightings by default and can count only research grade or everything", () => {
    const rows = [robin, { ...monarch, quality_grade: "needs_id" }, { ...robin, scientific_name: "Felis catus", taxon_species_name: "Felis catus", quality_grade: "casual" }];
    expect(buildReport(table(rows)).counted).toBe(2);
    expect(buildReport(table(rows)).qualityLeftOut).toBe(1);
    expect(buildReport(table(rows), { includeHidden: false, quality: "research" }).counted).toBe(1);
    expect(buildReport(table(rows), { includeHidden: false, quality: "all" }).counted).toBe(3);
  });

  it("records the date range of counted sightings", () => {
    const r = buildReport(table([{ ...robin, observed_on: "2026-06-14" }, { ...robin, observed_on: "2026-06-13" }, { ...robin, observed_on: "not a date" }]));
    expect([r.firstDate, r.lastDate]).toEqual(["2026-06-13", "2026-06-14"]);
  });

  it("works out groups from the kingdom/phylum/class extras when iconic_taxon_name is missing", () => {
    const headers = ["scientific_name", "taxon_kingdom_name", "taxon_phylum_name", "taxon_class_name"];
    const t: Table = {
      headers,
      records: [
        { scientific_name: "Turdus migratorius", taxon_kingdom_name: "Animalia", taxon_phylum_name: "Chordata", taxon_class_name: "Aves" },
        { scientific_name: "Cepaea nemoralis", taxon_kingdom_name: "Animalia", taxon_phylum_name: "Mollusca", taxon_class_name: "Gastropoda" },
        { scientific_name: "Acer saccharum", taxon_kingdom_name: "Plantae", taxon_phylum_name: "Tracheophyta", taxon_class_name: "Magnoliopsida" },
      ],
    };
    expect(buildReport(t).species.map((s) => s.group)).toEqual(["Aves", "Mollusca", "Plantae"]);
  });

  it("returns an empty report when the file has no name columns", () => {
    const r = buildReport({ headers: ["id"], records: [{ id: "1" }] });
    expect(r.columns.missingRequired).toBe(true);
    expect(r.counted).toBe(0);
  });
});

describe("sensitive sightings", () => {
  it("knows hidden sightings from geoprivacy, taxon_geoprivacy or coordinates_obscured", () => {
    expect(isHidden({ geoprivacy: "obscured" })).toBe(true);
    expect(isHidden({ geoprivacy: "private" })).toBe(true);
    expect(isHidden({ taxon_geoprivacy: "obscured" })).toBe(true);
    expect(isHidden({ coordinates_obscured: "true" })).toBe(true);
    expect(isHidden({ geoprivacy: "open", taxon_geoprivacy: "open", coordinates_obscured: "false" })).toBe(false);
    expect(isHidden({})).toBe(false);
  });

  it("leaves hidden sightings out by default and says how many", () => {
    const r = buildReport(table([robin, { ...robin, geoprivacy: "obscured", coordinates_obscured: "true" }, { ...monarch, geoprivacy: "private" }]));
    expect(r.hiddenLeftOut).toBe(2);
    expect(r.counted).toBe(1);
    expect(r.species.map((s) => s.scientific)).toEqual(["Turdus migratorius"]);
  });

  it("leaves out every sighting of a sensitive species, even one that isn't hidden", () => {
    const ginseng: Row = { scientific_name: "Panax quinquefolius", iconic_taxon_name: "Plantae", taxon_species_name: "Panax quinquefolius", quality_grade: "research" };
    const r = buildReport(table([robin, { ...ginseng, taxon_geoprivacy: "obscured", coordinates_obscured: "true" }, ginseng]));
    expect(r.species.map((s) => s.scientific)).toEqual(["Turdus migratorius"]);
    expect(r.hiddenLeftOut).toBe(2);
  });

  it("doesn't sweep out a whole species because one observer hid their own sighting", () => {
    const r = buildReport(table([robin, { ...robin, geoprivacy: "obscured", coordinates_obscured: "true" }]));
    expect(r.species[0].sightings).toBe(1);
    expect(r.hiddenLeftOut).toBe(1);
  });

  it("includes them when asked", () => {
    const r = buildReport(table([robin, { ...robin, geoprivacy: "obscured" }]), { includeHidden: true, quality: "no-casual" });
    expect(r.hiddenLeftOut).toBe(0);
    expect(r.species[0].sightings).toBe(2);
  });

  it("flags a file without any privacy columns", () => {
    expect(checkColumns(["scientific_name"]).noPrivacyColumns).toBe(true);
    expect(checkColumns(["scientific_name", "geoprivacy"]).noPrivacyColumns).toBe(false);
  });
});

describe("sorting", () => {
  it("sorts by group, then family (none last), then scientific name", () => {
    const rows = [
      { group: "Plantae", family: "Fagaceae", scientific: "Quercus rubra" },
      { group: "Plantae", family: "", scientific: "Aaa" },
      { group: "Aves", family: "Turdidae", scientific: "Turdus migratorius" },
      { group: "Plantae", family: "Fagaceae", scientific: "Quercus alba" },
      { group: "", family: "", scientific: "Mystery" },
      { group: "Plantae", family: "Asteraceae", scientific: "Solidago canadensis" },
    ];
    expect(rows.sort(compareRows).map((r) => r.scientific)).toEqual(["Turdus migratorius", "Solidago canadensis", "Quercus alba", "Quercus rubra", "Aaa", "Mystery"]);
  });

  it("lists species in that order in the report", () => {
    const oak: Row = { scientific_name: "Quercus alba", iconic_taxon_name: "Plantae", taxon_family_name: "Fagaceae", taxon_species_name: "Quercus alba", quality_grade: "research" };
    const r = buildReport(table([oak, monarch, robin]));
    expect(r.species.map((s) => s.group)).toEqual(["Aves", "Insecta", "Plantae"]);
  });
});

describe("formatDateRange", () => {
  it("formats one day, a range in a month, across months and across years", () => {
    expect(formatDateRange("2026-06-13", "2026-06-13")).toBe("13 June 2026");
    expect(formatDateRange("2026-06-13", "2026-06-14")).toBe("13–14 June 2026");
    expect(formatDateRange("2026-09-30", "2026-10-01")).toBe("30 September – 1 October 2026");
    expect(formatDateRange("2026-12-31", "2027-01-01")).toBe("31 December 2026 – 1 January 2027");
    expect(formatDateRange(null, null)).toBe("");
  });
});

describe("the sample file", () => {
  const sample = toTable(parseCsv(readFileSync(new URL("../../public/sample-observations.csv", import.meta.url), "utf8")));
  const r = buildReport(sample);

  it("has every column the app reads", () => {
    expect(r.columns.missing).toEqual([]);
  });

  it("gives the expected totals", () => {
    expect(r.rows).toBe(63);
    expect(r.hiddenLeftOut).toBe(4); // two ginseng (sensitive species), one obscured cardinal, one private deer
    expect(r.qualityLeftOut).toBe(2); // a pet cat and garden hostas
    expect(r.species.some((s) => s.scientific === "Panax quinquefolius")).toBe(false);
    expect(r.species.find((s) => s.scientific === "Danaus plexippus")?.sightings).toBe(3);
    expect(r.species.find((s) => s.scientific === "Buteo jamaicensis")?.sightings).toBe(2);
    expect(r.broad.map((b) => b.scientific).sort()).toEqual(["Bombus", "Carex", "Lepidoptera"]);
    expect(r.unidentified).toBe(1);
    expect(r.counted).toBe(63 - 4 - 2);
    expect(r.counted).toBe(r.species.reduce((n, s) => n + s.sightings, 0) + r.broad.reduce((n, b) => n + b.sightings, 0) + r.unidentified);
  });
});
