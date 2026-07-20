import assert from "node:assert/strict";
import test from "node:test";

import {
  compareSequences,
  parseFasta,
  sequenceAlphabet,
  translateSequence
} from "../src/sequence-core.js";

test("FASTA parsing indexes multiple records and normalizes sequence text", () => {
  const parsed = parseFasta(">one description\n atg cct \n>two\nATGTTT\n");
  assert.equal(parsed.records.length, 2);
  assert.equal(parsed.records[0].name, "one");
  assert.equal(parsed.records[0].description, "description");
  assert.equal(parsed.records[0].sequence, "ATGCCT");
  assert.equal(parsed.records[1].sequence, "ATGTTT");
});

test("sequence alphabet detection distinguishes DNA and protein", () => {
  assert.equal(sequenceAlphabet("ATGCNN--"), "dna");
  assert.equal(sequenceAlphabet("MPEQ"), "protein");
});

test("DNA translation respects the requested reading frame", () => {
  assert.equal(translateSequence("ATGGCCGAATTA", {frame: 1}), "MAEL");
  assert.equal(translateSequence("AATGGCCGAATT", {frame: 2}), "MAE");
});

test("comparison can translate DNA or compare raw sequences", () => {
  const amino = compareSequences("ATGGCCGAATTA", "ATGGTTGAATTA", {mode: "amino-acid", frame: 1});
  assert.equal(amino.mode, "amino-acid");
  assert.equal(amino.annotation, "Translated amino acids (frame 1)");
  assert.equal(amino.differenceCount, 1);
  assert.equal(amino.differences[0].label, "A2V");

  const raw = compareSequences("MKT", "MRT", {mode: "raw"});
  assert.equal(raw.mode, "raw");
  assert.equal(raw.differenceCount, 1);
  assert.equal(raw.differences[0].label, "K2R");
});
