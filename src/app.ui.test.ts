// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
const sampleText = readFileSync(resolve(process.cwd(), "public/sample-observations.csv"), "utf8");

const HEAD = "scientific_name,common_name,iconic_taxon_name,quality_grade,geoprivacy,taxon_geoprivacy,coordinates_obscured,taxon_family_name,taxon_species_name";
const otherFarm = [
  HEAD,
  "Turdus migratorius,American Robin,Aves,research,,,false,Turdidae,Turdus migratorius",
  "Panax quinquefolius,American Ginseng,Plantae,research,,obscured,true,Araliaceae,Panax quinquefolius",
].join("\n");

let sampleGate: Promise<void> | null = null;
let sampleFails = false;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const reportText = () => $("report").textContent ?? "";

/** A file whose contents arrive only when `release` is called. */
function slowFile(name: string, text: string, fail = false) {
  let release!: () => void;
  const ready = new Promise<void>((r) => (release = r));
  const file = {
    name,
    async arrayBuffer() {
      await ready;
      if (fail) throw new Error("read failed");
      return new TextEncoder().encode(text).buffer;
    },
  };
  return { file, release };
}

function choose(file: unknown) {
  const input = $<HTMLInputElement>("file");
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  input.dispatchEvent(new Event("change"));
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeAll(async () => {
  document.body.innerHTML = html.replace(/^[\s\S]*<body>|<\/body>[\s\S]*$/g, "").replace(/<script[\s\S]*?<\/script>/g, "");
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  vi.stubGlobal("fetch", async () => {
    if (sampleGate) await sampleGate;
    if (sampleFails) return new Response("", { status: 503 });
    return new Response(sampleText);
  });
  await import("./main");
});

describe("loading a new dataset", () => {
  it("resets the sensitive-species opt-in: sample, opt in, then another file", async () => {
    $("sample-btn").click();
    await vi.waitFor(() => expect(reportText()).toContain("Willow Bend Farm"));
    const box = $<HTMLInputElement>("include-hidden");
    box.checked = true;
    box.dispatchEvent(new Event("change"));
    expect(reportText()).toContain("Panax quinquefolius");

    const { file, release } = slowFile("other-farm.csv", otherFarm);
    choose(file);
    release();
    await vi.waitFor(() => expect($("load-status").textContent).toContain("Read other-farm.csv:"));
    expect(box.checked).toBe(false);
    expect($("hidden-warn").hidden).toBe(true);
    expect(reportText()).not.toContain("Panax");
    expect(reportText()).not.toContain("Ginseng");
    expect(reportText()).toContain("1 sighting was left out to protect sensitive species");
  });

  it("file then file: the older read finishing last doesn't replace the newer report", async () => {
    const slow = slowFile("slow.csv", sampleText);
    const fast = slowFile("fast.csv", otherFarm);
    choose(slow.file);
    choose(fast.file);
    fast.release();
    await vi.waitFor(() => expect($("load-status").textContent).toContain("Read fast.csv:"));
    slow.release();
    await flush();
    await flush();
    expect($("load-status").textContent).toContain("Read fast.csv:");
    expect(reportText()).not.toContain("Willow Bend Farm");
  });

  it("sample then file: a slow sample can't replace the file, and its failure shows no error", async () => {
    let open!: () => void;
    sampleGate = new Promise((r) => (open = r));
    sampleFails = true;
    $("sample-btn").click();
    const mine = slowFile("mine.csv", otherFarm);
    choose(mine.file);
    mine.release();
    await vi.waitFor(() => expect($("load-status").textContent).toContain("Read mine.csv:"));
    open();
    await flush();
    await flush();
    expect($("load-error").textContent).toBe("");
    expect($("load-status").textContent).toContain("Read mine.csv:");
    sampleGate = null;
    sampleFails = false;
  });

  it("a stale failed file read doesn't put an error over the newer report", async () => {
    const bad = slowFile("broken.csv", "", true);
    const good = slowFile("good.csv", otherFarm);
    choose(bad.file);
    choose(good.file);
    good.release();
    await vi.waitFor(() => expect($("load-status").textContent).toContain("Read good.csv:"));
    bad.release();
    await flush();
    await flush();
    expect($("load-error").textContent).toBe("");
  });

  it("switches off 'Research Grade only' when the file has no quality_grade column", async () => {
    const research = $<HTMLInputElement>("quality-research");
    research.checked = true;
    research.dispatchEvent(new Event("change"));
    const noGrade = slowFile("no-grade.csv", "scientific_name,taxon_species_name\nTurdus migratorius,Turdus migratorius\n");
    choose(noGrade.file);
    noGrade.release();
    await vi.waitFor(() => expect($("load-status").textContent).toContain("Read no-grade.csv:"));
    expect(research.disabled).toBe(true);
    expect(research.checked).toBe(false);
    expect($("research-off").hidden).toBe(false);
    expect(document.querySelector<HTMLInputElement>('input[name="quality"][value="no-casual"]')!.checked).toBe(true);
    expect(reportText()).toContain("Turdus migratorius");
  });
});
