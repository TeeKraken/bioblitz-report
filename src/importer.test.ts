import { describe, expect, it } from "vitest";
import { createImporter } from "./importer";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup() {
  const log: string[] = [];
  const importer = createImporter<string>({ commit: (r) => log.push(`commit ${r}`), fail: (e) => log.push(`fail ${String(e)}`) });
  return { log, importer };
}

describe("createImporter", () => {
  it("drops an older import that finishes after a newer one", async () => {
    const { log, importer } = setup();
    const slow = deferred<string>();
    const fast = deferred<string>();
    const a = importer.run(() => slow.promise);
    const b = importer.run(() => fast.promise);
    fast.resolve("fast.csv");
    slow.resolve("slow.csv");
    expect(await Promise.all([a, b])).toEqual([false, true]);
    expect(log).toEqual(["commit fast.csv"]);
  });

  it("drops an older import that finishes before a newer one", async () => {
    const { log, importer } = setup();
    const first = deferred<string>();
    const second = deferred<string>();
    const a = importer.run(() => first.promise);
    const b = importer.run(() => second.promise);
    first.resolve("first.csv");
    await a;
    second.resolve("second.csv");
    await b;
    expect(log).toEqual(["commit second.csv"]);
  });

  it("drops a stale failure, so it can't put an error over the newer report", async () => {
    const { log, importer } = setup();
    const sample = deferred<string>();
    const file = deferred<string>();
    const a = importer.run(() => sample.promise);
    const b = importer.run(() => file.promise);
    file.resolve("mine.csv");
    await b;
    sample.reject("offline");
    expect(await a).toBe(false);
    expect(log).toEqual(["commit mine.csv"]);
  });

  it("drops a stale success when the newest import fails", async () => {
    const { log, importer } = setup();
    const a = deferred<string>();
    const b = deferred<string>();
    const pa = importer.run(() => a.promise);
    const pb = importer.run(() => b.promise);
    b.reject("bad zip");
    await pb;
    a.resolve("old.csv");
    await pa;
    expect(log).toEqual(["fail bad zip"]);
  });
});
