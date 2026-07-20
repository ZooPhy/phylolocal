function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function normalizeSequence(sequence) {
  return String(sequence ?? "")
    .replace(/\s+/g, "")
    .replace(/\./g, "-")
    .toUpperCase()
    .replace(/U/g, "T");
}

export function parseFasta(text, {maxRecords = 100000} = {}) {
  if (typeof text !== "string") throw new TypeError("FASTA input must be text.");
  const source = text.replace(/^\uFEFF/, "");
  const lines = source.split(/\r?\n/);
  const records = [];
  const warnings = [];
  let current = null;

  function pushCurrent() {
    if (!current) return;
    current.sequence = normalizeSequence(current.sequence);
    if (!current.sequence) {
      warnings.push(`Ignored empty FASTA record ${JSON.stringify(current.name)}.`);
      current = null;
      return;
    }
    records.push(current);
    current = null;
    if (records.length > maxRecords) {
      throw new RangeError(`FASTA file exceeds the ${maxRecords.toLocaleString()} record safety limit.`);
    }
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith(">")) {
      pushCurrent();
      const header = line.slice(1).trim();
      const [name, ...rest] = header.split(/\s+/);
      current = {
        name: name || `record-${records.length + 1}`,
        description: rest.join(" "),
        sequence: ""
      };
      continue;
    }
    if (!current) {
      throw new SyntaxError("FASTA text must begin with a header line that starts with '>'.");
    }
    current.sequence += line;
  }

  pushCurrent();
  if (!records.length) throw new SyntaxError("The FASTA file is empty.");
  return {records, warnings};
}

export function sequenceAlphabet(sequence) {
  const normalized = normalizeSequence(sequence).replace(/[-?*]/g, "");
  if (!normalized) return "unknown";
  const chars = new Set(normalized.split(""));
  const dnaAlphabet = new Set(["A", "C", "G", "T", "R", "Y", "S", "W", "K", "M", "B", "D", "H", "V", "N"]);
  const proteinAlphabet = new Set(["A", "C", "D", "E", "F", "G", "H", "I", "K", "L", "M", "N", "P", "Q", "R", "S", "T", "V", "W", "Y", "B", "Z", "X", "J"]);
  const isDna = [...chars].every((character) => dnaAlphabet.has(character));
  const isProtein = [...chars].every((character) => proteinAlphabet.has(character));
  if (isDna && !isProtein) return "dna";
  if (isProtein && !isDna) return "protein";
  if (isDna) return "dna";
  if (isProtein) return "protein";
  return "mixed";
}

const GENETIC_CODE = {
  TTT: "F", TTC: "F", TTA: "L", TTG: "L",
  TCT: "S", TCC: "S", TCA: "S", TCG: "S",
  TAT: "Y", TAC: "Y", TAA: "*", TAG: "*",
  TGT: "C", TGC: "C", TGA: "*", TGG: "W",
  CTT: "L", CTC: "L", CTA: "L", CTG: "L",
  CCT: "P", CCC: "P", CCA: "P", CCG: "P",
  CAT: "H", CAC: "H", CAA: "Q", CAG: "Q",
  CGT: "R", CGC: "R", CGA: "R", CGG: "R",
  ATT: "I", ATC: "I", ATA: "I", ATG: "M",
  ACT: "T", ACC: "T", ACA: "T", ACG: "T",
  AAT: "N", AAC: "N", AAA: "K", AAG: "K",
  AGT: "S", AGC: "S", AGA: "R", AGG: "R",
  GTT: "V", GTC: "V", GTA: "V", GTG: "V",
  GCT: "A", GCC: "A", GCA: "A", GCG: "A",
  GAT: "D", GAC: "D", GAA: "E", GAG: "E",
  GGT: "G", GGC: "G", GGA: "G", GGG: "G"
};

export function translateCodon(codon) {
  const normalized = normalizeSequence(codon);
  if (normalized.length !== 3) return "X";
  if (/[^ACGT]/.test(normalized)) {
    if (normalized.includes("-")) return "X";
    return "X";
  }
  return GENETIC_CODE[normalized] ?? "X";
}

export function translateSequence(sequence, {frame = 1} = {}) {
  const normalized = normalizeSequence(sequence).replace(/[^ACGT-]/g, "X");
  const offset = Math.max(0, Math.min(2, Number(frame) - 1 || 0));
  const aminoAcids = [];
  for (let index = offset; index + 2 < normalized.length; index += 3) {
    aminoAcids.push(translateCodon(normalized.slice(index, index + 3)));
  }
  return aminoAcids.join("");
}

function compareStrings(reference, query) {
  const differences = [];
  const length = Math.max(reference.length, query.length);
  let identical = 0;
  for (let index = 0; index < length; index += 1) {
    const ref = reference[index] ?? "-";
    const alt = query[index] ?? "-";
    if (ref === alt) {
      identical += 1;
      continue;
    }
    differences.push({
      position: index + 1,
      reference: ref,
      query: alt,
      label: `${ref}${index + 1}${alt}`
    });
  }
  return {
    comparedLength: length,
    differenceCount: differences.length,
    identicalCount: identical,
    differences
  };
}

export function compareSequences(reference, query, {mode = "amino-acid", frame = 1} = {}) {
  const referenceSequence = normalizeSequence(isRecord(reference) ? reference.sequence : reference);
  const querySequence = normalizeSequence(isRecord(query) ? query.sequence : query);
  const referenceAlphabet = sequenceAlphabet(referenceSequence);
  const queryAlphabet = sequenceAlphabet(querySequence);

  let comparisonMode = mode === "raw" ? "raw" : "amino-acid";
  let comparedReference = referenceSequence;
  let comparedQuery = querySequence;
  let annotation = "Raw sequence";

  if (comparisonMode === "amino-acid") {
    const referenceLooksProtein = referenceAlphabet === "protein";
    const queryLooksProtein = queryAlphabet === "protein";
    const referenceLooksDna = referenceAlphabet === "dna";
    const queryLooksDna = queryAlphabet === "dna";

    if (referenceLooksDna || queryLooksDna) {
      comparedReference = referenceLooksProtein && !referenceLooksDna ? referenceSequence : translateSequence(referenceSequence, {frame});
      comparedQuery = queryLooksProtein && !queryLooksDna ? querySequence : translateSequence(querySequence, {frame});
      annotation = `Translated amino acids (frame ${frame})`;
    } else {
      comparedReference = referenceSequence;
      comparedQuery = querySequence;
      annotation = "Protein sequence";
    }
  }

  const comparison = compareStrings(comparedReference, comparedQuery);
  return {
    mode: comparisonMode,
    annotation,
    frame: comparisonMode === "amino-acid" ? frame : null,
    referenceAlphabet,
    queryAlphabet,
    referenceSequence,
    querySequence,
    comparedReference,
    comparedQuery,
    referenceLength: referenceSequence.length,
    queryLength: querySequence.length,
    ...comparison
  };
}

export function indexFastaRecords(records) {
  const byName = new Map();
  for (const record of records) {
    if (!byName.has(record.name)) byName.set(record.name, record);
  }
  return byName;
}

export function formatSequenceComparison(comparison, {limit = 12} = {}) {
  if (!comparison) return [];
  const lines = [];
  const shown = comparison.differences.slice(0, limit);
  if (comparison.differenceCount === 0) {
    lines.push("No differences were found.");
    return lines;
  }
  for (const change of shown) {
    lines.push(change.label);
  }
  if (comparison.differenceCount > shown.length) {
    lines.push(`…and ${comparison.differenceCount - shown.length} more`);
  }
  return lines;
}

export function sequenceSummary(record) {
  if (!record) return null;
  const alphabet = sequenceAlphabet(record.sequence);
  return {
    name: record.name,
    description: record.description,
    length: normalizeSequence(record.sequence).length,
    alphabet
  };
}
