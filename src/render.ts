import { groupLabel } from "./logic/groups";
import { formatDateRange, type Report, type SpeciesRow } from "./logic/report";

export interface Details {
  title: string;
  landowner: string;
  place: string;
  date: string;
  by: string;
}

type Child = Node | string | null | false | undefined;

/** Creates an element. Text is always set as text, never as HTML. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const c of children) {
    if (c === null || c === false || c === undefined) continue;
    el.append(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return el;
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en")} ${n === 1 ? one : many}`;

function sciName(name: string): HTMLElement {
  return h("i", { class: "sci" }, name);
}

function unconfirmedMark(row: SpeciesRow, show: boolean): Child {
  if (!show || row.research > 0) return null;
  return h("span", { class: "mark", title: "Not yet confirmed" }, "*");
}

export interface RenderInput {
  report: Report;
  details: Details;
  /** Species picked as notable finds, in the order they were picked, with notes. */
  notable: { scientific: string; note: string }[];
  isSample: boolean;
}

export function renderReport(target: HTMLElement, { report, details, notable, isSample }: RenderInput): void {
  const hasQuality = !report.columns.missing.some((m) => m.column === "quality_grade");
  const anyUnconfirmed = hasQuality && report.species.some((s) => s.research === 0);
  const title = details.title.trim() || "Bioblitz nature report";
  const date = details.date.trim() || formatDateRange(report.firstDate, report.lastDate);

  const meta = h("dl", { class: "meta" });
  const addMeta = (label: string, value: string) => {
    if (value.trim()) meta.append(h("div", {}, h("dt", {}, label), h("dd", {}, value.trim())));
  };
  addMeta("Prepared for", details.landowner);
  addMeta("Place", details.place);
  addMeta("Date", date);
  addMeta("Prepared by", details.by);

  const groupsTable = h(
    "table",
    { class: "groups" },
    h("caption", { class: "visually-hidden" }, "Species and sightings by group"),
    h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Group"), h("th", { scope: "col", class: "num" }, "Species"), h("th", { scope: "col", class: "num" }, "Sightings"))),
    h(
      "tbody",
      {},
      ...report.groups.map((g) =>
        h("tr", {}, h("th", { scope: "row" }, g.label), h("td", { class: "num" }, g.species.toLocaleString("en")), h("td", { class: "num" }, g.sightings.toLocaleString("en"))),
      ),
    ),
  );

  const bySci = new Map(report.species.map((s) => [s.scientific, s]));
  const finds = notable.filter((n) => bySci.has(n.scientific));

  const sections: Child[] = [];

  if (isSample) {
    sections.push(h("p", { class: "sample-flag" }, "Sample report, made from made-up sightings."));
  }

  sections.push(
    h("header", { class: "r-head" }, h("p", { class: "kicker" }, "Nature report"), h("h2", { class: "r-title" }, title), meta.childElementCount ? meta : null),
    h(
      "p",
      { class: "disclaimer" },
      "This report lists what volunteers saw and recorded on iNaturalist during the bioblitz. It is not a professional survey: many plants and animals that live here weren't seen, and some identifications may change as more people check them.",
    ),
  );

  sections.push(
    h(
      "section",
      { class: "r-section numbers", "aria-labelledby": "r-numbers" },
      h("h3", { id: "r-numbers" }, "The numbers"),
      h(
        "div",
        { class: "stats" },
        h("p", { class: "stat" }, h("span", { class: "stat-n" }, report.species.length.toLocaleString("en")), h("span", { class: "stat-l" }, "species")),
        h("p", { class: "stat" }, h("span", { class: "stat-n" }, report.counted.toLocaleString("en")), h("span", { class: "stat-l" }, report.counted === 1 ? "sighting" : "sightings")),
        h("p", { class: "stat" }, h("span", { class: "stat-n" }, report.groups.length.toLocaleString("en")), h("span", { class: "stat-l" }, report.groups.length === 1 ? "group" : "groups")),
      ),
      report.groups.length ? groupsTable : null,
      report.broad.length || report.unidentified
        ? h(
            "p",
            { class: "small" },
            [
              report.broad.length
                ? `${plural(report.broad.reduce((n, b) => n + b.sightings, 0), "sighting was", "sightings were")} identified only to a broader group, like a genus or family. They're listed after the species and not counted as extra species.`
                : "",
              report.unidentified ? `${plural(report.unidentified, "sighting is", "sightings are")} still waiting for an identification.` : "",
            ]
              .filter(Boolean)
              .join(" "),
          )
        : null,
    ),
  );

  if (finds.length) {
    sections.push(
      h(
        "section",
        { class: "r-section finds", "aria-labelledby": "r-finds" },
        h("h3", { id: "r-finds" }, "Notable finds"),
        h(
          "ul",
          { class: "find-list" },
          ...finds.map((f) => {
            const s = bySci.get(f.scientific)!;
            return h(
              "li",
              { class: "find" },
              h("p", { class: "find-name" }, s.common ? h("b", {}, s.common) : null, s.common ? " " : null, sciName(s.scientific), unconfirmedMark(s, hasQuality)),
              h("p", { class: "find-group" }, `${groupLabel(s.group)}${s.family ? ` · ${s.family}` : ""} · ${plural(s.sightings, "sighting", "sightings")}`),
              f.note.trim() ? h("p", { class: "find-note" }, f.note.trim()) : null,
            );
          }),
        ),
      ),
    );
  }

  // Full species list, grouped. Rows arrive sorted by group, family, name.
  const list = h("section", { class: "r-section list", "aria-labelledby": "r-list" }, h("h3", { id: "r-list" }, "All species seen"));
  if (!report.species.length) list.append(h("p", {}, "No sightings were identified to species."));
  let i = 0;
  while (i < report.species.length) {
    const group = report.species[i].group;
    const rows: SpeciesRow[] = [];
    while (i < report.species.length && report.species[i].group === group) rows.push(report.species[i++]);
    const gid = `r-g-${group || "unknown"}`;
    list.append(
      h(
        "div",
        { class: "group-block" },
        h("h4", { id: gid }, `${groupLabel(group)} `, h("span", { class: "count" }, `(${plural(rows.length, "species", "species")})`)),
        h(
          "table",
          { class: "species", "aria-labelledby": gid },
          h(
            "thead",
            {},
            h("tr", {}, h("th", { scope: "col" }, "Family"), h("th", { scope: "col" }, "Common name"), h("th", { scope: "col" }, "Scientific name"), h("th", { scope: "col", class: "num" }, "Sightings")),
          ),
          h(
            "tbody",
            {},
            ...rows.map((s, idx) =>
              h(
                "tr",
                {},
                h("td", { class: "fam" }, idx > 0 && rows[idx - 1].family === s.family ? "" : s.family),
                h("td", { class: "cn" }, s.common),
                h("td", { class: "sn" }, sciName(s.scientific), unconfirmedMark(s, hasQuality)),
                h("td", { class: "num" }, s.sightings.toLocaleString("en")),
              ),
            ),
          ),
        ),
      ),
    );
  }
  if (anyUnconfirmed) {
    list.append(h("p", { class: "small" }, "* Not yet confirmed: no other iNaturalist user has agreed with the identification yet."));
  }
  sections.push(list);

  if (report.broad.length) {
    sections.push(
      h(
        "section",
        { class: "r-section broad", "aria-labelledby": "r-broad" },
        h("h3", { id: "r-broad" }, "Also seen, identified only to a broader group"),
        h("p", { class: "small" }, "These might be species already on the list above, or different ones. They aren't counted as extra species."),
        h(
          "table",
          { class: "species broad-table" },
          h("caption", { class: "visually-hidden" }, "Sightings identified to a broader group"),
          h(
            "thead",
            {},
            h("tr", {}, h("th", { scope: "col" }, "Group"), h("th", { scope: "col" }, "Identified as"), h("th", { scope: "col", class: "num" }, "Sightings")),
          ),
          h(
            "tbody",
            {},
            ...report.broad.map((b) =>
              h(
                "tr",
                {},
                h("td", { class: "fam" }, groupLabel(b.group)),
                h("td", { class: "cn" }, b.common ? `${b.common} ` : "", "(", b.rank ? `${b.rank} ` : "", sciName(b.scientific), ")"),
                h("td", { class: "num" }, b.sightings.toLocaleString("en")),
              ),
            ),
          ),
        ),
      ),
    );
  }

  const notes: string[] = [];
  if (report.hiddenLeftOut) {
    notes.push(
      `${plural(report.hiddenLeftOut, "sighting was", "sightings were")} left out to protect sensitive species: iNaturalist keeps their exact location hidden, either because the observer chose to or because the species is rare or at risk.`,
    );
  }
  if (report.qualityLeftOut) {
    notes.push(`${plural(report.qualityLeftOut, "sighting was", "sightings were")} left out by the choice of which sightings to count.`);
  }
  notes.push("Observers' names and map locations are not included in this report.");
  sections.push(
    h(
      "footer",
      { class: "r-foot" },
      ...notes.map((n) => h("p", {}, n)),
      h("p", {}, "Sightings and identifications from iNaturalist (inaturalist.org). Report made with Bioblitz Report, bioblitz-report.vercel.app."),
    ),
  );

  target.replaceChildren(...sections.filter((s): s is Node => s instanceof Node));
}
