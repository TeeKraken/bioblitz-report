import { describe, expect, it } from "vitest";
import { parseCsv, toTable } from "./csv";

describe("parseCsv", () => {
  it("reads plain rows", () => {
    expect(parseCsv("a,b,c\n1,2,3\n")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("strips a byte order mark", () => {
    expect(parseCsv("﻿id,scientific_name\n1,Turdus migratorius")[0]).toEqual(["id", "scientific_name"]);
  });

  it("keeps commas, line breaks and doubled quotes inside quoted fields", () => {
    const text = 'id,description,place_guess\n1,"On milkweed, south meadow.\nSecond one ""nearby""","Sample County, USA"\n2,plain,x';
    expect(parseCsv(text)).toEqual([
      ["id", "description", "place_guess"],
      ["1", 'On milkweed, south meadow.\nSecond one "nearby"', "Sample County, USA"],
      ["2", "plain", "x"],
    ]);
  });

  it("handles CRLF and CR line endings and a missing final line break", () => {
    expect(parseCsv("a,b\r\n1,2\r3,4")).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("keeps empty fields, including a trailing one", () => {
    expect(parseCsv("a,b,c\n1,,\n")).toEqual([
      ["a", "b", "c"],
      ["1", "", ""],
    ]);
  });

  it("skips blank lines", () => {
    expect(parseCsv("a\n\n1\n\n")).toEqual([["a"], ["1"]]);
  });

  it("treats a quote in the middle of a field as a plain character", () => {
    expect(parseCsv('a\n5" long\n')).toEqual([["a"], ['5" long']]);
  });

  it("doesn't throw on an unclosed quote", () => {
    expect(parseCsv('a,b\n1,"never closed\n2,3')).toEqual([
      ["a", "b"],
      ["1", "never closed\n2,3"],
    ]);
  });
});

describe("toTable", () => {
  it("keys records by lower-case header and fills short rows with empty strings", () => {
    const t = toTable(parseCsv("ID, Scientific_Name ,common_name\n1,Turdus migratorius\n"));
    expect(t.headers).toEqual(["ID", "Scientific_Name", "common_name"]);
    expect(t.records).toEqual([{ id: "1", scientific_name: "Turdus migratorius", common_name: "" }]);
  });

  it("returns nothing for an empty file", () => {
    expect(toTable(parseCsv(""))).toEqual({ headers: [], records: [] });
  });
});
