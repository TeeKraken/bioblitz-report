import "./style.css";
import { parseCsv, toTable, type Table } from "./logic/csv";
import { buildReport, formatDateRange, type Options, type Quality, type Report } from "./logic/report";
import { groupLabel } from "./logic/groups";
import { isZip, readCsvFromZip, ZipError } from "./logic/zip";
import { h, renderReport, type Details } from "./render";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const fileInput = $<HTMLInputElement>("file");
const drop = $("drop");
const sampleBtn = $<HTMLButtonElement>("sample-btn");
const loadStatus = $("load-status");
const loadError = $("load-error");
const columnCheck = $("column-check");
const detailsCard = $("details-card");
const notableCard = $("notable-card");
const printCard = $("print-card");
const reportEl = $("report");
const pick = $<HTMLUListElement>("pick");
const pickEmpty = $("pick-empty");
const notableFilter = $<HTMLInputElement>("notable-filter");
const includeHidden = $<HTMLInputElement>("include-hidden");
const hiddenWarn = $("hidden-warn");
const fields = {
  title: $<HTMLInputElement>("f-title"),
  landowner: $<HTMLInputElement>("f-for"),
  place: $<HTMLInputElement>("f-place"),
  date: $<HTMLInputElement>("f-date"),
  by: $<HTMLInputElement>("f-by"),
};

interface State {
  table: Table | null;
  isSample: boolean;
  options: Options;
  report: Report | null;
  /** Notable finds in the order they were ticked; notes are kept if a species is unticked and ticked again. */
  picked: string[];
  notes: Map<string, string>;
  /** Whether the organizer has typed their own date (so loading options won't overwrite it). */
  dateEdited: boolean;
}

const state: State = {
  table: null,
  isSample: false,
  options: { includeHidden: false, quality: "no-casual" },
  report: null,
  picked: [],
  notes: new Map(),
  dateEdited: false,
};

const MAX_NOTE = 280;

function details(): Details {
  return {
    title: fields.title.value,
    landowner: fields.landowner.value,
    place: fields.place.value,
    date: fields.date.value,
    by: fields.by.value,
  };
}

function drawReport(): void {
  if (!state.report) return;
  renderReport(reportEl, {
    report: state.report,
    details: details(),
    notable: state.picked.map((scientific) => ({ scientific, note: state.notes.get(scientific) ?? "" })),
    isSample: state.isSample,
  });
}

function drawColumnCheck(report: Report): void {
  const { missing, noPrivacyColumns } = report.columns;
  columnCheck.replaceChildren();
  if (!missing.length) {
    columnCheck.hidden = true;
    return;
  }
  columnCheck.hidden = false;
  if (noPrivacyColumns) {
    columnCheck.append(
      h(
        "p",
        { class: "warn" },
        "This file doesn't say which sightings iNaturalist keeps hidden, so the app can't leave sensitive species out. Please export again with the Geo columns geoprivacy, taxon_geoprivacy and coordinates_obscured ticked before you share this report.",
      ),
    );
  }
  const others = missing.filter((m) => !["geoprivacy", "taxon_geoprivacy", "coordinates_obscured"].includes(m.column) || !noPrivacyColumns);
  if (others.length) {
    columnCheck.append(
      h("p", {}, "Some helpful columns aren't in this file. The report still works, but:"),
      h("ul", {}, ...others.map((m) => h("li", {}, h("code", {}, m.column), `: ${m.effect}.`))),
      h("p", { class: "hint" }, 'To add them, export again from iNaturalist and tick them under "Choose columns" (the taxon_… ones are under "Taxon Extras"). See step 1 above.'),
    );
  }
}

function drawPicker(): void {
  const report = state.report;
  if (!report) return;
  const q = notableFilter.value.trim().toLowerCase();
  const rows = report.species.filter((s) => !q || s.common.toLowerCase().includes(q) || s.scientific.toLowerCase().includes(q) || groupLabel(s.group).toLowerCase().includes(q));
  const index = new Map(report.species.map((s, i) => [s.scientific, i]));
  pick.replaceChildren(
    ...rows.map((s) => {
      const idx = index.get(s.scientific)!;
      const id = `pick-${idx}`;
      const checked = state.picked.includes(s.scientific);
      const box = h("input", { type: "checkbox", id, "data-sci": s.scientific });
      box.checked = checked;
      const li = h(
        "li",
        { class: checked ? "on" : "" },
        h(
          "label",
          { for: id, class: "pick-label" },
          box,
          h("span", { class: "pick-name" }, s.common ? h("b", {}, s.common) : null, s.common ? " " : null, h("i", {}, s.scientific)),
          h("span", { class: "pick-meta" }, `${groupLabel(s.group)} · ${s.sightings} ${s.sightings === 1 ? "sighting" : "sightings"}`),
        ),
      );
      if (checked) {
        const noteId = `note-${idx}`;
        const note = h("textarea", { id: noteId, rows: "2", maxlength: String(MAX_NOTE), "data-sci": s.scientific });
        note.value = state.notes.get(s.scientific) ?? "";
        li.append(h("label", { for: noteId, class: "note-label" }, `Note about ${s.common || s.scientific} (optional)`), note);
      }
      return li;
    }),
  );
  pickEmpty.hidden = rows.length > 0;
}

function recompute(): void {
  if (!state.table) return;
  state.report = buildReport(state.table, state.options);
  if (!state.dateEdited) fields.date.value = formatDateRange(state.report.firstDate, state.report.lastDate);
  drawColumnCheck(state.report);
  drawPicker();
  drawReport();
}

function showError(message: string): void {
  loadError.textContent = message;
  loadStatus.textContent = "";
}

function loadText(text: string, label: string, isSample: boolean): void {
  const table = toTable(parseCsv(text));
  if (table.headers.length === 0 || table.records.length === 0) {
    showError(`${label} has no sightings in it. Check you picked the right file, or export again from iNaturalist.`);
    return;
  }
  const lower = table.headers.map((x) => x.toLowerCase());
  if (!lower.includes("scientific_name") && !lower.includes("taxon_species_name")) {
    showError(
      `${label} doesn't look like an iNaturalist observations export: it has no scientific_name column. Export again from iNaturalist and keep the Taxon columns ticked (see step 1).`,
    );
    return;
  }
  loadError.textContent = "";
  state.table = table;
  state.isSample = isSample;
  state.picked = [];
  state.notes = new Map();
  state.dateEdited = false;
  notableFilter.value = "";
  if (isSample) {
    fields.title.value = "Willow Bend Farm bioblitz";
    fields.landowner.value = "The owners of Willow Bend Farm";
    fields.place.value = "Willow Bend Farm";
    fields.by.value = "Sample County Nature Club";
    state.picked = ["Trillium grandiflorum", "Danaus plexippus"];
    state.notes.set("Trillium grandiflorum", "Flowering on the north slope under the maples. Trilliums are slow to spread, so a patch like this means the woodland floor has been left in peace for a long time.");
    state.notes.set("Danaus plexippus", "Laying eggs on the milkweed in the south meadow. Leaving that meadow unmown until autumn gives the caterpillars time to grow.");
  } else {
    for (const f of Object.values(fields)) f.value = "";
  }
  recompute();
  const r = state.report!;
  loadStatus.textContent = `Read ${label}: ${r.rows.toLocaleString("en")} rows, ${r.species.length.toLocaleString("en")} species. Your report is ${window.matchMedia("(min-width: 960px)").matches ? "on the right" : "below"}.`;
  detailsCard.hidden = false;
  notableCard.hidden = false;
  printCard.hidden = false;
}

async function loadFile(file: File): Promise<void> {
  loadError.textContent = "";
  loadStatus.textContent = `Reading ${file.name}…`;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const text = isZip(bytes) ? await readCsvFromZip(bytes) : new TextDecoder().decode(bytes);
    loadText(text, file.name, false);
  } catch (err) {
    showError(err instanceof ZipError ? err.message : `Couldn't read ${file.name}. Check it's the .csv or .zip file from iNaturalist and try again.`);
  }
}

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file) void loadFile(file);
  fileInput.value = "";
});

drop.addEventListener("dragover", (e) => {
  e.preventDefault();
  drop.classList.add("over");
});
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", (e) => {
  e.preventDefault();
  drop.classList.remove("over");
  const file = e.dataTransfer?.files?.[0];
  if (file) void loadFile(file);
});
// A file dropped beside the box shouldn't make the browser navigate away from the report.
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => e.preventDefault());

sampleBtn.addEventListener("click", async () => {
  loadError.textContent = "";
  try {
    const res = await fetch("/sample-observations.csv");
    if (!res.ok) throw new Error(String(res.status));
    loadText(await res.text(), "the sample sightings", true);
  } catch {
    showError("Couldn't load the sample sightings. Check your connection and try again.");
  }
});

for (const f of Object.values(fields)) {
  f.addEventListener("input", () => {
    if (f === fields.date) state.dateEdited = fields.date.value.trim() !== "";
    drawReport();
  });
}

for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="quality"]')) {
  radio.addEventListener("change", () => {
    if (radio.checked) {
      state.options = { ...state.options, quality: radio.value as Quality };
      recompute();
    }
  });
}

includeHidden.addEventListener("change", () => {
  hiddenWarn.hidden = !includeHidden.checked;
  state.options = { ...state.options, includeHidden: includeHidden.checked };
  recompute();
});

notableFilter.addEventListener("input", drawPicker);

pick.addEventListener("change", (e) => {
  const box = e.target as HTMLInputElement;
  if (box.type !== "checkbox") return;
  const sci = box.dataset.sci!;
  state.picked = box.checked ? [...state.picked, sci] : state.picked.filter((s) => s !== sci);
  const focusId = box.id;
  drawPicker();
  drawReport();
  document.getElementById(focusId)?.focus();
});

pick.addEventListener("input", (e) => {
  const note = e.target as HTMLTextAreaElement;
  if (note.tagName !== "TEXTAREA") return;
  state.notes.set(note.dataset.sci!, note.value.slice(0, MAX_NOTE));
  drawReport();
});

$("print-btn").addEventListener("click", () => window.print());
