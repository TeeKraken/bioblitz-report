// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCsv, toTable } from "./logic/csv";
import { buildReport } from "./logic/report";
import { renderReport } from "./render";

const text = readFileSync(resolve(process.cwd(), "public/sample-observations.csv"), "utf8");
const table = toTable(parseCsv(text));
const details = { title: "Willow Bend Farm bioblitz", landowner: "The owners", place: "Willow Bend Farm", date: "", by: "" };

function render(includeHidden = false) {
  const el = document.createElement("article");
  renderReport(el, {
    report: buildReport(table, { includeHidden, quality: "no-casual" }),
    details,
    notable: [{ scientific: "Trillium grandiflorum", note: "On the north slope." }, { scientific: "Panax quinquefolius", note: "Left out" }],
    isSample: true,
  });
  return el;
}

describe("renderReport", () => {
  const el = render();
  const out = el.textContent ?? "";

  it("never shows observer names, usernames, coordinates, places or descriptions from the file", () => {
    for (const rec of table.records) {
      for (const col of ["user_login", "user_name", "latitude", "longitude", "place_guess", "private_place_guess", "description"]) {
        const v = rec[col];
        if (v) expect(out, `${col} "${v}"`).not.toContain(v);
      }
    }
    // Same with sensitive sightings included.
    const all = render(true).textContent ?? "";
    expect(all).not.toMatch(/sample_volunteer|Sample Volunteer|41\.\d{3}|-77\.\d{3}/);
  });

  it("shows the title, the auto date, the plain statement and the left-out count", () => {
    expect(el.querySelector("h2")?.textContent).toBe("Willow Bend Farm bioblitz");
    expect(out).toContain("13–14 June 2026");
    expect(out).toContain("not a professional survey");
    expect(out).toContain("4 sightings were left out to protect sensitive species");
  });

  it("shows notable finds with notes, but never a left-out species", () => {
    const finds = [...el.querySelectorAll(".find")].map((f) => f.textContent);
    expect(finds).toHaveLength(1);
    expect(finds[0]).toContain("Large-flowered Trillium");
    expect(finds[0]).toContain("On the north slope.");
    expect(out).not.toContain("Panax");
    expect(out).not.toContain("Ginseng");
  });

  it("lists species under group headings in group order, with common and scientific names", () => {
    const groups = [...el.querySelectorAll(".group-block h4")].map((h) => h.firstChild?.textContent?.trim());
    expect(groups).toEqual(["Birds", "Mammals", "Reptiles", "Amphibians", "Fish", "Insects", "Spiders and other arachnids", "Snails, slugs and other molluscs", "Other animals", "Plants", "Fungi and lichens"]);
    const robin = [...el.querySelectorAll("tr")].find((tr) => tr.textContent?.includes("American Robin"));
    expect(robin?.querySelector("i")?.textContent).toBe("Turdus migratorius");
  });

  it("lists broad identifications separately, under Other identifications", () => {
    expect(el.querySelector("#r-broad")?.textContent).toBe("Other identifications");
    const broad = el.querySelector(".broad")?.textContent ?? "";
    expect(broad).toContain("Bumble Bees (genus Bombus)");
    expect(broad).toContain("Butterflies and Moths (order Lepidoptera)");
  });

  it("puts text from the file in as text, never as markup", () => {
    const evil = toTable(parseCsv('scientific_name,common_name,taxon_species_name\nTurdus migratorius,<img src=x onerror=alert(1)>,Turdus migratorius\n'));
    const target = document.createElement("article");
    renderReport(target, { report: buildReport(evil), details: { ...details, title: "<b>x</b>" }, notable: [], isSample: false });
    expect(target.querySelector("img")).toBeNull();
    expect(target.querySelector("h2 b")).toBeNull();
    expect(target.textContent).toContain("<img src=x onerror=alert(1)>");
  });
});
