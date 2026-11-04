// A minimal, real (byte-accurate xref) single-page PDF with an actual text
// content stream, so the server's pdftotext-based extraction pipeline finds
// real fields — not just a garbage buffer that always yields an empty scan.
export function textPdfBytes(lines: string[]): Buffer {
  const content =
    "BT /F1 12 Tf " +
    lines
      .map((line, i) => `${i === 0 ? "20 260" : "0 -20"} Td (${line.replace(/([()\\])/g, "\\$1")}) Tj`)
      .join(" ") +
    " ET";

  const objects = [
    "<</Type/Catalog/Pages 2 0 R>>",
    "<</Type/Pages/Kids[3 0 R]/Count 1>>",
    "<</Type/Page/Parent 2 0 R/MediaBox[0 0 400 400]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>",
    "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
    // Trailing \n matters: without it this object's text ends in
    // "endstream", and the object loop below appends "endobj" right after
    // with no separator, gluing them into the single invalid token
    // "endstreamendobj". A build of poppler that recovers leniently from
    // that (as a local dev machine's often does) still extracts the text
    // fine, masking the bug — but CI's poppler-utils build doesn't recover,
    // so `extractedText` comes back empty and every field assertion below
    // sees "" instead of a real value. A conformant PDF doesn't need any
    // parser's leniency to begin with.
    `<</Length ${Buffer.byteLength(content, "latin1")}>>stream\n${content}\nendstream\n`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${i + 1} 0 obj${obj}endobj\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${off.toString().padStart(10, "0")} 00000 n \n`;
  pdf += `trailer<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf, "latin1");
}
